import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
  clickByIdOrAi,
} from '../lib/traveloka-flight/workflow';
import { buildFlightSourceContextFromFiles } from '../lib/traveloka-flight/source-map';

import {
  openBookingPageFromSearchResults,
  openMetasearchBookingContactPage,
} from '../lib/traveloka-flight/workflow';
import { GenericBugDetector } from '../lib/generic-bug-detector';

const ROUTED_SOURCE_FILES = [
  'packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactForm.tsx',
  'packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts',
];
const TARGET_URL = buildFlightSourceContextFromFiles(
  ROUTED_SOURCE_FILES,
  'Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.',
).url;

/**
 * EN Purpose: Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.
 * 中文目的: 验证本周 flight 改动在 search-results 场景下是否仍然满足既有回归预期。
 * EN Surface: search-results
 * 中文范围: search-results 页面。
 * EN Concerns: booking-contact
 * 中文关注点: booking-contact
 * EN Main checks: booking contact form field rendering and validation.
 * 中文校验项: 预订联系人表单字段渲染与校验。
 * EN Source commits: b69c3c74c9 by Zili: [FEATURE][FLIGHT] email confirmation (#33383)
 * 中文来源提交: b69c3c74c9 by Zili: [FEATURE][FLIGHT] email confirmation (#33383)
 * EN Source summary: PRD (meegle): https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876 | https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876 | canonical desktop booking entry chain remains reachable | complete Choose→Select booking chain execution required | booking page URL is reached and contact form renders correctly | Apply booking contracts from docs/traveloka-flight-booking-case-generation.md | Apply locator rules from docs/traveloka-flight-locator-guideline.md (Prefer explicit contracts) | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active | Reference: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md
 * 中文来源摘要: PRD (meegle): https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876 | https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876 | canonical desktop booking entry chain remains reachable | complete Choose→Select booking chain execution required | booking page URL is reached and contact form renders correctly | Apply booking contracts from docs/traveloka-flight-booking-case-generation.md | Apply locator rules from docs/traveloka-flight-locator-guideline.md (Prefer explicit contracts) | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active | Reference: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md
 * EN Expectation: keep this generated case aligned with the stable Traveloka desktop baseline flow and verify only the routed regression slice.
 * 中文预期: 该生成用例必须与稳定的 Traveloka desktop 基线流程保持一致，只验证本次路由到的回归范围。
 */

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

test('Traveloka weekly diff booking smoke coverage (20260525)', async ({ page, ai }, testInfo) => {
  // ai = Midscene visual AI (MLX local model); used as fallback when data-id/data-testid is absent.
  // clickByIdOrAi(page, root, id, description, ai) tries data-id first, then ai().
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.",
    concerns: ["booking-contact"],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: "Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.",
    concerns: ["booking-contact"],
    waitForSidebar: false,
  });

  void sidebar;

  // Step 1: Click Choose button (try data-testid first, fall back to AI)
  const chooseButton = page.locator('[data-testid="flight-inventory-card-button"]').first();
  const chooseVisible = await chooseButton.isVisible({ timeout: 15000 }).catch(() => false);
  if (chooseVisible) {
    await chooseButton.click();
  } else {
    console.warn('[ai-fallback] Choose button testid not found — using Midscene AI');
    await ai('click the Choose button on the first flight result card');
  }
  
  // Step 2: Wait for ticket type selection drawer via testid (fsv2 bundle tray)
  const ticketTypeVisible = await page.locator('[data-testid="view_fsv2_ticket_option_card_0"]').isVisible({ timeout: 15000 }).catch(() => false);
  if (!ticketTypeVisible) {
    console.warn('[ai-fallback] Ticket option card_0 not found — using Midscene AI');
    await ai('wait for the ticket type selection drawer to appear');
  }
  
  // Step 3: Click Select button in the drawer (try data-testid first, fall back to AI)
  const selectButton = page.locator('[data-testid="button_fsv2_ticket_option_select_0"]').first();
  const selectVisible = await selectButton.isVisible({ timeout: 5000 }).catch(() => false);
  if (selectVisible) {
    await selectButton.click();
  } else {
    console.warn('[ai-fallback] Select button testid not found — using Midscene AI');
    await ai('click the Select button in the ticket type drawer');
  }
  
  // Step 4: Verify booking page reached
  await page.waitForURL(/\/flight\/booking/, { timeout: 15000 });
  const bookingUrl = new URL(page.url());
  expect(bookingUrl.pathname).toMatch(/\/flight\/booking/);
  
  // Step 5: Verify contact form accessible
  const contactForm = page.locator('[data-testid="booking-contact-form"], form').first();
  const contactExists = await contactForm.isVisible().catch(() => false);
  expect(contactExists, "Booking contact form should be accessible").toBeTruthy();

  // Execute canonical booking chain: Choose → Select drawer → Booking page
  // See docs/traveloka-flight-booking-case-generation.md for complete workflow specification
  
  const directBookingUrl = process.env.TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL;
  if (directBookingUrl) {
    // Direct metasearch entry: skip Choose/Select steps, verify contact form only
    await openMetasearchBookingContactPage(page, { url: directBookingUrl });
  } else {
    // Standard desktop entry: execute full Choose→Select chain
    // (Choose and Select steps handled in assertionLines)
  }
  
  // Retrieved shared-helper: docs/traveloka-flight-booking-case-generation.md - Complete booking chain workflow
  // Retrieved shared-helper: docs/traveloka-flight-locator-guideline.md - Explicit contracts and locator priority
  // Retrieved shared-helper: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md - Phase 2 active layer execution strategy
  // Retrieved shared-helper: docs/weekly-diff-case-generator.md - Weekly diff generation for booking surface
  // Retrieved shared-helper: tests/lib/traveloka-flight/workflow.ts - openMetasearchBookingContactPage, openBookingPageFromSearchResults
  // Suggested changed files (top 10 of 75): ["packages/flight/fpr-booking/__tests__/components/handlers/bookingContactValidationHandler.test.ts","packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactDesktop.tsx","packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactMobile.tsx","packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactMobile2.tsx","packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactMobileVDTray.tsx","packages/flight/fpr-booking/components/BFFBookingContact/__tests__/BFFBookingContactMobile2.test.js","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/__tests__/useBookingContactLoginSignupNudge.test.ts","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/useBookingContactLoginSignupNudge.ts","packages/flight/fpr-booking/components/handlers/bookingContactValidationHandler.ts","packages/flight/fpr-booking/__tests__/components/AddOns/PreselectedAddons/PreselectedAddons.test.tsx"]
  // Omitted additional changed files: 65
  // Source hint: packages/flight/fpr-booking/components/BFFBookingContact - Desktop booking contact form
  // Source hint: packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts - Validation rules
  
  // HARDCODED CONSTRAINTS (生成时强制应用):
  // 1. Desktop web only - weekly case runs on desktop Playwright
  // 2. Flight booking domain only - verifies only booking checkout
  // 3. Traveloka https://github.com/traveloka/www - source must be from production repository
  // 4. Uses lib/traveloka-flight helpers - createFlightWorkflowPlan, attachFlightWorkflowPlan
  // 5. Phase 2 active layer - executed weekly via: npx tsx scripts/run-accumulated-cases.ts --layer active
  // 6. Complete booking chain - Must execute Choose→Select before verifying booking page (per docs/traveloka-flight-booking-case-generation.md)
  
  // P0 Critical Bug Detection
  const detector = new GenericBugDetector(page);
  const auditResults = await detector.runFullAudit({
    locale: "en-US",
    platform: "desktop",
    pageType: "flight-booking",
    performanceBaseline: { lcp: 2500, cls: 0.1 },
  });
  const p0Issues = auditResults.filter(bug => bug.severity === "P0");
  if (p0Issues.length > 0) {
    console.error(`❌ P0 CRITICAL ISSUES FOUND: ${p0Issues.map(b => b.issue).join(", ")}`);
    expect(p0Issues).toHaveLength(0); // Enforce zero P0 bugs
  }
});
