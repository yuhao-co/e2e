/**
 * WEEKLY DIFF WORKFLOW - LOCKED ENTRY POINT
 * 
 * This is the ONLY authorized entry point for weekly diff generation and testing.
 * DO NOT modify the core workflow steps.
 * All customization must go through documented configuration only.
 * 
 * Usage:
 *   npx tsx scripts/weekly-diff-workflow.ts [options]
 * 
 * Locked workflow stages (cannot be reordered):
 * 1. Validate environment & dependencies
 * 2. Generate test cases from weekly diff
 * 3. Verify case accumulation
 * 4. Run all accumulated cases
 * 5. Send Lark notification
 * 6. Archive results
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawn } from 'node:child_process';

// Load .env at startup so launchd (which doesn't source .env) gets all vars
(function loadDotEnv() {
  const envFile = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
})();

// ============ MLX SERVER HELPERS ============

const MLX_HOST = process.env.MIDSCENE_MLX_HOST ?? '127.0.0.1';
const MLX_PORT = process.env.MIDSCENE_MLX_PORT ?? '8080';
const MLX_PID_FILE = path.join(process.cwd(), 'logs', 'mlx-server.pid');
let _mlxStartedByUs = false;

function mlxIsUp(): boolean {
  try {
    execSync(`curl -fsS --max-time 2 "http://${MLX_HOST}:${MLX_PORT}/v1/models"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function mlxEnsureRunning(): Promise<void> {
  if (mlxIsUp()) {
    console.log(`[mlx] server already running on :${MLX_PORT}`);
    return;
  }

  console.log('[mlx] starting local MLX server in background...');
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
  const logFile = path.join(process.cwd(), 'logs', 'mlx-server.log');
  const child = spawn(
    'bash',
    [path.join(process.cwd(), 'scripts', 'start-mlx-server.sh'), '--bg'],
    { detached: true, stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')] },
  );
  child.unref();
  _mlxStartedByUs = true;

  // Wait up to 120s for the server to be ready (24 × 5s)
  for (let i = 1; i <= 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (mlxIsUp()) {
      console.log(`[mlx] ✅ server ready (${i}×5s)`);
      return;
    }
    console.log(`[mlx] waiting for server... (${i}/24)`);
  }
  console.warn('[mlx] ❌ server did not become ready in 120s — Mode 3 ai() blocks will be skipped');
  _mlxStartedByUs = false; // Don't try to kill a server that never started properly
}

function mlxStopIfStartedByUs(): void {
  if (!_mlxStartedByUs) return;
  try {
    if (fs.existsSync(MLX_PID_FILE)) {
      const pid = fs.readFileSync(MLX_PID_FILE, 'utf-8').trim();
      process.kill(Number(pid));
      fs.unlinkSync(MLX_PID_FILE);
      console.log(`[mlx] server stopped (pid=${pid})`);
    }
  } catch {
    // Best-effort cleanup
  }
}

// ============ LOCKED WORKFLOW CONFIGURATION ============
// DO NOT MODIFY without explicit documentation updates

const LOCKED_WORKFLOW = {
  version: '1.0-LOCKED',
  lastUpdated: '2026-05-22',
  stages: [
    'validate-environment',
    'generate-cases',
    'verify-accumulation',
    'run-cases',
    'send-notification',
    'archive-results',
  ] as const,
  requiredEnvVars: {
    optional: ['LARK_WEBHOOK_URL'],
  },
  requiredFiles: {
    scripts: [
      'scripts/generate-cases-from-weekly-diff.ts',
      'scripts/run-accumulated-cases.ts',
      'scripts/lib/accumulation-orchestrator.ts',
      'scripts/lib/accumulation-manifest.ts',
      'scripts/lib/enhanced-locator-generator.ts',
      'scripts/lib/lark-notifier.ts',
    ],
    config: [
      'playwright.config.ts',
      'tsconfig.json',
    ],
    optional: [
      'session-data.json', // Optional: used if present
    ],
  },
  constraints: {
    maxCasesPerRun: 100,
    minPassRateForSuccess: 0, // Allow any pass rate (failures not critical)
    maxDurationMs: 3600000, // 1 hour max
  },
};

// ============ STAGE HANDLERS ============

interface StageResult {
  stage: string;
  success: boolean;
  duration: number;
  output?: string;
  error?: string;
}

function runOptionalQualityPlanning(): string | undefined {
  if (process.env.RUN_WEEKLY_QUALITY_PLANNING === '0') {
    return 'Quality planning skipped by RUN_WEEKLY_QUALITY_PLANNING=0';
  }

  const summaryPath = path.join(process.cwd(), 'generated-cases', 'weekly-diff', 'latest', 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    return 'Quality planning skipped (latest summary.json missing)';
  }

  execSync(`npx tsx scripts/plan-weekly-quality-scenarios.ts --summary-file "${summaryPath}"`, {
    stdio: 'inherit',
  });
  return 'Standalone weekly quality plan generated';
}

function runOptionalQualityTriage(): string | undefined {
  if (process.env.RUN_WEEKLY_QUALITY_TRIAGE === '0') {
    return 'Quality triage skipped by RUN_WEEKLY_QUALITY_TRIAGE=0';
  }

  execSync('npx tsx scripts/triage-weekly-failures.ts', { stdio: 'inherit' });
  return 'Standalone weekly failure triage generated';
}

function runOptionalQualityCalibration(): string | undefined {
  if (process.env.RUN_WEEKLY_QUALITY_CALIBRATION === '0') {
    return 'Quality calibration skipped by RUN_WEEKLY_QUALITY_CALIBRATION=0';
  }

  execSync('npx tsx scripts/calibrate-weekly-quality.ts', { stdio: 'inherit' });
  return 'Standalone weekly calibration overlay and reruns completed';
}

function runOptionalQualityPromotion(): string | undefined {
  if (process.env.RUN_WEEKLY_QUALITY_PROMOTION === '0') {
    return 'Quality promotion skipped by RUN_WEEKLY_QUALITY_PROMOTION=0';
  }

  execSync('npx tsx scripts/promote-weekly-learning.ts', { stdio: 'inherit' });
  return 'Standalone weekly learning promotion completed';
}

function runOptionalQualityNotification(): string | undefined {
  if (process.env.RUN_WEEKLY_QUALITY_NOTIFY === '0') {
    return 'Quality notification skipped by RUN_WEEKLY_QUALITY_NOTIFY=0';
  }

  execSync('npx tsx scripts/send-weekly-quality-notification.ts --label "Weekly quality summary"', {
    stdio: 'inherit',
  });
  return 'Standalone weekly quality summary notification sent';
}

/**
 * Stage 1: Validate environment
 */
async function validateEnvironment(): Promise<StageResult> {
  const startTime = Date.now();
  try {
    console.log('[workflow] Stage 1/6: Validating environment...');
    
    // Check required files exist
    for (const file of LOCKED_WORKFLOW.requiredFiles.scripts) {
      const fullPath = path.join(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Required script missing: ${file}`);
      }
    }
    
    for (const file of LOCKED_WORKFLOW.requiredFiles.config) {
      const fullPath = path.join(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Required config missing: ${file}`);
      }
    }
    
    // Check git repo
    const gitCheck = execSync('git rev-parse --git-dir 2>/dev/null || echo "NOT_A_GIT_REPO"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    
    if (gitCheck === 'NOT_A_GIT_REPO') {
      throw new Error('Not in a git repository');
    }
    
    console.log('✅ Environment validation passed');
    
    return {
      stage: 'validate-environment',
      success: true,
      duration: Date.now() - startTime,
      output: 'All required files and git repo present',
    };
  } catch (err: any) {
    return {
      stage: 'validate-environment',
      success: false,
      duration: Date.now() - startTime,
      error: err.message,
    };
  }
}

/**
 * Stage 2: Generate cases
 */
async function generateCases(args: string[]): Promise<StageResult> {
  const startTime = Date.now();
  try {
    console.log('[workflow] Stage 2/6: Generating cases from weekly diff...');
    
    const cmd = `npx tsx scripts/generate-cases-from-weekly-diff.ts ${args.join(' ')}`;
    execSync(cmd, { stdio: 'inherit' });
    let planningOutput = '';
    try {
      planningOutput = runOptionalQualityPlanning() ?? '';
    } catch (err: any) {
      console.warn(`⚠️  Weekly quality planning failed: ${err.message}`);
      planningOutput = 'Weekly quality planning failed (non-blocking)';
    }
    
    console.log('✅ Case generation completed');
    
    return {
      stage: 'generate-cases',
      success: true,
      duration: Date.now() - startTime,
      output: ['Cases generated to generated-cases/weekly-diff/manifest.json', planningOutput]
        .filter(Boolean)
        .join(' | '),
    };
  } catch (err: any) {
    return {
      stage: 'generate-cases',
      success: false,
      duration: Date.now() - startTime,
      error: err.message,
    };
  }
}

/**
 * Stage 3: Verify accumulation
 */
async function verifyAccumulation(): Promise<StageResult> {
  const startTime = Date.now();
  try {
    console.log('[workflow] Stage 3/6: Verifying case accumulation...');
    
    // Try multiple possible locations for manifest
    let manifestPath = path.join(process.cwd(), 'generated-cases', 'weekly-diff', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      manifestPath = path.join(process.cwd(), 'generated-cases', 'manifest.json');
    }
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifest not found - cases were not generated');
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    
    if (!manifest.statistics) {
      throw new Error('Invalid manifest structure');
    }
    
    const stats = manifest.statistics;
    console.log(`  Total cases: ${stats.totalCases}`);
    console.log(`  By domain: ${JSON.stringify(stats.byDomain)}`);
    
    if (stats.totalCases === 0) {
      console.warn('  ⚠️  No cases accumulated yet (expected if no code changes)');
    }
    
    console.log('✅ Accumulation verification passed');
    
    return {
      stage: 'verify-accumulation',
      success: true,
      duration: Date.now() - startTime,
      output: `Total cases: ${stats.totalCases}`,
    };
  } catch (err: any) {
    return {
      stage: 'verify-accumulation',
      success: false,
      duration: Date.now() - startTime,
      error: err.message,
    };
  }
}

/**
 * Stage 4: Run cases
 * 
 * Phase 2: Modified to use layer-based execution (active layer only for weekly workflow)
 * This ensures weekly execution is bounded to ~60 minutes
 */
async function runCases(skipRun?: boolean): Promise<StageResult> {
  const startTime = Date.now();
  try {
    if (skipRun) {
      console.log('[workflow] Stage 4/6: Skipping case execution (--skip-run flag)');
      return {
        stage: 'run-cases',
        success: true,
        duration: Date.now() - startTime,
        output: 'Skipped by --skip-run flag',
      };
    }
    
    console.log('[workflow] Stage 4/6: Running weekly-diff spec files...');

    // Glob all accumulated weekly-diff spec files under tests/web/
    const glob = require('node:fs');
    const weeklySpecs = fs.readdirSync(path.join(process.cwd(), 'tests', 'web'))
      .filter(f =>
        /^traveloka-flight(-booking)?-weekly-diff-\d{8}\.spec\.ts$/.test(f)
      )
      .map(f => path.join('tests', 'web', f));

    if (weeklySpecs.length === 0) {
      console.warn('[workflow] No weekly-diff spec files found under tests/web — skipping Playwright run');
    } else {
      console.log(`[workflow] Found ${weeklySpecs.length} weekly-diff spec(s):`);
      weeklySpecs.forEach(s => console.log(`  - ${s}`));
      const cmd = `CI=1 npx playwright test --reporter=list ${weeklySpecs.join(' ')}`;
      execSync(cmd, { stdio: 'inherit' });
    }
    let triageOutput = '';
    let calibrationOutput = '';
    let promotionOutput = '';
    try {
      triageOutput = runOptionalQualityTriage() ?? '';
    } catch (err: any) {
      console.warn(`⚠️  Weekly quality triage failed: ${err.message}`);
      triageOutput = 'Weekly quality triage failed (non-blocking)';
    }
    try {
      calibrationOutput = runOptionalQualityCalibration() ?? '';
    } catch (err: any) {
      console.warn(`⚠️  Weekly quality calibration failed: ${err.message}`);
      calibrationOutput = 'Weekly quality calibration failed (non-blocking)';
    }
    try {
      promotionOutput = runOptionalQualityPromotion() ?? '';
    } catch (err: any) {
      console.warn(`⚠️  Weekly quality promotion failed: ${err.message}`);
      promotionOutput = 'Weekly quality promotion failed (non-blocking)';
    }
    
    console.log('✅ Case execution completed');
    
    return {
      stage: 'run-cases',
      success: true,
      duration: Date.now() - startTime,
      output: [triageOutput, calibrationOutput, promotionOutput].filter(Boolean).join(' | ') || undefined,
    };
  } catch (err: any) {
    // Don't fail workflow on test failures - just record it
    console.warn(`⚠️  Some tests failed: ${err.message}`);
    let triageOutput = '';
    let calibrationOutput = '';
    let promotionOutput = '';
    try {
      triageOutput = runOptionalQualityTriage() ?? '';
    } catch (triageErr: any) {
      console.warn(`⚠️  Weekly quality triage failed after test failure: ${triageErr.message}`);
      triageOutput = 'Weekly quality triage failed (non-blocking)';
    }
    try {
      calibrationOutput = runOptionalQualityCalibration() ?? '';
    } catch (calibrationErr: any) {
      console.warn(`⚠️  Weekly quality calibration failed after test failure: ${calibrationErr.message}`);
      calibrationOutput = 'Weekly quality calibration failed (non-blocking)';
    }
    try {
      promotionOutput = runOptionalQualityPromotion() ?? '';
    } catch (promotionErr: any) {
      console.warn(`⚠️  Weekly quality promotion failed after test failure: ${promotionErr.message}`);
      promotionOutput = 'Weekly quality promotion failed (non-blocking)';
    }
    
    return {
      stage: 'run-cases',
      success: true, // Intentionally true - test failures don't block workflow
      duration: Date.now() - startTime,
      output: ['Executed with some failures (acceptable)', triageOutput, calibrationOutput, promotionOutput]
        .filter(Boolean)
        .join(' | '),
    };
  }
}

/**
 * Stage 5: Send notification
 */
async function sendNotification(): Promise<StageResult> {
  const startTime = Date.now();
  try {
    console.log('[workflow] Stage 5/6: Sending Lark notification...');
    
    const webhookUrl = process.env.LARK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log('  ℹ️  LARK_WEBHOOK_URL not set - notification skipped');
      return {
        stage: 'send-notification',
        success: true,
        duration: Date.now() - startTime,
        output: 'Notification skipped (no webhook URL)',
      };
    }
    
    const manifestPath = path.join(process.cwd(), 'generated-cases', 'weekly-diff', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const stats = manifest.statistics;
      if (stats) {
        console.log(`  Cases: ${stats.totalCases} total, domains: ${Object.keys(stats.byDomain ?? {}).join(', ')}`);
      }
    }

    let qualityOutput = '';
    try {
      qualityOutput = runOptionalQualityNotification() ?? '';
    } catch (err: any) {
      console.warn(`⚠️  Weekly quality notification failed: ${err.message}`);
      qualityOutput = 'Weekly quality notification failed (non-blocking)';
    }
    
    console.log('✅ Notification sent');
    
    return {
      stage: 'send-notification',
      success: true,
      duration: Date.now() - startTime,
      output: qualityOutput || undefined,
    };
  } catch (err: any) {
    // Don't fail workflow on notification failure
    console.warn(`⚠️  Notification failed: ${err.message}`);
    
    return {
      stage: 'send-notification',
      success: true,
      duration: Date.now() - startTime,
      output: 'Notification failed but workflow continues',
    };
  }
}

/**
 * Stage 6: Archive results
 */
async function archiveResults(): Promise<StageResult> {
  const startTime = Date.now();
  try {
    console.log('[workflow] Stage 6/6: Archiving results...');
    
    const archiveDir = path.join(process.cwd(), 'generated-cases', '_archives');
    fs.mkdirSync(archiveDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
    const manifestPath = path.join(process.cwd(), 'generated-cases', 'weekly-diff', 'manifest.json');
    const archivePath = path.join(archiveDir, `manifest-${timestamp}.json`);

    if (fs.existsSync(manifestPath)) {
      fs.copyFileSync(manifestPath, archivePath);
      console.log(`  Archived to: _archives/manifest-${timestamp}.json`);
    }
    
    console.log('✅ Results archived');
    
    return {
      stage: 'archive-results',
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (err: any) {
    console.warn(`⚠️  Archive failed: ${err.message}`);
    
    return {
      stage: 'archive-results',
      success: true, // Non-critical failure
      duration: Date.now() - startTime,
    };
  }
}

// ============ MAIN WORKFLOW ORCHESTRATOR ============

interface WorkflowOptions {
  sinceDays?: number;
  emitWebSpec?: boolean;
  skipRun?: boolean;
  baseRef?: string;
  repoCacheDir?: string;
  fetch?: boolean;
}

async function executeWorkflow(options: WorkflowOptions = {}): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log('🔒 WEEKLY DIFF WORKFLOW - LOCKED EXECUTION');
  console.log('='.repeat(70));
  console.log(`Version: ${LOCKED_WORKFLOW.version}`);
  console.log(`Stages: ${LOCKED_WORKFLOW.stages.join(' → ')}`);
  console.log('='.repeat(70) + '\n');
  
  const results: StageResult[] = [];
  const startTime = Date.now();
  
  // Stage 1: Validate
  let result = await validateEnvironment();
  results.push(result);
  if (!result.success) {
    console.error('\n❌ Environment validation failed. Workflow aborted.');
    if (result.error) {
      console.error(`Error details: ${result.error}`);
    }
    process.exit(1);
  }
  
  // Stage 2: Generate
  const genArgs = [
    options.baseRef ? '--base-ref' : '',
    options.baseRef ?? '',
    '--since-days', `${options.sinceDays || 7}`,
    options.repoCacheDir ? '--repo-cache-dir' : '',
    options.repoCacheDir ?? '',
    options.emitWebSpec ? '--emit-web-spec' : '',
    options.fetch === false ? '--no-fetch' : '',
  ].filter(Boolean);
  
  result = await generateCases(genArgs);
  results.push(result);
  if (!result.success) {
    console.error('\n⚠️  Case generation failed, continuing with existing cases...');
  }
  
  // Stage 3: Verify
  result = await verifyAccumulation();
  results.push(result);
  if (!result.success) {
    console.error('\n⚠️  Verification failed, attempting to continue...');
  }
  
  // Stage 4: Run — ensure MLX is up before Playwright (needed for Mode 3 ai() blocks)
  if (!options.skipRun) {
    await mlxEnsureRunning();
  }
  result = await runCases(options.skipRun);
  results.push(result);
  
  // Stage 5: Notify
  result = await sendNotification();
  results.push(result);
  
  // Stage 6: Archive
  result = await archiveResults();
  results.push(result);
  
  // ============ SUMMARY ============
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 WORKFLOW EXECUTION SUMMARY');
  console.log('='.repeat(70));
  
  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    const duration = `${(r.duration / 1000).toFixed(1)}s`;
    console.log(`${status} ${r.stage.padEnd(25)} [${duration}]`);
    if (r.output) {
      console.log(`   → ${r.output}`);
    }
    if (r.error) {
      console.log(`   ⚠️  ${r.error}`);
    }
  });
  
  const totalDuration = Date.now() - startTime;
  console.log('-'.repeat(70));
  console.log(`Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  
  const allSuccess = results.every(r => r.success);
  const icon = allSuccess ? '🎉' : '⚠️ ';
  console.log(`${icon} Workflow ${allSuccess ? 'COMPLETED' : 'COMPLETED WITH WARNINGS'}`);
  console.log('='.repeat(70) + '\n');

  mlxStopIfStartedByUs();

  // Results always end with success code (failures are non-critical)
  process.exit(0);
}

// ============ CLI ENTRY POINT ============

function parseArgs(argv: string[]): WorkflowOptions {
  const options: WorkflowOptions = {
    fetch: true,
  };
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    
    if (arg === '--since-days' && next) {
      options.sinceDays = Number(next);
      i++;
    } else if (arg === '--base-ref' && next) {
      options.baseRef = next;
      i++;
    } else if (arg === '--repo-cache-dir' && next) {
      options.repoCacheDir = next;
      i++;
    } else if (arg === '--emit-web-spec') {
      options.emitWebSpec = true;
    } else if (arg === '--no-fetch') {
      options.fetch = false;
    } else if (arg === '--skip-run') {
      options.skipRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
WEEKLY DIFF WORKFLOW - LOCKED ENTRY POINT

Usage:
  npx tsx scripts/weekly-diff-workflow.ts [options]

Options:
  --since-days <n>      Days to look back (default: 7)
  --base-ref <ref>      Base git ref for weekly diff generation
  --repo-cache-dir <d>  Repo cache directory for weekly diff clones
  --emit-web-spec       Write runnable .spec.ts files
  --no-fetch            Skip refreshing the weekly diff repo cache
  --skip-run            Skip test execution
  --help                Show this help

Locked workflow stages (CANNOT be reordered):
  1. Validate environment & dependencies
  2. Generate test cases from weekly diff
  3. Verify case accumulation
  4. Run all accumulated cases
  5. Send Lark notification
  6. Archive results

Example:
  npx tsx scripts/weekly-diff-workflow.ts --since-days 7 --base-ref origin/master --emit-web-spec
      `);
      process.exit(0);
    }
  }
  
  return options;
}

// Execute
const options = parseArgs(process.argv.slice(2));
executeWorkflow(options).catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
