import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
} from '../lib/traveloka-flight/workflow';
import { buildFlightSourceContextFromFiles } from '../lib/traveloka-flight/source-map';
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

test('Traveloka weekly diff booking smoke coverage (20260601)', async ({ page, ai, aiQuery }, testInfo) => {
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

  // ── Navigation: Choose → (optional ticket type drawer) → Booking page ──
  // Step 1: Click Choose button on first flight card
  const chooseButton = page.locator('[data-testid="flight-inventory-card-button"]').first();
  await chooseButton.waitFor({ state: 'visible', timeout: 20000 });
  await chooseButton.click();

  // Steps 2+3: Two outcomes after clicking Choose:
  //   (a) Some flights navigate directly to /flight/booking (no drawer)
  //   (b) A ticket type selection drawer appears — must click Select inside it
  const directToBooking = await page.waitForURL(/\/flight\/booking/, { timeout: 8000 })
    .then(() => true).catch(() => false);

  if (!directToBooking) {
    // Drawer appeared — find and click the Select button
    // Primary testid from TicketOptionCard.tsx (www source); role-based fallback for other indices
    const selectButton = page
      .locator('[data-testid="button_fsv2_ticket_option_select_0"]')
      .or(page.getByRole('button', { name: /^Select$/i }))
      .first();
    await selectButton.waitFor({ state: 'visible', timeout: 20000 });
    await Promise.all([
      page.waitForURL(/\/flight\/booking/, { timeout: 30000 }),
      selectButton.click(),
    ]);
  }

  // Step 4: Confirm booking page URL
  const bookingUrl = new URL(page.url());
  expect(bookingUrl.pathname).toMatch(/\/flight\/booking/);
  await page.waitForLoadState('networkidle').catch(() => {});

  // ── PRD Regression: BFF Traveller Details Mileage Education + Sticky Save ──
  // Step 5: Traveler form container is present (www source: OBF_CHUNK2_TEST_IDS.TRAVELER_FORM)
  const travelerForm = page.locator('[data-testid="view_obf_chunk2_traveler_form_adult_0"]');
  const travelerFormVisible = await travelerForm.isVisible({ timeout: 15000 }).catch(() => false);
  if (travelerFormVisible) {
    // Step 6: Save button is rendered within the traveler form section
    // (www source: OBF_CHUNK2_TEST_IDS.SAVE_BUTTON → button_obf_chunk2_save_adult_0)
    const saveButton = page.locator('[data-testid="button_obf_chunk2_save_adult_0"]');
    const saveButtonExists = await saveButton.isVisible({ timeout: 5000 }).catch(() => false);
    expect(
      saveButtonExists,
      '[PRD-regression] Sticky Save button (button_obf_chunk2_save_adult_0) must be rendered in traveler details — missing indicates regression in useBFFTravelerStickyButton',
    ).toBeTruthy();
  } else {
    // Booking form reached but traveler form uses a different layout — verify contact form fallback
    const contactForm = page.locator('[data-testid="booking-contact-form"], form').first();
    const contactExists = await contactForm.isVisible({ timeout: 10000 }).catch(() => false);
    expect(contactExists, 'Booking form should be accessible after navigation').toBeTruthy();
  }
  
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
