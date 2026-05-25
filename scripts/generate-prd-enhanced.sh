#!/bin/zsh
# Generate enhanced PRD markdown with detailed links and summaries
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/yu.hao/Desktop/task/e2e}"
OUTPUT_DIR="${OUTPUT_DIR:-generated-cases/weekly-diff}"
OUTPUT_FILE="${1:-generated-cases/weekly-diff/PRD.md}"
SUMMARY_FILE="$OUTPUT_DIR/latest/summary.json"

cd "$REPO_ROOT"

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📋 Generating Enhanced PRD...${NC}"

if [[ ! -f "$SUMMARY_FILE" ]]; then
  echo -e "${RED}❌ No summary found at $SUMMARY_FILE${NC}"
  exit 1
fi

# Extract key information using jq
GENERATED_AT=$(jq -r '.generatedAt // empty' "$SUMMARY_FILE")
MARKDOWN=$(jq -r '.markdownSummary // empty' "$SUMMARY_FILE")
CANDIDATE_COUNT=$(jq '.candidates | length' "$SUMMARY_FILE")
COMMIT_COUNT=$(jq '.candidates | map(.sourceCommits[]?) | length' "$SUMMARY_FILE")
HINT_COUNT=$(jq '.candidates | map(.sourceHints[]?) | length' "$SUMMARY_FILE")

cat > "$OUTPUT_FILE" << 'PRDEOF'
# 📋 PRD (Product Requirements Document) Report
PRDEOF

echo "" >> "$OUTPUT_FILE"
echo "## 📌 Metadata & Links" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "### 1. Source Information" >> "$OUTPUT_FILE"
echo "- **Status**: ✅ PRD Successfully Generated" >> "$OUTPUT_FILE"
echo "- **Generated At**: \`$GENERATED_AT\`" >> "$OUTPUT_FILE"
echo "- **Source**: \`generated-cases/weekly-diff/latest/summary.json\`" >> "$OUTPUT_FILE"
echo "- **GitHub Repo**: https://github.com/traveloka/www" >> "$OUTPUT_FILE"
echo "- **Analysis Type**: Weekly Diff Analysis" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "### 2. Summary Statistics" >> "$OUTPUT_FILE"
echo "- **Total Candidates**: $CANDIDATE_COUNT" >> "$OUTPUT_FILE"
echo "- **Related Commits**: $COMMIT_COUNT" >> "$OUTPUT_FILE"
echo "- **Source Files**: $HINT_COUNT" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "### 3. Candidate Overview" >> "$OUTPUT_FILE"
jq -r '.candidates[] | "- **\(.title)** (\(.domain) - \(.confidence) confidence)"' "$SUMMARY_FILE" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "## 🎯 Detailed Candidate Summaries" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Generate detailed summaries for each candidate
jq -r '.candidates[] | 
"### \(.title)
- **Domain**: \(.domain)
- **Confidence**: \(.confidence)
- **Action Type**: \(.action)
- **Suggested Test Intent**: 
  > \(.suggestedUserIntent)
- **Target URL**: \(.targetUrl)
- **Workflow Concern**: \(.concerns[0] // \"N/A\")
- **Reason**: \(.reason)
- **Solution**: \(.solution)
- **Changed Files Count**: \(.changedFiles | length)
- **Key Files**:
\(.changedFiles[0:3] | map("  - \(.)") | join("\n"))
" ' "$SUMMARY_FILE" >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "## 🔗 Commit & PR Links (Clickable)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

jq -r '.candidates[] | 
"### \(.title)
\(.sourceCommits[] | "
- **GitHub Commit**: [\(.sha)](https://github.com/traveloka/www/commit/\(.sha))
  - Author: \(.author)
  - Message: \(.subject)
  - **PR Link**: [#\(.prNumber)](https://github.com/traveloka/www/pull/\(.prNumber))
")
"' "$SUMMARY_FILE" >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "## 📁 Affected Files (sourceHints)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

jq -r '.candidates[] | 
"### \(.title)
\(.sourceHints[] | "- \`\(.sourcePath)\`
  - \(.reason)
")
"' "$SUMMARY_FILE" >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "## ✅ Verification Status" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "- ✅ PRD Generated Successfully" >> "$OUTPUT_FILE"
echo "- ✅ JSON Validation: PASSED" >> "$OUTPUT_FILE"
echo "- ✅ Markdown Extraction: COMPLETED" >> "$OUTPUT_FILE"
echo "- ✅ Commits Extracted: $COMMIT_COUNT commits identified" >> "$OUTPUT_FILE"
echo "- ✅ PR Links Generated: YES" >> "$OUTPUT_FILE"
echo "- ✅ Source Files Identified: $HINT_COUNT hint(s)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "## 📄 Original Weekly Diff Report" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "$MARKDOWN" >> "$OUTPUT_FILE"

# Get file stats
FILE_SIZE=$(wc -c < "$OUTPUT_FILE" | tr -d ' ')
LINE_COUNT=$(wc -l < "$OUTPUT_FILE" | tr -d ' ')

echo -e "${GREEN}✅ PRD saved to: $OUTPUT_FILE${NC}"
echo -e "${GREEN}   Lines: $LINE_COUNT | Size: $(numfmt --to=iec $FILE_SIZE 2>/dev/null || echo "$FILE_SIZE bytes")${NC}"
echo ""
echo -e "${BLUE}📄 Preview:${NC}"
head -50 "$OUTPUT_FILE"
echo ""
echo "... (see full file at $OUTPUT_FILE) ..."
