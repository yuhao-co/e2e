import { expect, test } from './fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
  restoreFlightSession,
} from './lib/traveloka-flight/workflow';

const TARGET_URL = 'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

test('Traveloka weekly diff generated flight search regression', async ({ page }, testInfo) => {
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight search results page and validate the weekly regression areas touching filter, intent, locators, map, random. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.",
    concerns: ["results-list","search-form"],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  await restoreFlightSession(page);

  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: "Open the desktop Traveloka flight search results page and validate the weekly regression areas touching filter, intent, locators, map, random. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.",
  });

  void sidebar;

  const currentUrl = new URL(page.url());
  expect(currentUrl.pathname).toBe(new URL(TARGET_URL).pathname);

  // Weekly diff generated candidate: refine this case against the actual changed source files.
  // Suggested changed files: ["tests/lib/traveloka-flight/intent.ts","tests/lib/traveloka-flight/locators.ts","tests/lib/traveloka-flight/source-map.ts","tests/lib/traveloka-flight/template.ts","tests/lib/traveloka-flight/workflow.ts","tests/web/traveloka-flight-filter.spec.ts","tests/web/traveloka-flight-random-filter.spec.ts"]
  // Source hint: packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx - Closest verified results-page component discovered for current desktop flight surface.
  // Source hint: packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx - Desktop flight results filter sidebar component for the current v2 surface.
});
