# P0 Critical Bug Detection System

## Architecture

```
┌─────────────────────────────────────────────────┐
│ config/p0-detection-rules.json                  │
│ (11 P0 rule definitions + metadata)             │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ tests/lib/generic-bug-detector.ts               │
│ - GenericBugDetector class                      │
│ - detectP0Issues() method (implements rules)    │
│ - runFullAudit() calls P0 checks first         │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   ┌────────────┐      ┌─────────────────┐
   │ Playwright │      │ Bug Detection   │
   │ Test Suite │      │ Collector       │
   └────────────┘      └─────────────────┘
        │                     │
        └──────────┬──────────┘
                   ▼
        ┌──────────────────────┐
        │ scripts/             │
        │ analyze-p0-bugs.ts   │
        │ (Integration point)  │
        └──────────┬───────────┘
                   │
        ┌──────────┴──────────────┐
        ▼                         ▼
    ┌─────────┐          ┌──────────────────┐
    │ Lark    │          │ test-results/    │
    │ Alert   │          │ p0-analysis-     │
    │ (if P0) │          │ results.json     │
    └─────────┘          └──────────────────┘
```

## How to Update P0 Rules

### Step 1: Add/Modify Rule in config/p0-detection-rules.json

```json
{
  "id": "page_blank",
  "name": "Page is Blank/Unreadable",
  "description": "Main content area is completely empty",
  "checks": [
    "DOM has no meaningful content (less than 100 characters of text)",
    "..."
  ],
  "impact": "Users cannot view any content",
  "affectedFlows": ["flight-search", "flight-booking"]
}
```

### Step 2: Implement in detectP0Issues() Method

In `tests/lib/generic-bug-detector.ts`, add the detection logic:

```typescript
// Example: Adding new P0 rule
const newIssue = await this.page.evaluate(() => {
  // Your detection logic here
  return issue;
});

if (newIssue) {
  this.bugs.push({
    id: `p0_new_issue_${Date.now()}`,
    issue: 'new_issue_id',
    category: 'functional',
    severity: 'P0',
    description: 'Description of the issue',
    evidence: { ...details },
    recommendation: 'How to fix it',
    detectionMethod: 'automatic',
  });
}
```

### Step 3: Test the New Rule

```bash
# Run P0 analysis
npm run analyze:p0

# Or just the generic bug detection tests
npm run test:bugs:generic
```

## Current P0 Rules (11 Total)

| ID | Name | Scope | Key Checks |
|----|------|-------|-----------|
| `page_blank` | Page is Blank | Both | Content length < 100 chars |
| `page_timeout` | Loading Timeout | Both | Load time > 30s |
| `search_form_broken` | Search Form Broken | Flight-Search | Button disabled, inputs frozen |
| `booking_form_broken` | Booking Form Broken | Flight-Booking | Submit button disabled, fields frozen |
| `payment_gateway_down` | Payment Unreachable | Flight-Booking | API returns 5xx |
| `data_corruption` | Data Lost/Corrupted | Both | undefined/NaN/null visible, corrupted prices |
| `security_breach` | Security Vulnerability | Both | XSS, CSRF, SQL errors |
| `critical_button_stuck` | Action Button Stuck | Both | pointer-events:none, display:none |
| `network_critical_error` | Core API Error | Both | 502/503/504 on critical APIs |
| `currency_missing` | Currency Missing | Both | Prices without currency symbol |
| `session_expired` | Session Expired | Flight-Booking | Auth token missing, 401 errors |

## Integration Points

### In Weekly-Diff Workflow
When you run `npm run weekly-diff`, it will:
1. Generate test cases from git diffs
2. Run bug detection on generated test cases
3. Flag any P0 issues found
4. Collect data for ML model training

### Manual P0 Analysis
```bash
# Run P0 analysis only
npm run analyze:p0

# Watch for changes and re-run
npm run analyze:p0:watch

# Run generic bug detection tests
npm run test:bugs:generic
```

### Bug Detection Data Pipeline
```
test-results → bug-detection-collector.ts → data/bug-detection/training-data.jsonl
                                          ↓
                               train-bug-classification-model.py
                                          ↓
                               models/bug-classification/*.pkl
```

## Future Enhancements

### v1.1 Planned
- [ ] Real-time monitoring integration
- [ ] Webhook notifications to external systems
- [ ] Automated regression report generation
- [ ] Dashboard for P0 tracking

### v2.0 Planned
- [ ] ML-based P0 prediction
- [ ] Automatic incident creation
- [ ] Multi-user bug report correlation
- [ ] Historical trend analysis

## Troubleshooting

### P0 Detection Not Working
1. Verify page is actually loading: Check DOM content length
2. Check Playwright browser compatibility: `npx playwright install`
3. Review console logs for async errors

### Rules Not Being Applied
1. Ensure rule is added to detectP0Issues() method
2. Check that pageType is correctly detected
3. Verify affected flows match your test URL

### False Positives
1. Adjust thresholds (e.g., content length, timeout)
2. Add more specific selectors for form elements
3. Implement context-aware checks

## Related Scripts & Files

- **Detection Engine**: `tests/lib/generic-bug-detector.ts` (700+ lines)
- **Integration Script**: `scripts/analyze-p0-bugs.ts`
- **Test Suite**: `tests/web/traveloka-generic-bug-detection.spec.ts`
- **Rules Config**: `config/p0-detection-rules.json`
- **Data Collection**: `scripts/bug-detection-collector.ts`
- **ML Training**: `scripts/train-bug-classification-model.py`

## Commands Quick Reference

```bash
# P0 Analysis
npm run analyze:p0              # Run P0 analysis
npm run analyze:p0:watch       # Watch and re-run on changes

# Bug Detection Tests
npm run test:bugs:generic      # Run all bug detection tests
npm run test:bugs:generic -- --grep "Flight Search"  # Filter tests

# Data Management
npm run bug-data:stats         # Show training data statistics
npm run bug-data:validate      # Validate and clean data
npm run bug-data:export        # Export training data

# Model Training
npm run model:train            # Train ML classifiers (needs 100+ records)
npm run model:evaluate         # Evaluate model performance

# Weekly Workflow
npm run weekly-diff            # Full workflow with bug detection
npm run weekly-diff:no-bugs    # Skip bug detection
```
