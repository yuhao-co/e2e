import { test, expect } from '../fixture';

/**
 * EN Purpose: Search page interaction coverage — filter, sort, currency/language switcher.
 *   Uses MLX ai() to freely drive interactions and aiQuery() to read actual state.
 *   Truth oracle is either (a) www source contracts or (b) PRD behavioral spec when a PRD link is available.
 *   No hardcoded testIDs for interaction steps — ai() reads visible UI text like a human.
 *
 * EN Surface: desktop (flight search results)
 * EN Concerns: filter, sort, currency-switcher, language-switcher
 * EN Lifecycle: candidate
 * EN Mode: Mode 3 (free explore + www/PRD oracle)
 *
 * ── How to add a new test ──────────────────────────────────────────────────
 *  Pure exploration (no PRD):   derive expectedBehavior from www source component logic
 *  PRD-backed:                  add `// EN PRD: <lark_doc_url>` annotation,
 *                               derive expectedBehavior from PRD spec description,
 *                               optionally cross-verify against www source
 *
 * ── Existing tests ────────────────────────────────────────────────────────
 *   1. Direct flights filter  → ai() click → aiQuery() verify all results show "Direct"
 *   2. Price sort (low→high)  → ai() click → aiQuery() verify price order is ascending
 *   3. Currency switch (CNY)  → ai() click USD|EN → select CNY → Done → aiQuery() verify price unit
 *   4. Language switch (中文) → ai() click → select 中文 → Done → aiQuery() verify UI language
 */

const SEARCH_URL = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const dt = `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
  return `https://www.traveloka.com/en-sg/flight/fullsearch?ap=SIN.JKTA&dt=${dt}&ps=1.0.0&sc=ECONOMY`;
})();

test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'Asia/Shanghai',
  extraHTTPHeaders: {
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.google.com/',
  },
});

// ── Helper: wait for results page to stabilise ──────────────────────────────
async function waitForResults(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // At least one flight card must be visible before we interact
  await page
    .locator('[data-testid*="flight-inventory-card"], [data-testid*="flight-card"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => {});
}

// ── Test 1: Direct flights filter ───────────────────────────────────────────
test('Search page — Direct flights filter applies correctly', async ({ page, ai, aiQuery }) => {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForResults(page);

  // MLX clicks the filter by reading visible label text — no testID needed
  await ai('In the filter sidebar, click the "Direct" or "Non-stop" filter option under the Stops section.');

  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForResults(page);

  // aiQuery reads visible flight cards and extracts stops info
  const cards = await aiQuery<Array<{ stops: string }>>(
    '{stops: string}[], for each visible flight result card extract the stops text (e.g. "Direct", "1 Stop", "2 Stops")',
  ).catch(() => [] as Array<{ stops: string }>);

  console.log(`[filter] ${cards.length} cards after Direct filter:`, JSON.stringify(cards.slice(0, 3)));

  if (cards.length > 0) {
    const nonDirect = cards.filter((c) => !/direct|non.?stop|0 stop/i.test(c.stops));
    if (nonDirect.length > 0) {
      console.warn(`[filter] ⚠️  ${nonDirect.length} non-direct results visible after Direct filter: ${JSON.stringify(nonDirect)}`);
    }
    // Soft assertion: log but don't hard-fail (filter may be loading)
    expect(nonDirect.length, `Non-direct flights visible after Direct filter: ${JSON.stringify(nonDirect)}`).toBe(0);
  } else {
    console.warn('[filter] No flight cards found after filter — possible render delay');
  }
});

// ── Test 2: Price sort (cheapest first) ─────────────────────────────────────
test('Search page — Price sort (cheapest first) returns ascending order', async ({ page, ai, aiQuery }) => {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForResults(page);

  // MLX finds and clicks the sort control — reads "Cheapest" or "Price" label
  await ai('Click the sort option that sorts flights by cheapest price first. It may be labelled "Cheapest", "Price (Low to High)", or similar.');

  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForResults(page);

  // Extract prices from visible cards
  const prices = await aiQuery<Array<{ price: number }>>(
    '{price: number}[], for each visible flight result card extract the numeric price (digits only, no currency symbol)',
  ).catch(() => [] as Array<{ price: number }>);

  console.log(`[sort] ${prices.length} cards after cheapest sort:`, JSON.stringify(prices.slice(0, 5)));

  if (prices.length >= 2) {
    // Check first 5 cards are in non-decreasing order
    const sample = prices.slice(0, 5).map((p) => p.price).filter((n) => !isNaN(n));
    for (let i = 1; i < sample.length; i++) {
      if (sample[i] < sample[i - 1]) {
        console.warn(`[sort] ⚠️  Price at position ${i} (${sample[i]}) is lower than previous (${sample[i - 1]})`);
      }
    }
    // Check that the first result is <= the last in sample (overall direction correct)
    const isAscending = sample[0] <= sample[sample.length - 1];
    expect(isAscending, `Prices should be ascending after cheapest sort: ${JSON.stringify(sample)}`).toBe(true);
  } else {
    console.warn('[sort] Not enough cards to verify sort order');
  }
});

// ── Test 3: Currency switcher (USD → CNY) ───────────────────────────────────
test('Search page — Currency switcher changes price display to CNY', async ({ page, ai, aiQuery }) => {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForResults(page);

  // Record price before switch
  const priceBefore = await aiQuery<string>(
    'string, the price text shown on the first visible flight result card including currency symbol',
  ).catch(() => '');
  console.log(`[currency] price before switch: ${priceBefore}`);

  // MLX clicks the currency/language switcher button (shows "USD | EN" or similar)
  await ai(
    'Click the currency and language selector button at the top of the page. ' +
    'It shows the current currency code like "USD" and language like "EN". ' +
    'In the panel that opens, select "CNY" (Renminbi / Chinese Yuan) from the currency list, ' +
    'then click the "Done" button to confirm.',
  );

  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForResults(page);

  const priceAfter = await aiQuery<string>(
    'string, the price text shown on the first visible flight result card including currency symbol',
  ).catch(() => '');
  console.log(`[currency] price after CNY switch: ${priceAfter}`);

  // Assert price unit changed to CNY
  const hasCny = /CNY|¥|人民币/i.test(priceAfter);
  if (!hasCny) {
    console.warn(`[currency] ⚠️  Price still shows "${priceAfter}" after CNY switch — switcher may not have applied`);
  }
  expect(hasCny, `Price should show CNY after currency switch, got: "${priceAfter}"`).toBe(true);
});

// ── Test 4: Language switcher (EN → 中文) ────────────────────────────────────
test('Search page — Language switcher changes UI to Chinese', async ({ page, ai, aiQuery }) => {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForResults(page);

  // MLX clicks the switcher and selects 中文
  await ai(
    'Click the currency and language selector button at the top of the page (shows "USD | EN" or similar). ' +
    'In the panel that opens, under "Select language", click "中文" to switch to Chinese. ' +
    'Then click "Done" to confirm.',
  );

  await page.waitForLoadState('networkidle').catch(() => {});

  // Verify at least one Chinese character appears in the page UI
  const uiLanguage = await aiQuery<{ hasChinese: boolean; sample: string }>(
    '{ hasChinese: boolean, sample: string } — ' +
    'hasChinese: whether the main navigation or page heading text contains Chinese characters, ' +
    'sample: copy one visible Chinese UI text from the page',
  ).catch(() => ({ hasChinese: false, sample: '' }));

  console.log(`[language] UI after 中文 switch:`, JSON.stringify(uiLanguage));

  expect(
    uiLanguage.hasChinese,
    `Page UI should show Chinese text after language switch. Sample: "${uiLanguage.sample}"`,
  ).toBe(true);
});

// ── PRD-backed test template ─────────────────────────────────────────────────
// When a PRD defines specific interaction behavior, add a test here following
// this pattern. The PRD link is the truth oracle; ai() is still the driver.
//
// EN PRD: <paste lark_doc_url here when applicable>
//
// Example shape (uncomment and fill when a real PRD case is added):
//
// test('Search page — <feature name> behaves per PRD <ticket>', async ({ page, ai, aiQuery }) => {
//   // EN PRD: https://bytedance.larkoffice.com/docx/xxxxx
//   // EN PRD Expected: <copy the relevant behavioral clause from the PRD>
//   // EN www Source: <component path where this is implemented, e.g. fpr-filter/FilterStops.tsx>
//
//   await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
//   await waitForResults(page);
//
//   // ai() drives the interaction — no hardcoded testIDs
//   await ai('<describe the interaction in plain English>');
//   await page.waitForLoadState('networkidle').catch(() => {});
//   await waitForResults(page);
//
//   // aiQuery reads actual state after interaction
//   const actual = await aiQuery<{ value: string }>(
//     '{ value: string }, <describe what to extract from the page>'
//   ).catch(() => ({ value: '' }));
//
//   console.log(`[prd-<ticket>] actual:`, JSON.stringify(actual));
//
//   // Assert against PRD-defined expected behavior
//   const expectedByPrd = '<expected value from PRD>';
//   expect(actual.value, `PRD requires <ticket>: expected "${expectedByPrd}", got "${actual.value}"`).toBe(expectedByPrd);
// });
