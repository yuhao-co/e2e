#!/bin/zsh
# Complete workflow: weekly-diff + generate PRD markdown
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"
OUTPUT_FILE="${OUTPUT_FILE:-generated-cases/weekly-diff/PRD.md}"

cd "$REPO_ROOT"

# Color codes
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Weekly Diff → PRD Markdown Generator${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Run weekly-diff (without running playwright tests)
echo -e "${YELLOW}[1/2] Running weekly-diff...${NC}"
RUN_WEEKLY_PLAYWRIGHT=0 npm run weekly-diff:run > /tmp/weekly-diff.log 2>&1
WEEKLY_STATUS=$?

if [[ $WEEKLY_STATUS -eq 0 ]]; then
  echo -e "${GREEN}✅ Weekly-diff completed${NC}"
else
  echo -e "${YELLOW}⚠️  Weekly-diff exited with code $WEEKLY_STATUS${NC}"
  tail -10 /tmp/weekly-diff.log
fi

echo ""

# Step 2: Generate PRD markdown
echo -e "${YELLOW}[2/2] Generating PRD markdown...${NC}"
if chmod +x scripts/generate-prd-md.sh && zsh scripts/generate-prd-md.sh "$OUTPUT_FILE"; then
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}✅ Success! PRD markdown ready${NC}"
  echo -e "${GREEN}File: $OUTPUT_FILE${NC}"
  echo -e "${GREEN}========================================${NC}"
  
  # Show summary stats
  echo ""
  echo -e "${BLUE}📊 Summary:${NC}"
  echo "  Total lines: $(wc -l < "$OUTPUT_FILE" | tr -d ' ')"
  echo "  File size: $(du -h "$OUTPUT_FILE" | cut -f1)"
  echo ""
  echo -e "${BLUE}📂 To view: ${NC}cat $OUTPUT_FILE"
  echo -e "${BLUE}📂 Or open: ${NC}open $OUTPUT_FILE"
  
  exit 0
else
  echo -e "${YELLOW}⚠️  Failed to generate PRD markdown${NC}"
  exit 1
fi
