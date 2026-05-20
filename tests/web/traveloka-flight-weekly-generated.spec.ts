import { expect, test } from '../fixture';
import {
  discoverFlightFilterOptionsInSection,
  getTaggedFlightResultCards,
  tagVisibleFlightResultCards,
  travelokaFlightSearchResultsSelectors,
} from '../lib/traveloka-flight/locators';
import { openFlightSearchTask } from '../lib/traveloka-flight/workflow';

const RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

test.describe('Traveloka flight weekly generated coverage', () => {
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

  test('loads desktop results, discovers airline filters, and tags visible result cards', async ({
    page,
  }, testInfo) => {
    const { sidebar, workflowPlan } = await openFlightSearchTask(page, {
      url: RESULTS_URL,
      userIntent:
        'Open the desktop Traveloka flight search results page and validate the weekly regression areas for sidebar handling, filter discovery, and visible result-card tagging.',
      concerns: ['results-list', 'airline-filter'],
      waitForSidebar: true,
    });

    expect(new URL(page.url()).pathname).toBe(new URL(RESULTS_URL).pathname);
    expect(workflowPlan.sourceContext.surface).toBe('search-results');

    if (!sidebar) {
      throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');
    }

    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible({
      timeout: 15000,
    });

    const discoveredAirlines = await discoverFlightFilterOptionsInSection(
      sidebar,
      'Airline',
      'data-weekly-airline-option-idx',
    );

    await testInfo.attach('weekly-discovered-airlines.json', {
      body: Buffer.from(JSON.stringify(discoveredAirlines, null, 2)),
      contentType: 'application/json',
    });

    expect(
      discoveredAirlines.length,
      'Weekly generated case expects at least one airline filter option in the sidebar.',
    ).toBeGreaterThan(0);

    const taggedCardCount = await tagVisibleFlightResultCards(page, 'data-weekly-flight-card-idx');
    const cards = getTaggedFlightResultCards(page, 'data-weekly-flight-card-idx');

    expect(taggedCardCount, 'Weekly generated case expects visible flight result cards.').toBeGreaterThan(0);
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    const firstCardText = await cards.first().innerText();
    expect(firstCardText).toMatch(/flight details|fare\s*&\s*benefits/i);

    const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
    if (screenshot) {
      await testInfo.attach('weekly-generated-results.png', {
        body: screenshot,
        contentType: 'image/png',
      });
    }
  });
});