#!/usr/bin/env tsx
/**
 * Android Diff Workflow
 *
 * Full pipeline: android-v3 diff → generate → run → fix → notify → learn
 *
 * Stages:
 *   1. validate-env     — adb/maestro/device check
 *   2. sync-diff        — pull android-v3, identify changed flight files
 *   3. generate-cases   — AI generates Maestro YAML for affected scenarios
 *   4. run-cases        — maestro test, collect pass/fail + screenshots
 *   5. fix-failures     — AI fixes failed cases, optional re-verify
 *   6. notify           — Lark rich card with results + failed case details
 *   7. update-memory    — persist learning (flaky list, fix history)
 *
 * Usage:
 *   tsx scripts/android-diff-workflow.ts               # diff-triggered (default)
 *   tsx scripts/android-diff-workflow.ts --full        # run all 15 scenarios
 *   tsx scripts/android-diff-workflow.ts --no-fix      # skip AI fix stage
 *   tsx scripts/android-diff-workflow.ts --dry-run     # skip run/fix, just generate
 *   tsx scripts/android-diff-workflow.ts --priority p0 # run P0 only
 *
 * Case generation rules & constraints (MUST READ before changing generated YAMLs):
 *   docs/android-maestro-case-generation.md
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { notifyCustom } from './lib/lark-notifier';

// Ensure maestro + Java are always available regardless of how this script is invoked
const MAESTRO_BIN = `${process.env.HOME}/.maestro/bin`;
const JAVA_BIN = '/opt/homebrew/opt/openjdk@17/bin';
const BREW_BIN = '/opt/homebrew/bin';
const ADB_BIN = `${process.env.HOME}/Library/Android/sdk/platform-tools`;
process.env.JAVA_HOME = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17';
process.env.PATH = [MAESTRO_BIN, JAVA_BIN, BREW_BIN, ADB_BIN, process.env.PATH].join(':');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FULL_RUN = args.includes('--full');
const NO_FIX = args.includes('--no-fix');
const DRY_RUN = args.includes('--dry-run');
const PRIORITY = (() => { const i = args.indexOf('--priority'); return i !== -1 ? args[i + 1] : null; })();
const SOURCE_JSON = (() => { const i = args.indexOf('--source-json'); return i !== -1 ? args[i + 1] : null; })();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ANDROID_REPO = path.resolve('.cache/weekly-diff-repos/github.com_traveloka_android-v3');
const RESULTS_JSON = path.resolve('test-results/android/results.json');
const MEMORY_FILE = path.resolve('config/android-learning-memory.json');
const LOGS_DIR = path.resolve('logs');
const PRD_CACHE_DIR = path.resolve('.cache/android-prd-cache');
const EXTRACT_PRD_SCRIPT = path.resolve('scripts/extract-prd-with-opencode.sh');
const LARK_WIKI_PATTERN = /https:\/\/[a-z]+\.larksuite\.com\/wiki\/[A-Za-z0-9]+/g;
const FLIGHT_PR_PATTERN = /\[FLIGHT\]/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StageResult {
  stage: string;
  success: boolean;
  durationMs: number;
  output?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// PR context extraction  (android-v3 PR template parser)
// ---------------------------------------------------------------------------

/** One component entry from "### Detailed Changes" */
interface PrComponent {
  name: string;       // e.g. "Enhanced Multi-Filter Dialog with Tabbed Navigation"
  files: string[];    // e.g. ["FlightMultiFilterDialog.kt", "FilterTopTabBar.kt"]
  summary: string;    // first description paragraph (≤200 chars)
}

/** Rich context extracted from one [FLIGHT] PR */
interface FlightPrContext {
  prNumber: number;
  title: string;
  titleTags: string[];           // e.g. ["FEATURE", "FLIGHT", "BUGFIX"]
  highlightChanges: string;      // "### Highlight Changes" bullet list
  testPlan: string;              // "### Test Plan" section
  components: PrComponent[];     // parsed from "### Detailed Changes"
  allChangedFiles: string[];     // unique file names across all components
  larkUrls: string[];            // any Lark wiki links in the body
}

function extractLarkUrls(text: string): string[] {
  return Array.from(
    new Set(Array.from(text.matchAll(new RegExp(LARK_WIKI_PATTERN.source, 'g'))).map(m => m[0]))
  );
}

/**
 * Extract a named markdown section from a PR body using line-by-line parsing.
 * Handles "## Heading", "### Heading", "#### Heading".
 * headingPattern is a regex string matched against the heading text (case-insensitive).
 */
function extractSection(body: string, headingPattern: string): string {
  const lines = body.split('\n');
  const re = new RegExp(`^###+\\s+${headingPattern}\\s*$`, 'i');
  let inSection = false;
  const out: string[] = [];
  for (const line of lines) {
    if (!inSection && re.test(line)) { inSection = true; continue; }
    if (inSection && /^##/.test(line)) break;   // next sibling section
    if (inSection) out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * Parse "### Detailed Changes" into a list of PrComponent entries.
 *
 * Handles the android-v3 format:
 *   #### 1. Component Title
 *   **Files:** `A.kt, B.kt`
 *   Description text...
 *   ---
 *   #### 2. Another Component
 *   ...
 */
function parseDetailedChanges(body: string): PrComponent[] {
  const detailed = extractSection(body, 'Detailed Changes');
  if (!detailed) return [];

  const lines = detailed.split('\n');
  const components: PrComponent[] = [];
  let name = '';
  let files: string[] = [];
  const descBuf: string[] = [];

  const flush = () => {
    if (!name) return;
    components.push({ name, files, summary: descBuf.join(' ').replace(/\s+/g, ' ').trim().slice(0, 250) });
    name = ''; files = []; descBuf.length = 0;
  };

  for (const raw of lines) {
    const line = raw.trim();
    // Section divider — flush current component
    if (line === '---') { flush(); continue; }
    // "#### 1. Title" or "#### Title"
    const titleM = line.match(/^####\s+(?:\d+\.\s+)?(.+)/);
    if (titleM) { flush(); name = titleM[1].trim(); continue; }
    // "**Files:** `A.kt, B.kt`" or plain "**Files:** A.kt"
    const filesM = line.match(/^\*\*Files?:\*\*\s*(.+)/);
    if (filesM) {
      files = filesM[1]
        .replace(/`/g, '')
        .split(/[,\s]+/)
        .map(f => f.trim())
        .filter(f => f.endsWith('.kt') || f.endsWith('.java') || f.endsWith('.xml'));
      continue;
    }
    // Description text (skip empty lines and horizontal rules)
    if (name && line && !line.startsWith('#')) descBuf.push(line);
  }
  flush();
  return components;
}

/**
 * Parse all useful context from a single PR body.
 * Works with the standard android-v3 PR template.
 */
function parsePrBody(prNumber: number, title: string, body: string): FlightPrContext {
  const titleTags = Array.from(title.matchAll(/\[([A-Z_]+)\]/g)).map(m => m[1]);
  const highlightChanges = extractSection(body, 'Highlight Changes?');
  const testPlan = extractSection(body, 'Test Plan');
  const components = parseDetailedChanges(body);
  const allChangedFiles = Array.from(new Set(components.flatMap(c => c.files)));
  const larkUrls = extractLarkUrls(body);
  return { prNumber, title, titleTags, highlightChanges, testPlan, components, allChangedFiles, larkUrls };
}

/**
 * Format a parsed PR context into a compact markdown block for AI injection.
 * The generator will see this as "PRD/change context" to guide scenario generation.
 */
function formatPrContextForAi(ctx: FlightPrContext): string {
  const lines: string[] = [
    `## [${ctx.titleTags.join('][')}] PR #${ctx.prNumber}: ${ctx.title}`,
    '',
  ];
  if (ctx.highlightChanges) {
    lines.push('### What Changed');
    lines.push(ctx.highlightChanges);
    lines.push('');
  }
  if (ctx.components.length > 0) {
    lines.push(`### Changed Components (${ctx.components.length})`);
    for (const c of ctx.components) {
      const fileStr = c.files.length
        ? ` → ${c.files.slice(0, 4).join(', ')}${c.files.length > 4 ? ` +${c.files.length - 4} more` : ''}`
        : '';
      lines.push(`• **${c.name}**${fileStr}`);
      if (c.summary) lines.push(`  _${c.summary.slice(0, 150)}_`);
    }
    lines.push('');
  }
  if (ctx.allChangedFiles.length > 0) {
    lines.push(`### All Changed Files (${ctx.allChangedFiles.length})`);
    lines.push(ctx.allChangedFiles.join(', '));
    lines.push('');
  }
  if (ctx.testPlan) {
    lines.push('### Test Plan');
    lines.push(ctx.testPlan);
    lines.push('');
  }
  return lines.join('\n');
}

function fetchPrdWithCache(larkUrl: string): string | null {
  if (!fs.existsSync(EXTRACT_PRD_SCRIPT)) {
    console.warn(`  [prd] extract-prd-with-opencode.sh not found — skipping ${larkUrl}`);
    return null;
  }
  fs.mkdirSync(PRD_CACHE_DIR, { recursive: true });
  const urlHash = larkUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
  const cachePath = path.join(PRD_CACHE_DIR, `${urlHash}.md`);
  if (fs.existsSync(cachePath)) {
    console.log(`  [prd] cache hit: ${larkUrl}`);
    return fs.readFileSync(cachePath, 'utf8');
  }
  try {
    const result = spawnSync('zsh', [EXTRACT_PRD_SCRIPT, larkUrl, cachePath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000,
    });
    if (result.status === 0 && fs.existsSync(cachePath)) {
      console.log(`  [prd] fetched: ${larkUrl}`);
      return fs.readFileSync(cachePath, 'utf8');
    }
    console.warn(`  [prd] fetch failed for: ${larkUrl}`);
  } catch {
    console.warn(`  [prd] fetch error for: ${larkUrl}`);
  }
  return null;
}

/** Fetch recent [FLIGHT]-tagged merged PRs and parse their full context. */
function fetchRecentFlightPrContext(since: Date): FlightPrContext[] {
  try {
    const token = process.env.GITHUB_TOKEN || shSafe('gh auth token');
    const curlArgs = [
      '-fsSL',
      '-H', 'Accept: application/vnd.github+json',
      ...(token ? ['-H', `Authorization: Bearer ${token}`] : []),
      'https://api.github.com/repos/traveloka/android-v3/pulls?state=closed&sort=updated&direction=desc&per_page=30',
    ];
    const result = spawnSync('curl', curlArgs, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    });
    if (result.status !== 0) return [];
    const prs = JSON.parse(result.stdout) as Array<{
      number: number;
      merged_at: string | null;
      body: string | null;
      title: string;
    }>;
    const sinceMs = since.getTime();
    const contexts: FlightPrContext[] = [];
    for (const pr of prs) {
      if (!pr.merged_at || new Date(pr.merged_at).getTime() < sinceMs) continue;
      // Only process [FLIGHT] PRs — other domains are out of scope for Android test
      if (!FLIGHT_PR_PATTERN.test(pr.title)) continue;
      const ctx = parsePrBody(pr.number, pr.title, pr.body ?? '');
      const hasContent = ctx.highlightChanges || ctx.components.length > 0
        || ctx.testPlan || ctx.larkUrls.length > 0;
      if (hasContent) {
        console.log(
          `  [pr] #${ctx.prNumber} [${ctx.titleTags.join('][')}] "${ctx.title.slice(0, 60)}"` +
          ` — ${ctx.components.length} components, ${ctx.allChangedFiles.length} files` +
          (ctx.larkUrls.length ? `, ${ctx.larkUrls.length} Lark links` : '')
        );
        contexts.push(ctx);
      }
    }
    return contexts;
  } catch {
    return [];
  }
}

interface CaseResult {
  id: string;
  name: string;
  priority: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  failureReason: string | null;
  screenshotPath: string | null;
}

interface RunReport {
  runAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: string;
  cases: CaseResult[];
}

interface AndroidLearningMemory {
  lastUpdated: string;
  totalRuns: number;
  flakyScenarios: string[];   // currently failing
  stableScenarios: string[];  // have passed at least once
  // ── Accumulative learning fields ──────────────────────────────────────────
  /** How many consecutive passing runs each scenario has. Reset to 0 on failure. */
  consecutivePasses: Record<string, number>;
  /**
   * Scenarios with consecutivePasses >= EXPANSION_THRESHOLD.
   * Generator reads this to expand those into deeper variants.
   */
  expansionQueue: string[];
  /**
   * Scenario categories and how many distinct scenarios exist per category.
   * Used to detect coverage gaps (categories with < 2 scenarios).
   */
  coverageMap: Record<string, string[]>;
  /** Coverage gap categories (< MIN_COVERAGE_PER_CATEGORY scenarios confirmed stable). */
  coverageGaps: string[];
  /**
   * Human-readable fix patterns recorded from real failures.
   * Injected into the AI generator prompt as known constraints.
   */
  knownFixPatterns: string[];
  fixHistory: Array<{
    scenarioId: string;
    fixedAt: string;
    failureReason: string;
    fixApplied: boolean;
  }>;
  diffTriggers: Array<{
    date: string;
    changedFiles: string[];
    affectedScenarios: string[];
    passRate: string;
  }>;
}

// ---------------------------------------------------------------------------
// File → Scenario mapping (from android-v3 layout/source analysis)
// ---------------------------------------------------------------------------
const DIFF_SCENARIO_MAP: Array<{ pattern: RegExp; scenarios: string[] }> = [
  {
    pattern: /flight_result_revamp_filter_transit|FlightResultRevamp.*Filter.*Transit/i,
    scenarios: ['android-results-filter-direct', 'android-results-filter-one-stop', 'android-results-filter-multi-stop', 'android-results-reset-filters'],
  },
  {
    pattern: /flight_filter_time|FlightFilter.*Time/i,
    scenarios: ['android-results-departure-time-filter'],
  },
  {
    pattern: /flight_filter_airline|FlightFilter.*Airline/i,
    scenarios: ['android-results-airline-filter'],
  },
  {
    pattern: /flight_sort_tray|FlightSort|FlightResultRevamp.*Sort/i,
    scenarios: ['android-results-sort-cheapest', 'android-results-sort-fastest', 'android-results-sort-best'],
  },
  {
    pattern: /flight_result_revamp_activity|FlightResultRevampActivity/i,
    scenarios: ['android-results-smoke', 'android-results-back-to-search', 'android-results-scroll'],
  },
  {
    pattern: /flight_search_result_card|FlightSearchResultCard/i,
    scenarios: ['android-results-select-flight', 'android-results-view-detail'],
  },
  {
    pattern: /flight_result_revamp_route|FlightResultRevamp.*Route|quick_filter/i,
    scenarios: ['android-results-filter-direct', 'android-results-filter-one-stop'],
  },
  {
    pattern: /FlightBloomCalendar|widget_dateflow|price.?calendar/i,
    scenarios: ['android-results-price-calendar'],
  },
];

function mapDiffToScenarios(changedFiles: string[]): string[] {
  const matched = new Set<string>();
  for (const file of changedFiles) {
    for (const rule of DIFF_SCENARIO_MAP) {
      if (rule.pattern.test(file)) {
        rule.scenarios.forEach(s => matched.add(s));
      }
    }
  }
  return [...matched];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sh(cmd: string, opts: { silent?: boolean } = {}): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Command failed: ${cmd}\n${msg}`);
  }
}

function shSafe(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch { return ''; }
}

function elapsed(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * If no ADB device is online, auto-start Pixel7_API37 and wait for boot.
 * Throws if the emulator fails to boot within 3 minutes.
 */
function ensureEmulatorRunning(): void {
  const adbOut = shSafe('adb devices');
  if (adbOut.split('\n').some(l => /\tdevice$/.test(l.trim()))) return; // already online

  console.log('  ⚠️  No device found — auto-starting Pixel7_API37 emulator (~60s)…');
  const androidHome = process.env.ANDROID_HOME
    ?? path.join(process.env.HOME ?? '', 'Library/Android/sdk');
  const emulatorBin = path.join(androidHome, 'emulator', 'emulator');
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = path.join(LOGS_DIR, 'emulator.log');

  shSafe('pkill -f "emulator.*Pixel7_API37"'); // kill stale processes
  spawnSync('sleep', ['2']);

  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(emulatorBin, [
    '-avd', 'Pixel7_API37', '-no-audio', '-gpu', 'swiftshader_indirect', '-no-snapshot-save',
  ], { detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  fs.closeSync(logFd);
  console.log(`  Emulator PID: ${child.pid}`);

  // Poll until boot_completed=1 (max 3 min)
  process.stdout.write('  Booting');
  let booted = false;
  for (let i = 0; i < 36; i++) {
    spawnSync('sleep', ['5']);
    const boot = shSafe('adb shell getprop sys.boot_completed').replace(/\r/g, '');
    if (boot === '1') { booted = true; break; }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  if (!booted) throw new Error('Emulator boot timed out after 3 minutes');

  shSafe('adb shell input keyevent 82'); // unlock screen
  console.log('  ✅ Emulator ready (emulator-5554)');
}

function loadMemory(): AndroidLearningMemory {
  if (fs.existsSync(MEMORY_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) as Partial<AndroidLearningMemory>;
      return {
        lastUpdated: raw.lastUpdated ?? '',
        totalRuns: raw.totalRuns ?? 0,
        flakyScenarios: raw.flakyScenarios ?? [],
        stableScenarios: raw.stableScenarios ?? [],
        consecutivePasses: raw.consecutivePasses ?? {},
        expansionQueue: raw.expansionQueue ?? [],
        coverageMap: raw.coverageMap ?? {},
        coverageGaps: raw.coverageGaps ?? [],
        knownFixPatterns: raw.knownFixPatterns ?? [],
        fixHistory: raw.fixHistory ?? [],
        diffTriggers: raw.diffTriggers ?? [],
      };
    } catch { /* fall through */ }
  }
  return {
    lastUpdated: '', totalRuns: 0,
    flakyScenarios: [], stableScenarios: [],
    consecutivePasses: {}, expansionQueue: [],
    coverageMap: {}, coverageGaps: [],
    knownFixPatterns: [],
    fixHistory: [], diffTriggers: [],
  };
}

function saveMemory(mem: AndroidLearningMemory) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Stage 1: Validate environment
// ---------------------------------------------------------------------------
async function stageValidate(): Promise<StageResult> {
  const t = Date.now();
  const issues: string[] = [];

  // Maestro CLI
  if (!shSafe('maestro --version')) issues.push('maestro CLI not found (brew install maestro)');

  // ADB + device — auto-start emulator if none connected
  ensureEmulatorRunning();

  // android-v3 repo
  if (!fs.existsSync(ANDROID_REPO)) issues.push(`android-v3 repo not found at ${ANDROID_REPO}`);

  // OPENAI_API_KEY (optional — warn only)
  if (!process.env.OPENAI_API_KEY) {
    console.warn('  ⚠️  OPENAI_API_KEY not set — will use local MLX model (lower quality)');
  }

  if (issues.length > 0) {
    return { stage: 'validate-env', success: false, durationMs: Date.now() - t, error: issues.join('; ') };
  }
  return { stage: 'validate-env', success: true, durationMs: Date.now() - t, output: 'ADB device + Maestro + repo OK' };
}

// ---------------------------------------------------------------------------
// Stage 2: Sync android-v3 diff
// ---------------------------------------------------------------------------
async function stageSyncDiff(): Promise<StageResult & { changedFiles: string[]; affectedScenarios: string[]; prdFile: string | null }> {
  const t = Date.now();
  let changedFiles: string[] = [];
  let affectedScenarios: string[] = [];
  let prdFile: string | null = null;

  try {
    // Pull latest
    console.log('  Pulling android-v3 develop branch…');
    shSafe(`git -C "${ANDROID_REPO}" fetch --depth=1 origin develop`);
    shSafe(`git -C "${ANDROID_REPO}" reset --hard origin/develop`);

    // Get files changed in last 7 days
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const diffOutput = shSafe(
      `git -C "${ANDROID_REPO}" log --since="${since}" --name-only --pretty=format: | sort -u`
    );
    changedFiles = diffOutput.split('\n').map(f => f.trim()).filter(f =>
      f && /flight\//i.test(f)
    );

    if (FULL_RUN || changedFiles.length === 0) {
      console.log(`  ${FULL_RUN ? '--full flag set' : 'No flight diffs in last 7 days'} — running all scenarios`);
      affectedScenarios = []; // empty = all
    } else {
      affectedScenarios = mapDiffToScenarios(changedFiles);
      console.log(`  ${changedFiles.length} changed flight files → ${affectedScenarios.length} affected scenarios`);
      if (affectedScenarios.length === 0) {
        console.log('  No scenario mapping found — running all scenarios as fallback');
      }
    }

    // Fetch recent [FLIGHT] merged PRs — extract Highlight Changes + Lark PRDs
    console.log('  Fetching recent [FLIGHT] PR context…');
    const prSince = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const flightPrs = fetchRecentFlightPrContext(prSince);
    if (flightPrs.length > 0) {
      fs.mkdirSync(PRD_CACHE_DIR, { recursive: true });
      const combinedPath = path.join(PRD_CACHE_DIR, `flight-pr-context-${new Date().toISOString().slice(0, 10)}.md`);
      const sections: string[] = [
        `# Recent [FLIGHT] PR Changes (last 7 days — ${flightPrs.length} PRs)\n`,
      ];
      for (const pr of flightPrs) {
        sections.push(formatPrContextForAi(pr));
        // Also fetch linked Lark PRD docs if any
        for (const url of pr.larkUrls) {
          const content = fetchPrdWithCache(url);
          if (content) sections.push(`<!-- Lark PRD: ${url} -->\n${content}`);
        }
      }
      fs.writeFileSync(combinedPath, sections.join('\n---\n\n'), 'utf8');
      prdFile = combinedPath;
      const totalFiles = flightPrs.reduce((n, p) => n + p.allChangedFiles.length, 0);
      const totalComponents = flightPrs.reduce((n, p) => n + p.components.length, 0);
      console.log(`  [pr] saved: ${flightPrs.length} PR(s), ${totalComponents} components, ${totalFiles} files → ${combinedPath}`);
    } else {
      console.log('  [pr] No [FLIGHT] PRs merged in last 7 days');
    }

    return {
      stage: 'sync-diff',
      success: true,
      durationMs: Date.now() - t,
      output: `Changed: ${changedFiles.length} files, affected: ${affectedScenarios.length || 'all'} scenarios, PRDs: ${prdFile ? 1 : 0}`,
      changedFiles,
      affectedScenarios,
      prdFile,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'sync-diff', success: false, durationMs: Date.now() - t, error: msg, changedFiles, affectedScenarios, prdFile };
  }
}

// ---------------------------------------------------------------------------
// Stage 3: Generate Maestro cases
// ---------------------------------------------------------------------------
async function stageGenerate(affectedScenarios: string[], prdFile?: string | null, sourceContextFile?: string): Promise<StageResult> {
  const t = Date.now();
  try {
    const genArgs = ['tsx', 'scripts/generate-maestro-android.ts'];
    // STRONG CONSTRAINT: always pass live source context — never use hardcoded DEFAULT_SOURCE_CONTEXT
    const resolvedSourceJson = SOURCE_JSON ?? sourceContextFile;
    if (resolvedSourceJson && fs.existsSync(resolvedSourceJson)) {
      genArgs.push('--source-json', resolvedSourceJson);
    } else {
      console.warn('  ⚠️  No source-json available — generator will use DEFAULT_SOURCE_CONTEXT (stale)');
    }
    if (DRY_RUN) genArgs.push('--dry-run');
    if (prdFile && fs.existsSync(prdFile)) genArgs.push('--prd-file', prdFile);

    const result = spawnSync('npx', genArgs, {
      stdio: 'inherit', encoding: 'utf8', env: { ...process.env },
    });

    if (result.status !== 0) throw new Error('Generator exited with error');

    const manifest = path.resolve('maestro/flows/android/manifest.json');
    const generated = fs.existsSync(manifest)
      ? (JSON.parse(fs.readFileSync(manifest, 'utf8')) as Array<{ id: string; warnings: string[] }>)
          .filter(m => !m.warnings.some(w => w.startsWith('GENERATION_FAILED'))).length
      : 0;

    return {
      stage: 'generate-cases',
      success: true,
      durationMs: Date.now() - t,
      output: `${generated} Maestro YAML files generated`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'generate-cases', success: false, durationMs: Date.now() - t, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Stage 4: Run cases
// ---------------------------------------------------------------------------
async function stageRun(): Promise<StageResult & { report: RunReport | null }> {
  const t = Date.now();
  if (DRY_RUN) {
    return { stage: 'run-cases', success: true, durationMs: 0, output: 'Skipped (dry-run)', report: null };
  }

  try {
    let runArgs = ['tsx', 'scripts/run-maestro-android.ts'];
    if (PRIORITY) runArgs.push('--priority', PRIORITY);
    // No --priority default: run-maestro-android.ts defaults to P0+P1 when no filter set
    // Previously was '--priority p0' which silently skipped all P1 cases

    const result = spawnSync('npx', runArgs, {
      stdio: 'inherit', encoding: 'utf8', env: { ...process.env },
    });

    const report: RunReport | null = fs.existsSync(RESULTS_JSON)
      ? JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'))
      : null;

    return {
      stage: 'run-cases',
      success: result.status === 0,
      durationMs: Date.now() - t,
      output: report ? `${report.passed}/${report.total} passed (${report.passRate})` : 'No report',
      report,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'run-cases', success: false, durationMs: Date.now() - t, error: msg, report: null };
  }
}

// ---------------------------------------------------------------------------
// Stage 5: Fix failures
// ---------------------------------------------------------------------------
async function stageFix(report: RunReport | null): Promise<StageResult> {
  const t = Date.now();
  if (NO_FIX || DRY_RUN || !report || report.failed === 0) {
    const reason = NO_FIX ? '--no-fix' : DRY_RUN ? 'dry-run' : !report ? 'no report' : 'no failures';
    return { stage: 'fix-failures', success: true, durationMs: 0, output: `Skipped (${reason})` };
  }

  try {
    const result = spawnSync('npx', ['tsx', 'scripts/fix-maestro-android-failures.ts'], {
      stdio: 'inherit', encoding: 'utf8', env: { ...process.env },
    });
    return {
      stage: 'fix-failures',
      success: result.status === 0,
      durationMs: Date.now() - t,
      output: `Attempted fix for ${report.failed} failed case(s)`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'fix-failures', success: false, durationMs: Date.now() - t, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Stage 6: Lark notification
// ---------------------------------------------------------------------------
async function stageNotify(
  stages: StageResult[],
  report: RunReport | null,
  changedFiles: string[],
  workflowDurationMs: number
): Promise<void> {
  const passed = report?.passed ?? 0;
  const failed = report?.failed ?? 0;
  const skipped = report?.skipped ?? 0;
  const total = report?.total ?? 0;
  const passRate = total > 0 ? `${Math.round((passed / total) * 100)}%` : 'N/A';
  const hasFailures = failed > 0;
  const color = hasFailures ? 'red' : 'green';
  const statusEmoji = hasFailures ? '❌' : '✅';

  // Failed case details (max 8)
  const failedCases = (report?.cases ?? []).filter(c => c.status === 'failed').slice(0, 8);
  const failedCasesText = failedCases.length > 0
    ? failedCases.map(c => `• **[${c.priority.toUpperCase()}]** ${c.name}${c.failureReason ? `\n  \`${c.failureReason.slice(0, 100)}\`` : ''}`).join('\n')
    : '';

  // Changed files summary
  const diffText = changedFiles.length > 0
    ? changedFiles.slice(0, 5).map(f => `• ${path.basename(f)}`).join('\n')
        + (changedFiles.length > 5 ? `\n• +${changedFiles.length - 5} more` : '')
    : FULL_RUN ? '(full run — no diff filter)' : '(no flight diffs detected)';

  // Stage summary
  const stageLines = stages.map(s => {
    const icon = s.success ? '✅' : '❌';
    const dur = elapsed(s.durationMs);
    return `${icon} **${s.stage}** (${dur})${s.error ? ` — ${s.error.slice(0, 60)}` : ''}`;
  }).join('\n');

  const bodyContent = [
    `**Platform**: 📱 Android (${process.env.ANDROID_AVD ?? 'emulator'})`,
    `**Trigger**: ${FULL_RUN ? 'Manual full run' : 'Weekly diff'}`,
    `**Total**: ${total}  |  ✅ ${passed}  |  ❌ ${failed}  |  ⚠️ ${skipped}`,
    `**Pass Rate**: ${passRate}`,
    `**Duration**: ${elapsed(workflowDurationMs)}`,
    '',
    '**Changed Files (android-v3)**',
    diffText,
    ...(failedCasesText ? ['', '**Failed Cases**', failedCasesText] : []),
    '',
    '**Stages**',
    stageLines,
  ].join('\n');

  await notifyCustom(
    `${statusEmoji} Android E2E — ${passRate} pass rate`,
    bodyContent,
    color,
  );
}

// ---------------------------------------------------------------------------
// Stage 7: Update learning memory
// ---------------------------------------------------------------------------
/** Consecutive passes required before a scenario enters the expansion queue. */
const EXPANSION_THRESHOLD = 3;
/** Minimum distinct stable scenarios per category before it's no longer a gap. */
const MIN_COVERAGE_PER_CATEGORY = 2;

/** Category for a scenario id (e.g. "android-results-filter-direct" → "filter") */
function scenarioCategory(id: string): string {
  const m = id.match(/android-(?:results|ssrv4)-([a-z]+)/);
  return m ? m[1] : 'other';
}

async function stageUpdateMemory(
  report: RunReport | null,
  changedFiles: string[],
  affectedScenarios: string[]
): Promise<StageResult> {
  const t = Date.now();
  if (!report) return { stage: 'update-memory', success: true, durationMs: 0, output: 'Skipped (no report)' };

  try {
    const mem = loadMemory();
    mem.lastUpdated = new Date().toISOString();
    mem.totalRuns += 1;

    const failedIds = report.cases.filter(c => c.status === 'failed').map(c => c.id);
    const passedIds = report.cases.filter(c => c.status === 'passed').map(c => c.id);

    // ── 1. Flaky / stable tracking ──────────────────────────────────────────
    for (const id of failedIds) {
      if (!mem.flakyScenarios.includes(id)) mem.flakyScenarios.push(id);
      mem.consecutivePasses[id] = 0; // reset on failure
    }
    mem.flakyScenarios = mem.flakyScenarios.filter(id => !passedIds.includes(id));
    mem.stableScenarios = [...new Set([...mem.stableScenarios, ...passedIds])];

    // ── 2. Consecutive pass counter → expansion queue ───────────────────────
    for (const id of passedIds) {
      mem.consecutivePasses[id] = (mem.consecutivePasses[id] ?? 0) + 1;
      if (mem.consecutivePasses[id] >= EXPANSION_THRESHOLD && !mem.expansionQueue.includes(id)) {
        mem.expansionQueue.push(id);
        console.log(`  📈 Expansion candidate: ${id} (${mem.consecutivePasses[id]} consecutive passes)`);
      }
    }
    // Remove from queue if it started failing again
    mem.expansionQueue = mem.expansionQueue.filter(id => !failedIds.includes(id));

    // ── 3. Coverage map and gap detection ───────────────────────────────────
    // Rebuild coverage map from all stable scenarios
    mem.coverageMap = {};
    for (const id of mem.stableScenarios) {
      const cat = scenarioCategory(id);
      if (!mem.coverageMap[cat]) mem.coverageMap[cat] = [];
      if (!mem.coverageMap[cat].includes(id)) mem.coverageMap[cat].push(id);
    }
    // Identify categories with fewer than MIN_COVERAGE_PER_CATEGORY stable scenarios
    const allCategories = ['sort', 'filter', 'smoke', 'scroll', 'select', 'calendar', 'airline', 'time'];
    mem.coverageGaps = allCategories.filter(cat =>
      (mem.coverageMap[cat] ?? []).length < MIN_COVERAGE_PER_CATEGORY
    );

    // ── 4. Record known fix patterns from fix history ────────────────────────
    const patternMap: Record<string, string> = {
      'flight_result_v4_sort_button': 'FIXED: flight_result_v4_sort_button → bm_button + rbg_sort + radio_button index N (sort tray)',
      'quick_filter_item': 'FIXED: quick_filter_item/quick_filter_cell → flight_result_v4_filter_button (opens full filter dialog)',
      'tvResult': 'FIXED: tvResult → dbwShow (tvResult is count label; dbwShow is the apply button)',
      'scroll.*direction': 'FIXED: swipe/scroll inside dialog → scrollUntilVisible (bare scroll targets results list behind dialog)',
      'runFlowIfVisible': 'FIXED: runFlowIfVisible removed in Maestro 2.x → use runFlow with when: condition',
      'tapOn.*text.*Direct': 'FIXED: tapOn text: "Direct" → tapOn id: "button_direct" (text matches flight cards, not filter)',
    };
    for (const entry of mem.fixHistory) {
      for (const [pattern, fix] of Object.entries(patternMap)) {
        if (new RegExp(pattern, 'i').test(entry.failureReason) && !mem.knownFixPatterns.includes(fix)) {
          mem.knownFixPatterns.push(fix);
        }
      }
    }
    // Keep list compact
    mem.knownFixPatterns = [...new Set(mem.knownFixPatterns)].slice(0, 20);

    // ── 5. Record fix history entries ────────────────────────────────────────
    for (const c of report.cases.filter(x => x.status === 'failed')) {
      mem.fixHistory.push({
        scenarioId: c.id,
        fixedAt: new Date().toISOString(),
        failureReason: c.failureReason ?? 'unknown',
        fixApplied: false,
      });
    }
    mem.fixHistory = mem.fixHistory.slice(-100);

    // ── 6. Record this diff trigger ──────────────────────────────────────────
    mem.diffTriggers.push({ date: new Date().toISOString(), changedFiles, affectedScenarios, passRate: report.passRate });
    mem.diffTriggers = mem.diffTriggers.slice(-30);

    saveMemory(mem);

    const gapSummary = mem.coverageGaps.length ? ` | Gaps: [${mem.coverageGaps.join(', ')}]` : ' | No gaps';
    const expandSummary = mem.expansionQueue.length ? ` | Expand: [${mem.expansionQueue.slice(0, 3).join(', ')}…]` : '';
    return {
      stage: 'update-memory',
      success: true,
      durationMs: Date.now() - t,
      output: `Memory updated (run #${mem.totalRuns}). Stable: ${mem.stableScenarios.length} | Flaky: [${mem.flakyScenarios.join(', ') || 'none'}]${gapSummary}${expandSummary}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stage: 'update-memory', success: false, durationMs: Date.now() - t, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------
async function main() {
  const workflowStart = Date.now();
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  console.log('\n📱 Android Diff Workflow');
  console.log(`${'═'.repeat(60)}`);
  console.log(`   Mode   : ${FULL_RUN ? 'full' : DRY_RUN ? 'dry-run' : 'diff-triggered'}`);
  console.log(`   Priority: ${PRIORITY ?? (FULL_RUN ? 'all' : 'p0+p1')}`);
  console.log(`   No-fix : ${NO_FIX}`);
  console.log(`${'═'.repeat(60)}\n`);

  const completedStages: StageResult[] = [];

  // Stage 1: Validate
  console.log('[1/8] Validating environment…');
  const validate = await stageValidate();
  completedStages.push(validate);
  console.log(`  ${validate.success ? '✅' : '❌'} ${validate.output ?? validate.error}\n`);
  if (!validate.success) {
    await notifyCustom('❌ Android E2E — Environment failure', validate.error ?? 'Unknown', 'red');
    process.exit(1);
  }

  // Stage 2: Sync diff + fetch PR Lark links
  console.log('[2/8] Syncing android-v3 diff + PR PRD links…');
  const syncResult = await stageSyncDiff();
  completedStages.push(syncResult);
  console.log(`  ${syncResult.success ? '✅' : '⚠️'} ${syncResult.output ?? syncResult.error}\n`);
  const { changedFiles, affectedScenarios, prdFile } = syncResult;

  // Stage 2.5: Extract source context from android-v3 live source
  console.log('[3/8] Extracting source context from android-v3…');
  const SOURCE_CONTEXT_FILE = path.resolve('.cache/android-source-context.json');
  try {
    const extractResult = spawnSync('npx', ['tsx', 'scripts/extract-android-source-context.ts'], {
      stdio: 'inherit', encoding: 'utf8', env: { ...process.env },
    });
    if (extractResult.status !== 0) throw new Error('Extraction exited non-zero');
    console.log('  ✅ Source context extracted\n');
  } catch (err) {
    console.warn(`  ⚠️  Source extraction failed (${err}) — falling back to DEFAULT_SOURCE_CONTEXT\n`);
  }

  // Stage 3: Generate
  console.log('[4/8] Generating Maestro cases…');
  const generate = await stageGenerate(affectedScenarios, prdFile, SOURCE_CONTEXT_FILE);
  completedStages.push(generate);
  console.log(`  ${generate.success ? '✅' : '❌'} ${generate.output ?? generate.error}\n`);
  if (!generate.success && !DRY_RUN) {
    await stageNotify(completedStages, null, changedFiles, Date.now() - workflowStart);
    process.exit(1);
  }

  // Stage 4: Run
  console.log('[5/8] Running cases on Android…');
  const runResult = await stageRun();
  completedStages.push(runResult);
  console.log(`  ${runResult.success ? '✅' : '❌'} ${runResult.output ?? runResult.error}\n`);

  // Stage 5: Fix failures
  console.log('[6/8] Fixing failures with AI…');
  const fix = await stageFix(runResult.report);
  completedStages.push(fix);
  console.log(`  ${fix.success ? '✅' : '❌'} ${fix.output ?? fix.error}\n`);

  // Stage 6: Lark notification
  console.log('[7/8] Sending Lark notification…');
  await stageNotify(completedStages, runResult.report, changedFiles, Date.now() - workflowStart);
  completedStages.push({ stage: 'notify', success: true, durationMs: 0 });
  console.log('  ✅ Notification sent\n');

  // Stage 7: Update memory
  console.log('[8/8] Updating learning memory…');
  const memory = await stageUpdateMemory(runResult.report, changedFiles, affectedScenarios);
  completedStages.push(memory);
  console.log(`  ${memory.success ? '✅' : '⚠️'} ${memory.output ?? memory.error}\n`);

  // Final summary
  const report = runResult.report;
  console.log(`${'═'.repeat(60)}`);
  console.log('📊 WORKFLOW COMPLETE');
  console.log(`${'─'.repeat(60)}`);
  if (report) {
    console.log(`   Pass rate : ${report.passRate} (${report.passed}/${report.total})`);
    console.log(`   Failed    : ${report.failed}`);
    console.log(`   Duration  : ${elapsed(Date.now() - workflowStart)}`);
  }
  console.log(`   Memory    : ${MEMORY_FILE}`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(report && report.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n❌ Workflow error:', err);
  notifyCustom('❌ Android E2E — Workflow crashed', String(err), 'red').finally(() => process.exit(1));
});
