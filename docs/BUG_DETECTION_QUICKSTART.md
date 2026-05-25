# Bug Detection ML Pipeline - Quick Start

Get the bug detection ML pipeline running in 15 minutes.

## Prerequisites

```bash
# Check Node.js version (need 14+)
node --version

# Check Python version (need 3.7+)
python3 --version

# Install Python ML dependencies
pip install scikit-learn pandas numpy

# Verify installation
python3 -c "import sklearn; print('scikit-learn ok')"
```

## 5-Minute Quick Start

### Step 1: Run Generic Bug Detection (3 min)

```bash
# Navigate to project root
cd /path/to/e2e

# Run bug detection tests
npm run test:bugs:generic
```

Expected output:
```
✓ Generic bug detection completed
✓ Bug detection data saved: bug-detection-1716624000000.json
✓ Added 15 training records
```

### Step 2: Check Collected Data (1 min)

```bash
# View statistics
npm run bug-data:stats

# Output example:
# Training Data Statistics:
# {
#   "totalRecords": 15,
#   "byCategory": {
#     "i18n": 8,
#     "accessibility": 4,
#     "performance": 2,
#     "error": 1
#   },
#   "bySeverity": {
#     "P1": 5,
#     "P2": 8,
#     "P3": 2
#   }
# }
```

### Step 3: Train Model (2 min - with data)

```bash
# Train ML models
npm run model:train

# Output:
# 📚 Training severity classification model...
#   Accuracy: 0.876
#   F1-Score: 0.873
# 📚 Training category classification model...
#   Accuracy: 0.921
#   F1-Score: 0.918
# ✓ Training completed!
```

## 15-Minute Full Integration

### Phase 1: Initial Setup (5 min)

```bash
# Create required directories
mkdir -p data/bug-detection models/bug-classification logs/bug-detection

# Verify structure
ls -la data/ models/ logs/
```

### Phase 2: Collect Training Data (5 min)

```bash
# Run integrated weekly-diff + bug detection workflow
npm run weekly-diff:integrated

# This will:
# 1. Generate weekly-diff test cases
# 2. Run generic bug detection
# 3. Collect bug data
# 4. Validate training data
```

### Phase 3: Train and Evaluate Models (5 min)

```bash
# Train models
npm run model:train

# Evaluate trained models
npm run model:evaluate

# Check model files created
ls -lh models/bug-classification/
# severity_model.pkl          (2.1M)
# category_model.pkl          (1.8M)
# text_classifier_model.pkl   (890K)
# text_vectorizer.pkl         (320K)
```

## Common Tasks

### View Bug Detection Results

```bash
# Show latest bug detection
npm run bug-data:stats

# Export as CSV for analysis
npm run bug-data:export csv > training-data.csv

# Open in spreadsheet
open training-data.csv
```

### Run Detection on Specific Locale

```bash
# Edit generic-bug-detector.spec.ts
vim tests/web/traveloka-generic-bug-detection.spec.ts

# Search for: runFullAudit({ locale: 'en-US'
# Change to: runFullAuilt({ locale: 'id-ID'

# Run test
npm run test:bugs:generic -- --grep "locale"
```

### Predict Bug Severity

```bash
# Create a sample bug
cat > /tmp/sample-bug.json << 'EOF'
{
  "issue": "missing_translations",
  "category": "i18n",
  "description": "Found 5 untranslated UI labels in flight search",
  "severity": "P1"
}
EOF

# Get prediction
python3 scripts/train-bug-classification-model.py \
  --predict "$(cat /tmp/sample-bug.json)"

# Output:
# {
#   "predictions": {
#     "severity": {
#       "predicted": "P1",
#       "confidence": 0.94
#     },
#     "category": {
#       "predicted": "i18n",
#       "confidence": 0.98
#     }
#   }
# }
```

## Troubleshooting

### "No such file: bug-detection-collector.ts"

```bash
# Make sure you're in project root
cd /path/to/e2e
npm run bug-data:stats
```

### "ModuleNotFoundError: No module named 'sklearn'"

```bash
# Install ML libraries
pip install scikit-learn pandas numpy

# Or with conda
conda install scikit-learn pandas numpy
```

### "Model not trained" error

```bash
# Generate some training data first
npm run test:bugs:generic

# Then train
npm run model:train

# Verify models exist
ls models/bug-classification/
```

### Tests failing

```bash
# Check browser installation
npx playwright install

# Run with debug output
npm run test:bugs:generic -- --debug

# Check specific test
npm run test:bugs:generic -- --grep "首页"
```

## Next Steps After Quick Start

1. **Schedule automated collection**: Set up cron job
   ```bash
   0 0 * * 0 npm run weekly-diff:integrated
   ```

2. **Monitor model performance**: Check metrics weekly
   ```bash
   npm run model:evaluate
   ```

3. **Retrain on schedule**: Monthly retraining
   ```bash
   0 0 1 * * npm run model:train
   ```

4. **Use predictions in workflow**: Integrate into test prioritization
   ```bash
   python3 scripts/train-bug-classification-model.py --predict ...
   ```

## Performance Expectations

| Operation | Time | Notes |
|-----------|------|-------|
| Bug Detection | 2-3 min | Per test run |
| Data Collection | < 1 min | Auto on detection |
| Model Training | 1-5 min | Depends on data size |
| Prediction | < 100ms | Per bug |

## Files Created

```
Created:
✓ tests/lib/generic-bug-detector.ts
✓ scripts/bug-detection-collector.ts
✓ scripts/train-bug-classification-model.py
✓ scripts/run-weekly-diff-with-bug-detection.sh
✓ data/bug-detection/training-data.jsonl
✓ models/bug-classification/
✓ logs/bug-detection/
✓ docs/BUG_DETECTION_ML_INTEGRATION.md (this guide)
```

## Useful Commands Cheat Sheet

```bash
# Data Collection
npm run test:bugs:generic              # Run detection
npm run bug-data:stats                 # View statistics
npm run bug-data:validate              # Check data quality
npm run bug-data:export json           # Export JSON
npm run bug-data:export csv            # Export CSV

# Model Training
npm run model:train                    # Train all models
npm run model:evaluate                 # Check performance

# Integration
npm run weekly-diff:integrated         # Full workflow
npm run notify:run                     # Send results

# Helper
npm run weekly-diff:prd                # Generate PRD
npm run test:web:retained              # Run tests
```

## Success Criteria

✓ Generic bug detection running: 2-3 min
✓ Training data collected: > 100 records
✓ Models trained successfully: < 5 min
✓ Accuracy > 80% on test set
✓ Predictions < 100ms latency

## Support

For issues or questions:
1. Check logs: `cat logs/bug-detection-*.log`
2. Validate data: `npm run bug-data:validate`
3. Check models: `ls -la models/bug-classification/`
4. Run in debug: `npm run test:bugs:generic -- --debug`
