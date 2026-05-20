import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
  restoreFlightSession,
} from '../lib/traveloka-flight/workflow';

import {
  discoverFlightFilterOptionsInSection,
  getTaggedFlightResultCards,
  tagVisibleFlightResultCards,
  travelokaFlightSearchResultsSelectors,
} from '../lib/traveloka-flight/locators';

const TARGET_URL = 'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

test('Traveloka weekly diff generated flight results coverage', async ({ page }, testInfo) => {
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight search results page and validate the weekly regression areas for sidebar handling, airline filter discovery, and visible result-card tagging.",
    concerns: ["results-list","airline-filter"],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  await restoreFlightSession(page);

  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: "Open the desktop Traveloka flight search results page and validate the weekly regression areas for sidebar handling, airline filter discovery, and visible result-card tagging.",
  });

  void sidebar;

  const currentUrl = new URL(page.url());
  expect(currentUrl.pathname).toBe(new URL(TARGET_URL).pathname);
  expect(workflowPlan.sourceContext.surface).toBe('search-results');
  if (!sidebar) {
    throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');
  }
  await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.flights)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(travelokaFlightSearchResultsSelectors.headings.filter)).toBeVisible({ timeout: 15000 });

  const discoveredAirlines = await discoverFlightFilterOptionsInSection(sidebar, 'Airline', 'data-weekly-airline-option-idx');
  await testInfo.attach('weekly-discovered-airlines.json', {
    body: Buffer.from(JSON.stringify(discoveredAirlines, null, 2)),
    contentType: 'application/json',
  });
  expect(discoveredAirlines.length, 'Weekly generated case expects at least one airline filter option in the sidebar.').toBeGreaterThan(0);
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
  // Weekly diff generated candidate: refine this case against the actual changed source files.
  // Suggested changed files: ["tests/lib/traveloka-flight/intent.ts","tests/lib/traveloka-flight/locators.ts","tests/lib/traveloka-flight/source-map.ts","tests/lib/traveloka-flight/template.ts","tests/lib/traveloka-flight/workflow.ts","tests/web/traveloka-flight-filter.spec.ts","tests/web/traveloka-flight-random-filter.spec.ts"]
  // Source hint: packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx - Closest verified results-page component discovered for current desktop flight surface.
  // Source hint: packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx - Desktop flight results filter sidebar component for the current v2 surface.
});
