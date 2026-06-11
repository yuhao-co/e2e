import { test, expect } from '../fixture';

/**
 * DEMO: Midscene equivalent of the Maestro YAML flow
 *
 * Maestro YAML (13 explicit steps, ~25 min to write manually):
 *   - launchApp, assertVisible "Flights", tapOn "From", inputText "Singapore",
 *     tapOn "Singapore (SIN)", tapOn "To", eraseText, inputText "Jakarta",
 *     tapOn "Search Flights", assertVisible "Direct"
 *
 * Midscene (below, ~2 min to write, AI executes naturally):
 *   - page.goto(), ai() for each interaction, aiQuery() for assertion
 *
 * Same scenario: SIN → Jakarta flight search from homepage → verify results
 */

test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'Asia/Singapore',
  extraHTTPHeaders: {
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.google.com/',
  },
});

test('Flight search — SIN to Jakarta (Midscene equivalent of Maestro demo)', async ({
  page,
  ai,
  aiQuery,
}) => {
  // Step 1: Open Traveloka flight homepage
  await page.goto('https://www.traveloka.com/en-sg/flight', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForLoadState('networkidle').catch(() => {});

  // Single AI instruction: fill From=Singapore, To=Jakarta, click Search
  await ai(
    'On this flight search page: 1) click the From field and type "Singapore" then select "Singapore (SIN)" from the dropdown, 2) click the To field and type "Jakarta" then wait for it to be selected, 3) click the "Search Flights" button',
  );

  // Step 5: Wait for results to load
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  // Step 6: Verify we're on the results page with Direct filter available
  const hasDirectFilter = await aiQuery<boolean>(
    'Is there a "Direct" or "Non-stop" filter option visible on this page?',
  );

  console.log('[demo] Direct filter visible:', hasDirectFilter);
  expect(hasDirectFilter).toBe(true);
});
