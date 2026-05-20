# Weekly Diff Case Generation Report

- Repo path: /Users/yu.hao/Desktop/task/e2e
- Base ref: HEAD
- Diff window: 2 days
- Focus domain: flight-search
- Diff range: e38265edc7a39081f37ef281551f73b37a7c8a37..HEAD
- Changed files: 14

## Candidates

### Weekly flight search regression coverage

- Domain: flight-search
- Action: modify-existing
- Reason: Changed files look related to flight search or results surfaces. Re-check existing search-results tests before adding new ones.
- Suggested intent: Open the desktop Traveloka flight search results page and validate the weekly regression areas touching filter, intent, locators, map, random. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.
- Canonical target URL: https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY
- Workflow concerns: results-list, search-form
- Existing tests to review: tests/web/traveloka-flight-filter.spec.ts, tests/web/traveloka-flight-random-filter.spec.ts
- Generated draft file: traveloka-flight-weekly-generated.spec.ts
- Generated web spec file: tests/web/traveloka-flight-weekly-diff-generated.spec.ts
- Source hints:
  - packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx: Closest verified results-page component discovered for current desktop flight surface.
  - packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx: Desktop flight results filter sidebar component for the current v2 surface.
- Changed files:
  - tests/lib/traveloka-flight/intent.ts
  - tests/lib/traveloka-flight/locators.ts
  - tests/lib/traveloka-flight/source-map.ts
  - tests/lib/traveloka-flight/template.ts
  - tests/lib/traveloka-flight/workflow.ts
  - tests/web/traveloka-flight-filter.spec.ts
  - tests/web/traveloka-flight-random-filter.spec.ts
