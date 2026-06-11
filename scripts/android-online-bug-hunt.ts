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

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const NO_GENERATE = args.includes('--no-generate');
const CLI_MODEL  = (() => { const i = args.indexOf('--model'); return i !== -1 ? args[i + 1] : null; })();
const PRD_FILE   = (() => { const i = args.indexOf('--prd-file'); return i !== -1 ? args[i + 1] : null; })();

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
// Stage 2: Generate extended test cases
// ---------------------------------------------------------------------------
async function stageGenerate(): Promise<void> {
  if (NO_GENERATE) { console.log('\n[2/5] Skipping generation (--no-generate)'); return; }
  console.log('\n[2/5] Generating extended test cases (42 scenarios)…');
  const t = Date.now();

  const genArgs: string[] = [
    'npx', 'tsx', 'scripts/generate-maestro-android.ts',
    '--extended',
    ...(DRY_RUN ? ['--dry-run'] : []),
    ...(CLI_MODEL ? ['--model', CLI_MODEL] : []),
    ...(PRD_FILE ? ['--prd-file', PRD_FILE] : []),
  ];

  if (DRY_RUN) {
    console.log(`  [dry-run] Would run: ${genArgs.join(' ')}`);
    return;
  }

  const result = spawnSync(genArgs[0], genArgs.slice(1), {
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 600_000,  // 10 min for ~42 scenarios × ~7s each
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
      .map(m => path.resolve(m.file))
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

  await notifyCustom({ title: `${icon} Android Bug Hunt: ${result.passed}/${result.totalScenarios} passed`, content: textContent });
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
  console.log(`   Model    : ${CLI_MODEL ?? 'default'}`);
  if (PRD_FILE) console.log(`   PRD file : ${PRD_FILE}`);
  console.log('');

  let huntResult: BugHuntResult | null = null;

  try {
    await stageValidate();
    await stageGenerate();
    huntResult = await stageRun();
    stagAnalyzeBugs(huntResult);
    await stageNotify(huntResult);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Bug hunt failed: ${msg}`);

    // Still send failure notification
    await notifyCustom({
      title: '❌ Android Bug Hunt FAILED',
      content: `Bug hunt pipeline failed at ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\nError: ${msg}`,
    }).catch(() => {});

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
