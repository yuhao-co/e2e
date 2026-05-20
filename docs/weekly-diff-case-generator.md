# Weekly Diff Case Generator

This project can generate candidate test updates from the last 7 days of `origin/master` changes in a local git repository.

The generator is local-first:

- it runs on your macOS machine;
- it can inspect this repository or another local product repository;
- it can also clone a remote repository URL into a local cache automatically;
- it writes markdown and JSON summaries plus optional draft spec files under `generated-cases/weekly-diff/`.

For flight-related changes, the generator now also derives a canonical workflow target URL plus source hints from the changed file paths. This keeps weekly draft cases aligned with the shared Traveloka flight workflow instead of relying on an ad hoc prompt only.

Current working mode for this repo is flight-first. The local wrapper script defaults to `--focus-domain flight-search`, so weekly runs ignore i18n, android, and generic candidates unless you explicitly override that behavior.

If you also want the generator to materialize an executable Playwright case under `tests/web`, set `EMIT_WEB_SPEC=1` in the wrapper environment or pass `--emit-web-spec` to the script directly.

## Manual run

From the e2e repository root:

```bash
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

- `summary.md`: human-readable review report
- `summary.json`: structured candidate data
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

## Scheduling on macOS

1. Copy `docs/launchd/com.traveloka.e2e.weekly-diff-generator.plist` to `~/Library/LaunchAgents/`.
2. Either replace `TARGET_REPO_PATH` with the local application repository you want to inspect, or set `TARGET_REPO_URL=https://github.com/traveloka/www` and keep a local cache directory.
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