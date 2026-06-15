#!/usr/bin/env tsx
/**
 * Android P0 Fast-Track Runner
 *
 * Runs exactly 4 hardcoded critical-path scenarios with a 5-minute total budget.
 * No generate or fix phase — uses pre-generated YAMLs directly.
 * Designed to run on every diff/PR as a quick confidence check before the full suite.
 *
 * Industry pattern: "confidence tests" (Netflix/Airbnb) — small set of must-pass
 * critical-path tests that gate every change, fast enough to not block CI.
 *
 * Exit code: 0 = all pass, 1 = any fail or budget exceeded
 * Usage:
 *   tsx scripts/run-android-p0-fast.ts
 *   npm run android:p0:fast
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// PATH bootstrap
// ---------------------------------------------------------------------------
const MAESTRO_BIN = `${process.env.HOME}/.maestro/bin`;
const JAVA_BIN    = '/opt/homebrew/opt/openjdk@17/bin';
const BREW_BIN    = '/opt/homebrew/bin';
const ADB_BIN     = `${process.env.HOME}/Library/Android/sdk/platform-tools`;
process.env.JAVA_HOME = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17';
process.env.PATH = [MAESTRO_BIN, JAVA_BIN, BREW_BIN, ADB_BIN, process.env.PATH].join(':');

// ---------------------------------------------------------------------------
// Budget constants
// ---------------------------------------------------------------------------
const TOTAL_BUDGET_MS    = 5 * 60 * 1000;  // 5-minute total wall-clock limit
const PER_CASE_TIMEOUT_MS = 90 * 1000;      // 90 seconds per case max

// ---------------------------------------------------------------------------
// The 4 P0 scenarios — fixed order, always run, non-negotiable
// Changing this list is a deliberate act; do not add without justification
// ---------------------------------------------------------------------------
const P0_CASES: Array<{ id: string; label: string }> = [
  { id: 'android-results-smoke',         label: 'Results page loads'      },
  { id: 'android-results-filter-direct', label: 'Direct flight filter'    },
  { id: 'android-results-sort-cheapest', label: 'Sort by cheapest'        },
  { id: 'android-results-select-flight', label: 'Select a flight'         },
];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const GENERATED_DIR = path.resolve('maestro/flows/android/generated');
const RESULTS_DIR   = path.resolve('test-results/android/p0-fast');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getMaestroPath(): string {
  return process.env.MAESTRO_PATH || `${process.env.HOME}/.maestro/bin/maestro`;
}

function getDeviceId(): string | null {
  try {
    const out = execSync('adb devices', { encoding: 'utf8' });
    const line = out.trim().split('\n').slice(1).find(l => l.includes('\tdevice'));
    return line ? line.split('\t')[0].trim() : null;
  } catch {
    return null;
  }
}

interface CaseResult {
  id: string;
  label: string;
  passed: boolean;
  durationMs: number;
  skipped: boolean;
  failureSnippet: string | null;
}

function runFlow(flowFile: string, timeoutMs: number): { passed: boolean; durationMs: number; output: string } {
  const start = Date.now();
  const maestro = getMaestroPath();
  const deviceId = getDeviceId();
  const args = deviceId
    ? ['test', '--udid', deviceId, '--no-ansi', flowFile]
    : ['test', '--no-ansi', flowFile];

  const result = spawnSync(maestro, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env },
  });

  const durationMs = Date.now() - start;
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const passed = (result.status ?? 1) === 0;
  return { passed, durationMs, output };
}

function extractFailureSnippet(output: string): string | null {
  const patterns = [
    /Element not found[:\s]+(.+)/i,
    /Timeout waiting for[:\s]+(.+)/i,
    /Assertion failed[:\s]+(.+)/i,
    /tapOn[:\s]+(.+?) - (not found|timed out)/i,
    /FAILED[:\s]+(.+)/i,
  ];
  for (const p of patterns) {
    const m = output.match(p);
    if (m) return m[0].trim().slice(0, 150);
  }
  // Last non-trivial stderr line
  const lines = output.split('\n').reverse();
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 10 && !/^(Usage|Device|maestro)/i.test(t)) return t.slice(0, 150);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║      Android P0 Fast-Track  (≤5 min budget)         ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Pre-flight: verify all P0 flow files exist
  for (const { id } of P0_CASES) {
    const file = path.join(GENERATED_DIR, `${id}.yaml`);
    if (!fs.existsSync(file)) {
      console.error(`❌ Missing P0 flow: ${file}`);
      console.error('   Run: npm run maestro:android:generate  (then retry)');
      process.exit(1);
    }
  }

  const deviceId = getDeviceId();
  if (!deviceId) {
    console.error('❌ No Android device/emulator connected. Start emulator first.');
    process.exit(1);
  }
  console.log(`  Device  : ${deviceId}`);
  console.log(`  Budget  : ${TOTAL_BUDGET_MS / 1000}s total, ${PER_CASE_TIMEOUT_MS / 1000}s per case`);
  console.log(`  Cases   : ${P0_CASES.length}\n`);

  const budgetStart = Date.now();
  const caseResults: CaseResult[] = [];

  for (const { id, label } of P0_CASES) {
    const elapsed  = Date.now() - budgetStart;
    const remaining = TOTAL_BUDGET_MS - elapsed;

    if (remaining <= 5000) {
      console.log(`  ⏱  Budget exhausted — skipping: ${label}`);
      caseResults.push({ id, label, passed: false, durationMs: 0, skipped: true, failureSnippet: 'budget exhausted' });
      continue;
    }

    const caseTimeout = Math.min(PER_CASE_TIMEOUT_MS, remaining);
    const flowFile = path.join(GENERATED_DIR, `${id}.yaml`);
    process.stdout.write(`  ▶  ${label.padEnd(30)} `);

    const { passed, durationMs, output } = runFlow(flowFile, caseTimeout);
    const icon = passed ? '✅' : '❌';
    console.log(`${icon}  ${(durationMs / 1000).toFixed(1)}s`);

    const failureSnippet = passed ? null : extractFailureSnippet(output);
    if (!passed) {
      if (failureSnippet) console.log(`      ↳ ${failureSnippet}`);
      const logFile = path.join(RESULTS_DIR, `${id}-failure.log`);
      fs.writeFileSync(logFile, output);
    }

    caseResults.push({ id, label, passed, durationMs, skipped: false, failureSnippet });
  }

  const totalMs  = Date.now() - budgetStart;
  const passCount = caseResults.filter(r => r.passed).length;
  const allPass   = passCount === P0_CASES.length;

  console.log('\n──────────────────────────────────────────────────────');
  console.log(`  ${passCount}/${P0_CASES.length} passed   ${(totalMs / 1000).toFixed(1)}s elapsed`);
  console.log(`  ${allPass ? '✅ P0 PASS — safe to proceed with full suite' : '❌ P0 FAIL — fix before running full suite'}`);
  console.log('──────────────────────────────────────────────────────\n');

  // Persist JSON summary
  const summary = {
    runAt: new Date().toISOString(),
    totalMs,
    passed: passCount,
    total: P0_CASES.length,
    allPass,
    budgetMs: TOTAL_BUDGET_MS,
    cases: caseResults,
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
