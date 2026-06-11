export type WeeklySurface = 'flight-search' | 'flight-booking' | 'payment-selection';

export type WeeklyConcernCluster =
  | 'search-form'
  | 'results-list'
  | 'airline-filter'
  | 'date-flow'
  | 'booking-contact'
  | 'payment-chain';

export type OracleCheckKind =
  | 'route-pattern'
  | 'element-visible'
  | 'element-actionable'
  | 'network-health'
  | 'console-health'
  | 'restricted-page-absent'
  | 'handoff-detected'
  | 'layout-invariant'
  | 'timing-budget';

export interface CapabilityStep {
  id: string;
  description: string;
  selectors?: string[];
  frameScope?: 'main-page' | 'iframe';
  routePattern?: string;
}

export interface RepairHint {
  trigger: string;
  action: string;
}

export interface CapabilityPack {
  id: string;
  title: string;
  surfaces: WeeklySurface[];
  concernClusters: WeeklyConcernCluster[];
  owningDocs: string[];
  owningBaselines: string[];
  sourcePackages: string[];
  entryStrategy: string;
  routePatterns: string[];
  criticalSelectors: string[];
  steps: CapabilityStep[];
  repairHints: RepairHint[];
}

export interface OracleBundleCheck {
  id: string;
  kind: OracleCheckKind;
  description: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  selector?: string;
  routePattern?: string;
  networkPattern?: string;
  timingBudgetMs?: number;
}

export interface OracleBundle {
  id: string;
  title: string;
  appliesTo: WeeklyConcernCluster[];
  checks: OracleBundleCheck[];
}

export interface WeeklyQualityPlan {
  generatedAt: string;
  mode: 'standalone';
  changedFiles: string[];
  signals: string[];
  generatedCandidates?: WeeklyGeneratedCandidateSignal[];
  suggestedPacks: CapabilityPack[];
  suggestedOracleBundles: OracleBundle[];
  rationale: string[];
}

export interface WeeklyGeneratedCandidateSignal {
  id: string;
  domain: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore?: number;
  mainLaneEligible?: boolean;
  mainLaneGateReason?: string;
  concerns?: string[];
  actionContractCount?: number;
  webSpecFileName?: string;
}

export interface WeeklyFailureArtifact {
  path: string;
  type: 'trace' | 'screenshot' | 'video' | 'error-context' | 'log' | 'unknown';
}

export interface WeeklyFailureTriageItem {
  runId: string;
  artifacts: WeeklyFailureArtifact[];
  probableCapabilityPackIds: string[];
  probableFailureClass:
    | 'product-regression-likely'
    | 'source-contract-drift-likely'
    | 'runtime-workflow-drift-likely'
    | 'environment-drift-likely'
    | 'inconclusive';
  evidence: string[];
  suggestedNextAction: string;
}

export interface WeeklyCapabilityFeedbackEntry {
  packId: string;
  observedFailureClasses: WeeklyFailureTriageItem['probableFailureClass'][];
  observedRunIds: string[];
  appendedRepairHints: RepairHint[];
  recommendedAction: 'rerun-once' | 'refresh-contracts-then-rerun' | 'retry-environment' | 'escalate-with-evidence' | 'observe';
  rerunPriority: number;
  owningBaselines: string[];
  lastUpdated: string;
}

export interface WeeklyCapabilityFeedbackOverlay {
  generatedAt: string;
  sourcePlanSignals: string[];
  entries: WeeklyCapabilityFeedbackEntry[];
}

export interface WeeklyQualityRerunAttempt {
  packId: string;
  baselineFiles: string[];
  command?: string;
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
}

export interface WeeklyVerifiedLearningLesson {
  packId: string;
  lessonKey: string;
  trigger: string;
  action: string;
  sourceFailureClasses: WeeklyFailureTriageItem['probableFailureClass'][];
  observedRunIds: string[];
  successfulReruns: number;
  verifiedAt: string;
}

export interface WeeklyQualityCalibrationResult {
  generatedAt: string;
  overlay: WeeklyCapabilityFeedbackOverlay;
  reruns: WeeklyQualityRerunAttempt[];
  verifiedLessons: WeeklyVerifiedLearningLesson[];
}

export interface WeeklyLearningMemoryLesson {
  packId: string;
  lessonKey: string;
  trigger: string;
  action: string;
  sourceFailureClasses: WeeklyFailureTriageItem['probableFailureClass'][];
  observedRunIds: string[];
  successfulReruns: number;
  firstVerifiedAt: string;
  lastVerifiedAt: string;
  status: 'candidate' | 'promoted';
  promotedAt?: string;
}

export interface WeeklyLearningMemory {
  generatedAt: string;
  lessons: WeeklyLearningMemoryLesson[];
}

export interface WeeklyLearningPromotionResult {
  generatedAt: string;
  promotedLessons: WeeklyLearningMemoryLesson[];
  updatedLessons: WeeklyLearningMemoryLesson[];
  threshold: number;
  writtenFiles?: string[];
}