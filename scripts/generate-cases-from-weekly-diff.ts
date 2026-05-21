#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  buildFlightSourceContextFromFiles,
  type FlightConcern,
} from '../tests/lib/traveloka-flight/source-map';
import { createFlightCaseTemplate } from '../tests/lib/traveloka-flight/template';

type Args = {
  repoPath: string | null;
  repoUrl: string | null;
  repoCacheDir: string;
  focusDomain: Candidate['domain'] | null;
  emitWebSpec: boolean;
  baseRef: string;
  sinceDays: number;
  outputDir: string;
  fetch: boolean;
  dryRun: boolean;
};

type DiffFile = {
  status: string;
  filePath: string;
};

type Candidate = {
  id: string;
  domain: 'flight-search' | 'web-i18n' | 'android-home' | 'generic-web';
  confidence: 'high' | 'medium' | 'low';
  title: string;
  action: 'modify-existing' | 'create-new';
  reason: string;
  solution?: string;
  howToSolve?: string;
  changedFiles: string[];
  targetTests: string[];
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
  }>;
  retrievedEvidence?: Array<{
    kind: 'existing-test' | 'shared-helper';
    path: string;
    reason: string;
    summary: string;
  }>;
  draftFileName?: string;
  draftContent?: string;
  webSpecFileName?: string;
  webSpecContent?: string;
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
};

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
};

type SourceCommitMetadata = {
  sha: string;
  author: string;
  subject: string;
  prNumber?: number;
  prTitle?: string;
  prSummary?: string;
  prTestPlan?: string;
};

type GitHubRepoIdentity = {
  owner: string;
  name: string;
};

const DEFAULT_OUTPUT_DIR = 'generated-cases/weekly-diff';
const DEFAULT_BASE_REF = 'origin/master';
const DEFAULT_REPO_CACHE_DIR = '.cache/weekly-diff-repos';
function parseArgs(argv: string[]): Args {
  const result: Args = {
    repoPath: null,
    repoUrl: null,
    repoCacheDir: DEFAULT_REPO_CACHE_DIR,
    focusDomain: null,
    emitWebSpec: false,
    baseRef: DEFAULT_BASE_REF,
    sinceDays: 7,
    outputDir: DEFAULT_OUTPUT_DIR,
    fetch: true,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--repo-path' && next) {
      result.repoPath = path.resolve(next);
      i++;
    } else if (arg === '--repo-url' && next) {
      result.repoUrl = next;
      i++;
    } else if (arg === '--repo-cache-dir' && next) {
      result.repoCacheDir = next;
      i++;
    } else if (arg === '--focus-domain' && next) {
      result.focusDomain = next as Candidate['domain'];
      i++;
    } else if (arg === '--emit-web-spec') {
      result.emitWebSpec = true;
    } else if (arg === '--base-ref' && next) {
      result.baseRef = next;
      i++;
    } else if (arg === '--since-days' && next) {
      result.sinceDays = Number(next);
      i++;
    } else if (arg === '--output-dir' && next) {
      result.outputDir = next;
      i++;
    } else if (arg === '--no-fetch') {
      result.fetch = false;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    }
  }

  if (!Number.isFinite(result.sinceDays) || result.sinceDays <= 0) {
    throw new Error(`Invalid --since-days value: ${result.sinceDays}`);
  }

  if (
    result.focusDomain &&
    !['flight-search', 'web-i18n', 'android-home', 'generic-web'].includes(result.focusDomain)
  ) {
    throw new Error(`Invalid --focus-domain value: ${result.focusDomain}`);
  }

  if (!result.repoPath && !result.repoUrl) {
    result.repoPath = process.cwd();
  }

  return result;
}

function git(repoPath: string, args: string[]) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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
    execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', args.repoUrl, repoPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

function fetchPullRequestContext(repoPath: string, prNumber: number) {
  const repoIdentity = getGitHubRepoIdentity(repoPath);
  const githubToken = process.env.GITHUB_TOKEN;

  if (!repoIdentity || !githubToken) {
    return null;
  }

  try {
    const response = execFileSync(
      'curl',
      [
        '-fsSL',
        '-H', `Authorization: Bearer ${githubToken}`,
        '-H', 'Accept: application/vnd.github+json',
        `https://api.github.com/repos/${repoIdentity.owner}/${repoIdentity.name}/pulls/${prNumber}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const payload = JSON.parse(response) as { title?: string; body?: string };
    const body = payload.body ?? '';
    const summary = extractPullRequestBodySection(body, 'Summary');
    const testPlan = extractPullRequestBodySection(body, 'Test Plan');

    return {
      title: payload.title?.trim() || null,
      summary,
      testPlan,
    };
  } catch {
    return null;
  }
}

function enrichRelevantCommitsWithPullRequestContext(
  repoPath: string,
  commits: Array<{ sha: string; author: string; subject: string }>,
): SourceCommitMetadata[] {
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function buildFlightGeneratedPlan(
  concerns: FlightConcern[],
  retrievedEvidence: NonNullable<Candidate['retrievedEvidence']>,
  changedFiles: string[],
  fileWeights?: Map<string, number>,
): FlightGeneratedPlan {
  const importLines = new Set<string>();
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

  importLines.add('import { travelokaFlightSearchResultsSelectors } from ../lib/traveloka-flight/locators;');
  assertionLines.push(
    'await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible({ timeout: 15000 });',
    'await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible({ timeout: 15000 });',
  );

  if (concerns.includes('transit-filter')) {
    importLines.add('import { clickTransitCountFilter, expectTransitCountFilterChecked, getTransitCountSection } from ../lib/traveloka-flight/locators;');
    assertionLines.push('await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });');
    interactionLines.push(
      "await clickTransitCountFilter(page, 'ONE_TRANSIT');",
      "await page.waitForLoadState('networkidle').catch(() => {});",
      "await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');",
    );
  }

  if (concerns.includes('airline-filter')) {
    importLines.add('import { discoverFlightFilterOptionsInSection, getTaggedFlightResultCards, tagVisibleFlightResultCards } from ../lib/traveloka-flight/locators;');
    interactionLines.push(
      "const discoveredAirlines = await discoverFlightFilterOptionsInSection(sidebar, 'Airline', 'data-weekly-airline-option-idx');",
      "await testInfo.attach('weekly-discovered-airlines.json', {",
      '  body: Buffer.from(JSON.stringify(discoveredAirlines, null, 2)),',
      "  contentType: 'application/json',",
      '});',
      "expect(discoveredAirlines.length, 'Weekly generated case expects at least one airline filter option in the sidebar.').toBeGreaterThan(0);",
      'const chosenAirline = discoveredAirlines[0];',
      'await sidebar.locator(`[data-weekly-airline-option-idx="${chosenAirline.filterOptionIdx}"]`).click({ force: true });',
      "await page.waitForLoadState('networkidle').catch(() => {});",
      "const taggedCardCount = await tagVisibleFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "const cards = getTaggedFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "expect(taggedCardCount, 'Weekly generated case expects visible flight result cards after selecting the first airline filter.').toBeGreaterThan(0);",
      'await expect(cards.first()).toBeVisible({ timeout: 15000 });',
      'const airlineName = chosenAirline.labelText.replace(/\\s*S?\\$\\s*\\d[\\d,]*(?:\\.\\d+)?\\s*$/i, \"\").replace(/\\s*\\(\\d+\\)\\s*$/, \"\").trim();',
      'const firstCardText = await cards.first().innerText();',
      'expect(firstCardText.toLowerCase()).toContain(airlineName.toLowerCase());',
    );
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
  const sourceSummaryLines = uniqueStrings(
    enrichedSourceCommits
      .flatMap((commit: SourceCommitMetadata) => [commit.prSummary, commit.prTestPlan])
      .filter((value): value is string => Boolean(value)),
  ).slice(0, 2);
  const retrievedEvidence = collectFlightRetrievedEvidence(workspaceRoot, focus.concerns) ?? [];
  const generatedPlan = buildFlightGeneratedPlan(
    focus.concerns,
    retrievedEvidence,
    focus.focusedFiles,
    fileWeights,
  );
  const webSpecFileName = 'traveloka-flight-weekly-diff-generated.spec.ts';
  const webSpecContent = createFlightCaseTemplate({
    testName: 'Traveloka weekly diff generated flight results coverage',
    url: sourceContext.url,
    userIntent: suggestedUserIntent,
    importPrefix: '../',
    extraImportBlock: generatedPlan.extraImportBlock,
    concerns: generatedPlan.concerns,
    sourceCommitLines: enrichedSourceCommits.map(
      (commit: { sha: string; author: string; subject: string }) =>
        `${commit.sha} by ${commit.author}: ${commit.subject}`,
    ),
    sourceSummaryLines,
    assertionLines: generatedPlan.assertionLines,
    interactionLines: [
      ...generatedPlan.interactionLines,
      ...sourceContext.sourceHints.map(
        (hint) => `// Source hint: ${hint.sourcePath} - ${hint.reason}`,
      ),
    ],
  });

  return {
    id: 'flight-search-weekly',
    domain: 'flight-search',
    confidence: canEmitRunnableSpec ? 'high' : hasStrongEvidence ? 'medium' : 'low',
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
    suggestedUserIntent,
    targetUrl: sourceContext.url,
    concerns: focus.concerns,
    sourceHints: sourceContext.sourceHints,
    sourceCommits: enrichedSourceCommits,
    retrievedEvidence,
    webSpecFileName: canEmitRunnableSpec ? webSpecFileName : undefined,
    webSpecContent: canEmitRunnableSpec ? webSpecContent : undefined,
  };
}

function buildI18nCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  return {
    id: 'web-i18n-weekly',
    domain: 'web-i18n',
    confidence: 'medium',
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
    suggestedUserIntent:
      `Review weekly i18n changes touching ${keywords.join(', ') || 'locale content'} and update the existing locale audit cases to cover them.`,
  };
}

function buildAndroidCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  return {
    id: 'android-home-weekly',
    domain: 'android-home',
    confidence: 'medium',
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
    suggestedUserIntent:
      `Review weekly Android changes touching ${keywords.join(', ') || 'home and account surfaces'} and update the Android home/account cases accordingly.`,
  };
}

function buildGenericWebCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  return {
    id: 'generic-web-weekly',
    domain: 'generic-web',
    confidence: 'low',
    title: 'Weekly generic web regression coverage',
    action: 'create-new',
    reason:
      'Changed files do not map cleanly to an existing domain-specific template. Produce a manual review candidate and decide whether to add a new spec.',
    solution: 'Hold as a manual-review candidate instead of auto-generating a runnable spec.',
    howToSolve: 'Ask for stronger ownership evidence or build a new domain-specific template before generating executable tests.',
    changedFiles,
    targetTests: [],
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
  const buckets: Record<'flight-search' | 'web-i18n' | 'android-home' | 'generic-web', DomainBucket> = {
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

function filterCandidatesByFocus(candidates: Candidate[], focusDomain: Candidate['domain'] | null) {
  if (!focusDomain) {
    return candidates;
  }

  return candidates.filter((candidate) => candidate.domain === focusDomain);
}

function renderMarkdown(args: Args, startCommit: string, endRef: string, files: DiffFile[], candidates: Candidate[]) {
  const lines: string[] = [];
  lines.push('# Weekly Diff Case Generation Report');
  lines.push('');
  lines.push(`- Repo path: ${args.repoPath}`);
  lines.push(`- Base ref: ${args.baseRef}`);
  lines.push(`- Diff window: ${args.sinceDays} days`);
  if (args.focusDomain) {
    lines.push(`- Focus domain: ${args.focusDomain}`);
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
    if (candidate.webSpecFileName) {
      lines.push(`    web spec: tests/web/${candidate.webSpecFileName}`);
    } else if (candidate.draftFileName) {
      lines.push(`    draft: ${candidate.draftFileName}`);
    }
  }

  return lines.join('\n');
}

function writeArtifacts(rootDir: string, markdown: string, candidates: Candidate[], files: DiffFile[]) {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), markdownSummary: markdown, files, candidates }, null, 2),
  );

  for (const candidate of candidates) {
    if (candidate.draftFileName && candidate.draftContent) {
      fs.writeFileSync(path.join(rootDir, candidate.draftFileName), candidate.draftContent);
    }
  }
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoPath = ensureRepoPath(args);
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    throw new Error(`repoPath is not a git repository: ${repoPath}`);
  }

  if (args.fetch && /^origin\//.test(args.baseRef)) {
    console.log(`[weekly-diff] fetching ${args.baseRef}...`);
    git(repoPath, ['fetch', 'origin', '--prune']);
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
  const candidates = filterCandidatesByFocus(routedCandidates, args.focusDomain);
  const resolvedArgs = { ...args, repoPath };
  const markdown = renderMarkdown(resolvedArgs, startCommit, args.baseRef, changedFiles, candidates);
  const consoleSummary = renderConsoleSummary(
    resolvedArgs,
    startCommit,
    args.baseRef,
    changedFiles,
    candidates,
  );

  const outputRoot = path.resolve(process.cwd(), args.outputDir, 'latest');

  if (args.dryRun) {
    console.log(consoleSummary);
    console.log('');
    console.log(`[weekly-diff] dry-run only; no files written to ${outputRoot}`);
    return;
  }

  resetOutputDir(outputRoot);
  writeArtifacts(outputRoot, markdown, candidates, changedFiles);
  if (args.emitWebSpec) {
    writeWebSpecs(process.cwd(), candidates);
  }
  console.log(consoleSummary);
  console.log('');
  console.log(`[weekly-diff] wrote artifacts to ${outputRoot}`);
  if (args.emitWebSpec) {
    console.log('[weekly-diff] wrote generated web specs to tests/web');
  }
}

main();