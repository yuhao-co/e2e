# Weekly Diff Case Generator

This project can generate candidate test updates from the last 7 days of `origin/master` changes in the target product repository.

The generator is remote-www-first for this repo:

- it runs on your macOS machine;
- by default the wrapper inspects `https://github.com/traveloka/www` through a local cache;
- it can still inspect another local product repository if you explicitly pass `TARGET_REPO_PATH` or `--repo-path`;
- it writes a structured summary plus optional draft spec files under `generated-cases/weekly-diff/`.

For flight-related changes, the generator now also derives a canonical workflow target URL plus source hints from the changed file paths. This keeps weekly draft cases aligned with the shared Traveloka flight workflow instead of relying on an ad hoc prompt only.

Current working mode for this repo is flight-first. The local wrapper script defaults to `https://github.com/traveloka/www` plus `--focus-domain flight-search`, so weekly runs inspect Traveloka WWW flight changes unless you explicitly override that behavior.

For `flight-booking => payment` related changes, the generator must also pull locked local evidence from [docs/traveloka-flight-booking-payment-chain-lock.md](/Users/yu.hao/Desktop/task/e2e/docs/traveloka-flight-booking-payment-chain-lock.md) and the proven executable example [tests/web/traveloka-flight-booking-payment-e2e.spec.ts](/Users/yu.hao/Desktop/task/e2e/tests/web/traveloka-flight-booking-payment-e2e.spec.ts). This is a hard constraint for payment-sensitive weekly booking generation in this repository.

If you also want the generator to materialize an executable Playwright case under `tests/web`, set `EMIT_WEB_SPEC=1` in the wrapper environment or pass `--emit-web-spec` to the script directly.

## Manual run

From the e2e repository root:

```bash
TARGET_REPO_PATH=/path/to/your/local/product/repo \
npm run generate:weekly-diff-cases -- \
  --repo-path /path/to/your/local/product/repo \
  --focus-domain flight-search \
  --emit-web-spec \
  --base-ref origin/master \
  --since-days 7 \
  --output-dir generated-cases/weekly-diff
```

Directly from the Traveloka WWW repository URL:

```bash
npm run generate:weekly-diff-cases -- \
  --repo-url https://github.com/traveloka/www \
  --repo-cache-dir .cache/weekly-diff-repos \
  --focus-domain flight-search \
  --emit-web-spec \
  --base-ref origin/master \
  --since-days 7 \
  --output-dir generated-cases/weekly-diff
```

Dry run:

```bash
npm run generate:weekly-diff-cases -- \
  --repo-path /path/to/your/local/product/repo \
  --focus-domain flight-search \
  --base-ref origin/master \
  --since-days 7 \
  --dry-run
```

## What it produces

For each weekly run, the script creates a timestamped folder containing:

- `summary.json`: structured candidate data, including a compact markdown summary string
- draft spec files for supported domains, if available
- optional executable web spec files under `tests/web/` when `--emit-web-spec` is enabled

Current first-pass routing supports these domains, but the wrapper currently defaults to `flight-search` only:

- `flight-search`
- `web-i18n`
- `android-home`
- fallback `generic-web`

The first-pass behavior is intentionally conservative:

- prefer modifying existing tests when a domain already has specs
- only generate a new draft spec where the repo already has a stable template path
- keep unknown diffs as review items instead of fabricating low-confidence tests

## Meegle PRD Link Flow

Recent validation for Traveloka WWW PR summaries confirmed this PRD-link chain works end to end:

1. Detect a Meegle work-item URL in the PR summary, for example `https://project.larksuite.com/fpr/<project-id>/detail/<detail-id>`.
2. Route that URL through `scripts/resolve-meegle-prd-link-with-opencode.sh`.
3. Let `opencode` use MCP Meegle to open the URL directly, locate the internal `PRD Link`, and return a normalized JSON payload.
4. If the internal PRD points to a Lark doc, treat that resolved link as the canonical PRD URL and return to the existing Lark PRD flow.
5. When markdown output is needed, pass the resolved Lark PRD URL into `scripts/extract-prd-with-opencode.sh` to read the PRD body through MCP Lark and write a structured markdown file.

Practical notes:

- The resolved JSON payload includes `prdLink`, `prdTitle`, `summary`, and `accessStatus`.
- The tested Meegle prompt should start from the URL itself, not from a hand-constructed project/detail lookup flow.
- The current validated path is: Meegle URL -> MCP Meegle resolves internal PRD -> Lark PRD link -> MCP Lark reads PRD body.
- If the Meegle item is readable but the internal PRD is missing, return `no_prd_link` instead of guessing.
- If either MCP Meegle or MCP Lark is unauthorized, preserve that status in the JSON payload and stop the chain there.

## Scheduling on macOS

1. Copy `docs/launchd/com.traveloka.e2e.weekly-diff-generator.plist` to `~/Library/LaunchAgents/`.
2. By default the wrapper already targets `TARGET_REPO_URL=https://github.com/traveloka/www`. Only replace it with `TARGET_REPO_PATH` when you intentionally want another local product repository.
3. Leave `FOCUS_DOMAIN=flight-search` as-is if you only want flight weekly generation. Clear or replace it only when you intentionally want another domain.
4. Adjust the time if needed. The template is set to Friday 21:00 local time.
5. Load the job:

```bash
launchctl unload ~/Library/LaunchAgents/com.traveloka.e2e.weekly-diff-generator.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.traveloka.e2e.weekly-diff-generator.plist
```

6. Confirm the job is loaded:

```bash
launchctl list | grep weekly-diff-generator
```

Logs are written to `logs/weekly-diff-generator.log` inside this repository.

## Current limitations

- The diff router is path-and-keyword based. It does not yet understand application ownership with high precision.
- Only the flight domain currently emits a draft spec file automatically.
- The generator does not auto-commit or open PRs yet; it only writes local artifacts.
- If the target repository is unavailable or your machine is off on Friday night, nothing runs.
- The first remote run must be able to clone the repository over the network; later runs use the local cache plus `git fetch`.
- Flight target inference is still conservative: it maps known results/filter paths to a stable desktop results URL first, rather than discovering arbitrary deep links.

<!-- AUTO_PROMOTED_LESSONS_START -->
## Verified Stable Lessons
- No promoted lessons yet.
<!-- AUTO_PROMOTED_LESSONS_END -->
