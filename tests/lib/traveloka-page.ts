import { type Page } from '@playwright/test';

const bottomCtaLabels = [
  'Continue',
  'Got it',
  'OK',
  'Close',
  'Allow',
  'Not now',
  'Maybe later',
  'Skip',
  'Dismiss',
];

const bottomCtaPattern = new RegExp(
  `^(${bottomCtaLabels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?:[!,.\\s].*)?$`,
  'i',
);

const modalSelectors = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-testid*="modal"]',
  '[data-testid*="dialog"]',
  '[class*="modal"]',
  '[class*="dialog"]',
  '[class*="bottomsheet"]',
  '[class*="bottom-sheet"]',
  '[style*="position: fixed"]',
  '[class*="overlay"]',
].join(', ');

export async function dismissBlockingBottomButton(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (page.isClosed()) {
      return;
    }

    const roundTripPricePopup = page.getByText('View your round-trip price immediately');
    const roundTripPriceConfirm = page
      .locator('button, [role="button"], [tabindex="0"], div, span')
      .filter({ hasText: /OK,\s*Got it/i })
      .last();

    if (
      await roundTripPricePopup.isVisible().catch(() => false) &&
      await roundTripPriceConfirm.isVisible().catch(() => false)
    ) {
      await roundTripPriceConfirm.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }

    const ctaCandidates = page
      .locator('button, [role="button"], [tabindex="0"], div, span, a')
      .filter({ hasText: bottomCtaPattern });
    const ctaCount = await ctaCandidates.count().catch(() => 0);

    for (let index = ctaCount - 1; index >= 0; index -= 1) {
      const candidate = ctaCandidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      const box = await candidate.boundingBox().catch(() => null);
      const withinBottomArea = Boolean(box && box.y > 420);
      const modalAncestor = page.locator(modalSelectors).filter({ has: candidate }).last();
      const isInsideModal = await modalAncestor.isVisible().catch(() => false);

      if (withinBottomArea || isInsideModal) {
        await candidate.click({ force: true }).catch(() => {});
        if (!page.isClosed()) {
          await page.waitForTimeout(500);
        }
        return;
      }
    }

    if (attempt < 2) {
      if (page.isClosed()) {
        return;
      }

      await page.waitForTimeout(400);
    }
  }
}