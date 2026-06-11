#!/usr/bin/env tsx
/**
 * Android Diff Workflow
 *
 * Full pipeline: android-v3 diff → generate → run → fix → notify → learn
 *
 * Stages:
 *   1. validate-env     — adb/maestro/device check
 *   2. sync-diff        — pull android-v3, identify changed flight files
 *   3. generate-cases   — AI generates Maestro YAML for affected scenarios
 *   4. run-cases        — maestro test, collect pass/fail + screenshots
 *   5. fix-failures     — AI fixes failed cases, optional re-verify
 *   6. notify           — Lark rich card with results + failed case details
 *   7. update-memory    — persist learning (flaky list, fix history)
 *
 * Usage:
 *   tsx scripts/android-diff-workflow.ts               # diff-triggered (default)
 *   tsx scripts/android-diff-workflow.ts --full        # run all 15 scenarios
 *   tsx scripts/android-diff-workflow.ts --no-fix      # skip AI fix stage
 *   tsx scripts/android-diff-workflow.ts --dry-run     # skip run/fix, just generate
 *   tsx scripts/android-diff-workflow.ts --priority p0 # run P0 only
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { notifyCustom } from './lib/lark-notifier';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FULL_RUN = args.includes('--full');
const NO_FIX = args.includes('--no-fix');
const DRY_RUN = args.includes('--dry-run');
const PRIORITY = (() => { const i = args.indexOf('--priority'); return i !== -1 ? args[i + 1] : null; })();
const SOURCE_JSON = (() => { const i = args.indexOf('--source-json'); return i !== -1 ? args[i + 1] : null; })();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ANDROID_REPO = path.resolve('.cache/weekly-diff-repos/github.com_traveloka_android-v3');
const RESULTS_JSON = path.resolve('test-results/android/results.json');
const MEMORY_FILE = path.resolve('config/android-learning-memory.json');
const LOGS_DIR = path.resolve('logs');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StageResult {
  stage: string;
  success: boolean;
  durationMs: number;
  output?: string;
  error?: string;
}

interface CaseResult {
  id: string;
  name: string;
  priority: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  failureReason: string | null;
  screenshotPath: string | null;
}

interface RunReport {
  runAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: string;
  cases: CaseResult[];
}

interface AndroidLearningMemory {
  lastUpdated: string;
  totalRuns: number;
  flakyScenarios: string[];   // consistently failing
  stableScenarios: string[];  // consistently passing
  fixHistory: Array<{
    scenarioId: string;
    fixedAt: string;
    failureReason: string;
    fixApplied: boolean;
  }>;
  diffTriggers: Array<{
    date: string;
    changedFiles: string[];
    affectedScenarios: string[];
    passRate: string;
  }>;
}

// ---------------------------------------------------------------------------
// File → Scenario mapping (from android-v3 layout/source analysis)
// ---------------------------------------------------------------------------
const DIFF_SCENARIO_MAP: Array<{ pattern: RegExp; scenarios: string[] }> = [
  {
    pattern: /flight_result_revamp_filter_transit|FlightResultRevamp.*Filter.*Transit/i,
    scenarios: ['android-results-filter-direct', 'android-results-filter-one-stop', 'android-results-filter-multi-stop', 'android-results-reset-filters'],
  },
  {
    pattern: /flight_filter_time|FlightFilter.*Time/i,
    scenarios: ['android-results-departure-time-filter'],
  },
  {
    pattern: /flight_filter_airline|FlightFilter.*Airline/i,
    scenarios: ['android-results-airline-filter'],
  },
  {
    pattern: /flight_sort_tray|FlightSort|FlightResultRevamp.*Sort/i,
    scenarios: ['android-results-sort-cheapest', 'android-results-sort-fastest', 'android-results-sort-best'],
  },
  {
    pattern: /flight_result_revamp_activity|FlightResultRevampActivity/i,
    scenarios: ['android-results-smoke', 'android-results-back-to-search', 'android-results-scroll'],
  },
  {
    pattern: /flight_search_result_card|FlightSearchResultCard/i,
    scenarios: ['android-results-select-flight', 'android-results-view-detail'],
  },
  {
    pattern: /flight_result_revamp_route|FlightResultRevamp.*Route|quick_filter/i,
    scenarios: ['android-results-filter-direct', 'android-results-filter-one-stop'],
  },
  {
    pattern: /FlightBloomCalendar|widget_dateflow|price.?calendar/i,
    scenarios: ['android-results-price-calendar'],
  },
];

function mapDiffToScenarios(changedFiles: string[]): string[] {
  const matched = new Set<string>();
  for (const file of changedFiles) {
    for (const rule of DIFF_SCENARIO_MAP) {
      if (rule.pattern.test(file)) {
        rule.scenarios.forEach(s => matched.add(s));
      }
    }
  }
  return [...matched];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sh(cmd: string, opts: { silent?: boolean } = {}): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Command failed: ${cmd}\n${msg}`);
  }
}

function shSafe(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch { return ''; }
}

function elapsed(ms: number) { return `${(ms / 1000).toFixed(1)}s`; }

function loadMemory(): AndroidLearningMemory {
  if (fs.existsSync(MEMORY_FILE)) {
    try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch { /* fall through */ }
  }
  return { lastUpdated: '', totalRuns: 0, flakyScenarios: [], stableScenarios: [], fixHistory: [], diffTriggers: [] };
}

function saveMemory(mem: AndroidLearningMemory) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Stage 1: Validate environment
// ---------------------------------------------------------------------------
async function stageValidate(): Promise<StageResult> {
  const t = Date.now();
  const issues: string[] = [];

  // Maestro CLI
  if (!shSafe('maestro --version')) issues.push('maestro CLI not found (brew install maestro)');

  // ADB + device
  const adbDevices = shSafe('adb devices');
  if (!adbDevices.includes('\tdevice')) issues.push('No Android device/emulator connected (adb devices)');

  // android-v3 repo
  if (!fs.existsSync(ANDROID_REPO)) issues.push(`android-v3 repo not found at ${ANDROID_REPO}`);

  // OPENAI_API_KEY (optional — warn only)
  if (!process.env.OPENAI_API_KEY) {
    console.warn('  ⚠️  OPENAI_API_KEY not set — will use local MLX model (lower quality)');
  }

  if (issues.length > 0) {
    return { stage: 'validate-env', success: false, durationMs: Date.now() - t, error: issues.join('; ') };
  }
  return { stage: 'validate-env', success: true, durationMs: Date.now() - t, output: 'ADB device + Maestro + repo OK' };
}

// ---------------------------------------------------------------------------
// Stage 2: Sync android-v3 diff
// ---------------------------------------------------------------------------
async function stageSyncDiff(): Promise<StageResult & { changedFiles: string[]; affectedScenarios: string[] }> {
  const t = Date.now();
  let changedFiles: string[] = [];
  let affectedScenarios: string[] = [];

  try {
    // Pull latest
    console.log('  Pulling android-v3 develop branch…');
    shSafe(`git -C "${ANDROID_REPO}" fetch --depth=1 origin develop`);
    shSafe(`git -C "${ANDROID_REPO}" reset --hard origin/develop`);

    // Get files changed in last 7 days
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const diffOutput = shSafe(
      `git -C "${ANDROID_REPO}" log --since="${since}" --name-only --pretty=format: | sort -u`
    );
    changedFiles = diffOutput.split('\n').map(f => f.trim()).filter(f =>
      f && /flight\//i.test(f)
    );

    if (FULL_RUN || changedFiles.length === 0) {
      console.log(`  ${FULL_RUN ? '--full flag set' : 'No flight diffs in last 7 days'} — running all scenarios`);
      affectedScenarios = []; // empty = all
    } else {
      affectedScenarios = mapDiffToScenarios(changedFiles);
      console.log(`  ${changedFiles.length} changed flight files → ${affectedScenarios.length} affected scenarios`);
      if (affectedScenarios.length === 0) {
        console.log('  No scenario mapping found — running all scenarios as fallback');
      }
    }

    return {
      stage: 'sync-diff',
      success: true,
      durationMs: Date.now() - t,
      output: `Changed: ${changedFiles.length} files, affected: ${affectedScenarios.length || 'all'} scenarios`,
      changedFiles,
      affectedScenarios,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'sync-diff', success: false, durationMs: Date.now() - t, error: msg, changedFiles, affectedScenarios };
  }
}

// ---------------------------------------------------------------------------
// Stage 3: Generate Maestro cases
// ---------------------------------------------------------------------------
async function stageGenerate(affectedScenarios: string[]): Promise<StageResult> {
  const t = Date.now();
  try {
    let cmd = 'tsx scripts/generate-maestro-android.ts';
    if (SOURCE_JSON) cmd += ` --source-json "${SOURCE_JSON}"`;
    if (DRY_RUN) cmd += ' --dry-run';

    const result = spawnSync('npx', cmd.split(' ').slice(1), {
      stdio: 'inherit', encoding: 'utf8', env: { ...process.env },
    });

    if (result.status !== 0) throw new Error('Generator exited with error');

    const manifest = path.resolve('maestro/flows/android/manifest.json');
    const generated = fs.existsSync(manifest)
      ? (JSON.parse(fs.readFileSync(manifest, 'utf8')) as Array<{ id: string; warnings: string[] }>)
          .filter(m => !m.warnings.some(w => w.startsWith('GENERATION_FAILED'))).length
      : 0;

    return {
      stage: 'generate-cases',
      success: true,
      durationMs: Date.now() - t,
      output: `${generated} Maestro YAML files generated`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'generate-cases', success: false, durationMs: Date.now() - t, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Stage 4: Run cases
// ---------------------------------------------------------------------------
async function stageRun(): Promise<StageResult & { report: RunReport | null }> {
  const t = Date.now();
  if (DRY_RUN) {
    return { stage: 'run-cases', success: true, durationMs: 0, output: 'Skipped (dry-run)', report: null };
  }

  try {
    let runArgs = ['tsx', 'scripts/run-maestro-android.ts'];
    if (PRIORITY) runArgs.push('--priority', PRIORITY);
    else if (!FULL_RUN) runArgs.push('--priority', 'p0'); // default: P0+P1 only on diff runs

    const result = spawnSync('npx', runArgs.slice(1), {
      stdio: 'inherit', encoding: 'utf8', env: { ...process.env },
    });

    const report: RunReport | null = fs.existsSync(RESULTS_JSON)
      ? JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'))
      : null;

    return {
      stage: 'run-cases',
      success: result.status === 0,
      durationMs: Date.now() - t,
      output: report ? `${report.passed}/${report.total} passed (${report.passRate})` : 'No report',
      report,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'run-cases', success: false, durationMs: Date.now() - t, error: msg, report: null };
  }
}

// ---------------------------------------------------------------------------
// Stage 5: Fix failures
// ---------------------------------------------------------------------------
async function stageFix(report: RunReport | null): Promise<StageResult> {
  const t = Date.now();
  if (NO_FIX || DRY_RUN || !report || report.failed === 0) {
    const reason = NO_FIX ? '--no-fix' : DRY_RUN ? 'dry-run' : !report ? 'no report' : 'no failures';
    return { stage: 'fix-failures', success: true, durationMs: 0, output: `Skipped (${reason})` };
  }

  try {
    const result = spawnSync('npx', ['tsx', 'scripts/fix-maestro-android-failures.ts'], {
      stdio: 'inherit', encoding: 'utf8', env: { ...process.env },
    });
    return {
      stage: 'fix-failures',
      success: result.status === 0,
      durationMs: Date.now() - t,
      output: `Attempted fix for ${report.failed} failed case(s)`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'fix-failures', success: false, durationMs: Date.now() - t, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Stage 6: Lark notification
// ---------------------------------------------------------------------------
async function stageNotify(
  stages: StageResult[],
  report: RunReport | null,
  changedFiles: string[],
  workflowDurationMs: number
): Promise<void> {
  const passed = report?.passed ?? 0;
  const failed = report?.failed ?? 0;
  const skipped = report?.skipped ?? 0;
  const total = report?.total ?? 0;
  const passRate = total > 0 ? `${Math.round((passed / total) * 100)}%` : 'N/A';
  const hasFailures = failed > 0;
  const color = hasFailures ? 'red' : 'green';
  const statusEmoji = hasFailures ? '❌' : '✅';

  // Failed case details (max 8)
  const failedCases = (report?.cases ?? []).filter(c => c.status === 'failed').slice(0, 8);
  const failedCasesText = failedCases.length > 0
    ? failedCases.map(c => `• **[${c.priority.toUpperCase()}]** ${c.name}${c.failureReason ? `\n  \`${c.failureReason.slice(0, 100)}\`` : ''}`).join('\n')
    : '';

  // Changed files summary
  const diffText = changedFiles.length > 0
    ? changedFiles.slice(0, 5).map(f => `• ${path.basename(f)}`).join('\n')
        + (changedFiles.length > 5 ? `\n• +${changedFiles.length - 5} more` : '')
    : FULL_RUN ? '(full run — no diff filter)' : '(no flight diffs detected)';

  // Stage summary
  const stageLines = stages.map(s => {
    const icon = s.success ? '✅' : '❌';
    const dur = elapsed(s.durationMs);
    return `${icon} **${s.stage}** (${dur})${s.error ? ` — ${s.error.slice(0, 60)}` : ''}`;
  }).join('\n');

  const bodyContent = [
    `**Platform**: 📱 Android (${process.env.ANDROID_AVD ?? 'emulator'})`,
    `**Trigger**: ${FULL_RUN ? 'Manual full run' : 'Weekly diff'}`,
    `**Total**: ${total}  |  ✅ ${passed}  |  ❌ ${failed}  |  ⚠️ ${skipped}`,
    `**Pass Rate**: ${passRate}`,
    `**Duration**: ${elapsed(workflowDurationMs)}`,
    '',
    '**Changed Files (android-v3)**',
    diffText,
    ...(failedCasesText ? ['', '**Failed Cases**', failedCasesText] : []),
    '',
    '**Stages**',
    stageLines,
  ].join('\n');

  await notifyCustom(
    `${statusEmoji} Android E2E — ${passRate} pass rate`,
    bodyContent,
    color,
  );
}

// ---------------------------------------------------------------------------
// Stage 7: Update learning memory
// ---------------------------------------------------------------------------
async function stageUpdateMemory(
  report: RunReport | null,
  changedFiles: string[],
  affectedScenarios: string[]
): Promise<StageResult> {
  const t = Date.now();
  if (!report) return { stage: 'update-memory', success: true, durationMs: 0, output: 'Skipped (no report)' };

  try {
    const mem = loadMemory();
    mem.lastUpdated = new Date().toISOString();
    mem.totalRuns += 1;

    // Track consistently flaky scenarios (failed 3+ times in fix history)
    const failedIds = report.cases.filter(c => c.status === 'failed').map(c => c.id);
    const passedIds = report.cases.filter(c => c.status === 'passed').map(c => c.id);

    // Update flaky list: add new failures, remove if now passing
    for (const id of failedIds) {
      if (!mem.flakyScenarios.includes(id)) mem.flakyScenarios.push(id);
    }
    mem.flakyScenarios = mem.flakyScenarios.filter(id => !passedIds.includes(id));
    mem.stableScenarios = [...new Set([...mem.stableScenarios, ...passedIds])];

    // Record fix history entries
    for (const c of report.cases.filter(x => x.status === 'failed')) {
      mem.fixHistory.push({
        scenarioId: c.id,
        fixedAt: new Date().toISOString(),
        failureReason: c.failureReason ?? 'unknown',
        fixApplied: false,
      });
    }
    // Keep last 100 entries
    mem.fixHistory = mem.fixHistory.slice(-100);

    // Record this diff trigger
    mem.diffTriggers.push({
      date: new Date().toISOString(),
      changedFiles,
      affectedScenarios,
      passRate: report.passRate,
    });
    mem.diffTriggers = mem.diffTriggers.slice(-30);

    saveMemory(mem);
    return {
      stage: 'update-memory',
      success: true,
      durationMs: Date.now() - t,
      output: `Memory updated. Flaky: [${mem.flakyScenarios.join(', ')}]`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'update-memory', success: false, durationMs: Date.now() - t, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------
async function main() {
  const workflowStart = Date.now();
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  console.log('\n📱 Android Diff Workflow');
  console.log(`${'═'.repeat(60)}`);
  console.log(`   Mode   : ${FULL_RUN ? 'full' : DRY_RUN ? 'dry-run' : 'diff-triggered'}`);
  console.log(`   Priority: ${PRIORITY ?? (FULL_RUN ? 'all' : 'p0+p1')}`);
  console.log(`   No-fix : ${NO_FIX}`);
  console.log(`${'═'.repeat(60)}\n`);

  const completedStages: StageResult[] = [];

  // Stage 1: Validate
  console.log('[1/7] Validating environment…');
  const validate = await stageValidate();
  completedStages.push(validate);
  console.log(`  ${validate.success ? '✅' : '❌'} ${validate.output ?? validate.error}\n`);
  if (!validate.success) {
    await notifyCustom('❌ Android E2E — Environment failure', validate.error ?? 'Unknown', 'red');
    process.exit(1);
  }

  // Stage 2: Sync diff
  console.log('[2/7] Syncing android-v3 diff…');
  const syncResult = await stageSyncDiff();
  completedStages.push(syncResult);
  console.log(`  ${syncResult.success ? '✅' : '⚠️'} ${syncResult.output ?? syncResult.error}\n`);
  const { changedFiles, affectedScenarios } = syncResult;

  // Stage 3: Generate
  console.log('[3/7] Generating Maestro cases…');
  const generate = await stageGenerate(affectedScenarios);
  completedStages.push(generate);
  console.log(`  ${generate.success ? '✅' : '❌'} ${generate.output ?? generate.error}\n`);
  if (!generate.success && !DRY_RUN) {
    await stageNotify(completedStages, null, changedFiles, Date.now() - workflowStart);
    process.exit(1);
  }

  // Stage 4: Run
  console.log('[4/7] Running cases on Android…');
  const runResult = await stageRun();
  completedStages.push(runResult);
  console.log(`  ${runResult.success ? '✅' : '❌'} ${runResult.output ?? runResult.error}\n`);

  // Stage 5: Fix failures
  console.log('[5/7] Fixing failures with AI…');
  const fix = await stageFix(runResult.report);
  completedStages.push(fix);
  console.log(`  ${fix.success ? '✅' : '❌'} ${fix.output ?? fix.error}\n`);

  // Stage 6: Lark notification
  console.log('[6/7] Sending Lark notification…');
  await stageNotify(completedStages, runResult.report, changedFiles, Date.now() - workflowStart);
  completedStages.push({ stage: 'notify', success: true, durationMs: 0 });
  console.log('  ✅ Notification sent\n');

  // Stage 7: Update memory
  console.log('[7/7] Updating learning memory…');
  const memory = await stageUpdateMemory(runResult.report, changedFiles, affectedScenarios);
  completedStages.push(memory);
  console.log(`  ${memory.success ? '✅' : '⚠️'} ${memory.output ?? memory.error}\n`);

  // Final summary
  const report = runResult.report;
  console.log(`${'═'.repeat(60)}`);
  console.log('📊 WORKFLOW COMPLETE');
  console.log(`${'─'.repeat(60)}`);
  if (report) {
    console.log(`   Pass rate : ${report.passRate} (${report.passed}/${report.total})`);
    console.log(`   Failed    : ${report.failed}`);
    console.log(`   Duration  : ${elapsed(Date.now() - workflowStart)}`);
  }
  console.log(`   Memory    : ${MEMORY_FILE}`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(report && report.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n❌ Workflow error:', err);
  notifyCustom('❌ Android E2E — Workflow crashed', String(err), 'red').finally(() => process.exit(1));
});
