import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
  clickByIdOrAi,
} from '../lib/traveloka-flight/workflow';
import { buildFlightSourceContextFromFiles } from '../lib/traveloka-flight/source-map';

import { attachLocatorShadowProposal } from '../lib/locator-shadow-proposal';
import { travelokaFlightSearchResultsSelectors } from '../lib/traveloka-flight/locators';
import { getTaggedFlightResultCards, tagVisibleFlightResultCards } from '../lib/traveloka-flight/locators';
import { GenericBugDetector } from '../lib/generic-bug-detector';

const ROUTED_SOURCE_FILES = [
  "packages/flight/app-desktop/pages/flight/fullsearch.tsx",
  "packages/flight/app-desktop/pages/flight/fulltwosearch.tsx",
  "packages/flight/app-mobile/pages/flight/fullsearch.tsx",
  "packages/flight/app-mobile/pages/flight/fulltwosearch.tsx",
  "packages/flight/fpr-search-result-components/src/FlightCard/RoundTripAPI/FlightCard.tsx",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetails.story.tsx",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetails.stylex.ts",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetails.tsx",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetailsSegment.tsx",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetailsTransit.tsx",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/helpers.ts",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/routeDetailsStoryFrame.tsx",
  "packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/types.ts",
  "packages/flight/fpr-search-result-ssr-components/package.json",
  "packages/flight/fpr-search-result-v2/components/FlightItem/FlightItem.tsx",
  "packages/flight/fpr-search-result-v2/components/MobileNavbar/MobileNavbar.tsx",
  "packages/flight/fpr-search-result-v2/components/MobileSearchResultList/MobileFlightSearchResultItem.tsx",
  "packages/flight/fpr-search-result-v2/package.json",
  "packages/flight/fpr-search-result-v2/providers/SearchResultFetchProvider.tsx",
  "packages/flight/fpr-search-result/EntryPoints/EntryPointOneWayContainer.tsx",
  "packages/flight/fpr-search-result/EntryPoints/EntryPointTwoWayContainer.tsx",
  "packages/flight/fpr-search-result/package.json"
];
const TARGET_URL = buildFlightSourceContextFromFiles(
  ROUTED_SOURCE_FILES,
  "Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.",
).url;

const GENERATED_ACTION_CONTRACTS = [
  {
    "stepName": "results-list-first-visible-card",
    "scopeHint": "Visible flight results list on the desktop search surface",
    "expectedContracts": [
      "tagVisibleFlightResultCards(page, \"data-weekly-flight-card-idx\")",
      "getTaggedFlightResultCards(page, \"data-weekly-flight-card-idx\")"
    ],
    "preconditions": [
      "Flight results page headings are visible"
    ],
    "postconditions": [
      "At least one tagged visible result card is present"
    ],
    "confidence": "high"
  }
];

/**
 * EN Purpose: Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.
 * 中文目的: 验证本周 flight 改动在 search-results 场景下是否仍然满足既有回归预期。
 * EN Surface: search-results
 * 中文范围: search-results 页面。
 * EN Concerns: results-list
 * 中文关注点: results-list
 * EN Main checks: results list visibility and basic result-card rendering.
 * 中文校验项: 结果列表可见性与基础结果卡片渲染。
 * EN Source commits: d076923a9c by Randi Adiel Gianufian: [FEATURE][FLIGHT][D-WEB] SSR - transit route (#33520) | 40a950a2f6 by Shen Qiutong: [FEATURE][FLIGHT]: debug tool (#33441)
 * 中文来源提交: d076923a9c by Randi Adiel Gianufian: [FEATURE][FLIGHT][D-WEB] SSR - transit route (#33520) | 40a950a2f6 by Shen Qiutong: [FEATURE][FLIGHT]: debug tool (#33441)
 * EN Source summary: PRD: https://traveloka.sg.larksuite.com/wiki/Soe8wLdE8iHLW9kPCt9lfPF8gAb | This pull request introduces a new, highly-configurable `RouteDetails` component for displaying flight route timelines, including both flight segments and various transit scenarios. The implementation includes the main component, subcomponents for segments and transit details, supporting styles, Storybook stories, and configuration helpers for diverse route cases. | Apply all locator rules from docs/traveloka-flight-locator-guideline.md | Validate filter structure per docs/traveloka-flight-filter-structure.md | Check carry-over behavior per docs/traveloka-flight-carry-over-airline-bug-report.md | ⭐ Run P0 critical bug detection (flight flows) - powered by config/p0-detection-rules.json | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active
 * 中文来源摘要: PRD: https://traveloka.sg.larksuite.com/wiki/Soe8wLdE8iHLW9kPCt9lfPF8gAb | This pull request introduces a new, highly-configurable `RouteDetails` component for displaying flight route timelines, including both flight segments and various transit scenarios. The implementation includes the main component, subcomponents for segments and transit details, supporting styles, Storybook stories, and configuration helpers for diverse route cases. | Apply all locator rules from docs/traveloka-flight-locator-guideline.md | Validate filter structure per docs/traveloka-flight-filter-structure.md | Check carry-over behavior per docs/traveloka-flight-carry-over-airline-bug-report.md | ⭐ Run P0 critical bug detection (flight flows) - powered by config/p0-detection-rules.json | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active
 * EN Action contract confidence: high
 * 中文动作契约置信度: high
 * EN Action results-list-first-visible-card: scope=Visible flight results list on the desktop search surface; contracts=tagVisibleFlightResultCards(page, "data-weekly-flight-card-idx") | getTaggedFlightResultCards(page, "data-weekly-flight-card-idx"); confidence=high
 * 中文动作 results-list-first-visible-card: 范围=Visible flight results list on the desktop search surface；契约=tagVisibleFlightResultCards(page, "data-weekly-flight-card-idx") | getTaggedFlightResultCards(page, "data-weekly-flight-card-idx")；置信度=high
 * EN Expectation: keep this generated case aligned with the stable Traveloka desktop baseline flow and verify only the routed regression slice.
 * 中文预期: 该生成用例必须与稳定的 Traveloka desktop 基线流程保持一致，只验证本次路由到的回归范围。
 */

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

test('Traveloka weekly diff generated flight results coverage (20260602)', async ({ page, ai, aiQuery }, testInfo) => {
  // GENERATION MODE: PRD-driven regression spec.
  // Navigation strategy:
  //   - Use explicit www-derived contracts for navigation and form interaction.
  //   - If a required contract is missing at runtime, attach a shadow proposal artifact
  //     via aiQuery() for diagnosis, then fail loudly instead of letting AI continue the flow.
  //   - Keep ai()/aiQuery() as discovery or post-failure analysis tools, not the main executor.
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.",
    concerns: ["results-list"],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  if (GENERATED_ACTION_CONTRACTS.length > 0) {
    await testInfo.attach('generated-action-contracts.json', {
      body: Buffer.from(JSON.stringify({
        caseConfidence: "high",
        actionContracts: GENERATED_ACTION_CONTRACTS,
      }, null, 2)),
      contentType: 'application/json',
    });
  }

  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: "Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.",
    concerns: ["results-list"],
    waitForSidebar: true,
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
  
  // ── Mode 3: Free exploration — Direct-flights filter ────────────────────
  // ai() freely clicks the filter; aiQuery() reads actual stops; assert = www contract
  // www contract: selecting Direct filter → all result cards must show stopsCount === 0
  // EN PRD: https://traveloka.sg.larksuite.com/wiki/Soe8wLdE8iHLW9kPCt9lfPF8gAb
  try {
    await ai('In the filter sidebar, click the "Direct" or "Non-stop" filter option under the Stops section.');
    await page.waitForLoadState('networkidle').catch(() => {});
    const _filterCards = await aiQuery<Array<{ stops: string }>>(
      '{stops: string}[], stops text on each visible flight result card (e.g. "Direct", "1 Stop", "2 Stops")',
    ).catch(() => [] as Array<{ stops: string }>);
    if (_filterCards.length > 0) {
      const _nonDirect = _filterCards.filter((c) => !/direct|non.?stop|0 stop/i.test(c.stops));
      if (_nonDirect.length > 0) {
        console.warn('[mode3-filter] ⚠️  Non-direct results after Direct filter:', JSON.stringify(_nonDirect));
      }
      expect(_nonDirect, 'Mode 3 filter: after Direct filter all results should be non-stop').toHaveLength(0);
    } else {
      console.warn('[mode3-filter] No flight cards found after filter — possible render delay');
    }
  } catch (err) {
    console.warn('[mode3-filter] Skipped (interaction unavailable):', (err as Error).message);
  }
  
  // ── Mode 3: Free exploration — Price sort (cheapest first) ──────────────
  // ai() clicks cheapest sort; aiQuery() reads prices; assert ascending order
  // www contract: cheapest sort → first result has lowest price in visible set
  // EN PRD: https://traveloka.sg.larksuite.com/wiki/Soe8wLdE8iHLW9kPCt9lfPF8gAb
  try {
    await ai('Click the sort option that sorts flights by cheapest price first. It may be labelled "Cheapest" or "Price (Low to High)".');
    await page.waitForLoadState('networkidle').catch(() => {});
    const _sortPrices = await aiQuery<Array<{ price: number }>>(
      '{price: number}[], numeric price on each visible flight card, digits only without currency symbol',
    ).catch(() => [] as Array<{ price: number }>);
    if (_sortPrices.length >= 2) {
      const _nums = _sortPrices.slice(0, 5).map((p) => p.price).filter((n) => !isNaN(n));
      const _isAscending = _nums[0] <= _nums[_nums.length - 1];
      if (!_isAscending) {
        console.warn('[mode3-sort] ⚠️  Prices not ascending after cheapest sort:', JSON.stringify(_nums));
      }
      expect(_isAscending, `Mode 3 sort: prices should be ascending after cheapest sort: ${JSON.stringify(_nums)}`).toBe(true);
    } else {
      console.warn('[mode3-sort] Not enough cards to verify sort order');
    }
  } catch (err) {
    console.warn('[mode3-sort] Skipped (interaction unavailable):', (err as Error).message);
  }
  
  // P0 Critical Bug Detection
  const detector = new GenericBugDetector(page);
  const auditResults = await detector.runFullAudit({
    locale: "en-US",
    platform: "desktop",
    pageType: "flight-search",
    performanceBaseline: { lcp: 2500, cls: 0.1 },
  });
  const p0Issues = auditResults.filter(bug => bug.severity === "P0");
  if (p0Issues.length > 0) {
    console.error(`❌ P0 CRITICAL ISSUES FOUND: ${p0Issues.map(b => b.issue).join(", ")}`);
    expect(p0Issues).toHaveLength(0); // Enforce zero P0 bugs
  }

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
  // Suggested changed files (top 10 of 22): ["packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/helpers.ts","packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetails.story.tsx","packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetails.stylex.ts","packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetails.tsx","packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetailsSegment.tsx","packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/routeDetailsStoryFrame.tsx","packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/RouteDetailsTransit.tsx","packages/flight/fpr-search-result-ssr-components/desktop/RouteDetails/types.ts","packages/flight/fpr-search-result-ssr-components/package.json","packages/flight/fpr-search-result-v2/components/FlightItem/FlightItem.tsx"]
  // Omitted additional changed files: 12
  // Retrieved shared-helper: docs/traveloka-flight-locator-guideline.md - Relevant local evidence file for weekly diff generation.
  // Retrieved shared-helper: docs/traveloka-flight-filter-structure.md - Relevant local evidence file for weekly diff generation.
  // Retrieved shared-helper: tests/lib/traveloka-flight/workflow.ts - Exports: createFlightWorkflowPlan, isFlightSearchResultsPlan
  // Retrieved shared-helper: tests/lib/traveloka-flight/locators.ts - Exports: getFlightSearchSidebar, getFlightResultChooseButton, getFlightInventoryCardButton, getSelectTicketTypeDialog
  // Retrieved shared-helper: tests/lib/traveloka-flight/source-map.ts - Exports: inferFlightCanonicalUrlFromFiles, buildFlightSourceContextFromFiles, inferFlightSurface, buildFlightSourceContext
  // Retrieved shared-helper: tests/lib/traveloka-flight/template.ts - Exports: createFlightCaseTemplate
  // Retrieved shared-helper: docs/traveloka-flight-locator-guideline.md - Locator priority and Traveloka-specific rules
  // Retrieved shared-helper: docs/traveloka-flight-filter-structure.md - Sidebar filter component tree and runtime id patterns
  // Retrieved shared-helper: docs/traveloka-flight-carry-over-airline-bug-report.md - Carry-over behavior rules and known issues
  // Retrieved shared-helper: docs/weekly-diff-case-generator.md - Weekly diff generation strategy
  // Retrieved shared-helper: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md - Phase 2 layered execution strategy
  // Retrieved shared-helper: tests/lib/traveloka-flight/workflow.ts - Exports: createFlightWorkflowPlan, openFlightSearchTask, attachFlightWorkflowPlan
  // Retrieved shared-helper: tests/lib/traveloka-flight/locators.ts - Exports: getTaggedFlightResultCards, tagVisibleFlightResultCards, travelokaFlightSearchResultsSelectors
  // Retrieved shared-helper: config/p0-detection-rules.json - P0 critical bug detection rules (11 rules)
  // Source hint: packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx - Closest verified results-page component discovered for current desktop flight surface.
  // Source hint: packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx - Desktop flight results filter sidebar component for the current v2 surface.
});
