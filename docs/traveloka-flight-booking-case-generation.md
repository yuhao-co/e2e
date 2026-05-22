# Traveloka Flight Booking Case Generation Specification

## Overview
This document specifies the requirements and complete interaction workflow for generating high-quality Traveloka flight booking test cases. All generated booking cases **must** follow the canonical desktop booking chain and include all required interaction steps.

---

## Canonical Desktop Booking Chain (MUST IMPLEMENT)

### Complete Workflow Steps

The canonical booking chain that all generated cases must execute:

```
Start: https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY
    ↓
1. CLICK CHOOSE BUTTON
   └─ Selector: data-testid="flight-inventory-card-button" (preferred)
   └─ Fallback: page text matching /^Choose$/i
   └─ Location: First visible flight result card
    ↓
2. WAIT FOR TICKET TYPE DRAWER
   └─ Text indicator: /Select ticket type/i
   └─ Container: drawer/modal with ticket options
   └─ Timeout: 15000ms for modal appearance
    ↓
3. CLICK SELECT BUTTON
   └─ Selector: data-testid="button_ticket_option_select_1" (preferred)
   └─ Fallback: page text matching /^Select$/i
   └─ Location: Inside ticket-type drawer modal
    ↓
4. VERIFY BOOKING PAGE REACHED
   └─ URL assertion: expect(bookingUrl.pathname).toMatch(/\/flight\/booking/)
   └─ Contact form check: Verify form/contact-form element is visible
    ↓
End: /en-en/flight/booking page with contact form visible
```

---

## Required Interaction Lines Template

Every generated booking test case **MUST** include these interaction steps:

```typescript
// Step 1: Click first result's Choose button
const chooseButton = page
  .locator('[data-testid="flight-inventory-card-button"]')
  .first();

await chooseButton.isVisible({ timeout: 15000 });
await chooseButton.click();

// Step 2: Wait for ticket type selection drawer
await page.getByText(/Select ticket type/i).isVisible({ timeout: 15000 });

// Step 3: Click Select button in the drawer
const selectButton = page
  .locator('[data-testid="button_ticket_option_select_1"]')
  .first();

await selectButton.isVisible({ timeout: 5000 });
await selectButton.click();

// Step 4: Verify booking page reached
await page.waitForURL(/\/flight\/booking/, { timeout: 15000 });

const bookingUrl = new URL(page.url());
expect(bookingUrl.pathname).toMatch(/\/flight\/booking/);

// Step 5: Verify contact form accessible
const contactForm = page
  .locator('[data-testid="booking-contact-form"], form')
  .first();

const contactExists = await contactForm.isVisible().catch(() => false);
expect(contactExists, 'Booking contact form should be accessible').toBeTruthy();
```

---

## Contract Locators (Priority Order)

Use these explicit data-testid/data-id contracts **before** text matching:

### Choose Button (Result Card)
1. `[data-testid="flight-inventory-card-button"]` - Primary contract
2. Text regex: `/^Choose$/i` - Fallback only

### Ticket Type Selection Drawer
1. Text: `/Select ticket type/i` - Drawer header indicator
2. Wait for drawer DOM presence before clicking Select

### Select Button (Inside Drawer)
1. `[data-testid="button_ticket_option_select_1"]` - Primary contract for first ticket option
2. Text regex: `/^Select$/i` - Fallback only
3. **Must be scoped inside the drawer, not page-level**

### Contact Form (Booking Page)
1. `[data-testid="booking-contact-form"]` - Primary contract
2. `form` - Generic fallback
3. Pattern: `/form|contact-form|booking.*form/i`

---

## Entry Points

### Direct Metasearch Booking URL (If Available)
```typescript
const directBookingUrl = process.env.TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL;
if (directBookingUrl) {
  await page.goto(directBookingUrl);
  // Skip Choose/Select steps, verify contact form directly
}
```

### Standard Desktop Search Entry Chain
```typescript
const searchUrl = 'https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY';
// Execute full chain: Choose → Select → Booking page
```

---

## Generation Rules

### When to Generate Booking Cases
1. Changed files contain `packages/flight/fpr-booking/*` paths
2. OR changed files contain `bookingContactValidationHandler.ts` or similar booking-specific handlers
3. OR PR context mentions "booking", "checkout", "contact form", "email confirmation"

### Concerns to Include
- `booking-contact`: Always required for booking cases
- Add `booking-retention` only if PR context mentions "retention popup" or "exit-intent"

### Assertions Required

Every generated booking case must verify:
```typescript
// Assertion 1: Booking URL pattern
expect(bookingUrl.pathname).toMatch(/\/flight\/booking/);

// Assertion 2: Contact form visibility
const contactForm = page.locator('[data-testid="booking-contact-form"], form').first();
const contactExists = await contactForm.isVisible().catch(() => false);
expect(contactExists).toBeTruthy();

// Optional Assertion 3: Email field (if applicable)
const emailField = page.locator('input[type="email"]').first();
const emailExists = await emailField.isVisible().catch(() => false);
// expect(emailExists).toBeTruthy(); // Gate on business logic
```

---

## Metadata Template

Every generated booking test must include:

```typescript
/**
 * EN Purpose: Open the desktop Traveloka flight booking flow from search results, execute the complete Choose→Select chain, and verify the canonical booking page remains reachable for the routed weekly regression slice.
 * 中文目的: 验证本周 flight 改动在 booking 场景下是否仍然满足既有回归预期。完整执行从选择按钮到选票类型再到预订页面的完整链路。
 * EN Surface: flight-booking (desktop web only)
 * 中文范围: flight-booking (仅桌面网页)
 * EN Concerns: booking-contact
 * 中文关注点: booking-contact
 * EN Main checks: Complete Choose→Select booking chain execution and contact form verification.
 * 中文校验项: 完整的 Choose→Select 预订链路执行和联系人表单验证。
 * EN Expectation: Canonical desktop booking entry chain must remain fully reachable and executable.
 * 中文预期: 标准的桌面预订入口链路必须保持完全可达和可执行。
 */
```

---

## Imported Helpers (Required)

All generated booking cases **must** import these helpers:

```typescript
import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
} from '../lib/traveloka-flight/workflow';

// Optionally import if using direct metasearch:
import {
  openMetasearchBookingContactPage,
} from '../lib/traveloka-flight/workflow';
```

---

## Phase 2 Layer Requirement

All generated booking cases are Phase 2 **active layer** cases and must document:

```typescript
// Phase 2 active layer execution (weekly):
// npx tsx scripts/run-accumulated-cases.ts --layer active
//
// Reference: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md
```

---

## Retrieved Shared Helpers (Must Reference)

Every generated booking case must include these Retrieved shared-helper comments:

```typescript
// Retrieved shared-helper: docs/traveloka-flight-locator-guideline.md - Explicit contracts and locator priority
// Retrieved shared-helper: docs/traveloka-flight-booking-case-generation.md - Complete booking chain workflow
// Retrieved shared-helper: docs/PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md - Phase 2 active layer execution strategy
// Retrieved shared-helper: tests/lib/traveloka-flight/workflow.ts - createFlightWorkflowPlan, attachFlightWorkflowPlan
// Retrieved shared-helper: tests/lib/traveloka-flight/locators.ts - Booking contact form selectors
```

---

## Hardcoded Constraints (Non-Negotiable)

All generated booking cases must enforce:

```
1. 🔒 Desktop web only - NO mobile, NO android, NO i18n
2. 🔒 Flight booking domain only - NO search-results mixing
3. 🔒 Traveloka https://github.com/traveloka/www - NO other sources
4. 🔒 Uses lib/traveloka-flight helpers - createFlightWorkflowPlan, attachFlightWorkflowPlan
5. 🔒 Phase 2 active layer - Executed weekly via: npx tsx scripts/run-accumulated-cases.ts --layer active
```

---

## Known Limitations

⚠️ **Important**: Booking page rendering variations by business logic:
- A plain desktop chain Choose→Select can reach `/flight/booking` but **may not render email-confirmation field**
- Absence of email-confirmation field is often a **business-gating signal** (direct-metasearch cohort / affiliateId / AB-test off), NOT a locator failure
- **Treat contact form verification as smoke-level only** when dealing with routed weekly regression slices

---

## Example Generated Case Structure

```typescript
import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
} from '../lib/traveloka-flight/workflow';

const TARGET_URL = 'https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY';

test.use({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'Asia/Shanghai',
});

test('Traveloka weekly diff booking coverage - Choose→Select chain (20260522)', async ({ page }, testInfo) => {
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: 'Complete Choose→Select booking chain and verify booking page contact form accessibility',
    concerns: ['booking-contact'],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  // Step 1: Click Choose button
  const chooseButton = page.locator('[data-testid="flight-inventory-card-button"]').first();
  await chooseButton.isVisible({ timeout: 15000 });
  await chooseButton.click();

  // Step 2: Wait for Select drawer
  await page.getByText(/Select ticket type/i).isVisible({ timeout: 15000 });

  // Step 3: Click Select button
  const selectButton = page.locator('[data-testid="button_ticket_option_select_1"]').first();
  await selectButton.isVisible({ timeout: 5000 });
  await selectButton.click();

  // Step 4: Verify booking page
  await page.waitForURL(/\/flight\/booking/, { timeout: 15000 });
  
  const bookingUrl = new URL(page.url());
  expect(bookingUrl.pathname).toMatch(/\/flight\/booking/);

  // Step 5: Verify contact form
  const contactForm = page.locator('[data-testid="booking-contact-form"], form').first();
  const contactExists = await contactForm.isVisible().catch(() => false);
  expect(contactExists, 'Booking contact form should be accessible').toBeTruthy();

  await testInfo.attach('booking-complete.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  // Retrieved shared-helpers...
  // Constraints...
});
```

---

## References

- [traveloka-flight-locator-guideline.md](traveloka-flight-locator-guideline.md) - Explicit contracts and locator priority
- [PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md](PHASE2_WORKFLOW_INTEGRATION_SUMMARY.md) - Phase 2 active layer execution strategy
- [traveloka-flight-source-routing.md](../memories/repo/traveloka-flight-source-routing.md) - Canonical booking chain documentation in memory
- [tests/lib/traveloka-flight/workflow.ts](../tests/lib/traveloka-flight/workflow.ts) - Helper implementation
- [tests/lib/traveloka-flight/locators.ts](../tests/lib/traveloka-flight/locators.ts) - Booking contact selectors
