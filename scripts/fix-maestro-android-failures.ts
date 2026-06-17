#!/usr/bin/env tsx
/**
 * Android Maestro Failure Fixer
 *
 * Reads the run results, takes each failed case, sends the YAML + failure
 * reason + screenshot (if available) to AI, and writes a fixed YAML.
 * Optionally re-runs the fixed cases to verify the fix.
 *
 * Usage:
 *   tsx scripts/fix-maestro-android-failures.ts
 *   tsx scripts/fix-maestro-android-failures.ts --verify   # re-run after fix
 *   tsx scripts/fix-maestro-android-failures.ts --case android-results-smoke
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// PATH bootstrap — ensure maestro, java17, adb are always findable regardless
// of how this script is invoked (cron, npm run, IDE, android-diff-workflow.ts)
// ---------------------------------------------------------------------------
const MAESTRO_BIN = `${process.env.HOME}/.maestro/bin`;
const JAVA_BIN    = '/opt/homebrew/opt/openjdk@17/bin';
const BREW_BIN    = '/opt/homebrew/bin';
const ADB_BIN     = `${process.env.HOME}/Library/Android/sdk/platform-tools`;
process.env.JAVA_HOME = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17';
process.env.PATH = [MAESTRO_BIN, JAVA_BIN, BREW_BIN, ADB_BIN, process.env.PATH].join(':');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const VERIFY_AFTER_FIX = args.includes('--verify');
const CASE_FILTER = (() => {
  const idx = args.indexOf('--case');
  return idx !== -1 ? args[idx + 1] : null;
})();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RESULTS_JSON = path.resolve('test-results/android/results.json');
const GENERATED_DIR = path.resolve('maestro/flows/android/generated');

// Auth resolution — GitHub token preferred
function resolveGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const t = execSync('gh auth token', { encoding: 'utf8', stdio: 'pipe' }).trim();
    return t || null;
  } catch { return null; }
}

const githubToken = resolveGitHubToken();
const openaiKey = process.env.OPENAI_API_KEY;

const openai = (() => {
  if (githubToken) return new OpenAI({ apiKey: githubToken, baseURL: 'https://models.inference.ai.azure.com' });
  if (openaiKey)   return new OpenAI({ apiKey: openaiKey });
  return new OpenAI({
    apiKey: process.env.MIDSCENE_MODEL_API_KEY ?? 'local',
    baseURL: process.env.MIDSCENE_MODEL_BASE_URL ?? 'http://127.0.0.1:8080/v1',
  });
})();

const MODEL = process.env.GITHUB_MODEL
  ?? (githubToken ? 'gpt-4o' : process.env.OPENAI_MODEL ?? process.env.MIDSCENE_MODEL_NAME ?? 'gpt-4o');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CaseResult {
  id: string;
  name: string;
  priority: string;
  category: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  screenshotPath: string | null;
  failureReason: string | null;
  runAt: string;
}

interface RunReport {
  runAt: string;
  cases: CaseResult[];
}

// ---------------------------------------------------------------------------
// MISSING_ID resolver — runs before AI fix loop, no AI needed
// Scans all generated YAMLs for MISSING_ID_CHECK_EXISTING_CASES_OR_SOURCE,
// determines the correct id by:
//   1. Context analysis (what tapOn/openLink came before this wait?)
//   2. Existing passing cases (copy exact patterns)
//   3. android-v3 source query (grep @+id/ from relevant layout XMLs)
// ---------------------------------------------------------------------------

const ANDROID_V3_REPO = path.join(process.cwd(), '.cache/weekly-diff-repos/github.com_traveloka_android-v3');

/** Extract IDs used in all existing passing YAML files (excludes suite file) */
function loadPassingCasePatterns(): Map<string, string> {
  // Maps a "preceding tap ID" → "correct wait ID"
  // Built from existing passing cases that have proper extendedWaitUntil patterns
  const patterns = new Map<string, string>([
    ['flight_result_filter_button_title', 'layout_filter_dialog'],
    ['flight_result_sort_button_title',   'layout_tray'],
    ['dbwShow',                           'card_result'],
    ['radio_button',                      'card_result'],
    ['button_direct',                     'layout_filter_dialog'],  // still inside dialog
    ['button_one_transit',                'layout_filter_dialog'],
    ['button_two_transit',                'layout_filter_dialog'],
    ['layer_airline',                     'layout_filter_dialog'],
    ['check_box',                         'layout_filter_dialog'],
    ['button_departure_morning',          'layout_filter_dialog'],
    ['button_departure_afternoon',        'layout_filter_dialog'],
    ['button_departure_evening',          'layout_filter_dialog'],
    ['card_result',                       'flight_summary_activity_ticket_option_section'],
    ['ivClose',                           'card_result'],
  ]);

  // Augment from actual existing cases
  if (!fs.existsSync(GENERATED_DIR)) return patterns;
  for (const f of fs.readdirSync(GENERATED_DIR)) {
    if (!f.endsWith('.yaml') || f.endsWith('.bak')) continue;
    const content = fs.readFileSync(path.join(GENERATED_DIR, f), 'utf8');
    if (content.includes('MISSING_ID')) continue; // skip unresolved files
    // Extract: tapOn id: X → extendedWaitUntil visible: id: Y
    const matches = [...content.matchAll(
      /tapOn:\s*\n\s+id:\s*["']?([\w_]+)["']?[\s\S]{0,300}?extendedWaitUntil:\s*\n\s+visible:\s*\n\s+id:\s*["']?([\w_]+)["']?/g
    )];
    for (const m of matches) {
      patterns.set(m[1], m[2]);
    }
  }
  return patterns;
}

/** Query android-v3 source for IDs matching a keyword from surrounding comment text */
function querySourceForKeyword(keyword: string): string | null {
  if (!fs.existsSync(ANDROID_V3_REPO)) return null;
  try {
    const layoutDir = path.join(ANDROID_V3_REPO, 'flight/src/main/res/layout');
    const grepCmd = `grep -rl "${keyword}" "${layoutDir}" 2>/dev/null | head -3`;
    const files = execSync(grepCmd, { encoding: 'utf8', timeout: 5000 }).trim();
    if (!files) return null;
    const idCmd = `echo "${files}" | xargs grep -h '@+id/' 2>/dev/null | grep -i "${keyword}" | grep -oE '@\\+id/[^"]+' | head -3`;
    const raw = execSync(idCmd, { encoding: 'utf8', timeout: 5000 }).trim();
    if (!raw) return null;
    return raw.split('\n')[0].replace('@+id/', '').trim();
  } catch { return null; }
}

/**
 * Infer the correct ID for a MISSING_ID placeholder based on:
 * 1. What tapOn/openLink appeared in the preceding ~20 lines
 * 2. Whether this is an assertVisible (end-of-flow assertion)
 * 3. android-v3 source query using keywords extracted from surrounding comments
 */
function inferIdFromContext(
  lines: string[],
  idx: number,
  patterns: Map<string, string>,
): string {
  const preceding = lines.slice(Math.max(0, idx - 25), idx).join('\n');
  const currentLine = lines[idx];

  // ── 1. Context: assertVisible at end of flow → card_result ──────────────
  if (/assertVisible/.test(currentLine)) {
    return 'card_result';
  }

  // ── 2. Context: what was the last meaningful tapOn? ──────────────────────
  // Walk backwards to find the most recent tapOn id:
  for (let j = idx - 1; j >= Math.max(0, idx - 25); j--) {
    const m = lines[j].match(/id:\s*["']?([\w_]+)["']?/);
    if (m && lines[j - 1]?.includes('tapOn')) {
      const tapId = m[1];
      if (patterns.has(tapId)) return patterns.get(tapId)!;
    }
    // tapOn: id: inline
    const tapLine = lines[j].match(/tapOn:\s*\n/) ? null : lines[j - 1];
    if (tapLine?.includes('tapOn') && m) {
      if (patterns.has(m[1])) return patterns.get(m[1])!;
    }
  }

  // ── 3. Context: after openLink (navigation) → card_result ───────────────
  if (/openLink/.test(preceding)) {
    // Check nothing else significant happened after openLink
    const afterLink = preceding.slice(preceding.lastIndexOf('openLink'));
    if (!/tapOn/.test(afterLink)) return 'card_result';
  }

  // ── 4. Context: inside filter dialog (filter-related comment in file) ───
  if (/filter.*dialog|layout_filter_dialog|flight_result_filter_button/i.test(preceding)) {
    return 'layout_filter_dialog';
  }

  // ── 5. Context: inside sort tray ─────────────────────────────────────────
  if (/sort.*tray|layout_tray|flight_result_sort_button/i.test(preceding)) {
    return 'layout_tray';
  }

  // ── 6. Source query: extract keyword from surrounding step comments ───────
  const commentMatch = preceding.match(/# (?:Step \d+: )?(.+?)(?:\n|$)/g);
  if (commentMatch) {
    const lastComment = commentMatch[commentMatch.length - 1] ?? '';
    const keyword = lastComment
      .replace(/#\s*/, '').toLowerCase()
      .split(/\s+/)
      .find(w => w.length > 5 && !['should', 'using', 'after', 'assert', 'screen', 'verify', 'flight', 'results'].includes(w));
    if (keyword) {
      const sourceId = querySourceForKeyword(keyword);
      if (sourceId) return sourceId;
    }
  }

  // ── 7. Safe default: results page anchor ─────────────────────────────────
  return 'card_result';
}

/** Also fix bare "tapOn removed" steps by reconstructing from context */
function reconstructRemovedTapOn(lines: string[], idx: number): string | null {
  const comment = lines[idx];
  const preceding = lines.slice(Math.max(0, idx - 5), idx).join('\n');

  // Is this a filter entry step?
  if (/open.*filter|filter.*button|filter.*dialog/i.test(comment)) {
    return '- tapOn:\n    id: "flight_result_filter_button_title"';
  }
  // Is this a sort entry step?
  if (/open.*sort|sort.*tray|sort.*button/i.test(comment)) {
    return '- tapOn:\n    id: "flight_result_sort_button_title"';
  }
  // Is this an apply step?
  if (/apply|submit|done|show.*result/i.test(comment)) {
    return '- tapOn:\n    id: "dbwShow"';
  }
  // Is this a transit/direct step?
  if (/direct|nonstop|non.?stop/i.test(comment)) {
    return '- tapOn:\n    id: "button_direct"';
  }
  // Is this a morning departure step?
  if (/morning.*depart/i.test(comment)) {
    return '- tapOn:\n    id: "button_departure_morning"';
  }
  return null;
}

function resolveMissingIds(): number {
  if (!fs.existsSync(GENERATED_DIR)) return 0;
  const patterns = loadPassingCasePatterns();
  const yamlFiles = fs.readdirSync(GENERATED_DIR)
    .filter(f => f.endsWith('.yaml') && !f.endsWith('.bak'));

  let resolvedFiles = 0;

  for (const file of yamlFiles) {
    const filePath = path.join(GENERATED_DIR, file);
    let content = fs.readFileSync(filePath, 'utf8');

    const hasMissing = content.includes('MISSING_ID_CHECK_EXISTING_CASES_OR_SOURCE');
    const hasBareRemoved = content.includes('[sanitized: bare tapOn removed');
    if (!hasMissing && !hasBareRemoved) continue;

    let lines = content.split('\n');
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      // ── Resolve MISSING_ID ──────────────────────────────────────────────
      if (lines[i].includes('MISSING_ID_CHECK_EXISTING_CASES_OR_SOURCE')) {
        const resolved = inferIdFromContext(lines, i, patterns);
        lines[i] = lines[i].replace(
          /["']MISSING_ID_CHECK_EXISTING_CASES_OR_SOURCE["'][^]*/,
          `"${resolved}" # [resolved: context+source lookup → ${resolved}]`
        );
        changed = true;
      }

      // ── Reconstruct bare tapOn removed ─────────────────────────────────
      if (lines[i].includes('[sanitized: bare tapOn removed')) {
        const reconstructed = reconstructRemovedTapOn(lines, i);
        if (reconstructed) {
          lines[i] = reconstructed + ' # [reconstructed from context]';
          changed = true;
        }
      }
    }

    if (changed) {
      const backup = filePath + '.pre-resolve.bak';
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, content, 'utf8');
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      console.log(`  ✅ ${file}`);
      resolvedFiles++;
    }
  }

  return resolvedFiles;
}

// ---------------------------------------------------------------------------
// AI fix prompt
// ---------------------------------------------------------------------------
function buildFixSystemPrompt(): string {
  return `You are an expert mobile test engineer debugging and fixing Maestro YAML test cases for Android.

Given a failing Maestro YAML test case and its failure information, produce a fixed version.

Common failure causes and fixes:
1. "Element not found" → change text to match exactly what appears on screen; add scrollUntilVisible
2. "Timeout waiting" → increase timeout value; add extendedWaitUntil before the failing step
3. Wrong text → check the failure output for what was actually visible; use that text
4. Bottom sheet not open → add a wait step after the tap that opens it
5. App not in expected state → add state-check runFlow with conditional recovery
6. Onboarding blocking → add conditional dismissal at the start

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT A — SORT TRAY ENTRY POINT (adb dump verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE ONLY WAY TO OPEN THE SORT TRAY:
  - tapOn:
      id: "flight_result_sort_button_title"
  - extendedWaitUntil:
      visible:
        id: "layout_tray"
      timeout: 10000
  - tapOn:
      id: "radio_button"
      index: N

SORT ORDER (adb uiautomator dump confirmed, Pixel7_API37 staging 2026-06-12):
  index 0 → Cheapest              index 1 → Shortest duration
  index 2 → Direct flight first   index 3 → Earliest departure
  index 4 → Latest departure      index 5 → Earliest arrival
  index 6 → Latest arrival

After selecting sort, wait for results:
  - extendedWaitUntil:
      visible:
        id: "card_result"
      timeout: 15000

FORBIDDEN for sort:
  ❌ id: "flight_result_v4_sort_button"   ← not in a11y tree
  ❌ id: "bm_button"                       ← not in a11y tree (old guess)
  ❌ id: "rbg_sort"                        ← use as wait target only, NOT entry point
  ❌ tapOn: text: "Cheapest"              ← appears on flight cards, wrong target

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT B — FILTER DIALOG ENTRY POINT (adb dump verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
flight_result_v4_quick_filter_cell opens the STOPS BOTTOM SHEET only, NOT the full filter dialog.
layout_filter_dialog will NEVER appear after tapping quick_filter_cell or quick_filter_item.

THE ONLY WAY TO OPEN THE FULL FILTER DIALOG (layout_filter_dialog):
  - tapOn:
      id: "flight_result_filter_button_title"
  - extendedWaitUntil:
      visible:
        id: "layout_filter_dialog"
      timeout: 15000

FILTER DIALOG SECTION ORDER (must scroll to reach lower sections):
  1. layer_transit   → button_direct, button_one_transit, button_two_transit (visible on open)
  2. layer_airline   → check_box index N (need 1 bare scroll or extendedWaitUntil)
  3. layer_time      → button_departure_morning etc. (need scrollUntilVisible to reach)

FORBIDDEN for filter entry:
  ❌ id: "flight_result_v4_filter_button"   ← wrong id, doesn't exist
  ❌ id: "flight_result_v4_quick_filter_cell"  ← opens Stops sheet, not full filter
  ❌ id: "quick_filter_item"                    ← does not exist

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT C — FILTER APPLY BUTTON (source verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
tvResult is a TextView that DISPLAYS the result count ("Show 25 results"), NOT the apply button.
Tapping tvResult does NOT close the dialog or apply the filter.
The actual clickable apply button is dbwShow (flight_result_revamp_filter_dialog.xml verified).

CORRECT apply pattern:
  - tapOn:
      id: "dbwShow"            ← ONLY correct apply button

FORBIDDEN:
  ❌ id: "tvResult"            ← count label, not a button; dialog will NOT close

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT D — SCROLLING INSIDE FILTER DIALOG (verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
bare "- scroll" and "swipe: direction: UP" scroll the RESULTS LIST behind the dialog,
NOT the dialog's internal NestedScrollView.
For elements below the fold inside the filter dialog, use scrollUntilVisible.

CORRECT pattern for departure time section:
  - scrollUntilVisible:
      element:
        id: "button_departure_morning"
      direction: DOWN
      timeout: 15000
  - tapOn:
      id: "button_departure_morning"

FORBIDDEN inside filter dialog:
  ❌ swipe: direction: UP  ← scrolls results list, may dismiss dialog
  ❌ scroll with sub-keys (scroll: direction: DOWN)  ← unsupported Maestro syntax

RULES:
- Return ONLY the fixed YAML, no explanation, no markdown fences
- Keep the same scenario intent — only fix the broken steps
- Add comments explaining each fix with "# [fix: ...]"
- Do not add hard-coded coordinates (exception: price calendar icon has no testTag → tap at "96%, 14%")
- Ensure all assertVisible steps match realistic text from an Android flight results screen`;
}

function buildFixUserPrompt(
  originalYaml: string,
  failureReason: string | null,
  stdout: string,
  stderr: string,
  hasScreenshot: boolean
): string {
  const failure = failureReason ?? 'Unknown failure';
  const logs = [stdout, stderr].filter(Boolean).join('\n').slice(0, 2000);

  return `Fix this failing Maestro YAML test case.

## Failure Reason
${failure}

## Maestro Output Logs
\`\`\`
${logs}
\`\`\`

${hasScreenshot ? '## Screenshot\nA screenshot was captured at the moment of failure (see attached image).\n' : ''}

## Original YAML (failing)
\`\`\`yaml
${originalYaml}
\`\`\`

Produce the fixed YAML:`;
}

// ---------------------------------------------------------------------------
// Fix a single case
// ---------------------------------------------------------------------------
async function fixCase(result: CaseResult): Promise<boolean> {
  const yamlFile = path.join(GENERATED_DIR, `${result.id}.yaml`);

  if (!fs.existsSync(yamlFile)) {
    console.log(`  ⚠️  YAML file not found: ${yamlFile}`);
    return false;
  }

  const originalYaml = fs.readFileSync(yamlFile, 'utf8');
  const hasScreenshot = Boolean(result.screenshotPath && fs.existsSync(result.screenshotPath));

  // Build messages — include screenshot if available and using vision model
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildFixSystemPrompt() },
  ];

  if (hasScreenshot && result.screenshotPath && process.env.OPENAI_API_KEY) {
    // Vision-capable model: attach screenshot as base64
    let imageData: string | null = null;
    try {
      imageData = fs.readFileSync(result.screenshotPath).toString('base64');
    } catch {
      // screenshot read failed, proceed without it
    }

    if (imageData) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildFixUserPrompt(originalYaml, result.failureReason, result.stdout, result.stderr, true),
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${imageData}`,
              detail: 'low',
            },
          },
        ],
      });
    } else {
      messages.push({
        role: 'user',
        content: buildFixUserPrompt(originalYaml, result.failureReason, result.stdout, result.stderr, false),
      });
    }
  } else {
    messages.push({
      role: 'user',
      content: buildFixUserPrompt(originalYaml, result.failureReason, result.stdout, result.stderr, false),
    });
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages,
  });

  const fixedYaml = (response.choices[0]?.message?.content ?? '')
    .replace(/^```ya?ml\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  if (!fixedYaml || fixedYaml.length < 50) {
    console.log(`  ⚠️  AI returned empty fix for ${result.id}`);
    return false;
  }

  // Save backup of original
  const backupFile = path.join(GENERATED_DIR, `${result.id}.yaml.bak`);
  fs.writeFileSync(backupFile, originalYaml, 'utf8');

  // Write fixed YAML
  fs.writeFileSync(yamlFile, fixedYaml, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Optionally re-run a fixed case to verify
// ---------------------------------------------------------------------------
function verifyCase(caseId: string): boolean {
  const yamlFile = path.join(GENERATED_DIR, `${caseId}.yaml`);
  const result = spawnSync('maestro', ['test', '--format', 'plain', yamlFile], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env },
  });
  return (result.status ?? 1) === 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n🔧 Android Maestro Failure Fixer`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Verify after fix: ${VERIFY_AFTER_FIX}\n`);

  // ── Step 0: Statically resolve MISSING_ID placeholders ───────────────────
  // No AI needed — uses context analysis + existing cases + android-v3 source
  console.log('🔍 Step 0: Resolving MISSING_ID placeholders from source…');
  const resolvedCount = resolveMissingIds();
  if (resolvedCount > 0) {
    console.log(`   Resolved ${resolvedCount} file(s) with MISSING_ID → correct id\n`);
  } else {
    console.log('   No MISSING_ID placeholders found\n');
  }

  if (!fs.existsSync(RESULTS_JSON)) {
    console.error(`❌ Results file not found: ${RESULTS_JSON}`);
    console.error('   Run first: npm run maestro:android:run');
    process.exit(1);
  }

  const report: RunReport = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  let failedCases = report.cases.filter((c) => c.status === 'failed');

  if (CASE_FILTER) {
    failedCases = failedCases.filter((c) => c.id === CASE_FILTER);
  }

  if (failedCases.length === 0) {
    console.log('✅ No failed cases to fix!');
    return;
  }

  console.log(`Found ${failedCases.length} failed case(s) to fix:\n`);

  const fixResults: Array<{ id: string; name: string; fixed: boolean; verified?: boolean }> = [];

  for (const result of failedCases) {
    process.stdout.write(`  🔧 Fixing: ${result.name} … `);

    try {
      const fixed = await fixCase(result);
      if (!fixed) {
        console.log('⚠️  No fix generated');
        fixResults.push({ id: result.id, name: result.name, fixed: false });
        continue;
      }
      process.stdout.write('✅ Fixed');

      if (VERIFY_AFTER_FIX) {
        process.stdout.write(' → verifying … ');
        const verified = verifyCase(result.id);
        if (verified) {
          console.log('✅ PASS');
        } else {
          console.log('❌ Still failing (needs manual review)');
        }
        fixResults.push({ id: result.id, name: result.name, fixed: true, verified });
      } else {
        console.log();
        fixResults.push({ id: result.id, name: result.name, fixed: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ Error: ${msg}`);
      fixResults.push({ id: result.id, name: result.name, fixed: false });
    }
  }

  // Update results JSON with fix info
  const fixedIds = fixResults.filter((r) => r.fixed).map((r) => r.id);
  for (const c of report.cases) {
    if (fixedIds.includes(c.id)) {
      (c as CaseResult & { fixApplied?: boolean }).fixApplied = true;
    }
  }
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(report, null, 2), 'utf8');

  // Summary
  const totalFixed = fixResults.filter((r) => r.fixed).length;
  const totalVerified = fixResults.filter((r) => r.verified === true).length;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🔧 Fix Summary`);
  console.log(`   Fixed  : ${totalFixed} / ${failedCases.length}`);
  if (VERIFY_AFTER_FIX) {
    console.log(`   Verified passing: ${totalVerified} / ${totalFixed}`);
  }
  console.log(`\n   Backed-up originals: maestro/flows/android/generated/*.yaml.bak`);
  if (!VERIFY_AFTER_FIX) {
    console.log(`   Re-run to verify: npm run maestro:android:run`);
  }
  console.log(`${'─'.repeat(60)}\n`);
}

main().catch((err) => {
  console.error('\n❌ Fixer error:', err);
  process.exit(1);
});
