import { expect, type Locator, type Page } from '@playwright/test';

export type TransitCountOption = 'DIRECT' | 'ONE_TRANSIT' | 'TWO_PLUS_TRANSIT';

const transitOptionConfig: Record<
  TransitCountOption,
  { label: RegExp; fallbackIndex: number }
> = {
  DIRECT: { label: /direct/i, fallbackIndex: 0 },
  ONE_TRANSIT: { label: /(^|\s)1\s*transit|one\s*transit/i, fallbackIndex: 1 },
  TWO_PLUS_TRANSIT: { label: /2\+\s*transit|two\+?\s*transit|multiple\s*transit/i, fallbackIndex: 2 },
};

export const travelokaFlightSearchResultsSelectors = {
  sidebar: '[data-testid="flight-search-sidebar-filter"]',
  headings: {
    flights: /Your Flights/i,
    filter: /^Filter:/i,
    transit: /No\.\s*of\s*Transit|Transit/i,
  },
};

export function getFlightSearchSidebar(page: Page): Locator {
  return page.locator(travelokaFlightSearchResultsSelectors.sidebar);
}

export function getFlightFilterSection(page: Page, heading: RegExp): Locator {
  // Traveloka groups result filters inside a single desktop sidebar; narrow to
  // one visible section before looking for individual checkbox rows.
  return getFlightSearchSidebar(page)
    .locator('section, div')
    .filter({ hasText: heading })
    .first();
}

export function getTransitCountSection(page: Page): Locator {
  return getFlightFilterSection(page, travelokaFlightSearchResultsSelectors.headings.transit);
}

export function getTransitCountCheckbox(page: Page, option: TransitCountOption): Locator {
  const section = getTransitCountSection(page);
  const config = transitOptionConfig[option];
  const row = section
    .locator('label, [role="checkbox"], button, div')
    .filter({ hasText: config.label })
    .first();

  return row.locator('input[type="checkbox"]').first();
}

export async function clickTransitCountFilter(page: Page, option: TransitCountOption) {
  const section = getTransitCountSection(page);
  const config = transitOptionConfig[option];
  const row = section
    .locator('label, [role="checkbox"], button, div')
    .filter({ hasText: config.label })
    .first();

  if (await row.isVisible().catch(() => false)) {
    const checkbox = row.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible().catch(() => false)) {
      // Prefer the real checkbox when it is present; fall back to the row only
      // for UI variants that proxy the click through a wrapper element.
      await checkbox.click({ force: true });
      return checkbox;
    }

    await row.click({ force: true });
    return row;
  }

  const checkbox = section.locator('input[type="checkbox"]').nth(config.fallbackIndex);
  await checkbox.click({ force: true });
  return checkbox;
}

export async function expectTransitCountFilterChecked(page: Page, option: TransitCountOption) {
  const checkbox = getTransitCountCheckbox(page, option);
  if (await checkbox.count().catch(() => 0)) {
    await expect(checkbox).toBeChecked();
  }
}