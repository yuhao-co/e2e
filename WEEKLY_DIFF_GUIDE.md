# Weekly Diff Case Generation & Execution - Complete Integration Guide

## 🚀 Quick Start

### Generate weekly diff cases with accumulation
```bash
# Generate with focus on flight booking & search, auto-run cases
npx tsx scripts/generate-cases-from-weekly-diff.ts \
  --since-days 7 \
  --emit-web-spec \
  --run-cases

# Or separate steps:
# Step 1: Generate cases (accumulates without deleting)
npx tsx scripts/generate-cases-from-weekly-diff.ts \
  --since-days 7 \
  --emit-web-spec

# Step 2: Run all accumulated cases
npx tsx scripts/run-accumulated-cases.ts --mode full
```

## 📋 System Architecture

### Three-Layer Accumulation System

```
generated-cases/
├─ manifest.json                    ← Central index + statistics
├─ registry.yaml                    ← Deduplication registry
├─ pr-32211/                        ← By PR number (never deleted)
│  ├─ case-1-feature-x.json
│  ├─ case-2-feature-y.json
│  └─ _metadata.json
├─ pr-32212/                        ← New PR auto-added
├─ snapshot-2026-05-22/             ← Time-based snapshots (optional)
└─ baseline/                        ← Core frozen cases
```

### Key Differences from Old System

| Aspect | Old (resetOutputDir) | New (Accumulation) |
|--------|---------------------|-------------------|
| Output dir | `latest/` (always reset) | `pr-XXXXX/` (never deleted) |
| Case growth | Lost weekly | Permanent, deduplicated |
| Tracking | No history | Full manifest + run history |
| Deduplication | Manual | Automatic (intent hash) |
| Run modes | Full only | incremental / full / pr-focused |

## 🔄 Weekly Workflow

### Day 1: Generate Cases
```bash
# 1. Pull latest master
git fetch origin master

# 2. Generate new cases (auto-detects PR from git log)
npx tsx scripts/generate-cases-from-weekly-diff.ts \
  --fetch \
  --emit-web-spec

# Result: generated-cases/pr-XXXXX/ directory created with new cases
# Manifest updated: statistics + run history recorded
```

### Day 1-2: Run & Validate
```bash
# Run all accumulated cases, skip if anti-crawler blocks
npx tsx scripts/run-accumulated-cases.ts --mode full

# Or target specific PR
npx tsx scripts/run-accumulated-cases.ts --mode full --pr-number 32211

# Output: manifest.json updated with run results
```

### Inspect Results
```bash
# View manifest statistics
cat generated-cases/manifest.json | jq '.statistics'

# View run history
cat generated-cases/manifest.json | jq '.runHistory[-1]'

# List all accumulated cases
find generated-cases -name "*.spec.ts" | wc -l
```

## 🎯 Command Reference

### generate-cases-from-weekly-diff.ts

**Core Options:**
```bash
--repo-path <path>              Git repository path (default: cwd)
--since-days <n>               Days to look back (default: 7)
--base-ref <ref>               Base reference (default: origin/master)
--output-dir <dir>             Output directory (default: generated-cases)
--emit-web-spec                Write runnable .spec.ts to tests/web/
--fetch                        Fetch origin before comparing (default: true)
--no-fetch                     Skip fetch

--dry-run                      Show what would be generated
--run-cases                    Run generated cases immediately
--dont-skip-blocked            Don't skip anti-crawler blocked cases
--run-mode incremental         Only newly generated cases (default)
--run-mode full                All active cases
--run-mode pr-focused          Only PR-specific cases
```

**Examples:**
```bash
# Dry-run to inspect without writing
npx tsx scripts/generate-cases-from-weekly-diff.ts --dry-run

# Generate + run immediately
npx tsx scripts/generate-cases-from-weekly-diff.ts --run-cases

# Generate and fail on any blocked test (don't skip)
npx tsx scripts/generate-cases-from-weekly-diff.ts --dont-skip-blocked --run-cases
```

### run-accumulated-cases.ts

**Modes:**
```bash
--mode incremental             Run only cases added since last run (default)
--mode full                    Run all active cases
--mode all                     Run everything including deprecated
--mode pr-focused              Only run for specific PR (requires --pr-number)
```

**Options:**
```bash
--pr-number <num>              PR number for pr-focused mode
--dont-skip-blocked            Fail on anti-crawler, don't skip
--output-dir <dir>             Override generated-cases directory
--dry-run                      Show what would run without executing
```

**Examples:**
```bash
# Run incremental (since last execution)
npx tsx scripts/run-accumulated-cases.ts

# Run all with blocking tests failing (strict mode)
npx tsx scripts/run-accumulated-cases.ts --mode full --dont-skip-blocked

# Specific PR only
npx tsx scripts/run-accumulated-cases.ts --pr-number 32211 --mode pr-focused

# Dry-run: see what would execute
npx tsx scripts/run-accumulated-cases.ts --dry-run
```

## 🧠 Self-Learning: Enhanced Element Locators

### Data-TestID Strategy
The system now generates test cases with improved element locator accuracy using Traveloka's `data-testid` and `data-id` patterns:

```typescript
// ✅ Recommended: Use data-testid/data-id (highest priority)
const searchForm = page.locator('[data-testid="desktop-default-form"]');
const dateContainer = page.locator('[data-id="departure-date-container"]');

// ✅ Also good: Semantic controls inside data-testid containers
const chooseButton = resultCard.locator('[data-testid="button_ticket_option_select"]');

// ⚠️  Fallback: Text matching (less reliable)
const button = page.locator('button:has-text("Choose")');

// ❌ Avoid: Generic CSS (too broad)
const button = page.locator('button'); // Could match wrong element
```

### Key Patterns for Flight Domain

#### 1. Search Form Selection
```typescript
// Desktop form by data-testid
const form = page.locator('[data-testid="desktop-default-form"]');

// Airport autocomplete options
const airportOption = page.locator(
  '[data-testid="item_nimbus-autocomplete-airport-cgk"]'
);
```

#### 2. Date Picker Interaction (Two-Level)
```typescript
// Level 1: Open picker via container
const dateContainer = page.locator('[data-id="departure-date-container"]');
await dateContainer.click();

// Level 2: Select specific date
const dateCell = page.locator('[data-id="date-cell-2026-6-1"]');
await dateCell.click();
```

#### 3. Sidebar Filters (Collapsed Groups)
```typescript
// Important: Two-step pattern for "Facilities > Baggage"
// Step 1: Expand collapsed section
const chevron = sidebar.locator('[data-id="IcSystemChevronDown"]').first();
await chevron.click();

// Step 2: Then click the nested option
const baggageCheckbox = sidebar.locator('label:has-text("Baggage")');
await baggageCheckbox.click();
```

#### 4. Results Card Selection
```typescript
// Find flight card by data-testid
const card = page.locator('[data-testid^="flight-inventory-card"]').first();

// Select using semantic button within card
const chooseBtn = card.locator('[data-testid="button_ticket_option_select"]');
await chooseBtn.click();
```

### Auto-Generated Recommendations

The system analyzes changed files and suggests enhanced locators:

```
✓ Date picker changes detected
  → Use data-id="*-date-container" for containers
  → Select dates with data-id="date-cell-YYYY-M-D" pattern

✓ Sidebar filter changes detected
  → Remember two-step expansion for collapsed groups
  → Click [data-id="IcSystemChevronDown"] first

✓ Search form changes detected
  → Use data-testid="desktop-default-form" for desktop
  → Airport: data-testid="item_nimbus-autocomplete-airport-*"

✓ Results page changes detected
  → Use semantic controls inside [data-testid^="flight-inventory-card"]
  → Select with [data-testid="button_ticket_option_select_N"]
```

## 📊 Manifest Structure

```json
{
  "version": "1.0",
  "lastUpdated": "2026-05-22T10:30:00Z",
  "statistics": {
    "totalCases": 23,
    "byDomain": {
      "flight-search": 12,
      "flight-booking": 11
    },
    "byStatus": {
      "active": 23,
      "deprecated": 0
    }
  },
  "runHistory": [
    {
      "timestamp": "2026-05-22T10:00:00Z",
      "totalRun": 23,
      "passed": 20,
      "failed": 3,
      "failedCases": ["pr-32211-case-2", "pr-32212-case-1"]
    }
  ]
}
```

## ⚙️ Troubleshooting

### Issue: Anti-crawler blocking tests
```
→ Use --skip-blocked (default) to auto-skip blocked cases
→ Or rotate IP/use proxy if persistent
→ Check: Does session-data.json have valid cookies?
```

### Issue: Cases not accumulating
```
→ Check: generated-cases/manifest.json exists?
→ Check: Is accumulation-orchestrator.ts imported correctly?
→ Check: Are PR numbers being detected from git log?
```

### Issue: Duplicate cases being created
```
→ Intent hash should prevent duplicates
→ Check registry.yaml for intent hash conflicts
→ Run with --dry-run first to inspect
```

### Issue: Tests timing out
```
→ Increase Playwright timeout: npx playwright test --config=...
→ Add delays between interactions for anti-crawler evasion
→ Use --headed mode to debug visually
```

## 🔄 Integration with CI/CD

```yaml
# Example GitHub Actions workflow
name: Weekly Test Generation & Execution

on:
  schedule:
    - cron: '0 9 * * MON'  # Every Monday 9am

jobs:
  generate-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Generate cases and run
        run: |
          npx tsx scripts/generate-cases-from-weekly-diff.ts \
            --since-days 7 \
            --emit-web-spec \
            --run-cases \
            --run-mode full
      
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: generated-cases/manifest.json
```

## 📈 Metrics & Monitoring

```bash
# Total cases accumulated
jq '.statistics.totalCases' generated-cases/manifest.json

# Pass rate from last run
jq '.runHistory[-1] | .passed / .totalRun * 100' generated-cases/manifest.json

# Failed cases
jq '.runHistory[-1].failedCases' generated-cases/manifest.json

# Cases by domain
jq '.statistics.byDomain' generated-cases/manifest.json
```

## 🎓 Learning Resources

- **Generated Specs**: `tests/web/*.spec.ts` - Executable test templates
- **Accumulation Logic**: `scripts/lib/accumulation-*.ts` - Deduplication & manifest
- **Element Locators**: `scripts/lib/enhanced-locator-generator.ts` - Traveloka patterns
- **Flight Domain**: `tests/lib/traveloka-flight/` - Reference implementations

---

**Last Updated**: 2026-05-22  
**System Version**: 1.0 (Accumulation + Auto-Run)
