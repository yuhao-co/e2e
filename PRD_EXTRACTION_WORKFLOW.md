# PRD Extraction Workflow

## Overview

This document describes the complete workflow for extracting PRD (Product Requirements Document) links from GitHub PR context and reading their content.

**Date**: May 22, 2026  
**Status**: Production Ready

---

## PRD Link Detection & Resolution

### Supported PRD Link Formats

#### 1. **Direct Lark Document Links** (lark-wiki)
```
https://project.larksuite.com/docs/<doc-token>
https://larksuite.com/docs/<doc-token>
https://traveloka.sg.larksuite.com/wiki/<doc-token>
```

**Flow**:
```
GitHub PR Description 
  ↓
Extract Lark Document Link
  ↓
extract-prd-with-opencode.sh
  ↓
MCP Lark Document API
  ↓
PRD Content (Markdown)
```

**Script**: `scripts/extract-prd-with-opencode.sh`

```bash
./scripts/extract-prd-with-opencode.sh "https://project.larksuite.com/docs/ABC123XYZ" [output.md]
```

---

#### 2. **Meegle Work Item Links** (meegle-fpr)
```
https://project.larksuite.com/fpr/<project-id>/detail/<detail-id>
```

**Flow**:
```
GitHub PR Description
  ↓
Extract Meegle Work Item Link
  ↓
extract-prd-link-from-meegle.sh  (NEW)
  ↓
MCP Meegle API
  ↓
Read "PRD Link" Field
  ↓
Resolve PRD Link (Lark Document)
  ↓
extract-prd-with-opencode.sh
  ↓
MCP Lark Document API
  ↓
PRD Content (Markdown)
```

**Script**: `scripts/extract-prd-link-from-meegle.sh`

```bash
./scripts/extract-prd-link-from-meegle.sh "https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876" [output.json]
```

**Output (JSON)**:
```json
{
  "sourceUrl": "https://project.larksuite.com/fpr/...",
  "projectId": "6901d082e1d4ec8eeb572946",
  "detailId": "11760876",
  "status": "success",
  "prdLink": "https://project.larksuite.com/docs/ABC123XYZ",
  "fieldName": "PRD Link",
  "notes": "Successfully extracted PRD link from Meegle work item"
}
```

---

#### 3. **Automatic Context-Based Resolution** (NEW)
The new `resolve-prd-from-github-context.sh` script automatically detects the PRD link format and resolves it:

```bash
./scripts/resolve-prd-from-github-context.sh "<github-pr-body>" 
```

**Returns**: The resolved PRD document URL to stdout

**Example**:
```bash
PR_BODY=$(gh pr view 123 --json body -q .body)
PRD_URL=$(./scripts/resolve-prd-from-github-context.sh "$PR_BODY")
# PRD_URL = "https://project.larksuite.com/docs/ABC123XYZ"
```

---

## Complete Workflow Integrated in `generate-cases-from-weekly-diff.ts`

### Step 1: Extract PRD References from PR Description

The script automatically detects two types of PRD references:

```typescript
// Extracts from GitHub PR description
extractPrdReferences(prDescription)
  → [
      { url: "https://project.larksuite.com/docs/ABC123", kind: "lark-wiki" },
      { url: "https://project.larksuite.com/fpr/.../detail/...", kind: "meegle-fpr" }
    ]
```

### Step 2: Resolve Meegle References to Lark Documents

For any `meegle-fpr` references:

```typescript
resolveMeeglePrdReference(reference)
  → Calls: scripts/resolve-meegle-prd-link-with-opencode.sh
  → MCP: Uses Meegle to read work item
  → Returns: JSON with prdLink field
  → Result: Converts to "lark-wiki" reference
```

### Step 3: Extract PRD Content

For each resolved PRD reference:

```typescript
extractPrdContent(prdReference)
  → Calls: scripts/extract-prd-with-opencode.sh
  → MCP: Uses Lark Document API to read content
  → Result: Markdown file with PRD content
```

### Step 4: Generate Test Cases

The test case generator uses PRD content to:
- Extract requirements and acceptance criteria
- Generate test scenarios
- Create test case templates
- Map to UI interactions

---

## Script Details

### `extract-prd-with-opencode.sh`
**Purpose**: Read PRD content from Lark document  
**Input**: Lark document URL  
**Output**: Markdown file with PRD content  
**MCP Used**: Lark Document (raw-content)

```bash
./scripts/extract-prd-with-opencode.sh \
  "https://project.larksuite.com/docs/ABC123" \
  "/tmp/prd.md"

# Output: /tmp/prd.md (markdown format)
# Sections: Source URL, Access Status, Key Requirements, Risks, Test Implications, Open Questions
```

---

### `extract-prd-link-from-meegle.sh` (NEW)
**Purpose**: Extract PRD Link field from Meegle work item  
**Input**: Meegle work item URL  
**Output**: JSON file with extracted PRD link  
**MCP Used**: Meegle

```bash
./scripts/extract-prd-link-from-meegle.sh \
  "https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876" \
  "/tmp/prd-link.json"

# Output: /tmp/prd-link.json
# Contains: { prdLink: "https://project.larksuite.com/docs/...", status: "success", ... }
```

**Stdout**: The PRD link URL (or exit code 1 if not found)

```bash
# Simplified usage - just get the PRD link
PRD_LINK=$(./scripts/extract-prd-link-from-meegle.sh "$MEEGLE_URL" 2>/dev/null)
echo "$PRD_LINK"  # https://project.larksuite.com/docs/ABC123
```

---

### `resolve-prd-from-github-context.sh` (NEW)
**Purpose**: Detect and resolve PRD link from GitHub PR context  
**Input**: GitHub PR body/description text  
**Output**: Resolved PRD document URL to stdout  
**Return**: Exit code 0 on success, 1 if no PRD link found

```bash
./scripts/resolve-prd-from-github-context.sh "<pr-description-text>"

# Automatically detects:
# 1. Direct Lark document links → returns URL immediately
# 2. Meegle work item links → calls extract-prd-link-from-meegle.sh → returns resolved URL
# 3. No PRD link → returns exit code 1
```

**Error Handling**:
```bash
if PRD_URL=$(./scripts/resolve-prd-from-github-context.sh "$PR_BODY" 2>/dev/null); then
  echo "✅ Found PRD: $PRD_URL"
else
  echo "⚠️  No PRD link found in PR description"
fi
```

---

## Usage Examples

### Example 1: Direct Lark Document

**PR Description**:
```
## PRD Reference
Link: https://project.larksuite.com/docs/ABC123XYZ
```

**Script Flow**:
```bash
PRD_URL=$(./scripts/resolve-prd-from-github-context.sh "$PR_BODY")
# PRD_URL = "https://project.larksuite.com/docs/ABC123XYZ"

./scripts/extract-prd-with-opencode.sh "$PRD_URL"
# Outputs: /tmp/opencode-prd-20260522-120000.md
```

---

### Example 2: Meegle Work Item (NEW)

**PR Description**:
```
## Design Document
Details: https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876

The work item contains a "PRD Link" field pointing to the actual PRD.
```

**Script Flow**:
```bash
# Step 1: Detect Meegle link and extract PRD link
PRD_URL=$(./scripts/resolve-prd-from-github-context.sh "$PR_BODY")
# Internally calls: extract-prd-link-from-meegle.sh
# Returns: "https://project.larksuite.com/docs/ABC123XYZ"

# Step 2: Extract PRD content
./scripts/extract-prd-with-opencode.sh "$PRD_URL"
# Outputs: /tmp/opencode-prd-20260522-120000.md
```

---

### Example 3: Integrated in Test Case Generation

**Full Workflow**:
```typescript
// In generate-cases-from-weekly-diff.ts

const prDescription = await fetchGitHubPRDescription(prNumber);

// Automatically handles Lark + Meegle links
const prdReferences = extractPrdReferences(prDescription);
const resolvedReferences = resolvePrdReferences(prdReferences);

for (const ref of resolvedReferences) {
  const prdContent = await extractPrdContent(ref.url);
  
  // Generate test cases based on PRD
  const testCases = generateTestCases({
    prdContent,
    changedFiles,
    domain: 'flight-search',
  });
  
  // Write test case files
  writeTestCaseFiles(testCases);
}
```

---

## Troubleshooting

### Issue: "opencode is not installed or not on PATH"
**Solution**: Install OpenCode
```bash
# Assuming homebrew on macOS
brew install opencode

# Or install globally via npm
npm install -g @smithery/opencode
```

---

### Issue: Meegle Link Resolution Fails

**Symptoms**:
```
❌ PRD Link not found (status: unauthorized)
```

**Solutions**:
1. **Check MCP Meegle Access**:
   - Verify you have MCP Meegle provider installed and configured in `~/.mcp_config`
   - Test with: `opencode --list-mcp`

2. **Check Lark Authentication**:
   - Ensure you're authenticated to Lark in your environment
   - MCP Meegle requires valid Lark credentials

3. **Verify Work Item Exists**:
   - Check the Meegle URL is correct and the work item is accessible
   - Manually open the URL in browser to verify

---

### Issue: PRD Content Not Extracted

**Symptoms**:
```
❌ opencode did not create the expected markdown file
```

**Solutions**:
1. **Check MCP Lark Document Access**:
   - Verify MCP Lark provider is installed and configured
   - Test with: `opencode --list-mcp`

2. **Check Document Accessibility**:
   - Manually open the Lark document URL to verify access
   - Ensure document is not deleted or moved

3. **Check Permissions**:
   - Verify you have read access to the Lark document
   - Check your Lark workspace membership

---

## Integration Checklist

- [ ] `scripts/extract-prd-with-opencode.sh` exists and has execute permissions
- [ ] `scripts/extract-prd-link-from-meegle.sh` exists (NEW) and has execute permissions  
- [ ] `scripts/resolve-prd-from-github-context.sh` exists (NEW) and has execute permissions
- [ ] `scripts/resolve-meegle-prd-link-with-opencode.sh` exists and has execute permissions
- [ ] OpenCode is installed: `which opencode`
- [ ] MCP providers configured: `opencode --list-mcp`
- [ ] Test case generator imports and uses these scripts
- [ ] PRD references are extracted from PR descriptions

---

## Version History

| Date | Change | Status |
|------|--------|--------|
| 2026-05-22 | Added Meegle support with `extract-prd-link-from-meegle.sh` | Production |
| 2026-05-22 | Added context-aware resolver `resolve-prd-from-github-context.sh` | Production |
| Earlier | Lark document extraction via `extract-prd-with-opencode.sh` | Production |

---

## Notes

- All PRD extraction scripts use MCP (Model Context Protocol) for safe, authorized access
- No login page scraping or WebFetch fallbacks are used
- Scripts fail cleanly with clear error messages if MCP access is unavailable
- Results are cached to avoid duplicate resolutions within the same run
- Temporary files are cleaned up automatically

---

## Related Documentation

- [Weekly Diff Workflow](./WORKFLOW_LOCKED_SPEC.md)
- [Enhanced Locator Generator](./scripts/lib/enhanced-locator-generator.ts)
- [Accumulation System](./scripts/lib/accumulation-manifest.ts)
- [Lark Integration Setup](./LARK_INTEGRATION_STATUS.md)
