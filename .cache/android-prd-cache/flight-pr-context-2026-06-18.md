# Recent [FLIGHT] PR Changes (last 7 days — 1 PRs)

---

## [FEATURE][FLIGHT] PR #40681: [FEATURE][FLIGHT] Add test tags to SSR v4 result card and navbar

### What Changed
- Add `Modifier.testTag` ids to all `Image` and `BMText` elements in the SSR v4 inventory card (`FlightResultV4InventoryCardComposeView`) for automated UI test coverage.
- Add `Modifier.testTag` ids to all `Image` and `BMText` elements in the SSR v4 navigation bar (`FlightResultV4NavigationBar`).
- Per-airline-row baggage icon/text tags are suffixed with `_$index` so each stays uniquely addressable.
- Scope is leaf elements only — no `Row`/`Column` container tags were added, keeping the ids stable against layout changes. Existing tags were left untouched.
