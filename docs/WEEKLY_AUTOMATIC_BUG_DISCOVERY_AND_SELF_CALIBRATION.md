# Weekly Automatic Bug Discovery And Self-Calibration

This document records the industry pattern that best matches this repository's
actual problem: weekly automated discovery of real regressions in Traveloka WWW,
without repeatedly depending on manual locator coaching for each new flow.

The key constraint in this repository remains unchanged:

- PRD is the source of product intent.
- Traveloka WWW source is the source of executable selector and route contracts.
- Runtime traces, DOM snapshots, and network evidence are the source of
  self-calibration.
- Freeform LLM guessing is not a valid replacement for any of the above.

## The industry pattern is not "AI writes tests"

Teams that actually run weekly or continuous bug-finding workflows do not rely on
one prompt that turns a PRD into a brittle browser script. They combine five
layers.

1. Change-based selection

- Use code diff, ownership, and route mapping to decide which user journeys are
  worth running this week.
- The goal is not to generate every imaginable test, but to spend runtime budget
  on the journeys most likely to regress.
- This is the same principle behind test impact analysis and selective
  regression.

2. Contract-based execution

- Use stable application contracts to drive execution: route patterns, test ids,
  labels, API shapes, DOM invariants, and known workflow steps.
- In service ecosystems, this shows up as consumer-driven contracts.
- In UI systems, the equivalent is explicit selector and workflow contracts,
  not CSS guessing.

3. Scheduled synthetic journeys

- Run a small number of high-value browser journeys on a schedule, not only on
  PRs.
- Industry synthetic monitoring products use real-browser checks for login,
  checkout, payment, and form-submission paths because these catch regressions
  that unit and integration tests miss.
- The scheduled run is the bug-discovery loop, not only the release gate.

4. Multi-oracle verification

- The oracle is not only "did the last click work".
- Mature systems combine several checks:
  - route reached
  - key element visible
  - network call success or redirect pattern
  - copy or semantic invariant
  - visual diff or layout invariant where needed
  - timing and performance thresholds for critical steps

5. Self-calibration from evidence

- When a run fails, resilient systems do not jump straight to a human asking for
  the missing selector.
- They inspect trace artifacts, current DOM, network logs, and source contracts
  to repair the test plan or downgrade the failing action into a better-supported
  contract.
- The best versions of this are not just locator self-healing. They are workflow
  self-calibration.

## What authoritative industry guidance says

The sources reviewed for this repository point in a consistent direction.

- Playwright best practices emphasize user-facing or explicit contract locators,
  auto-waiting, web-first assertions, codegen for locator discovery, and trace
  viewer for CI failure diagnosis.
- Playwright locator guidance explicitly recommends role, label, text, and test
  id locators, and warns against long CSS or XPath chains.
- Playwright trace viewer guidance supports retaining structured failure evidence
  on retry instead of debugging from screenshots alone.
- Synthetic monitoring platforms such as Datadog and Checkly use scheduled real
  browser journeys, result explorers, alerts, traces, screenshots, and coverage
  views to detect regressions outside the PR path.
- Fowler's test-pyramid and consumer-driven contract guidance reinforces two
  important rules: keep only a small set of very high-value end-to-end journeys,
  and protect system evolution with narrow contracts instead of broad implicit
  assumptions.

The operational takeaway is simple:

- Weekly bug discovery should be driven by a small set of important journeys.
- Each journey should be constrained by explicit contracts.
- Failures should produce enough structured evidence to calibrate the next run.

## Why payment-like cases were expensive in this repository

The payment case exposed a gap between three different things:

1. PRD knew the business goal.
2. Weekly generation knew there was booking-related change.
3. The executable layer did not yet know the proven runtime workflow contracts.

That missing layer is why the system still needed manual help for details such
as:

- where booking really transitions into payment
- which submit button is authoritative
- the fact that payment URL is dynamic
- credit-card fields being inside a cross-origin iframe
- the iframe requiring an explicit referer navigation
- the final pay CTA living on the main page, not inside the iframe

This is the core lesson:

- PRD can tell us what should happen.
- Diff can tell us what changed.
- Only source contracts plus runtime evidence can tell us how to execute it
  robustly.

## The correct architecture for this repository

This repository already has the right building blocks. The missing step is to
connect them into one deliberate weekly bug-discovery loop.

### 1. Intent layer: PRD plus diff chooses the weekly scenarios

Keep the current weekly-diff and PRD enrichment flow. It should decide:

- which product slice changed
- which user journey is implicated
- which concerns dominate the change cluster
- what user-visible outcomes matter this week

This layer should never guess selectors or deep links.

For this repository, the current anchor is already established in
[docs/weekly-diff-case-generator.md](/Users/yu.hao/Desktop/task/e2e/docs/weekly-diff-case-generator.md).

### 2. Contract layer: WWW source resolves executable contracts

For every selected scenario, resolve an explicit contract bundle from Traveloka
WWW source:

- stable entry surface
- stable route patterns
- test ids and label contracts
- workflow step ids
- package ownership
- known app boundaries, such as booking app to payment app handoff

This repository already has the right hard constraint recorded in
[docs/traveloka-flight-booking-case-generation.md](/Users/yu.hao/Desktop/task/e2e/docs/traveloka-flight-booking-case-generation.md)
and in repository memory for WWW selector contracts.

The important upgrade is to treat these contracts as first-class generation
inputs, not only supporting notes.

### 3. Capability layer: maintain reusable journey packs

Industry systems do not regenerate complex flows from scratch every week.
Instead, they preserve reusable capability packs for high-value workflows.

For this repository, a capability pack should include:

- a proven entry method
- a proven sequence of workflow steps
- fallback locators that are still source-derived
- required assertions for each step
- known boundary conditions
- known recovery rules
- known anti-bot handling rules
- known artifact capture rules on failure

`flight-booking => payment` should be the model capability pack for this repo.
Its locked version already exists in
[docs/traveloka-flight-booking-payment-chain-lock.md](/Users/yu.hao/Desktop/task/e2e/docs/traveloka-flight-booking-payment-chain-lock.md)
and its executable proof exists in
[tests/web/traveloka-flight-booking-payment-e2e.spec.ts](/Users/yu.hao/Desktop/task/e2e/tests/web/traveloka-flight-booking-payment-e2e.spec.ts).

Weekly generation should compose from these packs instead of authoring the
entire path freehand every time.

### 4. Oracle layer: add stronger bug-detection checks

The weekly run should validate more than one end-state.

Each generated or selected scenario should attach a small oracle bundle:

- navigation oracle
  - expected route pattern
  - no unexpected restricted page
- interaction oracle
  - critical CTA visible and actionable
  - critical form chunk saved or advanced
- network oracle
  - no relevant 4xx or 5xx around the changed feature
  - expected API or redirect observed where needed
- semantic oracle
  - user-visible headings, summaries, prices, or states remain coherent
- quality oracle
  - optional screenshot or layout invariant for risky UI diffs
  - optional timing threshold for known critical steps

This matters because many weekly regressions are not total failures. They are:

- wrong redirect
- partially missing form chunk
- dead CTA
- wrong default state
- visually broken but still clickable layout

### 5. Self-calibration layer: use traces to repair the next run

This is the part the current system still lacks.

When a weekly run fails, the system should run a structured repair pass before
asking a human.

The repair pass should inspect, in order:

1. Source contract drift

- Did the relevant test id move in WWW source?
- Did the package ownership or route constant change?
- Did the component keep the same semantic label but change the surrounding DOM?

2. Runtime evidence drift

- What locator actually failed in the trace?
- Was the action blocked by iframe boundary, overlay, dialog, or scroll?
- Did a network redirect or guarded transition happen first?

3. Workflow graph drift

- Did the same journey now require one extra confirmation step?
- Did the app boundary move from one route family to another?
- Did the action need to move from frame scope back to main-page scope or the
  reverse?

4. Environment drift

- Was the failure really caused by anti-bot, auth expiry, or transient upstream
  latency?

Only after these checks fail should the system ask for human input.

This is the main distinction between useful self-calibration and naive
self-healing:

- naive self-healing repairs one broken selector
- useful self-calibration repairs the execution model

## Recommended weekly operating model

The weekly system should run in three passes, not one.

### Pass A: Select and synthesize

Input:

- last 7-day WWW diff
- PR titles and summaries
- resolved PRD links
- changed package ownership

Output:

- scenario candidates
- affected concern clusters
- required capability packs
- confidence score based on available contracts and historical pass rate

### Pass B: Execute and detect

Run three categories of checks.

1. Baseline canaries

- always run a very small number of proven high-value journeys
- examples: flight search, booking entry, booking submit to payment selection

2. Change-focused scenarios

- scenarios selected from the weekly diff and PRD context
- use the same workflow foundation but add scenario-specific oracles

3. Differential checks

- compare with prior successful run on the same journey
- compare route, DOM anchors, screenshots, timing, and console/network anomaly
  profile

### Pass C: Calibrate and classify

For each failure, classify into one of these buckets:

- product regression likely
- source contract drift likely
- runtime workflow drift likely
- environment or anti-bot likely
- flaky or inconclusive

Then take an automatic next action:

- product regression likely: raise bug candidate with trace and impacted files
- source contract drift likely: refresh contract bundle from WWW source and rerun
- runtime workflow drift likely: attempt workflow repair from trace and rerun
- environment likely: quarantine run, retry with clean state, or different slot
- flaky or inconclusive: do not file product bug until reproduced

## Concrete implementation for this repository

The shortest path is to add four concrete pieces instead of trying to build a
general autonomous QA platform in one shot.

### A. Capability registry

Add a registry that maps concern clusters to proven journey packs.

Examples:

- `flight-search-results`
- `flight-filter-airline`
- `flight-booking-contact`
- `flight-booking-payment`

Each registry entry should declare:

- owning docs
- owning executable baseline
- source packages to inspect
- stable entry method
- route expectations
- required selectors or labels
- required assertions
- repair hints

This is the missing bridge between PRD intent and executable code.

### B. Oracle registry

Add reusable oracle bundles per concern.

Examples:

- `restricted-page-not-present`
- `expected-route-family`
- `submit-causes-handoff`
- `critical-cta-visible`
- `no-fatal-console-errors`
- `no-payment-4xx-5xx`

Weekly generation should reference these by name instead of copying ad hoc
assertions into each generated file.

### C. Failure triage pipeline

After a failed weekly run, parse artifacts and emit structured triage JSON:

- failed step
- failed locator
- last successful step
- final URL
- relevant console errors
- relevant network failures
- frame context
- source packages touched by the diff
- likely failure class
- suggested repair action

This should become the input for the next-generation repair prompt, not the raw
terminal error alone.

### D. Calibration memory

Persist verified lessons back into repo-scoped memory and locked docs when the
same pattern proves stable.

Examples:

- a route migrated from one constant to another
- a CTA moved from iframe to main page
- a collapsed accordion now requires expansion first
- a specific package now owns a route previously inferred elsewhere

This converts one painful debug into future weekly resilience.

## What not to do

The repository should explicitly avoid these anti-patterns.

1. Do not let the generator invent deep links or selectors without WWW-source
   evidence.
2. Do not treat PRD as enough to write runnable browser code.
3. Do not rely on locator self-healing alone; many failures are workflow
   boundary failures.
4. Do not widen end-to-end coverage endlessly; keep a small set of valuable
   canaries and route more checks into contract or oracle layers.
5. Do not file product bugs from a single inconclusive anti-bot or auth-expired
   run.

## Practical roadmap

### Phase 1: Make weekly generation contract-first

- Introduce capability registry and oracle registry.
- Require every generated case to cite one capability pack and one oracle bundle.
- Keep current locked docs as authority for the first packs.

Current repository status:

- A standalone capability registry now exists in `scripts/lib/weekly-capability-registry.ts`.
- A standalone oracle registry now exists in `scripts/lib/weekly-oracle-registry.ts`.
- A standalone planner now exists in `scripts/plan-weekly-quality-scenarios.ts`.
- The planner can now read `generated-cases/weekly-diff/latest/summary.json` directly.
- The shell weekly workflow now runs planning automatically after generation as a non-blocking enhancement.
- The locked TypeScript workflow also runs planning inside the existing generate stage as a non-blocking enhancement.
- A standalone quality summary notifier now exists in `scripts/send-weekly-quality-notification.ts`.

### Phase 2: Add artifact-based triage

- Always retain trace on retry or failure for weekly runs.
- Parse trace metadata, final URL, frame info, console, and key network failures.
- Emit machine-readable triage summaries beside the HTML report.

Current repository status:

- A standalone triage module now exists in `scripts/lib/weekly-failure-triage.ts`.
- A standalone CLI now exists in `scripts/triage-weekly-failures.ts`.
- The shell weekly workflow now runs triage automatically after Playwright execution as a non-blocking enhancement.
- The locked TypeScript workflow also runs triage inside the existing run stage, including after failed runs.
- The triage layer remains additive and does not intercept current Playwright or generate semantics.
- The shell and locked workflows can now send a second Lark summary for quality planning and failure triage artifacts.
- A capability feedback overlay now exists in `generated-cases/weekly-diff/weekly-capability-feedback.json` and is produced by `scripts/calibrate-weekly-quality.ts`.
- The planner now reads that overlay to keep unstable packs in scope on later weekly runs.
- The shell and locked workflows can now trigger a scoped rerun of impacted baseline specs after triage.
- Verified rerun lessons can now be promoted into persistent repo learning memory at `config/weekly-learning-memory.json` via `scripts/promote-weekly-learning.ts`.
- Capability packs now read both the transient overlay and the promoted learning memory, so repeated successful repair patterns become durable repair hints.

### Phase 3: Add automatic repair loop

- On source-contract drift, re-read WWW source and regenerate locators or route
  expectations from the owning pack.
- On workflow drift, patch the selected journey step model and rerun once.
- On environment drift, retry with clean state and rate-limited schedule.

### Phase 4: Add weekly synthetic canary tier

- Keep a very small fixed set of always-on high-value browser checks.
- Separate them from change-focused experimental checks.
- Use them to distinguish systemic production breakage from scenario-specific
  regressions.

## Success criteria

This effort is working only if these metrics improve.

- fewer weekly failures that require manual selector coaching
- more failures automatically classified before human review
- higher share of bug reports backed by route, trace, console, and network
  evidence
- fewer false product bugs caused by anti-bot or auth drift
- faster time from first weekly failure to stable reusable capability pack

## Final position for this repository

If the goal is weekly automatic bug discovery, the correct target is not
"generate more Playwright files from PRD".

The correct target is:

- PRD for intent
- diff for prioritization
- WWW source for contracts
- capability packs for execution
- oracle bundles for bug detection
- traces and artifacts for self-calibration

That is the industry pattern most compatible with this repository and with the
payment-chain lesson already learned here.