import { buildFlightSourceContextFromFiles } from '../../tests/lib/traveloka-flight/source-map';
import { readWeeklyCapabilityFeedbackOverlay } from './weekly-capability-feedback';
import { findCapabilityPackByIdWithFeedback } from './weekly-capability-registry';
import { readWeeklyLearningMemory } from './weekly-learning-memory';
import { findOracleBundlesForConcerns } from './weekly-oracle-registry';
import {
  CapabilityPack,
  WeeklyConcernCluster,
  WeeklyGeneratedCandidateSignal,
  WeeklyQualityPlan,
} from './weekly-quality-types';

export interface WeeklyPlanningInput {
  changedFiles: string[];
  userIntent?: string;
  generatedCandidates?: WeeklyGeneratedCandidateSignal[];
}

function inferConcernClusters(changedFiles: string[], userIntent: string): WeeklyConcernCluster[] {
  const context = buildFlightSourceContextFromFiles(changedFiles, userIntent);
  const clusters = new Set<WeeklyConcernCluster>();

  for (const concern of context.concerns) {
    if (concern === 'search-form') clusters.add('search-form');
    if (concern === 'results-list') clusters.add('results-list');
    if (concern === 'airline-filter') clusters.add('airline-filter');
    if (concern === 'date-flow') clusters.add('date-flow');
    if (concern === 'booking-contact') clusters.add('booking-contact');
  }

  const combinedText = `${changedFiles.join(' ')} ${userIntent}`.toLowerCase();
  if (/(payment|checkout|credit card|paymentpaybutton|payment\/v2|payfrm)/i.test(combinedText)) {
    clusters.add('payment-chain');
    clusters.add('booking-contact');
  }

  if (clusters.size === 0) {
    clusters.add('results-list');
  }

  return Array.from(clusters);
}

function selectCapabilityPacks(clusters: WeeklyConcernCluster[]): CapabilityPack[] {
  const selected = new Map<string, CapabilityPack>();
  const overlay = readWeeklyCapabilityFeedbackOverlay();
  const preferredPackIdsByCluster: Record<WeeklyConcernCluster, string[]> = {
    'search-form': ['flight-search-results'],
    'results-list': ['flight-search-results'],
    'airline-filter': ['flight-filter-airline'],
    'date-flow': ['flight-search-results'],
    'booking-contact': ['flight-booking-contact'],
    'payment-chain': ['flight-booking-payment'],
  };

  for (const cluster of clusters) {
    const preferredPackIds = preferredPackIdsByCluster[cluster] ?? [];
    for (const preferredPackId of preferredPackIds) {
      const pack = findCapabilityPackByIdWithFeedback(preferredPackId);
      if (pack) {
        selected.set(pack.id, pack);
      }
    }
  }

  if (clusters.includes('payment-chain')) {
    const paymentPack = findCapabilityPackByIdWithFeedback('flight-booking-payment');
    if (paymentPack) {
      selected.set(paymentPack.id, paymentPack);
    }
  }

  for (const entry of overlay?.entries ?? []) {
    if (entry.rerunPriority < 80) {
      continue;
    }

    const pack = findCapabilityPackByIdWithFeedback(entry.packId);
    if (pack) {
      selected.set(pack.id, pack);
    }
  }

  return Array.from(selected.values());
}

export function buildWeeklyQualityPlan(input: WeeklyPlanningInput): WeeklyQualityPlan {
  const userIntent = input.userIntent ?? '';
  const clusters = inferConcernClusters(input.changedFiles, userIntent);
  const suggestedPacks = selectCapabilityPacks(clusters);
  const suggestedOracleBundles = findOracleBundlesForConcerns(clusters);
  const learningMemory = readWeeklyLearningMemory();
  const generatedCandidates = input.generatedCandidates ?? [];
  const mainLaneEligibleCount = generatedCandidates.filter((candidate) => candidate.mainLaneEligible).length;
  const gatedCandidateCount = generatedCandidates.filter((candidate) => candidate.mainLaneEligible === false).length;
  const actionContractCount = generatedCandidates.reduce(
    (sum, candidate) => sum + (candidate.actionContractCount ?? 0),
    0,
  );
  const rationale = [
    'This planner is standalone and does not modify existing weekly generator behavior.',
    'PRD or weekly diff should supply the user-intent and changed-file signals; this planner only maps them into reusable capability and oracle layers.',
    `Detected concern clusters: ${clusters.join(', ')}`,
    generatedCandidates.length
      ? `Read ${generatedCandidates.length} generated candidate signals from weekly summary (${mainLaneEligibleCount} main-lane eligible, ${gatedCandidateCount} gated, ${actionContractCount} structured action contracts).`
      : 'No generated candidate signals found in weekly summary.',
    readWeeklyCapabilityFeedbackOverlay()?.entries.length
      ? 'Applied capability feedback overlay from prior weekly triage to keep unstable packs in scope.'
      : 'No prior capability feedback overlay found.',
    (learningMemory?.lessons ?? []).some((lesson) => lesson.status === 'promoted')
      ? 'Applied promoted learning memory from prior successful reruns.'
      : 'No promoted learning memory found.',
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: 'standalone',
    changedFiles: input.changedFiles,
    signals: clusters,
    generatedCandidates,
    suggestedPacks,
    suggestedOracleBundles,
    rationale,
  };
}