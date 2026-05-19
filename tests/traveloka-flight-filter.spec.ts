import { expect, test } from './fixture';
import { dismissBlockingBottomButton } from './lib/traveloka-page';
import { applyTravelokaSessionState } from './lib/traveloka-session-cookies';

const HOME_URL = 'https://www.traveloka.com/en-sg';
const FLIGHT_URL = 'https://www.traveloka.com/en-sg/flight';
const EXPECTED_PATHNAME = '/en-sg/flight/fulltwosearch';
const EXPECTED_SEARCH_PARAMS = {
  ap: 'SIN.JKTA',
  dt: '20-5-2026.22-5-2026',
  ps: '1.0.0',
  sc: 'ECONOMY',
};
const UI_STEP_TIMEOUT_MS = 45_000;

async function attachFailureReport(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  step: string,
  error: unknown,
) {
  const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
  if (screenshot) {
    await testInfo.attach(`timeout-${step}.png`, {
      body: screenshot,
      contentType: 'image/png',
    });
  }

  const report = {
    step,
    url: page.url(),
    title: await page.title().catch(() => ''),
    error: error instanceof Error ? error.message : String(error),
    capturedAt: new Date().toISOString(),
  };

  await testInfo.attach(`timeout-${step}.json`, {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  });
}

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
    await attachFailureReport(page, testInfo, step, error);
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

async function openFlightEntry(page: import('@playwright/test').Page) {
  await page.goto(FLIGHT_URL, { waitUntil: 'domcontentloaded' });
}

test.describe('Traveloka flight search filters', () => {
  test('applies the 1-transit filter for the default SIN to JKTA round-trip search', async ({
    page,
  }, testInfo) => {
    await runWithStepTimeout(page, testInfo, 'open-flight-entry', async () => {
      await openFlightEntry(page);
      await dismissBlockingBottomButton(page);
    });
    await runWithStepTimeout(page, testInfo, 'apply-session-state', async () => {
      await applyTravelokaSessionState(page);
      await Promise.race([
        page.reload({ waitUntil: 'load' }),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]).catch(() => {});
      await page.waitForTimeout(1000);
      await dismissBlockingBottomButton(page);
    });

    const originField = page.getByRole('textbox', { name: 'Origin' });
    const destinationField = page.getByRole('textbox', { name: 'Destination' });
    const roundTripButton = page.getByRole('button', { name: 'Round-trip' });
    const returnDateField = page.locator('input[data-testid="return-date-input"]');

    await runWithStepTimeout(page, testInfo, 'prepare-search-form', async () => {
      await expect(page.getByRole('heading', {
        name: 'Cheap Flights, Airline Fares & Fly Ticket Booking at Traveloka',
      })).toBeVisible();
      await expect(originField).toHaveValue('Singapore (SIN)');
      await expect(destinationField).toHaveValue('Jakarta (JKTA)');

      await page.waitForTimeout(1000);
      await dismissBlockingBottomButton(page);
      
      // Click Round-trip button
      if (await roundTripButton.isVisible().catch(() => false)) {
        await roundTripButton.click().catch(() => {});
        await page.waitForTimeout(800);
        await dismissBlockingBottomButton(page);
      }

      // Set return date
      await returnDateField.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
      
      // Click May 22 (return date)
      const mayDateButton = page.getByText('22', { exact: true }).last();
      if (await mayDateButton.isVisible().catch(() => false)) {
        await mayDateButton.click().catch(() => {});
      }
      
      await page.waitForTimeout(1000);
      await dismissBlockingBottomButton(page);
    }, 60000);

    await runWithStepTimeout(page, testInfo, 'submit-search', async () => {
      await Promise.all([
        page.waitForURL(/\/en-sg\/flight\/fulltwosearch\?/),
        page.getByRole('button', { name: 'Search Flights' }).click(),
      ]);
      await dismissBlockingBottomButton(page);
      await assertTravelokaDidNotBlock(page);
    });

    const currentUrl = new URL(page.url());
    expect(currentUrl.pathname).toBe(EXPECTED_PATHNAME);
    expect(currentUrl.searchParams.get('ap')).toBe(EXPECTED_SEARCH_PARAMS.ap);
    expect(currentUrl.searchParams.get('dt')).toBe(EXPECTED_SEARCH_PARAMS.dt);
    expect(currentUrl.searchParams.get('ps')).toBe(EXPECTED_SEARCH_PARAMS.ps);
    expect(currentUrl.searchParams.get('sc')).toBe(EXPECTED_SEARCH_PARAMS.sc);
    
    await runWithStepTimeout(page, testInfo, 'wait-search-complete', async () => {
      await page.waitForTimeout(3000);
      await expect(page.getByText(/Searching for flights/i)).not.toBeVisible({
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
      await dismissBlockingBottomButton(page);
    });

    await expect(page.getByText('Your Flights', { exact: true })).toBeVisible();
    await expect(page.getByText('Filter:', { exact: true })).toBeVisible();

    const sidebarFilter = page.locator('[data-testid="flight-search-sidebar-filter"]');
    const noOfTransitSection = sidebarFilter
      .locator('div')
      .filter({ hasText: /No\.\s*of\s*Transit/i })
      .first();
    
    // Get all checkboxes in the No. of Transit section
    // Index 0 = Direct, Index 1 = 1 transit(s), Index 2 = 2+ transits
    const oneTransitCheckbox = noOfTransitSection
      .locator('input[type="checkbox"]')
      .nth(1);

    await runWithStepTimeout(page, testInfo, 'apply-transit-filter', async () => {
      await page.waitForTimeout(5000);
      await expect(sidebarFilter).toBeVisible();
      await expect(noOfTransitSection).toBeVisible();
      await expect(oneTransitCheckbox).toBeVisible();
      console.log('Found 1-transit checkbox, clicking now...');
      await oneTransitCheckbox.click({ force: true });
      await page.waitForTimeout(5000);
      await expect(oneTransitCheckbox).toBeChecked();
      await dismissBlockingBottomButton(page);
    });
  });
});