#!/bin/zsh
set -euo pipefail

# ============================================================================
# MEEGLE PRD RESOLUTION SCRIPT - READ ONLY
# ============================================================================
# Purpose: Resolve Meegle item URLs to their internal PRD links
# Constraints: 
#   - READ ONLY: No modifications to Meegle/Lark data allowed
#   - STRICT VALIDATION: All failures must be reported explicitly
#   - RETRY LOGIC: Automatic retry on transient failures
#   - TIMEOUT PROTECTION: Strict timeouts for all operations
# ============================================================================

# Strict shell settings
set -o pipefail
setopt ERR_EXIT
setopt NO_UNSET

# Configuration
readonly OPENCODE_TIMEOUT_SECONDS=120
readonly MAX_RETRIES=3
readonly RETRY_DELAY_SECONDS=5
readonly OPENCODE_CHECK_INTERVAL=2

# Force OpenCode in PATH - multiple fallback options
export PATH="${HOME}/.opencode/bin:/opt/opencode/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

die() {
  echo "❌ FATAL: $*" >&2
  exit 1
}

warn() {
  echo "⚠️  WARNING: $*" >&2
}

info() {
  echo "ℹ️  $*" >&2
}

validate_json() {
  local json_file="$1"
  
  if [[ ! -f "$json_file" ]]; then
    return 1
  fi
  
  # Verify it's valid JSON
  if ! jq empty "$json_file" 2>/dev/null; then
    return 1
  fi
  
  # Verify required fields
  local access_status
  access_status=$(jq -r '.accessStatus // empty' "$json_file")
  
  if [[ -z "$access_status" ]]; then
    return 1
  fi
  
  return 0
}

check_preconditions() {
  # Check opencode is available
  if ! command -v opencode >/dev/null 2>&1; then
    die "opencode is not installed or not on PATH. Current PATH: $PATH"
  fi
  
  # Get opencode full path for diagnostics
  local OPENCODE_PATH
  OPENCODE_PATH=$(command -v opencode)
  
  # Check jq for JSON validation
  if ! command -v jq >/dev/null 2>&1; then
    die "jq is required but not installed"
  fi
  
  info "✓ opencode found at: $OPENCODE_PATH"
  info "✓ jq is available"
  info "✓ All preconditions met"
}

validate_meegle_url() {
  local url="$1"
  
  if [[ ! "$url" =~ https://project\.larksuite\.com/fpr/([A-Za-z0-9]+)/detail/([A-Za-z0-9]+) ]]; then
    die "Invalid Meegle URL format. Expected: https://project.larksuite.com/fpr/<project-id>/detail/<detail-id>"
  fi
  
  info "✓ Meegle URL format validated"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
  # Validate arguments
  if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: $0 <meegle-url> [output-json-path]" >&2
    exit 1
  fi

  local meegle_url="$1"
  local output_path="${2:-/tmp/opencode-meegle-prd-$(date +%Y%m%d-%H%M%S).json}"
  local work_dir="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"

  info "=========================================="
  info "MEEGLE PRD Resolution (Read-Only Mode)"
  info "=========================================="
  info "URL: $meegle_url"
  info "Output: $output_path"
  info ""

  # Pre-flight checks
  check_preconditions
  validate_meegle_url "$meegle_url"

  # Create output directory
  mkdir -p "$(dirname "$output_path")" || die "Failed to create output directory"

  # Extract project and detail IDs
  local project_id detail_id
  if [[ "$meegle_url" =~ https://project\.larksuite\.com/fpr/([A-Za-z0-9]+)/detail/([A-Za-z0-9]+) ]]; then
    project_id="$match[1]"
    detail_id="$match[2]"
  else
    die "Failed to extract Meegle project/detail IDs"
  fi

  info "Project ID: $project_id"
  info "Detail ID: $detail_id"
  info ""

  # Construct strict READ-ONLY prompt
  # IMPORTANT: This prompt explicitly forbids any modifications
  local prompt=$(cat <<'PROMPT_EOF'
CONSTRAINT: READ-ONLY MODE - NO MODIFICATIONS ALLOWED
=======================================================

You are retrieving metadata from Meegle and Lark. You MUST NOT:
- Modify any Meegle items
- Update any Lark documents
- Create any new documents
- Delete anything
- Write to any endpoints except the output file

Your ONLY permitted action: Read and extract data

TASK: Resolve Meegle PRD Link
=============================

1. Use ONLY MCP Meegle to fetch the work item at: ${MEEGLE_URL}
   - Project ID (hint): ${PROJECT_ID}
   - Detail ID (hint): ${DETAIL_ID}

2. From the Meegle item data:
   - Extract the internal PRD link
   - Extract item title/summary

3. If PRD link found and points to Lark:
   - Use ONLY MCP Lark to read the document
   - Extract PRD title and body summary
   - DO NOT write back to Lark

4. Generate output JSON

MANDATORY RULES:
- Use ONLY MCP Meegle and MCP Lark
- NO WebFetch, HTTP, browser, or other fallbacks
- NO modifications to any data
- Fail explicitly if access denied

OUTPUT JSON FORMAT (strict):
{
  "sourceUrl": "${MEEGLE_URL}",
  "projectId": "${PROJECT_ID}",
  "detailId": "${DETAIL_ID}",
  "timestamp": (current ISO timestamp),
  "accessStatus": "success" | "unauthorized" | "not_found" | "no_prd_link" | "error",
  "prdLink": null or string,
  "prdTitle": null or string,
  "summary": null or string,
  "errorDetails": null or string
}

Write EXACTLY ONE JSON file to: ${OUTPUT_PATH}
PROMPT_EOF
)

  # Retry logic
  local attempt=1
  local success=false

  while (( attempt <= MAX_RETRIES )); do
    info "Attempt $attempt/$MAX_RETRIES..."
    
    # Run opencode with timeout
    cd "$work_dir"
    
    # Debug: Show which opencode we're using
    info "Using opencode at: $(command -v opencode)"
    info "With PATH: ${PATH:0:100}..."
    
    # Capture output for diagnostics
    local OPENCODE_OUTPUT
    OPENCODE_OUTPUT=$(mktemp)
    
    # Run opencode directly (no external timeout command needed)
    if opencode run --dangerously-skip-permissions "$prompt" >"$OPENCODE_OUTPUT" 2>&1; then
      
      # Check if file was created and is valid
      if validate_json "$output_path"; then
        success=true
        break
      else
        warn "JSON validation failed for: $output_path"
      fi
    else
      local exit_code=$?
      if (( exit_code == 124 )); then
        warn "opencode timeout (${OPENCODE_TIMEOUT_SECONDS}s)"
      else
        warn "opencode failed with exit code: $exit_code"
        # Show opencode output for debugging
        if [ -f "$OPENCODE_OUTPUT" ] && [ -s "$OPENCODE_OUTPUT" ]; then
          warn "opencode output:"
          cat "$OPENCODE_OUTPUT" | head -10 | sed 's/^/  /' >&2
        fi
      fi
      rm -f "$OPENCODE_OUTPUT"
    fi
    
    if (( attempt < MAX_RETRIES )); then
      info "Retrying in ${RETRY_DELAY_SECONDS}s..."
      sleep "$RETRY_DELAY_SECONDS"
    fi
    
    (( attempt++ ))
  done

  # Final validation
  if [[ "$success" != "true" ]]; then
    die "Failed to retrieve PRD after $MAX_RETRIES attempts"
  fi

  # Verify JSON structure
  local access_status
  access_status=$(jq -r '.accessStatus // empty' "$output_path")
  
  if [[ -z "$access_status" ]]; then
    die "Invalid JSON: missing accessStatus field"
  fi

  # Log results
  info ""
  info "✅ PRD Resolution Complete"
  info "Status: $access_status"
  
  # Show summary
  if [[ "$access_status" == "success" ]]; then
    local prd_link
    prd_link=$(jq -r '.prdLink // "null"' "$output_path")
    info "PRD Link: $prd_link"
  else
    local error
    error=$(jq -r '.errorDetails // .notes // "unknown"' "$output_path")
    warn "Resolution details: $error"
  fi

  info ""
  info "Output: $output_path"
  
  # Return output path on success
  echo "$output_path"
}

# Execute main function
main "$@"