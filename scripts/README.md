# Scripts Usage Policy

## 🔒 LOCKED WORKFLOW - SINGLE ENTRY POINT

All scripts in this directory are **LOCKED** for direct execution.

### ✅ CORRECT USAGE

Use the **single authorized entry point**:

```bash
npx tsx scripts/weekly-diff-workflow.ts [options]
```

This orchestrates all sub-scripts in the correct order with proper validation.

### ❌ INCORRECT USAGE (DO NOT DO)

```bash
# ❌ DON'T call scripts directly
npx tsx scripts/generate-cases-from-weekly-diff.ts
npx tsx scripts/run-accumulated-cases.ts
npx tsx scripts/lib/lark-notifier.ts

# ❌ DON'T skip workflow stages
npm run test:web -- tests/web/*.spec.ts  # Bypass case generation
```

---

## 📋 Script Directory

### Core Entry Point (DO USE)
- **weekly-diff-workflow.ts** - Main orchestrator (LOCKED, read-only)

### Meegle/Lark Integration (READ-ONLY, CRITICAL)
These scripts retrieve PRD data from Meegle and Lark. **ZERO failure tolerance.**

- **resolve-meegle-prd-link-with-opencode.sh** ⚠️ CRITICAL
  - Resolve Meegle URLs to internal PRD links via MCP APIs
  - Usage: `./scripts/resolve-meegle-prd-link-with-opencode.sh <url> [output-json]`
  - Output: JSON with PRD metadata and Lark link
  - Returns: Exit code 0 (success) or 1 (failure)
  - **READ-ONLY:** No modifications to Meegle/Lark allowed
  - **HARDENED:** Timeout 120s, 3x retry with 5s backoff, strict JSON validation

- **extract-prd-link-safely.sh** ⚠️ CRITICAL  
  - Extract and validate PRD link from JSON output
  - Usage: `./scripts/extract-prd-link-safely.sh <json-file>`
  - Output: PRD URL string (stdout)
  - Returns: Exit code 0 (success) or 1 (validation failed)
  - **VALIDATION:** File existence, readability, JSON syntax, URL format

**See Also:**
- `docs/MEEGLE_LARK_SCRIPT_CONSTRAINTS.md` - Enforcement & modification policies
- `docs/MEEGLE_LARK_VALIDATION_TESTING.md` - Usage examples & troubleshooting

### Sub-Scripts (Internal only)
- **generate-cases-from-weekly-diff.ts** - Case generation (called by workflow)
- **run-accumulated-cases.ts** - Test execution (called by workflow)

### Libraries (Internal only)
- **lib/accumulation-manifest.ts** - Manifest management (internal)
- **lib/accumulation-orchestrator.ts** - Case orchestration (internal)
- **lib/enhanced-locator-generator.ts** - Locator patterns (internal)
- **lib/lark-notifier.ts** - Notifications (internal)

### Utilities (Reference only)
- **run-with-lark-notify.ts** - Legacy (do not use)

---

## 🚀 Examples

### Weekly Report Generation
```bash
# Full workflow: generate + run + notify
npx tsx scripts/weekly-diff-workflow.ts --since-days 7 --emit-web-spec

# With environment variable for Lark
LARK_WEBHOOK_URL="https://..." npx tsx scripts/weekly-diff-workflow.ts
```

### Debug Mode
```bash
# Generate cases but skip execution
npx tsx scripts/weekly-diff-workflow.ts --skip-run

# Longer analysis window
npx tsx scripts/weekly-diff-workflow.ts --since-days 14
```

### Help
```bash
npx tsx scripts/weekly-diff-workflow.ts --help
```

---

## ⚙️ Configuration

See [WORKFLOW_LOCKED_SPEC.md](../WORKFLOW_LOCKED_SPEC.md) for:
- Allowed customization options
- Locked constraints
- Change control process
- Emergency procedures

---

**Status**: LOCKED  
**Last Updated**: 2026-05-22  
**Do not modify scripts directly - use workflow entry point**
