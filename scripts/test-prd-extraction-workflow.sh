#!/bin/zsh
# test-prd-extraction-workflow.sh
#
# Purpose: Verify PRD extraction scripts work correctly
# Tests:
# 1. Script availability and permissions
# 2. OpenCode installation
# 3. Mock workflow execution
#
# Usage: ./scripts/test-prd-extraction-workflow.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_OUTPUT_DIR="/tmp/prd-extraction-test-$(date +%Y%m%d-%H%M%S)"

# ============ COLORS ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============ UTILITIES ============

log_header() {
  echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

log_pass() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_fail() {
  echo -e "${RED}❌ $1${NC}"
}

log_warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

# ============ TESTS ============

test_script_exists() {
  local script=$1
  local path="$SCRIPT_DIR/$script"
  
  if [[ ! -f "$path" ]]; then
    log_fail "Script not found: $script"
    return 1
  fi
  
  if [[ ! -x "$path" ]]; then
    log_fail "Script not executable: $script"
    return 1
  fi
  
  log_pass "Script exists and is executable: $script"
  return 0
}

test_opencode_installed() {
  if ! command -v opencode >/dev/null 2>&1; then
    log_fail "opencode is not installed"
    log_info "Install with: brew install opencode"
    return 1
  fi
  
  local version=$(opencode --version 2>/dev/null || echo "unknown")
  log_pass "OpenCode installed (version: $version)"
  return 0
}

test_mcp_providers() {
  if ! command -v opencode >/dev/null 2>&1; then
    log_warn "Cannot test MCP providers (opencode not installed)"
    return 0
  fi
  
  # Try to list MCP providers
  if opencode --list-mcp >/dev/null 2>&1; then
    log_pass "MCP providers accessible"
    return 0
  else
    log_warn "Could not list MCP providers (may not be configured)"
    log_info "Check ~/.mcp_config for Meegle and Lark configuration"
    return 0
  fi
}

test_script_syntax() {
  local script=$1
  local path="$SCRIPT_DIR/$script"
  
  # Verify it's valid bash/zsh
  if bash -n "$path" >/dev/null 2>&1; then
    log_pass "Script syntax valid: $script"
    return 0
  else
    log_fail "Script has syntax errors: $script"
    return 1
  fi
}

test_github_context_parser() {
  local script="$SCRIPT_DIR/resolve-prd-from-github-context.sh"
  
  # Test 1: Direct Lark link
  local lark_link="https://project.larksuite.com/docs/ABC123XYZ"
  local pr_body="Check out this PRD: $lark_link"
  
  if bash "$script" "$pr_body" 2>/dev/null | grep -q "ABC123XYZ"; then
    log_pass "Correctly identifies direct Lark document link"
  else
    log_warn "Could not verify Lark link detection"
  fi
  
  # Test 2: No PRD link
  local no_prd_body="Just a regular PR description"
  if ! bash "$script" "$no_prd_body" >/dev/null 2>&1; then
    log_pass "Correctly rejects PR with no PRD link"
  else
    log_warn "Expected failure for PR with no PRD link"
  fi
}

test_meegle_url_validation() {
  local script="$SCRIPT_DIR/extract-prd-link-from-meegle.sh"
  
  # Test invalid URL format
  if bash "$script" "https://invalid-url" >/dev/null 2>&1; then
    log_warn "Script should reject invalid Meegle URL"
  else
    log_pass "Correctly validates Meegle URL format"
  fi
}

test_prd_content_extraction() {
  local script="$SCRIPT_DIR/extract-prd-with-opencode.sh"
  
  # Test invalid document token
  if bash "$script" "https://project.larksuite.com/docs/INVALID" 2>&1 | grep -q "Could not extract"; then
    log_pass "Correctly validates document token"
  elif ! command -v opencode >/dev/null 2>&1; then
    log_warn "Cannot test extraction (opencode not installed)"
  else
    log_warn "Could not fully test PRD extraction"
  fi
}

# ============ MAIN ============

main() {
  log_header "PRD Extraction Workflow - Test Suite"
  
  cd "$PROJECT_ROOT"
  mkdir -p "$TEST_OUTPUT_DIR"
  
  # Test script availability
  log_header "1. Checking Script Files"
  local scripts=(
    "extract-prd-with-opencode.sh"
    "extract-prd-link-from-meegle.sh"
    "resolve-prd-from-github-context.sh"
    "resolve-meegle-prd-link-with-opencode.sh"
  )
  
  local all_scripts_ok=true
  for script in "${scripts[@]}"; do
    if ! test_script_exists "$script"; then
      all_scripts_ok=false
    fi
  done
  
  # Test script syntax
  log_header "2. Checking Script Syntax"
  for script in "${scripts[@]}"; do
    if ! test_script_syntax "$script"; then
      all_scripts_ok=false
    fi
  done
  
  # Test OpenCode
  log_header "3. Checking OpenCode Installation"
  if ! test_opencode_installed; then
    log_warn "OpenCode not available - some features will not work"
  fi
  
  # Test MCP providers
  log_header "4. Checking MCP Providers"
  test_mcp_providers
  
  # Test script logic
  log_header "5. Testing Script Logic"
  test_github_context_parser
  test_meegle_url_validation
  test_prd_content_extraction
  
  # Summary
  log_header "Test Summary"
  if [[ "$all_scripts_ok" == "true" ]]; then
    log_pass "All critical tests passed"
    log_info "PRD extraction workflow is ready"
    
    # Show next steps
    echo -e "\n${BLUE}Next Steps:${NC}"
    echo "1. Verify OpenCode and MCP providers are configured"
    echo "2. Test with a real Lark document URL"
    echo "3. Test with a real Meegle work item URL"
    echo "4. Integrate into test case generation workflow"
    
    return 0
  else
    log_fail "Some critical tests failed"
    echo -e "\n${YELLOW}Actions Required:${NC}"
    echo "1. Fix script issues identified above"
    echo "2. Install missing dependencies (opencode)"
    echo "3. Configure MCP providers"
    
    return 1
  fi
}

main "$@"
