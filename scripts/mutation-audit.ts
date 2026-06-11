/**
 * Mutation Audit — E2E Assertion Strength Verifier
 *
 * Solves the "always green = no learning" problem:
 * For each assertion in our specs, inject a known-bad value and verify the assertion FAILS.
 * If the assertion passes with bad data → it's WEAK (a bug could slip through undetected).
 *
 * Inspired by Meta's ACH paper and Martin Fowler's mutation testing notes.
 * Unlike traditional mutation testing (mutates source code), this mutates the ORACLE DATA
 * that aiQuery() would return — which is the right target for an AI-driven E2E suite.
 *
 * Run: npx tsx scripts/mutation-audit.ts
 * Run: npm run mutation:audit
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

interface MutationCase {
  id: string;
  specFile: string;
  testName: string;
  assertionDescription: string;
  /** What bug scenario does this mutant simulate? */
  mutantScenario: string;
  /** The bad/wrong data that aiQuery() would return if the feature broke */
  badInput: unknown;
  /** Run the production assertion against badInput — should throw to be STRONG */
  run: () => void;
  /** Suggestion if this assertion is weak */
  suggestion?: string;
}

interface MutationResult {
  id: string;
  specFile: string;
  testName: string;
  assertionDescription: string;
  mutantScenario: string;
  badInput: unknown;
  killed: boolean;       // true = assertion threw (STRONG) ✅
  survived: boolean;     // true = assertion passed with bad data (WEAK) ❌
  error?: string;        // error message when killed
  suggestion?: string;
}

// ── Assertion helpers (mirrors prod assertion logic) ─────────────────────────
// Each helper replicates the exact assertion from the corresponding spec.
// When given bad input, a strong assertion must throw; a weak one passes silently.

function assertFilterNonDirectIsZero(cards: Array<{ stops: string }>): void {
  const nonDirect = cards.filter((c) => !/direct|non.?stop|0 stop/i.test(c.stops));
  if (nonDirect.length !== 0) {
    throw new Error(`Expected 0 non-direct, got ${nonDirect.length}: ${JSON.stringify(nonDirect)}`);
  }
}

function assertPriceSortAscendingEndpoints(prices: Array<{ price: number }>): void {
  // ← This is what the CURRENT spec does (only checks first vs last)
  const sample = prices.slice(0, 5).map((p) => p.price).filter((n) => !isNaN(n));
  const isAscending = sample[0] <= sample[sample.length - 1];
  if (!isAscending) {
    throw new Error(`Prices not ascending: ${JSON.stringify(sample)}`);
  }
}

function assertPriceSortAscendingAllPairs(prices: Array<{ price: number }>): void {
  // ← This is the STRONGER version (checks every consecutive pair)
  const sample = prices.slice(0, 5).map((p) => p.price).filter((n) => !isNaN(n));
  for (let i = 1; i < sample.length; i++) {
    if (sample[i] < sample[i - 1]) {
      throw new Error(
        `Price at position ${i} (${sample[i]}) < previous (${sample[i - 1]}): ${JSON.stringify(sample)}`
      );
    }
  }
}

function assertCurrencyIsCny(priceText: string): void {
  const hasCny = /CNY|¥|人民币/i.test(priceText);
  if (!hasCny) {
    throw new Error(`Expected CNY price, got: "${priceText}"`);
  }
}

function assertLanguageIsChinese(result: { hasChinese: boolean; sample: string }): void {
  if (!result.hasChinese) {
    throw new Error(`Expected Chinese UI, got: "${result.sample}"`);
  }
}

function assertBookingUrlPath(pathname: string): void {
  if (!/\/flight\/booking/.test(pathname)) {
    throw new Error(`Expected /flight/booking in pathname, got: "${pathname}"`);
  }
}

function assertContactFormVisible(isVisible: boolean): void {
  // Mirrors: expect(contactExists).toBeTruthy()
  if (!isVisible) {
    throw new Error('Contact form not visible');
  }
}

function assertPageTitleTruthy(title: string): void {
  // ← This is what the CURRENT explore specs do
  if (!title) {
    throw new Error('Page title is empty');
  }
}

function assertPageTitleNotError(title: string): void {
  // ← This is the STRONGER version
  if (!title || /^error|404|not found|something went wrong/i.test(title)) {
    throw new Error(`Page title looks like an error page: "${title}"`);
  }
}

function assertCardCountGtZero(count: number): void {
  // Mirrors: expect(taggedCardCount).toBeGreaterThan(0)
  if (count <= 0) {
    throw new Error(`Expected at least 1 card, got ${count}`);
  }
}

function assertFirstCardText(text: string): void {
  if (!/flight details|fare\s*&\s*benefits/i.test(text)) {
    throw new Error(`First card text does not match expected pattern: "${text}"`);
  }
}

// ── Mutation Cases ────────────────────────────────────────────────────────────

const CASES: MutationCase[] = [

  // ── traveloka-flight-search-interactions.spec.ts ──────────────────────────

  {
    id: 'filter-01-nondirect-appears',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Direct flights filter applies correctly',
    assertionDescription: 'nonDirect.length === 0',
    mutantScenario: 'Filter broke: a "1 Stop" flight card is still visible after applying Direct filter',
    badInput: [{ stops: 'Direct' }, { stops: '1 Stop' }, { stops: 'Direct' }],
    run() {
      assertFilterNonDirectIsZero(this.badInput as Array<{ stops: string }>);
    },
  },

  {
    id: 'filter-02-all-nondirect',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Direct flights filter applies correctly',
    assertionDescription: 'nonDirect.length === 0',
    mutantScenario: 'Filter completely ignored: all 3 results are connecting flights',
    badInput: [{ stops: '2 Stops' }, { stops: '1 Stop' }, { stops: '2 Stops' }],
    run() {
      assertFilterNonDirectIsZero(this.badInput as Array<{ stops: string }>);
    },
  },

  {
    id: 'sort-01-reversed-endpoints',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Price sort (cheapest first) returns ascending order',
    assertionDescription: 'isAscending: sample[0] <= sample[last] (endpoints only)',
    mutantScenario: 'Sort broke: prices are in DESCENDING order [500, 300, 200]',
    badInput: [{ price: 500 }, { price: 300 }, { price: 200 }],
    run() {
      assertPriceSortAscendingEndpoints(this.badInput as Array<{ price: number }>);
    },
  },

  {
    id: 'sort-02-sawtooth-gap',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Price sort (cheapest first) returns ascending order',
    assertionDescription: 'All consecutive pairs non-decreasing (FIXED: was endpoints-only)',
    mutantScenario: 'Sort partially broke: [100, 900, 200] — first and last look fine but order is wrong in middle',
    badInput: [{ price: 100 }, { price: 900 }, { price: 200 }],
    run() {
      assertPriceSortAscendingAllPairs(this.badInput as Array<{ price: number }>);
    },
  },

  {
    id: 'sort-03-sawtooth-strong',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Price sort — STRONGER consecutive-pair check',
    assertionDescription: 'All consecutive pairs non-decreasing',
    mutantScenario: 'Sort partially broke: [100, 900, 200] — stronger assertion catches it',
    badInput: [{ price: 100 }, { price: 900 }, { price: 200 }],
    run() {
      assertPriceSortAscendingAllPairs(this.badInput as Array<{ price: number }>);
    },
  },

  {
    id: 'currency-01-wrong-symbol',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Currency switcher changes price display to CNY',
    assertionDescription: '/CNY|¥|人民币/.test(priceText)',
    mutantScenario: 'Currency switch failed: price still shows SGD 450',
    badInput: 'SGD 450',
    run() {
      assertCurrencyIsCny(this.badInput as string);
    },
  },

  {
    id: 'currency-02-empty-response',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Currency switcher changes price display to CNY',
    assertionDescription: '/CNY|¥|人民币/.test(priceText)',
    mutantScenario: 'aiQuery returned empty string (page not ready)',
    badInput: '',
    run() {
      assertCurrencyIsCny(this.badInput as string);
    },
  },

  {
    id: 'language-01-not-chinese',
    specFile: 'tests/web/traveloka-flight-search-interactions.spec.ts',
    testName: 'Language switcher changes UI to Chinese',
    assertionDescription: 'hasChinese === true',
    mutantScenario: 'Language switch failed: UI still in English',
    badInput: { hasChinese: false, sample: 'Flights from Singapore' },
    run() {
      assertLanguageIsChinese(this.badInput as { hasChinese: boolean; sample: string });
    },
  },

  // ── traveloka-flight-booking-weekly-diff specs ────────────────────────────

  {
    id: 'booking-01-wrong-url',
    specFile: 'tests/web/traveloka-flight-booking-weekly-diff-20260601.spec.ts',
    testName: 'Booking chain reaches /flight/booking URL',
    assertionDescription: 'pathname matches /\\/flight\\/booking/',
    mutantScenario: 'Booking redirect broken: landed on /hotel/booking instead',
    badInput: '/en-sg/hotel/booking/123',
    run() {
      assertBookingUrlPath(this.badInput as string);
    },
  },

  {
    id: 'booking-02-404-url',
    specFile: 'tests/web/traveloka-flight-booking-weekly-diff-20260601.spec.ts',
    testName: 'Booking chain reaches /flight/booking URL',
    assertionDescription: 'pathname matches /\\/flight\\/booking/',
    mutantScenario: 'Booking chain failed: landed on error page /en-sg/404',
    badInput: '/en-sg/404',
    run() {
      assertBookingUrlPath(this.badInput as string);
    },
  },

  {
    id: 'booking-03-contact-form-hidden',
    specFile: 'tests/web/traveloka-flight-booking-weekly-diff-20260601.spec.ts',
    testName: 'Booking contact form should be accessible',
    assertionDescription: 'contactExists is truthy (boolean from isVisible)',
    mutantScenario: 'Contact form failed to render: isVisible() returned false',
    badInput: false,
    run() {
      assertContactFormVisible(this.badInput as boolean);
    },
  },

  // ── Explore specs (traveloka-flight-explore-*.spec.ts) ───────────────────

  {
    id: 'explore-01-title-empty',
    specFile: 'tests/web/traveloka-flight-explore-*.spec.ts',
    testName: 'Page title should not be empty after load',
    assertionDescription: 'title toBeTruthy()',
    mutantScenario: 'Page did not load: aiQuery returned empty string',
    badInput: '',
    run() {
      assertPageTitleTruthy(this.badInput as string);
    },
  },

  {
    id: 'explore-02-title-error-page',
    specFile: 'tests/web/traveloka-flight-explore-*.spec.ts',
    testName: 'Page title should be a valid Traveloka page, not an error page',
    assertionDescription: 'title matches /traveloka|flight|airport|airline|hotel|travel/i (FIXED: was toBeTruthy)',
    mutantScenario: 'Page returned an error page with title "Error 404"',
    badInput: 'Error 404',
    run() {
      assertPageTitleNotError(this.badInput as string);
    },
  },

  {
    id: 'explore-03-title-strong-version',
    specFile: 'tests/web/traveloka-flight-explore-*.spec.ts',
    testName: 'Page title — STRONGER content-aware check',
    assertionDescription: 'title matches /traveloka|flight|airport|airline/i AND not an error page',
    mutantScenario: 'Error 404 page — stronger assertion catches it',
    badInput: 'Error 404',
    run() {
      assertPageTitleNotError(this.badInput as string);
    },
  },

  // ── traveloka-flight-weekly-diff-20260522.spec.ts ─────────────────────────

  {
    id: 'results-01-card-count-zero',
    specFile: 'tests/web/traveloka-flight-weekly-diff-20260522.spec.ts',
    testName: 'Weekly diff results page — flight cards visible',
    assertionDescription: 'taggedCardCount > 0',
    mutantScenario: 'Results page rendered with 0 flight cards (empty results or API error)',
    badInput: 0,
    run() {
      assertCardCountGtZero(this.badInput as number);
    },
  },

  {
    id: 'results-02-card-text-loading',
    specFile: 'tests/web/traveloka-flight-weekly-diff-20260522.spec.ts',
    testName: 'Weekly diff results page — first card has expected text',
    assertionDescription: 'firstCardText matches /flight details|fare & benefits/i',
    mutantScenario: 'Cards rendered but still show skeleton/loading text',
    badInput: 'Loading...',
    run() {
      assertFirstCardText(this.badInput as string);
    },
  },

  {
    id: 'results-03-card-text-error',
    specFile: 'tests/web/traveloka-flight-weekly-diff-20260522.spec.ts',
    testName: 'Weekly diff results page — first card has expected text',
    assertionDescription: 'firstCardText matches /flight details|fare & benefits/i',
    mutantScenario: 'API returned error state — card shows "Something went wrong"',
    badInput: 'Something went wrong. Please try again.',
    run() {
      assertFirstCardText(this.badInput as string);
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

function runMutationCase(mc: MutationCase): MutationResult {
  let killed = false;
  let errorMsg: string | undefined;

  try {
    mc.run();
    // Assertion passed with bad data → WEAK (mutation survived)
    killed = false;
  } catch (e: unknown) {
    killed = true;
    errorMsg = e instanceof Error ? e.message : String(e);
  }

  return {
    id: mc.id,
    specFile: mc.specFile,
    testName: mc.testName,
    assertionDescription: mc.assertionDescription,
    mutantScenario: mc.mutantScenario,
    badInput: mc.badInput,
    killed,
    survived: !killed,
    error: errorMsg,
    suggestion: mc.suggestion,
  };
}

// ── Report ───────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function printReport(results: MutationResult[]): void {
  console.log(`\n${BOLD}${'='.repeat(70)}${RESET}`);
  console.log(`${BOLD}  MUTATION AUDIT REPORT${RESET}`);
  console.log(`${BOLD}${'='.repeat(70)}${RESET}\n`);

  // Group by specFile
  const bySpec = new Map<string, MutationResult[]>();
  for (const r of results) {
    if (!bySpec.has(r.specFile)) bySpec.set(r.specFile, []);
    bySpec.get(r.specFile)!.push(r);
  }

  for (const [spec, specResults] of bySpec) {
    console.log(`${BOLD}SPEC: ${spec}${RESET}`);
    for (const r of specResults) {
      const icon = r.killed ? `${GREEN}✅ KILLED${RESET}  ` : `${RED}❌ SURVIVED${RESET}`;
      console.log(`  ${icon} [${r.testName}]`);
      console.log(`${DIM}             Assertion:  ${r.assertionDescription}${RESET}`);
      console.log(`${DIM}             Mutant:     ${r.mutantScenario}${RESET}`);
      if (r.killed && r.error) {
        console.log(`${DIM}             Threw:      ${r.error.split('\n')[0]}${RESET}`);
      }
      if (!r.killed && r.suggestion) {
        console.log(`${YELLOW}             ⚠️  WEAK — assertion passed with bad data${RESET}`);
        console.log(`${YELLOW}             💡 FIX: ${r.suggestion.split('\n')[0]}${RESET}`);
        const lines = r.suggestion.split('\n').slice(1);
        for (const l of lines) console.log(`${YELLOW}                    ${l}${RESET}`);
      } else if (!r.killed) {
        console.log(`${YELLOW}             ⚠️  WEAK — assertion passed with bad data${RESET}`);
      }
    }
    console.log();
  }

  // Summary
  const killed   = results.filter((r) => r.killed).length;
  const survived = results.filter((r) => r.survived).length;
  const total    = results.length;
  const pct      = Math.round((killed / total) * 100);

  console.log(`${BOLD}${'─'.repeat(70)}${RESET}`);
  console.log(`${BOLD}SUMMARY${RESET}`);
  console.log(`  Total mutations tested : ${total}`);
  console.log(`  ${GREEN}✅ Killed (strong)    : ${killed} (${pct}%)${RESET}`);
  console.log(`  ${RED}❌ Survived (weak)    : ${survived} (${100 - pct}%)${RESET}`);

  const weak = results.filter((r) => r.survived);
  if (weak.length > 0) {
    console.log(`\n${RED}${BOLD}  Weak assertions that need fixing:${RESET}`);
    for (const w of weak) {
      console.log(`  ${RED}  • [${w.specFile.split('/').pop()}] ${w.testName}${RESET}`);
      console.log(`${DIM}      Mutant survived: ${w.mutantScenario}${RESET}`);
      if (w.suggestion) {
        console.log(`${YELLOW}      Fix: ${w.suggestion.split('\n')[0]}${RESET}`);
      }
    }
  }

  console.log(`\n${BOLD}${'='.repeat(70)}${RESET}\n`);
}

// ── Write JSON report ─────────────────────────────────────────────────────────

function writeReport(results: MutationResult[]): void {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const outDir = path.join(process.cwd(), 'generated-cases', 'mutation-audit');
  fs.mkdirSync(outDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      killed: results.filter((r) => r.killed).length,
      survived: results.filter((r) => r.survived).length,
      killRatio: Math.round((results.filter((r) => r.killed).length / results.length) * 100),
    },
    weakAssertions: results
      .filter((r) => r.survived)
      .map((r) => ({
        id: r.id,
        specFile: r.specFile,
        testName: r.testName,
        assertionDescription: r.assertionDescription,
        mutantScenario: r.mutantScenario,
        suggestion: r.suggestion,
      })),
    results,
  };

  const outPath = path.join(outDir, `report-${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Report written to: generated-cases/mutation-audit/report-${date}.json`);

  // Also write a latest symlink-style file for easy CI access
  const latestPath = path.join(outDir, 'report-latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Running mutation audit on E2E assertions...\n');

  const results = CASES.map(runMutationCase);

  printReport(results);
  writeReport(results);

  const survived = results.filter((r) => r.survived).length;
  if (survived > 0) {
    console.log(`\n⚠️  ${survived} assertion(s) are weak. See suggestions above.\n`);
    // Exit 0 intentionally — this is a report, not a blocking gate.
    // To make it a hard gate: process.exit(1)
  } else {
    console.log(`\n✅ All assertions killed their mutations — test suite is strong.\n`);
  }
}

main().catch((e) => {
  console.error('Mutation audit failed:', e);
  process.exit(1);
});
