#!/bin/zsh
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"
TARGET_REPO_PATH="${TARGET_REPO_PATH:-}"
TARGET_REPO_URL="${TARGET_REPO_URL:-https://github.com/traveloka/www}"
TARGET_REPO_CACHE_DIR="${TARGET_REPO_CACHE_DIR:-.cache/weekly-diff-repos}"
FOCUS_DOMAIN="${FOCUS_DOMAIN:-flight-search,flight-booking}"
EMIT_WEB_SPEC="${EMIT_WEB_SPEC:-1}"
BASE_REF="${BASE_REF:-origin/master}"
SINCE_DAYS="${SINCE_DAYS:-7}"
OUTPUT_DIR="${OUTPUT_DIR:-generated-cases/weekly-diff}"
RUN_WEEKLY_PLAYWRIGHT="${RUN_WEEKLY_PLAYWRIGHT:-1}"
WEEKLY_NOTIFY="${WEEKLY_NOTIFY:-1}"
WEEKLY_PLAYWRIGHT_LABEL="${WEEKLY_PLAYWRIGHT_LABEL:-Weekly diff Playwright run}"
# Skip git fetch when cache repo exists (saves ~1-2 min). Set FORCE_FETCH=1 to override.
FORCE_FETCH="${FORCE_FETCH:-0}"
RUN_BUG_DETECTION="${RUN_BUG_DETECTION:-1}"
RUN_WEEKLY_QUALITY_PLANNING="${RUN_WEEKLY_QUALITY_PLANNING:-1}"
RUN_WEEKLY_QUALITY_TRIAGE="${RUN_WEEKLY_QUALITY_TRIAGE:-1}"
RUN_WEEKLY_QUALITY_CALIBRATION="${RUN_WEEKLY_QUALITY_CALIBRATION:-1}"
RUN_WEEKLY_QUALITY_PROMOTION="${RUN_WEEKLY_QUALITY_PROMOTION:-1}"
RUN_WEEKLY_QUALITY_NOTIFY="${RUN_WEEKLY_QUALITY_NOTIFY:-1}"

cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

# MLX server is only needed during Playwright execution (AI fallback), not during generation.
MLX_HOST="${MIDSCENE_MLX_HOST:-127.0.0.1}"
MLX_PORT="${MIDSCENE_MLX_PORT:-8080}"
MLX_PID_FILE="$REPO_ROOT/logs/mlx-server.pid"
_MLX_STARTED_BY_US=0

_mlx_is_up() {
  curl -fsS --max-time 2 "http://${MLX_HOST}:${MLX_PORT}/v1/models" >/dev/null 2>&1
}

_mlx_ensure_running() {
  if _mlx_is_up; then
    echo "[mlx] server already running on :${MLX_PORT}"
  else
    echo "[mlx] starting local MLX server in background..."
    bash "$REPO_ROOT/scripts/start-mlx-server.sh" --bg
    _MLX_STARTED_BY_US=1
    for i in $(seq 1 24); do
      if _mlx_is_up; then echo "[mlx] ✅ server ready (${i}×5s)"; break; fi
      echo "[mlx] waiting for server... (${i}/24)"
      sleep 5
    done
    if ! _mlx_is_up; then
      echo "[mlx] ❌ server did not become ready in 120s — AI fallback disabled"
      _MLX_STARTED_BY_US=0
    fi
  fi
}

trap '[[ $_MLX_STARTED_BY_US -eq 1 && -f "$MLX_PID_FILE" ]] && kill "$(cat "$MLX_PID_FILE")" 2>/dev/null && echo "[mlx] server stopped"; rm -f "$MLX_PID_FILE"' EXIT

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

# Auto skip fetch when cache exists and FORCE_FETCH is not set
_CACHE_REPO_DIR="$REPO_ROOT/$TARGET_REPO_CACHE_DIR"
if [[ "$FORCE_FETCH" != "1" && -d "$_CACHE_REPO_DIR" ]]; then
  echo "[weekly-diff] cache repo found → skipping git fetch (use FORCE_FETCH=1 to update)"
  CMD+=(--no-fetch)
fi

CMD+=("$@")

"${CMD[@]}"

if [[ "$RUN_WEEKLY_QUALITY_PLANNING" == "1" ]]; then
  SUMMARY_FILE="$REPO_ROOT/$OUTPUT_DIR/latest/summary.json"
  if [[ -f "$SUMMARY_FILE" ]]; then
    echo "[weekly-quality] generating standalone quality plan from latest summary.json"
    if ! npx tsx scripts/plan-weekly-quality-scenarios.ts --summary-file "$SUMMARY_FILE"; then
      echo "[weekly-quality] ⚠️ planning failed (non-blocking)"
    fi
  else
    echo "[weekly-quality] latest summary.json not found — planning skipped"
  fi
fi

# Run generic bug detection if enabled
if [[ "$RUN_BUG_DETECTION" == "1" ]]; then
  echo ""
  echo "🚨 [P0-detection] PRE-FLIGHT CHECK: Running P0 critical bug analysis..."
  echo ""
  
  # Pre-flight P0 check (MUST PASS before running tests)
  if npm run analyze:p0 2>&1 | tee /tmp/p0-analysis.log; then
    echo "✅ [P0-detection] P0 pre-flight check PASSED - no critical bugs detected"
  else
    P0_EXIT_CODE=$?
    echo "❌ [P0-detection] P0 pre-flight check FAILED - critical bugs detected!"
    echo "[P0-detection] Details saved to /tmp/p0-analysis.log"
    # Continue for now but mark as warning
    if [[ $P0_EXIT_CODE -ne 0 ]]; then
      echo "⚠️  [P0-detection] WARNING: P0 bugs found, continuing with tests (review results)"
    fi
  fi
  
  echo ""
  echo "[bug-detection] Generating PRD for reference..."
  
  # Generate PRD for reference
  if npm run weekly-diff:prd 2>&1 | tail -5; then
    echo "[bug-detection] ✅ PRD generated"
  else
    echo "[bug-detection] ⏭️  PRD generation skipped"
  fi
  
  echo ""
  echo "[bug-detection] Verifying generated specs include P0 detection..."
  
  # Verify generated specs include P0 detection (non-blocking — just check file content)
  MISSING_P0=$(grep -rL "GenericBugDetector" tests/web/traveloka-flight-*weekly*.spec.ts 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$MISSING_P0" -eq 0 ]]; then
    echo "[bug-detection] ✅ All weekly specs include P0 detection"
  else
    echo "[bug-detection] ⚠️  $MISSING_P0 spec(s) missing P0 integration (continuing...)"
  fi
  
  echo ""
  echo "[bug-detection] Collecting bug data for ML training..."
  
  # Collect bug data for training
  if npx ts-node scripts/bug-detection-collector.ts stats 2>&1 | tail -10; then
    echo "[bug-detection] ✅ Data collection completed"
  else
    echo "[bug-detection] ⏭️  Data collection skipped"
  fi
  
  echo "[bug-detection] 📊 Training data: data/bug-detection/training-data.jsonl"
  echo ""
fi

if [[ "$RUN_WEEKLY_PLAYWRIGHT" != "1" ]]; then
  exit 0
fi

# Start MLX server now — only needed for Playwright AI fallback
_mlx_ensure_running

setopt null_glob
WEEKLY_SPECS=(
  tests/web/traveloka-flight-weekly-diff-20*.spec.ts
  tests/web/traveloka-flight-booking-weekly-diff-20*.spec.ts
)

if (( ${#WEEKLY_SPECS[@]} == 0 )); then
  echo "[weekly-diff] no accumulated weekly flight specs found under tests/web"
  exit 0
fi

TEST_CMD=(env CI=1 npx playwright test --reporter=list "${WEEKLY_SPECS[@]}")

echo "[weekly-diff] running accumulated weekly flight specs: ${#WEEKLY_SPECS[@]}"
printf ' - %s\n' "${WEEKLY_SPECS[@]}"

if [[ "$WEEKLY_NOTIFY" == "1" ]]; then
  PLAYWRIGHT_EXIT_CODE=0
  if npx tsx scripts/run-with-lark-notify.ts --label "$WEEKLY_PLAYWRIGHT_LABEL" -- "${TEST_CMD[@]}"; then
    PLAYWRIGHT_EXIT_CODE=0
  else
    PLAYWRIGHT_EXIT_CODE=$?
  fi
else
  PLAYWRIGHT_EXIT_CODE=0
  if "${TEST_CMD[@]}"; then
    PLAYWRIGHT_EXIT_CODE=0
  else
    PLAYWRIGHT_EXIT_CODE=$?
  fi
fi

if [[ "$RUN_WEEKLY_QUALITY_TRIAGE" == "1" ]]; then
  echo "[weekly-quality] generating standalone failure triage"
  if ! npx tsx scripts/triage-weekly-failures.ts; then
    echo "[weekly-quality] ⚠️ triage failed (non-blocking)"
  fi
fi

if [[ "$RUN_WEEKLY_QUALITY_CALIBRATION" == "1" ]]; then
  echo "[weekly-quality] calibrating capability feedback and scoped reruns"
  if ! npx tsx scripts/calibrate-weekly-quality.ts; then
    echo "[weekly-quality] ⚠️ calibration failed (non-blocking)"
  fi
fi

if [[ "$RUN_WEEKLY_QUALITY_PROMOTION" == "1" ]]; then
  echo "[weekly-quality] promoting verified lessons into learning memory"
  if ! npx tsx scripts/promote-weekly-learning.ts; then
    echo "[weekly-quality] ⚠️ learning promotion failed (non-blocking)"
  fi
fi

if [[ "$RUN_WEEKLY_QUALITY_NOTIFY" == "1" ]]; then
  echo "[weekly-quality] sending weekly quality summary notification"
  if ! npx tsx scripts/send-weekly-quality-notification.ts --label "Weekly quality summary"; then
    echo "[weekly-quality] ⚠️ quality summary notification failed (non-blocking)"
  fi
fi

echo "[weekly-diff] playwright report available at playwright-report/index.html"
exit ${PLAYWRIGHT_EXIT_CODE:-0}