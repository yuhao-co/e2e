#!/bin/zsh
# resolve-prd-from-github-context.sh
# 
# Purpose: Extract PRD link from GitHub PR context
# 
# The PR description may contain:
# 1. Direct Lark document links: https://project.larksuite.com/docs/... or https://larksuite.com/docs/...
# 2. Meegle work item links: https://project.larksuite.com/fpr/.../detail/...
# 3. No PRD reference at all
#
# This script detects the link type and resolves it to a PRD document URL

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <github-pr-url-or-description>" >&2
  echo "" >&2
  echo "Extracts PRD link from GitHub PR context and outputs the resolved PRD document URL." >&2
  exit 1
fi

GITHUB_CONTEXT="$1"
WORK_DIR="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"

# ============ PATTERN DETECTION ============

# Pattern 1: Direct Lark document link (https://project.larksuite.com/docs/... or https://larksuite.com/docs/...)
if [[ "$GITHUB_CONTEXT" =~ (https://project\.larksuite\.com/docs/[A-Za-z0-9]+|https://larksuite\.com/docs/[A-Za-z0-9]+) ]]; then
  PRD_LINK="${match[1]}"
  echo "$PRD_LINK"
  exit 0
fi

# Pattern 2: Meegle work item link (https://project.larksuite.com/fpr/.../detail/...)
if [[ "$GITHUB_CONTEXT" =~ https://project\.larksuite\.com/fpr/[A-Za-z0-9]+/detail/[A-Za-z0-9]+ ]]; then
  MEEGLE_URL="${match[0]}"
  
  # Use the existing resolve script to get PRD link from Meegle
  MEEGLE_JSON_OUTPUT=$(mktemp)
  trap "rm -f '$MEEGLE_JSON_OUTPUT'" EXIT
  
  echo "[prd-resolver] Detected Meegle work item link: $MEEGLE_URL" >&2
  echo "[prd-resolver] Resolving PRD link from Meegle..." >&2
  
  # Call the existing Meegle resolver script
  bash "$WORK_DIR/scripts/resolve-meegle-prd-link-with-opencode.sh" "$MEEGLE_URL" "$MEEGLE_JSON_OUTPUT" 2>&1 | sed 's/^/[meegle-resolver] /' >&2
  
  # Extract prdLink from JSON
  if [[ -f "$MEEGLE_JSON_OUTPUT" ]]; then
    PRD_LINK=$(jq -r '.prdLink // empty' "$MEEGLE_JSON_OUTPUT")
    if [[ -n "$PRD_LINK" && "$PRD_LINK" != "null" ]]; then
      echo "[prd-resolver] ✅ Successfully resolved PRD link from Meegle" >&2
      echo "$PRD_LINK"
      exit 0
    else
      ACCESS_STATUS=$(jq -r '.accessStatus // "unknown"' "$MEEGLE_JSON_OUTPUT")
      NOTES=$(jq -r '.notes // ""' "$MEEGLE_JSON_OUTPUT")
      echo "[prd-resolver] ❌ Failed to resolve PRD link from Meegle" >&2
      echo "[prd-resolver] Access Status: $ACCESS_STATUS" >&2
      echo "[prd-resolver] Notes: $NOTES" >&2
      exit 1
    fi
  else
    echo "[prd-resolver] ❌ Meegle resolver did not create output file" >&2
    exit 1
  fi
fi

# No PRD link found
echo "[prd-resolver] ⚠️  No PRD link detected in GitHub context" >&2
exit 1
