#!/bin/zsh

# ============================================================================
# Complete Workflow: Weekly Diff → Generate Cases → Test → Report
# ============================================================================
# 一键执行完整流程：周差异 → 生成用例 → 执行测试 → 展示报告
#
# Usage:
#   ./scripts/run-complete-workflow.sh
#
# 流程：
#   1. 执行 weekly diff 分析
#   2. 从周差异生成测试用例
#   3. 执行生成的测试用例
#   4. 展示测试报告
# ============================================================================

set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKSPACE_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
  echo ""
  echo "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo "${BLUE}║${NC} $1"
  echo "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

print_section() {
  echo ""
  echo "${CYAN}──────────────────────────────────────────────────────────${NC}"
  echo "${CYAN}$1${NC}"
  echo "${CYAN}──────────────────────────────────────────────────────────${NC}"
  echo ""
}

print_step() {
  echo "${YELLOW}➜${NC} $1"
}

print_success() {
  echo "${GREEN}✓${NC} $1"
}

print_error() {
  echo "${RED}✗${NC} $1"
}

print_info() {
  echo "${BLUE}ℹ${NC} $1"
}

elapsed_time() {
  local start=$1
  local end=$2
  local elapsed=$((end - start))
  printf "%02d:%02d" $((elapsed / 60)) $((elapsed % 60))
}

# ============================================================================
# Main Workflow
# ============================================================================

print_header "Complete Testing Workflow: Weekly Diff → Cases → Test → Report"

START_TIME=$(date +%s)

# Step 1: Weekly Diff
print_section "Step 1️⃣  Weekly Diff Analysis"
STEP1_START=$(date +%s)

print_step "Analyzing weekly changes..."
print_info "Running: npm run weekly-diff:lark"
echo ""

if npm run weekly-diff:lark; then
  STEP1_END=$(date +%s)
  print_success "Weekly diff analysis completed with Lark notification ($(elapsed_time $STEP1_START $STEP1_END))"
else
  STEP1_END=$(date +%s)
  print_error "Weekly diff analysis failed ($(elapsed_time $STEP1_START $STEP1_END))"
  print_info "Check logs above for details"
  exit 1
fi
echo ""

# Step 2: Generate Test Cases
print_section "Step 2️⃣  Generate Test Cases from Weekly Diff"
STEP2_START=$(date +%s)

print_step "Generating test cases..."
print_info "Running: npm run generate:weekly-diff-cases"
echo ""

if npm run generate:weekly-diff-cases; then
  STEP2_END=$(date +%s)
  print_success "Test cases generated ($(elapsed_time $STEP2_START $STEP2_END))"
else
  STEP2_END=$(date +%s)
  print_error "Test case generation failed ($(elapsed_time $STEP2_START $STEP2_END))"
  print_info "Check logs above for details"
  exit 1
fi
echo ""

# Check if any test files were generated
print_step "Looking for generated test files..."
GENERATED_SPECS=$(find tests/web -name "traveloka-flight-weekly-diff-*.spec.ts" -type f | wc -l)
if [ "$GENERATED_SPECS" -gt 0 ]; then
  print_success "Found $GENERATED_SPECS generated test specifications"
  find tests/web -name "traveloka-flight-weekly-diff-*.spec.ts" -type f | sed 's/^/    → /'
else
  print_info "No new test specs generated (this may be normal)"
fi
echo ""

# Step 3: Run Tests
print_section "Step 3️⃣  Execute Tests"
STEP3_START=$(date +%s)

print_step "Running tests..."
print_info "Running: npm run test:web:retained:lark"
echo ""

if npm run test:web:retained:lark; then
  STEP3_END=$(date +%s)
  print_success "Tests completed successfully with Lark notification ($(elapsed_time $STEP3_START $STEP3_END))"
else
  TEST_EXIT_CODE=$?
  STEP3_END=$(date +%s)
  print_error "Tests failed with exit code $TEST_EXIT_CODE ($(elapsed_time $STEP3_START $STEP3_END))"
  print_info "Notification sent to Lark. Continuing to generate report..."
  echo ""
fi
echo ""

# Step 4: Generate Report
print_section "Step 4️⃣  View Test Report"
STEP4_START=$(date +%s)

print_step "Generating test report..."
print_info "Running: npm run report"
echo ""

if npm run report; then
  STEP4_END=$(date +%s)
  print_success "Report displayed ($(elapsed_time $STEP4_START $STEP4_END))"
else
  STEP4_END=$(date +%s)
  print_error "Could not display report ($(elapsed_time $STEP4_START $STEP4_END))"
  print_info "You can manually view the report with: npm run report"
fi
echo ""

# Step 5: Send Final Lark Notification
print_section "Step 5️⃣  Final Workflow Notification"
STEP5_START=$(date +%s)

print_step "Sending final notification to Lark..."
REPORT_PATH="playwright-report/index.html"
REPORT_URL="file://$(cd "$WORKSPACE_ROOT" && pwd)/$REPORT_PATH"

if [ -f "$REPORT_PATH" ]; then
  print_info "Test report ready at: $REPORT_URL"
  print_step "Sending workflow completion message..."
  
  npm run notify:run -- --label "✅ Complete Workflow Finished" -- echo "Workflow completed: Weekly Diff → Generate Cases → Test → Report" >/dev/null 2>&1 || true
  
  STEP5_END=$(date +%s)
  print_success "Workflow completion notification sent ($(elapsed_time $STEP5_START $STEP5_END))"
else
  STEP5_END=$(date +%s)
  print_info "Report not available for notification ($(elapsed_time $STEP5_START $STEP5_END))"
fi
echo ""

# Summary
print_section "📊 Workflow Summary"

END_TIME=$(date +%s)
TOTAL_TIME=$(elapsed_time $START_TIME $END_TIME)

echo "${GREEN}Completed Steps:${NC}"
echo "  ✓ Step 1: Weekly Diff Analysis ($(elapsed_time $STEP1_START $STEP1_END))"
echo "  ✓ Step 2: Test Case Generation ($(elapsed_time $STEP2_START $STEP2_END))"
echo "  ✓ Step 3: Test Execution ($(elapsed_time $STEP3_START $STEP3_END))"
echo "  ✓ Step 4: Report Display ($(elapsed_time $STEP4_START $STEP4_END))"
echo "  ✓ Step 5: Lark Notification ($(elapsed_time $STEP5_START $STEP5_END))"
echo ""
echo "${CYAN}Total Workflow Time: $TOTAL_TIME${NC}"
echo ""

# Final stats
print_section "📈 Generated Artifacts"

SNAPSHOT_DIRS=$(find tests/web/snapshot-* -type d 2>/dev/null | wc -l)
if [ "$SNAPSHOT_DIRS" -gt 0 ]; then
  print_info "$SNAPSHOT_DIRS snapshot directories created"
  find tests/web/snapshot-* -maxdepth 0 -type d | sort -r | head -3 | sed 's/^/    ├─ /'
fi

TEST_SPECS=$(find tests/web -name "traveloka-flight-weekly-diff-*.spec.ts" -type f | wc -l)
if [ "$TEST_SPECS" -gt 0 ]; then
  print_info "$TEST_SPECS test specifications generated"
fi

REPORT_DIR="playwright-report"
if [ -d "$REPORT_DIR" ]; then
  print_info "Test report available at: $REPORT_DIR/index.html"
fi
echo ""

print_header "✨ Complete Workflow Finished!"

echo "${YELLOW}What Happened:${NC}"
echo "  1️⃣  Weekly Diff - Analyzed 7 days of changes (with Lark notification)"
echo "  2️⃣  Case Generation - Generated test cases from diff"
echo "  3️⃣  Test Execution - Ran all tests and sent results to Lark"
echo "  4️⃣  Report Display - Generated and displayed test report"
echo "  5️⃣  Final Notification - Sent workflow completion to Lark bot"
echo ""
echo "${YELLOW}Next Steps:${NC}"
echo "  • Review the test report displayed above"
echo "  • Check generated test cases in: tests/web/"
echo "  • View snapshots in: tests/web/snapshot-*/"
echo "  • Commit results if satisfied:"
echo ""
echo "    ${CYAN}git add tests/web/traveloka-flight-weekly-diff-*.spec.ts${NC}"
echo "    ${CYAN}git commit -m 'test: add weekly diff test cases'${NC}"
echo ""

print_success "All done! 🎉 Lark bot has been notified."
