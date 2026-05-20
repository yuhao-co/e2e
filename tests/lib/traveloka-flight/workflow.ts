import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { dismissBlockingBottomButton, setupPopupDismissHandlers } from '../traveloka-page';
import { applyTravelokaSessionState } from '../traveloka-session-cookies';
import { getFlightSearchSidebar } from './locators';
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
      workflowPlan.normalizedIntent.concerns.some((concern) => concern.endsWith('filter'));

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