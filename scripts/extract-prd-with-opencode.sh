#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <prd-url> [output-md-path]" >&2
  exit 1
fi

PRD_URL="$1"
OUTPUT_PATH="${2:-/tmp/opencode-prd-$(date +%Y%m%d-%H%M%S).md}"
WORK_DIR="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode is not installed or not on PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

PROMPT=$(cat <<EOF
Read the PRD at this URL: ${PRD_URL}

Create exactly one markdown file at: ${OUTPUT_PATH}

Requirements for the markdown file:
- Title: PRD Extraction
- Include sections: Source URL, Access Status, Key Requirements, Risks, Test Implications, Open Questions.
- If the page is inaccessible, blocked, or lacks real PRD content, still create the file and state that clearly under Access Status and Open Questions.
- Keep the content concise and structured for later automated test-case generation.
- Do not create any other files.
EOF
)

cd "$WORK_DIR"
opencode run --dangerously-skip-permissions "$PROMPT" >/dev/null

if [[ ! -f "$OUTPUT_PATH" ]]; then
  echo "opencode did not create the expected markdown file: $OUTPUT_PATH" >&2
  exit 1
fi

echo "$OUTPUT_PATH"