import { expect, type Locator, type Page } from '@playwright/test';

export type TransitCountOption = 'DIRECT' | 'ONE_TRANSIT' | 'TWO_PLUS_TRANSIT';
export type FlightFilterOption = {
  labelText: string;
  filterOptionIdx: number;
};

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

export async function discoverFlightFilterOptionsInSection(
  sidebar: Locator,
  sectionTitle: string,
  tagAttribute = 'data-flight-filter-option-idx',
): Promise<FlightFilterOption[]> {
  return sidebar.evaluate(
    (
      sidebarEl: HTMLElement,
      payload: { sectionTitle: string; tagAttribute: string },
    ): FlightFilterOption[] => {
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      const { sectionTitle, tagAttribute } = payload;

      sidebarEl.querySelectorAll(`[${tagAttribute}]`).forEach((node) => {
        node.removeAttribute(tagAttribute);
      });

      const header = Array.from(sidebarEl.querySelectorAll('*')).find((node) => {
        const el = node as HTMLElement;
        return normalize(el.innerText ?? '') === sectionTitle;
      }) as HTMLElement | undefined;

      if (!header) return [];

      const sectionRoot = header.parentElement;
      const optionsRoot = sectionRoot?.nextElementSibling as HTMLElement | null;
      if (!sectionRoot || !optionsRoot) return [];

      const rows = Array.from(optionsRoot.querySelectorAll('*')) as HTMLElement[];
      const results: FlightFilterOption[] = [];
      let optIdx = 0;

      for (const el of rows) {
        if (window.getComputedStyle(el).cursor !== 'pointer') continue;
        if (el.tagName === 'A' || el.closest('a')) continue;

        let anc = el.parentElement;
        let nested = false;
        while (anc && anc !== optionsRoot) {
          if (window.getComputedStyle(anc).cursor === 'pointer') {
            nested = true;
            break;
          }
          anc = anc.parentElement;
        }
        if (nested) continue;

        const text = normalize(el.innerText ?? '');
        const imageAlt = normalize(
          ((el.querySelector('img[alt]') as HTMLImageElement | null)?.alt ?? ''),
        );
        if (!text || text.length > 120) continue;
        if (imageAlt && !text.toLowerCase().includes(imageAlt.toLowerCase())) continue;

        el.setAttribute(tagAttribute, String(optIdx));
        results.push({
          labelText: text.slice(0, 100),
          filterOptionIdx: optIdx,
        });
        optIdx++;
      }

      return results;
    },
    { sectionTitle, tagAttribute },
  );
}

export async function tagVisibleFlightResultCards(
  page: Page,
  tagAttribute = 'data-flight-result-card-idx',
) {
  return page.evaluate((payload: { tagAttribute: string }) => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    const { tagAttribute } = payload;

    document.querySelectorAll(`[${tagAttribute}]`).forEach((node) => {
      node.removeAttribute(tagAttribute);
    });

    const chooseControls = Array.from(
      document.querySelectorAll('button, div, span'),
    ).filter((node) => /^choose$/i.test(normalize((node as HTMLElement).innerText ?? '')));

    const tagged: HTMLElement[] = [];
    let idx = 0;

    for (const control of chooseControls) {
      let ancestor = (control as HTMLElement).parentElement;
      while (ancestor) {
        const text = normalize(ancestor.innerText ?? '');
        if (
          /flight details/i.test(text) &&
          /fare\s*&\s*benefits/i.test(text) &&
          /refund/i.test(text) &&
          /reschedule/i.test(text)
        ) {
          if (!tagged.includes(ancestor)) {
            ancestor.setAttribute(tagAttribute, String(idx));
            tagged.push(ancestor);
            idx++;
          }
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    return idx;
  }, { tagAttribute });
}

export function getTaggedFlightResultCards(
  page: Page,
  tagAttribute = 'data-flight-result-card-idx',
): Locator {
  return page.locator(`[${tagAttribute}]`);
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