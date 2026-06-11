import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
  clickByIdOrAi,
} from '../lib/traveloka-flight/workflow';
import { buildFlightSourceContextFromFiles } from '../lib/traveloka-flight/source-map';

import { travelokaFlightSearchResultsSelectors } from '../lib/traveloka-flight/locators';
import { getTaggedFlightResultCards, tagVisibleFlightResultCards } from '../lib/traveloka-flight/locators';
import { GenericBugDetector } from '../lib/generic-bug-detector';

const ROUTED_SOURCE_FILES = [
  'packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx',
];
const TARGET_URL = buildFlightSourceContextFromFiles(
  ROUTED_SOURCE_FILES,
  'Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.',
).url;

/**
 * EN Purpose: Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.
 * 中文目的: 验证本周 flight 改动在 search-results 场景下是否仍然满足既有回归预期。
 * EN Surface: search-results
 * 中文范围: search-results 页面。
 * EN Concerns: results-list
 * 中文关注点: results-list
 * EN Main checks: results list visibility and basic result-card rendering.
 * 中文校验项: 结果列表可见性与基础结果卡片渲染。
 * EN Source commits: dc0036b796 by Randi Adiel Gianufian: [FEATURE][FLIGHT][WEB] SSR - Filters (#33401)
 * 中文来源提交: dc0036b796 by Randi Adiel Gianufian: [FEATURE][FLIGHT][WEB] SSR - Filters (#33401)
 * EN Source summary: PRD (meegle): https://project.larksuite.com/fpr/epic/detail/11760659 | EPIC: https://project.larksuite.com/fpr/epic/detail/11760659 | Apply all locator rules from docs/traveloka-flight-locator-guideline.md | Validate filter structure per docs/traveloka-flight-filter-structure.md | Check carry-over behavior per docs/traveloka-flight-carry-over-airline-bug-report.md | ⭐ Run P0 critical bug detection (flight flows) - powered by config/p0-detection-rules.json | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active
 * 中文来源摘要: PRD (meegle): https://project.larksuite.com/fpr/epic/detail/11760659 | EPIC: https://project.larksuite.com/fpr/epic/detail/11760659 | Apply all locator rules from docs/traveloka-flight-locator-guideline.md | Validate filter structure per docs/traveloka-flight-filter-structure.md | Check carry-over behavior per docs/traveloka-flight-carry-over-airline-bug-report.md | ⭐ Run P0 critical bug detection (flight flows) - powered by config/p0-detection-rules.json | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active
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

test('Traveloka weekly diff generated flight results coverage (20260525)', async ({ page, ai }, testInfo) => {
  // ai = Midscene visual AI (MLX local model); used as fallback when data-id/data-testid is absent.
  // clickByIdOrAi(page, root, id, description, ai) tries data-id first, then ai().
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.",
    concerns: ["results-list"],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

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
  // Suggested changed files (top 10 of 23): ["packages/flight/fpr-search-result-ssr-components/desktop/Filter/FilterAirlineOption.story.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/FilterAirlineOption.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/FilterSection.story.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/FilterSection.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/Filter.story.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/Filter.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/FilterCheckboxOption.story.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/FilterCheckboxOption.tsx","packages/flight/fpr-search-result-ssr-components/desktop/Filter/filterConstants.ts","packages/flight/fpr-search-result-ssr-components/desktop/Filter/FilterSliderSection.story.tsx"]
  // Omitted additional changed files: 13
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
