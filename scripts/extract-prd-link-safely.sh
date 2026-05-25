#!/bin/zsh
set -euo pipefail

# ============================================================================
# SAFE PRD LINK EXTRACTION FROM JSON
# ============================================================================
# Purpose: Safely extract PRD links from opencode-generated JSON
# This is a fail-safe wrapper that validates JSON before extraction
# ============================================================================

readonly SCRIPT_NAME="${0##*/}"

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

# Validate JSON file structure
validate_prd_json() {
  local json_file="$1"
  
  # File existence
  if [[ ! -f "$json_file" ]]; then
    die "JSON file not found: $json_file"
  fi
  
  # File readability
  if [[ ! -r "$json_file" ]]; then
    die "JSON file not readable: $json_file"
  fi
  
  # File size (sanity check: should be < 100KB)
  local file_size
  file_size=$(stat -f%z "$json_file" 2>/dev/null || stat -c%s "$json_file" 2>/dev/null)
  if (( file_size > 100000 )); then
    die "JSON file too large (possible corruption): $json_file (${file_size} bytes)"
  fi
  
  # Valid JSON
  if ! jq empty "$json_file" 2>/dev/null; then
    die "Invalid JSON format: $json_file"
  fi
  
  # Required fields
  local access_status
  access_status=$(jq -r '.accessStatus // empty' "$json_file")
  
  if [[ -z "$access_status" ]]; then
    die "Missing required field: accessStatus"
  fi
  
  info "✓ JSON validation passed"
  return 0
}

extract_prd_link() {
  local json_file="$1"
  
  validate_prd_json "$json_file"
  
  local access_status
  local prd_link
  local error_details
  
  access_status=$(jq -r '.accessStatus' "$json_file")
  prd_link=$(jq -r '.prdLink // "null"' "$json_file")
  error_details=$(jq -r '.errorDetails // .notes // "none"' "$json_file")
  
  info "Access Status: $access_status"
  
  if [[ "$access_status" != "success" ]]; then
    warn "PRD resolution failed with status: $access_status"
    warn "Details: $error_details"
    exit 1
  fi
  
  if [[ "$prd_link" == "null" ]] || [[ -z "$prd_link" ]]; then
    warn "No PRD link found in JSON"
    warn "Details: $error_details"
    exit 1
  fi
  
  # Validate URL format (should be a Lark document URL)
  if [[ ! "$prd_link" =~ ^https://.*\.larksuite\.com/.* ]]; then
    die "Invalid PRD URL format: $prd_link"
  fi
  
  info "✓ PRD link extracted successfully"
  echo "$prd_link"
}

main() {
  if [[ $# -ne 1 ]]; then
    echo "Usage: $SCRIPT_NAME <json-file-path>" >&2
    echo "" >&2
    echo "Extracts PRD link from opencode-generated JSON with strict validation" >&2
    exit 1
  fi
  
  local json_file="$1"
  extract_prd_link "$json_file"
}

main "$@"
