#!/usr/bin/env bash
# =============================================================================
# Android Weekday E2E — Scheduled Runner
# Runs every weekday at 11:00 AM (injected via crontab)
#
# Full pipeline:
#   1. Start emulator if not running
#   2. Wait for device
#   3. npm run android:workflow:full  (diff → generate → run → fix → notify → memory)
#   4. Open HTML report in browser (local runs only)
#
# Logs: /Users/yu.hao/Desktop/task/e2e/logs/cron-android.log
# =============================================================================
set -euo pipefail

E2E_DIR="/Users/yu.hao/Desktop/task/e2e"
AVD_NAME="Pixel7_API37"
EMULATOR="$HOME/Library/Android/sdk/emulator/emulator"
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
LOG_DIR="$E2E_DIR/logs"
HTML_REPORT="$E2E_DIR/test-results/android/results.html"
RUN_LOG="$LOG_DIR/run-$(date +%Y%m%d-%H%M).log"

mkdir -p "$LOG_DIR"

echo "========================================"
echo " Android E2E  —  $(date '+%Y-%m-%d %H:%M')"
echo "========================================"

cd "$E2E_DIR"

# ── 1. Ensure emulator is running ────────────────────────────────────────────
DEVICE_ONLINE=$("$ADB" devices 2>/dev/null | grep -c "emulator.*device" || true)

if [ "$DEVICE_ONLINE" -eq 0 ]; then
  echo "[1/4] Starting emulator: $AVD_NAME …"
  nohup "$EMULATOR" -avd "$AVD_NAME" -no-window -no-audio \
    -gpu swiftshader_indirect > "$LOG_DIR/emulator.log" 2>&1 &

  echo "      Waiting for device (up to 120s)…"
  "$ADB" wait-for-device
  "$ADB" shell input keyevent 82   # unlock screen

  # Extra wait for boot animation to finish
  for i in $(seq 1 24); do
    BOOT=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "0")
    [ "$BOOT" = "1" ] && break
    sleep 5
  done
  echo "      Device ready."
else
  echo "[1/4] Emulator already running — skipping launch."
fi

# ── 2. Run full workflow ──────────────────────────────────────────────────────
echo "[2/4] Running android:workflow:full …"
npm run android:workflow:full 2>&1 | tee "$RUN_LOG"
EXIT_CODE=${PIPESTATUS[0]}

# ── 3. Keep only last 14 run logs ────────────────────────────────────────────
echo "[3/4] Pruning old logs …"
ls -t "$LOG_DIR"/run-*.log 2>/dev/null | tail -n +15 | xargs rm -f || true

# ── 4. Open HTML report (only when running interactively / not headless) ──────
echo "[4/4] Report written to: $HTML_REPORT"
if [ -t 1 ] && [ -f "$HTML_REPORT" ]; then
  open "$HTML_REPORT"
fi

echo "========================================"
echo " Done. Exit code: $EXIT_CODE"
echo "========================================"
exit $EXIT_CODE
