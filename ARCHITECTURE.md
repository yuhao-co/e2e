# System Architecture & Data Flow

## 🔄 Complete Weekly Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                   WEEKLY DIFF GENERATION FLOW                   │
└─────────────────────────────────────────────────────────────────┘

1. CODE ANALYSIS
   ├─ git fetch origin/master
   ├─ git diff (last 7 days)
   ├─ Extract changed files
   └─ Route to domains: flight-search, flight-booking, etc.

2. CANDIDATE GENERATION
   ├─ Each changed file → candidate test case
   ├─ Extract intent: "verify search form works"
   ├─ Identify concerns: "input validation", "date selection"
   └─ Score confidence: high/medium/low

3. FOCUS FILTERING
   ├─ Filter: Only web desktop flight domains
   ├─ Ignore: android, home-i18n, generic-web
   └─ Result: ~10-20 relevant cases per week

4. DEDUPLICATION
   ├─ Generate intent hash: SHA256(domain + intent + concerns)
   ├─ Check registry.yaml: already exists?
   └─ Decision: Create new or skip duplicate

5. ACCUMULATION
   ├─ Create: generated-cases/pr-32211/ (or snapshot-DATE/)
   ├─ Write: case-N.json, case-N.md, case-N.spec.ts
   ├─ Update: manifest.json (statistics)
   └─ Update: registry.yaml (deduplication index)

6. OPTIONAL: AUTO-RUN (--run-cases flag)
   ├─ Find all *.spec.ts files
   ├─ Execute with npx playwright test
   ├─ Skip if anti-crawler detected
   └─ Record results to manifest.json
```

## 📊 Manifest Structure (manifest.json)

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
  
  "layers": {
    "baseline": {
      "frozen": true,
      "caseCount": 10,
      "description": "Core flight flows"
    },
    "committed": [
      {
        "id": "pr-32211",
        "type": "pr",
        "prNumber": 32211,
        "timestamp": "2026-05-22T08:00:00Z",
        "caseCount": 3,
        "domains": ["flight-search", "flight-booking"],
        "status": "active"
      },
      {
        "id": "pr-32212",
        "type": "pr",
        "prNumber": 32212,
        "timestamp": "2026-05-22T09:30:00Z",
        "caseCount": 10,
        "domains": ["flight-booking"],
        "status": "active"
      }
    ]
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

## 🎯 Case Runner Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   CASE RUNNER EXECUTION FLOW                    │
└─────────────────────────────────────────────────────────────────┘

1. LOAD MANIFEST
   ├─ Read: generated-cases/manifest.json
   ├─ Extract: runHistory, statistics
   └─ Fail if: manifest not found

2. SELECT CASES BY MODE
   ├─ incremental: Cases added since last run
   ├─ full: All active cases (from all pr-*/snapshot-*/ dirs)
   ├─ all: Everything including deprecated
   └─ pr-focused: Only --pr-number XXXXX

3. ITERATE & EXECUTE
   For each .spec.ts file:
   ├─ Run: npx playwright test FILE --headed
   ├─ Catch: error output
   ├─ Detect: is it anti-crawler blocking?
   │  ├─ Pattern: 403, 429, DataDome, reCAPTCHA
   │  ├─ If yes & --skip-blocked: Mark as "skipped"
   │  └─ If yes & --dont-skip-blocked: Mark as "failed"
   └─ Record: passed/failed/skipped

4. AGGREGATE RESULTS
   ├─ Count: passed, failed, skipped
   ├─ Collect: failed case names
   └─ Output: summary to console

5. UPDATE MANIFEST
   ├─ Add new entry to runHistory
   ├─ Update: timestamp, totalRun, passed, failed
   ├─ Append: failedCases list
   └─ Write: generated-cases/manifest.json

6. EXIT WITH STATUS
   ├─ Code 0: if failed == 0
   └─ Code 1: if failed > 0 (helps CI detect failures)
```

## 🧠 Element Locator Enhancement

```
┌─────────────────────────────────────────────────────────────────┐
│            SELF-LEARNING LOCATOR GENERATION                     │
└─────────────────────────────────────────────────────────────────┘

ANALYZE CHANGED FILES
  ├─ Input: ["src/components/date-picker.ts", "src/forms/search.ts"]
  └─ Patterns detected: ["date-picker", "search-form-control"]

MATCH PATTERNS TO LOCATORS
  
  date-picker pattern →
    ├─ Container: [data-id="departure-date-container"]
    ├─ Cells: [data-id="date-cell-YYYY-M-D"]
    ├─ Interaction: Two-step (click container, click cell)
    └─ Fallback: [data-testid*="date"]

  search-form pattern →
    ├─ Desktop: [data-testid="desktop-default-form"]
    ├─ Airport: [data-testid^="item_nimbus-autocomplete-airport-"]
    ├─ Interaction: Click input, select option
    └─ Fallback: form[data-testid], form[data-id]

  sidebar-filter pattern →
    ├─ Container: [data-testid="flight-search-sidebar-filter"]
    ├─ Chevron: [data-id="IcSystemChevronDown"]
    ├─ Interaction: Two-step (expand, then click)
    └─ Fallback: aside, nav, .sidebar

  results-card pattern →
    ├─ Card: [data-testid^="flight-inventory-card"]
    ├─ Button: [data-testid="button_ticket_option_select"]
    ├─ Interaction: Find semantic control in card
    └─ Fallback: [role="button"], button

GENERATE INTERACTION CODE
  ├─ Embed locator in test template
  ├─ Add comments with pattern explanation
  ├─ Include fallbacks for robustness
  └─ Result: .spec.ts file with enhanced locators
```

## 🔐 Deduplication Strategy (Intent Hash)

```
CASE 1: PR #32211
  Domain: flight-search
  Intent: "verify search form date picker"
  Concerns: ["date-selection", "input-validation"]
  Files: ["date-picker.ts", "search-form.ts"]
  
  Hash = SHA256("flight-search" + "date-picker" + 
                ["date-selection", "input-validation"] + 
                ["date-picker.ts", "search-form.ts"])
  = "abc123def456..."
  
  → Registry: ADDED with hash "abc123def456..."

---

CASE 2: PR #32212 (same changes, different PR)
  Domain: flight-search
  Intent: "verify search form date picker"
  Concerns: ["date-selection", "input-validation"]
  Files: ["date-picker.ts", "search-form.ts"]
  
  Hash = SHA256("flight-search" + "date-picker" + 
                ["date-selection", "input-validation"] + 
                ["date-picker.ts", "search-form.ts"])
  = "abc123def456..."
  
  → Registry: DUPLICATE DETECTED ✗
  → Action: SKIP (don't create duplicate test)
```

## 📁 Directory Structure Evolution

### Before (resetOutputDir Pattern)
```
generated-cases/
└─ latest/                    ← Deleted every week! 😰
   ├─ case-1.json
   └─ case-2.json
   
Risk: Lose all historical cases weekly
```

### After (Accumulation Pattern)
```
generated-cases/
├─ manifest.json              ← Central tracking
├─ registry.yaml              ← Deduplication index
├─ baseline/                  ← Frozen (core cases)
├─ pr-32211/                  ← PR #32211 cases (PERSISTS)
│  ├─ case-1.json
│  ├─ case-1.md
│  ├─ case-1.spec.ts          ← Runnable test
│  ├─ case-2.json
│  ├─ case-2.spec.ts
│  └─ _metadata.json
├─ pr-32212/                  ← PR #32212 cases (NEW, PERSISTS)
│  ├─ case-1.json
│  ├─ case-1.spec.ts
│  └─ ...
└─ snapshot-2026-05-22/       ← Time-based backup (optional)
   └─ ...

Benefit: No data loss, complete audit trail
```

## 🔄 Run History Tracking

```
manifest.json → runHistory array

[
  {
    "timestamp": "2026-05-15T09:00:00Z",
    "totalRun": 5,
    "passed": 5,
    "failed": 0,
    "failedCases": []
  },
  {
    "timestamp": "2026-05-22T09:00:00Z",
    "totalRun": 8,
    "passed": 6,
    "failed": 2,
    "failedCases": ["pr-32212-case-1", "pr-32212-case-3"]
  }
]

Analytics possible:
├─ Trend: Pass rate over time
├─ Regression: Which cases started failing?
├─ Stability: Most reliable cases
└─ Blocking: Which cases hit anti-crawler?
```

## ⚡ Performance & Efficiency

```
Weekly cycle (7-day window):

~100-200 changed files
  ↓ (filter by extension)
~50-100 relevant files
  ↓ (route by domain)
~15-25 candidates
  ↓ (focus filter: web desktop flight)
~10-15 focused candidates
  ↓ (deduplication: intent hash)
~7-12 new unique cases
  ↓ (accumulate to pr-XXXXX/)
~7-12 new .spec.ts files in tests/web/

Total accumulation: ~15-20 cases/week
After 4 weeks: ~60-80 cases total
Expected run time: ~30-60 minutes full suite
Incremental run time: ~5-15 minutes (new cases only)
```

---

Generated: 2026-05-22  
System Version: 1.0 - Production Ready
