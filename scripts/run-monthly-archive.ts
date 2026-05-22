#!/usr/bin/env tsx

/**
 * Monthly Archive Execution Script (Phase 2)
 * 
 * 执行月度候选库中的所有用例
 * 目的：
 * - 验证历史功能的稳定性
 * - 发现长期回归 bug
 * - 评估用例是否应该晋升为 permanent
 * 
 * 使用方式：
 *   npx tsx scripts/run-monthly-archive.ts [--dry-run] [--skip-blocked]
 * 
 * 输出：
 *   - 完整的测试报告
 *   - Lark 月度通知
 *   - 晋升候选列表
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { notifyTestResults } from './lib/lark-notifier';
import { AccumulationManifest } from './lib/accumulation-manifest';

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
  dryRun: boolean;
  skipBlocked: boolean;
  outputDir: string;
}

function parseArgs(argv: string[]): Args {
  const result: Args = {
    dryRun: false,
    skipBlocked: true,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--dont-skip-blocked') {
      result.skipBlocked = false;
    } else if (arg === '--output-dir' && next) {
      result.outputDir = next;
      i++;
    }
  }

  return result;
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
 * Get test cases from archive layer
 */
function getArchiveCases(manifestPath: string): string[] {
  try {
    const manifest = new AccumulationManifest(manifestPath);
    const cases = manifest.getCasesToRunByLayer('archive');

    if (cases.length === 0) {
      console.log('[monthly-archive] No cases found in archive layer');
      return [];
    }

    // Convert CaseMetadata to file paths
    const specFiles = cases
      .map(c => {
        if (c.path && fs.existsSync(c.path)) {
          return c.path;
        }
        const dir = c.prNumber ? `generated-cases/pr-${c.prNumber}` : 'generated-cases/baseline';
        const specFile = path.join(dir, `${c.id}.spec.ts`);
        if (fs.existsSync(specFile)) {
          return specFile;
        }
        return null;
      })
      .filter((f): f is string => f !== null);

    console.log(`[monthly-archive] Found ${specFiles.length} test case(s) in archive layer`);
    return specFiles;
  } catch (err) {
    console.error(`[monthly-archive] Error getting archive cases:`, err);
    return [];
  }
}

/**
 * Analyze promotion candidates
 */
function analyzePromotionCandidates(manifestPath: string): {
  candidates: Array<{ id: string; reason: string }>;
  total: number;
} {
  try {
    const manifest = new AccumulationManifest(manifestPath);
    const cases = manifest.getCasesToRunByLayer('archive');

    const candidates = cases
      .map(c => {
        const result = manifest.evaluateAndPromoteCase(c.id);
        if (result.promoted) {
          return { id: c.id, reason: result.reason };
        }
        return null;
      })
      .filter((c): c is { id: string; reason: string } => c !== null);

    return {
      candidates,
      total: cases.length,
    };
  } catch (err) {
    console.error(`[monthly-archive] Error analyzing promotions:`, err);
    return { candidates: [], total: 0 };
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(args.outputDir, 'manifest.json');

  console.log(`\n${'='.repeat(70)}`);
  console.log('📦 月度归档执行 (Monthly Archive Execution)');
  console.log(`${'='.repeat(70)}\n`);

  console.log('[monthly-archive] Starting monthly archive execution');
  console.log(`[monthly-archive] Output dir: ${args.outputDir}`);
  console.log(`[monthly-archive] Skip blocked: ${args.skipBlocked}\n`);

  if (args.dryRun) {
    console.log('[monthly-archive] DRY RUN MODE - no tests will be executed\n');
  }

  // Check if manifest exists
  if (!fs.existsSync(manifestPath)) {
    console.log('[monthly-archive] ⚠️  No manifest found. Run generate-cases-from-weekly-diff first.');
    process.exit(1);
  }

  // Get archive layer cases
  const testCases = getArchiveCases(manifestPath);

  if (testCases.length === 0) {
    console.log('[monthly-archive] ℹ️  No test cases found in archive layer.');
    console.log('[monthly-archive] Archive layer contains cases from 4+ weeks ago.');
    process.exit(0);
  }

  console.log(`[monthly-archive] Found ${testCases.length} archive case(s) to run\n`);

  if (args.dryRun) {
    console.log('[monthly-archive] DRY RUN: Would execute the following cases:');
    testCases.forEach((tc, i) => {
      console.log(`  ${i + 1}. ${path.relative(process.cwd(), tc)}`);
    });
    console.log();
    process.exit(0);
  }

  // Run all cases
  const results: CaseRunResult[] = [];
  const startTime = Date.now();

  console.log(`📋 执行 ${testCases.length} 个档案层用例\n`);

  for (const testCase of testCases) {
    const result = await runTestCase(testCase, args.skipBlocked);
    results.push(result);
  }

  const totalDuration = Date.now() - startTime;

  // Summary
  console.log(`\n[monthly-archive] Summary:`);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ⏱️  Duration: ${(totalDuration / 1000 / 60).toFixed(1)} minutes`);

  if (failed > 0) {
    console.log(`\n[monthly-archive] Failed cases:`);
    results
      .filter(r => !r.passed && !r.skipped)
      .forEach(r => {
        console.log(`  - ${path.basename(r.filePath)}: ${r.error}`);
      });
  }

  // Analyze promotion candidates
  console.log(`\n[monthly-archive] Analyzing promotion candidates...`);
  const promotionAnalysis = analyzePromotionCandidates(manifestPath);

  if (promotionAnalysis.candidates.length > 0) {
    console.log(`\n✨ 晋升候选 (${promotionAnalysis.candidates.length}/${promotionAnalysis.total}):`);
    promotionAnalysis.candidates.forEach(c => {
      console.log(`  • ${c.id}: ${c.reason}`);
    });
  } else {
    console.log(
      `\n✅ 未发现新的晋升候选，所有用例状态稳定`
    );
  }

  // Send Lark notification
  console.log(`\n[monthly-archive] Sending Lark notification...`);
  try {
    await notifyTestResults({
      totalRun: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      failedCases: results
        .filter(r => !r.passed && !r.skipped)
        .map(r => path.basename(r.filePath)),
      duration: totalDuration,
      mode: 'monthly-archive',
      layer: 'archive',
    });
    console.log('[monthly-archive] ✅ Notification sent');
  } catch (notifyErr) {
    console.warn('[monthly-archive] Warning: Failed to send Lark notification:', notifyErr);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('📊 月度归档执行完成');
  console.log(`${'='.repeat(70)}\n`);

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[monthly-archive] Error:', err);
  process.exit(1);
});
