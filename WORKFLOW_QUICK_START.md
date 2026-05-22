# 🔒 LOCKED WORKFLOW - QUICK START

## One-Command Everything

```bash
# Standard weekly run
npx tsx scripts/weekly-diff-workflow.ts --since-days 7 --emit-web-spec
```

That's it! The workflow:
1. ✅ Validates all dependencies
2. ✅ Generates test cases
3. ✅ Verifies case accumulation
4. ✅ Runs all tests
5. ✅ Sends Lark notification
6. ✅ Archives results

---

## Available Options

```bash
--since-days <n>      # Days back to analyze (default: 7)
--emit-web-spec       # Generate .spec.ts files (optional)
--skip-run            # Skip test execution (debug only)
--help                # Show full help
```

---

## With Lark Notifications (Optional)

```bash
# Set webhook URL once
export LARK_WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/xxx"

# Then run workflow - notifications auto-send
npx tsx scripts/weekly-diff-workflow.ts --since-days 7 --emit-web-spec
```

---

## Output Location

Results automatically saved to:

```
generated-cases/
├─ manifest.json           # Statistics & run history
├─ registry.yaml           # Case index & deduplication
├─ pr-XXXXX/              # New cases (never deleted)
└─ _archives/             # Timestamped snapshots
```

View results:
```bash
# Stats
jq '.statistics' generated-cases/manifest.json

# Latest run
jq '.runHistory[-1]' generated-cases/manifest.json

# Failed cases
jq '.runHistory[-1].failedCases' generated-cases/manifest.json
```

---

## ✅ Validation Checklist

Before first run:
- [ ] Git repo initialized
- [ ] `session-data.json` exists (with valid cookies)
- [ ] `playwright.config.ts` exists
- [ ] `tsconfig.json` exists
- [ ] Node modules installed: `npm install`

---

## 🆘 If Something Breaks

The workflow is **LOCKED** - direct modifications not allowed.

### Emergency: Run individual stages
```bash
# Just generate cases
npx tsx scripts/generate-cases-from-weekly-diff.ts

# Just run tests
npx tsx scripts/run-accumulated-cases.ts --mode full
```

### Report Issues
File an issue with:
- What failed (stage name)
- Full error message
- What you were trying to do

---

**Status**: LOCKED & READY  
**Version**: 1.0-LOCKED  
**Questions?** See [WORKFLOW_LOCKED_SPEC.md](WORKFLOW_LOCKED_SPEC.md)
