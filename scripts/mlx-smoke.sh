#!/usr/bin/env bash
# Smoke-test the local MLX VLM server with an OpenAI-style chat completion call.
set -euo pipefail
HOST="${MIDSCENE_MLX_HOST:-127.0.0.1}"
PORT="${MIDSCENE_MLX_PORT:-8080}"
MODEL="${MIDSCENE_MLX_MODEL:-mlx-community/Qwen2.5-VL-7B-Instruct-4bit}"

echo "[smoke] GET /v1/models"
curl -fsS "http://${HOST}:${PORT}/v1/models" | head -c 400; echo

echo "[smoke] POST /v1/chat/completions"
curl -fsS "http://${HOST}:${PORT}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${MODEL}\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: pong\"}]}" \
  | head -c 800; echo
