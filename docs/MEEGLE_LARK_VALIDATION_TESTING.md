# Meegle/Lark Scripts - Validation & Testing Guide

**Created:** 2025-05-22  
**Status:** READY FOR PRODUCTION USE

---

## Scripts Overview

### 1. resolve-meegle-prd-link-with-opencode.sh
**Function:** Resolve Meegle URLs to PRD links via MCP APIs  
**Input:** Meegle work item URL  
**Output:** JSON file with PRD metadata  
**Exit Code:** 0 (success) or 1 (failure)

### 2. extract-prd-link-safely.sh
**Function:** Extract and validate PRD link from JSON output  
**Input:** JSON file path  
**Output:** PRD URL string (stdout)  
**Exit Code:** 0 (success) or 1 (validation failed)

---

## Precondition Validation

Before running scripts, verify:

```bash
# Check opencode availability
$ command -v opencode
/Users/yu.hao/.opencode/bin/opencode

# Check jq availability
$ command -v jq
/usr/local/bin/jq

# Check zsh
$ command -v zsh
/bin/zsh
```

**If any command is missing:**
- Install opencode from: https://opencode.traveloka.com/
- Install jq: `brew install jq`
- zsh should be available on macOS by default

---

## Usage Examples

### Example 1: Basic PRD Resolution

```bash
# Step 1: Resolve Meegle URL to PRD link
./scripts/resolve-meegle-prd-link-with-opencode.sh \
  "https://project.larksuite.com/fpr/BIcA/detail/DcPb" \
  /tmp/prd-output.json

# Output: /tmp/prd-output.json

# Step 2: Extract PRD link from JSON
./scripts/extract-prd-link-safely.sh /tmp/prd-output.json

# Output: https://traveloka.sg.larksuite.com/docx/BIcAdsOQtoMr...
```

### Example 2: With Default Output Path

```bash
# Output will be generated in /tmp with timestamp
./scripts/resolve-meegle-prd-link-with-opencode.sh \
  "https://project.larksuite.com/fpr/BIcA/detail/DcPb"

# Returns: /tmp/opencode-meegle-prd-20250522-112345.json
```

### Example 3: Error Handling

```bash
# Invalid URL format
$ ./scripts/resolve-meegle-prd-link-with-opencode.sh "invalid-url"
❌ FATAL: Invalid Meegle URL format...
exit code: 1

# Missing JSON file
$ ./scripts/extract-prd-link-safely.sh "/tmp/nonexistent.json"
❌ FATAL: JSON file not found: /tmp/nonexistent.json
exit code: 1

# Corrupted JSON
$ ./scripts/extract-prd-link-safely.sh "/tmp/bad.json"
❌ FATAL: Invalid JSON format: /tmp/bad.json
exit code: 1
```

---

## Expected JSON Output Structure

### Successful Resolution
```json
{
  "sourceUrl": "https://project.larksuite.com/fpr/BIcA/detail/DcPb",
  "projectId": "BIcA",
  "detailId": "DcPb",
  "timestamp": "2025-05-22T11:23:45.123Z",
  "accessStatus": "success",
  "prdLink": "https://traveloka.sg.larksuite.com/docx/BIcAdsOQtoMrUHxO6kelWLkOgMb",
  "prdTitle": "Q2 2026 - [PRD][Flight] [Traveloka only] Double Email Confirmation",
  "summary": "Traveloka flight booking requires double email confirmation..."
}
```

### Access Denied
```json
{
  "sourceUrl": "https://project.larksuite.com/fpr/...",
  "projectId": "...",
  "detailId": "...",
  "timestamp": "2025-05-22T11:24:00.000Z",
  "accessStatus": "unauthorized",
  "prdLink": null,
  "prdTitle": null,
  "summary": null,
  "errorDetails": "MCP Meegle returned 403 Unauthorized"
}
```

### No PRD Link Found
```json
{
  "sourceUrl": "https://project.larksuite.com/fpr/...",
  "projectId": "...",
  "detailId": "...",
  "timestamp": "2025-05-22T11:25:00.000Z",
  "accessStatus": "no_prd_link",
  "prdLink": null,
  "prdTitle": null,
  "summary": null,
  "errorDetails": "Meegle item contains no PRD reference"
}
```

---

## Validation Checklist

### Pre-Execution
- [ ] `opencode` is installed and on PATH
- [ ] `jq` is installed and available
- [ ] Meegle URL is in correct format: `https://project.larksuite.com/fpr/<pid>/detail/<did>`
- [ ] Output directory exists or is writable
- [ ] User has access to the Meegle item

### Post-Execution
- [ ] JSON file was created at expected path
- [ ] JSON is valid and parseable
- [ ] `accessStatus` field is present
- [ ] If `accessStatus == "success"`, `prdLink` is a valid URL
- [ ] Exit code matches expected result (0 for success, 1 for failure)

### Error Scenarios
- [ ] Timeout after 120 seconds (retries 3x with 5s backoff)
- [ ] opencode not found → clear PATH error
- [ ] jq not found → clear dependency error
- [ ] Invalid JSON output → validation error with details
- [ ] Network failure → explicit error in JSON

---

## Troubleshooting

### Issue: "opencode is not installed or not on PATH"

**Solution:**
```bash
# Verify opencode location
ls -la ~/.opencode/bin/opencode

# Add to PATH manually (if needed)
export PATH="${HOME}/.opencode/bin:${PATH}"

# Test
opencode --version
```

### Issue: Script times out after 120 seconds

**Possible causes:**
- Network connectivity issue
- Meegle server is slow
- opencode executable is stuck

**Solution:**
```bash
# Run with verbose monitoring
time ./scripts/resolve-meegle-prd-link-with-opencode.sh "<url>"

# Check if opencode is still running
ps aux | grep opencode

# Retry manually
./scripts/resolve-meegle-prd-link-with-opencode.sh "<url>"
```

### Issue: JSON validation fails

**Check file contents:**
```bash
# View JSON
cat /tmp/opencode-meegle-prd-*.json | jq .

# Check file size
ls -lh /tmp/opencode-meegle-prd-*.json

# Validate JSON syntax
jq empty /tmp/opencode-meegle-prd-*.json
```

### Issue: "No PRD link found"

**Possible causes:**
- Meegle item doesn't have a PRD link
- PRD was deleted from the item
- User doesn't have read access to the PRD

**Solution:**
```bash
# Check JSON output for details
./scripts/extract-prd-link-safely.sh /tmp/output.json 2>&1
# Look for "errorDetails" field in JSON
cat /tmp/output.json | jq '.errorDetails'
```

---

## Integration with Other Scripts

### Using in generate-cases workflow

```bash
#!/bin/zsh

# Get PRD for a Meegle item
MEEGLE_URL="https://project.larksuite.com/fpr/BIcA/detail/DcPb"
JSON_OUTPUT=$(/Users/yu.hao/Desktop/task/e2e/scripts/resolve-meegle-prd-link-with-opencode.sh "$MEEGLE_URL")

if [[ $? -ne 0 ]]; then
  echo "Failed to resolve PRD" >&2
  exit 1
fi

# Extract PRD link
PRD_LINK=$(/Users/yu.hao/Desktop/task/e2e/scripts/extract-prd-link-safely.sh "$JSON_OUTPUT")

# Use PRD_LINK in downstream processing
echo "Using PRD: $PRD_LINK"
```

---

## Monitoring & Logging

### Enable detailed logging

```bash
# Run with trace mode
bash -x ./scripts/resolve-meegle-prd-link-with-opencode.sh "<url>"

# Capture stderr
./scripts/resolve-meegle-prd-link-with-opencode.sh "<url>" 2>&1 | tee /tmp/run.log
```

### Log rotation (for CI/CD)

```bash
# Clean old output files weekly
find /tmp -name "opencode-meegle-prd-*.json" -mtime +7 -delete

# Archive successful runs
mkdir -p logs/prd-resolution
cp /tmp/opencode-meegle-prd-*.json logs/prd-resolution/
```

---

## Performance Benchmarks

| Operation | Time (typical) | Timeout |
|-----------|---|---|
| Meegle work item fetch | 2-5s | 120s |
| Lark document read | 3-8s | 120s |
| JSON validation | <100ms | N/A |
| PRD link extraction | <50ms | N/A |
| **Total (end-to-end)** | **5-15s** | **120s/attempt** |

---

## Production Checklist

Before deploying to production:

- [ ] Both scripts pass syntax validation (`zsh -n`)
- [ ] Scripts are executable (`chmod +x`)
- [ ] Preconditions met (opencode, jq installed)
- [ ] Test runs complete successfully
- [ ] JSON output is valid and expected
- [ ] Error handling is tested with invalid inputs
- [ ] Timeout protection works (doesn't hang)
- [ ] Retry logic verified (3 attempts + backoff)
- [ ] All team members reviewed MEEGLE_LARK_SCRIPT_CONSTRAINTS.md
- [ ] Scripts are added to critical-fixes-do-not-touch.md
- [ ] Integration with case-generation pipeline tested
