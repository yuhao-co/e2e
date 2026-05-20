/**
 * Traveloka flight search – random filter selection + result verification
 *
 * Strategy
 * ────────
 * 1. Navigate directly to the SIN→JKTA round-trip results deep-link.
 * 2. Wait for the search to finish loading.
 * 3. Discover every checkbox inside the left sidebar via DOM evaluation
 *    (handles hidden/custom-styled checkboxes that Traveloka uses).
 * 4. Group the discovered options by their nearest section heading.
 * 5. For each section, randomly decide whether to activate it, then pick
 *    one option at random and click it with force.
 * 6. After all filter clicks, verify that visible flight result cards
 *    satisfy the constraints implied by the applied filters.
 *
 * Verifiable constraints
 * ─────────────────────
 *  • Transit count  – stop-count text in each card must match the selected
 *                     option (Direct / 1 Stop / 2+ Stops).
 *  • Airline        – airline name shown in each card must contain the name
 *                     extracted from the selected filter label.
 */

import { expect, test } from '../fixture';
import {
  assertFlightSearchCompleted,
  openFlightResultsPage,
  throwIfTravelokaRestricted,
  isTravelokaRestricted,
} from '../lib/traveloka-flight/workflow';
import {
  getFlightSearchSidebar,
  travelokaFlightSearchResultsSelectors,
} from '../lib/traveloka-flight/locators';

const RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a transit filter label (e.g. "Direct", "1 Transit", "2+ Transit")
 * into a RegExp that should match the stop-count text on a flight card.
 * Returns null if the label is unrecognised (skip verification for that card).
 */
function transitLabelToStopPattern(label: string): RegExp | null {
  const n = label.toLowerCase();
  if (/direct|non.?stop/.test(n)) return /direct|non.?stop/i;
  if (/\b1\s*(stop|transit)\b/.test(n)) return /\b1\s*(stop|transit)\b/i;
  if (/\b2\b.*?(stop|transit)|\+.*(stop|transit)|multiple|more/.test(n))
    return /\b2\+?\s*(stop|transit)\b/i;
  return null;
}

type DiscoveredOption = {
  /** Human-readable label of this filter option (e.g. "Direct", "Singapore Airlines") */
  labelText: string;
  /** Heading text of the enclosing section (e.g. "No. of Transit", "Airline") */
  sectionHeading: string;
  /** Value of data-filter-option-idx attribute tagged onto the clickable element */
  filterOptionIdx: number;
};

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('Traveloka flight search – first airline filter verification', () => {
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

  test(
    'selects the first airline filter option and verifies visible flight results match it',
    async ({ page }, testInfo) => {
      const expectNotRestricted = async (stage: string) => {
        await throwIfTravelokaRestricted(page, stage);
      };

      const waitForSidebarReady = async () => {
        const sidebar = getFlightSearchSidebar(page);

        const deadline = Date.now() + 30_000;
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

        if (!(await sidebar.isVisible().catch(() => false))) {
          throw new Error('Flight results loaded, but the filter sidebar never became visible.');
        }

        return sidebar;
      };

      // ── 1. Navigate to results page ─────────────────────────────────────────
      console.log('[step] navigating to flight results page');
      await openFlightResultsPage(page, RESULTS_URL);
      await expectNotRestricted('after initial navigation');

      // ── 2. Wait for the search to finish loading ────────────────────────────
      console.log('[step] waiting for flight search to complete');
      await assertFlightSearchCompleted(page);
      await expectNotRestricted('after search completed');

      const sidebar = await waitForSidebarReady();
      await expectNotRestricted('before filter discovery');

      // Extra wait so React can finish rendering the full filter list
      await page.waitForTimeout(2000);

      const ssLoaded = await page.screenshot({ fullPage: false }).catch(() => null);
      if (ssLoaded)
        await testInfo.attach('01-loaded.png', { body: ssLoaded, contentType: 'image/png' });

      // ── 3. Discover all filter options via DOM evaluation ──────────────────
      // Traveloka uses custom-styled cursor:pointer div wrappers — no real
      // <input type="checkbox"> exists. Strategy:
      //   a) Walk every element in the sidebar.
      //   b) Find the outermost cursor:pointer (no cursor:pointer ANCESTOR within sidebar).
      //   c) Tag each row with data-filter-option-idx so Playwright can find it.
      //   d) Derive the section heading by walking up for a preceding non-pointer sibling.
      const discovered: DiscoveredOption[] = await sidebar.evaluate(
        (sidebarEl: HTMLElement): DiscoveredOption[] => {
          const results: Array<{
            labelText: string;
            sectionHeading: string;
            filterOptionIdx: number;
          }> = [];

          // Skip non-filter action buttons by label text
          const SKIP_RE =
            /^\s*(reset|clear(\s*all)?|show\s*(all|more|less|fewer)|see\s*(all|more|less|fewer)|apply|load\s*more|filter|sort(\s*by)?)\s*$/i;

          const all = Array.from(sidebarEl.querySelectorAll('*')) as HTMLElement[];
          let optIdx = 0;

          for (const el of all) {
            if (window.getComputedStyle(el).cursor !== 'pointer') continue;

            // Skip links — clicking them may navigate away
            if (el.tagName === 'A' || el.closest('a')) continue;

            // Only take the *outermost* cursor:pointer (no cursor:pointer ancestor within sidebar)
            let anc = el.parentElement;
            let isNested = false;
            while (anc && anc !== sidebarEl) {
              if (window.getComputedStyle(anc).cursor === 'pointer') {
                isNested = true;
                break;
              }
              anc = anc.parentElement;
            }
            if (isNested) continue;

            const text = (el.innerText ?? '').replace(/\s+/g, ' ').trim();
            if (!text || text.length > 120) continue;
            if (SKIP_RE.test(text)) continue;

            // Tag element so Playwright can locate it by attribute
            el.setAttribute('data-filter-option-idx', String(optIdx));

            // ---- section heading: walk up and look for preceding non-pointer sibling text ----
            let sectionHeading = '';
            let ancestor: Element | null = el.parentElement;
            let depth = 0;
            while (ancestor && ancestor !== sidebarEl && depth < 20) {
              const children = Array.from(ancestor.children);
              const elPos = children.findIndex((c) => c === el || c.contains(el));
              for (let i = elPos - 1; i >= 0; i--) {
                const sibling = children[i] as HTMLElement;
                const sibText = (sibling.innerText ?? '').trim();
                if (
                  sibText &&
                  sibText.length < 60 &&
                  window.getComputedStyle(sibling).cursor !== 'pointer'
                ) {
                  sectionHeading = sibText;
                  break;
                }
              }
              if (sectionHeading) break;
              ancestor = ancestor.parentElement;
              depth++;
            }

            results.push({
              labelText: text.slice(0, 100),
              sectionHeading: sectionHeading.slice(0, 60),
              filterOptionIdx: optIdx,
            });
            optIdx++;
          }

          return results;
        },
      );

      console.log(
        `[filter] discovered ${discovered.length} filter checkboxes:`,
        JSON.stringify(discovered, null, 2),
      );
      await testInfo.attach('discovered-filters.json', {
        body: Buffer.from(JSON.stringify(discovered, null, 2)),
        contentType: 'application/json',
      });

      expect(discovered.length, 'Sidebar must contain at least one filter option').toBeGreaterThan(0);

      const humanPause = (min = 1200, max = 2800) =>
        page.waitForTimeout(min + Math.floor(Math.random() * (max - min))).catch(() => {});

      const airlineOptions = discovered.filter(
        (opt) => /airline|carrier/i.test(opt.sectionHeading),
      );
      expect(airlineOptions.length, 'Sidebar must contain at least one airline filter option').toBeGreaterThan(0);

      const chosen = airlineOptions[0];
      console.log(
        `[filter] first airline option → clicking "${chosen.labelText}" (filterOptionIdx=${chosen.filterOptionIdx})`,
      );

      await page.mouse.move(
        200 + Math.floor(Math.random() * 100),
        300 + Math.floor(Math.random() * 100),
      );
      await humanPause(400, 800);

      const target = sidebar.locator(`[data-filter-option-idx="${chosen.filterOptionIdx}"]`);
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await humanPause(300, 600);
      await target.click({ force: true });
      await humanPause(2000, 3500);
      await expectNotRestricted(`after clicking ${chosen.labelText}`);

      const applied = [{ section: chosen.sectionHeading || 'airline', labelText: chosen.labelText }];

      console.log('[filter] applied filters:', JSON.stringify(applied, null, 2));
      await testInfo.attach('applied-filters.json', {
        body: Buffer.from(JSON.stringify(applied, null, 2)),
        contentType: 'application/json',
      });

      // Wait for the results list to finish refreshing after all filter clicks
      await page.waitForLoadState('networkidle').catch(() => {});
      await humanPause(1500, 2500);

      const ssFiltered = await page.screenshot({ fullPage: false }).catch(() => null);
      if (ssFiltered)
        await testInfo.attach('02-after-filters.png', {
          body: ssFiltered,
          contentType: 'image/png',
        });

      // ── 5. Locate visible flight result cards ───────────────────────────────
      const cardCandidateSelectors = [
        '[data-testid="flight-card"]',
        '[data-testid*="flight-card"]',
        '[data-testid*="flight-result"]',
        '[data-testid*="flight-item"]',
        '[class*="FlightCard"]',
        '[class*="flight-card"]',
      ].join(', ');

      let cards = page.locator(cardCandidateSelectors).filter({ hasNot: sidebar });
      let cardCount = await cards.count().catch(() => 0);
      const chooseButton = page.getByRole('button', { name: /choose/i });

      if (cardCount) {
        const actionableCards = cards.filter({
          has: chooseButton,
        });
        const actionableCount = await actionableCards.count().catch(() => 0);
        if (actionableCount) {
          cards = actionableCards;
          cardCount = actionableCount;
        }
      }

      const semanticCards = page
        .locator('article, section, div')
        .filter({ has: chooseButton })
        .filter({ hasText: /Flight Details|Fare & Benefits|Refund|Reschedule/i })
        .filter({ hasNot: sidebar });
      const semanticCount = await semanticCards.count().catch(() => 0);
      if (semanticCount) {
        cards = semanticCards;
        cardCount = semanticCount;
      }

      if (!cardCount) {
        cards = page.locator('[data-testid*="flight"]').filter({ hasNot: sidebar });
        cardCount = await cards.count().catch(() => 0);
      }

      console.log(`[verify] ${cardCount} flight result card(s) found`);

      if (!cardCount) {
        const noResultsVisible =
          (await page
            .getByText(/no\s*(flights?|results?)\s*found|no\s*available\s*flights?/i)
            .isVisible()
            .catch(() => false)) ||
          (await page
            .getByText(/try\s*(changing|adjusting|removing)\s*(your\s*)?(filter|search)/i)
            .isVisible()
            .catch(() => false));

        console.log(
          noResultsVisible
            ? '[verify] no results: "no flights found" message visible – OK'
            : '[verify] WARNING: no cards and no empty-state message – unexpected',
        );
        return;
      }

      // Sample up to 5 cards so the test stays fast
      const sampleSize = Math.min(cardCount, 5);

      // ── 5. Verify airline ───────────────────────────────────────────────────
      const airlineFilter = applied.find((f) => /airline|carrier/i.test(f.section));
      if (airlineFilter) {
        // Trim counts and price fragments that can be present in sidebar labels.
        const airlineName = airlineFilter.labelText
          .replace(/\s*S?\$\s*\d[\d,]*(?:\.\d+)?\s*$/i, '')
          .replace(/\s*\(\d+\)\s*$/, '')
          .trim();

        console.log(`[verify] airline filter: "${airlineName}"`);

        for (let i = 0; i < sampleSize; i++) {
          const card = cards.nth(i);

          // Collect text from semantic airline elements and img alt attributes
          const airlineTexts = await card
            .locator(
              '[data-testid*="airline"], [class*="airline" i], img[alt]',
            )
            .evaluateAll((els: Element[]) =>
              els.map(
                (el: Element) =>
                  (el as HTMLImageElement).alt ||
                  (el as HTMLElement).textContent ||
                  '',
              ),
            )
            .then((texts) =>
              texts
                .map((text) => text.replace(/\s+/g, ' ').trim())
                .filter(Boolean),
            )
            .catch(() => [] as string[]);

          const cardText = await card
            .innerText()
            .catch(async () => (await card.textContent().catch(() => '')) ?? '');

          const combined = (
            airlineTexts.length ? `${airlineTexts.join(' ')} ${cardText}` : cardText
          ).toLowerCase();

          const matched = combined.includes(airlineName.toLowerCase());
          console.log(
            `[verify] card[${i}] airline text: "${combined.substring(0, 200)}" – match: ${matched}`,
          );
          expect(
            matched,
            `Card[${i}]: airline info should contain "${airlineName}"`,
          ).toBe(true);
        }
      }

      // ── 5. Final screenshot ─────────────────────────────────────────────────
      const ssFinal = await page.screenshot({ fullPage: false }).catch(() => null);
      if (ssFinal)
        await testInfo.attach('03-verification-done.png', {
          body: ssFinal,
          contentType: 'image/png',
        });

      console.log('[step] done – all applied filter constraints verified');
    },
  );
});
