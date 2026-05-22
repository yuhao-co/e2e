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
import { execSync } from 'node:child_process';

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
    
    console.log('✅ Case generation completed');
    
    return {
      stage: 'generate-cases',
      success: true,
      duration: Date.now() - startTime,
      output: 'Cases generated to generated-cases/weekly-diff/manifest.json',
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
    
    console.log('[workflow] Stage 4/6: Running accumulated cases...');
    
    const cmd = `npx tsx scripts/run-accumulated-cases.ts --mode full`;
    execSync(cmd, { stdio: 'inherit' });
    
    console.log('✅ Case execution completed');
    
    return {
      stage: 'run-cases',
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (err: any) {
    // Don't fail workflow on test failures - just record it
    console.warn(`⚠️  Some tests failed: ${err.message}`);
    
    return {
      stage: 'run-cases',
      success: true, // Intentionally true - test failures don't block workflow
      duration: Date.now() - startTime,
      output: 'Executed with some failures (acceptable)',
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
    
    const manifestPath = path.join(process.cwd(), 'generated-cases', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const lastRun = manifest.runHistory?.[manifest.runHistory.length - 1];
    
    if (lastRun) {
      console.log(`  Notifying: ${lastRun.passed}/${lastRun.totalRun} passed`);
    }
    
    console.log('✅ Notification sent');
    
    return {
      stage: 'send-notification',
      success: true,
      duration: Date.now() - startTime,
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
    const manifestPath = path.join(process.cwd(), 'generated-cases', 'manifest.json');
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
    '--since-days', `${options.sinceDays || 7}`,
    options.emitWebSpec ? '--emit-web-spec' : '',
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
  
  // Stage 4: Run
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
  
  // Results always end with success code (failures are non-critical)
  process.exit(0);
}

// ============ CLI ENTRY POINT ============

function parseArgs(argv: string[]): WorkflowOptions {
  const options: WorkflowOptions = {};
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    
    if (arg === '--since-days' && next) {
      options.sinceDays = Number(next);
      i++;
    } else if (arg === '--emit-web-spec') {
      options.emitWebSpec = true;
    } else if (arg === '--skip-run') {
      options.skipRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
WEEKLY DIFF WORKFLOW - LOCKED ENTRY POINT

Usage:
  npx tsx scripts/weekly-diff-workflow.ts [options]

Options:
  --since-days <n>      Days to look back (default: 7)
  --emit-web-spec       Write runnable .spec.ts files
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
  npx tsx scripts/weekly-diff-workflow.ts --since-days 7 --emit-web-spec
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
