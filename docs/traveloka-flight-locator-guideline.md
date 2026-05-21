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
- For desktop results filters, start from the runtime sidebar contract `flight-search-sidebar-filter`, then prefer explicit runtime filter ids such as `airline-filter-collapsible-list`, `airline-filter-collapsible-item-<label>`, `view_filter_departureTime`, `view_filter_arrivalTime`, `view_filter_flightDuration`, and `flight-general-filter-option-<title>` before any text fallback.
- For desktop results-page route changes, treat `IcSystemSearch` as a contract anchor, not as a guaranteed directly clickable header node. Resolve it via `[data-id="IcSystemSearch"], [data-testid="IcSystemSearch"]`, prefer a visible actionable descendant when present, allow a DOM `click()` fallback for overlay-clipped nodes, and wait for either the `Change search` button or the search form to appear before continuing.
- For result-list verification, never validate filters against a shallow container that only contains `Flight Details`, `Fare & Benefits`, `Refund`, `Reschedule`, and `Choose`. Tag and assert against the full result card that also contains airline, timing, airport, and price signals.

See `docs/traveloka-flight-filter-structure.md` for the current sidebar filter component tree and runtime id patterns derived from `traveloka/www`.

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
  page.locator('[data-id="IcSystemSearch"], [data-testid="IcSystemSearch"]'),
  'desktop results-page search trigger',
);
await trigger.click({ force: true });
await page.waitForTimeout(800).catch(() => {});

if (!(await page.locator('[data-testid="desktop-default-form"]').isVisible().catch(() => false))) {
  await page.getByRole('button', { name: /Change search/i }).click({ force: true });
}
```

## Anti-patterns

- `page.locator('div > div > div:nth-child(4) button').click()`
- `page.locator('button').nth(3)` when the button meaning is user-visible
- global `getByText()` on highly repeated strings without first scoping to a section
- using video review as the main way to discover a locator when trace/codegen/DOM summary can answer it faster
- tagging a result card from the first ancestor that contains `Flight Details` / `Choose` without verifying the same container also contains airline, airport, time, or price text

## Recent lessons

- The `IcSystemSearch` route-change entrypoint is stable as a contract id, but unstable as a single CSS position. Do not bind route-change flows to `[data-testid="flight-search-header"] [data-id="IcSystemSearch"]` only.
- If a random airline filter is considered "selected," require two checks before trusting it in a test: the sidebar option must look checked, and sampled visible result cards must actually contain that airline.
- When verifying filtered results, tag the full card container first; otherwise card text can collapse to tabs-only content and produce false failures or false passes.

## Debugging workflow

When a locator is unclear, use this order:

1. Playwright Inspector or `codegen`
2. Trace Viewer DOM snapshot
3. candidate-summary diagnostics from helper functions
4. manual DOM inspection
5. recorded video only if the problem is behavior timing rather than DOM identity

## Expected engineering support from product code

If a control is important to test and not stable to locate by role/name, add a dedicated `data-testid`. The best place to fix flaky locators is usually the product markup, not the test case.