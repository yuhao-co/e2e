# 📋 PRD (Product Requirements Document) Report

## 📌 Metadata & Links

### 1. Source Information
- **Status**: ✅ PRD Successfully Generated
- **Generated At**: `2026-05-22T06:15:45.461Z`
- **Source**: `generated-cases/weekly-diff/latest/summary.json`
- **GitHub Repo**: https://github.com/traveloka/www
- **Analysis Type**: Weekly Diff Analysis

### 2. Summary Statistics
- **Total Candidates**: 2
- **Related Commits**: 2
- **Source Files**: 4

### 3. Candidate Overview
- **Weekly flight booking contact regression coverage** (flight-booking - high confidence)
- **Weekly flight search regression coverage** (flight-search - high confidence)

---

## 🎯 Detailed Candidate Summaries

### Weekly flight booking contact regression coverage
- **Domain**: flight-booking
- **Confidence**: high
- **Action Type**: modify-existing
- **Suggested Test Intent**:
  > Open the desktop Traveloka flight booking page and validate booking contact form fields, including email, email confirmation, mobile number, and passenger name. Verify required-field errors and mismatch-email validation are rendered correctly.
- **Target URL**: https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY
- **Workflow Concern**: booking-contact
- **Reason**: Changed files map to flight booking contact components. Re-check the nearest booking tests before adding new ones.
- **Solution**: Prioritize existing booking contact tests, then emit a runnable weekly spec.
- **Changed Files Count**: 120
- **Key Files**:
  - packages/booking/bkg-common/__tests__/modules/EntryStatusDisplay.test.tsx
  - packages/booking/bkg-common/__tests__/modules/TravelerDetailCache/crypto.test.ts
  - packages/booking/bkg-common/__tests__/modules/TravelerDetailCache/deriveCacheKey.test.ts

### Weekly flight search regression coverage
- **Domain**: flight-search
- **Confidence**: high
- **Action Type**: modify-existing
- **Suggested Test Intent**:
  > Open the desktop Traveloka flight search results page and validate the weekly regression areas covering results-list rendering and sidebar filter readiness. Prefer search-results coverage, filters, sorting, price visibility, and results-list behavior.
- **Target URL**: https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY
- **Workflow Concern**: results-list
- **Reason**: Changed files map to a dominant verified flight concern cluster. Re-check the nearest search-results tests before adding new ones.
- **Solution**: Prioritize existing flight regression tests, then emit a runnable weekly spec because verified flight source evidence exists.
- **Changed Files Count**: 66
- **Key Files**:
  - packages/flight/app-desktop/__tests__/pages/flight/fullsearch.test.tsx
  - packages/flight/app-desktop/__tests__/pages/flight/fulltwosearch.test.tsx
  - packages/flight/app-desktop/pages/flight/fullsearch.tsx

---

## 🔗 Commit & PR Links (Clickable)

### Weekly flight booking contact regression coverage
- **GitHub Commit**: [21c557e73b](https://github.com/traveloka/www/commit/21c557e73b)
  - Author: Alexander Leonardo
  - Message: [FEATURE][BOOKING] Retention Popup Enablement (#32211)
  - **PR Link**: [#32211](https://github.com/traveloka/www/pull/32211)

### Weekly flight search regression coverage
- **GitHub Commit**: [109da42765](https://github.com/traveloka/www/commit/109da42765)
  - Author: yuhao-co
  - Message: [FEATURE] Enhance flight booking features and fix related issues (#33161)
  - **PR Link**: [#33161](https://github.com/traveloka/www/pull/33161)

---

## 📁 Affected Files (sourceHints)

### Weekly flight booking contact regression coverage
- `packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactForm.tsx`
  - Desktop booking contact form component.
- `packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts`
  - Booking contact validation handler.

### Weekly flight search regression coverage
- `packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx`
  - Closest verified results-page component discovered for current desktop flight surface.
- `packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx`
  - Desktop flight results filter sidebar component for the current v2 surface.

---

## ✅ Verification Status

- ✅ PRD Generated Successfully
- ✅ JSON Validation: PASSED
- ✅ Markdown Extraction: COMPLETED
- ✅ Commits Extracted: 2 commits identified
- ✅ PR Links Generated: YES
- ✅ Source Files Identified: 4 hint(s)

---

## 📄 Original Weekly Diff Report

# Weekly Diff Case Generation Report

- Repo path: /Users/yu.hao/Desktop/task/e2e/.cache/weekly-diff-repos/github.com_traveloka_www
- Base ref: origin/master
- Diff window: 7 days
- Focus domain: flight-search, flight-booking
- Diff range: c93355b6644a4b4c378e2f155444682273ab9ff4..origin/master
- Changed files: 816

## Candidates

### Weekly flight booking contact regression coverage

- Domain: flight-booking
- Confidence: high
- Action: modify-existing
- Reason: Changed files map to flight booking contact components. Re-check the nearest booking tests before adding new ones.
- Solution: Prioritize existing booking contact tests, then emit a runnable weekly spec.
- How to solve: Use packages/flight/fpr-booking evidence to route the candidate and emit the generated web spec.
- Suggested intent: Open the desktop Traveloka flight booking page and validate booking contact form fields, including email, email confirmation, mobile number, and passenger name. Verify required-field errors and mismatch-email validation are rendered correctly.
- Canonical target URL: https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY
- Workflow concerns: booking-contact
- Source commits: 21c557e73b by Alexander Leonardo
- Existing tests to review: tests/web/traveloka-flight-metasearch-email-confirmation.spec.ts
- Generated web spec file: tests/web/traveloka-flight-booking-weekly-diff-20260522.spec.ts
- Source hints: 2 tracked in summary.json
- Changed files: 120 tracked in summary.json

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
