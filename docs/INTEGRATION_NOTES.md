# Bug Detection Scope & Integration

## Scope: Web Desktop Only - Flight Search & Booking

Bug detection is **currently focused on**:
- **Platform**: Web Desktop only
- **Flows**: Flight Search and Flight Booking
- **Other**: All other platforms/domains excluded for now

## How Integration Works

### New npm Commands

```bash
# Run weekly-diff WITH bug detection (default)
npm run weekly-diff

# Alias for above
npm run weekly-diff:run

# Run weekly-diff WITHOUT bug detection
npm run weekly-diff:no-bugs
```

### Workflow Steps

When you run `npm run weekly-diff`, the script now:

1. **Generates weekly-diff test cases** from git diffs
2. **Generates PRD markdown** for reference
3. **Runs generic bug detection** (NEW)
4. **Collects training data** from bugs found (NEW)
5. **Executes weekly-diff tests** on the generated cases
6. **Sends Lark notification** with results

### Integration Details

- Bug detection runs **after case generation** and **before test execution**
- Detection data is automatically saved to `data/bug-detection/training-data.jsonl`
- You can disable with: `RUN_BUG_DETECTION=0 npm run weekly-diff:run`
- **Scope**: Only detects bugs on web desktop, flight-search and flight-booking flows
- **Auto-Detection**: Page type detected from URL, skips non-matching pages

## Scope: Web Desktop + Flight Flows Only

**In Scope:**
- Web Desktop platform
- Flight Search pages (`/flights/`)
- Flight Booking pages (`/booking`)
- i18n, error handling, accessibility, performance, UI checks

**Out of Scope (excluded automatically):**
- Mobile/Tablet views
- Non-flight domains (hotel, trains, activities, etc.)
- Non-desktop platforms
- Responsive design checks

### Page Type Auto-Detection

The detector automatically identifies pages:

```typescript
// Flight Search: /flights/ in URL
https://www.traveloka.com/en-en/flights/CGK/NRT/2026-06-15
→ Detected as: flight-search

// Flight Booking: /booking in URL  
https://www.traveloka.com/en-en/booking
→ Detected as: flight-booking

// Other pages → Skipped (not in scope)
https://www.traveloka.com/en-en/hotel
→ Skipped: Not a flight flow
```

### Environment Variables

```bash
# Default behavior (bug detection enabled)
npm run weekly-diff

# Disable bug detection
RUN_BUG_DETECTION=0 npm run weekly-diff

# Run only case generation (no tests, no detection)
RUN_WEEKLY_PLAYWRIGHT=0 npm run weekly-diff
```

## Quick Commands

```bash
# Start the integrated workflow
npm run weekly-diff

# Check collected training data
npm run bug-data:stats

# Validate data quality
npm run bug-data:validate

# Train models (after collecting enough data)
npm run model:train

# Evaluate model performance
npm run model:evaluate
```

## Progress Tracking

Check the status of your bug detection integration:

```bash
# View training data statistics
npm run bug-data:stats

# Example output:
# Training Data Statistics:
# {
#   "totalRecords": 247,
#   "byCategory": {
#     "i18n": 85,
#     "error": 42,
#     "accessibility": 38,
#     "performance": 48,
#     "ui": 34
#   },
#   "bySeverity": {
#     "P0": 12,
#     "P1": 68,
#     "P2": 125,
#     "P3": 42
#   }
# }
```

## When to Train Models

Once you have collected enough training data:

```bash
# Check data count
npm run bug-data:stats | grep totalRecords

# Recommended: Train when totalRecords > 100
npm run model:train

# This will create models in:
# - models/bug-classification/severity_model.pkl
# - models/bug-classification/category_model.pkl
# - models/bug-classification/text_classifier_model.pkl
```

## Workflow with Full Integration

```bash
# Week 1: Start data collection
npm run weekly-diff
npm run weekly-diff  # Run again
npm run bug-data:stats  # Check data growth

# Week 2: Collect more data from multiple runs
npm run weekly-diff
npm run weekly-diff
npm run bug-data:stats  # Should have 100+ records now

# Week 3: Train models
npm run bug-data:validate  # Ensure data quality
npm run model:train  # Train all 3 classifiers
npm run model:evaluate  # Check accuracy

# Week 4+: Continue collecting and refine models
npm run weekly-diff  # Automated workflow
npm run model:train  # Retrain monthly
```

## Troubleshooting

### Bug detection not running
Check if `RUN_BUG_DETECTION` is set:
```bash
echo $RUN_BUG_DETECTION  # Should be empty or "1"
npm run weekly-diff
```

### No training data collected
```bash
# Run detection manually
npm run test:bugs:generic

# Check if data was collected
npm run bug-data:stats

# If still empty, check logs
cat logs/bug-detection-*.log
```

### Model training fails
```bash
# Validate training data first
npm run bug-data:validate

# Install Python dependencies if missing
pip install scikit-learn pandas numpy

# Then try training again
npm run model:train
```

## Integration Files Modified

- `scripts/run-weekly-diff-case-generator.sh` - Added bug detection steps
- `package.json` - Added `weekly-diff` and `weekly-diff:no-bugs` commands

## Next Steps

1. Run `npm run weekly-diff` to start the integrated workflow
2. Monitor data collection with `npm run bug-data:stats`
3. Once you have 100+ records, train models with `npm run model:train`
4. Use predictions in your workflow for prioritization and routing

---

**Status**: ✅ Integrated and Ready
**Start**: `npm run weekly-diff`
