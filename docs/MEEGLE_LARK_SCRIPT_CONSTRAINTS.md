# MEEGLE/LARK SCRIPT CONSTRAINTS
## Strict Protection Policy for Critical Data Access Scripts

**Last Updated:** 2025-05-22  
**Status:** ACTIVE - DO NOT MODIFY

---

## Protected Scripts

These scripts are critical for PRD (Product Requirement Document) retrieval and **MUST NEVER FAIL** in production:

1. **`scripts/resolve-meegle-prd-link-with-opencode.sh`**
   - Purpose: Resolve Meegle URLs to their internal PRD links via MCP APIs
   - Mode: **READ ONLY** - No modifications to Meegle/Lark allowed
   - Failure Tolerance: **ZERO** - Failures are unacceptable
   - Dependencies: `opencode`, `jq`, `zsh`

2. **`scripts/extract-prd-link-safely.sh`**
   - Purpose: Extract and validate PRD links from opencode JSON output
   - Mode: **VALIDATION & EXTRACTION ONLY**
   - Failure Tolerance: **ZERO** - Must validate all outputs
   - Dependencies: `jq`, `zsh`

---

## Critical Constraints

### 🔒 Read-Only Mode
- **No modifications to Meegle items**
- **No updates to Lark documents**
- **No creation of new resources**
- **No deletion of any data**
- **No write-back operations**

### ⏱️ Timeout Protection
- `opencode` execution: **120 seconds max**
- Total retry window: **3 attempts with 5s backoff**
- JSON validation: **strict parsing required**

### 🛡️ Validation Rules
1. **Precondition Checks:**
   - opencode binary must exist on PATH
   - jq must be available
   - Output directory must be writable

2. **JSON Validation:**
   - Must be valid JSON (parseable by jq)
   - Must contain `accessStatus` field
   - Must contain proper error details if failed
   - File size must not exceed 100KB

3. **URL Validation:**
   - PRD links must start with `https://`
   - Must match Larksuite domain pattern
   - Must be non-empty strings

### 🔄 Retry Strategy
```
Attempt 1 → timeout 120s → if fail, wait 5s
Attempt 2 → timeout 120s → if fail, wait 5s
Attempt 3 → timeout 120s → if fail, DIE
```

### 📋 Error Reporting
All failures must include:
- **Explicit error message** (must start with "❌ FATAL")
- **Root cause** (timeout, validation failure, unauthorized, etc.)
- **Last attempted operation** (which opencode call failed)
- **Exit code** (non-zero for any failure)

---

## Modification Policies

### ✅ ALLOWED Changes
- Bug fixes in error handling or validation logic
- Adding new validation checks or constraints
- Improving logging or error messages
- Increasing timeout values or retry counts
- Adding new precondition checks

### ❌ FORBIDDEN Changes
- Reducing timeout values
- Removing error checking code
- Removing validation steps
- Changing error exit behavior
- Adding modification/write operations to Meegle/Lark
- Removing the `set -euo pipefail` strict mode settings
- Changing the prompt constraints that forbid modifications

---

## Testing Requirements

Before deployment, verify:

```bash
# 1. Script syntax validation
zsh -n scripts/resolve-meegle-prd-link-with-opencode.sh
zsh -n scripts/extract-prd-link-safely.sh

# 2. Precondition checks
command -v opencode
command -v jq
command -v zsh

# 3. Timeout enforcement
timeout 125 ./scripts/resolve-meegle-prd-link-with-opencode.sh <test-url>

# 4. JSON validation
./scripts/extract-prd-link-safely.sh <output-json>
```

---

## Failure Escalation

| Scenario | Action |
|----------|--------|
| **opencode not found** | DIE immediately with PATH message |
| **jq validation fails** | DIE with JSON structure details |
| **Timeout on all 3 attempts** | DIE with timeout message |
| **Access denied (unauthorized)** | Report in JSON, fail gracefully |
| **Invalid JSON output** | DIE with validation error |

---

## Code Review Checklist

🔍 **Before any modification:**
- [ ] Change is either a bug fix or improvement to error handling
- [ ] No timeout values are reduced
- [ ] No error checks are removed
- [ ] No write operations are added to Meegle/Lark
- [ ] `set -euo pipefail` remains at top of script
- [ ] All precondition checks are still present
- [ ] JSON validation is not weakened

---

## Maintenance Procedures

### Weekly Verification
```bash
# Verify scripts are still executable
ls -la scripts/resolve-meegle-prd-link-with-opencode.sh
ls -la scripts/extract-prd-link-safely.sh

# Check constraints document
cat docs/MEEGLE_LARK_SCRIPT_CONSTRAINTS.md
```

### Monthly Audit
- Review recent changes to these scripts
- Verify no write operations were introduced
- Check opencode/jq versions for compatibility
- Test against current Meegle instance

### Emergency Rollback
If either script fails in production:
1. Immediately revert to last known-good version
2. Preserve the failed JSON output for debugging
3. Report the failure with full error details
4. DO NOT attempt modifications until root cause is identified

---

## Documentation Links

- **Implementation Guide:** See inline comments in scripts
- **Error Handling:** Each function documents its failure modes
- **Test Examples:** See QUICK_START.md for usage patterns

---

**Remember:** These scripts are the ONLY production-safe way to read Meegle/Lark data. Failures cascade through the entire PRD extraction pipeline. **Absolute reliability is non-negotiable.**
