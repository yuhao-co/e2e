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

Example:

- `flight-general-filter-option-Refund & Reschedule`

Practical rule:

- `flight-general-filter` is generic and can repeat.
- Do not use the root alone as a unique locator.
- Scope by sidebar, then by the option title or label text inside the matching general filter block.

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
2. locate the section container by its explicit section id if one exists
3. otherwise locate the section by heading text inside the sidebar
4. within that section, locate the option container by explicit item id if available
5. otherwise locate the option by exact label text within the scoped section

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