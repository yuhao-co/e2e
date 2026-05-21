import { expect, test } from '../fixture';
import {
  clickFirstAirlineFilter,
  clickTransitCountFilter,
  expectAirlineFilterChecked,
  expectAirlineFilterUnchecked,
  expectTransitCountFilterChecked,
  getAirlineSection,
  getTransitCountSection,
  travelokaFlightSearchResultsSelectors,
} from '../lib/traveloka-flight/locators';
import {
  assertFlightSearchCompleted,
  changeResultsPageRouteViaModal,
  openFlightSearchTask,
  waitForFlightSearchSidebar,
} from '../lib/traveloka-flight/workflow';

const DESKTOP_RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

const sourceContext = {
  doc: 'https://traveloka.sg.larksuite.com/wiki/HEeqweaOkihpt6k0ZxJl2Jgzgaf',
  requirement: {
    title: 'Carry-over Filter and Sort between Searches',
    why: 'Reduce repetitive work while keeping search state predictable across repeated desktop flight searches.',
    risk: 'Retained filters can create no-result confusion, so the flow must keep state understandable and recoverable.',
    scope: ['desktop web SSR', 'sort persistence rules', 'filter persistence rules', 'filter chips'],
    rules: {
      sameTripTypeSameRoute: 'Keep all filters.',
      routeOrTripTypeChanged: 'Keep only stop filter and baggage filter; reset others.',
      noResultsAutoReset: 'If no search results with previous filters, automatically reset filters.',
    },
  },
  changedFiles: [
    'desktop results filter sidebar',
    'desktop results retained sort/filter state',
    'desktop filter chip visibility',
  ],
};

/**
 * EN Purpose: Validate the desktop web slice of the carry-over filter/sort PRD by using a real SSR results page, applying a stop filter, and checking that retained state survives a same-search refresh.
 * 中文目的: 基于当前 PRD，验证 desktop web 的筛选/排序状态承接切片：在真实 SSR 结果页应用 stop filter，并检查同一搜索上下文刷新后 retained state 是否仍存在。
 * EN Surface: desktop flight search results sidebar and retained filter state.
 * 中文范围: desktop flight 搜索结果页侧边栏与 retained filter state。
 * EN Concerns: stop-filter selection, retained state, desktop-only scope, reset affordance.
 * 中文关注点: stop filter 选中、状态承接、仅桌面端范围、reset 可恢复性。
 * EN Main checks: open a desktop round-trip results page; validate both a single-filter carry-over slice and a multi-filter carry-over slice; reload the same results page in the same session; confirm retained checked-states still exist.
 * 中文校验项: 打开 desktop 往返结果页；验证单 filter 与多 filter 两种承接切片；在同一 session 中刷新同一结果页；确认 retained 选中态仍然存在。
 * EN Source summary: the PRD says same trip type plus same route should keep all filters, and desktop web SSR is explicitly in scope.
 * 中文来源摘要: PRD 明确说明同 trip type 且同 route 应保留全部 filters，且 desktop web SSR 明确在范围内。
 */

test.describe('Traveloka weekly diff generated desktop carry-over coverage', () => {
  test('desktop round-trip retains 1-transit filter on same-search refresh', async ({ page }, testInfo) => {
    await testInfo.attach('desktop-carry-over-source.json', {
      body: Buffer.from(JSON.stringify(sourceContext, null, 2)),
      contentType: 'application/json',
    });

    const { sidebar } = await openFlightSearchTask(page, {
      url: DESKTOP_RESULTS_URL,
      userIntent:
        'Validate the desktop carry-over filter and sort PRD by applying a 1-transit filter and checking the retained state after a same-search refresh.',
      waitForSidebar: true,
    });

    if (!sidebar) {
      throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');
    }

    await expect(
      page.getByText(travelokaFlightSearchResultsSelectors.headings.flights),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(travelokaFlightSearchResultsSelectors.headings.filter),
    ).toBeVisible({ timeout: 15000 });
    await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });

    await clickTransitCountFilter(page, 'ONE_TRANSIT');
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');

    const afterFilter = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterFilter) {
      await testInfo.attach('desktop-carry-over-after-filter.png', {
        body: afterFilter,
        contentType: 'image/png',
      });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertFlightSearchCompleted(page);
    await waitForFlightSearchSidebar(page);
    await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });
    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');

    const afterReload = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterReload) {
      await testInfo.attach('desktop-carry-over-after-reload.png', {
        body: afterReload,
        contentType: 'image/png',
      });
    }
  });

  test('desktop round-trip retains transit plus airline filters on same-search refresh', async ({ page }, testInfo) => {
    await testInfo.attach('desktop-carry-over-source.json', {
      body: Buffer.from(JSON.stringify(sourceContext, null, 2)),
      contentType: 'application/json',
    });

    const { sidebar } = await openFlightSearchTask(page, {
      url: DESKTOP_RESULTS_URL,
      userIntent:
        'Validate the desktop carry-over PRD by applying both a 1-transit filter and one airline filter, then checking both retained states after a same-search refresh.',
      waitForSidebar: true,
    });

    if (!sidebar) {
      throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');
    }

    await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });
    await expect(getAirlineSection(page)).toBeVisible({ timeout: 30000 });

    await clickTransitCountFilter(page, 'ONE_TRANSIT');
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');

    const airlineName = await clickFirstAirlineFilter(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');
    await expectAirlineFilterChecked(page, airlineName);

    const afterMultiFilter = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterMultiFilter) {
      await testInfo.attach('desktop-carry-over-after-multi-filter.png', {
        body: afterMultiFilter,
        contentType: 'image/png',
      });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertFlightSearchCompleted(page);
    await waitForFlightSearchSidebar(page);
    await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });
    await expect(getAirlineSection(page)).toBeVisible({ timeout: 30000 });
    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');
    await expectAirlineFilterChecked(page, airlineName);

    const afterMultiFilterReload = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterMultiFilterReload) {
      await testInfo.attach('desktop-carry-over-after-multi-filter-reload.png', {
        body: afterMultiFilterReload,
        contentType: 'image/png',
      });
    }
  });

  test('desktop round-trip keeps stop filter but resets airline filter when route changes', async ({ page }, testInfo) => {
    await testInfo.attach('desktop-carry-over-source.json', {
      body: Buffer.from(JSON.stringify(sourceContext, null, 2)),
      contentType: 'application/json',
    });

    const firstSearch = await openFlightSearchTask(page, {
      url: DESKTOP_RESULTS_URL,
      userIntent:
        'Validate the desktop carry-over PRD by applying a stop filter and an airline filter, then changing the route and checking that only the stop filter is retained.',
      waitForSidebar: true,
    });

    if (!firstSearch.sidebar) {
      throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');
    }

    await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });
    await expect(getAirlineSection(page)).toBeVisible({ timeout: 30000 });

    await clickTransitCountFilter(page, 'ONE_TRANSIT');
    await page.waitForLoadState('networkidle').catch(() => {});
    const airlineName = await clickFirstAirlineFilter(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');
    await expectAirlineFilterChecked(page, airlineName);

    await changeResultsPageRouteViaModal(page, {
      routeHints: ['Singapore', 'Jakarta'],
      destinationQuery: 'Denpasar',
      destinationOption: /Denpasar|DPS/i,
    });

    await assertFlightSearchCompleted(page);
    await waitForFlightSearchSidebar(page);

    await expect(getTransitCountSection(page)).toBeVisible({ timeout: 30000 });
    await expect(getAirlineSection(page)).toBeVisible({ timeout: 30000 });
    await expectTransitCountFilterChecked(page, 'ONE_TRANSIT');
    await expectAirlineFilterUnchecked(page, airlineName);

    const afterRouteChange = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterRouteChange) {
      await testInfo.attach('desktop-carry-over-after-route-change.png', {
        body: afterRouteChange,
        contentType: 'image/png',
      });
    }
  });
});
