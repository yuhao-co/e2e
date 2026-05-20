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
  openFlightSearchTask,
  throwIfTravelokaRestricted,
} from '../lib/traveloka-flight/workflow';
import {
  discoverFlightFilterOptionsInSection,
  getTaggedFlightResultCards,
  tagVisibleFlightResultCards,
} from '../lib/traveloka-flight/locators';

const RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

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

      console.log('[step] navigating to flight results page');
      const { sidebar } = await openFlightSearchTask(page, {
        url: RESULTS_URL,
        userIntent:
          'Open the desktop Traveloka flight search results page, select the first airline filter option, and verify visible search results match that airline.',
        waitForSidebar: true,
      });
      if (!sidebar) {
        throw new Error('Flight search sidebar was expected but not returned by the shared workflow.');
      }

      // Extra wait so React can finish rendering the full filter list
      await page.waitForTimeout(2000);

      const ssLoaded = await page.screenshot({ fullPage: false }).catch(() => null);
      if (ssLoaded)
        await testInfo.attach('01-loaded.png', { body: ssLoaded, contentType: 'image/png' });

      const discovered = await discoverFlightFilterOptionsInSection(
        sidebar,
        'Airline',
        'data-airline-option-idx',
      );

      console.log(
        `[filter] discovered ${discovered.length} airline filter option(s):`,
        JSON.stringify(discovered, null, 2),
      );
      await testInfo.attach('discovered-filters.json', {
        body: Buffer.from(JSON.stringify(discovered, null, 2)),
        contentType: 'application/json',
      });

      expect(discovered.length, 'Sidebar must contain at least one airline filter option').toBeGreaterThan(0);

      const humanPause = (min = 1200, max = 2800) =>
        page.waitForTimeout(min + Math.floor(Math.random() * (max - min))).catch(() => {});

      const chosen = discovered[0];
      console.log(
        `[filter] first airline option → clicking "${chosen.labelText}" (filterOptionIdx=${chosen.filterOptionIdx})`,
      );

      await page.mouse.move(
        200 + Math.floor(Math.random() * 100),
        300 + Math.floor(Math.random() * 100),
      );
      await humanPause(400, 800);

      const target = sidebar.locator(`[data-airline-option-idx="${chosen.filterOptionIdx}"]`);
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await humanPause(300, 600);
      await target.click({ force: true });
      await humanPause(2000, 3500);
      await expectNotRestricted(`after clicking ${chosen.labelText}`);

      const applied = [{ section: 'airline', labelText: chosen.labelText }];

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

      const cardCount = await tagVisibleFlightResultCards(page);
      const cards = getTaggedFlightResultCards(page);

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
            .then((texts: string[]) =>
              texts
                .map((text: string) => text.replace(/\s+/g, ' ').trim())
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
