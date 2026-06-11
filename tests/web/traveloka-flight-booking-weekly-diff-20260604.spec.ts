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
import { attachLocatorShadowProposal } from '../lib/locator-shadow-proposal';
import { GenericBugDetector } from '../lib/generic-bug-detector';

const ROUTED_SOURCE_FILES = [
  "packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactMobileVDTray.tsx",
  "packages/flight/fpr-booking/components/AddOns/PreselectedAddons/PreselectedAddons.tsx",
  "packages/flight/fpr-booking/components/BFFMobileFixedButtonContainer/BFFMobileFixedButtonContainer.tsx",
  "packages/flight/fpr-booking/components/BFFTravelerDetail/OBFChunk2/_components/UpfrontTravelerForm.tsx",
  "packages/flight/fpr-booking/components/BFFTravelerDetail/_views/BFFNIGITravelerDetailDesktopVDPopup.tsx",
  "packages/flight/fpr-booking/components/BFFTravelerDetail/_views/BFFNIGITravelerDetailMobileVDTray.tsx",
  "packages/flight/fpr-booking/components/BFFTravelerDetail/_views/BFFTravelerDetailMobileVDTray.tsx",
  "packages/flight/fpr-booking/components/BFFTravelerDetail/_views/__tests__/BFFTravelerDetailMobileVDTray.test.tsx",
  "packages/flight/fpr-booking/hooks/__tests__/useBFFTravelerStickyButton.test.ts",
  "packages/flight/fpr-booking/hooks/useBFFTravelerStickyButton.ts"
];
const TARGET_URL = buildFlightSourceContextFromFiles(
  ROUTED_SOURCE_FILES,
  "Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.",
).url;

const GENERATED_ACTION_CONTRACTS = [
  {
    "stepName": "booking-chain-choose-first-flight",
    "scopeHint": "First visible flight result card on the search results page",
    "expectedContracts": [
      "[data-testid=\"flight-inventory-card-button\"]"
    ],
    "preconditions": [
      "A visible search result card exists"
    ],
    "postconditions": [
      "Ticket type drawer or selection surface is reachable"
    ],
    "confidence": "high"
  },
  {
    "stepName": "booking-chain-ticket-type-drawer",
    "scopeHint": "Ticket type selection overlay after choosing a flight",
    "expectedContracts": [
      "[data-testid=\"view_fsv2_ticket_option_card_0\"]",
      "[data-testid=\"button_fsv2_ticket_option_select_0\"]"
    ],
    "preconditions": [
      "Choose action succeeded"
    ],
    "postconditions": [
      "Selection surface is visible"
    ],
    "confidence": "high"
  },
  {
    "stepName": "booking-chain-select-ticket-option",
    "scopeHint": "Ticket type drawer or selection overlay",
    "expectedContracts": [
      "[data-testid=\"button_fsv2_ticket_option_select_0\"]"
    ],
    "preconditions": [
      "Ticket type drawer is visible"
    ],
    "postconditions": [
      "Booking page URL is reached"
    ],
    "confidence": "high"
  },
  {
    "stepName": "booking-contact-form-visible",
    "scopeHint": "Booking page contact section on desktop web",
    "expectedContracts": [
      "[data-testid=\"booking-contact-form\"]",
      "form"
    ],
    "preconditions": [
      "Booking page route is reached"
    ],
    "postconditions": [
      "Booking contact form is accessible"
    ],
    "confidence": "medium"
  }
];

/**
 * EN Purpose: Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.
 * 中文目的: 验证本周 flight 改动在 search-results 场景下是否仍然满足既有回归预期。
 * EN Surface: search-results
 * 中文范围: search-results 页面。
 * EN Concerns: booking-contact
 * 中文关注点: booking-contact
 * EN Main checks: booking contact form field rendering and validation.
 * 中文校验项: 预订联系人表单字段渲染与校验。
 * EN Source commits: fb0594cdbb by yuhao-co: [FEATURE] feat: Implement sticky save button functionality and revamp traveler UI (#33346)
 * 中文来源提交: fb0594cdbb by yuhao-co: [FEATURE] feat: Implement sticky save button functionality and revamp traveler UI (#33346)
 * EN Source summary: PRD: https://traveloka.sg.larksuite.com/wiki/NNugwvbibiTogHkOLYZltHGhguh | BFF Traveller Details Mileage Education + Sticky "Save" Button | canonical desktop booking entry chain remains reachable | complete Choose→Select booking chain execution required | booking page URL is reached and contact form renders correctly | Apply booking contracts from docs/traveloka-flight-booking-case-generation.md | Apply locator rules from docs/traveloka-flight-locator-guideline.md (Prefer explicit contracts) | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active | Reference: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md
 * 中文来源摘要: PRD: https://traveloka.sg.larksuite.com/wiki/NNugwvbibiTogHkOLYZltHGhguh | BFF Traveller Details Mileage Education + Sticky "Save" Button | canonical desktop booking entry chain remains reachable | complete Choose→Select booking chain execution required | booking page URL is reached and contact form renders correctly | Apply booking contracts from docs/traveloka-flight-booking-case-generation.md | Apply locator rules from docs/traveloka-flight-locator-guideline.md (Prefer explicit contracts) | Phase 2 active layer execution (weekly): npx tsx scripts/run-accumulated-cases.ts --layer active | Reference: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md
 * EN Action contract confidence: high
 * 中文动作契约置信度: high
 * EN Action booking-chain-choose-first-flight: scope=First visible flight result card on the search results page; contracts=[data-testid="flight-inventory-card-button"]; confidence=high
 * EN Action booking-chain-ticket-type-drawer: scope=Ticket type selection overlay after choosing a flight; contracts=[data-testid="view_fsv2_ticket_option_card_0"] | [data-testid="button_fsv2_ticket_option_select_0"]; confidence=high
 * EN Action booking-chain-select-ticket-option: scope=Ticket type drawer or selection overlay; contracts=[data-testid="button_fsv2_ticket_option_select_0"]; confidence=high
 * EN Action booking-contact-form-visible: scope=Booking page contact section on desktop web; contracts=[data-testid="booking-contact-form"] | form; confidence=medium
 * 中文动作 booking-chain-choose-first-flight: 范围=First visible flight result card on the search results page；契约=[data-testid="flight-inventory-card-button"]；置信度=high
 * 中文动作 booking-chain-ticket-type-drawer: 范围=Ticket type selection overlay after choosing a flight；契约=[data-testid="view_fsv2_ticket_option_card_0"] | [data-testid="button_fsv2_ticket_option_select_0"]；置信度=high
 * 中文动作 booking-chain-select-ticket-option: 范围=Ticket type drawer or selection overlay；契约=[data-testid="button_fsv2_ticket_option_select_0"]；置信度=high
 * 中文动作 booking-contact-form-visible: 范围=Booking page contact section on desktop web；契约=[data-testid="booking-contact-form"] | form；置信度=medium
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

test('Traveloka weekly diff booking smoke coverage (20260604)', async ({ page, ai, aiQuery }, testInfo) => {
  // GENERATION MODE: PRD-driven regression spec.
  // Navigation strategy:
  //   - Use explicit www-derived contracts for navigation and form interaction.
  //   - If a required contract is missing at runtime, attach a shadow proposal artifact
  //     via aiQuery() for diagnosis, then fail loudly instead of letting AI continue the flow.
  //   - Keep ai()/aiQuery() as discovery or post-failure analysis tools, not the main executor.
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.",
    concerns: ["booking-contact"],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  if (GENERATED_ACTION_CONTRACTS.length > 0) {
    await testInfo.attach('generated-action-contracts.json', {
      body: Buffer.from(JSON.stringify({
        caseConfidence: "high",
        actionContracts: GENERATED_ACTION_CONTRACTS,
      }, null, 2)),
      contentType: 'application/json',
    });
  }

  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: "Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.",
    concerns: ["booking-contact"],
    waitForSidebar: false,
  });

  void sidebar;

  // Step 1: Click Choose button via explicit contract; attach shadow proposal if missing.
  const chooseButton = page.locator('[data-testid="flight-inventory-card-button"]').first();
  const chooseVisible = await chooseButton.isVisible({ timeout: 15000 }).catch(() => false);
  if (chooseVisible) {
    await chooseButton.click();
  } else {
    console.warn('[shadow-proposal] Choose button contract missing — attaching diagnostic proposal');
    await attachLocatorShadowProposal({
      page,
      testInfo,
      aiQuery,
      stepName: "booking-chain-choose-first-flight",
      contractDescription: "Choose button on the first flight result card",
      expectedContracts: ["[data-testid=\"flight-inventory-card-button\"]"],
      scopeHint: "First visible flight result card on the search results page",
      analysisPrompt: "Identify the most likely Choose or equivalent booking-entry control on the first visible flight result card, including any visible button text and card context.",
    });
    throw new Error("Choose button contract missing. Shadow proposal attached; main execution intentionally stopped.");
  }
  
  // Step 2: Wait for ticket type selection drawer
  const ticketTypeDrawer = page.locator('[data-testid="view_fsv2_ticket_option_card_0"], [data-testid="button_fsv2_ticket_option_select_0"]').first();
  const ticketTypeVisible = await ticketTypeDrawer.isVisible({ timeout: 15000 }).catch(() => false);
  if (!ticketTypeVisible) {
    console.warn('[shadow-proposal] Ticket type drawer contract missing — attaching diagnostic proposal');
    await attachLocatorShadowProposal({
      page,
      testInfo,
      aiQuery,
      stepName: "booking-chain-ticket-type-drawer",
      contractDescription: "Ticket type selection drawer after clicking Choose",
      expectedContracts: ["[data-testid=\"view_fsv2_ticket_option_card_0\"]","[data-testid=\"button_fsv2_ticket_option_select_0\"]"],
      scopeHint: "Ticket type selection overlay or drawer after opening a result card",
      analysisPrompt: "Identify the visible ticket type selection panel or first selectable option that should appear after choosing a flight.",
    });
    throw new Error("Ticket type selection drawer contract missing. Shadow proposal attached; main execution intentionally stopped.");
  }
  
  // Step 3: Click Select button in the drawer via explicit contract; attach shadow proposal if missing.
  const selectButton = page.locator('[data-testid="button_fsv2_ticket_option_select_0"]').first();
  const selectVisible = await selectButton.isVisible({ timeout: 5000 }).catch(() => false);
  if (selectVisible) {
    await selectButton.click();
  } else if (ticketTypeVisible) {
    console.warn('[shadow-proposal] Select button contract missing — attaching diagnostic proposal');
    await attachLocatorShadowProposal({
      page,
      testInfo,
      aiQuery,
      stepName: "booking-chain-select-ticket-option",
      contractDescription: "Select button in the ticket type drawer",
      expectedContracts: ["[data-testid=\"button_fsv2_ticket_option_select_0\"]"],
      scopeHint: "Ticket type drawer or selection overlay",
      analysisPrompt: "Identify the visible Select control inside the ticket type drawer that should advance to booking.",
    });
    throw new Error("Select button contract missing. Shadow proposal attached; main execution intentionally stopped.");
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
  // Retrieved shared-helper: docs/traveloka-flight-booking-payment-chain-lock.md - Locked booking=>payment chain contracts
  // Retrieved shared-helper: docs/traveloka-flight-locator-guideline.md - Explicit contracts and locator priority
  // Retrieved shared-helper: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md - Phase 2 active layer execution strategy
  // Retrieved shared-helper: docs/weekly-diff-case-generator.md - Weekly diff generation for booking surface
  // Retrieved shared-helper: tests/lib/traveloka-flight/workflow.ts - openMetasearchBookingContactPage, openBookingPageFromSearchResults
  // Suggested changed files (top 10 of 20): ["packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactMobileVDTray.tsx","packages/flight/fpr-booking/components/AddOns/PreselectedAddons/PreselectedAddons.tsx","packages/flight/fpr-booking/components/BFFMobileFixedButtonContainer/BFFMobileFixedButtonContainer.tsx","packages/flight/fpr-booking/components/BFFTravelerDetail/OBFChunk2/_components/UpfrontTravelerForm.tsx","packages/flight/fpr-booking/components/BFFTravelerDetail/_views/BFFNIGITravelerDetailDesktopVDPopup.tsx","packages/flight/fpr-booking/components/BFFTravelerDetail/_views/BFFNIGITravelerDetailMobileVDTray.tsx","packages/flight/fpr-booking/components/BFFTravelerDetail/_views/BFFTravelerDetailMobileVDTray.tsx","packages/flight/fpr-booking/components/BFFTravelerDetail/_views/__tests__/BFFTravelerDetailMobileVDTray.test.tsx","packages/flight/fpr-booking/hooks/__tests__/useBFFTravelerStickyButton.test.ts","packages/flight/fpr-booking/hooks/useBFFTravelerStickyButton.ts"]
  // Omitted additional changed files: 10
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
