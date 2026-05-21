# Traveloka Flight Filter Structure

This note captures the desktop flight sidebar filter structure for the current Traveloka results surface, based on:

- live runtime ids seen on the results page
- local test helpers in this repo
- `traveloka/www` source under `packages/flight/fpr-search-result-v2`

## Top-level sidebar

The desktop sidebar root is anchored by:

- `data-testid="flight-search-sidebar-filter"`

In `traveloka/www`, the owning component is:

- `packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx`

That component renders the sidebar in this order:

1. `TransitFilterMenu`
2. `AirlineFilterMenu`
3. `TimeFilterMenu`
4. `MoreFilterMenu`

For test code, always scope filter interactions to the sidebar root first before locating a section or option.

## Airline filter

The airline section is rendered from:

- `packages/flight/fpr-search-result-v2/components/FlightHeader/FilterMenu/AirlineFilterMenu.tsx`
- `packages/flight/fpr-search-result-components/src/FilterSort/AirlineFilter/AirlineFilter.tsx`

Stable runtime ids:

- list root: `airline-filter-collapsible-list`
- option item pattern: `airline-filter-collapsible-item-<option.label>`

Example:

- `airline-filter-collapsible-item-Air China`

Practical rule:

- Prefer `airline-filter-collapsible-item-<label>` when present.
- If the live label contains spaces or punctuation, build the locator from the exact rendered label.
- If multiple descendants exist inside the item, click the item container or the nested checkbox inside that scoped item, not a global checkbox.

## Time filters

The time section is rendered from:

- `packages/flight/fpr-search-result-v2/components/FlightHeader/FilterMenu/TimeFilterMenu.tsx`
- `packages/flight/fpr-search-result-components/src/FilterSort/TimeFilter/variant/IntervalFilter.tsx`
- `packages/flight/fpr-search-result-components/src/FilterSort/TimeFilter/variant/DurationFilter.tsx`

Source-level ids passed by `TimeFilterMenu`:

- `filter_departureTime`
- `filter_arrivalTime`
- `filter_flightDuration`

Rendered wrapper ids from the base components:

- `view_filter_departureTime`
- `view_filter_arrivalTime`
- `view_filter_flightDuration`

Rendered option ids for interval filters:

- `check_box_filter_departureTime_<option.value>`
- `check_box_filter_arrivalTime_<option.value>`

Examples:

- `check_box_filter_departureTime_afternoon`
- `check_box_filter_arrivalTime_morning`

Practical rule:

- Treat `view_filter_*` as the stable section container on the live page.
- Treat `check_box_filter_*_<value>` as the preferred option-level id when available.
- For duration, the section root is explicit, but the slider internals are component-driven and may need role or descendant scoping inside `view_filter_flightDuration`.

## More filters

The "more" section is rendered from:

- `packages/flight/fpr-search-result-v2/components/FlightHeader/FilterMenu/MoreFilterMenu.tsx`
- `packages/flight/fpr-search-result-components/src/FilterSort/MoreFilter/variant/GeneralFilter.tsx`

General filter runtime ids:

- section root: `flight-general-filter`
- option row pattern: `flight-general-filter-option-<title>`
- option label pattern: `flight-general-filter-option-label-<title>`

Known live sections that map into this general filter family include:

- refund and reschedule
- facilities
- preference
- price/passenger
- transit points
- transit duration

Example:

- `flight-general-filter-option-Refund & Reschedule`

Practical rule:

- `flight-general-filter` is generic and can repeat.
- Do not use the root alone as a unique locator.
- Scope by sidebar, then by the option title or label text inside the matching general filter block.
- On desktop card mode, lower `More` groups can be wrapped by `FlightCollapsible` and rendered collapsed by default. Before looking for options like `Baggage`, first expand the matching section header by clicking its right-side chevron contract, scoped as `[data-id="IcSystemChevronDown"]` inside the correct header row.
- After expansion, treat the option row and the option control separately. For `GeneralFilter`, the row test ids (`flight-general-filter-option-<title>` / `flight-general-filter-option-label-<title>`) wrap a shared `Checkbox.Control` plus label content. Prefer the internal checkbox/control when toggling the option.

### Facilities / Baggage

Source grounding:

- `packages/flight/fpr-search-result-v2/components/FlightHeader/FilterMenu/MoreFilterMenu.tsx`
- `packages/flight/fpr-search-result-components/src/FilterSort/MoreFilter/variant/GeneralFilter.tsx`

Verified behavior:

- `Facilities` is rendered in card mode under `FlightCollapsible`
- expansion is controlled by `filterExpandState['facility']`
- the collapse trigger is the section header chevron, exposed in runtime as `data-id="IcSystemChevronDown"`
- the `Baggage` option sits inside `flight-general-filter-option-Facilities` after expansion
- the actual toggle surface is the shared checkbox/control inside that row, not the surrounding wrapper alone

Recommended interaction sequence:

1. scroll inside `flight-search-sidebar-filter` until `Facilities` is visible
2. locate the `Facilities` header row
3. click the scoped `[data-id="IcSystemChevronDown"]`
4. wait for `flight-general-filter-option-Facilities` containing `Baggage`
5. click the row's internal checkbox/control
6. verify by result behavior, not only by wrapper DOM state

## Transit filter

The transit section is mounted first in the sidebar from `TransitFilterMenu`.

In this repo, the current stable root strategy remains:

- sidebar root `flight-search-sidebar-filter`
- section heading text such as `No. of Transit`

For the current desktop results surface, the repo helper still uses scoped section discovery plus checkbox selection because the live page evidence gathered so far is stronger than the source-side explicit ids for this branch.

## Runtime vs source id naming

There are two naming layers to remember:

1. Source component ids passed as props, such as `filter_departureTime`
2. Runtime wrapper ids emitted by the shared filter components, such as `view_filter_departureTime`

For E2E, always prefer the runtime DOM id that actually exists on the page.

## Fallback rules when ids are missing

If a filter control has no dedicated runtime id:

1. scope to `flight-search-sidebar-filter`
2. scroll inside the sidebar itself until the relevant section becomes visible
3. locate the section container by its explicit section id if one exists
4. otherwise locate the section by heading text inside the sidebar
5. within that section, locate the option container by explicit item id if available
6. otherwise locate the option by exact label text within the scoped section

Do not use page-wide text matching for filters.

## Testing guidance for this repo

Use this priority for desktop results filters:

1. sidebar root `flight-search-sidebar-filter`
2. section-level runtime ids like `airline-filter-collapsible-list` or `view_filter_departureTime`
3. option-level runtime ids like `airline-filter-collapsible-item-Air China` or `check_box_filter_departureTime_afternoon`
4. scoped text inside the already narrowed section only when no explicit runtime id exists

This is the default policy for future Traveloka filter automation in this repo.

## Validation lessons

- A checked airline option is not sufficient evidence by itself. For random filter training or generated cases, sampled visible result cards must also contain the same airline name before the test accepts that airline candidate.
- For route-change training, opening the search panel from `IcSystemSearch` should be treated as a two-step interaction contract: click the icon contract first, then click `Change search` if the modal does not open immediately.
- Result-card verification must operate on the full card container. A shallow container that only exposes `Flight Details`, `Fare & Benefits`, `Refund`, `Reschedule`, and `Choose` is not a valid verification target.
- The left sidebar is itself scrollable. Lower filter sections and options may never enter the DOM search window unless the test scrolls `flight-search-sidebar-filter` directly instead of only scrolling the main page.
- For collapsed `MoreFilterMenu` groups, missing options do not necessarily mean the locator is wrong. The cheaper discriminating check is whether the section's scoped `IcSystemChevronDown` has been clicked yet. Only search for rows like `Baggage` after that expand step.
- For `Facilities > Baggage`, DOM-only state checks on the outer wrapper are brittle. The stable strategy is to scope to the row/control for the click, then confirm the filtered result set changed as expected.