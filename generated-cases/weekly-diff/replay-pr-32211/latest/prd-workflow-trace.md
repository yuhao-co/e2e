# PR 32211 PRD Workflow Trace

## Summary

This trace follows PR 32211 through the current weekly-diff workflow to show exactly where the PRD chain is working and where it stops influencing generated output.

PR:

- GitHub PR: https://github.com/traveloka/www/pull/32211
- Title: [FEATURE][BOOKING] Retention Popup Enablement

Primary finding:

- The PRD link is present in the PR and is successfully extracted.
- The PRD body is also retrievable through the repository's Lark workflow.
- The chain breaks after enrichment: the weekly generator stores the PRD link in summary/spec metadata, but it does not automatically materialize PRD markdown or use PRD requirements to shape the generated booking case intent.

## Expected Workflow

Per docs/weekly-diff-case-generator.md, the intended path for markdown-ready PRD flow is:

1. Read the PR body.
2. Extract PRD links.
3. Resolve Meegle links when needed.
4. When markdown output is needed, run scripts/extract-prd-with-opencode.sh against the resolved Lark PRD URL.
5. Use the PRD output as structured input for later automated test-case generation.

For PR 32211, the PRD is already a direct Lark wiki link, so step 3 is not needed.

## Step 1: PR Contains A Real PRD Link

Confirmed from PR 32211 metadata:

- PR summary includes: Design Docs: [Retention Drop Off](https://traveloka.sg.larksuite.com/wiki/XT84wK4x8ig9NKk0rIelDoB6gkg)
- The weekly replay summary now captures:
  - prNumber: 32211
  - prTitle: [FEATURE][BOOKING] Retention Popup Enablement
  - prSummary: Design Docs: [Retention Drop Off](https://traveloka.sg.larksuite.com/wiki/XT84wK4x8ig9NKk0rIelDoB6gkg)
  - prdLinks: https://traveloka.sg.larksuite.com/wiki/XT84wK4x8ig9NKk0rIelDoB6gkg

Status: passed.

## Step 2: PRD Extraction Through The Workflow Succeeds

Using the repository workflow script:

- Command path: scripts/extract-prd-with-opencode.sh
- Output file: generated-cases/weekly-diff/replay-pr-32211/latest/prd-extraction.md

Observed result:

- MCP Lark raw-content successfully returned readable PRD content.
- The PRD is not about booking contact form validation.
- The extracted requirements are about retention-popup behavior, including:
  - backend-driven retentionPopupDisplay contract
  - one-time popup display
  - desktop exit behavior on Traveloka-logo exit and browser/tab/window exit
  - tracking for show, primary click, secondary click, and back-to-previous-page

Status: passed.

## Step 3: Weekly Generator Enrichment Also Succeeds

The weekly replay output shows enrichment is no longer the blocker:

- summary.json contains prTitle, prSummary, and prdLinks
- generated webSpecContent also includes EN Source summary with the PRD URL

This means the previous failure mode of prNumber-only enrichment has already been fixed for this environment.

Status: passed.

## Step 4: Routing And Case Intent Drift Away From The PRD

This is the first real disconnect.

Although the PR title and PRD both point to retention popup behavior, the generated candidate becomes:

- Weekly flight booking contact regression coverage
- EN Main checks: booking contact form field rendering and validation
- intent: email, email confirmation, mobile number, passenger name, required-field and mismatch-email validation

That generated intent does not match the extracted PRD, which is about leave-confirmation / retention popup behavior.

Why this happens in the current generator:

- buildFlightBookingCandidate is hardcoded to booking contact validation intent and assertions.
- The candidate builder prioritizes changed files under packages/flight/fpr-booking and bookingContactValidationHandler patterns.
- PRD metadata is appended as source context only; it does not override or reshape the generated concern.

Observed consequence:

- The spec references PR 32211 and the PRD URL in comments.
- But the executable scenario still validates booking contact fields instead of retention popup behavior.

Status: failed.

## Step 5: PRD Markdown Is Not Materialized By Weekly Generation

This is the second disconnect.

The weekly generator currently:

- resolves Meegle links when present
- stores markdownSummary inside summary.json
- writes draft files and generated web specs

It does not currently:

- invoke scripts/extract-prd-with-opencode.sh for direct Lark wiki PRD links
- write a PRD markdown artifact automatically during weekly generation
- write summary.md automatically from markdownSummary

Observed consequence:

- replay output originally had summary.json only
- summary.md and prd-extraction.md had to be created manually afterward

Status: failed.

## What Is Working vs Broken

Working:

- PR body retrieval for PR 32211
- direct Lark PRD link extraction
- PRD body extraction via MCP Lark workflow
- weekly summary enrichment with prSummary and prdLinks

Broken or missing:

- PRD content does not drive booking candidate selection or intent generation
- weekly generation does not auto-create PRD markdown output for direct Lark links
- weekly generation does not auto-write summary.md from markdownSummary
- booking template remains hardcoded to booking-contact validation even when PR metadata points elsewhere

## Concrete Breakpoint

The chain is not broken at PR access or PRD access.

The chain is broken between:

1. PRD enrichment becoming available
2. weekly candidate/template generation consuming that PRD semantically

In plain terms:

- The system knows the PR is about Retention Popup Enablement.
- The system knows the PRD URL.
- The system can read the PRD body.
- But the generated case template still behaves as if the change were a booking-contact validation change.

## Recommended Next Fixes

1. Make weekly generation automatically write summary.md beside summary.json.
2. For direct Lark wiki PRD links, add an optional PRD extraction step that writes prd-extraction.md into the output folder when markdown output is requested.
3. Feed extracted PRD requirements back into candidate intent generation, instead of treating PRD lines as comments only.
4. Split booking routing into at least two concern families:
   - booking-contact validation
   - booking retention / leave-confirmation popup
5. Replace the current hardcoded booking weekly template when PR title or extracted PRD strongly signals retention popup behavior.

## Current Artifact Set For This Replay

- generated-cases/weekly-diff/replay-pr-32211/latest/summary.json
- generated-cases/weekly-diff/replay-pr-32211/latest/summary.md
- generated-cases/weekly-diff/replay-pr-32211/latest/prd-extraction.md
- generated-cases/weekly-diff/replay-pr-32211/latest/prd-workflow-trace.md

## Bottom Line

For PR 32211, the workflow can already reach the PRD.

The missing connection is downstream: the generator does not yet convert that PRD into the correct runnable booking-retention scenario, and it does not automatically emit the PRD markdown artifact as part of weekly generation.