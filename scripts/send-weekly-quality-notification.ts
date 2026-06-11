import * as fs from 'node:fs';
import * as path from 'node:path';
import { notifyCustom } from './lib/lark-notifier';

type WeeklyQualityPlanSummary = {
  generatedAt?: string;
  signals?: string[];
  generatedCandidates?: Array<{
    id?: string;
    domain?: string;
    confidence?: 'high' | 'medium' | 'low';
    confidenceScore?: number;
    mainLaneEligible?: boolean;
    actionContractCount?: number;
  }>;
  suggestedPacks?: Array<{ id: string }>;
  suggestedOracleBundles?: Array<{ id: string }>;
};

type WeeklyFailureTriageSummary = {
  generatedAt?: string;
  items?: Array<{
    probableFailureClass?: string;
    probableCapabilityPackIds?: string[];
  }>;
};

type WeeklyCalibrationSummary = {
  generatedAt?: string;
  overlay?: {
    entries?: Array<{
      packId?: string;
      recommendedAction?: string;
    }>;
  };
  reruns?: Array<{
    packId?: string;
    status?: string;
  }>;
  verifiedLessons?: Array<{
    packId?: string;
    lessonKey?: string;
  }>;
};

type WeeklyLearningPromotionSummary = {
  generatedAt?: string;
  promotedLessons?: Array<{
    packId?: string;
    lessonKey?: string;
  }>;
  updatedLessons?: Array<{
    packId?: string;
    status?: string;
  }>;
  threshold?: number;
  writtenFiles?: string[];
};

function parseArgs(argv: string[]) {
  const parsed = {
    label: 'Weekly quality summary',
    planFile: 'generated-cases/weekly-diff/weekly-quality-plan.json',
    triageFile: 'generated-cases/weekly-diff/weekly-failure-triage.json',
    calibrationFile: 'generated-cases/weekly-diff/weekly-quality-calibration.json',
    promotionFile: 'generated-cases/weekly-diff/weekly-learning-promotion.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--label') {
      parsed.label = argv[index + 1] ?? parsed.label;
      index += 1;
      continue;
    }
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
    if (arg === '--calibration-file') {
      parsed.calibrationFile = argv[index + 1] ?? parsed.calibrationFile;
      index += 1;
      continue;
    }
    if (arg === '--promotion-file') {
      parsed.promotionFile = argv[index + 1] ?? parsed.promotionFile;
      index += 1;
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

function summarizePlan(plan: WeeklyQualityPlanSummary | null): string[] {
  if (!plan) {
    return ['- Plan: missing'];
  }

  const generatedCandidates = plan.generatedCandidates ?? [];
  const mainLaneEligibleCount = generatedCandidates.filter((candidate) => candidate.mainLaneEligible).length;
  const gatedCount = generatedCandidates.filter((candidate) => candidate.mainLaneEligible === false).length;
  const averageConfidenceScore = generatedCandidates.length
    ? Math.round(
        generatedCandidates.reduce((sum, candidate) => sum + (candidate.confidenceScore ?? 0), 0) /
          generatedCandidates.length,
      )
    : 0;
  const actionContractCount = generatedCandidates.reduce(
    (sum, candidate) => sum + (candidate.actionContractCount ?? 0),
    0,
  );

  return [
    `- Plan generated: ${plan.generatedAt ?? 'unknown'}`,
    `- Signals: ${(plan.signals ?? []).join(', ') || 'none'}`,
    `- Generated candidates: ${generatedCandidates.length} (main-lane eligible=${mainLaneEligibleCount}, gated=${gatedCount})`,
    `- Candidate confidence score avg: ${generatedCandidates.length ? averageConfidenceScore : 'n/a'}`,
    `- Structured action contracts: ${actionContractCount}`,
    `- Capability packs: ${(plan.suggestedPacks ?? []).map((pack) => pack.id).join(', ') || 'none'}`,
    `- Oracle bundles: ${(plan.suggestedOracleBundles ?? []).map((bundle) => bundle.id).join(', ') || 'none'}`,
  ];
}

function summarizeTriage(triage: WeeklyFailureTriageSummary | null): string[] {
  if (!triage) {
    return ['- Triage: missing'];
  }

  const items = triage.items ?? [];
  const failureClasses = new Map<string, number>();
  const packIds = new Set<string>();
  for (const item of items) {
    const failureClass = item.probableFailureClass ?? 'unknown';
    failureClasses.set(failureClass, (failureClasses.get(failureClass) ?? 0) + 1);
    for (const packId of item.probableCapabilityPackIds ?? []) {
      packIds.add(packId);
    }
  }

  return [
    `- Triage generated: ${triage.generatedAt ?? 'unknown'}`,
    `- Triage items: ${items.length}`,
    `- Failure classes: ${Array.from(failureClasses.entries()).map(([key, count]) => `${key}=${count}`).join(', ') || 'none'}`,
    `- Impacted packs: ${Array.from(packIds).join(', ') || 'none'}`,
  ];
}

function summarizeCalibration(calibration: WeeklyCalibrationSummary | null): string[] {
  if (!calibration) {
    return ['- Calibration: missing'];
  }

  const entries = calibration.overlay?.entries ?? [];
  const reruns = calibration.reruns ?? [];
  return [
    `- Calibration generated: ${calibration.generatedAt ?? 'unknown'}`,
    `- Feedback entries: ${entries.length}`,
    `- Recommended actions: ${entries.map((entry) => `${entry.packId ?? 'unknown'}=${entry.recommendedAction ?? 'unknown'}`).join(', ') || 'none'}`,
    `- Reruns: ${reruns.map((rerun) => `${rerun.packId ?? 'unknown'}=${rerun.status ?? 'unknown'}`).join(', ') || 'none'}`,
    `- Verified lessons: ${(calibration.verifiedLessons ?? []).map((lesson) => `${lesson.packId ?? 'unknown'}`).join(', ') || 'none'}`,
  ];
}

function summarizePromotion(promotion: WeeklyLearningPromotionSummary | null): string[] {
  if (!promotion) {
    return ['- Learning promotion: missing'];
  }

  return [
    `- Learning promotion generated: ${promotion.generatedAt ?? 'unknown'}`,
    `- Promotion threshold: ${promotion.threshold ?? 'unknown'}`,
    `- Promoted lessons: ${(promotion.promotedLessons ?? []).map((lesson) => `${lesson.packId ?? 'unknown'}`).join(', ') || 'none'}`,
    `- Updated lessons: ${(promotion.updatedLessons ?? []).length}`,
    `- Managed writeback files: ${(promotion.writtenFiles ?? []).join(', ') || 'none'}`,
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = readJsonIfExists<WeeklyQualityPlanSummary>(args.planFile);
  const triage = readJsonIfExists<WeeklyFailureTriageSummary>(args.triageFile);
  const calibration = readJsonIfExists<WeeklyCalibrationSummary>(args.calibrationFile);
  const promotion = readJsonIfExists<WeeklyLearningPromotionSummary>(args.promotionFile);

  const content = [
    '**Weekly Quality Enhancement Summary**',
    '',
    ...summarizePlan(plan),
    '',
    ...summarizeTriage(triage),
    '',
    ...summarizeCalibration(calibration),
    '',
    ...summarizePromotion(promotion),
  ].join('\n');

  const hasTriageFailures = (triage?.items?.length ?? 0) > 0;
  await notifyCustom(args.label, content, hasTriageFailures ? 'yellow' : 'green');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});