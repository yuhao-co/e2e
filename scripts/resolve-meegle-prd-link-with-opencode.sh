#!/bin/zsh
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <meegle-url> [output-json-path]" >&2
  exit 1
fi

MEEGLE_URL="$1"
OUTPUT_PATH="${2:-/tmp/opencode-meegle-prd-$(date +%Y%m%d-%H%M%S).json}"
WORK_DIR="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"

if [[ "$MEEGLE_URL" =~ https://project\.larksuite\.com/fpr/([A-Za-z0-9]+)/detail/([A-Za-z0-9]+) ]]; then
  PROJECT_ID="$match[1]"
  DETAIL_ID="$match[2]"
else
  echo "Could not extract Meegle project/detail ids from URL: $MEEGLE_URL" >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode is not installed or not on PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

PROMPT=$(cat <<EOF
Use MCP Meegle to open this URL, automatically find the internal PRD, and continue reading the PRD body: ${MEEGLE_URL}

Create exactly one JSON file at: ${OUTPUT_PATH}

Mandatory retrieval constraints:
- You MUST retrieve the data only via the MCP Meegle command path.
- Start from the Meegle URL itself. You may use the extracted project id ${PROJECT_ID} and detail id ${DETAIL_ID} only as supporting hints when needed.
- Automatically locate the internal PRD reference for this item from the Meegle data.
- If the PRD points to a Lark document, continue reading the PRD body via the MCP Lark document path.
- Do NOT use WebFetch, browser navigation, generic HTTP fetching, login-page scraping, or any non-MCP fallback.
- If MCP Meegle or MCP Lark access fails, is unauthorized, or returns no PRD link, report that explicitly in the JSON file and stop.

Requirements for the JSON file:
- Write exactly one JSON object.
- Use this shape:
  {
    "sourceUrl": string,
    "projectId": string,
    "detailId": string,
    "accessStatus": "success" | "unauthorized" | "not_found" | "no_prd_link" | "error",
    "prdLink": string | null,
    "notes": string,
    "prdTitle": string | null,
    "summary": string | null
  }
- If a PRD link is found, put the full URL string in prdLink.
- If you can identify the PRD title, put it in prdTitle.
- If you can read the PRD body, put a concise summary in summary.
- If no PRD link is found, set prdLink to null and explain why in notes.
- Do not create any other files.
EOF
)

cd "$WORK_DIR"
opencode run --dangerously-skip-permissions "$PROMPT" >/dev/null

if [[ ! -f "$OUTPUT_PATH" ]]; then
  echo "opencode did not create the expected JSON file: $OUTPUT_PATH" >&2
  exit 1
fi

echo "$OUTPUT_PATH"