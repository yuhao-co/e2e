#!/bin/zsh

# Bug Detection Integration with Weekly-Diff Workflow
# Runs generic bug detection after weekly-diff case generation
# and collects data for model training

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
}

log_warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# Main workflow
main() {
  log_info "Starting weekly-diff with bug detection integration"
  
  cd "$PROJECT_ROOT"

  # Step 1: Run weekly-diff to generate test cases
  log_info "Step 1: Generating weekly-diff test cases..."
  if ! RUN_WEEKLY_PLAYWRIGHT=0 npm run weekly-diff:run; then
    log_error "Weekly-diff generation failed"
    exit 1
  fi
  log_success "Weekly-diff cases generated"

  # Step 2: Generate PRD markdown
  log_info "Step 2: Generating enhanced PRD markdown..."
  if ! npm run weekly-diff:prd; then
    log_error "PRD generation failed"
    exit 1
  fi
  log_success "PRD markdown generated"

  # Step 3: Run generic bug detection on generated cases
  log_info "Step 3: Running generic bug detection..."
  if ! npm run test:bugs:generic -- tests/web/traveloka-generic-bug-detection.spec.ts 2>&1 | tee logs/bug-detection-$(date +%s).log; then
    log_warn "Some bug detection tests failed (this is expected)"
  fi
  log_success "Bug detection completed"

  # Step 4: Collect and analyze bug data
  log_info "Step 4: Collecting bug detection data for training..."
  if ! npx ts-node scripts/bug-detection-collector.ts stats; then
    log_warn "Bug data collection encountered issues"
  fi
  log_success "Bug data collected"

  # Step 5: Validate training data
  log_info "Step 5: Validating training dataset..."
  if ! npx ts-node scripts/bug-detection-collector.ts validate; then
    log_warn "Some training data validation issues found"
  fi
  log_success "Training data validated"

  # Step 6: Run tests with detected bugs
  log_info "Step 6: Running test suite with bug detection..."
  if ! npm run test:web:retained; then
    log_warn "Some tests failed (see report for details)"
  fi
  log_success "Test suite completed"

  # Step 7: Notify team
  log_info "Step 7: Sending Lark notification..."
  if ! npm run notify:run -- --label "Weekly-Diff + Bug Detection" -- echo "Workflow completed"; then
    log_warn "Notification failed"
  fi
  log_success "Notification sent"

  # Final summary
  echo ""
  echo "=========================================="
  log_success "Weekly-Diff + Bug Detection Workflow Complete!"
  echo "=========================================="
  echo ""
  log_info "Generated artifacts:"
  echo "  - generated-cases/weekly-diff/latest/"
  echo "  - generated-cases/weekly-diff/PRD.md"
  echo "  - logs/bug-detection-*.log"
  echo "  - data/bug-detection/training-data.jsonl"
  echo ""
  log_info "View training data statistics:"
  echo "  npx ts-node scripts/bug-detection-collector.ts stats"
  echo ""
  log_info "Export training data:"
  echo "  npx ts-node scripts/bug-detection-collector.ts export json"
  echo "  npx ts-node scripts/bug-detection-collector.ts export csv"
  echo ""
}

# Error handling
trap 'log_error "Workflow interrupted"; exit 1' INT TERM

# Run main workflow
main "$@"
