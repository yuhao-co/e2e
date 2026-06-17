#!/usr/bin/env tsx
/**
 * Android Online Bug Hunt
 *
 * Comprehensive bug-hunting workflow that runs ALL test scenarios (extended set)
 * regardless of code diffs. Designed to surface regressions, interaction bugs,
 * and visual glitches on the live staging app.
 *
 * Stages:
 *   1. validate-env    — adb/maestro/device check
 *   2. generate-cases  — AI generates extended set (~42 scenarios, SSR V4 coverage)
 *   3. run-cases       — maestro test, collect pass/fail + screenshots
 *   4. analyze-bugs    — classify failures by severity, deduplicate screenshots
 *   5. notify          — Lark rich report with bug list + repro screenshots
 *
 * Usage:
 *   tsx scripts/android-online-bug-hunt.ts
 *   tsx scripts/android-online-bug-hunt.ts --dry-run        # generate only, no run
 *   tsx scripts/android-online-bug-hunt.ts --no-generate    # skip generation, use existing YAMLs
 *   tsx scripts/android-online-bug-hunt.ts --model gpt-4o   # override AI model
 *   tsx scripts/android-online-bug-hunt.ts --prd-file <f>   # inject PRD context for generation
 *
 * Case generation rules & constraints (MUST READ before changing generated YAMLs):
 *   docs/android-maestro-case-generation.md
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { notifyCustom } from './lib/lark-notifier';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN       = args.includes('--dry-run');
const NO_GENERATE   = args.includes('--no-generate');
const FORCE_GENERATE = args.includes('--force-generate'); // bypass fast-path reuse check
const DISCOVER      = args.includes('--discover');   // NEW: AI auto-discovers uncovered paths
const CLI_MODEL     = (() => { const i = args.indexOf('--model'); return i !== -1 ? args[i + 1] : null; })();
const PRD_FILE      = (() => { const i = args.indexOf('--prd-file'); return i !== -1 ? args[i + 1] : null; })();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const APP_ID      = 'com.traveloka.android.staging';
const RESULTS_DIR = path.resolve('test-results/android');
const RESULTS_JSON = path.resolve('test-results/android/bug-hunt-results.json');
const SCREENSHOTS_DIR = path.resolve('test-results/android/screenshots');
const RUN_ALL_YAML = path.resolve('maestro/flows/android/run-all-android.yaml');
const LOGS_DIR    = path.resolve('logs');
const MANIFEST_PATH = path.resolve('maestro/flows/android/manifest.json');
const GENERATED_DIR = path.resolve('maestro/flows/android/generated');
const DISCOVERED_SCENARIOS_PATH = path.resolve('config/discovered-scenarios.json');

// ---------------------------------------------------------------------------
// OpenAI client (reuse same auth logic as generator)
// ---------------------------------------------------------------------------
const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? shSafe('gh auth token');
const openaiKey   = process.env.OPENAI_API_KEY;
const DISCOVER_MODEL = CLI_MODEL ?? (githubToken ? 'gpt-4o' : openaiKey ? 'gpt-4o' : 'gpt-4o');

function buildOpenAIClient(): OpenAI {
  if (githubToken) return new OpenAI({ apiKey: githubToken, baseURL: 'https://models.inference.ai.azure.com', maxRetries: 1 });
  if (openaiKey)   return new OpenAI({ apiKey: openaiKey });
  throw new Error('No AI auth: set GITHUB_TOKEN, GH_TOKEN, or OPENAI_API_KEY');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shSafe(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch { return ''; }
}

function elapsed(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }

/**
 * If no ADB device is online, auto-start Pixel7_API37 and wait for boot.
 * Throws if the emulator fails to boot within 3 minutes.
 */
function ensureEmulatorRunning(): void {
  const adbOut = shSafe('adb devices');
  if (adbOut.split('\n').some(l => /\tdevice$/.test(l.trim()))) return; // already online

  console.log('  ⚠️  No device found — auto-starting Pixel7_API37 emulator (~60s)…');
  const androidHome = process.env.ANDROID_HOME
    ?? path.join(process.env.HOME ?? '', 'Library/Android/sdk');
  const emulatorBin = path.join(androidHome, 'emulator', 'emulator');
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = path.join(LOGS_DIR, 'emulator.log');

  shSafe('pkill -f "emulator.*Pixel7_API37"'); // kill stale processes
  spawnSync('sleep', ['2']);

  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(emulatorBin, [
    '-avd', 'Pixel7_API37', '-no-audio', '-gpu', 'swiftshader_indirect', '-no-snapshot-save',
  ], { detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  fs.closeSync(logFd);
  console.log(`  Emulator PID: ${child.pid}`);

  // Poll until boot_completed=1 (max 3 min)
  process.stdout.write('  Booting');
  let booted = false;
  for (let i = 0; i < 36; i++) {
    spawnSync('sleep', ['5']);
    const boot = shSafe('adb shell getprop sys.boot_completed').replace(/\r/g, '');
    if (boot === '1') { booted = true; break; }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  if (!booted) throw new Error('Emulator boot timed out after 3 minutes');

  shSafe('adb shell input keyevent 82'); // unlock screen
  console.log('  ✅ Emulator ready (emulator-5554)');
}

interface BugHuntResult {
  runAt: string;
  durationMs: number;
  totalScenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  bugs: BugReport[];
}

interface BugReport {
  id: string;
  name: string;
  priority: 'p0' | 'p1' | 'p2';
  category: string;
  error: string;
  screenshotPath: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Stage 1: Validate environment
// ---------------------------------------------------------------------------
async function stageValidate(): Promise<void> {
  console.log('\n[1/5] Validating environment…');
  const t = Date.now();
  const issues: string[] = [];

  const maestroVer = shSafe('~/.maestro/bin/maestro --version');
  if (!maestroVer) issues.push('maestro CLI not found (~/.maestro/bin/maestro)');
  else console.log(`  ✅ Maestro: ${maestroVer.split('\n')[0]}`);

  // ADB + device — auto-start emulator if none connected
  ensureEmulatorRunning();
  console.log('  ✅ ADB device connected');

  if (issues.length > 0 && !DRY_RUN) {
    console.error(`  ❌ Environment issues:\n${issues.map(i => `     • ${i}`).join('\n')}`);
    throw new Error('Environment validation failed');
  }

  console.log(`  Done. (${elapsed(Date.now() - t)})`);
}

// ---------------------------------------------------------------------------
// Stage 1.5: AI-driven scenario discovery (--discover flag)
// Reads existing cases → finds coverage gaps → asks AI for NEW ScenarioDefinitions
// These are written to config/discovered-scenarios.json and picked up by the
// generator (--pending-scenarios) which applies the SAME quality gates:
//   same ID constraints, same blueprint injection, same sanitize/validate pipeline.
// ---------------------------------------------------------------------------
async function stageDiscover(): Promise<void> {
  if (!DISCOVER) return;
  console.log('\n[1.5/5] Discovering uncovered UI paths…');
  const t = Date.now();

  // ── 1. Read existing case files and extract covered interactions ──────────
  const existingFiles = fs.existsSync(GENERATED_DIR)
    ? fs.readdirSync(GENERATED_DIR).filter(f => f.endsWith('.yaml') && f !== 'android-suite.yaml')
    : [];

  if (existingFiles.length === 0) {
    console.log('  ⚠️  No existing cases found — skipping discovery (run generate first)');
    return;
  }

  // Extract: case IDs + every `id: "xxx"` value used across all cases
  const coveredCaseIds = new Set(existingFiles.map(f => f.replace('.yaml', '')));
  const usedIds = new Set<string>();
  const caseSummaries: string[] = [];

  for (const file of existingFiles) {
    const content = fs.readFileSync(path.join(GENERATED_DIR, file), 'utf8');
    const ids = [...content.matchAll(/id:\s*["']?([\w_]+)["']?/g)].map(m => m[1]);
    ids.forEach(id => usedIds.add(id));
    // One-line summary: case name + unique IDs
    const name = file.replace('.yaml', '').replace('android-results-', '');
    caseSummaries.push(`${name}: [${[...new Set(ids)].join(', ')}]`);
  }

  // ── 2. Load existing manifest to get scenario names ───────────────────────
  let manifestIds: string[] = [];
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      manifestIds = m.map((e: { id: string }) => e.id);
    } catch { /* ignore */ }
  }

  // ── 3. Ask AI for uncovered scenario definitions ──────────────────────────
  const openai = buildOpenAIClient();

  const systemPrompt = `You are an Android test coverage analyst for the Traveloka flight search results page.
Your job: identify Android UI interaction paths NOT yet covered by the existing test cases.
HINT: This includes FILTER COMBINATIONS that haven't been tested yet.

STRICT RULES — violations cause the output to be rejected entirely:
1. Output ONLY valid JSON array. No markdown, no explanation, no code fences.
2. Every "stepOutline" item MUST reference a specific element ID from the VERIFIED_IDS list.
3. NEVER use text: or label: as interaction locators. Only id: is allowed.
4. Each new scenario must test a DIFFERENT interaction path from the existing cases.
5. Maximum 5 new scenarios. Quality over quantity.
6. scenario id format: "android-results-<short-kebab-name>" or "android-results-combo-<filters>" (lowercase, hyphens only)

FILTER OPTION COMBINATIONS (can be freely mixed):
  Transit filters:           button_direct, button_one_transit, button_two_transit
  Time filters:              button_departure_morning, button_departure_afternoon, button_departure_evening
  Arrival time filters:      button_arrival_morning, button_arrival_early_morning
  Airline filters:           check_box (inside layer_airline, multiple choices possible)
  Reset button:              tvReset (clears all filters)

FILTER COMBINATION IDEAS (pick any 2-3 to test together):
  ✓ Direct flights + Morning departure
  ✓ 1-Stop + Afternoon departure + Specific airline
  ✓ 2+ stops + Late evening
  ✓ Direct + Early morning + Reset then apply again
  ✓ Mix 3+ filters together (e.g., Direct + Morning + Airline X + Early arrival)

VERIFIED IDs available (UIAutomator-confirmed):
  RESULTS PAGE:
    card_result, text_result_title, widget_dateflow, image_calendar,
    flight_result_filter_button_title, flight_result_sort_button_title,
    layout_tray, radio_button, layout_filter_dialog, layer_transit,
    button_direct, button_one_transit, button_two_transit, dbwShow, tvReset,
    layer_airline, check_box, layer_time, button_departure_morning,
    button_departure_afternoon, button_departure_evening, button_departure_early_morning,
    button_arrival_morning, button_arrival_early_morning,
    calendar_navbar_close

  FARE SELECTION PAGE (after tapping card_result):
    flight_summary_activity_ticket_option_section,
    ticket_option_select_button

  BOOKING FORM (after ticket_option_select_button → turbulence-safe wait):
    flight_booking_page_viewpager, traveler_data_container, search_box,
    label, primary_submit_button, bff_button_continue, icon_fill_in_details,
    error_button

  PAYMENT PAGE (after bff_button_continue → Enhance Your Trip interstitial):
    frame_input_card_form, bm_text_field_credit_card_number,
    bm_text_field_credit_card_expiry, bm_text_field_credit_card_cvv,
    bm_text_field_credit_card_fullname, button_payment_price_summary_pay

BOOKING FLOW ENTRY (mandatory pattern — deeplink only):
  - stopApp → launchApp → openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY
  - extendedWaitUntil id: card_result timeout: 30000
  - tap card_result index: 0 → wait flight_summary_activity_ticket_option_section
  - tap ticket_option_select_button index: 0
  - turbulence-safe: notVisible flight_summary_activity_ticket_option_section → runFlow error_button → flight_booking_page_viewpager
  - scroll × 2 → bff_button_continue → runFlow when "Enhance your trip" → frame_input_card_form

OUTPUT FORMAT (JSON array of ScenarioDefinition objects):
[
  {
    "id": "android-<results|booking|payment>-<name>",
    "priority": "p0|p1|p2",
    "category": "filter|sort|navigation|interaction|booking",
    "name": "Human readable name",
    "description": "What this tests and why it's valuable",
    "stepOutline": [
      "stopApp — deeplink navigation only",
      "launchApp",
      "openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY",
      "extendedWaitUntil id: card_result timeout: 30000",
      "... concrete steps with specific IDs from the VERIFIED IDs list ..."
    ],
    "successCriteria": ["specific assertion with id: xxx visible"]
  }
]`;

  const userPrompt = `EXISTING CASES (already covered — do NOT duplicate these):
${caseSummaries.join('\n')}

EXISTING CASE IDs: ${[...coveredCaseIds].join(', ')}

IDs already used across all cases: ${[...usedIds].join(', ')}

Based on the VERIFIED_IDS list, what interaction paths have NOT been tested yet?
Consider: filter combinations, sort + filter together, edge cases, alternative navigation flows.
Return JSON only.`;

  if (DRY_RUN) {
    console.log('  [dry-run] Would call AI for scenario discovery');
    console.log(`  Existing cases: ${existingFiles.length} | Covered IDs: ${usedIds.size}`);
    return;
  }

  let discovered: Array<{
    id: string; priority: string; category: string;
    name: string; description: string;
    stepOutline: string[]; successCriteria: string[];
  }> = [];

  try {
    const response = await openai.chat.completions.create({
      model: DISCOVER_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    });

    const raw = (response.choices[0]?.message?.content ?? '')
      .replace(/^```json\n?/m, '').replace(/\n?```$/m, '').trim();

    discovered = JSON.parse(raw);

    if (!Array.isArray(discovered)) throw new Error('Response is not a JSON array');

    // Filter out duplicates and validate structure
    discovered = discovered.filter(s => {
      if (!s.id || !s.stepOutline || !Array.isArray(s.stepOutline)) return false;
      if (coveredCaseIds.has(s.id)) {
        console.log(`  ⚠️  Skipping duplicate: ${s.id}`);
        return false;
      }
      // Reject any scenario that uses text: as interaction locator
      const hasTextLocator = s.stepOutline.some(step =>
        /tapOn.*text:|text:.*tapOn/i.test(step)
      );
      if (hasTextLocator) {
        console.log(`  ⚠️  Rejected (text: locator): ${s.id}`);
        return false;
      }
      return true;
    }).slice(0, 5); // max 5

  } catch (err) {
    console.error(`  ❌ Discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log('  Continuing without discovered scenarios.');
    return;
  }

  if (discovered.length === 0) {
    console.log('  ✅ No new paths found — existing cases already provide good coverage.');
    return;
  }

  // ── 4. Write to discovered-scenarios.json (generator picks this up) ───────
  fs.writeFileSync(DISCOVERED_SCENARIOS_PATH, JSON.stringify(discovered, null, 2), 'utf8');

  console.log(`  ✅ Discovered ${discovered.length} new scenario(s):`);
  for (const s of discovered) {
    console.log(`     • [${s.priority}] ${s.id} — ${s.name}`);
  }
  console.log(`  Written to: ${DISCOVERED_SCENARIOS_PATH}`);
  console.log(`  Generator will pick these up via --pending-scenarios. (${elapsed(Date.now() - t)})`);
}

// ---------------------------------------------------------------------------
// Stage 2: Generate extended test cases
// ---------------------------------------------------------------------------
/**
 * Returns true if all generated cases appear ready:
 *   - manifest.json exists and has no GENERATION_FAILED entries
 *   - config/remaining-scenarios.json does NOT exist (no partial run)
 *   - every manifest entry has a corresponding .yaml file on disk
 */
function allCasesReady(): boolean {
  if (!fs.existsSync(MANIFEST_PATH)) return false;
  if (fs.existsSync(path.resolve('config/remaining-scenarios.json'))) return false;
  let manifest: Array<{ id: string; warnings: string[] }> = [];
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { return false; }
  if (manifest.length === 0) return false;
  for (const entry of manifest) {
    if (entry.warnings?.some(w => w.startsWith('GENERATION_FAILED'))) return false;
    const yamlFile = path.join(GENERATED_DIR, `${entry.id}.yaml`);
    if (!fs.existsSync(yamlFile)) return false;
  }
  return true;
}

async function stageGenerate(): Promise<void> {
  if (NO_GENERATE) { console.log('\n[2/5] Skipping generation (--no-generate)'); return; }
  console.log('\n[2/5] Generating extended test cases…');
  const t = Date.now();

  // ── Fast path: all cases already exist — skip AI generation entirely ──────
  if (!FORCE_GENERATE && !DRY_RUN && allCasesReady()) {
    let manifest: Array<{ id: string }> = [];
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* ignore */ }
    console.log(`  ♻️  All ${manifest.length} cases already exist — skipping AI generation.`);
    console.log(`     (Use --force-generate to regenerate all cases.`);
    return;
  }

  const genArgs: string[] = [
    'npx', 'tsx', 'scripts/generate-maestro-android.ts',
    '--extended',
    '--combinatorial',  // Auto-generate 5 random filter combo scenarios for exploration
    ...(DRY_RUN ? ['--dry-run'] : []),
    ...(CLI_MODEL ? ['--model', CLI_MODEL] : []),
    ...(PRD_FILE ? ['--prd-file', PRD_FILE] : []),
    // If discover ran and produced new scenarios, pass them to the generator.
    // Generator applies the same ID constraints + blueprint injection + sanitize/validate.
    ...(DISCOVER && fs.existsSync(DISCOVERED_SCENARIOS_PATH)
      ? ['--pending-scenarios', DISCOVERED_SCENARIOS_PATH]
      : []),
  ];

  if (DRY_RUN) {
    console.log(`  [dry-run] Would run: ${genArgs.join(' ')}`);
    return;
  }

  const result = spawnSync(genArgs[0], genArgs.slice(1), {
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 600_000,  // 10 min for ~150 scenarios × ~7s each (quota-safe; remaining-scenarios.json handles resume)
  });

  if (result.status !== 0) {
    throw new Error(`Case generation failed (exit ${result.status})`);
  }
  console.log(`  Generation done. (${elapsed(Date.now() - t)})`);
}

// ---------------------------------------------------------------------------
// Stage 3: Run all cases
// ---------------------------------------------------------------------------
async function stageRun(): Promise<BugHuntResult> {
  console.log('\n[3/5] Running all test cases…');
  const t = Date.now();

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  if (DRY_RUN) {
    console.log('  [dry-run] Skipping test execution');
    return {
      runAt: new Date().toISOString(), durationMs: 0,
      totalScenarios: 0, passed: 0, failed: 0, skipped: 42, bugs: [],
    };
  }

  if (!fs.existsSync(RUN_ALL_YAML)) {
    throw new Error(`Run-all YAML not found: ${RUN_ALL_YAML}\nRun with --no-generate=false first.`);
  }

  // Load manifest to get priority/category info per scenario
  let manifest: Array<{ id: string; priority: string; category: string; name: string; warnings: string[] }> = [];
  if (fs.existsSync(MANIFEST_PATH)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* ignore */ }
  }

  const logFile = path.join(LOGS_DIR, `bug-hunt-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

  // Run each scenario individually for per-case result capture
  const bugs: BugReport[] = [];
  let passed = 0, failed = 0, skipped = 0;

  // Use manifest to get exactly the generated scenarios (skip suite files)
  // Manifest is written by the generator and covers only the 42 extended scenarios.
  const generatedDir = path.resolve('maestro/flows/android/generated');
  let yamlFiles: string[];
  if (manifest.length > 0) {
    // Filter to only non-failed entries; resolve absolute paths
    yamlFiles = manifest
      .filter(m => !m.warnings?.some(w => w.startsWith('GENERATION_FAILED')))
      .map(m => path.join(GENERATED_DIR, `${m.id}.yaml`))
      .filter(f => fs.existsSync(f))
      .map(f => path.basename(f));
  } else {
    // Fallback: scan directory but skip suite orchestrator files
    yamlFiles = fs.existsSync(generatedDir)
      ? fs.readdirSync(generatedDir)
          .filter(f => f.endsWith('.yaml') && !f.includes('-suite') && !f.includes('-p0-') && !f.includes('-p1-') && !f.includes('-p2-'))
          .sort()
      : [];
  }

  if (yamlFiles.length === 0) {
    throw new Error(`No generated YAML files found in ${generatedDir}`);
  }

  console.log(`  Running ${yamlFiles.length} scenarios…`);
  const log: string[] = [`# Android Bug Hunt Log — ${new Date().toISOString()}`, ''];

  for (const yamlFile of yamlFiles) {
    const scenarioId = yamlFile.replace('.yaml', '');
    const meta = manifest.find(m => m.id === scenarioId);
    const priority = (meta?.priority ?? 'p1') as 'p0' | 'p1' | 'p2';
    const category = meta?.category ?? 'unknown';
    const name = meta?.name ?? scenarioId;

    process.stdout.write(`  [${priority.toUpperCase()}] ${name.slice(0, 55).padEnd(55)} … `);

    const screenshotPath = path.join(SCREENSHOTS_DIR, `${scenarioId}.png`);
    // yamlFile may be a basename OR an absolute path depending on manifest vs fallback
    const flowPath = path.isAbsolute(yamlFile) ? yamlFile : path.join(generatedDir, yamlFile);

    const maestroBin = process.env.HOME
      ? `${process.env.HOME}/.maestro/bin/maestro`
      : '/Users/yu.hao/.maestro/bin/maestro';

    const result = spawnSync(maestroBin, [
      'test',
      '--udid', 'emulator-5554',
      '--no-ansi',
      flowPath,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,  // 2 min per scenario
      env: { ...process.env, JAVA_HOME: '/opt/homebrew/opt/openjdk@17' },
    });

    const exitCode = result.status ?? 1;
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const allOutput = `${stdout}\n${stderr}`;

    log.push(`## ${scenarioId}`);
    log.push(`Priority: ${priority} | Category: ${category}`);
    log.push(`Exit: ${exitCode}`);
    log.push('```');
    log.push(allOutput.slice(0, 1000));
    log.push('```');
    log.push('');

    if (exitCode === 0) {
      console.log('✅ PASS');
      passed++;
    } else {
      // Extract error message from Maestro output
      const errorMatch = allOutput.match(/(?:FAILED|Error|Exception)[^\n]*/i);
      const errorMsg = errorMatch ? errorMatch[0].trim() : `Exit code ${exitCode}`;

      // Try to capture screenshot via adb
      const adbScreenshot = spawnSync('adb', [
        'shell', 'screencap', '-p', `/sdcard/${scenarioId}.png`,
      ], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
      if (adbScreenshot.status === 0) {
        spawnSync('adb', ['pull', `/sdcard/${scenarioId}.png`, screenshotPath], {
          encoding: 'utf8', stdio: 'pipe', timeout: 5000,
        });
        spawnSync('adb', ['shell', 'rm', `/sdcard/${scenarioId}.png`], {
          encoding: 'utf8', stdio: 'pipe', timeout: 3000,
        });
      }

      const severity: BugReport['severity'] =
        priority === 'p0' ? 'critical' :
        priority === 'p1' ? 'high' : 'medium';

      bugs.push({
        id: scenarioId, name, priority, category,
        error: errorMsg,
        screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
        severity,
      });

      console.log(`❌ FAIL — ${errorMsg.slice(0, 60)}`);
      failed++;
    }
  }

  fs.writeFileSync(logFile, log.join('\n'), 'utf8');

  const huntResult: BugHuntResult = {
    runAt: new Date().toISOString(),
    durationMs: Date.now() - t,
    totalScenarios: yamlFiles.length,
    passed, failed, skipped,
    bugs,
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(huntResult, null, 2), 'utf8');
  console.log(`\n  Summary: ${passed} passed, ${failed} failed (${elapsed(Date.now() - t)})`);
  return huntResult;
}

// ---------------------------------------------------------------------------
// Stage 4: Analyze bugs
// ---------------------------------------------------------------------------
function stagAnalyzeBugs(result: BugHuntResult): void {
  console.log('\n[4/5] Analyzing bugs…');
  if (result.bugs.length === 0) { console.log('  No bugs detected 🎉'); return; }

  const byPriority = (p: string) => result.bugs.filter(b => b.priority === p);
  const p0 = byPriority('p0');
  const p1 = byPriority('p1');
  const p2 = byPriority('p2');

  console.log(`  P0 critical : ${p0.length} bugs`);
  console.log(`  P1 high     : ${p1.length} bugs`);
  console.log(`  P2 medium   : ${p2.length} bugs`);

  if (p0.length > 0) {
    console.log('\n  🚨 P0 Critical bugs:');
    for (const b of p0) {
      console.log(`     • [${b.category}] ${b.name}: ${b.error.slice(0, 80)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 5: Lark notification
// ---------------------------------------------------------------------------
async function stageNotify(result: BugHuntResult): Promise<void> {
  console.log('\n[5/5] Sending Lark notification…');

  const passRate = result.totalScenarios > 0
    ? Math.round((result.passed / result.totalScenarios) * 100)
    : 0;

  const icon = result.bugs.some(b => b.priority === 'p0') ? '🚨' :
               result.bugs.length > 0 ? '⚠️' : '✅';

  const bugLines = result.bugs.slice(0, 20).map(b =>
    `[${b.priority.toUpperCase()}][${b.category}] **${b.name}**\n> ${b.error.slice(0, 100)}`
  );

  const textContent = [
    `${icon} **Android Online Bug Hunt** — ${new Date(result.runAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    '',
    `📊 **Results:** ${result.passed}/${result.totalScenarios} passed (${passRate}%) | ${result.failed} bug(s) | ${elapsed(result.durationMs)}`,
    '',
    result.bugs.length > 0
      ? `🐛 **Bugs Found (${result.bugs.length})**\n\n${bugLines.join('\n\n')}`
      : '✅ All scenarios passed. No regressions detected.',
    '',
    result.bugs.length > 20
      ? `_…and ${result.bugs.length - 20} more — see ${RESULTS_JSON}_`
      : '',
  ].filter(l => l !== undefined).join('\n');

  await notifyCustom(
    `${icon} Android Bug Hunt: ${result.passed}/${result.totalScenarios} passed`,
    textContent,
    result.bugs.some(b => b.priority === 'p0') ? 'red' : result.bugs.length > 0 ? 'yellow' : 'green'
  );
  console.log('  Lark notification sent.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const globalStart = Date.now();

  console.log('\n🐛 Android Online Bug Hunt');
  console.log(`   Mode     : ${DRY_RUN ? 'dry-run' : 'full'}`);
  console.log(`   Generate : ${NO_GENERATE ? 'skip (--no-generate)' : 'extended (~42 scenarios)'}`);
  console.log(`   Discover : ${DISCOVER ? '✅ AI path discovery enabled' : 'off (add --discover to enable)'}`);
  console.log(`   Model    : ${CLI_MODEL ?? 'gpt-4o'}`);
  if (PRD_FILE) console.log(`   PRD file : ${PRD_FILE}`);
  console.log('');

  let huntResult: BugHuntResult | null = null;

  try {
    await stageValidate();
    await stageDiscover();   // AI finds uncovered paths (only when --discover flag set)
    await stageGenerate();
    huntResult = await stageRun();
    stagAnalyzeBugs(huntResult);
    await stageNotify(huntResult);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Bug hunt failed: ${msg}`);

    // Still send failure notification
    await notifyCustom(
      '❌ Android Bug Hunt FAILED',
      `Bug hunt pipeline failed at ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\nError: ${msg}`,
      'red'
    ).catch(() => {});

    process.exit(1);
  }

  const totalMs = Date.now() - globalStart;
  console.log(`\n✅ Bug hunt complete in ${elapsed(totalMs)}`);
  if (huntResult && huntResult.bugs.some(b => b.priority === 'p0')) {
    console.error('🚨 P0 critical bugs found — please investigate immediately');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
