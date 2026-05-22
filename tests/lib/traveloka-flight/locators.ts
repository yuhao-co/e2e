import { expect, type Locator, type Page } from '@playwright/test';

export type TransitCountOption = 'DIRECT' | 'ONE_TRANSIT' | 'TWO_PLUS_TRANSIT';
export type FlightFilterOption = {
  labelText: string;
  filterOptionIdx: number;
};

type SidebarScrollOptions = {
  maxSteps?: number;
  resetToTop?: boolean;
};

type SidebarScrollUntilVisibleOptions = SidebarScrollOptions & {
  timeoutMs?: number;
};

type UniqueVisibleLocatorOptions = {
  timeoutMs?: number;
  sampleSize?: number;
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
    airline: /^Airline$/i,
  },
  chooseButton: /^Choose$/i,
  selectTicketTypeTitle: /Select ticket type/i,
  selectButton: /^Select$/i,
  bookingUrlPattern: /\/flight\/booking\?/i,
};

export const travelokaFlightHomeSelectors = {
  pageUrlPattern: /\/flight(?:$|\?)/i,
  searchWidget: 'form, [data-testid*="flight" i], section, div',
  fromFieldLabel: /^From$/i,
  toFieldLabel: /^To$/i,
  departureDateLabel: /^Departure date$/i,
  returnDateLabel: /^Return Date$|^Return date$/i,
  searchButton: /Search Flights/i,
};

export const travelokaFlightBookingContactSelectors = {
  emailField: 'input[type="email"]',
  emailConfirmationField: [
    'input[name*="confirmation" i]',
    'input[id*="confirmation" i]',
    'input[aria-label*="confirm" i]',
    'input[placeholder*="confirm" i]',
  ].join(', '),
  saveOrContinueButton: /save|continue|next|book/i,
  requiredOrConfirmationError: /required|confirmation/i,
  mismatchError: /match|same email|confirmation/i,
};

export function getFlightSearchSidebar(page: Page): Locator {
  return page.locator(travelokaFlightSearchResultsSelectors.sidebar);
}

export async function scrollFlightSearchSidebar(
  sidebar: Locator,
  options?: SidebarScrollOptions,
) {
  const maxSteps = options?.maxSteps ?? 8;
  const resetToTop = options?.resetToTop ?? false;

  return sidebar.evaluate(
    (
      sidebarEl: HTMLElement,
      payload: { maxSteps: number; resetToTop: boolean },
    ) => {
      const findScrollable = (root: HTMLElement) => {
        const nodes = [root, ...Array.from(root.querySelectorAll('*')) as HTMLElement[]];

        return nodes.find((node) => node.scrollHeight - node.clientHeight > 24) ?? root;
      };

      const scrollable = findScrollable(sidebarEl);
      if (payload.resetToTop) {
        scrollable.scrollTop = 0;
      }

      const visitedPositions: number[] = [scrollable.scrollTop];
      let previousTop = scrollable.scrollTop;

      for (let step = 0; step < payload.maxSteps; step++) {
        const delta = Math.max(160, Math.floor(scrollable.clientHeight * 0.75));
        scrollable.scrollTop = Math.min(
          scrollable.scrollTop + delta,
          Math.max(0, scrollable.scrollHeight - scrollable.clientHeight),
        );

        visitedPositions.push(scrollable.scrollTop);

        if (scrollable.scrollTop === previousTop) {
          break;
        }

        previousTop = scrollable.scrollTop;
      }

      return {
        scrollTop: scrollable.scrollTop,
        scrollHeight: scrollable.scrollHeight,
        clientHeight: scrollable.clientHeight,
        visitedPositions,
      };
    },
    { maxSteps, resetToTop },
  );
}

export async function scrollFlightSearchSidebarUntilVisible(
  sidebar: Locator,
  target: Locator,
  options?: SidebarScrollUntilVisibleOptions,
) {
  const maxSteps = options?.maxSteps ?? 8;
  const timeoutMs = options?.timeoutMs ?? 10_000;

  if (options?.resetToTop) {
    await scrollFlightSearchSidebar(sidebar, { resetToTop: true, maxSteps: 0 });
  }

  const deadline = Date.now() + timeoutMs;
  for (let step = 0; step <= maxSteps && Date.now() < deadline; step++) {
    if (await target.isVisible().catch(() => false)) {
      return true;
    }

    const scrollResult = await scrollFlightSearchSidebar(sidebar, { maxSteps: 1 });
    const lastPosition = scrollResult.visitedPositions[scrollResult.visitedPositions.length - 1];
    const previousPosition = scrollResult.visitedPositions[scrollResult.visitedPositions.length - 2] ?? lastPosition;

    if (lastPosition === previousPosition) {
      break;
    }
  }

  return target.isVisible().catch(() => false);
}

export function getFlightResultChooseButton(page: Page): Locator {
  return page.getByRole('button', { name: travelokaFlightSearchResultsSelectors.chooseButton }).first();
}

export function getFlightInventoryCardButton(page: Page): Locator {
  return page.getByTestId('flight-inventory-card-button').first();
}

export function getSelectTicketTypeDialog(page: Page): Locator {
  return page.getByText(travelokaFlightSearchResultsSelectors.selectTicketTypeTitle).first();
}

export function getTicketOptionSelectButton(page: Page): Locator {
  return page.getByTestId('button_ticket_option_select_1').first();
}

export function getTicketTypeSelectButton(page: Page): Locator {
  return page.getByRole('button', { name: travelokaFlightSearchResultsSelectors.selectButton }).first();
}

export function getFlightHomeSearchButton(page: Page): Locator {
  return page.getByRole('button', { name: travelokaFlightHomeSelectors.searchButton }).first();
}

export function getFlightHomeSearchWidget(page: Page): Locator {
  return page
    .locator(travelokaFlightHomeSelectors.searchWidget)
    .filter({ has: getFlightHomeSearchButton(page) })
    .first();
}

export function getBookingContactEmailField(page: Page): Locator {
  return page.locator(travelokaFlightBookingContactSelectors.emailField).first();
}

export function getBookingContactEmailConfirmationField(page: Page): Locator {
  return page.locator(travelokaFlightBookingContactSelectors.emailConfirmationField).first();
}

export function getBookingContactSaveOrContinueButton(page: Page): Locator {
  return page.getByRole('button', {
    name: travelokaFlightBookingContactSelectors.saveOrContinueButton,
  }).first();
}

export function getBookingContactRequiredOrConfirmationError(page: Page): Locator {
  return page.getByText(travelokaFlightBookingContactSelectors.requiredOrConfirmationError).first();
}

export function getBookingContactMismatchError(page: Page): Locator {
  return page.getByText(travelokaFlightBookingContactSelectors.mismatchError).first();
}

async function summarizeLocatorMatches(locator: Locator, sampleSize: number) {
  return locator.evaluateAll(
    (elements: Element[], limit: number) =>
      elements.slice(0, limit).map((element) => {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const html = element instanceof HTMLElement ? element.outerHTML.slice(0, 160) : '';
        return {
          text,
          html,
        };
      }),
    sampleSize,
  ).catch(() => [] as Array<{ text: string; html: string }>);
}

export async function requireUniqueVisibleLocator(
  locator: Locator,
  description: string,
  options?: UniqueVisibleLocatorOptions,
) {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const sampleSize = options?.sampleSize ?? 3;
  const visible = locator.filter({ visible: true });

  try {
    await expect(visible).toHaveCount(1, { timeout: timeoutMs });
  } catch {
    const [allCount, visibleCount, samples] = await Promise.all([
      locator.count().catch(() => 0),
      visible.count().catch(() => 0),
      summarizeLocatorMatches(visible, sampleSize),
    ]);

    const sampleSummary = samples.length
      ? samples
          .map((sample, index) => {
            const text = sample.text || '(no text)';
            const html = sample.html || '(no html snippet)';
            return `${index + 1}. text="${text}" html="${html}"`;
          })
          .join(' | ')
      : 'No visible candidates could be summarized.';

    throw new Error(
      [
        `Expected exactly one visible match for ${description}.`,
        `Total matches: ${allCount}.`,
        `Visible matches: ${visibleCount}.`,
        `Visible candidate samples: ${sampleSummary}`,
      ].join(' '),
    );
  }

  return visible.first();
}

export async function discoverFlightFilterOptionsInSection(
  sidebar: Locator,
  sectionTitle: string,
  tagAttribute = 'data-flight-filter-option-idx',
): Promise<FlightFilterOption[]> {
  const evaluateSection = () =>
    sidebar.evaluate(
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

      let optionsRoot: HTMLElement | null = null;
      let current: HTMLElement | null = header;

      while (current && current !== sidebarEl) {
        const sibling = current.nextElementSibling as HTMLElement | null;
        if (sibling) {
          const hasPointerDescendant = Array.from(sibling.querySelectorAll('*')).some((node) => {
            const el = node as HTMLElement;
            return window.getComputedStyle(el).cursor === 'pointer';
          });

          if (hasPointerDescendant) {
            optionsRoot = sibling;
            break;
          }
        }

        current = current.parentElement;
      }

      if (!optionsRoot) return [];

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

  let discovered = await evaluateSection();
  if (discovered.length > 0) {
    return discovered;
  }

  await scrollFlightSearchSidebar(sidebar, { resetToTop: true });

  for (let attempt = 0; attempt < 8; attempt++) {
    discovered = await evaluateSection();
    if (discovered.length > 0) {
      return discovered;
    }

    const scrollResult = await scrollFlightSearchSidebar(sidebar, { maxSteps: 1 });
    if (scrollResult.visitedPositions.length < 2) {
      break;
    }

    const lastPosition = scrollResult.visitedPositions[scrollResult.visitedPositions.length - 1];
    const previousPosition = scrollResult.visitedPositions[scrollResult.visitedPositions.length - 2];
    if (lastPosition === previousPosition) {
      break;
    }
  }

  return discovered;
}

export async function tagVisibleFlightResultCards(
  page: Page,
  tagAttribute = 'data-flight-result-card-idx',
) {
  return page.evaluate((payload: { tagAttribute: string }) => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    const hasResultTabs = (text: string) =>
      /flight details/i.test(text) &&
      /fare\s*&\s*benefits/i.test(text) &&
      /refund/i.test(text) &&
      /reschedule/i.test(text);
    const hasCardSignals = (text: string) =>
      /round-trip price|\/pax|\b\d{1,2}:\d{2}\b/i.test(text) ||
      /\b[A-Z]{3}\b/.test(text) ||
      /\b(direct|stop|stops|transit|layover)\b/i.test(text);
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
      let candidate: HTMLElement | null = null;
      while (ancestor) {
        const text = normalize(ancestor.innerText ?? '');
        if (hasResultTabs(text)) {
          candidate = ancestor;

          let expanded = ancestor.parentElement;
          while (expanded) {
            const expandedText = normalize(expanded.innerText ?? '');
            if (!hasResultTabs(expandedText)) {
              break;
            }
            if (hasCardSignals(expandedText)) {
              candidate = expanded;
            }
            expanded = expanded.parentElement;
          }

          break;
        }
        ancestor = ancestor.parentElement;
      }

      if (candidate && !tagged.includes(candidate)) {
        candidate.setAttribute(tagAttribute, String(idx));
        tagged.push(candidate);
        idx++;
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

export function getAirlineSection(page: Page): Locator {
  return getFlightFilterSection(page, travelokaFlightSearchResultsSelectors.headings.airline);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findTaggedAirlineFilterRow(
  page: Page,
  airlineName: string,
  tagAttribute = 'data-flight-airline-option-idx',
) {
  const sidebar = getFlightSearchSidebar(page);
  const options = await discoverFlightFilterOptionsInSection(sidebar, 'Airline', tagAttribute);
  const matchedOption = options.find((option) =>
    new RegExp(escapeRegExp(airlineName), 'i').test(option.labelText),
  );

  if (!matchedOption) {
    throw new Error(`Could not rediscover airline filter row for "${airlineName}".`);
  }

  const row = sidebar.locator(`[${tagAttribute}="${matchedOption.filterOptionIdx}"]`).first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  return row;
}

export async function clickFirstAirlineFilter(
  page: Page,
  tagAttribute = 'data-flight-airline-option-idx',
) {
  const sidebar = getFlightSearchSidebar(page);
  const options = await discoverFlightFilterOptionsInSection(sidebar, 'Airline', tagAttribute);
  const option = options[0];

  if (!option) {
    throw new Error('No airline filter option could be discovered in the desktop sidebar.');
  }

  const row = sidebar.locator(`[${tagAttribute}="${option.filterOptionIdx}"]`).first();
  const airlineName =
    (await row.locator('img[alt]').first().getAttribute('alt').catch(() => null)) ??
    option.labelText.replace(/\s*S\$.*$/i, '').trim();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  const checkbox = row.locator('input[type="checkbox"]').first();
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.click({ force: true });
  } else {
    await row.click({ force: true });
  }

  return airlineName;
}

export async function expectAirlineFilterChecked(page: Page, airlineName: string) {
  const row = await findTaggedAirlineFilterRow(page, airlineName);

  const checkbox = row.locator('input[type="checkbox"]').first();
  if (await checkbox.count().catch(() => 0)) {
    await expect(checkbox).toBeChecked();
    return;
  }

  await expect(row).toHaveAttribute('aria-checked', /true/i);
}

export async function expectAirlineFilterUnchecked(page: Page, airlineName: string) {
  const row = await findTaggedAirlineFilterRow(page, airlineName);

  const checkbox = row.locator('input[type="checkbox"]').first();
  if (await checkbox.count().catch(() => 0)) {
    await expect(checkbox).not.toBeChecked();
    return;
  }

  await expect(row).not.toHaveAttribute('aria-checked', /true/i);
}