# Bug Detection ML Integration Guide

This guide walks through integrating generic bug detection into the weekly-diff workflow, collecting training data, and training ML models.

## Overview

```
Weekly-Diff Workflow
    ↓
Generate Test Cases
    ↓
Generic Bug Detection ← NEW
    ↓
Collect Bug Data ← NEW
    ↓
Store Training Records ← NEW
    ↓
Train ML Models ← NEW
```

## Phase 1: Integrate Bug Detection into Weekly-Diff

### Step 1.1: Enable Generic Bug Detection

Run the integrated workflow that combines weekly-diff with bug detection:

```bash
npm run weekly-diff:integrated
```

This will:
1. Generate weekly-diff test cases
2. Generate PRD markdown
3. Run generic bug detection
4. Collect bug data for training
5. Validate training data
6. Run test suite
7. Send Lark notification

### Step 1.2: Customize Detection Parameters

Edit `tests/lib/generic-bug-detector.ts` to configure:

```typescript
await detector.runFullAudit({
  locale: 'en-US',      // Change to test different locales
  platform: 'desktop',  // or 'mobile'
  performanceBaseline: {
    lcp: 2500,  // Adjust performance thresholds
    cls: 0.1,
  }
});
```

### Step 1.3: Monitor Bug Detection Output

Check logs for bug detection results:

```bash
# View recent bug detection results
cat logs/bug-detection-*.log | tail -50

# Show statistics
npm run bug-data:stats
```

## Phase 2: Collect Training Data

### Step 2.1: Run Detection on Multiple Locales

Create a script to test across different locales:

```bash
#!/bin/bash
for locale in en-US id-ID zh-CN vi-VN th-TH; do
  echo "Testing locale: $locale"
  npm run test:bugs:generic -- --grep "locale.*$locale"
done
```

### Step 2.2: Validate Collected Data

```bash
# Check data statistics
npm run bug-data:stats

# Validate and clean data
npm run bug-data:validate

# Export for analysis
npm run bug-data:export json
npm run bug-data:export csv
```

### Step 2.3: Data Structure

Training data is stored in `data/bug-detection/training-data.jsonl`:

```json
{
  "id": "2026-05-25T10:30:00Z-0",
  "timestamp": "2026-05-25T10:30:00Z",
  "bugData": {
    "issue": "missing_translations",
    "category": "i18n",
    "severity": "P1",
    "description": "Found 10 untranslated keys",
    "evidence": {...}
  },
  "features": {
    "category": 0,
    "severity": 1,
    "evidenceSize": 450,
    "descriptionLength": 28,
    "locale": "en-US",
    "platform": "desktop"
  },
  "label": "missing_translations",
  "confidence": 0.85
}
```

## Phase 3: Train ML Models

### Step 3.1: Prerequisites

Install ML dependencies:

```bash
pip install scikit-learn pandas numpy
```

### Step 3.2: Train Models

```bash
# Train all models
npm run model:train

# Train with custom data path
python3 scripts/train-bug-classification-model.py --train \
  --data data/bug-detection/training-data.jsonl
```

This trains three models:

1. **Severity Classifier**: Predicts P0/P1/P2/P3
2. **Category Classifier**: Predicts bug category (i18n, error, accessibility, etc.)
3. **Issue Classifier**: Predicts specific issue type using text analysis

### Step 3.3: Evaluate Models

```bash
npm run model:evaluate
```

Output:
```
📊 Model Evaluation Summary
==================================================

Severity Model:
  - Type: RandomForestClassifier
  - Accuracy: 0.876
  - F1-Score: 0.873

Category Model:
  - Type: GradientBoostingClassifier
  - Accuracy: 0.921
  - F1-Score: 0.918
```

### Step 3.4: Use Trained Models for Predictions

```bash
# Predict on a bug
python3 scripts/train-bug-classification-model.py --predict '{
  "issue": "missing_translations",
  "category": "i18n",
  "description": "Found untranslated keys in navigation"
}'

# Output:
# {
#   "predictions": {
#     "severity": {
#       "predicted": "P1",
#       "confidence": 0.92
#     },
#     "category": {
#       "predicted": "i18n",
#       "confidence": 0.98
#     }
#   }
# }
```

## Phase 4: Continuous Improvement

### Step 4.1: Scheduled Data Collection

Add to GitHub Actions workflow (`.github/workflows/bug-detection.yml`):

```yaml
name: Weekly Bug Detection

on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday

jobs:
  bug-detection:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run weekly-diff:integrated
      - name: Upload training data
        uses: actions/upload-artifact@v3
        with:
          name: training-data
          path: data/bug-detection/
```

### Step 4.2: Monitor Model Performance

Track metrics over time:

```bash
# Export historical data
git log --oneline -- data/bug-detection/training-data.jsonl | wc -l

# Check data growth
wc -l data/bug-detection/training-data.jsonl

# Retrain periodically (e.g., weekly)
npm run model:train
```

### Step 4.3: Add Domain-Specific Patterns

Enhance detection with custom patterns:

```typescript
// In generic-bug-detector.ts
private async checkCustomPattern(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    // Custom detection logic for your domain
    return checkTravelokaSpecificIssues();
  });

  if (result) {
    this.bugs.push({
      issue: 'custom_pattern',
      category: 'functional',
      severity: 'P2',
      ...
    });
  }
}
```

## Troubleshooting

### No Training Data Collected

```bash
# Check if tests are running
npm run test:bugs:generic

# Check logs
cat logs/bug-detection-*.log

# Manually collect data
npx ts-node scripts/bug-detection-collector.ts validate
```

### Models Not Trained

```bash
# Check Python environment
python3 --version
pip list | grep scikit

# Check data file exists
ls -lh data/bug-detection/training-data.jsonl

# Manually train
python3 scripts/train-bug-classification-model.py --train
```

### Predictions Not Working

```bash
# Ensure models exist
ls -lh models/bug-classification/

# Retrain if missing
npm run model:train

# Check prediction format
cat << 'EOF' | npm run model:predict
{"issue": "test", "category": "ui", "description": "test bug"}
EOF
```

## Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run weekly-diff:integrated` | Run complete workflow with bug detection |
| `npm run test:bugs:generic` | Run generic bug detection tests |
| `npm run bug-data:stats` | Show training data statistics |
| `npm run bug-data:validate` | Validate and clean training data |
| `npm run bug-data:export` | Export training data (json/csv) |
| `npm run model:train` | Train ML models |
| `npm run model:evaluate` | Evaluate trained models |

## Performance Targets

- **Model Training**: < 5 minutes
- **Data Collection**: < 10 minutes per run
- **Prediction Latency**: < 100ms per bug
- **Detection Accuracy**: > 85% for severity prediction
- **Data Size**: 10,000+ records before retraining

## Next Steps

1. Run `npm run weekly-diff:integrated` weekly to collect data
2. Monitor `npm run bug-data:stats` to track growth
3. Retrain models when data reaches 5,000 records
4. Validate predictions against manual reviews
5. Iterate on detection rules based on results

## Architecture Diagram

```
┌─────────────────────────────────┐
│   Weekly-Diff Workflow          │
│   (Generate Test Cases)         │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│ Generic Bug Detection           │
│ (Run All Detectors)             │
│ - i18n, Error, A11y, etc        │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│ Bug Data Collection             │
│ (Extract Features)              │
│ - Category, Severity, Context   │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│ Training Data Storage           │
│ (JSONL Format)                  │
│ data/bug-detection/*.jsonl      │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│ ML Model Training               │
│ - Severity Classifier           │
│ - Category Classifier           │
│ - Issue Classifier              │
└──────────┬──────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│ Model Evaluation & Deployment   │
│ - Performance Metrics           │
│ - Predictions on New Bugs       │
└─────────────────────────────────┘
```

## File Structure

```
project-root/
├── scripts/
│   ├── bug-detection-collector.ts       # Data collection
│   ├── train-bug-classification-model.py # Model training
│   └── run-weekly-diff-with-bug-detection.sh # Integration
├── tests/lib/
│   └── generic-bug-detector.ts          # Detection engine
├── data/bug-detection/
│   └── training-data.jsonl              # Training records
├── models/bug-classification/           # Trained models
│   ├── severity_model.pkl
│   ├── category_model.pkl
│   ├── text_classifier_model.pkl
│   ├── text_vectorizer.pkl
│   └── label_encoders.pkl
└── logs/bug-detection/                  # Detection logs
    └── bug-detection-*.log
```
