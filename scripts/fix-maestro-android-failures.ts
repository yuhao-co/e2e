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

RULES:
- Return ONLY the fixed YAML, no explanation, no markdown fences
- Keep the same scenario intent — only fix the broken steps
- Add comments explaining each fix with "# [fix: ...]"
- Do not add hard-coded coordinates
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
