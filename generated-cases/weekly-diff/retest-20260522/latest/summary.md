# Weekly Diff Case Generation Report

- Repo path: /Users/yu.hao/Desktop/task/e2e/.cache/weekly-diff-repos/github.com_traveloka_www
- Base ref: origin/master
- Diff window: 7 days
- Diff range: c34c7d57d2decdc85215d73c70bd3977ec196c7b..origin/master
- Changed files: 712

## Candidates

### Weekly flight booking entry regression coverage

- Domain: flight-booking
- Confidence: high
- Action: modify-existing
- Reason: Changed files map to flight booking surfaces. Re-check the nearest booking tests, then emit a runnable booking smoke case through the stable desktop chain.
- Solution: Prioritize existing booking tests, then emit a runnable weekly booking smoke spec through shared helpers.
- How to solve: Use packages/flight/fpr-booking evidence to route the candidate, preserve PRD references in markdown, and emit the generated web spec through the shared booking helper.
- Suggested intent: Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.
- Canonical target URL: https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY
- Workflow concerns: booking-contact
- Source commits: 5684ef12c6 by Ke Wu
- Existing tests to review: tests/web/traveloka-flight-metasearch-email-confirmation.spec.ts
- Generated web spec file: tests/web/traveloka-flight-booking-weekly-diff-20260522.spec.ts
- Source hints: 2 tracked in summary.json
- Changed files: 41 tracked in summary.json

### Weekly flight search regression coverage

- Domain: flight-search
- Confidence: high
- Action: modify-existing
- Reason: Changed files map to a dominant verified flight concern cluster. Re-check the nearest search-results tests before adding new ones.
- Solution: Prioritize existing flight regression tests, then emit a runnable weekly spec because verified flight source evidence exists.
- How to solve: Use packages/flight and traveloka-flight helper evidence to route the candidate, then emit the generated web spec through the shared workflow template.
- Suggested intent: Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.
- Canonical target URL: https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY
- Workflow concerns: results-list
- Source commits: 109da42765 by yuhao-co
- Existing tests to review: tests/web/traveloka-flight-filter.spec.ts, tests/web/traveloka-flight-random-filter.spec.ts
- Generated web spec file: tests/web/traveloka-flight-weekly-diff-20260522.spec.ts
- Source hints: 2 tracked in summary.json
- Retrieved evidence: 6 tracked in summary.json
- Changed files: 66 tracked in summary.json

### Weekly web i18n regression coverage

- Domain: web-i18n
- Confidence: medium
- Action: modify-existing
- Reason: Changed files look related to locale, language, or untranslated strings. Prefer updating existing i18n audit coverage before creating new tests.
- Solution: Update existing locale audit coverage before creating any new spec.
- How to solve: Route only locale and translation evidence into the i18n audit templates and reuse current audit cases.
- Suggested intent: Review weekly i18n changes touching accom, core, getcountryinfos, i18n, adapt and update the existing locale audit cases to cover them.
- Existing tests to review: tests/traveloka-i18n-audit.spec.ts, tests/traveloka-home-i18n.spec.ts
- Changed files: 3 tracked in summary.json

### Weekly Android home regression coverage

- Domain: android-home
- Confidence: medium
- Action: modify-existing
- Reason: Changed files look related to Android home/account flows. Reuse the existing Android audit or smoke specs first.
- Solution: Reuse the current Android audit and smoke coverage first.
- How to solve: Only map files with APK, Android, or traveloka-android evidence into the Android candidate.
- Suggested intent: Review weekly Android changes touching accom, acd, layout, mobile, appcontainer and update the Android home/account cases accordingly.
- Existing tests to review: tests/traveloka-android.spec.ts, tests/traveloka-android-audit.spec.ts, tests/traveloka-home-i18n.ts
- Changed files: 15 tracked in summary.json

