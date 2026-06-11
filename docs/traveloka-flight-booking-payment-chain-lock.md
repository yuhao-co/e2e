# Traveloka Flight Booking To Payment Chain Locked Specification

## Locked Status

This document is the authoritative record for desktop Traveloka flight `booking => payment` chain generation in this repository.

Non-negotiable rule:

- Do not relax, replace, or silently remove any contract in this file without rerunning the headed smoke flow in [tests/web/traveloka-flight-booking-payment-e2e.spec.ts](/Users/yu.hao/Desktop/task/e2e/tests/web/traveloka-flight-booking-payment-e2e.spec.ts) and updating this document in the same change.
- Weekly-diff and bug-detection related generated cases that touch the flight booking/payment surface must treat this file as locked local evidence.

## Proven Desktop Chain

The validated desktop production chain is:

1. Search results page
2. Click first `Choose`
3. Wait for ticket-type drawer
4. Click first `Select`
5. Reach `/flight/booking`
6. Fill booking contact + traveler form
7. Click `[data-testid="bff-submit-page"]` repeatedly until payment page is reached
8. Reach `/{locale}/payment/v2/selection`
9. Open `Credit Card / Debit Card`
10. Fill credit-card fields
11. Click bottom-page `[data-testid="paymentPayButton"]`
12. Assert URL leaves `/payment/v2/selection`

Validated post-pay navigation example:

- `https://secureacceptance.cybersource.com/silent/payer_authentication/hybrid?ccaAction=load`

## Non-Negotiable Contracts

### Booking Submit

- Selector: `[data-testid="bff-submit-page"]`
- Behavior: click in a retry loop until payment URL appears.
- Do not require passport filling for this smoke chain.
- Do not replace the retry loop with a single click assumption.

### Payment Page Entry

- Success URL pattern: `/payment/(v2/)?selection`
- Payment page must be treated as the next canonical surface after booking submit.

### Credit Card Option

- Selector: `[data-testid*="paymentOptionGroup-Credit Card"]`
- Clicking this option creates a cross-origin iframe at `payfrm.pay.traveloka.com`.

### Critical Cross-Origin Constraint

The payfrm credit-card iframe performs parent-origin/referrer validation. In Playwright, the iframe must be reloaded with an explicit referer after attach:

```ts
await frame.goto(frame.url(), {
  referer: paymentUrl,
  waitUntil: 'commit',
});
```

Without this, the flow can redirect the parent page to Traveloka homepage and the generated test becomes invalid.

### Credit Card Fields

The credit-card inputs are hosted inside `#creditCardPaymentFormIframe` and must be accessed through the iframe `Frame`, not the top page.

Required selectors inside the iframe:

- Card number: `[data-testid="creditCardNumberField-inputField"] input`
- Expiry: `[data-testid="expiryMonthYearField-inputField"] input`
- CVV: `[data-testid="inputCVVField-container"] input`
- Name on card: `[data-testid="nameOnCard-inputField"] input`

### Pay Button

The final pay CTA is on the main payment page, not inside the iframe.

- Selector: `[data-testid="paymentPayButton"]`
- Placement: bottom of page
- Required action: scroll into view before click if needed

Do not replace the main-page pay button with an iframe-scoped button selector.

## Recovery Rules

- If the run leaves the payment page unexpectedly, recover with `page.goto(paymentUrl)`.
- Do not use browser refresh as the default recovery path for this chain.
- If the credit-card iframe is attached but not stable, wait briefly for the payfrm URL before calling `frame.goto(..., { referer })`.

## Generation Rules

Weekly-diff and bug-detection related generated cases touching these keywords must load this document as strong evidence:

- `flight-booking`
- `payment`
- `checkout`
- `credit card`
- `payAuth`
- `paymentPayButton`
- `payment/v2/selection`

When those signals are present, generated cases must preserve these constraints:

1. Desktop web only.
2. Traveloka WWW only.
3. Booking chain must reach payment selection before asserting payment behavior.
4. Credit-card fields must be modeled as iframe-scoped interactions.
5. Final pay CTA must be modeled as main-page bottom CTA.
6. Referrer-sensitive iframe loads must use explicit `frame.goto(..., { referer: paymentUrl })`.

## Authoritative Example

The current proven implementation is:

- [tests/web/traveloka-flight-booking-payment-e2e.spec.ts](/Users/yu.hao/Desktop/task/e2e/tests/web/traveloka-flight-booking-payment-e2e.spec.ts)

Generated cases should treat that file as executable reference, and this document as the locked prose contract.

<!-- AUTO_PROMOTED_LESSONS_START -->
## Verified Stable Lessons
### flight-booking-payment
- Trigger: booking chain reached payment successfully
- Action: Full booking chain confirmed working 2026-05-29: search → Choose ([data-testid="flight-inventory-card-button"]) → wait view_fsv2_ticket_option_card_0 → Select button_fsv2_ticket_option_select_0 → booking form → contact/traveler fill via ai() → bff-next-page → bff-submit-page → payment. CC form inside #creditCardPaymentFormIframe (cross-origin, use frame.locator). Do NOT submit payment.
- Promoted after 2 verified rerun(s)
<!-- AUTO_PROMOTED_LESSONS_END -->
