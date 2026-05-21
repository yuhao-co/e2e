import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { dismissBlockingBottomButton, setupPopupDismissHandlers } from '../traveloka-page';
import { applyTravelokaSessionState } from '../traveloka-session-cookies';
import {
  getBookingContactEmailConfirmationField,
  getBookingContactEmailField,
  getBookingContactMismatchError,
  getBookingContactRequiredOrConfirmationError,
  getBookingContactSaveOrContinueButton,
  getFlightHomeSearchButton,
  getFlightHomeSearchWidget,
  getFlightResultChooseButton,
  requireUniqueVisibleLocator,
  getFlightSearchSidebar,
  getSelectTicketTypeDialog,
  getTicketTypeSelectButton,
  travelokaFlightHomeSelectors,
  travelokaFlightSearchResultsSelectors,
} from './locators';
import { normalizeFlightUserIntent, type NormalizedFlightIntent } from './intent';
import {
  buildFlightSourceContext,
  type FlightSourceContext,
  type FlightConcern,
} from './source-map';

export type FlightWorkflowInput = {
  url: string;
  userIntent: string;
  concerns?: FlightConcern[];
};

export type FlightWorkflowPlan = {
  input: FlightWorkflowInput;
  normalizedIntent: NormalizedFlightIntent;
  sourceContext: FlightSourceContext;
};

export type FlightWorkflowStep = {
  name: string;
  critical?: boolean;
  action: () => Promise<void>;
};

export type FlightSearchTaskInput = FlightWorkflowInput & {
  waitForSidebar?: boolean;
  sidebarTimeoutMs?: number;
};

export type FlightSearchTaskContext = {
  workflowPlan: FlightWorkflowPlan;
  sidebar: Locator | null;
};

export type MetasearchBookingContactInput = {
  url: string;
  viewport?: { width: number; height: number };
};

export type MetasearchEmailConfirmationInput = {
  email: string;
  mismatchedEmail?: string;
  requiredErrorText?: string;
  mismatchErrorText?: string;
};

type LocatorRoot = Page | Locator;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function byControlId(root: LocatorRoot, id: string) {
  return root.locator(`[data-id="${id}"], [data-testid="${id}"]`);
}

async function getActionableControlById(
  root: LocatorRoot,
  id: string,
  description: string,
) {
  const contract = byControlId(root, id);
  const visibleContract = contract.filter({ visible: true });

  const visibleCount = await visibleContract.count().catch(() => 0);
  if (visibleCount >= 1) {
    const directActionable = visibleContract
      .locator('button, [role="button"], [role="tab"], input, label, div, span')
      .filter({ visible: true });
    if ((await directActionable.count().catch(() => 0)) >= 1) {
      return directActionable.first();
    }

    return visibleContract.first();
  }

  return requireUniqueVisibleLocator(contract, description);
}

async function clickActionableControlById(
  root: LocatorRoot,
  id: string,
  description: string,
) {
  const control = await getActionableControlById(root, id, description);
  await control.scrollIntoViewIfNeeded().catch(() => {});

  try {
    await control.click({ force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/outside of the viewport|intercepts pointer events|not visible|not receive pointer events/i.test(message)) {
      throw error;
    }

    await control.evaluate((element: Element) => {
      (element as HTMLElement).click();
    });
  }

  return control;
}

export type SearchResultsToBookingInput = {
  url: string;
  viewport?: { width: number; height: number };
  sidebarTimeoutMs?: number;
};

export type ResultsPageSearchChangeInput = {
  routeHints: string[];
  destinationQuery: string;
  destinationOption: RegExp;
  destinationAirportCode?: string;
};

export function createFlightWorkflowPlan(input: FlightWorkflowInput): FlightWorkflowPlan {
  const normalizedIntent = normalizeFlightUserIntent({
    url: input.url,
    userIntent: input.userIntent,
  });
  const sourceContext = buildFlightSourceContext(input.url, normalizedIntent.promptIntent);

  if (input.concerns?.length) {
    sourceContext.concerns = input.concerns;
  }

  return { input, normalizedIntent, sourceContext };
}

export async function attachFlightWorkflowPlan(
  testInfo: TestInfo,
  plan: FlightWorkflowPlan,
) {
  await testInfo.attach('traveloka-flight-workflow-plan.json', {
    body: Buffer.from(JSON.stringify(plan, null, 2)),
    contentType: 'application/json',
  });
}

async function attachFlightStepFailure(
  page: Page,
  testInfo: TestInfo,
  step: string,
  error: unknown,
) {
  const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
  if (screenshot) {
    await testInfo.attach(`flight-step-${step}.png`, {
      body: screenshot,
      contentType: 'image/png',
    });
  }

  await testInfo.attach(`flight-step-${step}.json`, {
    body: Buffer.from(
      JSON.stringify(
        {
          step,
          url: page.url(),
          title: await page.title().catch(() => ''),
          error: error instanceof Error ? error.message : String(error),
          capturedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
}

export async function runFlightWorkflowStep(
  page: Page,
  testInfo: TestInfo,
  step: FlightWorkflowStep,
) {
  try {
    await step.action();
  } catch (error) {
    await attachFlightStepFailure(page, testInfo, step.name, error);
    if (step.critical !== false) {
      throw error;
    }
  }
}

export async function runFlightWorkflow(
  page: Page,
  testInfo: TestInfo,
  steps: FlightWorkflowStep[],
) {
    for (const step of steps) {
      await runFlightWorkflowStep(page, testInfo, step);
    }
}

export async function restoreFlightSession(page: Page) {
  // Restore the full exported browser state before any deep-link navigation so
  // Traveloka sees the same cookies and storage a real user exported.
  await applyTravelokaSessionState(page);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await dismissBlockingBottomButton(page);
}

export async function openFlightResultsPage(page: Page, url: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Register persistent popup handlers as early as possible so any overlay
    // that fires during or after network-idle is caught automatically.
    await setupPopupDismissHandlers(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    await dismissBlockingBottomButton(page);

    if (!(await isTravelokaRestricted(page))) {
      return;
    }

    if (attempt < 3) {
      console.log(`[step] initial navigation blocked, retrying (${attempt + 1}/3)`);
      await page.goto('about:blank', { waitUntil: 'load' }).catch(() => {});
      await page.waitForTimeout(1200 * attempt).catch(() => {});
    }
  }
}

export async function openFlightHomePage(page: Page, url = 'https://www.traveloka.com/en-en/flight') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await setupPopupDismissHandlers(page).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissBlockingBottomButton(page);
}

export async function waitForFlightHomeSearchWidget(page: Page, timeoutMs = 30_000) {
  const searchWidget = getFlightHomeSearchWidget(page);
  const searchButton = getFlightHomeSearchButton(page);

  await expect(page).toHaveURL(travelokaFlightHomeSelectors.pageUrlPattern, {
    timeout: timeoutMs,
  });
  await expect(searchWidget).toBeVisible({ timeout: timeoutMs });
  await expect(searchButton).toBeVisible({ timeout: timeoutMs });

  return searchWidget;
}

export async function openMetasearchBookingContactPage(
  page: Page,
  input: MetasearchBookingContactInput,
) {
  if (input.viewport) {
    await page.setViewportSize(input.viewport);
  }

  await page.goto(input.url, { waitUntil: 'domcontentloaded' });
  await setupPopupDismissHandlers(page).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissBlockingBottomButton(page);
}

export async function openBookingPageFromSearchResults(
  page: Page,
  input: SearchResultsToBookingInput,
) {
  // Canonical desktop booking chain discovered from the recorded flow:
  // fullsearch results -> Choose -> Select ticket type drawer -> Select -> booking.
  if (input.viewport) {
    await page.setViewportSize(input.viewport);
  }

  await openFlightResultsPage(page, input.url);
  await assertFlightSearchCompleted(page);
  await waitForFlightSearchSidebar(page, input.sidebarTimeoutMs);
  await dismissBlockingBottomButton(page);

  const chooseButton = getFlightResultChooseButton(page);
  await expect(chooseButton, 'Expected at least one visible Choose button on the flight results page.').toBeVisible({ timeout: 20000 });
  await chooseButton.click();

  const ticketTypeDialog = getSelectTicketTypeDialog(page);
  await expect(ticketTypeDialog, 'Expected the Select ticket type drawer to appear after clicking Choose.').toBeVisible({ timeout: 20000 });

  const selectButton = getTicketTypeSelectButton(page);
  await expect(selectButton, 'Expected at least one Select button inside the ticket type drawer.').toBeVisible({ timeout: 20000 });

  await Promise.all([
    page.waitForURL(travelokaFlightSearchResultsSelectors.bookingUrlPattern, { timeout: 30000 }),
    selectButton.click(),
  ]);

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissBlockingBottomButton(page);
}

function getResultsPageSearchTrigger(page: Page) {
  return byControlId(page, 'IcSystemSearch');
}

function getResultsPageSearchModal(page: Page) {
  return page.locator('[data-testid="desktop-default-form"]');
}

function getResultsPageSearchModalFallback(page: Page) {
  return page.locator('[data-testid="flight-search-form"]');
}

function getResultsPageFormControlByDataId(modal: Locator, dataId: string) {
  return modal.locator(`[data-id="${dataId}"]`);
}

function getResultsPageReturnDateContainer(modal: Locator) {
  return getResultsPageFormControlByDataId(modal, 'return-date-container');
}

function getResultsPageDepartureDateContainer(modal: Locator) {
  return getResultsPageFormControlByDataId(modal, 'departure-date-container');
}

function getResultsPageAirportAutocompleteItems(page: Page) {
  return page.locator('[data-testid^="item_nimbus-autocomplete-airport-"]');
}

function getResultsPageAirportAutocompleteItem(
  page: Page,
  destinationOption: RegExp,
  airportCode?: string,
) {
  if (airportCode) {
    return page.locator(
      `[data-testid="item_nimbus-autocomplete-airport-${airportCode.toLowerCase()}"]`,
    );
  }

  return getResultsPageAirportAutocompleteItems(page).filter({ hasText: destinationOption });
}

function getResultsPageChangeSearchButton(page: Page) {
  return page.getByRole('button', { name: /Change search/i });
}

export async function changeResultsPageRouteViaModal(
  page: Page,
  input: ResultsPageSearchChangeInput,
) {
  await clickActionableControlById(
    page,
    'IcSystemSearch',
    'desktop results-page search trigger',
  );

  let modal = getResultsPageSearchModal(page);
  await page.waitForTimeout(800).catch(() => {});
  const modalVisibleAfterTrigger = await modal.isVisible().catch(() => false);
  const changeSearchVisibleAfterTrigger = await getResultsPageChangeSearchButton(page)
    .isVisible()
    .catch(() => false);

  if (!modalVisibleAfterTrigger) {
    if (!changeSearchVisibleAfterTrigger) {
      await clickActionableControlById(
        page,
        'IcSystemSearch',
        'desktop results-page search trigger retry',
      );
      await page.waitForTimeout(800).catch(() => {});
    }

    const changeSearchButton = await requireUniqueVisibleLocator(
      getResultsPageChangeSearchButton(page),
      'desktop results-page change-search button',
      { timeoutMs: 15_000 },
    );
    await changeSearchButton.click({ force: true });
  }

  const desktopDefaultFormVisible = await getResultsPageSearchModal(page)
    .filter({ visible: true })
    .count()
    .catch(() => 0);
  modal = await requireUniqueVisibleLocator(
    desktopDefaultFormVisible ? getResultsPageSearchModal(page) : getResultsPageSearchModalFallback(page),
    desktopDefaultFormVisible
      ? 'desktop results-page search modal form'
      : 'desktop results-page search modal wrapper',
    { timeoutMs: 15_000 },
  );

  const destinationInput = await requireUniqueVisibleLocator(
    modal.locator('input[placeholder="Destination"]'),
    'desktop results-page destination input',
  );
  await destinationInput.click({ force: true });
  await destinationInput.fill(input.destinationQuery);

  const destinationOption = await requireUniqueVisibleLocator(
    getResultsPageAirportAutocompleteItem(page, input.destinationOption, input.destinationAirportCode),
    input.destinationAirportCode
      ? `destination airport item ${input.destinationAirportCode.toLowerCase()}`
      : `destination airport item matching ${String(input.destinationOption)}`,
    { timeoutMs: 15_000 },
  );
  await destinationOption.click({ force: true });

  // Desktop default form keeps date pickers as clickable containers under data-id
  // instead of raw inputs. Keep explicit helpers so future route/date mutations
  // can target the real controls instead of guessing by text order.
  await getResultsPageDepartureDateContainer(modal).count().catch(() => 0);
  await getResultsPageReturnDateContainer(modal).count().catch(() => 0);

  const searchButton = await requireUniqueVisibleLocator(
    modal.getByRole('button', { name: travelokaFlightHomeSelectors.searchButton }),
    'desktop results-page search flights button',
  );

  await Promise.all([
    page.waitForLoadState('domcontentloaded').catch(() => {}),
    searchButton.click(),
  ]);

  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissBlockingBottomButton(page);
}

export async function assertMetasearchEmailConfirmationBehavior(
  page: Page,
  input: MetasearchEmailConfirmationInput,
) {
  const emailField = getBookingContactEmailField(page);
  const confirmationField = getBookingContactEmailConfirmationField(page);
  const saveOrContinueButton = getBookingContactSaveOrContinueButton(page);
  const mismatchedEmail = input.mismatchedEmail ?? 'qa-metasearch-typo@example.com';
  const requiredErrorText = input.requiredErrorText ?? 'Please re-enter your email';
  const mismatchErrorText = input.mismatchErrorText ?? 'Please input the same email address';

  await expect(
    emailField,
    'Primary email field should be present on booking contact form.',
  ).toBeVisible({ timeout: 15000 });

  const hasConfirmationField = await confirmationField.isVisible().catch(() => false);
  if (!hasConfirmationField) {
    throw new Error(
      [
        'Booking contact page loaded, but no email confirmation field was rendered.',
        'This usually means the current booking token is not in the eligible direct-metasearch cohort, or the affiliateId / AB-test gate is off for this route.',
        `Current URL: ${page.url()}`,
      ].join(' '),
    );
  }

  await expect(saveOrContinueButton).toBeVisible({ timeout: 15000 });

  await emailField.fill(input.email);
  await confirmationField.fill('');
  await saveOrContinueButton.click();

  await expect(
    page.getByText(new RegExp(escapeRegExp(requiredErrorText), 'i')).first(),
    `Empty confirmation field should surface the PRD error: ${requiredErrorText}`,
  ).toBeVisible({ timeout: 15000 });

  await confirmationField.fill(mismatchedEmail);
  await saveOrContinueButton.click();

  await expect(
    page.getByText(new RegExp(escapeRegExp(mismatchErrorText), 'i')).first(),
    `Mismatched confirmation email should surface the PRD error: ${mismatchErrorText}`,
  ).toBeVisible({ timeout: 15000 });

  await confirmationField.fill(input.email);
  await saveOrContinueButton.click();

  await expect(
    page.getByText(new RegExp(escapeRegExp(mismatchErrorText), 'i')).first(),
  ).toBeHidden({ timeout: 10000 }).catch(() => {});
}

export async function isTravelokaRestricted(page: Page) {
  for (const frame of page.frames()) {
    const restricted = frame.getByText(/Access is temporarily restricted/i).first();
    if (await restricted.isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

export async function throwIfTravelokaRestricted(page: Page, stage: string) {
  if (await isTravelokaRestricted(page)) {
    throw new Error(`Traveloka blocked the session at ${stage}.`);
  }
}

export function isFlightSearchResultsPlan(plan: FlightWorkflowPlan) {
  if (plan.normalizedIntent.surface === 'search-results') {
    return true;
  }

  return plan.normalizedIntent.concerns.some((concern) =>
    ['results-list', 'transit-filter', 'airline-filter', 'date-flow'].includes(concern),
  );
}

export async function waitForFlightSearchSidebar(page: Page, timeoutMs = 30_000) {
  const sidebar = getFlightSearchSidebar(page);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isTravelokaRestricted(page)) {
      throw new Error('Traveloka blocked the session before the filter sidebar became available.');
    }

    if (await sidebar.isVisible().catch(() => false)) {
      return sidebar;
    }

    await page.waitForTimeout(500);
  }

  if (await isTravelokaRestricted(page)) {
    throw new Error('Traveloka blocked the session before the filter sidebar became available.');
  }

  throw new Error('Flight results loaded, but the filter sidebar never became visible.');
}

export async function openFlightSearchTask(
  page: Page,
  input: FlightSearchTaskInput,
): Promise<FlightSearchTaskContext> {
  const workflowPlan = createFlightWorkflowPlan(input);
  await openFlightResultsPage(page, workflowPlan.input.url);

  let sidebar: Locator | null = null;
  if (isFlightSearchResultsPlan(workflowPlan)) {
    await assertFlightSearchCompleted(page);
    await throwIfTravelokaRestricted(page, 'after search completed');

    const shouldWaitForSidebar =
      input.waitForSidebar ??
      workflowPlan.sourceContext.concerns.some(
        (concern) => concern === 'results-list' || concern.endsWith('filter'),
      );

    if (shouldWaitForSidebar) {
      sidebar = await waitForFlightSearchSidebar(page, input.sidebarTimeoutMs);
      await throwIfTravelokaRestricted(page, 'before filter discovery');
    }
  }

  return { workflowPlan, sidebar };
}

export async function assertFlightSearchCompleted(page: Page) {
  const progress = page.getByText(/Searching for flights/i);

  try {
    await expect(progress).not.toBeVisible({ timeout: 30000 });
    await throwIfTravelokaRestricted(page, 'initial search completion');
    console.log('[step] search completed');
    return;
  } catch (error) {
    if (page.isClosed()) {
      throw new Error('Traveloka search page closed before results became ready.');
    }

    if ((await page.title().catch(() => '')).match(/Access is temporarily restricted/i)) {
      console.log('[step] search blocked by restricted page');
      throw new Error('Traveloka blocked the session during initial search loading.');
    }

    try {
      await throwIfTravelokaRestricted(page, 'initial search loading');
    } catch (restrictedError) {
      console.log('[step] search blocked by restricted page');
      throw restrictedError;
    }

    // Traveloka occasionally stalls on the skeleton/loading state without
    // ever transitioning to results. One reload is the cheapest local
    // recovery before we treat this as a real failure.
    console.log('[step] search appears stuck, reloading once');
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await setupPopupDismissHandlers(page).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await dismissBlockingBottomButton(page);
    await throwIfTravelokaRestricted(page, 'post-reload');

    await expect(progress).not.toBeVisible({ timeout: 30000 });
    await throwIfTravelokaRestricted(page, 'post-reload search completion');
    console.log('[step] search completed after reload');
  }
}