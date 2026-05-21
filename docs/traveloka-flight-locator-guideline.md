# Traveloka Flight Locator Guideline

This note defines how Traveloka flight E2E tests should locate elements so cases stay readable and do not depend on recorded videos or one-off DOM hints.

## Locator priority

Use this order unless a page variant forces a fallback:

1. `getByRole(..., { name })`
2. `getByLabel(...)`
3. `getByPlaceholder(...)`
4. `getByText(...)` for non-interactive content
5. `getByTestId(...)`
6. raw `locator('css')` only as the last resort

Do not start from class names, deep DOM chains, or `nth()/last()/first()` unless the code also explains why that fallback is safe.

## Traveloka-specific rules

- Treat `data-testid` as the preferred explicit test contract.
- Treat `data-id` as an implementation hint, not the final contract, unless the UI already uses it as the only stable identifier.
- For results-page actions, scope locators to the owning container first, then find the child control inside that container.
- For sidebar filters, locate the section first, then the row, then the checkbox. Do not click a global checkbox selector.
- For repeated UI like cards, drawers, and modals, require one visible match before clicking. If there are multiple matches, fail with candidate summaries instead of silently picking the first one.
- Known desktop form anchors already trained for this repo: `airport-autocomplete-container-departure`, `oneway-roundtrip-tab`, `item_nimbus-autocomplete-airport-cgk`, `passengers-container`, `passengers-stepper-minus-adult`, `passengers-stepper-plus-adult`, `passengers-row-child`, `passengers-row-infant`, `departure-date-input`, `date-cell-2026-6-1`, `IcTransportSeatClass`, `desktop-default-search-button`.

## Preferred patterns

### Scope before click

```ts
const modal = page.getByTestId('flight-search-form');
const searchButton = modal.getByRole('button', { name: /search flights/i });
```

### Narrow a repeated list item

```ts
const airlineRow = sidebar
  .locator('label, [role="checkbox"], button, div')
  .filter({ hasText: /singapore airlines/i });
```

### Require a unique visible match

```ts
const trigger = await requireUniqueVisibleLocator(
  page.locator('[data-testid="flight-search-header"] [data-id="IcSystemSearch"]'),
  'desktop results-page search trigger',
);
await trigger.click();
```

## Anti-patterns

- `page.locator('div > div > div:nth-child(4) button').click()`
- `page.locator('button').nth(3)` when the button meaning is user-visible
- global `getByText()` on highly repeated strings without first scoping to a section
- using video review as the main way to discover a locator when trace/codegen/DOM summary can answer it faster

## Debugging workflow

When a locator is unclear, use this order:

1. Playwright Inspector or `codegen`
2. Trace Viewer DOM snapshot
3. candidate-summary diagnostics from helper functions
4. manual DOM inspection
5. recorded video only if the problem is behavior timing rather than DOM identity

## Expected engineering support from product code

If a control is important to test and not stable to locate by role/name, add a dedicated `data-testid`. The best place to fix flaky locators is usually the product markup, not the test case.