import { expect, type Page, type TestInfo } from '@playwright/test';

import { dismissBlockingBottomButton, setupPopupDismissHandlers } from '../traveloka-page';
import { applyTravelokaSessionState } from '../traveloka-session-cookies';
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
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Register persistent popup handlers as early as possible so any overlay
  // that fires during or after network-idle is caught automatically.
  await setupPopupDismissHandlers(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissBlockingBottomButton(page);
}

async function throwIfRestricted(page: Page, stage: string) {
  const restricted = page.getByText(/Access is temporarily restricted/i);
  if (await restricted.isVisible().catch(() => false)) {
    throw new Error(`Traveloka blocked the session at ${stage}.`);
  }
}

export async function assertFlightSearchCompleted(page: Page) {
  const progress = page.getByText(/Searching for flights/i);

  try {
    await expect(progress).not.toBeVisible({ timeout: 30000 });
    await throwIfRestricted(page, 'initial search completion');
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
      await throwIfRestricted(page, 'initial search loading');
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
    await throwIfRestricted(page, 'post-reload');

    await expect(progress).not.toBeVisible({ timeout: 30000 });
    await throwIfRestricted(page, 'post-reload search completion');
    console.log('[step] search completed after reload');
  }
}