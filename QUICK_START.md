# 🚀 Weekly Diff System - Quick Reference

## 设置 Lark 通知（可选）

```bash
# 设置 Lark Webhook URL (生成和运行完成后自动通知)
export LARK_WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/xxx"

# 或在 .env 文件中设置
echo "LARK_WEBHOOK_URL=..." > .env
```

## One-Command Weekly Execution

```bash
# Generate + Run all cases + Send Lark notification (recommended for automation)
npx tsx scripts/generate-cases-from-weekly-diff.ts \
  --since-days 7 \
  --emit-web-spec \
  --run-cases \
  --run-mode full
```

## Common Workflows

### Generate New Cases Only
```bash
npx tsx scripts/generate-cases-from-weekly-diff.ts --since-days 7
```

### Run All Accumulated Cases
```bash
npx tsx scripts/run-accumulated-cases.ts --mode full
```

### Run Only Since Last Execution (Incremental)
```bash
npx tsx scripts/run-accumulated-cases.ts  # default is incremental
```

### Specific PR Only
```bash
npx tsx scripts/run-accumulated-cases.ts --pr-number 32211 --mode pr-focused
```

### Dry Run (See What Would Execute)
```bash
npx tsx scripts/generate-cases-from-weekly-diff.ts --dry-run
npx tsx scripts/run-accumulated-cases.ts --dry-run
```

## View Results

```bash
# Total accumulated cases
jq '.statistics.totalCases' generated-cases/manifest.json

# Latest run stats
jq '.runHistory[-1]' generated-cases/manifest.json

# Cases by domain
jq '.statistics.byDomain' generated-cases/manifest.json

# Failed cases
jq '.runHistory[-1].failedCases' generated-cases/manifest.json

# Pass rate percentage
jq '.runHistory[-1] | (.passed / .totalRun * 100)' generated-cases/manifest.json
```

## Directory Structure

```
generated-cases/
├─ manifest.json              ← Statistics + run history
├─ registry.yaml              ← Deduplication index
├─ pr-32211/                  ← Cases from PR #32211 (never deleted)
│  ├─ case-1.json
│  ├─ case-1-description.md
│  ├─ case-1.spec.ts          ← Runnable test
│  └─ _metadata.json
└─ pr-32212/                  ← New PR auto-added each week
```

## Key Flags

| Flag | Effect |
|------|--------|
| `--run-cases` | Execute tests after generation |
| `--run-mode full` | Run all cases (vs incremental) |
| `--emit-web-spec` | Write .spec.ts to tests/web/ |
| `--skip-blocked` | Skip anti-crawler blocked tests (default) |
| `--dont-skip-blocked` | Fail on blocked (strict mode) |
| `--dry-run` | Show what would happen |
| `--since-days 7` | Look back 7 days (default) |

## Element Locator Patterns (Auto-Generated)

These patterns are automatically embedded in generated test cases based on code changes:

### Search Form
```typescript
page.locator('[data-testid="desktop-default-form"]')
```

### Date Picker (Two-Level)
```typescript
// 1. Open picker
page.locator('[data-id="departure-date-container"]').click()
// 2. Select date
page.locator('[data-id="date-cell-2026-6-1"]').click()
```

### Sidebar Filters (Collapsed Groups)
```typescript
// 1. Expand
sidebar.locator('[data-id="IcSystemChevronDown"]').click()
// 2. Click option
sidebar.locator('label:has-text("Baggage")').click()
```

### Results Cards
```typescript
page.locator('[data-testid^="flight-inventory-card"]')
  .locator('[data-testid="button_ticket_option_select"]')
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No cases generated | Check git changes: `git diff --name-only origin/master` |
| Anti-crawler blocking | Default: auto-skip. For strict: `--dont-skip-blocked` |
| Cases not accumulating | Verify: `ls -la generated-cases/pr-*/` |
| Manifest not found | Run generator first: `--emit-web-spec` |
| Tests timeout | Use `--headed` mode to debug visually |

## Checklist Before Production

- [ ] session-data.json has valid cookies (check expiry)
- [ ] Master branch is up to date: `git fetch origin master`
- [ ] Test environment is clean: `rm -rf .playwright_cache` (if needed)
- [ ] Verify one dry-run: `--dry-run` flag
- [ ] Check manifest structure: `jq '.version' generated-cases/manifest.json`

## CI/CD Example

```yaml
name: Weekly Test Run
on:
  schedule:
    - cron: '0 9 * * MON'
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npx tsx scripts/generate-cases-from-weekly-diff.ts \
              --since-days 7 --emit-web-spec --run-cases
      - uses: actions/upload-artifact@v3
        with:
          name: results
          path: generated-cases/manifest.json
```

## Documentation

- **Full Guide**: [WEEKLY_DIFF_GUIDE.md](../WEEKLY_DIFF_GUIDE.md)
- **Implementation Status**: [INTEGRATION_STATUS.md](../INTEGRATION_STATUS.md)
- **Element Patterns**: See embedded comments in generated .spec.ts files

---

**Last Updated**: 2026-05-22  
**Status**: ✅ Production Ready
