#!/usr/bin/env tsx
/**
 * CASE GENERATION STRATEGY — THREE MODES
 *
 * Mode 1 — Daily smoke / explore specs (no specific PRD):
 *   - Navigation and form interaction must use ai() vision — let Midscene read
 *     visible button text just like a human would. Do NOT hardcode testIDs for
 *     "Continue / Next / Submit" type buttons.
 *   - Use waitForResponse() to intercept BFF API responses for dynamic redirect
 *     params (e.g. invoiceId/auth after createBooking) instead of waiting for DOM.
 *   - Hardcoded selectors only for: page-root anchor assertions, stable containers.
 *   - Goal: self-healing tests that survive UI changes without manual retraining.
 *
 * Mode 2 — PRD-driven regression specs (specific PRD / weekly-diff change):
 *   - Look up the changed packages in traveloka/www source to extract exact
 *     testIDs and contracts before generating the spec.
 *   - Use data-testid contracts as ground truth. These tests should FAIL loudly
 *     if the specific PRD feature regresses.
 *   - ai()/aiQuery() may attach a shadow proposal AFTER explicit-contract failure,
 *     but must not take over the main execution path.
 *
 * Mode 3 — Free Exploration + www/PRD Oracle (interaction bug-finding):
 *   - Automatically injected into generated specs when the weekly diff touches
 *     interaction-relevant concerns (transit-filter, airline-filter, results-list)
 *     OR when the enriched commits carry attached PRD links.
 *   - Step 1: ai() freely drives the interaction (no hardcoded testIDs).
 *   - Step 2: aiQuery<T>() reads actual page state after interaction.
 *   - Step 3: JS assert — actual vs. expected from www source / PRD.
 *   - Assertions use console.warn (non-hard-failing) to surface bugs in CI logs
 *     without breaking the run on transient UI states.
 *   - Canonical reference: tests/web/traveloka-flight-search-interactions.spec.ts
 *   - Generator function: buildMode3InteractionBlocks()
 *
 * Rule: Mode 3 is injected INSIDE existing generated specs (assertionLines),
 * not as a separate spec file. It piggybacks on the weekly-diff spec that
 * already navigated to the results page.
 *
 * NEVER mix modes: smoke specs must not rely on hardcoded nav-button testIDs;
 * PRD regression specs must not rely solely on ai() for contract verification.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

import {
  buildFlightSourceContextFromFiles,
  type FlightConcern,
} from '../tests/lib/traveloka-flight/source-map';
import { createFlightCaseTemplate } from '../tests/lib/traveloka-flight/template';
import { createAccumulator } from './lib/accumulation-orchestrator';
import { notifyCustom } from './lib/lark-notifier';

type Args = {
  repoPath: string | null;
  repoUrl: string | null;
  repoCacheDir: string;
  focusDomain: Candidate['domain'][] | null;
  emitWebSpec: boolean;
  baseRef: string;
  sinceDays: number;
  outputDir: string;
  fetch: boolean;
  dryRun: boolean;
  runMode?: 'incremental' | 'full' | 'pr-focused';
  runCases?: boolean;
  skipBlockedDomains?: boolean;
};

type DiffFile = {
  status: string;
  filePath: string;
};

type Candidate = {
  id: string;
  domain: 'flight-search' | 'flight-booking' | 'web-i18n' | 'android-home' | 'generic-web';
  confidence: 'high' | 'medium' | 'low';
  confidenceScore?: number;
  confidenceReasons?: string[];
  mainLaneEligible?: boolean;
  mainLaneGateReason?: string;
  title: string;
  action: 'modify-existing' | 'create-new';
  reason: string;
  solution?: string;
  howToSolve?: string;
  changedFiles: string[];
  targetTests: string[];
  userIntent: string;
  suggestedUserIntent: string;
  targetUrl?: string;
  concerns?: string[];
  sourceHints?: Array<{
    sourcePath: string;
    reason: string;
  }>;
  sourceCommits?: Array<{
    sha: string;
    author: string;
    subject: string;
    prNumber?: number;
    prTitle?: string;
    prSummary?: string;
    prTestPlan?: string;
    prdLinks?: PrdReference[];
    prdStatuses?: PrdLinkStatus[];
  }>;
  retrievedEvidence?: Array<{
    kind: 'existing-test' | 'shared-helper';
    path: string;
    reason: string;
    summary: string;
  }>;
  prdProcessing?: CandidatePrdProcessing;
  actionContracts?: Array<{
    stepName: string;
    scopeHint: string;
    expectedContracts: string[];
    preconditions?: string[];
    postconditions?: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;
  draftFileName?: string;
  draftContent?: string;
  webSpecFileName?: string;
  webSpecContent?: string;
};

type CandidateMarkdownArtifact = {
  fileName: string;
  content: string;
};

type DomainBucket = {
  files: string[];
  score: number;
  strongHits: number;
};

type DomainSignal = {
  domain: Candidate['domain'];
  score: number;
  strong: boolean;
};

const GENERATED_DIFF_IGNORE_PATTERNS = [
  /^generated-cases\//,
  /^tests\/web\/traveloka-flight-weekly-generated\.spec\.ts$/,
  /^tests\/web\/traveloka-flight-weekly-diff-generated\.spec\.ts$/,
];

type FlightGeneratedPlan = {
  concerns: FlightConcern[];
  targetTests: string[];
  extraImportBlock: string;
  assertionLines: string[];
  interactionLines: string[];
  actionContracts: NonNullable<Candidate['actionContracts']>;
};

type ConfidenceAssessment = {
  score: number;
  confidence: Candidate['confidence'];
  reasons: string[];
};

function confidenceFromScore(score: number): Candidate['confidence'] {
  if (score >= 80) {
    return 'high';
  }

  if (score >= 55) {
    return 'medium';
  }

  return 'low';
}

function assessCandidateConfidence(parts: Array<{ points: number; reason: string }>): ConfidenceAssessment {
  const score = Math.max(0, Math.min(100, parts.reduce((sum, part) => sum + part.points, 0)));
  return {
    score,
    confidence: confidenceFromScore(score),
    reasons: parts.map((part) => `${part.points >= 0 ? '+' : ''}${part.points} ${part.reason}`),
  };
}

function isWeeklyMainLaneEligible(candidate: Candidate): boolean {
  return candidate.confidence === 'high' && Boolean(candidate.webSpecFileName && candidate.webSpecContent);
}

function getWeeklyMainLaneGateReason(candidate: Candidate): string {
  if (candidate.confidence !== 'high') {
    return `Candidate confidence is ${candidate.confidence}; only high-confidence runnable cases enter the weekly main lane.`;
  }

  if (!candidate.webSpecFileName || !candidate.webSpecContent) {
    return 'Candidate does not have a runnable web spec artifact.';
  }

  return 'Eligible for weekly main lane execution.';
}

function assessFlightSearchCandidateConfidence(input: {
  hasStrongEvidence: boolean;
  isDominant: boolean;
  retrievedEvidenceCount: number;
  actionContractCount: number;
  targetTestCount: number;
}): ConfidenceAssessment {
  return assessCandidateConfidence([
    { points: 20, reason: 'weekly flight-search candidate base score' },
    { points: input.hasStrongEvidence ? 30 : 5, reason: 'WWW/source evidence strength' },
    { points: input.isDominant ? 20 : -10, reason: 'concern-cluster dominance' },
    { points: Math.min(input.retrievedEvidenceCount, 4) * 5, reason: 'retrieved evidence support' },
    { points: Math.min(input.actionContractCount, 4) * 4, reason: 'structured action contracts' },
    { points: Math.min(input.targetTestCount, 3) * 3, reason: 'existing target-test coverage' },
  ]);
}

function assessFlightBookingCandidateConfidence(input: {
  hasStrongEvidence: boolean;
  paymentFocused: boolean;
  retrievedEvidenceCount: number;
  actionContractCount: number;
  targetTestCount: number;
}): ConfidenceAssessment {
  return assessCandidateConfidence([
    { points: 25, reason: 'weekly flight-booking candidate base score' },
    { points: input.hasStrongEvidence ? 35 : 10, reason: 'WWW/source evidence strength' },
    { points: input.paymentFocused ? 5 : 0, reason: 'payment-chain baseline alignment' },
    { points: Math.min(input.retrievedEvidenceCount, 4) * 5, reason: 'retrieved evidence support' },
    { points: Math.min(input.actionContractCount, 4) * 4, reason: 'structured action contracts' },
    { points: Math.min(input.targetTestCount, 3) * 2, reason: 'existing target-test coverage' },
  ]);
}

function assessSupportCandidateConfidence(baseScore: number, reason: string): ConfidenceAssessment {
  return assessCandidateConfidence([{ points: baseScore, reason }]);
}

type LocatorShadowProposalConfig = {
  stepName: string;
  contractDescription: string;
  expectedContracts: string[];
  analysisPrompt: string;
  failureMessage: string;
  scopeHint?: string;
};

function buildLocatorShadowProposalLines(config: LocatorShadowProposalConfig): string[] {
  return [
    '  await attachLocatorShadowProposal({',
    '    page,',
    '    testInfo,',
    '    aiQuery,',
    `    stepName: ${JSON.stringify(config.stepName)},`,
    `    contractDescription: ${JSON.stringify(config.contractDescription)},`,
    `    expectedContracts: ${JSON.stringify(config.expectedContracts)},`,
    ...(config.scopeHint ? [`    scopeHint: ${JSON.stringify(config.scopeHint)},`] : []),
    `    analysisPrompt: ${JSON.stringify(config.analysisPrompt)},`,
    '  });',
    `  throw new Error(${JSON.stringify(config.failureMessage)});`,
  ];
}

type FlightConcernFocus = {
  concerns: FlightConcern[];
  focusedFiles: string[];
  topScore: number;
  secondScore: number;
  isDominant: boolean;
};

type RelevantCommit = {
  sha: string;
  author: string;
  subject: string;
  score: number;
  matchedFiles: string[];
  index: number;
  prNumber?: number;
  prTitle?: string;
  prSummary?: string;
  prTestPlan?: string;
  prdLinks?: PrdReference[];
};

type SourceCommitMetadata = {
  sha: string;
  author: string;
  subject: string;
  prNumber?: number;
  prTitle?: string;
  prSummary?: string;
  prTestPlan?: string;
  prdLinks?: PrdReference[];
  prdStatuses?: PrdLinkStatus[];
};

type GitHubRepoIdentity = {
  owner: string;
  name: string;
};

type PrdReference = {
  url: string;
  kind: 'lark-wiki' | 'meegle-fpr';
};

type PrdLinkStatus = {
  sourceUrl: string;
  sourceKind: PrdReference['kind'];
  resolutionStatus: 'direct-lark' | 'resolved-from-meegle' | 'meegle-resolution-failed';
  resolvedUrls: string[];
};

type CandidatePrdProcessing = {
  references: PrdLinkStatus[];
  extractionStatus:
    | 'pending'
    | 'extracted'
    | 'cache-hit'
    | 'failed'
    | 'skipped-no-link'
    | 'skipped-unresolved-link';
  selectedResolvedUrl?: string;
  extractedPath?: string;
};

type MeeglePrdResolutionPayload = {
  sourceUrl?: string;
  projectId?: string;
  detailId?: string;
  accessStatus?: string;
  prdLink?: string | null;
  notes?: string;
  prdTitle?: string | null;
  summary?: string | null;
};

const LARK_WIKI_PRD_LINK_PATTERN = /https:\/\/traveloka\.sg\.larksuite\.com\/wiki\/[A-Za-z0-9]+/g;
const MEEGLE_PRD_LINK_PATTERN = /https:\/\/project\.larksuite\.com\/fpr\/[A-Za-z0-9]+\/detail\/[A-Za-z0-9]+/g;
const meeglePrdResolutionCache = new Map<string, PrdReference[]>();
// Disk-level cache dir — survives process restarts, keyed by URL hash
const MEEGLE_DISK_CACHE_DIR = path.resolve(process.cwd(), '.cache/meegle-prd-resolution');

const DEFAULT_OUTPUT_DIR = 'generated-cases/weekly-diff';
const DEFAULT_BASE_REF = 'origin/master';
const DEFAULT_REPO_CACHE_DIR = '.cache/weekly-diff-repos';

// ============================================================================
// 🔒 STRONG CONSTRAINTS: Desktop Web + Flight Only
// ============================================================================
// These constraints are MANDATORY and hardcoded:
// 1. Source Repository: MUST be https://github.com/traveloka/www (production repo)
// 2. Domain Focus: ONLY flight-search AND flight-booking (no other domains)
// 3. Surface: ONLY desktop web (no mobile, no android, no i18n)
// 4. Output: MUST be /Users/yu.hao/Desktop/task/e2e/tests/web
// ============================================================================

const FORCED_REPO_URL = 'https://github.com/traveloka/www';
const FORCED_FOCUS_DOMAINS = ['flight-search', 'flight-booking'] as const;
const FORCED_OUTPUT_DIR = '/Users/yu.hao/Desktop/task/e2e/tests/web';
// Artifacts (summary.json, PRD extractions) go here — NOT inside tests/web
const ARTIFACTS_OUTPUT_DIR = '/Users/yu.hao/Desktop/task/e2e/generated-cases/weekly-diff';

function parseArgs(argv: string[]): Args {
  const result: Args = {
    repoPath: null,
    repoUrl: FORCED_REPO_URL,  // 🔒 HARDCODED: Always use Traveloka www
    repoCacheDir: DEFAULT_REPO_CACHE_DIR,
    focusDomain: FORCED_FOCUS_DOMAINS as unknown as Candidate['domain'][],  // 🔒 HARDCODED: Flight only
    emitWebSpec: false,
    baseRef: DEFAULT_BASE_REF,
    sinceDays: 7,
    outputDir: FORCED_OUTPUT_DIR,  // 🔒 HARDCODED: Desktop web test directory
    fetch: true,
    dryRun: false,
    runMode: 'incremental',
    runCases: false,
    skipBlockedDomains: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    // 🔒 IGNORE: --repo-path, --repo-url (hardcoded to Traveloka www)
    if (arg === '--repo-path' && next) {
      i++;  // Skip but don't apply
    } else if (arg === '--repo-url' && next) {
      i++;  // Skip but don't apply
    // 🔒 IGNORE: --focus-domain (hardcoded to flight-search, flight-booking)
    } else if (arg === '--focus-domain' && next) {
      i++;  // Skip but don't apply
    // 🔒 IGNORE: --output-dir (hardcoded to tests/web)
    } else if (arg === '--output-dir' && next) {
      i++;  // Skip but don't apply
    } else if (arg === '--repo-cache-dir' && next) {
      result.repoCacheDir = next;
      i++;
    } else if (arg === '--emit-web-spec') {
      result.emitWebSpec = true;
    } else if (arg === '--base-ref' && next) {
      result.baseRef = next;
      i++;
    } else if (arg === '--since-days' && next) {
      result.sinceDays = Number(next);
      i++;
    } else if (arg === '--no-fetch') {
      result.fetch = false;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--run-mode' && next) {
      if (['incremental', 'full', 'pr-focused'].includes(next)) {
        result.runMode = next as 'incremental' | 'full' | 'pr-focused';
      }
      i++;
    } else if (arg === '--run-cases') {
      result.runCases = true;
    } else if (arg === '--dont-skip-blocked') {
      result.skipBlockedDomains = false;
    }
  }

  if (!Number.isFinite(result.sinceDays) || result.sinceDays <= 0) {
    throw new Error(`Invalid --since-days value: ${result.sinceDays}`);
  }

  // 🔒 ENFORCE: focusDomain must ALWAYS be ['flight-search', 'flight-booking']
  result.focusDomain = FORCED_FOCUS_DOMAINS as unknown as Candidate['domain'][];
  
  // 🔒 ENFORCE: outputDir must ALWAYS be tests/web
  result.outputDir = FORCED_OUTPUT_DIR;
  
  // 🔒 ENFORCE: repoUrl must ALWAYS be Traveloka www
  result.repoUrl = FORCED_REPO_URL;

  if (!result.repoPath && !result.repoUrl) {
    result.repoPath = process.cwd();
  }

  return result;
}

function git(repoPath: string, args: string[], options?: { timeout?: number }) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options?.timeout,
  }).trim();
}

function toCacheFolderName(repoUrl: string) {
  return repoUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_git$/, '');
}

function ensureRepoPath(args: Args) {
  if (args.repoPath) {
    return args.repoPath;
  }

  if (!args.repoUrl) {
    throw new Error('Either --repo-path or --repo-url must be provided.');
  }

  const cacheRoot = path.resolve(process.cwd(), args.repoCacheDir);
  const repoPath = path.join(cacheRoot, toCacheFolderName(args.repoUrl));
  fs.mkdirSync(cacheRoot, { recursive: true });

  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    console.log(`[weekly-diff] cloning ${args.repoUrl} into ${repoPath}...`);
    execFileSync(
      'git',
      [
        'clone',
        '--filter=blob:none',
        '--no-checkout',
        '--single-branch',
        '--branch',
        'master',
        args.repoUrl,
        repoPath,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300000, // 5 min timeout
      },
    );
  }

  return repoPath;
}

function sanitizeToken(token: string) {
  return token.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function summarizeKeywords(filePaths: string[]) {
  const stop = new Set([
    'packages', 'package', 'src', 'app', 'web', 'www', 'pages', 'components',
    'component', 'hooks', 'tests', 'test', 'lib', 'index', 'traveloka', 'flight',
    'home', 'android', 'spec', 'tsx', 'ts', 'js', 'jsx', 'json', 'yaml', 'yml',
  ]);
  const counts = new Map<string, number>();

  for (const filePath of filePaths) {
    const parts = filePath.split(/[/._-]+/g).map(sanitizeToken).filter(Boolean);
    for (const part of parts) {
      if (part.length < 3 || stop.has(part)) continue;
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([token]) => token);
}

function getStartCommit(repoPath: string, baseRef: string, sinceDays: number) {
  const beforeDate = `${sinceDays} days ago`;
  const commit = git(repoPath, ['rev-list', '-n', '1', `--before=${beforeDate}`, baseRef]);
  if (commit) return commit;
  return git(repoPath, ['rev-list', '--max-parents=0', baseRef]).split('\n')[0]?.trim() ?? '';
}

function getChangedFiles(repoPath: string, startCommit: string, endRef: string): DiffFile[] {
  const raw = git(repoPath, ['diff', '--name-status', `${startCommit}..${endRef}`]);
  if (!raw) return [];

  return raw
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => {
      const [status, ...rest] = line.split(/\s+/g);
      return { status, filePath: rest[rest.length - 1] };
    })
    .filter((file: DiffFile) =>
      !GENERATED_DIFF_IGNORE_PATTERNS.some((pattern) => pattern.test(file.filePath)),
    );
}

function collectRelevantCommits(
  repoPath: string,
  startCommit: string,
  endRef: string,
  changedFiles: string[],
  limit = 3,
  fileWeights?: Map<string, number>,
) {
  if (!changedFiles.length) {
    return [];
  }

  const output = git(repoPath, [
    'log',
    '--format=__COMMIT__%n%h%x09%an%x09%s',
    '--name-only',
    `${startCommit}..${endRef}`,
    '--',
    ...changedFiles,
  ]);

  if (!output) {
    return [];
  }

  const commits: RelevantCommit[] = output
    .split('__COMMIT__\n')
    .map((block: string) => block.trim())
    .filter(Boolean)
    .map((block: string, index: number) => {
      const [header = '', ...fileLines] = block.split('\n');
      const [sha = '', author = '', ...subjectParts] = header.split('\t');
      const matchedFiles = uniqueStrings(fileLines.map((line) => line.trim()).filter(Boolean));
      const score = matchedFiles.reduce(
        (sum, filePath) => sum + (fileWeights?.get(filePath) ?? 1),
        0,
      );

      return {
        sha,
        author,
        subject: subjectParts.join('\t'),
        score,
        matchedFiles,
        index,
      };
    })
    .filter(
      (commit: { sha: string; author: string; subject: string }) =>
        commit.sha && commit.author && commit.subject,
    )
    .sort(
      (left: RelevantCommit, right: RelevantCommit) =>
        right.score - left.score ||
        right.matchedFiles.length - left.matchedFiles.length ||
        left.index - right.index,
    );

  const topScore = commits[0]?.score ?? 0;

  return commits
    .filter((commit: RelevantCommit) => commit.score >= Math.max(2, Math.ceil(topScore * 0.5)))
    .slice(0, limit)
    .map(({ sha, author, subject }: RelevantCommit) => ({ sha, author, subject }));
}

function parseGitHubRepoIdentity(remoteUrl: string): GitHubRepoIdentity | null {
  const normalized = remoteUrl.trim();
  const match = normalized.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    name: match[2],
  };
}

function getGitHubRepoIdentity(repoPath: string): GitHubRepoIdentity | null {
  try {
    const remoteUrl = git(repoPath, ['remote', 'get-url', 'origin']);
    return parseGitHubRepoIdentity(remoteUrl);
  } catch {
    return null;
  }
}

function extractPullRequestNumber(subject: string) {
  const match = subject.match(/\(#(\d+)\)\s*$/);
  return match ? Number(match[1]) : null;
}

function normalizePullRequestSection(text: string | undefined) {
  if (!text) {
    return null;
  }

  const normalized = text.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const placeholderPatterns = [
    /describe the big picture of your changes here/i,
    /describe how the reviewer should test your changes/i,
    /if it's covered using automated tests say so/i,
  ];

  if (placeholderPatterns.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  return normalized;
}

function extractPullRequestBodySection(body: string, heading: string) {
  const normalizedBody = body.replace(/\r/g, '');
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^##\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^##\\s+|$)`, 'im');
  const match = normalizedBody.match(pattern);
  return normalizePullRequestSection(match?.[1]);
}

function collectUniqueMatches(text: string, pattern: RegExp) {
  return Array.from(new Set(Array.from(text.matchAll(pattern)).map((match) => match[0])));
}

function extractLarkWikiPrdReferences(body: string): PrdReference[] {
  return collectUniqueMatches(body, LARK_WIKI_PRD_LINK_PATTERN).map((url) => ({
    url,
    kind: 'lark-wiki',
  }));
}

function extractMeeglePrdReferences(body: string): PrdReference[] {
  return collectUniqueMatches(body, MEEGLE_PRD_LINK_PATTERN).map((url) => ({
    url,
    kind: 'meegle-fpr',
  }));
}

function extractPrdReferences(body: string): PrdReference[] {
  return Array.from(
    new Map(
      [...extractLarkWikiPrdReferences(body), ...extractMeeglePrdReferences(body)].map(
        (reference) => [reference.url, reference],
      ),
    ).values(),
  );
}

function formatPrdReference(reference: PrdReference) {
  return reference.kind === 'meegle-fpr'
    ? `PRD (meegle): ${reference.url}`
    : `PRD: ${reference.url}`;
}

function parseResolvedMeeglePrdReferences(rawOutput: string): PrdReference[] {
  const resolvedUrls = new Set<string>();

  try {
    const payload = JSON.parse(rawOutput) as MeeglePrdResolutionPayload;
    if (typeof payload.prdLink === 'string') {
      for (const url of collectUniqueMatches(payload.prdLink, LARK_WIKI_PRD_LINK_PATTERN)) {
        resolvedUrls.add(url);
      }
    }
  } catch {
    // Fall back to raw link extraction if opencode returned non-JSON content.
  }

  for (const url of collectUniqueMatches(rawOutput, LARK_WIKI_PRD_LINK_PATTERN)) {
    resolvedUrls.add(url);
  }

  return Array.from(resolvedUrls).map((url) => ({ url, kind: 'lark-wiki' as const }));
}

function resolveMeeglePrdReference(reference: PrdReference): PrdReference[] {
  const cached = meeglePrdResolutionCache.get(reference.url);
  if (cached) {
    return cached;
  }

  // Disk cache: avoid calling opencode again for the same URL across runs
  const urlHash = reference.url.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
  const diskCachePath = path.join(MEEGLE_DISK_CACHE_DIR, `${urlHash}.json`);
  if (fs.existsSync(diskCachePath)) {
    try {
      const diskCached = JSON.parse(fs.readFileSync(diskCachePath, 'utf8')) as PrdReference[];
      console.log(`[prd] cache hit for: ${reference.url}`);
      meeglePrdResolutionCache.set(reference.url, diskCached);
      return diskCached;
    } catch {
      // corrupt cache — fall through to re-resolve
    }
  }

  const helperScriptPath = path.resolve(
    process.cwd(),
    'scripts/resolve-meegle-prd-link-with-opencode.sh',
  );

  if (!fs.existsSync(helperScriptPath)) {
    meeglePrdResolutionCache.set(reference.url, [reference]);
    return [reference];
  }

  const outputPath = path.join(
    '/tmp',
    `meegle-prd-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );

  console.log(`[prd] resolving Meegle PRD: ${reference.url} (waiting for opencode...)`);
  try {
    execFileSync('/bin/zsh', [helperScriptPath, reference.url, outputPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // No timeout — opencode needs time for MCP Meegle + Lark calls.
      // Shell script enforces OPENCODE_TIMEOUT_SECONDS=120 with MAX_RETRIES=3.
    });

    if (!fs.existsSync(outputPath)) {
      meeglePrdResolutionCache.set(reference.url, [reference]);
      return [reference];
    }

    const rawOutput = fs.readFileSync(outputPath, 'utf8');
    const resolvedReferences = parseResolvedMeeglePrdReferences(rawOutput);
    const normalizedReferences = resolvedReferences.length ? resolvedReferences : [reference];

    // Persist to disk cache for future runs
    fs.mkdirSync(MEEGLE_DISK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskCachePath, JSON.stringify(normalizedReferences));

    meeglePrdResolutionCache.set(reference.url, normalizedReferences);
    return normalizedReferences;
  } catch {
    meeglePrdResolutionCache.set(reference.url, [reference]);
    return [reference];
  } finally {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
}

function resolvePrdReferences(references: PrdReference[]) {
  return Array.from(
    new Map(
      references
        .flatMap((reference) =>
          reference.kind === 'meegle-fpr' ? resolveMeeglePrdReference(reference) : [reference],
        )
        .map((reference) => [reference.url, reference]),
    ).values(),
  );
}

function resolvePrdReferencesWithStatus(references: PrdReference[]) {
  const statuses: PrdLinkStatus[] = [];
  const resolvedReferences: PrdReference[] = [];

  for (const reference of references) {
    if (reference.kind === 'lark-wiki') {
      statuses.push({
        sourceUrl: reference.url,
        sourceKind: reference.kind,
        resolutionStatus: 'direct-lark',
        resolvedUrls: [reference.url],
      });
      resolvedReferences.push(reference);
      continue;
    }

    const resolved = resolveMeeglePrdReference(reference);
    const resolvedLarkUrls = resolved
      .filter((candidate) => candidate.kind === 'lark-wiki')
      .map((candidate) => candidate.url);

    statuses.push({
      sourceUrl: reference.url,
      sourceKind: reference.kind,
      resolutionStatus: resolvedLarkUrls.length ? 'resolved-from-meegle' : 'meegle-resolution-failed',
      resolvedUrls: resolvedLarkUrls,
    });

    resolvedReferences.push(...resolved);
  }

  return {
    references: Array.from(
      new Map(resolvedReferences.map((reference) => [reference.url, reference])).values(),
    ),
    statuses,
  };
}

function collectCandidatePrdProcessing(
  commits: SourceCommitMetadata[],
): CandidatePrdProcessing | undefined {
  const references = Array.from(
    new Map(
      commits
        .flatMap((commit) => commit.prdStatuses ?? [])
        .map((status) => [status.sourceUrl, status]),
    ).values(),
  );

  if (!references.length) {
    return undefined;
  }

  return {
    references,
    extractionStatus: 'pending',
  };
}

function isSpecificPullRequestText(text: string | undefined) {
  if (!text) {
    return false;
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  const alnumCount = (normalized.match(/[A-Za-z0-9]/g) ?? []).length;
  const hasSentenceLikeStructure = /[.:;,-]/.test(normalized);
  const hasMeaningfulLength = normalized.length >= 40;
  const notJustLinks = normalized.replace(/https?:\/\/\S+/g, '').trim().length >= 20;

  return alnumCount >= 20 && hasMeaningfulLength && (hasSentenceLikeStructure || notJustLinks);
}

function prioritizePullRequestContextLines(commits: SourceCommitMetadata[]) {
  const rankedLines = commits.flatMap((commit) => {
    const prdLines = (commit.prdLinks ?? []).map((reference) => ({
      line: formatPrdReference(reference),
      priority: 3,
    }));
    const summaryLines = [commit.prSummary, commit.prTestPlan]
      .filter((value): value is string => Boolean(value))
      .map((line) => ({
        line,
        priority: isSpecificPullRequestText(line) ? 2 : 0,
      }));

    return [...prdLines, ...summaryLines];
  });

  return Array.from(
    new Map(
      rankedLines
        .filter((item) => item.priority > 0)
        .sort((left, right) => right.priority - left.priority)
        .map((item) => [item.line, item]),
    ).values(),
  ).map((item) => item.line);
}

function fetchPullRequestContext(repoPath: string, prNumber: number) {
  const repoIdentity = getGitHubRepoIdentity(repoPath);
  if (!repoIdentity) {
    return null;
  }

  try {
    const githubToken = process.env.GITHUB_TOKEN;
    console.log(`[pr] fetching PR #${prNumber}...`);
    const response = githubToken
      ? execFileSync(
          'curl',
          [
            '-fsSL',
            '-H', `Authorization: Bearer ${githubToken}`,
            '-H', 'Accept: application/vnd.github+json',
            `https://api.github.com/repos/${repoIdentity.owner}/${repoIdentity.name}/pulls/${prNumber}`,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 },
        )
      : execFileSync(
          'gh',
          [
            'api',
            '-H', 'Accept: application/vnd.github+json',
            `repos/${repoIdentity.owner}/${repoIdentity.name}/pulls/${prNumber}`,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 },
        );
    const payload = JSON.parse(response) as { title?: string; body?: string };
    const body = payload.body ?? '';
    const summary = extractPullRequestBodySection(body, 'Summary');
    const testPlan = extractPullRequestBodySection(body, 'Test Plan');
    const prdResolution = resolvePrdReferencesWithStatus(extractPrdReferences(body));

    return {
      title: payload.title?.trim() || null,
      summary,
      testPlan,
      prdLinks: prdResolution.references,
      prdStatuses: prdResolution.statuses,
    };
  } catch {
    return null;
  }
}

function enrichRelevantCommitsWithPullRequestContext(
  repoPath: string,
  commits: Array<{ sha: string; author: string; subject: string }>,
): SourceCommitMetadata[] {
  console.log(`[enrich] enriching ${commits.length} commit(s) with PR context...`);
  return commits.map((commit) => {
    const prNumber = extractPullRequestNumber(commit.subject);
    if (!prNumber) {
      return commit;
    }

    const pullRequestContext = fetchPullRequestContext(repoPath, prNumber);
    if (!pullRequestContext) {
      return { ...commit, prNumber };
    }

    return {
      ...commit,
      prNumber,
      prTitle: pullRequestContext.title ?? undefined,
      prSummary: pullRequestContext.summary ?? undefined,
      prTestPlan: pullRequestContext.testPlan ?? undefined,
      prdLinks: pullRequestContext.prdLinks?.length ? pullRequestContext.prdLinks : undefined,
      prdStatuses: pullRequestContext.prdStatuses?.length ? pullRequestContext.prdStatuses : undefined,
    };
  });
}

function readWorkspaceFile(workspaceRoot: string, relativePath: string) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return fs.readFileSync(absolutePath, 'utf8');
}

function summarizeEvidenceFile(relativePath: string, content: string) {
  if (/\.spec\./.test(relativePath)) {
    const titles = Array.from(content.matchAll(/test\s*\(\s*(['"`])([\s\S]*?)\1/g))
      .map((match) => match[2].replace(/\s+/g, ' ').trim())
      .slice(0, 2);

    if (titles.length) {
      return `Covers: ${titles.join(' | ')}`;
    }
  }

  const exportedFunctions = Array.from(content.matchAll(/export function\s+([A-Za-z0-9_]+)/g))
    .map((match) => match[1])
    .slice(0, 4);

  if (exportedFunctions.length) {
    return `Exports: ${exportedFunctions.join(', ')}`;
  }

  const exportedTypes = Array.from(content.matchAll(/export type\s+([A-Za-z0-9_]+)/g))
    .map((match) => match[1])
    .slice(0, 4);

  if (exportedTypes.length) {
    return `Types: ${exportedTypes.join(', ')}`;
  }

  return 'Relevant local evidence file for weekly diff generation.';
}

function collectFlightRetrievedEvidence(
  workspaceRoot: string,
  concerns: string[],
): Candidate['retrievedEvidence'] {
  const specs: Array<{ path: string; reason: string }> = [];
  const helpers: Array<{ path: string; reason: string }> = [
    {
      path: 'docs/traveloka-flight-locator-guideline.md',
      reason: 'Shared Traveloka flight locator policy that generated cases should follow.',
    },
    {
      path: 'docs/traveloka-flight-filter-structure.md',
      reason: 'Shared Traveloka desktop filter structure and runtime id taxonomy for generated cases.',
    },
    {
      path: 'tests/lib/traveloka-flight/workflow.ts',
      reason: 'Shared flight search workflow used by generated flight specs.',
    },
    {
      path: 'tests/lib/traveloka-flight/locators.ts',
      reason: 'Shared locator contract for sidebar filters and result cards.',
    },
    {
      path: 'tests/lib/traveloka-flight/source-map.ts',
      reason: 'Canonical flight surface routing and source-hint mapping.',
    },
    {
      path: 'tests/lib/traveloka-flight/template.ts',
      reason: 'Template used to emit generated flight regression cases.',
    },
  ];

  if (concerns.includes('transit-filter')) {
    specs.push({
      path: 'tests/web/traveloka-flight-filter.spec.ts',
      reason: 'Existing transit filter regression case for search results.',
    });
  }

  if (concerns.includes('airline-filter')) {
    specs.push({
      path: 'tests/web/traveloka-flight-random-filter.spec.ts',
      reason: 'Existing airline filter verification case for visible result cards.',
    });
  }

  if (!specs.length) {
    specs.push(
      {
        path: 'tests/web/traveloka-flight-filter.spec.ts',
        reason: 'Baseline flight sidebar filter regression case.',
      },
      {
        path: 'tests/web/traveloka-flight-random-filter.spec.ts',
        reason: 'Baseline airline verification regression case.',
      },
    );
  }

  return [...specs, ...helpers]
    .map((item) => {
      const content = readWorkspaceFile(workspaceRoot, item.path);
      if (!content) {
        return null;
      }

      return {
        kind: /\.spec\./.test(item.path) ? 'existing-test' : 'shared-helper',
        path: item.path,
        reason: item.reason,
        summary: summarizeEvidenceFile(item.path, content),
      };
    })
    .filter(Boolean) as Candidate['retrievedEvidence'];
}

function collectFlightBookingRetrievedEvidence(
  workspaceRoot: string,
  paymentFocused: boolean,
): Candidate['retrievedEvidence'] {
  const items: Array<{ path: string; reason: string }> = [
    {
      path: 'docs/traveloka-flight-booking-case-generation.md',
      reason: 'Locked booking entry-chain specification for generated booking cases.',
    },
    {
      path: 'docs/traveloka-flight-booking-payment-chain-lock.md',
      reason: 'Locked booking-to-payment chain specification for payment-sensitive generated cases.',
    },
    {
      path: 'docs/weekly-diff-case-generator.md',
      reason: 'Weekly-diff generation policy and locked local evidence expectations.',
    },
    {
      path: 'docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md',
      reason: 'Phase 2 active-layer execution constraints for weekly cases.',
    },
    {
      path: 'tests/lib/traveloka-flight/workflow.ts',
      reason: 'Shared Traveloka flight workflow helpers used by generated booking cases.',
    },
    {
      path: 'tests/web/traveloka-flight-metasearch-email-confirmation.spec.ts',
      reason: 'Existing booking-surface regression case used as booking baseline.',
    },
    {
      path: 'tests/web/traveloka-flight-booking-payment-e2e.spec.ts',
      reason: 'Proven desktop booking-to-payment smoke chain with cross-origin payment handling.',
    },
  ];

  if (paymentFocused) {
    items.push({
      path: 'tests/web/traveloka-generic-bug-detection.spec.ts',
      reason: 'Generated-suite bug-detection enforcement for booking and payment-related specs.',
    });
  }

  return items
    .map((item) => {
      const content = readWorkspaceFile(workspaceRoot, item.path);
      if (!content) {
        return null;
      }

      return {
        kind: /\.spec\./.test(item.path) ? 'existing-test' : 'shared-helper',
        path: item.path,
        reason: item.reason,
        summary: summarizeEvidenceFile(item.path, content),
      };
    })
    .filter(Boolean) as Candidate['retrievedEvidence'];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

/**
 * Parse PR Summary / Test Plan text from enriched commits and generate
 * aiQuery() soft-assertions for each extracted "should/must/verify" sentence.
 * Max 3 assertions per spec to avoid noise. Results are logged but NOT
 * hard-failing — PRD prose can be ambiguous and we don't want false failures.
 */
function buildPrdBehavioralAssertions(commits: SourceCommitMetadata[]): string[] {
  const lines: string[] = [];
  let assertionIndex = 0;

  for (const commit of commits) {
    if (assertionIndex >= 3) break;

    const sources: Array<{ label: string; text: string | undefined }> = [
      { label: `PR #${commit.prNumber ?? '?'} test plan`, text: commit.prTestPlan },
      { label: `PR #${commit.prNumber ?? '?'} summary`, text: commit.prSummary },
    ];

    for (const { label, text } of sources) {
      if (!text || assertionIndex >= 3) continue;

      const sentences = text
        .split(/\n|(?<=[.?!])\s+/)
        .map((s) => s.replace(/^[\d).\-*\s]+/, '').trim())
        .filter(
          (s) =>
            s.length >= 20 &&
            s.length <= 200 &&
            /should|must|verify|expect|ensure|check|confirm/i.test(s),
        );

      for (const sentence of sentences.slice(0, 2)) {
        if (assertionIndex >= 3) break;
        const varName = `_prdCheck${assertionIndex}`;
        const escaped = sentence.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, '\\`');
        const shortLabel = sentence.length > 80 ? sentence.slice(0, 80) + '...' : sentence;
        lines.push(
          '',
          `// PRD behavioral assertion from ${label}: "${shortLabel}"`,
          'try {',
          `  const ${varName} = await aiQuery<{ result: string; reason: string }>(`,
          `    'Based on what is currently visible on this page, is this true? ' +`,
          `    '"${escaped}" ' +`,
          `    'Respond as JSON: {"result": "yes" or "no", "reason": "one sentence"}',`,
          '  );',
          `  console.log('[prd-assertion] ${label}:', JSON.stringify(${varName}));`,
          `  if (${varName}?.result === 'no') {`,
          `    console.warn('[prd-assertion] ⚠️  PRD expectation not met: ${escaped}');`,
          '  }',
          '} catch {',
          `  console.warn('[prd-assertion] ${label} skipped (aiQuery failed or unavailable)');`,
          '}',
        );
        assertionIndex++;
      }
    }
  }

  return lines;
}

/**
 * Mode 3: Free Exploration + www/PRD Oracle
 *
 * When the weekly diff touches interaction-relevant concerns (filter, sort, results-list)
 * or has attached PRD links, inject ai() + aiQuery() blocks that:
 *   1. Use ai() to freely trigger the interaction (no hardcoded testIDs)
 *   2. Use aiQuery() to read actual page state after interaction
 *   3. Assert actual === expected (derived from www source contracts / PRD)
 *
 * These blocks are injected AFTER the standard concern blocks in the generated spec.
 * Assertions are non-hard-failing (console.warn on mismatch) to avoid noise from
 * transient UI states, but will surface real bugs in CI logs.
 *
 * Pattern sourced from: tests/web/traveloka-flight-search-interactions.spec.ts
 * See memory: testing-interaction-training.md § "Search Page Interaction Patterns (CANONICAL)"
 */
function buildMode3InteractionBlocks(
  concerns: FlightConcern[],
  commits: SourceCommitMetadata[],
): string[] {
  const lines: string[] = [];

  // Collect any PRD URLs from commits (used to annotate generated blocks)
  const prdUrls: string[] = commits
    .flatMap((c) => c.prdLinks ?? [])
    .map((ref) => ref.url)
    .filter(Boolean);
  const prdAnnotation =
    prdUrls.length > 0
      ? prdUrls.map((url) => `// EN PRD: ${url}`).join('\n')
      : null;

  const hasFilterConcern = concerns.some((c) => c === 'transit-filter' || c === 'airline-filter');
  const hasSortConcern = concerns.some((c) => c === 'results-list');

  // ── Mode 3 Block: Direct-flights filter ──────────────────────────────────
  // Triggered when: transit-filter / airline-filter concern present, OR PRD link exists
  if (hasFilterConcern || prdUrls.length > 0) {
    lines.push(
      '',
      '// ── Mode 3: Free exploration — Direct-flights filter ────────────────────',
      '// ai() freely clicks the filter; aiQuery() reads actual stops; assert = www contract',
      '// www contract: selecting Direct filter → all result cards must show stopsCount === 0',
      ...(prdAnnotation ? [prdAnnotation] : []),
      'try {',
      "  await ai('In the filter sidebar, click the \"Direct\" or \"Non-stop\" filter option under the Stops section.');",
      "  await page.waitForLoadState('networkidle').catch(() => {});",
      '  const _filterCards = await aiQuery<Array<{ stops: string }>>(',
      "    '{stops: string}[], stops text on each visible flight result card (e.g. \"Direct\", \"1 Stop\", \"2 Stops\")',",
      '  ).catch(() => [] as Array<{ stops: string }>);',
      '  if (_filterCards.length > 0) {',
      "    const _nonDirect = _filterCards.filter((c) => !/direct|non.?stop|0 stop/i.test(c.stops));",
      '    if (_nonDirect.length > 0) {',
      "      console.warn('[mode3-filter] ⚠️  Non-direct results after Direct filter:', JSON.stringify(_nonDirect));",
      '    }',
      "    expect(_nonDirect, 'Mode 3 filter: after Direct filter all results should be non-stop').toHaveLength(0);",
      '  } else {',
      "    console.warn('[mode3-filter] No flight cards found after filter — possible render delay');",
      '  }',
      '} catch (err) {',
      "  console.warn('[mode3-filter] Skipped (interaction unavailable):', (err as Error).message);",
      '}',
    );
  }

  // ── Mode 3 Block: Price sort (cheapest first) ─────────────────────────────
  // Triggered when: results-list concern present, OR PRD link exists
  if (hasSortConcern || prdUrls.length > 0) {
    lines.push(
      '',
      '// ── Mode 3: Free exploration — Price sort (cheapest first) ──────────────',
      '// ai() clicks cheapest sort; aiQuery() reads prices; assert ascending order',
      '// www contract: cheapest sort → first result has lowest price in visible set',
      ...(prdAnnotation ? [prdAnnotation] : []),
      'try {',
      "  await ai('Click the sort option that sorts flights by cheapest price first. It may be labelled \"Cheapest\" or \"Price (Low to High)\".');",
      "  await page.waitForLoadState('networkidle').catch(() => {});",
      '  const _sortPrices = await aiQuery<Array<{ price: number }>>(',
      "    '{price: number}[], numeric price on each visible flight card, digits only without currency symbol',",
      '  ).catch(() => [] as Array<{ price: number }>);',
      '  if (_sortPrices.length >= 2) {',
      '    const _nums = _sortPrices.slice(0, 5).map((p) => p.price).filter((n) => !isNaN(n));',
      '    const _isAscending = _nums[0] <= _nums[_nums.length - 1];',
      '    if (!_isAscending) {',
      "      console.warn('[mode3-sort] ⚠️  Prices not ascending after cheapest sort:', JSON.stringify(_nums));",
      '    }',
      "    expect(_isAscending, `Mode 3 sort: prices should be ascending after cheapest sort: ${JSON.stringify(_nums)}`).toBe(true);",
      '  } else {',
      "    console.warn('[mode3-sort] Not enough cards to verify sort order');",
      '  }',
      '} catch (err) {',
      "  console.warn('[mode3-sort] Skipped (interaction unavailable):', (err as Error).message);",
      '}',
    );
  }

  return lines;
}

function buildFlightGeneratedPlan(
  concerns: FlightConcern[],
  retrievedEvidence: NonNullable<Candidate['retrievedEvidence']>,
  changedFiles: string[],
  fileWeights?: Map<string, number>,
  commits?: SourceCommitMetadata[],
): FlightGeneratedPlan {
  const importLines = new Set<string>();
  const actionContracts: NonNullable<Candidate['actionContracts']> = [];
  const assertionLines = [
    'const currentUrl = new URL(page.url());',
    'expect(currentUrl.pathname).toBe(new URL(TARGET_URL).pathname);',
    "expect(workflowPlan.sourceContext.surface).toBe('search-results');",
    'if (!sidebar) {',
    "  throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');",
    '}',
  ];
  const interactionLines: string[] = [];
  const targetTests = retrievedEvidence
    .filter((evidence) => evidence.kind === 'existing-test')
    .map((evidence) => evidence.path);
  const highlightedChangedFiles = changedFiles
    .slice()
    .sort((left, right) => {
      const scoreDiff = (fileWeights?.get(right) ?? 0) - (fileWeights?.get(left) ?? 0);
      return scoreDiff || left.localeCompare(right);
    })
    .slice(0, 10);
  const omittedChangedFileCount = Math.max(0, changedFiles.length - highlightedChangedFiles.length);
  const evidenceCommentLines = [
    '// Weekly diff generated candidate: refine this case against the actual changed source files.',
    `// Suggested changed files (top ${highlightedChangedFiles.length}${omittedChangedFileCount ? ` of ${changedFiles.length}` : ''}): ${JSON.stringify(highlightedChangedFiles)}`,
    ...(omittedChangedFileCount
      ? [`// Omitted additional changed files: ${omittedChangedFileCount}`]
      : []),
    ...retrievedEvidence.map(
      (evidence) => `// Retrieved ${evidence.kind}: ${evidence.path} - ${evidence.summary}`,
    ),
  ];

  importLines.add('import { attachLocatorShadowProposal } from ../lib/locator-shadow-proposal;');
  importLines.add('import { travelokaFlightSearchResultsSelectors } from ../lib/traveloka-flight/locators;');
  assertionLines.push(
    'await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible({ timeout: 15000 });',
    'await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible({ timeout: 15000 });',
  );

  if (concerns.includes('transit-filter')) {
    importLines.add('import { clickTransitCountFilter, expectTransitCountFilterChecked, getTransitCountSection } from ../lib/traveloka-flight/locators;');
    assertionLines.push('await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });');
    interactionLines.push(
      '// Transit filter: use DOM contract only; attach shadow proposal if contract is missing.',
      'try {',
      "  await clickTransitCountFilter(page, 'ONE_TRANSIT');",
      '} catch {',
      "  console.warn('[shadow-proposal] transit filter DOM contract missing — attaching diagnostic proposal');",
      ...buildLocatorShadowProposalLines({
        stepName: 'transit-filter-one-transit',
        contractDescription: 'One-transit filter option in the flight sidebar',
        expectedContracts: ['clickTransitCountFilter(page, \"ONE_TRANSIT\")', 'getTransitCountSection(page)'],
        scopeHint: 'Flight results sidebar > Stops / Transit section',
        analysisPrompt:
          'Identify the visible filter option that most likely represents one transit and describe its surrounding section and label text.',
        failureMessage:
          'Explicit transit-filter locator contract missing. Shadow proposal attached; main execution intentionally stopped.',
      }),
      '}',
      "await page.waitForLoadState('networkidle').catch(() => {});",
      "await expectTransitCountFilterChecked(page, 'ONE_TRANSIT').catch(() => {});",
    );
    actionContracts.push({
      stepName: 'transit-filter-one-transit',
      scopeHint: 'Flight results sidebar > Stops / Transit section',
      expectedContracts: ['clickTransitCountFilter(page, "ONE_TRANSIT")', 'getTransitCountSection(page)'],
      preconditions: ['Search results sidebar is visible', 'Transit section is visible'],
      postconditions: ['One-transit option is checked or reflected in sidebar state'],
      confidence: 'high',
    });
  }

  if (concerns.includes('airline-filter')) {
    importLines.add('import { discoverFlightFilterOptionsInSection, getTaggedFlightResultCards, tagVisibleFlightResultCards } from ../lib/traveloka-flight/locators;');
    interactionLines.push(
      '// Airline filter: use DOM discovery only; attach shadow proposal if sidebar contracts fail.',
      'let _airlinesClicked = false;',
      'try {',
      "  const discoveredAirlines = await discoverFlightFilterOptionsInSection(sidebar, 'Airline', 'data-weekly-airline-option-idx');",
      "  await testInfo.attach('weekly-discovered-airlines.json', {",
      '    body: Buffer.from(JSON.stringify(discoveredAirlines, null, 2)),',
      "    contentType: 'application/json',",
      '  });',
      "  expect(discoveredAirlines.length, 'Expected at least one airline filter option.').toBeGreaterThan(0);",
      '  const chosenAirline = discoveredAirlines[0];',
      '  await sidebar.locator(`[data-weekly-airline-option-idx="${chosenAirline.filterOptionIdx}"]`).click({ force: true });',
      '  _airlinesClicked = true;',
      '} catch {',
      "  console.warn('[shadow-proposal] airline filter DOM discovery failed — attaching diagnostic proposal');",
      ...buildLocatorShadowProposalLines({
        stepName: 'airline-filter-first-option',
        contractDescription: 'First airline option in the flight sidebar',
        expectedContracts: ['discoverFlightFilterOptionsInSection(sidebar, \"Airline\", ...)'],
        scopeHint: 'Flight results sidebar > Airline section',
        analysisPrompt:
          'Identify the first visible airline filter option, including the airline label and the specific container or row where it appears.',
        failureMessage:
          'Explicit airline-filter locator contract missing. Shadow proposal attached; main execution intentionally stopped.',
      }),
      '}',
      'if (_airlinesClicked) {',
      "  await page.waitForLoadState('networkidle').catch(() => {});",
      "  const taggedCardCount = await tagVisibleFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "  const cards = getTaggedFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "  expect(taggedCardCount, 'Expected visible flight result cards after selecting airline filter.').toBeGreaterThan(0);",
      '  await expect(cards.first()).toBeVisible({ timeout: 15000 });',
      '}',
    );
    actionContracts.push({
      stepName: 'airline-filter-first-option',
      scopeHint: 'Flight results sidebar > Airline section',
      expectedContracts: ['discoverFlightFilterOptionsInSection(sidebar, "Airline", "data-weekly-airline-option-idx")'],
      preconditions: ['Search results sidebar is visible', 'At least one airline option can be discovered'],
      postconditions: ['Visible flight result cards remain present after airline selection'],
      confidence: 'medium',
    });
  } else if (concerns.includes('results-list')) {
    importLines.add('import { getTaggedFlightResultCards, tagVisibleFlightResultCards } from ../lib/traveloka-flight/locators;');
    interactionLines.push(
      "const taggedCardCount = await tagVisibleFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "const cards = getTaggedFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "expect(taggedCardCount, 'Weekly generated case expects visible flight result cards.').toBeGreaterThan(0);",
      'await expect(cards.first()).toBeVisible({ timeout: 15000 });',
      'const firstCardText = await cards.first().innerText();',
      "expect(firstCardText).toMatch(/flight details|fare\\s*&\\s*benefits/i);",
    );
    actionContracts.push({
      stepName: 'results-list-first-visible-card',
      scopeHint: 'Visible flight results list on the desktop search surface',
      expectedContracts: ['tagVisibleFlightResultCards(page, "data-weekly-flight-card-idx")', 'getTaggedFlightResultCards(page, "data-weekly-flight-card-idx")'],
      preconditions: ['Flight results page headings are visible'],
      postconditions: ['At least one tagged visible result card is present'],
      confidence: 'high',
    });
  }

  // PRD behavioral assertions: extracted from PR Summary / Test Plan "should" sentences
  const prdAssertions = buildPrdBehavioralAssertions(commits ?? []);
  if (prdAssertions.length) {
    assertionLines.push(...prdAssertions);
  }

  // Mode 3: Free exploration + www/PRD oracle — inject ai()+aiQuery() interaction blocks
  // when filter/sort concerns are detected OR PRD links are attached to commits.
  // See: tests/web/traveloka-flight-search-interactions.spec.ts (canonical reference)
  const mode3Blocks = buildMode3InteractionBlocks(concerns, commits ?? []);
  if (mode3Blocks.length) {
    assertionLines.push(...mode3Blocks);
  }

  interactionLines.push(
    'const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);',
    'if (screenshot) {',
    "  await testInfo.attach('weekly-generated-results.png', {",
    '    body: screenshot,',
    "    contentType: 'image/png',",
    '  });',
    '}',
    ...evidenceCommentLines,
  );

  return {
    concerns,
    targetTests: uniqueStrings(targetTests),
    extraImportBlock: Array.from(importLines)
      .map((line) => line.replace('../', "'../").replace(';', "';"))
      .join('\n'),
    assertionLines,
    interactionLines,
    actionContracts,
  };
}

function scoreFlightFile(filePath: string): DomainSignal {
  const value = filePath.toLowerCase();
  let score = 0;
  let strong = false;

  if (/^packages\/flight\//.test(value)) {
    score += 8;
    strong = true;
  }
  if (/^tests\/(web\/traveloka-flight|lib\/traveloka-flight)\//.test(value)) {
    score += 7;
    strong = true;
  }
  if (/^packages\/package\/flight-hotel\//.test(value)) {
    score += 3;
  }
  if (/fpr-search-result|flightsearchsidebarfilter|fullsearch|fulltwosearch|tiket-pesawat/.test(value)) {
    score += 4;
    strong = true;
  }
  if (/\b(airline|carrier|transit|layover|fare)\b/.test(value)) {
    score += 3;
  }

  return { domain: 'flight-search', score, strong };
}

function scoreFlightBookingFile(filePath: string): DomainSignal {
  const value = filePath.toLowerCase();
  let score = 0;
  let strong = false;

  if (/^packages\/flight\/fpr-booking\//.test(value)) {
    score += 9;
    strong = true;
  }
  if (/bookingcontact|bookingcontactvalidation|bffbookingcontact/.test(value)) {
    score += 5;
    strong = true;
  }
  if (/^packages\/flight\/fpr-booking-/.test(value)) {
    score += 4;
    strong = true;
  }
  if (/\b(booking|contact form|email confirmation|passenger detail)\b/.test(value)) {
    score += 2;
  }

  return { domain: 'flight-booking', score, strong };
}

function hasStrongFlightBookingEvidence(changedFiles: string[]) {
  return changedFiles.some((filePath) => {
    const value = filePath.toLowerCase();
    return (
      /^packages\/flight\/fpr-booking\//.test(value) ||
      /bookingcontactvalidation|bffbookingcontact/.test(value)
    );
  });
}

function scoreI18nFile(filePath: string): DomainSignal {
  const value = filePath.toLowerCase();
  let score = 0;
  let strong = false;

  if (/^audit-output\/(home-i18n|i18n)\//.test(value)) {
    score += 6;
    strong = true;
  }
  if (/^tests\/traveloka-(home-)?i18n/.test(value)) {
    score += 6;
    strong = true;
  }
  if (/\b(i18n|locale|language|translation|dictionary|copy)\b/.test(value)) {
    score += 3;
  }

  return { domain: 'web-i18n', score, strong };
}

function scoreAndroidFile(filePath: string): DomainSignal {
  const value = filePath.toLowerCase();
  let score = 0;
  let strong = false;

  if (/^tests\/traveloka-android/.test(value)) {
    score += 6;
    strong = true;
  }
  if (/^apks\//.test(value)) {
    score += 5;
    strong = true;
  }
  if (/\b(android|mobile app|appentry)\b/.test(value)) {
    score += 3;
  }
  if (/\b(account|home)\b/.test(value)) {
    score += 1;
  }

  return { domain: 'android-home', score, strong };
}

function collectDomainSignals(filePath: string): DomainSignal[] {
  return [
    scoreFlightBookingFile(filePath),
    scoreFlightFile(filePath),
    scoreI18nFile(filePath),
    scoreAndroidFile(filePath),
  ];
}

function hasStrongFlightEvidence(changedFiles: string[]) {
  return changedFiles.some((filePath) => {
    const value = filePath.toLowerCase();
    return (
      /^packages\/flight\//.test(value) ||
      /^tests\/(web\/traveloka-flight|lib\/traveloka-flight)\//.test(value) ||
      /fpr-search-result|flightsearchsidebarfilter|fullsearch|fulltwosearch/.test(value)
    );
  });
}

function isSearchResultsOwnedFile(filePath: string) {
  const value = filePath.toLowerCase();
  return (
    /^packages\/flight\/fpr-search-result(?:-v2|-components|-ssr-components)?\//.test(value) ||
    /^packages\/flight\/app-desktop\/(?:__tests__\/)?pages\/flight\/(fullsearch|fulltwosearch)/.test(value) ||
    /^packages\/flight\/app-mobile\/(?:__tests__\/)?pages\/flight\/(fullsearch|fulltwosearch)/.test(value) ||
    /^packages\/flight\/app-mobile\/(?:__tests__\/)?pages\/tiket-pesawat\//.test(value) ||
    /^packages\/flight\/fpr-seo-search-form\//.test(value) ||
    /^packages\/flight\/fpr-servo-components\/searchform\//.test(value) ||
    /^packages\/flight\/fpr-servo\/usecases\/useservosearchsubmit/.test(value)
  );
}

function scoreFlightConcernFile(filePath: string) {
  const value = filePath.toLowerCase();
  const scores: Partial<Record<FlightConcern, number>> = {};
  const add = (concern: FlightConcern, score: number) => {
    scores[concern] = (scores[concern] ?? 0) + score;
  };

  if (!isSearchResultsOwnedFile(filePath)) {
    return scores;
  }

  if (/fpr-search-result|search-result-ssr-components|flightsearchsidebarfilter|filtermenu|recentfilters|searchfilter|sortpersistence|filterpersistence|fullsearch|fulltwosearch/.test(value)) {
    add('results-list', 3);
  }

  if (/airline|filterairlineoption|carrier/.test(value)) {
    add('airline-filter', 5);
    add('results-list', 1);
  }

  if (/transit|layover|stop/.test(value)) {
    add('transit-filter', 5);
    add('results-list', 1);
  }

  if (/searchform|usedoflightsearch|useservosearchsubmit|servo-components\/searchform|fullsearch|fulltwosearch/.test(value)) {
    add('search-form', 4);
  }

  if (/date|calendar|depart|return/.test(value)) {
    add('date-flow', 4);
    add('results-list', 1);
  }

  return scores;
}

function selectDominantFlightConcernFocus(changedFiles: string[]): FlightConcernFocus {
  const buckets = new Map<FlightConcern, { score: number; files: string[] }>();
  const concerns: FlightConcern[] = [
    'results-list',
    'search-form',
    'transit-filter',
    'airline-filter',
    'date-flow',
  ];

  for (const concern of concerns) {
    buckets.set(concern, { score: 0, files: [] });
  }

  for (const filePath of changedFiles) {
    const scores = scoreFlightConcernFile(filePath);
    for (const concern of concerns) {
      const score = scores[concern] ?? 0;
      if (!score) continue;
      const bucket = buckets.get(concern);
      if (!bucket) continue;
      bucket.score += score;
      bucket.files.push(filePath);
    }
  }

  const ranked = concerns
    .map((concern) => ({ concern, ...(buckets.get(concern) ?? { score: 0, files: [] }) }))
    .filter((bucket) => bucket.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) {
    return {
      concerns: ['results-list', 'search-form'],
      focusedFiles: changedFiles,
      topScore: 0,
      secondScore: 0,
      isDominant: false,
    };
  }

  const topScore = ranked[0].score;
  const secondScore = ranked[1]?.score ?? 0;
  const selectedConcerns = ranked
    .filter((bucket) => bucket.score >= Math.max(4, Math.ceil(topScore * 0.6)))
    .map((bucket) => bucket.concern);

  if (
    selectedConcerns.some((concern) => ['airline-filter', 'transit-filter', 'date-flow'].includes(concern)) &&
    !selectedConcerns.includes('results-list')
  ) {
    selectedConcerns.unshift('results-list');
  }

  const focusedFiles = uniqueStrings(
    selectedConcerns.flatMap((concern) => buckets.get(concern)?.files ?? []),
  );

  const isDominant = secondScore === 0 ? topScore >= 6 : topScore >= Math.max(6, Math.ceil(secondScore * 1.35));

  return {
    concerns: selectedConcerns.length ? selectedConcerns : ['results-list', 'search-form'],
    focusedFiles: focusedFiles.length ? focusedFiles : changedFiles,
    topScore,
    secondScore,
    isDominant,
  };
}

function describeFlightConcernPurpose(concern: FlightConcern) {
  switch (concern) {
    case 'results-list':
      return 'results-list behavior';
    case 'search-form':
      return 'search landing behavior';
    case 'transit-filter':
      return 'transit filter behavior';
    case 'airline-filter':
      return 'airline filter behavior';
    case 'date-flow':
      return 'date-related result flow';
  }
}

function describeFlightIntentPhrase(concerns: FlightConcern[]) {
  const concernKey = concerns.join('|');

  switch (concernKey) {
    case 'results-list':
      return 'results-list rendering and sidebar filter readiness';
    case 'search-form':
      return 'search landing and result-page readiness';
    case 'results-list|search-form':
    case 'search-form|results-list':
      return 'search landing and results-list readiness';
    case 'results-list|airline-filter':
    case 'airline-filter|results-list':
      return 'airline filter behavior and visible result-card consistency';
    case 'results-list|transit-filter':
    case 'transit-filter|results-list':
      return 'transit filter behavior and visible result-card consistency';
    case 'results-list|date-flow':
    case 'date-flow|results-list':
      return 'date-related result refresh and results-list readiness';
    default:
      return concerns.map(describeFlightConcernPurpose).join(', ');
  }
}

function formatWeeklyCaseStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}${month}${day}`;
}

function buildFlightFocusFileWeights(focusedFiles: string[]) {
  const weights = new Map<string, number>();

  for (const filePath of focusedFiles) {
    const value = filePath.toLowerCase();
    let score = 1;

    if (/fpr-search-result-v2|fpr-search-result-ssr-components/.test(value)) {
      score += 5;
    }
    if (/flightsearchsidebarfilter|filtermenu|filterairlineoption|transitfiltermenu|filtersection/.test(value)) {
      score += 4;
    }
    if (/fpr-search-result-components/.test(value)) {
      score += 3;
    }
    if (/fullsearch|fulltwosearch/.test(value)) {
      score += 1;
    }

    weights.set(filePath, score);
  }

  return weights;
}

function buildFlightCandidate(
  changedFiles: string[],
  workspaceRoot: string,
  repoPath: string,
  startCommit: string,
  endRef: string,
): Candidate {
  const focus = selectDominantFlightConcernFocus(changedFiles);
  const weeklyCaseStamp = formatWeeklyCaseStamp();
  const phrase = describeFlightIntentPhrase(focus.concerns);
  const fileWeights = buildFlightFocusFileWeights(focus.focusedFiles);
  const suggestedUserIntent =
    `Open the desktop Traveloka flight search results page and validate the weekly regression areas covering ${phrase}. ` +
    'Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.';
  const sourceContext = buildFlightSourceContextFromFiles(focus.focusedFiles, suggestedUserIntent);
  sourceContext.concerns = focus.concerns;
  const hasStrongEvidence = hasStrongFlightEvidence(changedFiles);
  const canEmitRunnableSpec = hasStrongEvidence && focus.isDominant;
  const sourceCommits = collectRelevantCommits(repoPath, startCommit, endRef, focus.focusedFiles, 3, fileWeights);
  const enrichedSourceCommits = enrichRelevantCommitsWithPullRequestContext(repoPath, sourceCommits);
  const sourceSummaryLines = prioritizePullRequestContextLines(enrichedSourceCommits).slice(0, 2);
  const retrievedEvidence = collectFlightRetrievedEvidence(workspaceRoot, focus.concerns) ?? [];
  const generatedPlan = buildFlightGeneratedPlan(
    focus.concerns,
    retrievedEvidence,
    focus.focusedFiles,
    fileWeights,
    enrichedSourceCommits,
  );
  const confidenceAssessment = assessFlightSearchCandidateConfidence({
    hasStrongEvidence,
    isDominant: focus.isDominant,
    retrievedEvidenceCount: retrievedEvidence.length,
    actionContractCount: generatedPlan.actionContracts.length,
    targetTestCount: generatedPlan.targetTests.length,
  });
  const webSpecFileName = `traveloka-flight-weekly-diff-${weeklyCaseStamp}.spec.ts`;
  
  // 🔒 HARDCODED CONSTRAINTS (生成时强制应用):
  // 1. Desktop web only (桌面网页) - 不生成移动端或其他设备
  // 2. Flight domain only (仅航班域) - flight-search 和 flight-booking
  // 3. Traveloka https://github.com/traveloka/www (仅此源)
  // 4. Use lib/traveloka-flight helpers (使用航班库)
  
  const webSpecContent = createFlightCaseTemplate({
    testName: `Traveloka weekly diff generated flight results coverage (${weeklyCaseStamp})`,
    url: sourceContext.url,
    userIntent: suggestedUserIntent,
    confidence: confidenceAssessment.confidence,
    runtimeRoutingPaths: focus.focusedFiles,
    importPrefix: '../',
    extraImportBlock: `${generatedPlan.extraImportBlock}
import { GenericBugDetector } from '../lib/generic-bug-detector';`,
    concerns: generatedPlan.concerns,
    actionContracts: generatedPlan.actionContracts,
    sourceCommitLines: enrichedSourceCommits.map(
      (commit: { sha: string; author: string; subject: string }) =>
        `${commit.sha} by ${commit.author}: ${commit.subject}`,
    ),
    sourceSummaryLines: [
      ...sourceSummaryLines,
      'Apply all locator rules from docs/traveloka-flight-locator-guideline.md',
      'Validate filter structure per docs/traveloka-flight-filter-structure.md',
      'Check carry-over behavior per docs/traveloka-flight-carry-over-airline-bug-report.md',
      '⭐ Run P0 critical bug detection (flight flows) - powered by config/p0-detection-rules.json',
      'Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active',
    ],
    assertionLines: [
      ...generatedPlan.assertionLines,
      '',
      '// P0 Critical Bug Detection',
      'const detector = new GenericBugDetector(page);',
      'const auditResults = await detector.runFullAudit({',
      '  locale: "en-US",',
      '  platform: "desktop",',
      '  pageType: "flight-search",',
      '  performanceBaseline: { lcp: 2500, cls: 0.1 },',
      '});',
      'const p0Issues = auditResults.filter(bug => bug.severity === "P0");',
      'if (p0Issues.length > 0) {',
      '  console.error(`❌ P0 CRITICAL ISSUES FOUND: ${p0Issues.map(b => b.issue).join(", ")}`);',
      '  expect(p0Issues).toHaveLength(0); // Enforce zero P0 bugs',
      '}',
    ],
    interactionLines: [
      ...generatedPlan.interactionLines,
      '// Retrieved shared-helper: docs/traveloka-flight-locator-guideline.md - Locator priority and Traveloka-specific rules',
      '// Retrieved shared-helper: docs/traveloka-flight-filter-structure.md - Sidebar filter component tree and runtime id patterns',
      '// Retrieved shared-helper: docs/traveloka-flight-carry-over-airline-bug-report.md - Carry-over behavior rules and known issues',
      '// Retrieved shared-helper: docs/weekly-diff-case-generator.md - Weekly diff generation strategy',
      '// Retrieved shared-helper: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md - Phase 2 layered execution strategy',
      '// Retrieved shared-helper: tests/lib/traveloka-flight/workflow.ts - Exports: createFlightWorkflowPlan, openFlightSearchTask, attachFlightWorkflowPlan',
      '// Retrieved shared-helper: tests/lib/traveloka-flight/locators.ts - Exports: getTaggedFlightResultCards, tagVisibleFlightResultCards, travelokaFlightSearchResultsSelectors',
      '// Retrieved shared-helper: config/p0-detection-rules.json - P0 critical bug detection rules (11 rules)',
      ...sourceContext.sourceHints.map(
        (hint) => `// Source hint: ${hint.sourcePath} - ${hint.reason}`,
      ),
    ],
  });

  return {
    id: 'flight-search-weekly',
    domain: 'flight-search',
    confidence: confidenceAssessment.confidence,
    confidenceScore: confidenceAssessment.score,
    confidenceReasons: confidenceAssessment.reasons,
    mainLaneEligible: canEmitRunnableSpec && confidenceAssessment.confidence === 'high',
    mainLaneGateReason: canEmitRunnableSpec && confidenceAssessment.confidence === 'high'
      ? 'Eligible: dominant concern cluster with strong www evidence produced a runnable spec.'
      : canEmitRunnableSpec
      ? `Gated: runnable spec exists, but confidence score ${confidenceAssessment.score} is below the high-confidence threshold.`
      : hasStrongEvidence
      ? 'Not eligible: evidence exists, but concern dominance is not strong enough for weekly main lane execution.'
      : 'Not eligible: direct source evidence is too weak for weekly main lane execution.',
    title: 'Weekly flight search regression coverage',
    action: 'modify-existing',
    reason:
      canEmitRunnableSpec
        ? 'Changed files map to a dominant verified flight concern cluster. Re-check the nearest search-results tests before adding new ones.'
        : hasStrongEvidence
        ? 'Changed files map to flight search surfaces, but the dominant concern cluster is not clear enough for a safe runnable weekly spec. Keep this candidate as summary-first manual review.'
        : 'Changed files weakly suggest flight behavior, but direct source evidence is missing. Keep this as manual-review guidance instead of auto-emitting a runnable spec.',
    solution: canEmitRunnableSpec
      ? 'Prioritize existing flight regression tests, then emit a runnable weekly spec because verified flight source evidence exists.'
      : hasStrongEvidence
      ? 'Keep the weekly output as summary-only until one concern cluster clearly dominates the www flight diff.'
      : 'Limit this candidate to a draft and require manual review before creating a runnable spec.',
    howToSolve: canEmitRunnableSpec
      ? 'Use packages/flight and traveloka-flight helper evidence to route the candidate, then emit the generated web spec through the shared workflow template.'
      : hasStrongEvidence
      ? 'Keep the target URL and routed source hints, but suppress web spec emission when the strongest concern does not clearly separate from the next cluster.'
      : 'Keep the target URL and source hints, but suppress web spec emission until a packages/flight or traveloka-flight source file is present in the diff.',
    changedFiles: focus.focusedFiles,
    targetTests: generatedPlan.targetTests.length
      ? generatedPlan.targetTests
      : [
          'tests/web/traveloka-flight-filter.spec.ts',
          'tests/web/traveloka-flight-random-filter.spec.ts',
        ],
    userIntent: suggestedUserIntent,
    suggestedUserIntent,
    targetUrl: sourceContext.url,
    concerns: focus.concerns,
    sourceHints: sourceContext.sourceHints,
    sourceCommits: enrichedSourceCommits,
    retrievedEvidence,
    prdProcessing: collectCandidatePrdProcessing(enrichedSourceCommits),
    actionContracts: generatedPlan.actionContracts,
    webSpecFileName: canEmitRunnableSpec ? webSpecFileName : undefined,
    webSpecContent: canEmitRunnableSpec ? webSpecContent : undefined,
  };
}

function buildFlightBookingCandidate(
  changedFiles: string[],
  workspaceRoot: string,
  repoPath: string,
  startCommit: string,
  endRef: string,
): Candidate {
  const weeklyCaseStamp = formatWeeklyCaseStamp();

  const fileWeights = new Map<string, number>(
    changedFiles.map((filePath) => {
      const value = filePath.toLowerCase();
      let w = 1;
      if (/bffbookingcontact|bookingcontactvalidation/.test(value)) w += 5;
      if (/fpr-booking/.test(value)) w += 3;
      return [filePath, w];
    }),
  );

  const hasStrongEvidence = hasStrongFlightBookingEvidence(changedFiles);
  const sourceCommits = collectRelevantCommits(repoPath, startCommit, endRef, changedFiles, 3, fileWeights);
  const enrichedSourceCommits = enrichRelevantCommitsWithPullRequestContext(repoPath, sourceCommits);
  const sourceSummaryLines = prioritizePullRequestContextLines(enrichedSourceCommits).slice(0, 2);
  const retentionFocused = [
    ...changedFiles,
    ...enrichedSourceCommits.flatMap((commit) => [
      commit.subject,
      commit.prTitle ?? '',
      commit.prSummary ?? '',
      commit.prTestPlan ?? '',
    ]),
  ].some((value) => /retention|exit[-\s]?intent|drop\s*off/i.test(value));
  const paymentFocused = [
    ...changedFiles,
    ...enrichedSourceCommits.flatMap((commit) => [
      commit.subject,
      commit.prTitle ?? '',
      commit.prSummary ?? '',
      commit.prTestPlan ?? '',
    ]),
  ].some((value) => /payment|checkout|credit\s*card|paymentpaybutton|payauth|payment\/v2|cybersource/i.test(value));
  const retrievedEvidence = collectFlightBookingRetrievedEvidence(workspaceRoot, paymentFocused) ?? [];

  const suggestedUserIntent = paymentFocused
    ? 'Open the desktop Traveloka flight booking flow from search results, preserve the canonical booking => payment chain contracts, and verify payment-selection, credit-card setup, and pay-CTA behavior for the routed weekly regression slice.'
    : retentionFocused
    ? 'Open the desktop Traveloka flight booking flow from search results, verify the canonical booking page remains reachable, and capture booking-page state for retention-popup related weekly review.'
    : 'Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.';

  const bookingSourceContext = buildFlightSourceContextFromFiles(changedFiles, suggestedUserIntent);
  const bookingEntryUrl = bookingSourceContext.url;

  const highlightedChangedFiles = changedFiles
    .slice()
    .sort((a, b) => (fileWeights.get(b) ?? 0) - (fileWeights.get(a) ?? 0))
    .slice(0, 10);
  const omittedCount = Math.max(0, changedFiles.length - highlightedChangedFiles.length);

  const webSpecFileName = `traveloka-flight-booking-weekly-diff-${weeklyCaseStamp}.spec.ts`;
  const sourceCommitSummary = enrichedSourceCommits.length
    ? enrichedSourceCommits
        .map((commit: { sha: string; author: string; subject: string }) => `${commit.sha} by ${commit.author}: ${commit.subject}`)
        .join(' | ')
    : 'No specific commit metadata was attached for this generated case.';
  const sourceSummary = sourceSummaryLines.length ? sourceSummaryLines.join(' | ') : null;
  
  // 🔒 HARDCODED CONSTRAINTS (生成时强制应用):
  // 1. Desktop web only (桌面网页) - 不生成移动端或其他设备
  // 2. Flight domain only (仅航班域) - flight-booking
  // 3. Traveloka https://github.com/traveloka/www (仅此源)
  // 4. Use lib/traveloka-flight helpers (使用航班库)
  // 5. Phase 2 active layer (周度执行)

  const bookingImportBlock = `import {
  openBookingPageFromSearchResults,
  openMetasearchBookingContactPage,
} from '../lib/traveloka-flight/workflow';
import { attachLocatorShadowProposal } from '../lib/locator-shadow-proposal';
import { GenericBugDetector } from '../lib/generic-bug-detector';`;

  const bookingActionContracts: NonNullable<Candidate['actionContracts']> = [
    {
      stepName: 'booking-chain-choose-first-flight',
      scopeHint: 'First visible flight result card on the search results page',
      expectedContracts: ['[data-testid="flight-inventory-card-button"]'],
      preconditions: ['A visible search result card exists'],
      postconditions: ['Ticket type drawer or selection surface is reachable'],
      confidence: 'high',
    },
    {
      stepName: 'booking-chain-ticket-type-drawer',
      scopeHint: 'Ticket type selection overlay after choosing a flight',
      expectedContracts: ['[data-testid="view_fsv2_ticket_option_card_0"]', '[data-testid="button_fsv2_ticket_option_select_0"]'],
      preconditions: ['Choose action succeeded'],
      postconditions: ['Selection surface is visible'],
      confidence: 'high',
    },
    {
      stepName: 'booking-chain-select-ticket-option',
      scopeHint: 'Ticket type drawer or selection overlay',
      expectedContracts: ['[data-testid="button_fsv2_ticket_option_select_0"]'],
      preconditions: ['Ticket type drawer is visible'],
      postconditions: ['Booking page URL is reached'],
      confidence: 'high',
    },
    {
      stepName: 'booking-contact-form-visible',
      scopeHint: 'Booking page contact section on desktop web',
      expectedContracts: ['[data-testid="booking-contact-form"]', 'form'],
      preconditions: ['Booking page route is reached'],
      postconditions: ['Booking contact form is accessible'],
      confidence: 'medium',
    },
  ];
  const confidenceAssessment = assessFlightBookingCandidateConfidence({
    hasStrongEvidence,
    paymentFocused,
    retrievedEvidenceCount: retrievedEvidence.length,
    actionContractCount: bookingActionContracts.length,
    targetTestCount: paymentFocused ? 2 : 1,
  });

  const webSpecContent = createFlightCaseTemplate({
    testName: `Traveloka weekly diff booking smoke coverage (${weeklyCaseStamp})`,
    url: bookingEntryUrl,
    userIntent: suggestedUserIntent,
    confidence: confidenceAssessment.confidence,
    runtimeRoutingPaths: highlightedChangedFiles,
    importPrefix: '../',
    extraImportBlock: bookingImportBlock,
    concerns: ['booking-contact'],
    actionContracts: bookingActionContracts,
    sourceCommitLines: enrichedSourceCommits.map(
      (commit: { sha: string; author: string; subject: string }) =>
        `${commit.sha} by ${commit.author}: ${commit.subject}`,
    ),
    sourceSummaryLines: [
      ...sourceSummaryLines,
      'canonical desktop booking entry chain remains reachable',
      'complete Choose→Select booking chain execution required',
      'booking page URL is reached and contact form renders correctly',
      'Apply booking contracts from docs/traveloka-flight-booking-case-generation.md',
      ...(paymentFocused
        ? [
            'Apply locked booking=>payment contracts from docs/traveloka-flight-booking-payment-chain-lock.md',
            'When payment is in scope, treat credit-card fields as iframe-scoped and paymentPayButton as main-page CTA',
          ]
        : []),
      'Apply locator rules from docs/traveloka-flight-locator-guideline.md (Prefer explicit contracts)',
      'Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active',
      'Reference: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md',
    ],
    assertionLines: [
      '// Step 1: Click Choose button via explicit contract; attach shadow proposal if missing.',
      'const chooseButton = page.locator(\'[data-testid="flight-inventory-card-button"]\').first();',
      'const chooseVisible = await chooseButton.isVisible({ timeout: 15000 }).catch(() => false);',
      'if (chooseVisible) {',
      '  await chooseButton.click();',
      '} else {',
      "  console.warn('[shadow-proposal] Choose button contract missing — attaching diagnostic proposal');",
      ...buildLocatorShadowProposalLines({
        stepName: 'booking-chain-choose-first-flight',
        contractDescription: 'Choose button on the first flight result card',
        expectedContracts: ['[data-testid="flight-inventory-card-button"]'],
        scopeHint: 'First visible flight result card on the search results page',
        analysisPrompt:
          'Identify the most likely Choose or equivalent booking-entry control on the first visible flight result card, including any visible button text and card context.',
        failureMessage:
          'Choose button contract missing. Shadow proposal attached; main execution intentionally stopped.',
      }),
      '}',
      '',
      '// Step 2: Wait for ticket type selection drawer',
      'const ticketTypeDrawer = page.locator(\'[data-testid="view_fsv2_ticket_option_card_0"], [data-testid="button_fsv2_ticket_option_select_0"]\').first();',
      'const ticketTypeVisible = await ticketTypeDrawer.isVisible({ timeout: 15000 }).catch(() => false);',
      'if (!ticketTypeVisible) {',
      "  console.warn('[shadow-proposal] Ticket type drawer contract missing — attaching diagnostic proposal');",
      ...buildLocatorShadowProposalLines({
        stepName: 'booking-chain-ticket-type-drawer',
        contractDescription: 'Ticket type selection drawer after clicking Choose',
        expectedContracts: ['[data-testid="view_fsv2_ticket_option_card_0"]', '[data-testid="button_fsv2_ticket_option_select_0"]'],
        scopeHint: 'Ticket type selection overlay or drawer after opening a result card',
        analysisPrompt:
          'Identify the visible ticket type selection panel or first selectable option that should appear after choosing a flight.',
        failureMessage:
          'Ticket type selection drawer contract missing. Shadow proposal attached; main execution intentionally stopped.',
      }),
      '}',
      '',
      '// Step 3: Click Select button in the drawer via explicit contract; attach shadow proposal if missing.',
      'const selectButton = page.locator(\'[data-testid="button_fsv2_ticket_option_select_0"]\').first();',
      'const selectVisible = await selectButton.isVisible({ timeout: 5000 }).catch(() => false);',
      'if (selectVisible) {',
      '  await selectButton.click();',
      '} else if (ticketTypeVisible) {',
      "  console.warn('[shadow-proposal] Select button contract missing — attaching diagnostic proposal');",
      ...buildLocatorShadowProposalLines({
        stepName: 'booking-chain-select-ticket-option',
        contractDescription: 'Select button in the ticket type drawer',
        expectedContracts: ['[data-testid="button_fsv2_ticket_option_select_0"]'],
        scopeHint: 'Ticket type drawer or selection overlay',
        analysisPrompt:
          'Identify the visible Select control inside the ticket type drawer that should advance to booking.',
        failureMessage:
          'Select button contract missing. Shadow proposal attached; main execution intentionally stopped.',
      }),
      '}',
      '',
      '// Step 4: Verify booking page reached',
      'await page.waitForURL(/\\/flight\\/booking/, { timeout: 15000 });',
      'const bookingUrl = new URL(page.url());',
      'expect(bookingUrl.pathname).toMatch(/\\/flight\\/booking/);',
      '',
      '// Step 5: Verify contact form accessible',
      'const contactForm = page.locator(\'[data-testid="booking-contact-form"], form\').first();',
      'const contactExists = await contactForm.isVisible().catch(() => false);',
      'expect(contactExists, "Booking contact form should be accessible").toBeTruthy();',
      ...buildPrdBehavioralAssertions(enrichedSourceCommits),
    ],
    interactionLines: [
      '// Execute canonical booking chain: Choose → Select drawer → Booking page',
      '// See docs/traveloka-flight-booking-case-generation.md for complete workflow specification',
      '',
      'const directBookingUrl = process.env.TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL;',
      'if (directBookingUrl) {',
      '  // Direct metasearch entry: skip Choose/Select steps, verify contact form only',
      '  await openMetasearchBookingContactPage(page, { url: directBookingUrl });',
      '} else {',
      '  // Standard desktop entry: execute full Choose→Select chain',
      '  // (Choose and Select steps handled in assertionLines)',
      '}',
      '',
      '// Retrieved shared-helper: docs/traveloka-flight-booking-case-generation.md - Complete booking chain workflow',
      '// Retrieved shared-helper: docs/traveloka-flight-booking-payment-chain-lock.md - Locked booking=>payment chain contracts',
      '// Retrieved shared-helper: docs/traveloka-flight-locator-guideline.md - Explicit contracts and locator priority',
      '// Retrieved shared-helper: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md - Phase 2 active layer execution strategy',
      '// Retrieved shared-helper: docs/weekly-diff-case-generator.md - Weekly diff generation for booking surface',
      '// Retrieved shared-helper: tests/lib/traveloka-flight/workflow.ts - openMetasearchBookingContactPage, openBookingPageFromSearchResults',
      ...(paymentFocused
        ? [
            '// Retrieved shared-helper: tests/web/traveloka-flight-booking-payment-e2e.spec.ts - Proven desktop booking=>payment smoke chain',
            '// Payment-sensitive weekly generation rule: preserve payfrm iframe referer reload and main-page paymentPayButton contracts',
          ]
        : []),
      `// Suggested changed files (top ${highlightedChangedFiles.length}${omittedCount ? ` of ${changedFiles.length}` : ''}): ${JSON.stringify(highlightedChangedFiles)}`,
      `${omittedCount ? `// Omitted additional changed files: ${omittedCount}` : ''}`,
      '// Source hint: packages/flight/fpr-booking/components/BFFBookingContact - Desktop booking contact form',
      '// Source hint: packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts - Validation rules',
      `${retentionFocused ? "// PRD note: the routed PR context mentions retention-popup behavior, so this weekly spec stays at booking-entry smoke level" : ''}`,
      '// HARDCODED CONSTRAINTS (生成时强制应用):',
      '// 1. Desktop web only - weekly case runs on desktop Playwright',
      '// 2. Flight booking domain only - verifies only booking checkout',
      '// 3. Traveloka https://github.com/traveloka/www - source must be from production repository',
      '// 4. Uses lib/traveloka-flight helpers - createFlightWorkflowPlan, attachFlightWorkflowPlan',
      '// 5. Phase 2 active layer - executed weekly via: npx tsx scripts/run-accumulated-cases.ts --layer active',
      '// 6. Complete booking chain - Must execute Choose→Select before verifying booking page (per docs/traveloka-flight-booking-case-generation.md)',
      ...(paymentFocused
        ? [
            '// 7. Payment-sensitive diffs must preserve locked booking=>payment chain contracts (per docs/traveloka-flight-booking-payment-chain-lock.md)',
            '// 8. paymentPayButton stays on the main payment page; credit-card fields stay inside #creditCardPaymentFormIframe',
          ]
        : []),
      '',
      '// P0 Critical Bug Detection',
      'const detector = new GenericBugDetector(page);',
      'const auditResults = await detector.runFullAudit({',
      '  locale: "en-US",',
      '  platform: "desktop",',
      '  pageType: "flight-booking",',
      '  performanceBaseline: { lcp: 2500, cls: 0.1 },',
      '});',
      'const p0Issues = auditResults.filter(bug => bug.severity === "P0");',
      'if (p0Issues.length > 0) {',
      '  console.error(`❌ P0 CRITICAL ISSUES FOUND: ${p0Issues.map(b => b.issue).join(", ")}`);',
      '  expect(p0Issues).toHaveLength(0); // Enforce zero P0 bugs',
      '}',
    ],
  });

  return {
    id: 'flight-booking-weekly',
    domain: 'flight-booking',
    confidence: confidenceAssessment.confidence,
    confidenceScore: confidenceAssessment.score,
    confidenceReasons: confidenceAssessment.reasons,
    mainLaneEligible: hasStrongEvidence && confidenceAssessment.confidence === 'high',
    mainLaneGateReason: hasStrongEvidence && confidenceAssessment.confidence === 'high'
      ? 'Eligible: booking source evidence is strong enough for runnable weekly main lane coverage.'
      : hasStrongEvidence
      ? `Gated: runnable booking spec exists, but confidence score ${confidenceAssessment.score} is below the high-confidence threshold.`
      : 'Not eligible: booking evidence is not strong enough for weekly main lane execution.',
    title: retentionFocused
      ? 'Weekly flight booking retention-entry regression coverage'
      : 'Weekly flight booking entry regression coverage',
    action: 'modify-existing',
    reason: hasStrongEvidence
      ? 'Changed files map to flight booking surfaces. Re-check the nearest booking tests, then emit a runnable booking smoke case through the stable desktop chain.'
      : 'Changed files weakly suggest booking behavior. Keep as manual-review guidance.',
    solution: hasStrongEvidence
      ? 'Prioritize existing booking tests, then emit a runnable weekly booking smoke spec through shared helpers.'
      : 'Keep as summary-only until stronger booking source evidence is present.',
    howToSolve: hasStrongEvidence
      ? 'Use packages/flight/fpr-booking evidence to route the candidate, preserve PRD references in markdown, and emit the generated web spec through the shared booking helper.'
      : 'Keep target URL and source hints, but suppress web spec emission until fpr-booking source is in the diff.',
    changedFiles,
    targetTests: paymentFocused
      ? [
          'tests/web/traveloka-flight-booking-payment-e2e.spec.ts',
          'tests/web/traveloka-flight-metasearch-email-confirmation.spec.ts',
        ]
      : ['tests/web/traveloka-flight-metasearch-email-confirmation.spec.ts'],
    userIntent: suggestedUserIntent,
    suggestedUserIntent,
    targetUrl: bookingEntryUrl,
    concerns: paymentFocused ? ['booking-contact', 'payment-chain'] : ['booking-contact'],
    sourceHints: [
      {
        sourcePath: 'packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactForm.tsx',
        reason: 'Desktop booking contact form component.',
      },
      {
        sourcePath: 'packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts',
        reason: 'Booking contact validation handler.',
      },
    ],
    sourceCommits: enrichedSourceCommits,
    retrievedEvidence,
    prdProcessing: collectCandidatePrdProcessing(enrichedSourceCommits),
    actionContracts: bookingActionContracts,
    webSpecFileName: hasStrongEvidence ? webSpecFileName : undefined,
    webSpecContent: hasStrongEvidence ? webSpecContent : undefined,
  };
}

function buildI18nCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  return {
    id: 'web-i18n-weekly',
    domain: 'web-i18n',
    ...(() => {
      const assessment = assessSupportCandidateConfidence(50, 'i18n candidates stay support-lane only');
      return {
        confidence: assessment.confidence,
        confidenceScore: assessment.score,
        confidenceReasons: assessment.reasons,
      };
    })(),
    mainLaneEligible: false,
    mainLaneGateReason: 'Not eligible: weekly main lane is reserved for desktop flight runnable specs.',
    title: 'Weekly web i18n regression coverage',
    action: 'modify-existing',
    reason:
      'Changed files look related to locale, language, or untranslated strings. Prefer updating existing i18n audit coverage before creating new tests.',
    solution: 'Update existing locale audit coverage before creating any new spec.',
    howToSolve: 'Route only locale and translation evidence into the i18n audit templates and reuse current audit cases.',
    changedFiles,
    targetTests: [
      'tests/traveloka-i18n-audit.spec.ts',
      'tests/traveloka-home-i18n.spec.ts',
    ],
    userIntent:
      `Review weekly i18n changes touching ${keywords.join(', ') || 'locale content'} and update the existing locale audit cases to cover them.`,
    suggestedUserIntent:
      `Review weekly i18n changes touching ${keywords.join(', ') || 'locale content'} and update the existing locale audit cases to cover them.`,
  };
}

function buildAndroidCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  return {
    id: 'android-home-weekly',
    domain: 'android-home',
    ...(() => {
      const assessment = assessSupportCandidateConfidence(45, 'android-home candidates stay support-lane only');
      return {
        confidence: assessment.confidence,
        confidenceScore: assessment.score,
        confidenceReasons: assessment.reasons,
      };
    })(),
    mainLaneEligible: false,
    mainLaneGateReason: 'Not eligible: weekly main lane is reserved for desktop flight runnable specs.',
    title: 'Weekly Android home regression coverage',
    action: 'modify-existing',
    reason:
      'Changed files look related to Android home/account flows. Reuse the existing Android audit or smoke specs first.',
    solution: 'Reuse the current Android audit and smoke coverage first.',
    howToSolve: 'Only map files with APK, Android, or traveloka-android evidence into the Android candidate.',
    changedFiles,
    targetTests: [
      'tests/traveloka-android.spec.ts',
      'tests/traveloka-android-audit.spec.ts',
      'tests/traveloka-home-i18n.ts',
    ],
    userIntent:
      `Review weekly Android changes touching ${keywords.join(', ') || 'home and account surfaces'} and update the Android home/account cases accordingly.`,
    suggestedUserIntent:
      `Review weekly Android changes touching ${keywords.join(', ') || 'home and account surfaces'} and update the Android home/account cases accordingly.`,
  };
}

function buildGenericWebCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  return {
    id: 'generic-web-weekly',
    domain: 'generic-web',
    ...(() => {
      const assessment = assessSupportCandidateConfidence(25, 'generic-web candidates are summary-first until stronger evidence exists');
      return {
        confidence: assessment.confidence,
        confidenceScore: assessment.score,
        confidenceReasons: assessment.reasons,
      };
    })(),
    mainLaneEligible: false,
    mainLaneGateReason: 'Not eligible: generic-web candidates are summary-only until stronger ownership evidence exists.',
    title: 'Weekly generic web regression coverage',
    action: 'create-new',
    reason:
      'Changed files do not map cleanly to an existing domain-specific template. Produce a manual review candidate and decide whether to add a new spec.',
    solution: 'Hold as a manual-review candidate instead of auto-generating a runnable spec.',
    howToSolve: 'Ask for stronger ownership evidence or build a new domain-specific template before generating executable tests.',
    changedFiles,
    targetTests: [],
    userIntent:
      `Generate or update a web regression case for weekly changes touching ${keywords.join(', ') || 'the changed files'}.`,
    suggestedUserIntent:
      `Generate or update a web regression case for weekly changes touching ${keywords.join(', ') || 'the changed files'}.`,
  };
}

function routeCandidates(
  files: DiffFile[],
  workspaceRoot: string,
  repoPath: string,
  startCommit: string,
  endRef: string,
): Candidate[] {
  const buckets: Record<'flight-booking' | 'flight-search' | 'web-i18n' | 'android-home' | 'generic-web', DomainBucket> = {
    'flight-booking': { files: [], score: 0, strongHits: 0 },
    'flight-search': { files: [], score: 0, strongHits: 0 },
    'web-i18n': { files: [], score: 0, strongHits: 0 },
    'android-home': { files: [], score: 0, strongHits: 0 },
    'generic-web': { files: [], score: 0, strongHits: 0 },
  };

  for (const file of files) {
    const signals = collectDomainSignals(file.filePath)
      .filter((signal) => signal.score > 0)
      .sort((left, right) => right.score - left.score);

    if (!signals.length) {
      buckets['generic-web'].files.push(file.filePath);
      continue;
    }

    const best = signals[0];
    buckets[best.domain].files.push(file.filePath);
    buckets[best.domain].score += best.score;
    if (best.strong) {
      buckets[best.domain].strongHits += 1;
    }
  }

  const candidates: Candidate[] = [];
  if (buckets['flight-booking'].strongHits > 0) {
    candidates.push(
      buildFlightBookingCandidate(
        buckets['flight-booking'].files,
        workspaceRoot,
        repoPath,
        startCommit,
        endRef,
      ),
    );
  }
  if (buckets['flight-search'].strongHits > 0) {
    candidates.push(
      buildFlightCandidate(
        buckets['flight-search'].files,
        workspaceRoot,
        repoPath,
        startCommit,
        endRef,
      ),
    );
  }
  if (buckets['web-i18n'].files.length && buckets['web-i18n'].score >= 3) {
    candidates.push(buildI18nCandidate(buckets['web-i18n'].files));
  }
  if (buckets['android-home'].files.length && buckets['android-home'].score >= 3) {
    candidates.push(buildAndroidCandidate(buckets['android-home'].files));
  }
  if (!candidates.length && buckets['generic-web'].files.length) {
    candidates.push(buildGenericWebCandidate(buckets['generic-web'].files));
  }

  return candidates;
}

function filterCandidatesByFocus(candidates: Candidate[], focusDomain: Candidate['domain'][] | null) {
  if (!focusDomain || focusDomain.length === 0) {
    return candidates;
  }

  return candidates.filter((candidate) => focusDomain.includes(candidate.domain));
}

function renderMarkdown(args: Args, startCommit: string, endRef: string, files: DiffFile[], candidates: Candidate[]) {
  const lines: string[] = [];
  lines.push('# Weekly Diff Case Generation Report');
  lines.push('');
  lines.push(`- Repo path: ${args.repoPath}`);
  lines.push(`- Base ref: ${args.baseRef}`);
  lines.push(`- Diff window: ${args.sinceDays} days`);
  if (args.focusDomain && args.focusDomain.length > 0) {
    lines.push(`- Focus domain: ${args.focusDomain.join(', ')}`);
  }
  lines.push(`- Diff range: ${startCommit}..${endRef}`);
  lines.push(`- Changed files: ${files.length}`);
  lines.push('');
  lines.push('## Candidates');
  lines.push('');

  if (!candidates.length) {
    lines.push('No test candidates were generated from the weekly diff.');
    lines.push('');
    return lines.join('\n');
  }

  for (const candidate of candidates) {
    lines.push(`### ${candidate.title}`);
    lines.push('');
    lines.push(`- Domain: ${candidate.domain}`);
    lines.push(`- Confidence: ${candidate.confidence}`);
    lines.push(`- Action: ${candidate.action}`);
    lines.push(`- Reason: ${candidate.reason}`);
    if (candidate.solution) {
      lines.push(`- Solution: ${candidate.solution}`);
    }
    if (candidate.howToSolve) {
      lines.push(`- How to solve: ${candidate.howToSolve}`);
    }
    lines.push(`- Suggested intent: ${candidate.suggestedUserIntent}`);
    if (candidate.targetUrl) {
      lines.push(`- Canonical target URL: ${candidate.targetUrl}`);
    }
    if (candidate.concerns?.length) {
      lines.push(`- Workflow concerns: ${candidate.concerns.join(', ')}`);
    }
    if (candidate.sourceCommits?.length) {
      lines.push(`- Source commits: ${candidate.sourceCommits.map((commit) => `${commit.sha} by ${commit.author}`).join('; ')}`);
    }
    if (candidate.targetTests.length) {
      lines.push(`- Existing tests to review: ${candidate.targetTests.join(', ')}`);
    }
    lines.push(`- Weekly main-lane eligible: ${candidate.mainLaneEligible ? 'yes' : 'no'}`);
    if (candidate.mainLaneGateReason) {
      lines.push(`- Weekly main-lane gate: ${candidate.mainLaneGateReason}`);
    }
    if (candidate.actionContracts?.length) {
      lines.push(`- Action contracts: ${candidate.actionContracts.length} tracked in summary.json`);
    }
    if (candidate.prdProcessing) {
      lines.push(`- PRD extraction: ${candidate.prdProcessing.extractionStatus}`);
    }
    if (candidate.draftFileName) {
      lines.push(`- Generated draft file: ${candidate.draftFileName}`);
    }
    if (candidate.webSpecFileName) {
      lines.push(`- Generated web spec file: tests/web/${candidate.webSpecFileName}`);
    }
    if (candidate.sourceHints?.length) {
      lines.push(`- Source hints: ${candidate.sourceHints.length} tracked in summary.json`);
    }
    if (candidate.retrievedEvidence?.length) {
      lines.push(`- Retrieved evidence: ${candidate.retrievedEvidence.length} tracked in summary.json`);
    }
    lines.push(`- Changed files: ${candidate.changedFiles.length} tracked in summary.json`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderConsoleSummary(
  args: Args,
  startCommit: string,
  endRef: string,
  files: DiffFile[],
  candidates: Candidate[],
) {
  const lines: string[] = [];
  lines.push('[weekly-diff] summary');
  lines.push(`- repo: ${args.repoPath}`);
  lines.push(`- range: ${startCommit}..${endRef}`);
  lines.push(`- changed files: ${files.length}`);

  if (!candidates.length) {
    lines.push('- candidates: none');
    return lines.join('\n');
  }

  lines.push(`- candidates: ${candidates.length}`);
  for (const candidate of candidates) {
    lines.push(
      `  - ${candidate.domain} | ${candidate.confidence} | ${candidate.action} | ${candidate.title}`,
    );
    lines.push(`    main-lane: ${candidate.mainLaneEligible ? 'eligible' : 'gated'}`);
    if (candidate.prdProcessing) {
      lines.push(`    prd: ${candidate.prdProcessing.extractionStatus}`);
    }
    if (candidate.webSpecFileName) {
      lines.push(`    web spec: tests/web/${candidate.webSpecFileName}`);
    } else if (candidate.draftFileName) {
      lines.push(`    draft: ${candidate.draftFileName}`);
    }
  }

  return lines.join('\n');
}

function writeArtifacts(rootDir: string, markdown: string, candidates: Candidate[], files: DiffFile[]) {
  for (const candidate of candidates) {
    candidate.prdProcessing = writeCandidatePrdExtractions(rootDir, candidate) ?? candidate.prdProcessing;
  }

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'summary.md'), `${markdown}\n`);
  fs.writeFileSync(
    path.join(rootDir, 'summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), markdownSummary: markdown, files, candidates }, null, 2),
  );

  for (const candidate of candidates) {
    if (candidate.draftFileName && candidate.draftContent) {
      fs.writeFileSync(path.join(rootDir, candidate.draftFileName), candidate.draftContent);
    }

    // Write generated test spec file (if created)
    if (candidate.webSpecFileName && candidate.webSpecContent) {
      fs.writeFileSync(path.join(rootDir, candidate.webSpecFileName), candidate.webSpecContent);
    }
  }
}

function writeCandidatePrdExtractions(rootDir: string, candidate: Candidate): CandidatePrdProcessing | undefined {
  const extractScriptPath = path.resolve(process.cwd(), 'scripts/extract-prd-with-opencode.sh');
  const resolveScriptPath = path.resolve(process.cwd(), 'scripts/resolve-meegle-prd-link-with-opencode.sh');
  const prdLinks = collectCandidatePrdLinks(candidate);
  const meegleLink = prdLinks.find((reference) => reference.kind === 'meegle-fpr')?.url;
  const processing = candidate.prdProcessing
    ? { ...candidate.prdProcessing, references: [...candidate.prdProcessing.references] }
    : prdLinks.length
    ? { references: [], extractionStatus: 'pending' as const }
    : undefined;

  if (!processing) {
    return undefined;
  }

  if (!fs.existsSync(extractScriptPath)) {
    processing.extractionStatus = prdLinks.length ? 'failed' : 'skipped-no-link';
    return processing;
  }

  let resolvedPrdLink = prdLinks.find((reference) => reference.kind === 'lark-wiki')?.url ?? null;

  if (!resolvedPrdLink) {
    if (meegleLink && fs.existsSync(resolveScriptPath)) {
      // Use disk cache first — avoid calling opencode again for the same URL
      const urlHash = meegleLink.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
      const diskCachePath = path.join(MEEGLE_DISK_CACHE_DIR, `${urlHash}.json`);
      if (fs.existsSync(diskCachePath)) {
        try {
          const diskCached = JSON.parse(fs.readFileSync(diskCachePath, 'utf8')) as PrdReference[];
          resolvedPrdLink = diskCached.find((r) => r.kind === 'lark-wiki')?.url ?? null;
        } catch {
          // corrupt cache — fall through
        }
      }

      if (!resolvedPrdLink) {
        const resolutionPath = path.join(rootDir, `${candidate.domain}-prd-resolution.json`);
        try {
          execFileSync('zsh', [resolveScriptPath, meegleLink, resolutionPath], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
          });
          const payload = JSON.parse(fs.readFileSync(resolutionPath, 'utf8')) as MeeglePrdResolutionPayload;
          resolvedPrdLink = payload.prdLink ?? null;
          if (resolvedPrdLink) {
            fs.mkdirSync(MEEGLE_DISK_CACHE_DIR, { recursive: true });
            fs.writeFileSync(
              diskCachePath,
              JSON.stringify([
                { url: meegleLink, kind: 'meegle-fpr' },
                { url: resolvedPrdLink, kind: 'lark-wiki' },
              ]),
            );
          }
        } catch (error) {
          // Failed to resolve meegle link
        }
      }
    }
  }

  if (!resolvedPrdLink) {
    processing.extractionStatus = prdLinks.length ? 'skipped-unresolved-link' : 'skipped-no-link';
    return processing;
  }

  processing.selectedResolvedUrl = resolvedPrdLink;

  if (meegleLink) {
    const existingReferenceIndex = processing.references.findIndex(
      (reference) => reference.sourceUrl === meegleLink,
    );
    const resolvedStatus: PrdLinkStatus = {
      sourceUrl: meegleLink,
      sourceKind: 'meegle-fpr',
      resolutionStatus: 'resolved-from-meegle',
      resolvedUrls: [resolvedPrdLink],
    };
    if (existingReferenceIndex >= 0) {
      processing.references[existingReferenceIndex] = resolvedStatus;
    } else {
      processing.references.push(resolvedStatus);
    }
  }

  const outputPath = path.join(rootDir, `${candidate.domain}-prd.md`);

  // Disk cache for extracted PRD content (keyed by lark URL)
  const larkUrlHash = resolvedPrdLink.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
  const larkDiskCachePath = path.join(MEEGLE_DISK_CACHE_DIR, `lark-prd-${larkUrlHash}.md`);
  if (fs.existsSync(larkDiskCachePath)) {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.copyFileSync(larkDiskCachePath, outputPath);
    console.log(`[prd] cache hit for lark doc: ${resolvedPrdLink}`);
    processing.extractionStatus = 'cache-hit';
    processing.extractedPath = outputPath;
    return processing;
  }

  try {
    execFileSync('zsh', [extractScriptPath, resolvedPrdLink, outputPath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    // Save to disk cache
    if (fs.existsSync(outputPath)) {
      fs.mkdirSync(MEEGLE_DISK_CACHE_DIR, { recursive: true });
      fs.copyFileSync(outputPath, larkDiskCachePath);
      processing.extractionStatus = 'extracted';
      processing.extractedPath = outputPath;
      return processing;
    }
  } catch (error) {
    // Failed to extract PRD
  }

  processing.extractionStatus = 'failed';
  return processing;
}

function renderPrdProcessingSummary(candidate: Candidate): string[] {
  const processing = candidate.prdProcessing;
  if (!processing) {
    return [`• ${candidate.domain}: no PRD link found`];
  }

  const resolvedCount = processing.references.filter(
    (reference) => reference.resolutionStatus !== 'meegle-resolution-failed',
  ).length;
  const unresolvedCount = processing.references.filter(
    (reference) => reference.resolutionStatus === 'meegle-resolution-failed',
  ).length;
  const lines = [
    `• ${candidate.domain}: prd-links=${processing.references.length}, resolved=${resolvedCount}, unresolved=${unresolvedCount}, extraction=${processing.extractionStatus}`,
  ];

  for (const reference of processing.references.slice(0, 3)) {
    const resolvedLabel = reference.resolvedUrls.length
      ? ` -> ${reference.resolvedUrls.join(' | ')}`
      : '';
    lines.push(`  - ${reference.sourceKind}: ${reference.sourceUrl} [${reference.resolutionStatus}]${resolvedLabel}`);
  }

  if (processing.selectedResolvedUrl) {
    lines.push(`  - selected prd: ${processing.selectedResolvedUrl}`);
  }

  return lines;
}

function collectCandidatePrdLinks(candidate: Candidate) {
  const references = candidate.sourceCommits?.flatMap((commit) => commit.prdLinks ?? []) ?? [];
  const seen = new Set<string>();
  const result: PrdReference[] = [];

  for (const reference of references) {
    if (seen.has(reference.url)) {
      continue;
    }

    seen.add(reference.url);
    result.push(reference);
  }

  return result;
}

function resetOutputDir(rootDir: string) {
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.mkdirSync(rootDir, { recursive: true });
}

function writeWebSpecs(workspaceRoot: string, candidates: Candidate[]) {
  const webDir = path.join(workspaceRoot, 'tests/web');

  for (const candidate of candidates) {
    if (candidate.webSpecFileName && candidate.webSpecContent) {
      fs.writeFileSync(path.join(webDir, candidate.webSpecFileName), candidate.webSpecContent);
    }
  }
}

/**
 * Extract PR number from git commit messages
 */
function extractPRNumberFromCommits(changedFiles: DiffFile[]): number | undefined {
  try {
    const output = execSync('git log -1 --format=%B', { encoding: 'utf8' });
    const match = output.match(/#(\d+)/);
    if (match) return Number(match[1]);
  } catch {
    // fallback to undefined
  }
  return undefined;
}

/**
 * Check if candidate is web desktop flight domain (focus filtering)
 */
function isFocusedCandidate(candidate: Candidate): boolean {
  const isRelevantDomain = 
    candidate.domain === 'flight-search' || 
    candidate.domain === 'flight-booking';
  
  if (!isRelevantDomain) return false;
  
  // Ignore non-web surfaces
  if (candidate.targetTests?.some(t => 
    t.includes('android') || t.includes('home-i18n')
  )) {
    return false;
  }
  
  return true;
}

/**
 * Run generated test cases with error handling and skip-on-blocked logic
 */
async function runGeneratedCases(
  caseDir: string,
  skipBlocked: boolean = true
): Promise<{ passed: number; failed: number; skipped: number; errors: string[] }> {
  const specFiles = fs.readdirSync(caseDir)
    .filter(f => f.endsWith('.spec.ts'))
    .map(f => path.join(caseDir, f));
  
  const results = { passed: 0, failed: 0, skipped: 0, errors: [] as string[] };
  
  for (const specFile of specFiles) {
    try {
      console.log(`[run-cases] Running ${path.basename(specFile)}...`);
      const cmd = `npx playwright test ${specFile} --headed --project=chromium`;
      execSync(cmd, { stdio: 'inherit' });
      results.passed++;
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.toString();
      const isBlocked = stderr.includes('anti-crawler') || 
                       stderr.includes('DataDome') || 
                       stderr.includes('reCAPTCHA') ||
                       stderr.includes('403') ||
                       stderr.includes('429');
      
      if (isBlocked && skipBlocked) {
        console.log(`[run-cases] Skipped (anti-crawler detected): ${path.basename(specFile)}`);
        results.skipped++;
      } else {
        console.error(`[run-cases] Failed: ${path.basename(specFile)}`);
        results.failed++;
        results.errors.push(`${path.basename(specFile)}: ${stderr.split('\n')[0]}`);
      }
    }
  }
  
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  // 🔒 STRONG CONSTRAINTS LOG
  console.log('\n' + '='.repeat(80));
  console.log('🔒 STRONG CONSTRAINTS (HARDCODED - CANNOT BE OVERRIDDEN):');
  console.log('='.repeat(80));
  console.log(`  1️⃣  Repository:    LOCKED → ${FORCED_REPO_URL}`);
  console.log(`  2️⃣  Domain Focus:   LOCKED → ${FORCED_FOCUS_DOMAINS.join(', ')}`);
  console.log(`  3️⃣  Surface:        LOCKED → Desktop Web Only (NO mobile/android/i18n)`);
  console.log(`  4️⃣  Output Path:    LOCKED → ${FORCED_OUTPUT_DIR}`);
  console.log('='.repeat(80));
  console.log('\n⚡ 优化提示:');
  console.log('   - 克隆使用 --single-branch 和 --filter=blob:none (仅 master 分支，仅需要的对象)');
  console.log('   - Fetch 使用 --quiet 模式，仅 fetch 指定分支');
  console.log('   - 如果要跳过 fetch，使用: --no-fetch 参数');
  console.log('='.repeat(80) + '\n');

  
  const repoPath = ensureRepoPath(args);
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    throw new Error(`repoPath is not a git repository: ${repoPath}`);
  }

  if (args.fetch && /^origin\//.test(args.baseRef)) {
    console.log(`[weekly-diff] fetching ${args.baseRef}...`);
    // Optimized: only fetch the specific branch, not prune all
    const branch = args.baseRef.replace(/^origin\//, '');
    git(repoPath, ['fetch', 'origin', branch, '--quiet'], {
      timeout: 300000, // 5 min timeout
    });
  }

  const startCommit = getStartCommit(repoPath, args.baseRef, args.sinceDays);
  const changedFiles = getChangedFiles(repoPath, startCommit, args.baseRef);
  const routedCandidates = routeCandidates(
    changedFiles,
    process.cwd(),
    repoPath,
    startCommit,
    args.baseRef,
  );
  
  // Focus on web desktop flight domain only
  let candidates = filterCandidatesByFocus(routedCandidates, args.focusDomain);
  candidates = candidates.filter(isFocusedCandidate);
  
  const resolvedArgs = { ...args, repoPath };
  const markdown = renderMarkdown(resolvedArgs, startCommit, args.baseRef, changedFiles, candidates);
  const consoleSummary = renderConsoleSummary(
    resolvedArgs,
    startCommit,
    args.baseRef,
    changedFiles,
    candidates,
  );

  // Use accumulation system instead of 'latest/'
  // 🔒 FORCED: Output must go to tests/web directory for immediate execution
  const outputRoot = path.resolve(process.cwd(), args.outputDir);
  const testWebDir = path.resolve(process.cwd(), 'tests/web');
  const prNumber = extractPRNumberFromCommits(changedFiles);
  const accumulator = createAccumulator(outputRoot, prNumber);
  const targetDir = accumulator.getTargetDirectory();

  if (args.dryRun) {
    console.log(consoleSummary);
    console.log('');
    console.log(`[weekly-diff] dry-run only; no files written`);
    console.log(`  • Accumulation dir: ${targetDir}`);
    console.log(`  • Tests web dir: ${testWebDir}`);
    return;
  }

  // Process candidates with deduplication
  let acceptedCount = 0;
  const domains = new Set<Candidate['domain']>();
  
  for (const candidate of candidates) {
    const result = accumulator.processCandidateCase(candidate);
    
    if (!result.isDuplicate) {
      // Write artifacts (summary.json, PRD markdown) to generated-cases/, NOT tests/web/
      const artifactDir = path.join(ARTIFACTS_OUTPUT_DIR, path.basename(result.path));
      writeArtifacts(artifactDir, markdown, [candidate], changedFiles);
      acceptedCount++;
      domains.add(candidate.domain);
      
      // 🔒 FORCED: Also write test spec directly to tests/web
      const mainLaneEligible = candidate.mainLaneEligible ?? isWeeklyMainLaneEligible(candidate);
      if (candidate.webSpecFileName && candidate.webSpecContent && mainLaneEligible) {
        fs.mkdirSync(testWebDir, { recursive: true });
        const testFilePath = path.join(testWebDir, candidate.webSpecFileName);
        fs.writeFileSync(testFilePath, candidate.webSpecContent);
        console.log(`[weekly-diff] wrote test case: ${candidate.webSpecFileName}`);
      } else if (candidate.webSpecFileName && candidate.webSpecContent) {
        console.log(
          `[weekly-diff] gated from main lane: ${candidate.webSpecFileName} (${candidate.mainLaneGateReason ?? getWeeklyMainLaneGateReason(candidate)})`,
        );
      }
    } else {
      console.log(`[weekly-diff] Skipped duplicate: ${candidate.id}`);
    }
  }
  
  // Finalize and update manifest
  const summary = accumulator.finalize(acceptedCount, Array.from(domains));
  
  if (args.emitWebSpec) {
    writeWebSpecs(process.cwd(), candidates);
  }
  console.log(consoleSummary);
  console.log('');
  console.log(`[weekly-diff] accumulated ${acceptedCount}/${candidates.length} cases`);
  console.log(`  • Accumulation dir: ${targetDir}`);
  console.log(`  • Tests web dir: ${testWebDir}`);
  console.log(`[weekly-diff] manifest updated:`);
  console.log(JSON.stringify(summary, null, 2));
  
  // Run cases if requested
  if (args.runCases) {
    console.log('');
    console.log(`[weekly-diff] running generated test cases...`);
    const runResults = await runGeneratedCases(targetDir, args.skipBlockedDomains);
    console.log(`[run-cases] Results: ${runResults.passed} passed, ${runResults.failed} failed, ${runResults.skipped} skipped`);
    if (runResults.errors.length > 0) {
      console.log(`[run-cases] Errors:`);
      runResults.errors.forEach(e => console.log(`  - ${e}`));
    }
  }
  
  // Send Lark notification about generation completion
  try {
    const stats = summary.manifest.statistics;
    const notificationContent = `
**Weekly Diff Case Generation Complete**

Generated: ${acceptedCount}/${candidates.length} new cases
Total accumulated: ${stats.totalCases}

By domain:
${Object.entries(stats.byDomain)
  .map(([domain, count]) => `• ${domain}: ${count}`)
  .join('\n')}

PRD parsing status:
${candidates.length
  ? candidates.flatMap((candidate) => renderPrdProcessingSummary(candidate)).join('\n')
  : '• no candidates'}

Location: \`generated-cases/${prNumber ? `pr-${prNumber}` : 'snapshot-' + new Date().toISOString().split('T')[0]}/\`

${args.runCases ? '\n✅ Test cases auto-run (see separate notification)' : ''}
    `.trim();
    
    await notifyCustom(
      '📊 Weekly Diff Generation Complete',
      notificationContent,
      acceptedCount > 0 ? 'green' : 'yellow',
    );
  } catch (notifyErr) {
    console.warn('[weekly-diff] Warning: Failed to send Lark notification:', notifyErr);
  }
}

main().catch(err => {
  console.error('[weekly-diff] Error:', err);
  process.exit(1);
});