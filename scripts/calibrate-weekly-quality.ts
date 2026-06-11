import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { WEEKLY_CAPABILITY_PACKS } from './lib/weekly-capability-registry';
import {
  buildWeeklyCapabilityFeedbackOverlay,
  writeWeeklyCapabilityFeedbackOverlay,
} from './lib/weekly-capability-feedback';
import {
  WeeklyFailureTriageItem,
  WeeklyQualityCalibrationResult,
  WeeklyQualityPlan,
  WeeklyQualityRerunAttempt,
  WeeklyVerifiedLearningLesson,
} from './lib/weekly-quality-types';

function parseArgs(argv: string[]) {
  const parsed = {
    planFile: 'generated-cases/weekly-diff/weekly-quality-plan.json',
    triageFile: 'generated-cases/weekly-diff/weekly-failure-triage.json',
    overlayFile: 'generated-cases/weekly-diff/weekly-capability-feedback.json',
    output: 'generated-cases/weekly-diff/weekly-quality-calibration.json',
    maxReruns: 2,
    executeReruns: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan-file') {
      parsed.planFile = argv[index + 1] ?? parsed.planFile;
      index += 1;
      continue;
    }
    if (arg === '--triage-file') {
      parsed.triageFile = argv[index + 1] ?? parsed.triageFile;
      index += 1;
      continue;
    }
    if (arg === '--overlay-file') {
      parsed.overlayFile = argv[index + 1] ?? parsed.overlayFile;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      parsed.output = argv[index + 1] ?? parsed.output;
      index += 1;
      continue;
    }
    if (arg === '--max-reruns') {
      parsed.maxReruns = Number(argv[index + 1] ?? parsed.maxReruns);
      index += 1;
      continue;
    }
    if (arg === '--no-rerun') {
      parsed.executeReruns = false;
    }
  }

  return parsed;
}

function readJsonIfExists<T>(filePath: string): T | null {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as T;
}

function shouldRerun(recommendedAction: string): boolean {
  return recommendedAction === 'refresh-contracts-then-rerun'
    || recommendedAction === 'rerun-once'
    || recommendedAction === 'retry-environment';
}

function runScopedRerun(baselineFiles: string[]): { status: 'passed' | 'failed'; command: string } {
  const command = `npx playwright test ${baselineFiles.map((file) => `"${file}"`).join(' ')} --workers=1`;
  execSync(command, { stdio: 'inherit' });
  return { status: 'passed', command };
}

function buildRerunAttempts(
  overlayEntries: WeeklyQualityCalibrationResult['overlay']['entries'],
  executeReruns: boolean,
  maxReruns: number,
): WeeklyQualityRerunAttempt[] {
  const attempts: WeeklyQualityRerunAttempt[] = [];
  const selectedEntries = overlayEntries
    .filter((entry) => shouldRerun(entry.recommendedAction))
    .slice(0, Math.max(maxReruns, 0));

  for (const entry of selectedEntries) {
    const baselineFiles = entry.owningBaselines.filter((file) => fs.existsSync(path.resolve(process.cwd(), file)));
    if (baselineFiles.length === 0) {
      attempts.push({
        packId: entry.packId,
        baselineFiles: entry.owningBaselines,
        status: 'skipped',
        reason: 'No existing baseline files available for rerun.',
      });
      continue;
    }

    if (!executeReruns) {
      attempts.push({
        packId: entry.packId,
        baselineFiles,
        status: 'skipped',
        reason: 'Rerun execution disabled by --no-rerun.',
      });
      continue;
    }

    try {
      const result = runScopedRerun(baselineFiles);
      attempts.push({
        packId: entry.packId,
        baselineFiles,
        status: result.status,
        command: result.command,
      });
    } catch (error) {
      attempts.push({
        packId: entry.packId,
        baselineFiles,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return attempts;
}

function buildVerifiedLessons(
  overlayEntries: WeeklyQualityCalibrationResult['overlay']['entries'],
  reruns: WeeklyQualityRerunAttempt[],
): WeeklyVerifiedLearningLesson[] {
  const verifiedAt = new Date().toISOString();
  const lessons: WeeklyVerifiedLearningLesson[] = [];

  for (const rerun of reruns) {
    if (rerun.status !== 'passed') {
      continue;
    }

    const overlayEntry = overlayEntries.find((entry) => entry.packId === rerun.packId);
    if (!overlayEntry) {
      continue;
    }

    for (const hint of overlayEntry.appendedRepairHints) {
      lessons.push({
        packId: overlayEntry.packId,
        lessonKey: `${overlayEntry.packId}::${hint.trigger}::${hint.action}`.toLowerCase(),
        trigger: hint.trigger,
        action: hint.action,
        sourceFailureClasses: overlayEntry.observedFailureClasses,
        observedRunIds: overlayEntry.observedRunIds,
        successfulReruns: 1,
        verifiedAt,
      });
    }
  }

  return lessons;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = readJsonIfExists<WeeklyQualityPlan>(args.planFile);
  const triage = readJsonIfExists<{ generatedAt?: string; items?: WeeklyFailureTriageItem[] }>(args.triageFile);
  const items = triage?.items ?? [];

  const overlay = buildWeeklyCapabilityFeedbackOverlay(items, plan, WEEKLY_CAPABILITY_PACKS);
  writeWeeklyCapabilityFeedbackOverlay(overlay, args.overlayFile);

  const reruns = buildRerunAttempts(overlay.entries, args.executeReruns, args.maxReruns);
  const verifiedLessons = buildVerifiedLessons(overlay.entries, reruns);
  const result: WeeklyQualityCalibrationResult = {
    generatedAt: new Date().toISOString(),
    overlay,
    reruns,
    verifiedLessons,
  };

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`[weekly-quality] wrote capability feedback overlay to ${args.overlayFile}`);
  console.log(`[weekly-quality] wrote calibration result to ${path.relative(process.cwd(), outputPath)}`);
  console.log(`[weekly-quality] capability feedback entries: ${overlay.entries.length}`);
  console.log(`[weekly-quality] verified lessons: ${verifiedLessons.length}`);
  for (const attempt of reruns) {
    console.log(`- rerun ${attempt.packId}: ${attempt.status}${attempt.reason ? ` (${attempt.reason})` : ''}`);
  }
}

main();