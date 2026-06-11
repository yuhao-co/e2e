import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CapabilityPack,
  WeeklyCapabilityFeedbackEntry,
  WeeklyCapabilityFeedbackOverlay,
  WeeklyFailureTriageItem,
  WeeklyQualityPlan,
} from './weekly-quality-types';

export const DEFAULT_WEEKLY_CAPABILITY_FEEDBACK_PATH = 'generated-cases/weekly-diff/weekly-capability-feedback.json';

function appendRepairHints(item: WeeklyFailureTriageItem): WeeklyCapabilityFeedbackEntry['appendedRepairHints'] {
  switch (item.probableFailureClass) {
    case 'source-contract-drift-likely':
      return [{
        trigger: `triage:${item.runId}`,
        action: 'Refresh selectors, route families, and owning WWW packages before the next generated run.',
      }];
    case 'runtime-workflow-drift-likely':
      return [{
        trigger: `triage:${item.runId}`,
        action: 'Re-check frame scope, overlay boundaries, and handoff sequencing before changing locators.',
      }];
    case 'environment-drift-likely':
      return [{
        trigger: `triage:${item.runId}`,
        action: 'Retry with fresh auth or a cleaner slot before treating this as a product regression.',
      }];
    case 'product-regression-likely':
      return [{
        trigger: `triage:${item.runId}`,
        action: 'Preserve trace evidence and escalate without mutating source contracts automatically.',
      }];
    case 'inconclusive':
    default:
      return [{
        trigger: `triage:${item.runId}`,
        action: 'Observe once more and collect stronger trace or network evidence before adjusting the pack.',
      }];
  }
}

function recommendedActionFor(item: WeeklyFailureTriageItem): WeeklyCapabilityFeedbackEntry['recommendedAction'] {
  switch (item.probableFailureClass) {
    case 'source-contract-drift-likely':
      return 'refresh-contracts-then-rerun';
    case 'runtime-workflow-drift-likely':
      return 'rerun-once';
    case 'environment-drift-likely':
      return 'retry-environment';
    case 'product-regression-likely':
      return 'escalate-with-evidence';
    case 'inconclusive':
    default:
      return 'observe';
  }
}

function rerunPriorityFor(item: WeeklyFailureTriageItem): number {
  switch (item.probableFailureClass) {
    case 'source-contract-drift-likely':
      return 100;
    case 'runtime-workflow-drift-likely':
      return 90;
    case 'environment-drift-likely':
      return 80;
    case 'product-regression-likely':
      return 30;
    case 'inconclusive':
    default:
      return 10;
  }
}

export function buildWeeklyCapabilityFeedbackOverlay(
  triageItems: WeeklyFailureTriageItem[],
  plan: Pick<WeeklyQualityPlan, 'signals'> | null,
  capabilityPacks: CapabilityPack[],
): WeeklyCapabilityFeedbackOverlay {
  const byPack = new Map<string, WeeklyCapabilityFeedbackEntry>();

  for (const item of triageItems) {
    for (const packId of item.probableCapabilityPackIds) {
      const pack = capabilityPacks.find((candidate) => candidate.id === packId);
      if (!pack) {
        continue;
      }

      const existing = byPack.get(packId);
      const observedFailureClasses = new Set(existing?.observedFailureClasses ?? []);
      observedFailureClasses.add(item.probableFailureClass);

      const observedRunIds = new Set(existing?.observedRunIds ?? []);
      observedRunIds.add(item.runId);

      const appendedRepairHints = [...(existing?.appendedRepairHints ?? []), ...appendRepairHints(item)];
      const recommendedAction = recommendedActionFor(item);
      const rerunPriority = Math.max(existing?.rerunPriority ?? 0, rerunPriorityFor(item));

      byPack.set(packId, {
        packId,
        observedFailureClasses: Array.from(observedFailureClasses),
        observedRunIds: Array.from(observedRunIds),
        appendedRepairHints,
        recommendedAction,
        rerunPriority,
        owningBaselines: pack.owningBaselines,
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourcePlanSignals: plan?.signals ?? [],
    entries: Array.from(byPack.values()).sort((left, right) => right.rerunPriority - left.rerunPriority),
  };
}

export function readWeeklyCapabilityFeedbackOverlay(
  filePath = DEFAULT_WEEKLY_CAPABILITY_FEEDBACK_PATH,
): WeeklyCapabilityFeedbackOverlay | null {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as WeeklyCapabilityFeedbackOverlay;
}

export function writeWeeklyCapabilityFeedbackOverlay(
  overlay: WeeklyCapabilityFeedbackOverlay,
  filePath = DEFAULT_WEEKLY_CAPABILITY_FEEDBACK_PATH,
): void {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');
}

export function applyFeedbackToCapabilityPack(
  pack: CapabilityPack,
  overlay: WeeklyCapabilityFeedbackOverlay | null,
): CapabilityPack {
  const entry = overlay?.entries.find((candidate) => candidate.packId === pack.id);
  if (!entry) {
    return pack;
  }

  return {
    ...pack,
    repairHints: [...pack.repairHints, ...entry.appendedRepairHints],
  };
}