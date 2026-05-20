import { expect, test } from '../fixture';
import {
  clickTransitCountFilter,
  expectTransitCountFilterChecked,
  getFlightSearchSidebar,
  getTransitCountSection,
  travelokaFlightSearchResultsSelectors,
} from '../lib/traveloka-flight/locators';
import { assertFlightSearchCompleted } from '../lib/traveloka-flight/workflow';
import { setupPopupDismissHandlers } from '../lib/traveloka-page';

const RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

test.describe('Traveloka flight search filters', () => {
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

  test('applies the 1-transit filter for the default SIN to JKTA round-trip search', async ({
    page,
  }, testInfo) => {
    // --- Step 1: go directly to results page, no session restore ---
    console.log('[step] goto results page');
    await page.goto(RESULTS_URL);
    console.log('[step] page loaded, url=', page.url());

    // Register persistent popup handlers immediately after navigation
    await setupPopupDismissHandlers(page);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Attach a screenshot so we can see what landed
    const afterGoto = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterGoto) {
      await testInfo.attach('after-goto.png', { body: afterGoto, contentType: 'image/png' });
    }

    // --- Step 2: wait for flight search to finish loading ---
    console.log('[step] waiting for search to complete');
    await assertFlightSearchCompleted(page);
    console.log('[step] search completed');

    // Attach screenshot after search completes
    const afterSearch = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterSearch) {
      await testInfo.attach('after-search.png', { body: afterSearch, contentType: 'image/png' });
    }

    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible({ timeout: 15000 });

    // --- Step 3: apply 1-transit filter ---
    const sidebarFilter = getFlightSearchSidebar(page);
    const noOfTransitSection = getTransitCountSection(page);

    console.log('[step] waiting for sidebar filter to be visible');
    await expect(sidebarFilter).toBeVisible({ timeout: 30000 });
    await expect(noOfTransitSection).toBeVisible({ timeout: 30000 });
    console.log('[step] clicking 1-transit filter');
    await clickTransitCountFilter(page, 'ONE_TRANSIT');
    await page.waitForLoadState('networkidle').catch(() => {});

    // Attach screenshot after filter click
    const afterFilter = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterFilter) {
      await testInfo.attach('after-filter.png', { body: afterFilter, contentType: 'image/png' });
    }

    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');
    console.log('[step] done');
  });
});