import { expect, test } from '../fixture';
import {
  clickTransitCountFilter,
  expectTransitCountFilterChecked,
  getTransitCountSection,
  travelokaFlightSearchResultsSelectors,
} from '../lib/traveloka-flight/locators';
import { openFlightSearchTask } from '../lib/traveloka-flight/workflow';

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
    console.log('[step] goto results page');
    const { sidebar } = await openFlightSearchTask(page, {
      url: RESULTS_URL,
      userIntent:
        'Open the desktop Traveloka flight search results page and apply the 1-transit filter in the sidebar.',
      waitForSidebar: true,
    });
    console.log('[step] page loaded, url=', page.url());

    // Attach a screenshot so we can see what landed
    const afterGoto = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterGoto) {
      await testInfo.attach('after-goto.png', { body: afterGoto, contentType: 'image/png' });
    }

    // Attach screenshot after search completes
    const afterSearch = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterSearch) {
      await testInfo.attach('after-search.png', { body: afterSearch, contentType: 'image/png' });
    }

    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible({ timeout: 15000 });

    // --- Step 3: apply 1-transit filter ---
    const noOfTransitSection = getTransitCountSection(page);

    console.log('[step] waiting for sidebar filter to be visible');
    if (!sidebar) {
      throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');
    }
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