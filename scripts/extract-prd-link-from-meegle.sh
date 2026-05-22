#!/bin/zsh
# extract-prd-link-from-meegle.sh
# 
# Purpose: Extract PRD Link field from a Meegle work item
# 
# Usage: extract-prd-link-from-meegle.sh <meegle-url> [output-path]
# 
# This script:
# 1. Opens the Meegle work item using MCP Meegle
# 2. Reads the "PRD Link" field
# 3. Returns only the link value to stdout
# 4. Saves the raw response to output-path (optional, for debugging)

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <meegle-url> [output-json-path]" >&2
  exit 1
fi

MEEGLE_URL="$1"
OUTPUT_PATH="${2:-/tmp/opencode-meegle-prd-link-$(date +%Y%m%d-%H%M%S).json}"
WORK_DIR="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"

# Validate Meegle URL format
if [[ "$MEEGLE_URL" =~ https://project\.larksuite\.com/fpr/([A-Za-z0-9]+)/detail/([A-Za-z0-9]+) ]]; then
  PROJECT_ID="$match[1]"
  DETAIL_ID="$match[2]"
else
  echo "❌ Invalid Meegle URL format: $MEEGLE_URL" >&2
  echo "Expected: https://project.larksuite.com/fpr/<project-id>/detail/<detail-id>" >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "❌ opencode is not installed or not on PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

PROMPT=$(cat <<EOF
Use MCP Meegle to open this Lark work item and extract the PRD Link field value: ${MEEGLE_URL}

Create exactly one JSON file at: ${OUTPUT_PATH}

Mandatory retrieval constraints:
- You MUST use only the MCP Meegle command path to access the work item.
- Extract project id: ${PROJECT_ID}
- Extract detail id: ${DETAIL_ID}
- Find the field named "PRD Link" or similar (may be labeled as "PRD", "Documentation", or "Link")
- Return ONLY the URL value of that field (not field name, not metadata)
- Do NOT use WebFetch, browser navigation, or any non-MCP fallback.
- If MCP Meegle access fails or the field is not found, report that in the JSON file.

JSON file requirements:
{
  "sourceUrl": string,           // The Meegle URL you opened
  "projectId": string,            // Project ID extracted from URL
  "detailId": string,             // Detail ID extracted from URL
  "status": "success" | "not_found" | "error" | "unauthorized",
  "prdLink": string | null,       // The PRD Link field value (URL only, or null if not found)
  "fieldName": string | null,     // Name of the field where PRD link was found (for reference)
  "notes": string                 // Any additional context or error details
}

If PRD Link field is found, put the complete URL in prdLink.
If not found, set prdLink to null and explain why in notes.
Do not create any other files.
EOF
)

cd "$WORK_DIR"
opencode run --dangerously-skip-permissions "$PROMPT" >/dev/null

if [[ ! -f "$OUTPUT_PATH" ]]; then
  echo "❌ opencode did not create the expected JSON file: $OUTPUT_PATH" >&2
  exit 1
fi

# Extract and return the PRD link
if jq empty "$OUTPUT_PATH" 2>/dev/null; then
  PRDLINK=$(jq -r '.prdLink // empty' "$OUTPUT_PATH")
  if [[ -n "$PRDLINK" && "$PRDLINK" != "null" ]]; then
    echo "✅ Found PRD Link in Meegle work item" >&2
    echo "$PRDLINK"
    exit 0
  else
    STATUS=$(jq -r '.status // "unknown"' "$OUTPUT_PATH")
    NOTES=$(jq -r '.notes // ""' "$OUTPUT_PATH")
    echo "❌ PRD Link not found (status: $STATUS)" >&2
    if [[ -n "$NOTES" ]]; then
      echo "   Notes: $NOTES" >&2
    fi
    exit 1
  fi
else
  echo "❌ Output file is not valid JSON: $OUTPUT_PATH" >&2
  exit 1
fi
