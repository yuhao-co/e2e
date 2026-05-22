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
