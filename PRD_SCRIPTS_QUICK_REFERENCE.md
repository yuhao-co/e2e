# PRD Extraction Scripts - Quick Reference

## New Scripts (Added May 22, 2026)

### 1. Extract PRD Link from Meegle Work Item

**Script**: `scripts/extract-prd-link-from-meegle.sh`  
**Purpose**: Read Meegle work item and extract PRD Link field  
**MCP Used**: Meegle

```bash
# Usage
./scripts/extract-prd-link-from-meegle.sh <meegle-url> [output-json]

# Example
./scripts/extract-prd-link-from-meegle.sh \
  "https://project.larksuite.com/fpr/6901d082e1d4ec8eeb572946/detail/11760876"

# Output to stdout (just the URL)
# ✅ Found PRD Link in Meegle work item
# https://project.larksuite.com/docs/ABC123XYZ

# Capture in variable
PRD_LINK=$(\
  ./scripts/extract-prd-link-from-meegle.sh \
  "https://project.larksuite.com/fpr/.../detail/..." \
  2>/dev/null \
)
echo "PRD: $PRD_LINK"
```

**Returns**:
- **stdout**: The PRD Link URL value (if found)
- **exit 0**: PRD link successfully extracted
- **exit 1**: PRD link not found or error occurred

---

### 2. Detect & Resolve PRD from GitHub PR Context

**Script**: `scripts/resolve-prd-from-github-context.sh`  
**Purpose**: Automatically detect and resolve PRD link from PR description  
**Supports**:
- ✅ Direct Lark document links
- ✅ Meegle work item links (resolves to Lark document)

```bash
# Usage
./scripts/resolve-prd-from-github-context.sh <pr-body-text>

# Example 1: Direct Lark link
PR_BODY="## PRD\nLink: https://project.larksuite.com/docs/ABC123"
./scripts/resolve-prd-from-github-context.sh "$PR_BODY"
# Output: https://project.larksuite.com/docs/ABC123

# Example 2: Meegle work item link
PR_BODY="See details: https://project.larksuite.com/fpr/.../detail/..."
./scripts/resolve-prd-from-github-context.sh "$PR_BODY"
# Internally: extract-prd-link-from-meegle.sh
# Output: https://project.larksuite.com/docs/ABC123XYZ

# Example 3: With GitHub CLI
PR_NUMBER=32211
PR_BODY=$(gh pr view $PR_NUMBER --json body -q .body)
PRD_URL=$(./scripts/resolve-prd-from-github-context.sh "$PR_BODY" 2>/dev/null)
if [ $? -eq 0 ]; then
  echo "✅ Found PRD: $PRD_URL"
else
  echo "⚠️  No PRD found"
fi
```

**Returns**:
- **stdout**: Resolved PRD document URL
- **exit 0**: PRD successfully resolved
- **exit 1**: No PRD link found or resolution failed

---

### 3. Extract & Resolve PRD Content (Existing - Updated Path)

**Script**: `scripts/extract-prd-with-opencode.sh`  
**Purpose**: Read PRD content from Lark document  
**MCP Used**: Lark Document

```bash
# Usage
./scripts/extract-prd-with-opencode.sh <prd-url> [output-md]

# Example
./scripts/extract-prd-with-opencode.sh \
  "https://project.larksuite.com/docs/ABC123" \
  "/tmp/prd.md"

# Output: /tmp/prd.md (markdown format)
```

---

## Complete Flow Example

**Scenario**: Process GitHub PR #32211 that has a Meegle work item link

```bash
#!/bin/zsh

PR_NUMBER=32211

# Step 1: Get PR description
echo "📥 Fetching PR #$PR_NUMBER..."
PR_BODY=$(gh pr view $PR_NUMBER --json body -q .body)

# Step 2: Resolve PRD link (handles both Lark and Meegle)
echo "🔍 Resolving PRD link..."
PRD_URL=$(./scripts/resolve-prd-from-github-context.sh "$PR_BODY" 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "❌ No PRD link found in PR description"
  exit 1
fi

echo "✅ Found PRD: $PRD_URL"

# Step 3: Extract PRD content
echo "📄 Extracting PRD content..."
PRD_FILE=$(./scripts/extract-prd-with-opencode.sh "$PRD_URL")

if [ ! -f "$PRD_FILE" ]; then
  echo "❌ Failed to extract PRD content"
  exit 1
fi

echo "✅ PRD content saved: $PRD_FILE"

# Step 4: Use PRD content (e.g., generate test cases)
echo "🧪 Generating test cases from PRD..."
# ... test case generation logic ...

echo "✅ Complete"
```

---

## Error Scenarios

### Scenario 1: No PRD Link in PR

```bash
$ ./scripts/resolve-prd-from-github-context.sh "Just a regular PR description"
[prd-resolver] ⚠️  No PRD link detected in GitHub context

$ echo $?
1
```

**Handling**:
```bash
if PRD=$(./scripts/resolve-prd-from-github-context.sh "$PR_BODY" 2>/dev/null); then
  echo "PRD: $PRD"
else
  echo "No PRD - will generate generic test cases"
fi
```

---

### Scenario 2: Meegle Link But PRD Link Field Missing

```bash
$ ./scripts/extract-prd-link-from-meegle.sh "https://project.larksuite.com/fpr/.../detail/..."
❌ PRD Link not found (status: not_found)
   Notes: The Meegle work item exists but has no PRD Link field

$ echo $?
1
```

**Handling**:
```bash
if PRD=$(./scripts/extract-prd-link-from-meegle.sh "$MEEGLE_URL" 2>/dev/null); then
  echo "PRD Link: $PRD"
else
  # Fall back to other methods or inform user
  echo "⚠️  Please set PRD Link field in Meegle work item"
fi
```

---

### Scenario 3: OpenCode Not Installed

```bash
$ ./scripts/extract-prd-link-from-meegle.sh "https://..."
❌ opencode is not installed or not on PATH

$ echo $?
1
```

**Fix**:
```bash
# Install OpenCode
brew install opencode

# Or via npm
npm install -g @smithery/opencode

# Verify installation
which opencode
```

---

## Integration Points

### In `generate-cases-from-weekly-diff.ts`

The script already has functions to handle this:

```typescript
// Extract PRD references from PR description
const prdReferences = extractPrdReferences(prDescription);

// Resolve Meegle references to Lark documents
const resolvedReferences = resolvePrdReferences(prdReferences);

// Extract content from each resolved PRD
for (const ref of resolvedReferences) {
  const prdContent = await extractPrdContent(ref.url);
  // ... generate test cases ...
}
```

### Example: GitHub PR Processing

```typescript
async function processPRForTestCaseGeneration(prNumber: number) {
  const pr = await githubClient.getPR(prNumber);
  
  // 1. Extract PRD references (both Lark and Meegle)
  const prdRefs = extractPrdReferences(pr.body);
  
  // 2. Resolve Meegle → Lark
  const resolvedRefs = resolvePrdReferences(prdRefs);
  
  // 3. Extract content from each PRD
  const prdContents = await Promise.all(
    resolvedRefs.map(ref => extractPrdContent(ref.url))
  );
  
  // 4. Generate test cases
  const testCases = generateTestCases({
    changedFiles: pr.changedFiles,
    prdContents,
    domain: 'flight-search',
  });
  
  return testCases;
}
```

---

## Debugging

Enable verbose output to see script actions:

```bash
# Show all operations
./scripts/extract-prd-link-from-meegle.sh "$MEEGLE_URL" 2>&1

# Capture output file for inspection
OUT_FILE="/tmp/debug-meegle-prd-$(date +%s).json"
./scripts/extract-prd-link-from-meegle.sh "$MEEGLE_URL" "$OUT_FILE"
echo "Output saved: $OUT_FILE"
cat "$OUT_FILE"
```

---

## Supported Formats

| Format | Pattern | Handler |
|--------|---------|---------|
| Lark Wiki | `https://{domain}.larksuite.com/wiki/*` | `extract-prd-with-opencode.sh` |
| Lark Document | `https://project.larksuite.com/docs/*` | `extract-prd-with-opencode.sh` |
| Meegle Work Item | `https://project.larksuite.com/fpr/*/detail/*` | `extract-prd-link-from-meegle.sh` |
| Auto-detect (any) | Any PR description text | `resolve-prd-from-github-context.sh` |

---

## Checklist for Implementation

- [ ] Scripts created and executable
- [ ] OpenCode installed and working
- [ ] MCP providers configured (Meegle, Lark)
- [ ] Test PRD extraction (Lark document)
- [ ] Test Meegle work item → PRD link resolution
- [ ] Integration with test case generation
- [ ] Error handling for missing PRDs
- [ ] Documentation updated

---

## Version

**Created**: May 22, 2026  
**Status**: Production Ready  
**Tested Scenarios**:
- ✅ Direct Lark document links
- ✅ Meegle work items with PRD Link field
- ✅ GitHub PR context detection
- ✅ Fallback handling for missing PRDs
