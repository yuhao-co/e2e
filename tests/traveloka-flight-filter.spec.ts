import { expect, test } from './fixture';
import {
  clickTransitCountFilter,
  expectTransitCountFilterChecked,
  getFlightSearchSidebar,
  getTransitCountSection,
  travelokaFlightSearchResultsSelectors,
} from './lib/traveloka-flight/locators';
import {
  assertFlightSearchCompleted,
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightResultsPage,
  restoreFlightSession,
  runFlightWorkflow,
} from './lib/traveloka-flight/workflow';

const RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';
const EXPECTED_PATHNAME = '/en-sg/flight/fulltwosearch';
const EXPECTED_SEARCH_PARAMS = {
  ap: 'SIN.JKTA',
  dt: '20-5-2026.22-5-2026',
  ps: '1.0.0',
  sc: 'ECONOMY',
};
const UI_STEP_TIMEOUT_MS = 45_000;
const SESSION_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

async function runWithStepTimeout<T>(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  step: string,
  action: () => Promise<T>,
  timeoutMs = UI_STEP_TIMEOUT_MS,
) {
  try {
    return await action();
  } catch (error) {
    const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
    if (screenshot) {
      await testInfo.attach(`timeout-${step}.png`, {
        body: screenshot,
        contentType: 'image/png',
      });
    }

    await testInfo.attach(`timeout-${step}.json`, {
      body: Buffer.from(
        JSON.stringify(
          {
            step,
            url: page.url(),
            title: await page.title().catch(() => ''),
            error: error instanceof Error ? error.message : String(error),
            capturedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
    throw error;
  }
}

async function assertTravelokaDidNotBlock(page: import('@playwright/test').Page) {
  await page.waitForTimeout(2_000);

  const blockedOnPage = await page
    .getByText('Access is temporarily restricted')
    .count();
  const blockedInFrame = await page
    .frameLocator('iframe')
    .getByText('Access is temporarily restricted')
    .count()
    .catch(() => 0);

  expect(
    blockedOnPage + blockedInFrame,
    'Traveloka blocked the automated session before the results filters became available.',
  ).toBe(0);
}

test.describe('Traveloka flight search filters', () => {
  test.use({
    userAgent: SESSION_USER_AGENT,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      referer: 'https://www.google.com/',
    },
  });

  test('applies the 1-transit filter for the default SIN to JKTA round-trip search', async ({
    page,
  }, testInfo) => {
    const workflowPlan = createFlightWorkflowPlan({
      url: RESULTS_URL,
      userIntent: 'Open the desktop flight results page and apply the 1 transit sidebar filter.',
      concerns: ['results-list', 'transit-filter'],
    });

    await attachFlightWorkflowPlan(testInfo, workflowPlan);

    await runFlightWorkflow(page, testInfo, [
      {
        name: 'apply-session-state',
        action: async () => {
          await restoreFlightSession(page);
        },
      },
      {
        name: 'open-results-page',
        action: async () => {
          await openFlightResultsPage(page, workflowPlan.input.url);
          await assertTravelokaDidNotBlock(page);
        },
      },
    ]);

    const currentUrl = new URL(page.url());
    expect(currentUrl.pathname).toBe(EXPECTED_PATHNAME);
    expect(currentUrl.searchParams.get('ap')).toBe(EXPECTED_SEARCH_PARAMS.ap);
    expect(currentUrl.searchParams.get('dt')).toBe(EXPECTED_SEARCH_PARAMS.dt);
    expect(currentUrl.searchParams.get('ps')).toBe(EXPECTED_SEARCH_PARAMS.ps);
    expect(currentUrl.searchParams.get('sc')).toBe(EXPECTED_SEARCH_PARAMS.sc);
    
    await runWithStepTimeout(page, testInfo, 'wait-search-complete', async () => {
      await page.waitForTimeout(4000);
      await assertFlightSearchCompleted(page);
    });

    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible();
    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible();

    const sidebarFilter = getFlightSearchSidebar(page);
    const noOfTransitSection = getTransitCountSection(page);

    await runWithStepTimeout(page, testInfo, 'apply-transit-filter', async () => {
      await expect(sidebarFilter).toBeVisible({ timeout: 30000 });
      await expect(noOfTransitSection).toBeVisible({ timeout: 30000 });
      console.log('Found 1-transit filter section, clicking now...');
      await clickTransitCountFilter(page, 'ONE_TRANSIT');

      // Filter clicks can trigger a partial rerender of the results page, so
      // wait on page activity instead of sleeping against a stale page handle.
      await page.waitForLoadState('networkidle').catch(() => {});
      await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');
    });
  });
});