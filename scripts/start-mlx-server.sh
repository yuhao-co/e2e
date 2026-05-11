#!/usr/bin/env bash
# Start the local mlx-vlm OpenAI-compatible server with Qwen2.5-VL-7B-Instruct-4bit.
# Usage:
#   scripts/start-mlx-server.sh           # foreground
#   scripts/start-mlx-server.sh --bg      # background, log -> logs/mlx-server.log
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${ROOT_DIR}/.venv/bin/python"
MODEL="${MIDSCENE_MLX_MODEL:-mlx-community/Qwen2.5-VL-7B-Instruct-4bit}"
HOST="${MIDSCENE_MLX_HOST:-127.0.0.1}"
PORT="${MIDSCENE_MLX_PORT:-8080}"

if [[ ! -x "${PY}" ]]; then
  echo "[mlx] venv python not found at ${PY}; run setup first." >&2
  exit 1
fi

mkdir -p "${ROOT_DIR}/logs"
LOG_FILE="${ROOT_DIR}/logs/mlx-server.log"

echo "[mlx] model=${MODEL}"
echo "[mlx] listening on http://${HOST}:${PORT}"
echo "[mlx] log file: ${LOG_FILE}"

CMD=("${PY}" -m mlx_vlm.server --model "${MODEL}" --host "${HOST}" --port "${PORT}")

if [[ "${1:-}" == "--bg" ]]; then
  nohup "${CMD[@]}" >"${LOG_FILE}" 2>&1 &
  PID=$!
  echo "${PID}" > "${ROOT_DIR}/logs/mlx-server.pid"
  echo "[mlx] started in background (pid=${PID})"
else
  exec "${CMD[@]}" 2>&1 | tee "${LOG_FILE}"
fi
