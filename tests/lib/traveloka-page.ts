import { type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Known Traveloka popup catalogue (sourced from live pages)
//
// ALL pages
//   "We've got a deal you can't resist!" login modal
//     → "Browse as a guest"  (primary)  or  "Close"  (fallback)
//   "Coupon copied!" toast
//     → "Close"
//
// /flight/fullsearch  and  /flight/fulltwosearch
//   "New! View your round-trip price immediately" round-trip price modal
//     → "OK"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register persistent locator handlers so any of the above popups are
 * dismissed automatically whenever Playwright is about to perform an action
 * and the blocking overlay is in the way.
 *
 * Call once per page after navigation.
 */
export async function setupPopupDismissHandlers(page: Page): Promise<void> {
  // 1. Login / "deal" modal (all pages)
  await page
    .addLocatorHandler(
      page.getByText(/We've got a deal you can't resist/i).first(),
      async () => {
        if (page.isClosed()) return;
        const browseAsGuest = page.getByRole('button', { name: /Browse as a guest/i });
        const close = page.getByRole('button', { name: /^Close$/i });
        if (await browseAsGuest.isVisible().catch(() => false)) {
          await browseAsGuest.click({ force: true }).catch(() => {});
        } else if (await close.isVisible().catch(() => false)) {
          await close.click({ force: true }).catch(() => {});
        }
      },
    )
    .catch(() => {});

  // 2. Round-trip price announcement (flight results pages)
  // Button text observed in the wild: "Ok, Got it"
  await page
    .addLocatorHandler(
      page.getByText(/View your round-trip price immediately/i).first(),
      async () => {
        if (page.isClosed()) return;
        // The button label is "Ok, Got it" — match broadly on "ok" to be resilient
        const ok = page
          .locator('button, [role="button"]')
          .filter({ hasText: /ok/i })
          .first();
        if (await ok.isVisible().catch(() => false)) {
          await ok.click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
        }
      },
    )
    .catch(() => {});

  // 3. "Coupon copied!" toast (all pages)
  await page
    .addLocatorHandler(
      page.getByText(/Coupon copied/i).first(),
      async () => {
        if (page.isClosed()) return;
        const close = page
          .locator('button, [role="button"]')
          .filter({ hasText: /^Close$/i })
          .first();
        if (await close.isVisible().catch(() => false)) {
          await close.click({ force: true }).catch(() => {});
        }
      },
    )
    .catch(() => {});
}

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

    const roundTripPricePopup = page.getByText(/View your round-trip price immediately/i);
    const roundTripPriceConfirm = page
      .locator('button, [role="button"], [tabindex="0"], div, span')
      .filter({ hasText: /ok/i })
      .last();

    if (
      await roundTripPricePopup.isVisible().catch(() => false) &&
      await roundTripPriceConfirm.isVisible().catch(() => false)
    ) {
      await roundTripPriceConfirm.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }

    // Login / "deal" modal
    const dealModal = page.getByText(/We've got a deal you can't resist/i);
    const browseAsGuest = page.getByRole('button', { name: /Browse as a guest/i });
    if (
      await dealModal.isVisible().catch(() => false) &&
      await browseAsGuest.isVisible().catch(() => false)
    ) {
      await browseAsGuest.click({ force: true }).catch(() => {});
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