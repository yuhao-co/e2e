#!/usr/bin/env tsx
/**
 * Android Maestro Case Runner
 *
 * Runs all generated Maestro Android cases, captures pass/fail per case,
 * takes ADB screenshots on failure, and writes a results report.
 *
 * Usage:
 *   tsx scripts/run-maestro-android.ts
 *   tsx scripts/run-maestro-android.ts --priority p0
 *   tsx scripts/run-maestro-android.ts --case android-results-smoke
 *   tsx scripts/run-maestro-android.ts --all   # include p2 cases
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const PRIORITY_FILTER = (() => {
  const idx = args.indexOf('--priority');
  return idx !== -1 ? args[idx + 1] : null; // e.g. "p0", "p1"
})();
const CASE_FILTER = (() => {
  const idx = args.indexOf('--case');
  return idx !== -1 ? args[idx + 1] : null;
})();
const RUN_ALL_PRIORITIES = args.includes('--all');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const MANIFEST_PATH = path.resolve('maestro/flows/android/manifest.json');
const GENERATED_DIR = path.resolve('maestro/flows/android/generated');
const RESULTS_DIR = path.resolve('test-results/android');
const RESULTS_JSON = path.join(RESULTS_DIR, 'results.json');
const SCREENSHOTS_DIR = path.join(RESULTS_DIR, 'screenshots');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ManifestEntry {
  id: string;
  priority: string;
  category: string;
  name: string;
  file: string;
  generatedAt: string;
  warnings: string[];
}

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
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: string;
  cases: CaseResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isMaestroAvailable(): boolean {
  try {
    execSync('maestro --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isDeviceConnected(): boolean {
  try {
    const out = execSync('adb devices', { encoding: 'utf8' });
    const lines = out.trim().split('\n').slice(1);
    return lines.some((l) => l.includes('\tdevice'));
  } catch {
    return false;
  }
}

/** Returns the first connected ADB device serial (e.g. "emulator-5554") for use with maestro --udid. */
function getDeviceId(): string | null {
  try {
    const out = execSync('adb devices', { encoding: 'utf8' });
    const lines = out.trim().split('\n').slice(1);
    const line = lines.find((l) => l.includes('\tdevice'));
    return line ? line.split('\t')[0].trim() : null;
  } catch {
    return null;
  }
}

function takeScreenshot(caseId: string): string | null {
  const screenshotFile = path.join(SCREENSHOTS_DIR, `${caseId}-${Date.now()}.png`);
  try {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    execSync(`adb exec-out screencap -p > "${screenshotFile}"`, { stdio: 'pipe' });
    return screenshotFile;
  } catch {
    return null;
  }
}

function extractFailureReason(stdout: string, stderr: string): string | null {
  const combined = stdout + '\n' + stderr;
  // Maestro 2.x output patterns
  const patterns = [
    /Parsing Failed[:\s]+(.+)/i,
    /Invalid File Path[:\s]+(.+)/i,
    /Invalid Command[:\s]+(.+)/i,
    /Config Section Required[:\s]+(.+)/i,
    /Invalid value for option[:\s]+(.+)/i,
    /Flow failed[:\s]+(.+)/i,
    /Assertion failed[:\s]+(.+)/i,
    /Element not found[:\s]+(.+)/i,
    /Timeout waiting for[:\s]+(.+)/i,
    /tapOn[:\s]+(.+?) - (not found|timed out)/i,
    /assertVisible[:\s]+(.+?) - (not found|timed out)/i,
    /FAILED[:\s]+(.+)/i,
  ];
  for (const p of patterns) {
    const m = combined.match(p);
    if (m) return m[0].trim().slice(0, 200);
  }
  // Last meaningful line from stderr (skip blank lines and device-selector help text)
  const skipPatterns = [/Device ID to run on explicitly/i, /^Usage:/i, /^$/];
  const lines = stderr.trim().split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && !skipPatterns.some((p) => p.test(trimmed))) {
      return trimmed.slice(0, 200);
    }
  }
  return null;
}

function runMaestroCase(flowFile: string, timeoutMs = 120000): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const deviceId = getDeviceId();
  // --format NOOP = no report file; plain is not valid in Maestro 2.x
  const args = deviceId
    ? ['test', '--udid', deviceId, '--no-ansi', flowFile]
    : ['test', '--no-ansi', flowFile];

  const result = spawnSync(
    'maestro',
    args,
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env },
    }
  );

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ---------------------------------------------------------------------------
// HTML Report Generator
// ---------------------------------------------------------------------------
function generateHtmlReport(report: RunReport): string {
  const runDate = new Date(report.runAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  const durationSec = (report.durationMs / 1000).toFixed(1);
  const passColor = report.failed === 0 ? '#22c55e' : '#ef4444';

  const rows = report.cases.map((c) => {
    const icon = c.status === 'passed' ? '✅' : c.status === 'skipped' ? '⚠️' : '❌';
    const rowClass = c.status === 'passed' ? 'pass' : c.status === 'skipped' ? 'skip' : 'fail';
    const dur = (c.durationMs / 1000).toFixed(1);
    const reason = c.failureReason
      ? `<div class="reason">${c.failureReason.replace(/</g, '&lt;')}</div>`
      : '';
    const shot = c.screenshotPath
      ? `<a href="file://${c.screenshotPath}" target="_blank">📷</a>`
      : '';
    return `<tr class="${rowClass}">
      <td>${icon}</td>
      <td><span class="badge ${c.priority}">${c.priority.toUpperCase()}</span></td>
      <td class="name">${c.id}${reason}</td>
      <td>${dur}s</td>
      <td>${shot}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Android E2E Report — ${runDate}</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; background: #f8fafc; color: #1e293b; }
  .header { background: #1e293b; color: #f8fafc; padding: 24px 32px; }
  .header h1 { margin: 0 0 4px; font-size: 20px; }
  .header p { margin: 0; opacity: .7; font-size: 13px; }
  .summary { display: flex; gap: 16px; padding: 24px 32px; flex-wrap: wrap; }
  .stat { background: #fff; border-radius: 8px; padding: 16px 24px; min-width: 100px;
          box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
  .stat .val { font-size: 32px; font-weight: 700; }
  .stat .lbl { font-size: 12px; opacity: .6; margin-top: 2px; }
  .pass-rate .val { color: ${passColor}; }
  table { width: calc(100% - 64px); margin: 0 32px 32px; border-collapse: collapse;
          background: #fff; border-radius: 8px; overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  th { background: #f1f5f9; text-align: left; padding: 10px 14px; font-size: 12px;
       font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
  td { padding: 10px 14px; font-size: 13px; border-top: 1px solid #f1f5f9; vertical-align: top; }
  tr.fail td { background: #fff5f5; }
  tr.skip td { background: #fffbeb; }
  .name { font-family: monospace; font-size: 12px; }
  .reason { color: #dc2626; font-size: 11px; margin-top: 4px; font-family: monospace; }
  .badge { border-radius: 4px; padding: 1px 6px; font-size: 11px; font-weight: 600; }
  .badge.p0 { background: #fee2e2; color: #dc2626; }
  .badge.p1 { background: #fef3c7; color: #d97706; }
  .badge.p2 { background: #dbeafe; color: #2563eb; }
</style>
</head>
<body>
<div class="header">
  <h1>📱 Android E2E — Flight Search Results</h1>
  <p>Run: ${runDate} · Duration: ${durationSec}s · Source: traveloka/android-v3</p>
</div>
<div class="summary">
  <div class="stat pass-rate"><div class="val">${report.passRate}</div><div class="lbl">Pass Rate</div></div>
  <div class="stat"><div class="val" style="color:#22c55e">${report.passed}</div><div class="lbl">Passed</div></div>
  <div class="stat"><div class="val" style="color:#ef4444">${report.failed}</div><div class="lbl">Failed</div></div>
  <div class="stat"><div class="val" style="color:#f59e0b">${report.skipped}</div><div class="lbl">Skipped</div></div>
  <div class="stat"><div class="val">${report.total}</div><div class="lbl">Total</div></div>
</div>
<table>
  <thead><tr><th></th><th>Priority</th><th>Scenario</th><th>Duration</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n▶️  Android Maestro Case Runner`);
  console.log(`${'─'.repeat(60)}`);

  // Pre-flight checks
  if (!isMaestroAvailable()) {
    console.error('❌ maestro CLI not found. Install: brew install maestro');
    process.exit(1);
  }
  if (!isDeviceConnected()) {
    console.error('❌ No Android device/emulator connected. Run: adb devices');
    process.exit(1);
  }

  // Load manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ Manifest not found: ${MANIFEST_PATH}`);
    console.error('   Run first: npm run maestro:android:generate');
    process.exit(1);
  }
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  // Apply filters
  let cases = manifest.filter((m) => {
    // Skip cases that failed to generate
    if (m.warnings.some((w) => w.startsWith('GENERATION_FAILED'))) return false;
    if (CASE_FILTER) return m.id === CASE_FILTER;
    if (PRIORITY_FILTER) return m.priority === PRIORITY_FILTER;
    if (!RUN_ALL_PRIORITIES) return m.priority === 'p0' || m.priority === 'p1';
    return true;
  });

  if (cases.length === 0) {
    console.error('❌ No cases match the filter. Check --priority or --case args.');
    process.exit(1);
  }

  console.log(`   Cases to run: ${cases.length} (${cases.map((c) => c.id).join(', ')})\n`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const results: CaseResult[] = [];
  const runStart = Date.now();

  for (const entry of cases) {
    const flowFile = path.resolve(entry.file);
    if (!fs.existsSync(flowFile)) {
      console.log(`  ⚠️  [SKIP] ${entry.name} — file not found: ${entry.file}`);
      results.push({
        id: entry.id,
        name: entry.name,
        priority: entry.priority,
        category: entry.category,
        status: 'skipped',
        durationMs: 0,
        exitCode: -1,
        stdout: '',
        stderr: 'File not found',
        screenshotPath: null,
        failureReason: 'YAML file not found',
        runAt: new Date().toISOString(),
      });
      continue;
    }

    process.stdout.write(`  [${entry.priority.toUpperCase()}] ${entry.name} … `);
    const caseStart = Date.now();

    const { exitCode, stdout, stderr } = runMaestroCase(flowFile);
    const durationMs = Date.now() - caseStart;

    let screenshotPath: string | null = null;
    let failureReason: string | null = null;
    let status: CaseResult['status'] = exitCode === 0 ? 'passed' : 'failed';

    if (status === 'failed') {
      screenshotPath = takeScreenshot(entry.id);
      failureReason = extractFailureReason(stdout, stderr);
    }

    results.push({
      id: entry.id,
      name: entry.name,
      priority: entry.priority,
      category: entry.category,
      status,
      durationMs,
      exitCode,
      stdout: stdout.slice(0, 3000), // cap to avoid huge JSON
      stderr: stderr.slice(0, 1000),
      screenshotPath,
      failureReason,
      runAt: new Date().toISOString(),
    });

    const elapsed = (durationMs / 1000).toFixed(1);
    if (status === 'passed') {
      console.log(`✅ PASS (${elapsed}s)`);
    } else {
      console.log(`❌ FAIL (${elapsed}s)`);
      if (failureReason) console.log(`      Reason: ${failureReason}`);
      if (screenshotPath) console.log(`      Screenshot: ${screenshotPath}`);
    }
  }

  // Write results report
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const totalDurationMs = Date.now() - runStart;

  const report: RunReport = {
    runAt: new Date().toISOString(),
    durationMs: totalDurationMs,
    total: results.length,
    passed,
    failed,
    skipped,
    passRate: `${Math.round((passed / (passed + failed || 1)) * 100)}%`,
    cases: results,
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(report, null, 2), 'utf8');

  // HTML report
  const HTML_REPORT = path.join(RESULTS_DIR, 'results.html');
  fs.writeFileSync(HTML_REPORT, generateHtmlReport(report), 'utf8');

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 RESULTS SUMMARY`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Total   : ${report.total}`);
  console.log(`  ✅ Passed : ${passed}`);
  console.log(`  ❌ Failed : ${failed}`);
  console.log(`  ⚠️  Skipped: ${skipped}`);
  console.log(`  Pass rate: ${report.passRate}`);
  console.log(`  Duration : ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Report   : ${RESULTS_JSON}`);
  console.log(`  HTML     : ${HTML_REPORT}`);

  if (failed > 0) {
    console.log(`\n  Failed cases:`);
    results
      .filter((r) => r.status === 'failed')
      .forEach((r) => {
        console.log(`    • [${r.priority}] ${r.name}`);
        if (r.failureReason) console.log(`      ${r.failureReason}`);
      });
    console.log(`\n  ➡  Fix failed cases: npm run maestro:android:fix`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌ Runner error:', err);
  process.exit(1);
});
