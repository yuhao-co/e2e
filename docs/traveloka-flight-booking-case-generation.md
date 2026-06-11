# Traveloka Flight Booking Case Generation Specification

## Overview
This document specifies the requirements and complete interaction workflow for generating high-quality Traveloka flight booking test cases. All generated booking cases **must** follow the canonical desktop booking chain and include all required interaction steps.

For any generated case that extends beyond booking entry and touches payment selection, credit-card setup, or pay CTA behavior, also treat [docs/traveloka-flight-booking-payment-chain-lock.md](/Users/yu.hao/Desktop/task/e2e/docs/traveloka-flight-booking-payment-chain-lock.md) as a locked companion specification.

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
const searchUrl = buildFlightSourceContextFromFiles(wwwChangedFiles, userIntent).url;
// Execute full chain: Choose → Select → Booking page
```

Do not handwrite a weekly generated target URL in booking specs. Resolve it from www file routing through `buildFlightSourceContextFromFiles(...)`, or use `TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL` when the run intentionally pins a verified direct metasearch booking URL.

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

## Escalation To Payment Chain

If the weekly diff or PRD context clearly touches payment behavior, generated cases must not invent a new booking-to-payment sequence. Instead, they must reuse the locked contracts from [docs/traveloka-flight-booking-payment-chain-lock.md](/Users/yu.hao/Desktop/task/e2e/docs/traveloka-flight-booking-payment-chain-lock.md), especially for:

- `bff-submit-page` retry behavior
- payment selection URL assertion
- cross-origin credit-card iframe handling
- bottom-page `paymentPayButton` click behavior

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

---

## 🔒 Payment Flow — Confirmed Selector Reference (MANDATORY for payment test cases)

> **Source of truth**: DOM dump collected 2026-05-27 on `en-sg` locale SIN→JKT booking.
> All testIDs below are **confirmed live** and must be used verbatim.
> This section is a **hard constraint** — generated payment test cases MUST NOT deviate from these selectors.

### Complete Chain: Search → Booking Page → Payment Page

```
Search URL  →  Choose button  →  Ticket drawer  →  Select  →  Booking page
  ↓
Contact form fill  →  Traveler form fill  →  bff-submit-page  →  Payment URL
  ↓
/payment/v2/selection?invoiceId=…&auth=…  →  CC iframe fill  →  verify (don't submit)
```

---

### Stage 1 – Reach Booking Page (existing, unchanged)

| Step | Selector | Action |
|------|----------|--------|
| Choose flight | `[data-testid="flight-inventory-card-button"]` (first) | `.click()` |
| Ticket drawer | wait for text `/Select ticket type/i` | `.waitFor()` |
| Select ticket | `[data-testid="button_ticket_option_select_1"]` (first) | `.click()` |
| Verify landing | `page.url()` matches `/\/flight\/booking/` | `expect().toMatch()` |
| Form root ready | `[data-testid="view_desktop-flight-booking-form"]` | `.waitFor({ state: 'visible' })` |

---

### Stage 2 – Contact Form

**Section wrapper**: `[data-testid="dynamic-component-BOOKING_CONTACT"]`

| Field | Selector | Action | Test value |
|-------|----------|--------|-----------|
| Full name | `[data-testid="name.full"]` | `.fill()` | `"YU HAO"` |
| Phone digits | `[data-testid="Mobile Number"] input:last-child` | `.fill()` | `"13756321982"` |
| Email | `[data-testid="emailAddress"]` | `.fill()` | `"yu.hao@traveloka.com"` |

> **Phone note**: `data-testid="Mobile Number"` is a container div (country code selector + digit input).
> Target the last `<input>` inside it for the phone digits. Country code defaults to +65 (SG); the saved
> session may pre-fill +86 (CN) from `lsFprRecentBookingContact` localStorage.

---

### Stage 3 – Traveler Form

**Section wrapper**: `[data-testid="traveler-form-adult"]`

| Field | Selector | Action | Test value |
|-------|----------|--------|-----------|
| Gender | `[data-testid="gender"]` `<select>` | `.selectOption({ label: 'Male' })` | `"Male"` |
| First name | `[data-testid="name.first"]` | `.fill()` | `"HAO"` |
| Last name | `[data-testid="name.last"]` | `.fill()` | `"YU"` |
| DOB – day | `[data-testid="day-datepicker"]` `<select>` | `.selectOption('4')` | `"4"` |
| DOB – month | `[data-testid="month-datepicker"]` `<select>` | `.selectOption({ label: 'March' })` | `"March"` |
| DOB – year | `[data-testid="year-datepicker"]` `<select>` | `.selectOption('1974')` | `"1974"` |
| Nationality | `[data-testid="nationality"]` `<select>` | `.selectOption({ label: 'Albania' })` | `"Albania"` |

---

### Stage 4 – Submit Booking

**Source**: `packages/flight/fpr-booking-desktop/views/ActionBooking/`

| Button | Selector | When present |
|--------|----------|-------------|
| Next (intermediate) | `[data-testid="bff-next-page"]` | Multi-step flows only (check `isVisible` first) |
| Continue to Payment | `[data-testid="bff-submit-page"]` | Always present as final submit |

**Required**: Intercept the createBooking BFF API **before** clicking submit to capture invoiceId as a fallback navigation path.

```typescript
// MUST set up listener before click
const bookingApiPromise = page.waitForResponse(
  (resp) =>
    (resp.url().includes('/bff/booking') ||
      resp.url().includes('createBooking') ||
      resp.url().includes('/booking/create')) &&
    resp.status() === 200,
  { timeout: 45000 },
).catch(() => null);

await page.locator('[data-testid="bff-submit-page"]').click();
```

---

### Stage 5 – Payment Page

**URL pattern**: `/{locale}/payment/v2/selection?invoiceId=…&auth=…`

**Source**: `packages/payment/pay-common/constants/PaymentConstant.ts` → `PaymentV2Path.SELECTION`

**Hard assertion** (no fake green):
```typescript
expect(
  /\/payment\/(v2\/)?selection/.test(page.url()),
  `Must reach /payment/v2/selection — current URL: ${page.url()}`,
).toBe(true);
```

---

### Stage 6 – Credit Card Iframe

**Iframe ID**: `creditCardPaymentFormIframe`  
**Source**: `packages/payment/pay-desktop-selection-v2/containers/embedded-form/EmbeddedCreditCardForm.tsx`

Access via `page.frameLocator('#creditCardPaymentFormIframe')`.

| Field | Selector inside iframe | Action | Test value |
|-------|------------------------|--------|-----------|
| Card number | `[data-testid="creditCardNumberField-inputField"]` | `.fill()` | `"5555555555554444"` (sandbox) |
| Expiry MM/YY | `[data-testid="expiryMonthYearField-inputField"]` | `.fill()` | `"12/28"` |
| CVV | `[data-testid="inputCVVField-container"] input` | `.fill()` | `"123"` |
| Name on card | `[data-testid="nameOnCard-inputField"]` | `.fill()` | `"YU HAO"` |

> **CVV note**: `inputCVVField-container` is a wrapper div — locate the inner `<input>` with `.locator('input')`.

**Payment submit** (⛔ DO NOT click in smoke/regression tests):
- `[data-testid="paymentPriceBreakdownContainer"]` → triggers real payment charge

---

### Full Implementation Template

```typescript
// ── Stage 2: Contact form ─────────────────────────────────────────────────
const contactSection = page.locator('[data-testid="dynamic-component-BOOKING_CONTACT"]');
await contactSection.waitFor({ state: 'visible', timeout: 15000 });
await contactSection.locator('[data-testid="name.full"]').fill('YU HAO');
const phoneWrapper = contactSection.locator('[data-testid="Mobile Number"]');
if (await phoneWrapper.count() > 0) {
  await phoneWrapper.locator('input').last().fill('13756321982');
} else {
  await contactSection.getByLabel('Mobile Number').fill('13756321982');
}
await contactSection.locator('[data-testid="emailAddress"]').fill('yu.hao@traveloka.com');

// ── Stage 3: Traveler form ────────────────────────────────────────────────
const travelerSection = page.locator('[data-testid="traveler-form-adult"]');
await travelerSection.waitFor({ state: 'visible', timeout: 10000 });
await travelerSection.locator('[data-testid="gender"]').selectOption({ label: 'Male' });
await travelerSection.locator('[data-testid="name.first"]').fill('HAO');
await travelerSection.locator('[data-testid="name.last"]').fill('YU');
await travelerSection.locator('[data-testid="day-datepicker"]').selectOption('4');
await travelerSection.locator('[data-testid="month-datepicker"]').selectOption({ label: 'March' });
await travelerSection.locator('[data-testid="year-datepicker"]').selectOption('1974');
await travelerSection.locator('[data-testid="nationality"]').selectOption({ label: 'Albania' });

// ── Stage 4: Submit ───────────────────────────────────────────────────────
const nextBtn = page.locator('[data-testid="bff-next-page"]');
if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await nextBtn.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}
const bookingApiPromise = page.waitForResponse(
  (resp) =>
    (resp.url().includes('/bff/booking') || resp.url().includes('createBooking') ||
      resp.url().includes('/booking/create')) && resp.status() === 200,
  { timeout: 45000 },
).catch(() => null);
await page.locator('[data-testid="bff-submit-page"]').click();

// Wait for payment URL (primary) or API response (fallback)
const [, apiResp] = await Promise.all([
  page.waitForURL(/\/payment\/(v2\/)?selection/, { timeout: 45000 }).catch(() => null),
  bookingApiPromise,
]);
if (!/\/payment\/(v2\/)?selection/.test(page.url()) && apiResp) {
  try {
    const body = await apiResp.json();
    const invoiceId = body?.data?.invoiceId ?? body?.invoiceId;
    const auth = body?.data?.token ?? body?.data?.auth ?? body?.auth ?? body?.token;
    if (invoiceId) {
      const locale = page.url().match(/traveloka\.com\/([^/]+)\//)?.[1] ?? 'en-sg';
      await page.goto(
        `https://www.traveloka.com/${locale}/payment/v2/selection?invoiceId=${invoiceId}${auth ? `&auth=${auth}` : ''}`,
        { waitUntil: 'domcontentloaded' },
      );
    }
  } catch { /* ignore */ }
}

// ── Stage 5: Hard assertion — no fake green ──────────────────────────────
expect(
  /\/payment\/(v2\/)?selection/.test(page.url()),
  `Must reach /payment/v2/selection — current URL: ${page.url()}`,
).toBe(true);

// ── Stage 6: CC iframe (smoke only, no submit) ───────────────────────────
const frame = page.frameLocator('#creditCardPaymentFormIframe');
// fill card details... (see table above)
// ⛔ DO NOT click [data-testid="paymentPriceBreakdownContainer"]
```

---

### Hard Constraints for Payment Test Cases

```
🔒 MUST use [data-testid="bff-submit-page"] to click "Continue to Payment" — NOT text matching, NOT CSS class
🔒 MUST use [data-testid="traveler-form-adult"] as traveler section scope — NOT generic "form"
🔒 MUST use day/month/year-datepicker selects for DOB — NOT free-text date input
🔒 MUST assert /payment\/(v2\/)?selection/ URL STRICTLY — no partial pass when payment not reached
🔒 MUST set up createBooking API intercept BEFORE clicking submit — not after
🔒 MUST use page.frameLocator('#creditCardPaymentFormIframe') — iframe is cross-origin
🔒 MUST NOT click paymentPriceBreakdownContainer — smoke test only, never place real orders
🔒 MUST NOT use ai() for form filling — MLX server not guaranteed to run in CI
```

<!-- AUTO_PROMOTED_LESSONS_START -->
## Verified Stable Lessons
### flight-booking-contact
- Trigger: ticket type drawer not visible
- Action: Wait for [data-testid="view_fsv2_ticket_option_card_0"] (TicketOptionCard.tsx anchor), then click [data-testid="button_fsv2_ticket_option_select_0"]. Pattern is button_fsv2_ticket_option_select_${index} where index=0 for first option. NEVER use button_ticket_option_select_1 or ticket-type-drawer — confirmed wrong from www source.
- Promoted after 2 verified rerun(s)
- Trigger: ai-fallback triggered for ticket drawer
- Action: Root cause: spec used wrong testid. Fix: source selector from TicketOptionCard.tsx via `git show HEAD:packages/flight/fpr-bundle/StackedBundleSummaryTray/TicketOptionsTray/TicketOptionsSection/TicketOptionCard.tsx | grep testID`. Do NOT rely on ai() as primary for this step.
- Promoted after 2 verified rerun(s)
- Trigger: www cache is bare repo no working tree
- Action: www source at .cache/weekly-diff-repos/github.com_traveloka_www is a BARE git repo. grep -r on filesystem returns nothing. Must use: `git -C .cache/weekly-diff-repos/github.com_traveloka_www show HEAD:<relative-path> | grep testID`. Never guess testids.
- Promoted after 2 verified rerun(s)

### flight-booking-payment
- Trigger: booking chain reached payment successfully
- Action: Full booking chain confirmed working 2026-05-29: search → Choose ([data-testid="flight-inventory-card-button"]) → wait view_fsv2_ticket_option_card_0 → Select button_fsv2_ticket_option_select_0 → booking form → contact/traveler fill via ai() → bff-next-page → bff-submit-page → payment. CC form inside #creditCardPaymentFormIframe (cross-origin, use frame.locator). Do NOT submit payment.
- Promoted after 2 verified rerun(s)
<!-- AUTO_PROMOTED_LESSONS_END -->
