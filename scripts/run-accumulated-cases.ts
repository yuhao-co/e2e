#!/usr/bin/env tsx

/**
 * Run all accumulated test cases with skip-on-blocking logic
 * 
 * Usage:
 *   npx tsx scripts/run-accumulated-cases.ts [--mode incremental|full|all] [--pr-number <num>] [--dont-skip-blocked]
 * 
 * Modes:
 *   - incremental: Run only cases not run in the last execution (default)
 *   - full: Run all active cases from manifest
 *   - all: Run everything, including deprecated cases (warning: may be slow)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { notifyTestResults } from './lib/lark-notifier';

interface ManifestStatistics {
  totalCases: number;
  byDomain: Record<string, number>;
  byStatus: Record<string, number>;
}

interface RunHistory {
  timestamp: string;
  totalRun: number;
  passed: number;
  failed: number;
  failedCases: string[];
}

interface Manifest {
  version: string;
  lastUpdated: string;
  statistics: ManifestStatistics;
  runHistory: RunHistory[];
}

interface CaseRunResult {
  filePath: string;
  passed: boolean;
  skipped: boolean;
  error?: string;
  duration?: number;
}

const DEFAULT_OUTPUT_DIR = 'generated-cases';
const DEFAULT_MANIFEST_PATH = path.join(DEFAULT_OUTPUT_DIR, 'manifest.json');

interface Args {
  mode: 'incremental' | 'full' | 'all';
  prNumber?: number;
  skipBlocked: boolean;
  outputDir: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const result: Args = {
    mode: 'incremental',
    skipBlocked: true,
    outputDir: DEFAULT_OUTPUT_DIR,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--mode' && next) {
      if (['incremental', 'full', 'all'].includes(next)) {
        result.mode = next as 'incremental' | 'full' | 'all';
      }
      i++;
    } else if (arg === '--pr-number' && next) {
      result.prNumber = Number(next);
      i++;
    } else if (arg === '--dont-skip-blocked') {
      result.skipBlocked = false;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--output-dir' && next) {
      result.outputDir = next;
      i++;
    }
  }

  return result;
}

/**
 * Load manifest from disk
 */
function loadManifest(manifestPath: string): Manifest | null {
  try {
    if (!fs.existsSync(manifestPath)) {
      console.log(`[run-cases] No manifest found at ${manifestPath}`);
      return null;
    }
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[run-cases] Failed to load manifest:`, err);
    return null;
  }
}

/**
 * Get list of test cases to run based on mode
 */
function getTestCasesToRun(
  outputDir: string,
  manifest: Manifest | null,
  mode: 'incremental' | 'full' | 'all',
  prNumber?: number,
): string[] {
  const cases: string[] = [];

  if (mode === 'incremental' && manifest && manifest.runHistory.length > 0) {
    // Get cases not run in last execution
    const lastRun = manifest.runHistory[manifest.runHistory.length - 1];
    const lastRunTime = new Date(lastRun.timestamp).getTime();

    // Find directories created after last run
    const dirs = fs.readdirSync(outputDir).filter(d => {
      const fullPath = path.join(outputDir, d);
      if (!fs.statSync(fullPath).isDirectory()) return false;
      if (d.startsWith('pr-') || d.startsWith('snapshot-')) {
        const mtime = fs.statSync(fullPath).mtimeMs;
        return mtime > lastRunTime;
      }
      return false;
    });

    for (const dir of dirs) {
      const specFiles = fs.readdirSync(path.join(outputDir, dir))
        .filter(f => f.endsWith('.spec.ts'))
        .map(f => path.join(outputDir, dir, f));
      cases.push(...specFiles);
    }
  } else if (mode === 'full') {
    // All active cases from manifest
    if (prNumber) {
      // Only PR-specific cases
      const prDir = path.join(outputDir, `pr-${prNumber}`);
      if (fs.existsSync(prDir)) {
        const specFiles = fs.readdirSync(prDir)
          .filter(f => f.endsWith('.spec.ts'))
          .map(f => path.join(prDir, f));
        cases.push(...specFiles);
      }
    } else {
      // All active cases
      const dirs = fs.readdirSync(outputDir).filter(d => {
        const fullPath = path.join(outputDir, d);
        return fs.statSync(fullPath).isDirectory() && 
               (d.startsWith('pr-') || d.startsWith('snapshot-') || d === 'baseline');
      });

      for (const dir of dirs) {
        const specFiles = fs.readdirSync(path.join(outputDir, dir))
          .filter(f => f.endsWith('.spec.ts'))
          .map(f => path.join(outputDir, dir, f));
        cases.push(...specFiles);
      }
    }
  } else if (mode === 'all') {
    // Everything, recursively
    function findAllSpecs(dir: string): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          results.push(...findAllSpecs(fullPath));
        } else if (entry.endsWith('.spec.ts')) {
          results.push(fullPath);
        }
      }

      return results;
    }

    cases.push(...findAllSpecs(outputDir));
  }

  return cases;
}

/**
 * Check if error is due to anti-crawler/blocking
 */
function isBlockingError(error: string): boolean {
  const blockingPatterns = [
    'anti-crawler',
    'datadome',
    'recaptcha',
    '403',
    '429',
    'timeout',
    'blocked',
    'access denied',
  ];

  const lowerError = error.toLowerCase();
  return blockingPatterns.some(pattern => lowerError.includes(pattern));
}

/**
 * Run a single test case
 */
async function runTestCase(specFile: string, skipBlocked: boolean = true): Promise<CaseRunResult> {
  const startTime = Date.now();
  const caseRelPath = path.relative(process.cwd(), specFile);

  try {
    console.log(`  ⏳ Running ${path.basename(specFile)}...`);
    execSync(`npx playwright test ${specFile} --headed --project=chromium`, {
      stdio: 'pipe',
    });

    const duration = Date.now() - startTime;
    console.log(`  ✅ Passed (${duration}ms)`);

    return {
      filePath: specFile,
      passed: true,
      skipped: false,
      duration,
    };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || err.toString();
    const duration = Date.now() - startTime;
    const isBlocked = isBlockingError(stderr);

    if (isBlocked && skipBlocked) {
      console.log(`  ⏭️  Skipped (anti-crawler detected)`);
      return {
        filePath: specFile,
        passed: false,
        skipped: true,
        error: 'anti-crawler',
        duration,
      };
    } else {
      console.log(`  ❌ Failed (${duration}ms)`);
      return {
        filePath: specFile,
        passed: false,
        skipped: false,
        error: stderr.split('\n')[0],
        duration,
      };
    }
  }
}

/**
 * Update manifest with run results
 */
function updateManifestWithResults(
  manifestPath: string,
  results: CaseRunResult[],
): void {
  let manifest = loadManifest(manifestPath) || {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    statistics: { totalCases: 0, byDomain: {}, byStatus: {} },
    runHistory: [],
  };

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const failedCases = results
    .filter(r => !r.passed && !r.skipped)
    .map(r => path.basename(r.filePath));

  manifest.runHistory.push({
    timestamp: new Date().toISOString(),
    totalRun: results.length,
    passed,
    failed,
    failedCases,
  });

  manifest.lastUpdated = new Date().toISOString();

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(args.outputDir, 'manifest.json');

  console.log(`\n[run-cases] Starting test execution`);
  console.log(`[run-cases] Mode: ${args.mode}`);
  console.log(`[run-cases] Skip blocked: ${args.skipBlocked}`);
  console.log(`[run-cases] Output dir: ${args.outputDir}`);

  if (args.dryRun) {
    console.log('[run-cases] DRY RUN MODE - no tests will be executed\n');
  }

  // Load manifest
  const manifest = loadManifest(manifestPath);

  if (!manifest) {
    console.log('[run-cases] ⚠️  No manifest found. Run generate-cases-from-weekly-diff first.');
    process.exit(1);
  }

  // Get cases to run
  const testCases = getTestCasesToRun(args.outputDir, manifest, args.mode, args.prNumber);

  if (testCases.length === 0) {
    console.log('[run-cases] ℹ️  No test cases found for this mode.');
    process.exit(0);
  }

  console.log(`[run-cases] Found ${testCases.length} test case(s) to run\n`);

  if (args.dryRun) {
    testCases.forEach((tc, i) => console.log(`  ${i + 1}. ${path.relative(process.cwd(), tc)}`));
    console.log();
    process.exit(0);
  }

  // Run all cases
  const results: CaseRunResult[] = [];
  for (const testCase of testCases) {
    const result = await runTestCase(testCase, args.skipBlocked);
    results.push(result);
  }

  // Summary
  console.log(`\n[run-cases] Summary:`);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);

  if (failed > 0) {
    console.log(`\n[run-cases] Failed cases:`);
    results
      .filter(r => !r.passed && !r.skipped)
      .forEach(r => {
        console.log(`  - ${path.basename(r.filePath)}: ${r.error}`);
      });
  }

  // Update manifest
  updateManifestWithResults(manifestPath, results);

  console.log(`\n[run-cases] Run history updated in ${manifestPath}\n`);

  // Send Lark notification
  try {
    const startTime = Date.now();
    await notifyTestResults({
      totalRun: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      failedCases: results
        .filter(r => !r.passed && !r.skipped)
        .map(r => path.basename(r.filePath)),
      duration: Date.now() - startTime,
      mode: args.mode,
    });
  } catch (notifyErr) {
    console.warn('[run-cases] Warning: Failed to send Lark notification:', notifyErr);
  }

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[run-cases] Error:', err);
  process.exit(1);
});
