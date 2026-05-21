# Bug Report: Desktop Carry-over Fails To Restore Airline Filter On Same Search Refresh

## Summary

On desktop Traveloka flight search results, when a user applies both:

- `1 transit(s)` filter
- one `Airline` filter

and then refreshes the same results page without changing route or trip type, the transit filter is retained but the airline filter is not restored.

This contradicts the PRD rule for carry-over on the same route and same trip type.

## Severity

Medium

Reason:

- PRD expectation is violated on the core desktop SSR carry-over flow.
- User-visible state becomes inconsistent: one filter survives refresh while another silently drops.
- This can reduce trust in filter persistence and makes the feature behavior hard to predict.

## PRD / Expected Behavior

Source PRD:

- `Carry-over Filter and Sort between Searches`
- Lark doc: `https://traveloka.sg.larksuite.com/wiki/HEeqweaOkihpt6k0ZxJl2Jgzgaf`

Relevant rule captured in the generated spec:

- `sameTripTypeSameRoute: Keep all filters.`

## Actual Behavior

After reload on the exact same search:

- `1 transit(s)` remains selected
- selected airline is no longer checked

Observed state from the failing run:

- airline row locator resolves correctly
- `aria-checked` is `false`
- screenshot shows transit retained and airline unchecked

## Reproduction

### Deep link

`https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY`

### Steps

1. Open the desktop results page above.
2. In `No. of Transit`, select `1 transit(s)`.
3. In `Airline`, select the first airline option.
4. Verify both filters are checked.
5. Refresh the page.
6. Wait for results and sidebar to load again.
7. Inspect the retained filter state.

### Expected

Both filters remain checked because route and trip type are unchanged.

### Actual

Only `1 transit(s)` remains checked. The airline filter is unchecked after refresh.

## Test Evidence

Failing Playwright case:

- `desktop round-trip retains transit plus airline filters on same-search refresh`

Spec file:

- `tests/web/traveloka-flight-weekly-diff-generated.spec.ts`

Observed suite result after latest validation:

- `2 passed`
- `1 failed`

Passing related control case:

- route-change case now passes and confirms the modal-driven search-change flow is valid

This matters because it isolates the remaining issue to same-search airline carry-over, not the new modal interaction helper.

## Error Signal

Primary assertion failure:

```text
Error: expect(locator).toHaveAttribute(expected) failed

Locator: locator('[data-testid="flight-search-sidebar-filter"]').locator('[data-flight-airline-option-idx="0"]').first()
Expected pattern: /true/i
Received string:  "false"
```

## Attachments

Failure screenshot:

- `test-results/web-traveloka-flight-weekl-55156-ters-on-same-search-refresh-chromium/test-failed-1.png`

Failure context:

- `test-results/web-traveloka-flight-weekl-55156-ters-on-same-search-refresh-chromium/error-context.md`

## Notes / Analysis

- The route-change carry-over test passes after switching to the real results-page change-search entry via the search icon and `Change search` flow.
- The remaining failure is specific to same-search airline restoration.
- The current screenshot indicates this is likely a real product/state-restoration bug rather than a locator mismatch.
- A separate runtime probe also showed expired-results overlays can appear during manual probing, but the validated failing case already reproduces without depending on that overlay.

## Suggested Engineering Checkpoints

Review the same-route restoration logic for airline filters in the desktop carry-over implementation, especially:

- persisted filter payload after airline selection
- reload-time restoration path for airline state
- mapping between persisted airline key and rendered sidebar option key
- timing/order of sidebar option hydration versus restored checked-state application

## Lark-ready Short Message

```text
[Bug][Desktop Flight][Carry-over] Same-search refresh does not restore airline filter

Summary:
On desktop flight results, when applying both `1 transit(s)` and one airline filter, a refresh on the same route / same trip type keeps the transit filter but drops the airline filter.

Expected:
Per PRD, same route + same trip type should keep all filters.

Actual:
Transit persists, airline does not.

Repro link:
https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY

Repro:
1. Select `1 transit(s)`
2. Select first airline
3. Refresh page
4. Observe airline filter unchecked while transit remains checked

Evidence:
- screenshot: test-results/web-traveloka-flight-weekl-55156-ters-on-same-search-refresh-chromium/test-failed-1.png
- spec: tests/web/traveloka-flight-weekly-diff-generated.spec.ts

Control case:
Route-change carry-over case passes, so this is narrowed to same-search airline restoration.
```