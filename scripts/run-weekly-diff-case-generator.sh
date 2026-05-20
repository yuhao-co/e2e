#!/bin/zsh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"
TARGET_REPO_PATH="${TARGET_REPO_PATH:-$REPO_ROOT}"
TARGET_REPO_URL="${TARGET_REPO_URL:-}"
TARGET_REPO_CACHE_DIR="${TARGET_REPO_CACHE_DIR:-.cache/weekly-diff-repos}"
FOCUS_DOMAIN="${FOCUS_DOMAIN:-flight-search}"
EMIT_WEB_SPEC="${EMIT_WEB_SPEC:-0}"
BASE_REF="${BASE_REF:-origin/master}"
SINCE_DAYS="${SINCE_DAYS:-7}"
OUTPUT_DIR="${OUTPUT_DIR:-generated-cases/weekly-diff}"

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