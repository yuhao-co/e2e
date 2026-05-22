#!/bin/zsh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"
TARGET_REPO_PATH="${TARGET_REPO_PATH:-}"
TARGET_REPO_URL="${TARGET_REPO_URL:-https://github.com/traveloka/www}"
TARGET_REPO_CACHE_DIR="${TARGET_REPO_CACHE_DIR:-.cache/weekly-diff-repos}"
FOCUS_DOMAIN="${FOCUS_DOMAIN:-flight-search}"
EMIT_WEB_SPEC="${EMIT_WEB_SPEC:-1}"
BASE_REF="${BASE_REF:-origin/master}"
SINCE_DAYS="${SINCE_DAYS:-7}"
OUTPUT_DIR="${OUTPUT_DIR:-generated-cases/weekly-diff}"
RUN_WEEKLY_PLAYWRIGHT="${RUN_WEEKLY_PLAYWRIGHT:-1}"
WEEKLY_NOTIFY="${WEEKLY_NOTIFY:-1}"
WEEKLY_PLAYWRIGHT_LABEL="${WEEKLY_PLAYWRIGHT_LABEL:-Weekly diff Playwright run}"

cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

CMD=(
  npx tsx scripts/generate-cases-from-weekly-diff.ts
  --base-ref "$BASE_REF"
  --since-days "$SINCE_DAYS"
  --output-dir "$OUTPUT_DIR"
)

if [[ -n "$FOCUS_DOMAIN" ]]; then
  CMD+=(--focus-domain "$FOCUS_DOMAIN")
fi

if [[ "$EMIT_WEB_SPEC" == "1" ]]; then
  CMD+=(--emit-web-spec)
fi

if [[ -n "$TARGET_REPO_URL" ]]; then
  CMD+=(--repo-url "$TARGET_REPO_URL" --repo-cache-dir "$TARGET_REPO_CACHE_DIR")
else
  CMD+=(--repo-path "$TARGET_REPO_PATH")
fi

CMD+=("$@")

"${CMD[@]}"

if [[ "$RUN_WEEKLY_PLAYWRIGHT" != "1" ]]; then
  exit 0
fi

setopt null_glob
WEEKLY_SPECS=(tests/web/traveloka-flight-weekly-diff-20*.spec.ts)

if (( ${#WEEKLY_SPECS[@]} == 0 )); then
  echo "[weekly-diff] no accumulated weekly flight specs found under tests/web"
  exit 0
fi

TEST_CMD=(npx playwright test "${WEEKLY_SPECS[@]}")

echo "[weekly-diff] running accumulated weekly flight specs: ${#WEEKLY_SPECS[@]}"
printf ' - %s\n' "${WEEKLY_SPECS[@]}"

if [[ "$WEEKLY_NOTIFY" == "1" ]]; then
  npx tsx scripts/run-with-lark-notify.ts --label "$WEEKLY_PLAYWRIGHT_LABEL" -- "${TEST_CMD[@]}"
else
  "${TEST_CMD[@]}"
fi

echo "[weekly-diff] playwright report available at playwright-report/index.html"