#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildFlightSourceContextFromFiles } from '../tests/lib/traveloka-flight/source-map';
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
  title: string;
  action: 'modify-existing' | 'create-new';
  reason: string;
  changedFiles: string[];
  targetTests: string[];
  suggestedUserIntent: string;
  targetUrl?: string;
  concerns?: string[];
  sourceHints?: Array<{
    sourcePath: string;
    reason: string;
  }>;
  draftFileName?: string;
  draftContent?: string;
  webSpecFileName?: string;
  webSpecContent?: string;
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
    execFileSync('git', ['clone', args.repoUrl, repoPath], {
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
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split(/\s+/g);
      return { status, filePath: rest[rest.length - 1] };
    });
}

function buildFlightCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  const phrase = keywords.length ? keywords.join(', ') : 'search results and filters';
  const suggestedUserIntent =
    `Open the desktop Traveloka flight search results page and validate the weekly regression areas touching ${phrase}. ` +
    'Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.';
  const sourceContext = buildFlightSourceContextFromFiles(changedFiles, suggestedUserIntent);
  const webSpecFileName = 'traveloka-flight-weekly-diff-generated.spec.ts';
  const webSpecContent = createFlightCaseTemplate({
    testName: 'Traveloka weekly diff generated flight results coverage',
    url: sourceContext.url,
    userIntent:
      'Open the desktop Traveloka flight search results page and validate the weekly regression areas for sidebar handling, airline filter discovery, and visible result-card tagging.',
    importPrefix: '../',
    extraImportBlock: `import {
  discoverFlightFilterOptionsInSection,
  getTaggedFlightResultCards,
  tagVisibleFlightResultCards,
  travelokaFlightSearchResultsSelectors,
} from '../lib/traveloka-flight/locators';`,
    concerns: ['results-list', 'airline-filter'],
    assertionLines: [
      'const currentUrl = new URL(page.url());',
      'expect(currentUrl.pathname).toBe(new URL(TARGET_URL).pathname);',
      "expect(workflowPlan.sourceContext.surface).toBe('search-results');",
      "if (!sidebar) {",
      "  throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');",
      '}',
      'await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible({ timeout: 15000 });',
      'await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible({ timeout: 15000 });',
    ],
    interactionLines: [
      "const discoveredAirlines = await discoverFlightFilterOptionsInSection(sidebar, 'Airline', 'data-weekly-airline-option-idx');",
      "await testInfo.attach('weekly-discovered-airlines.json', {",
      '  body: Buffer.from(JSON.stringify(discoveredAirlines, null, 2)),',
      "  contentType: 'application/json',",
      '});',
      "expect(discoveredAirlines.length, 'Weekly generated case expects at least one airline filter option in the sidebar.').toBeGreaterThan(0);",
      "const taggedCardCount = await tagVisibleFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "const cards = getTaggedFlightResultCards(page, 'data-weekly-flight-card-idx');",
      "expect(taggedCardCount, 'Weekly generated case expects visible flight result cards.').toBeGreaterThan(0);",
      'await expect(cards.first()).toBeVisible({ timeout: 15000 });',
      'const firstCardText = await cards.first().innerText();',
      "expect(firstCardText).toMatch(/flight details|fare\\s*&\\s*benefits/i);",
      'const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);',
      'if (screenshot) {',
      "  await testInfo.attach('weekly-generated-results.png', {",
      '    body: screenshot,',
      "    contentType: 'image/png',",
      '  });',
      '}',
      '// Weekly diff generated candidate: refine this case against the actual changed source files.',
      '// Suggested changed files: ' + JSON.stringify(changedFiles),
      ...sourceContext.sourceHints.map(
        (hint) => `// Source hint: ${hint.sourcePath} - ${hint.reason}`,
      ),
    ],
  });

  return {
    id: 'flight-search-weekly',
    domain: 'flight-search',
    title: 'Weekly flight search regression coverage',
    action: 'modify-existing',
    reason:
      'Changed files look related to flight search or results surfaces. Re-check existing search-results tests before adding new ones.',
    changedFiles,
    targetTests: [
      'tests/web/traveloka-flight-filter.spec.ts',
      'tests/web/traveloka-flight-random-filter.spec.ts',
    ],
    suggestedUserIntent,
    targetUrl: sourceContext.url,
    concerns: sourceContext.concerns,
    sourceHints: sourceContext.sourceHints,
    draftFileName: 'traveloka-flight-weekly-generated.spec.ts',
    draftContent: createFlightCaseTemplate({
      testName: 'Traveloka weekly diff generated flight search regression',
      url: sourceContext.url,
      userIntent: suggestedUserIntent,
      concerns: sourceContext.concerns,
      interactionLines: [
        '// Weekly diff generated candidate: refine this case against the actual changed source files.',
        '// Suggested changed files: ' + JSON.stringify(changedFiles),
        ...sourceContext.sourceHints.map(
          (hint) => `// Source hint: ${hint.sourcePath} - ${hint.reason}`,
        ),
      ],
    }),
    webSpecFileName,
    webSpecContent,
  };
}

function buildI18nCandidate(changedFiles: string[]): Candidate {
  const keywords = summarizeKeywords(changedFiles);
  return {
    id: 'web-i18n-weekly',
    domain: 'web-i18n',
    title: 'Weekly web i18n regression coverage',
    action: 'modify-existing',
    reason:
      'Changed files look related to locale, language, or untranslated strings. Prefer updating existing i18n audit coverage before creating new tests.',
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
    title: 'Weekly Android home regression coverage',
    action: 'modify-existing',
    reason:
      'Changed files look related to Android home/account flows. Reuse the existing Android audit or smoke specs first.',
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
    title: 'Weekly generic web regression coverage',
    action: 'create-new',
    reason:
      'Changed files do not map cleanly to an existing domain-specific template. Produce a manual review candidate and decide whether to add a new spec.',
    changedFiles,
    targetTests: [],
    suggestedUserIntent:
      `Generate or update a web regression case for weekly changes touching ${keywords.join(', ') || 'the changed files'}.`,
  };
}

function routeCandidates(files: DiffFile[]): Candidate[] {
  const buckets = {
    flight: [] as string[],
    i18n: [] as string[],
    android: [] as string[],
    generic: [] as string[],
  };

  for (const file of files) {
    const value = file.filePath.toLowerCase();
    if (/flight|airline|transit|fare|booking|search/.test(value)) {
      buckets.flight.push(file.filePath);
    } else if (/i18n|locale|language|translation|copy|dictionary/.test(value)) {
      buckets.i18n.push(file.filePath);
    } else if (/android|mobile|appentry|account|home/.test(value)) {
      buckets.android.push(file.filePath);
    } else {
      buckets.generic.push(file.filePath);
    }
  }

  const candidates: Candidate[] = [];
  if (buckets.flight.length) candidates.push(buildFlightCandidate(buckets.flight));
  if (buckets.i18n.length) candidates.push(buildI18nCandidate(buckets.i18n));
  if (buckets.android.length) candidates.push(buildAndroidCandidate(buckets.android));
  if (!candidates.length && buckets.generic.length) {
    candidates.push(buildGenericWebCandidate(buckets.generic));
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
    lines.push(`- Action: ${candidate.action}`);
    lines.push(`- Reason: ${candidate.reason}`);
    lines.push(`- Suggested intent: ${candidate.suggestedUserIntent}`);
    if (candidate.targetUrl) {
      lines.push(`- Canonical target URL: ${candidate.targetUrl}`);
    }
    if (candidate.concerns?.length) {
      lines.push(`- Workflow concerns: ${candidate.concerns.join(', ')}`);
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
      lines.push('- Source hints:');
      for (const hint of candidate.sourceHints) {
        lines.push(`  - ${hint.sourcePath}: ${hint.reason}`);
      }
    }
    lines.push('- Changed files:');
    for (const filePath of candidate.changedFiles) {
      lines.push(`  - ${filePath}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function writeArtifacts(rootDir: string, markdown: string, candidates: Candidate[], files: DiffFile[]) {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'summary.md'), markdown);
  fs.writeFileSync(
    path.join(rootDir, 'summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), files, candidates }, null, 2),
  );

  for (const candidate of candidates) {
    if (candidate.draftFileName && candidate.draftContent) {
      fs.writeFileSync(path.join(rootDir, candidate.draftFileName), candidate.draftContent);
    }
  }
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
  const routedCandidates = routeCandidates(changedFiles);
  const candidates = filterCandidatesByFocus(routedCandidates, args.focusDomain);
  const resolvedArgs = { ...args, repoPath };
  const markdown = renderMarkdown(resolvedArgs, startCommit, args.baseRef, changedFiles, candidates);

  const timestamp = new Date().toISOString().replace(/[:]/g, '-');
  const outputRoot = path.resolve(process.cwd(), args.outputDir, timestamp);

  if (args.dryRun) {
    console.log(markdown);
    console.log('');
    console.log(`[weekly-diff] dry-run only; no files written to ${outputRoot}`);
    return;
  }

  writeArtifacts(outputRoot, markdown, candidates, changedFiles);
  if (args.emitWebSpec) {
    writeWebSpecs(process.cwd(), candidates);
  }
  console.log(markdown);
  console.log('');
  console.log(`[weekly-diff] wrote artifacts to ${outputRoot}`);
  if (args.emitWebSpec) {
    console.log('[weekly-diff] wrote generated web specs to tests/web');
  }
}

main();