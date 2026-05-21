import { expect, test, type Locator, type Page } from '../fixture';
import { requireUniqueVisibleLocator } from '../lib/traveloka-flight/locators';
import {
  assertFlightSearchCompleted,
  openFlightSearchTask,
  waitForFlightSearchSidebar,
} from '../lib/traveloka-flight/workflow';

const RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

type LocatorRoot = Page | Locator;

function byControlId(root: LocatorRoot, id: string) {
  return root.locator(`[data-id="${id}"], [data-testid="${id}"]`);
}

async function getActionableControlById(
  root: LocatorRoot,
  id: string,
  description: string,
) {
  const contract = byControlId(root, id);
  const count = await contract.count().catch(() => 0);
  expect(count, `Expected at least one contract node for ${description} (${id})`).toBeGreaterThan(0);

  const visibleContract = contract.filter({ visible: true });
  if ((await visibleContract.count().catch(() => 0)) >= 1) {
    return visibleContract.first();
  }

  const descendant = contract
    .locator('button, [role="button"], [role="tab"], input, label, div, span')
    .filter({ visible: true });
  expect(
    await descendant.count().catch(() => 0),
    `Expected a visible actionable descendant for ${description} (${id})`,
  ).toBeGreaterThan(0);

  return descendant.first();
}

async function clickControlById(
  root: LocatorRoot,
  id: string,
  description: string,
  clicked: string[],
) {
  const control = await getActionableControlById(root, id, description);
  await control.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await control.click({ force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/outside of the viewport/i.test(message)) {
      throw error;
    }

    await control.evaluate((element: Element) => {
      (element as HTMLElement).click();
    });
  }
  clicked.push(`${id}:${description}`);
  return control;
}

test.describe('Traveloka desktop flight form contracts', () => {
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

  test('clicks trained desktop form controls by explicit ids', async ({ page }, testInfo) => {
    const clickedControls: string[] = [];

    await openFlightSearchTask(page, {
      url: RESULTS_URL,
      userIntent:
        'Open the desktop Traveloka results page, open the change-search form, and validate trained component ids are actionable without text-driven selection.',
      waitForSidebar: true,
    });

    const searchTrigger = await requireUniqueVisibleLocator(
      byControlId(page, 'IcSystemSearch'),
      'results-page search trigger icon',
    );
    await searchTrigger.click({ force: true });

    const changeSearchButton = page.getByRole('button', { name: /Change search/i });
    if (await changeSearchButton.isVisible().catch(() => false)) {
      await changeSearchButton.click({ force: true });
    }

    const form = await requireUniqueVisibleLocator(
      page.locator('[data-testid="desktop-default-form"]'),
      'desktop default search form',
      { timeoutMs: 15_000 },
    );
    const overlay = await requireUniqueVisibleLocator(
      page.locator('[data-testid="flight-search-form"]'),
      'desktop flight search overlay',
      { timeoutMs: 15_000 },
    );

    await clickControlById(
      overlay,
      'oneway-roundtrip-tab',
      'round-trip tab control',
      clickedControls,
    );

    const departureContainer = await requireUniqueVisibleLocator(
      byControlId(overlay, 'airport-autocomplete-container-departure'),
      'departure airport container',
    );
    await departureContainer.click({ force: true });
    clickedControls.push('airport-autocomplete-container-departure:departure airport container');

    const departureInput = await requireUniqueVisibleLocator(
      departureContainer.locator('input'),
      'departure airport input',
    );
    await departureInput.fill('CGK');

    const cgkItem = await requireUniqueVisibleLocator(
      byControlId(page, 'item_nimbus-autocomplete-airport-cgk'),
      'CGK autocomplete airport item',
      { timeoutMs: 15_000 },
    );
    await cgkItem.click({ force: true });
    clickedControls.push('item_nimbus-autocomplete-airport-cgk:CGK autocomplete airport item');

    const passengersContainer = await requireUniqueVisibleLocator(
      byControlId(overlay, 'passengers-container'),
      'passengers container',
    );
    await passengersContainer.click({ force: true });
    clickedControls.push('passengers-container:passengers container');

    await expect(byControlId(page, 'passengers-row-child')).toBeVisible({ timeout: 10_000 });
    await expect(byControlId(page, 'passengers-row-infant')).toBeVisible({ timeout: 10_000 });
    clickedControls.push('passengers-row-child:child row visible');
    clickedControls.push('passengers-row-infant:infant row visible');

    const plusAdult = await requireUniqueVisibleLocator(
      byControlId(page, 'passengers-stepper-plus-adult'),
      'adult passenger stepper plus',
    );
    await plusAdult.click({ force: true });
    clickedControls.push('passengers-stepper-plus-adult:adult passenger stepper plus');

    const minusAdult = await requireUniqueVisibleLocator(
      byControlId(page, 'passengers-stepper-minus-adult'),
      'adult passenger stepper minus',
    );
    await minusAdult.click({ force: true });
    clickedControls.push('passengers-stepper-minus-adult:adult passenger stepper minus');

    const departureDateInput = await requireUniqueVisibleLocator(
      byControlId(overlay, 'departure-date-input'),
      'departure date input',
    );
    await departureDateInput.click({ force: true });
    clickedControls.push('departure-date-input:departure date input');

    const departureDateCell = await requireUniqueVisibleLocator(
      byControlId(page, 'date-cell-2026-6-1'),
      'departure date cell 2026-6-1',
      { timeoutMs: 15_000 },
    );
    await departureDateCell.click({ force: true });
    clickedControls.push('date-cell-2026-6-1:departure date cell');

    await clickControlById(
      overlay,
      'IcTransportSeatClass',
      'seat class control',
      clickedControls,
    );

    const searchButton = await requireUniqueVisibleLocator(
      byControlId(overlay, 'desktop-default-search-button'),
      'desktop default search button',
    );
    clickedControls.push('desktop-default-search-button:desktop default search button');

    await testInfo.attach('desktop-form-contracts-control-report.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            clickedControls,
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });

    const beforeSearch = await page.screenshot({ fullPage: false }).catch(() => null);
    if (beforeSearch) {
      await testInfo.attach('desktop-form-contracts-before-search.png', {
        body: beforeSearch,
        contentType: 'image/png',
      });
    }

    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      searchButton.click({ force: true }),
    ]);

    await assertFlightSearchCompleted(page);
    await waitForFlightSearchSidebar(page);

    const afterSearch = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterSearch) {
      await testInfo.attach('desktop-form-contracts-after-search.png', {
        body: afterSearch,
        contentType: 'image/png',
      });
    }
  });
});