# Weekly Diff Case Generation Report

- Repo path: /Users/yu.hao/Desktop/task/e2e/.cache/weekly-diff-repos/github.com_traveloka_www
- Base ref: origin/master
- Diff window: 7 days
- Focus domain: flight-booking
- Diff range: 9698074a0f1fab5031b31ed8c0ecdf7a3c4b811e..origin/master
- Changed files: 806

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
- Changed files: 118 tracked in summary.json