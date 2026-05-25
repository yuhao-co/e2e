# Bug Detection ML Pipeline - Implementation Roadmap

Complete step-by-step implementation plan for integrating generic bug detection into weekly-diff workflow, collecting training data, and training ML models.

## Overview

```
Timeline:          Week 1-2           Week 3-4            Week 5+
                   Integration      Data Collection      Model Training

Phase 1: Setup → test:bugs:generic
            ↓
Phase 2: Workflow → weekly-diff:integrated
            ↓
Phase 3: Collection → bug-data:stats
            ↓
Phase 4: Training → model:train
            ↓
Phase 5: Deployment → predictions in production
```

## Phase 1: Setup & Integration (Week 1-2)

### Week 1: Core Infrastructure

**Deliverables:**
- [x] Generic bug detection engine (`generic-bug-detector.ts`)
- [x] Data collection framework (`bug-detection-collector.ts`)
- [x] Model training pipeline (`train-bug-classification-model.py`)
- [x] Workflow integration script (`run-weekly-diff-with-bug-detection.sh`)

**Commands:**
```bash
npm run test:bugs:generic              # Verify detection works
npm run bug-data:stats                 # Check collection
npm run weekly-diff:integrated         # Full workflow
```

**Success Metrics:**
- ✓ Generic bug detection runs in < 3 minutes
- ✓ Detects at least 5 bug categories
- ✓ Data collection working without errors

### Week 2: Validation & Tuning

**Tasks:**
1. Run detection on 5+ different pages
2. Validate accuracy of detected bugs
3. Tune detection thresholds
4. Document edge cases

**Commands:**
```bash
# Multi-locale testing
for locale in en-US id-ID zh-CN vi-VN; do
  npm run test:bugs:generic -- --grep "$locale"
done

# Validate collected data
npm run bug-data:validate
npm run bug-data:stats
```

**Success Metrics:**
- ✓ > 100 training records collected
- ✓ No validation errors
- ✓ Bug categories balanced (no class imbalance > 90%)

## Phase 2: Data Collection (Week 3-4)

### Week 3: Automated Collection

**Setup:**
```bash
# Schedule weekly runs (example using cron)
0 0 * * 0 cd /path/to/e2e && npm run weekly-diff:integrated
```

**Data Targets:**
- 500-1000 records initial
- Diverse locales (en, id, zh, vi, th, ja, ko)
- Multiple platforms (desktop, mobile)
- Multiple dates/times (capture temporal patterns)

**Monitoring:**
```bash
# Weekly check
npm run bug-data:stats

# Monitor growth
wc -l data/bug-detection/training-data.jsonl
```

### Week 4: Data Quality

**Tasks:**
1. Analyze data distribution
2. Remove outliers/duplicates
3. Balance classes if needed
4. Document data characteristics

**Commands:**
```bash
# Export for analysis
npm run bug-data:export csv > analysis.csv

# Validate quality
npm run bug-data:validate

# Generate report
python3 << 'EOF'
import json
import pandas as pd

with open('data/bug-detection/training-data.jsonl') as f:
    data = [json.loads(line) for line in f]

df = pd.DataFrame(data)
print("Data Summary:")
print(f"Total records: {len(df)}")
print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
print(f"Bug categories: {df['bugData'].apply(lambda x: x.get('category')).unique()}")
print(f"Severity distribution:\n{df['bugData'].apply(lambda x: x.get('severity')).value_counts()}")
EOF
```

**Success Metrics:**
- ✓ 500+ training records
- ✓ < 2% duplicate records
- ✓ Coverage: 5+ locales, 2+ platforms
- ✓ No missing features

## Phase 3: Model Training (Week 5)

### Training Setup

**Prerequisites:**
```bash
pip install scikit-learn pandas numpy xgboost
python3 --version  # Verify 3.7+
```

**Models to Train:**
1. Severity Classifier (P0/P1/P2/P3)
2. Category Classifier (i18n/error/accessibility/ui/performance)
3. Issue Classifier (specific issue type)

### Training Commands

```bash
# Train all models
npm run model:train

# Train with logging
python3 scripts/train-bug-classification-model.py \
  --train \
  --data data/bug-detection/training-data.jsonl \
  --model-dir models/bug-classification
```

### Evaluation

```bash
# View performance metrics
npm run model:evaluate

# Check individual model files
ls -lh models/bug-classification/
# severity_model.pkl          <- Trained model
# category_model.pkl          <- Trained model
# text_classifier_model.pkl   <- Trained model
# text_vectorizer.pkl         <- Feature extractor
# label_encoders.pkl          <- Label mapping
```

**Success Metrics:**
- ✓ Severity accuracy ≥ 80%
- ✓ Category accuracy ≥ 85%
- ✓ F1-score ≥ 0.80 (weighted)
- ✓ Training time < 5 minutes

## Phase 4: Deployment & Integration (Week 6+)

### Using Trained Models

**Option 1: Direct Prediction**
```bash
# Get prediction for a bug
python3 scripts/train-bug-classification-model.py \
  --predict '{
    "issue": "missing_translations",
    "category": "i18n",
    "description": "Navigation menu not translated"
  }'
```

**Option 2: Integrate into Test Framework**
```typescript
// In test execution
const model = new BugClassifier();
const bug = await detector.runFullAudit(...);
const prediction = model.predict(bug);

// Use prediction for prioritization
if (prediction.severity.predicted === 'P0') {
  // Fail test immediately
  expect(false).toBe(true);
}
```

### Continuous Improvement

**Monthly Routine:**
```bash
# 1. Collect new data
npm run weekly-diff:integrated

# 2. Check data growth
npm run bug-data:stats

# 3. If > 100 new records, retrain
npm run model:train

# 4. Evaluate new model
npm run model:evaluate

# 5. Compare metrics
git diff HEAD~ -- models/bug-classification/
```

## Implementation Checklist

### Phase 1 - Setup (Week 1-2)
- [x] Create generic-bug-detector.ts
- [x] Create bug-detection-collector.ts
- [x] Create train-bug-classification-model.py
- [x] Create integration script
- [x] Update package.json with commands
- [ ] Test all commands locally
- [ ] Document in README
- [ ] Setup CI/CD integration

### Phase 2 - Data Collection (Week 3-4)
- [ ] Run detection on 10+ different pages
- [ ] Collect data from 5+ locales
- [ ] Test on both desktop and mobile
- [ ] Validate data quality
- [ ] Analyze data distribution
- [ ] Balance if needed

### Phase 3 - Model Training (Week 5)
- [ ] Train severity model
- [ ] Train category model
- [ ] Train issue classifier
- [ ] Evaluate all models
- [ ] Compare with baseline
- [ ] Document performance

### Phase 4 - Deployment (Week 6+)
- [ ] Integrate into weekly-diff workflow
- [ ] Use predictions for test prioritization
- [ ] Monitor prediction accuracy
- [ ] Collect user feedback
- [ ] Iterate and retrain
- [ ] Scale to production

## File Structure

```
e2e/
├── scripts/
│   ├── bug-detection-collector.ts
│   ├── train-bug-classification-model.py
│   ├── run-weekly-diff-with-bug-detection.sh
│   └── generate-prd-enhanced.py (existing)
├── tests/
│   ├── lib/
│   │   └── generic-bug-detector.ts
│   └── web/
│       └── traveloka-generic-bug-detection.spec.ts
├── data/
│   └── bug-detection/
│       ├── training-data.jsonl          (collected records)
│       ├── training-data.json           (export)
│       └── training-data.csv            (export)
├── models/
│   └── bug-classification/
│       ├── severity_model.pkl
│       ├── category_model.pkl
│       ├── text_classifier_model.pkl
│       ├── text_vectorizer.pkl
│       └── label_encoders.pkl
├── logs/
│   └── bug-detection/
│       └── bug-detection-*.log
└── docs/
    ├── BUG_DETECTION_ML_INTEGRATION.md  (full guide)
    ├── BUG_DETECTION_QUICKSTART.md      (quick start)
    └── BUG_CATEGORIZATION_AND_GENERIC_TESTING.md (reference)
```

## Key Commands

```bash
# Week 1: Setup
npm run test:bugs:generic
npm install

# Week 2-4: Collection
npm run weekly-diff:integrated
npm run bug-data:stats
npm run bug-data:validate

# Week 5: Training
npm run model:train
npm run model:evaluate

# Week 6+: Production
npm run weekly-diff:integrated  # Weekly
npm run model:train             # Monthly
```

## Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Detection Time | < 3 min | - |
| Data Collected | > 500 records | - |
| Model Training | < 5 min | - |
| Severity Accuracy | ≥ 80% | - |
| Category Accuracy | ≥ 85% | - |
| Prediction Latency | < 100ms | - |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Insufficient training data | Poor model accuracy | Start collection immediately |
| Class imbalance | Biased predictions | Use stratified sampling |
| Model overfitting | Poor generalization | Use cross-validation |
| Detection inaccuracy | Bad training data | Manual review of samples |
| CI/CD integration | Workflow delays | Test locally first |

## Success Criteria

✅ **Phase 1**: All commands working locally
✅ **Phase 2**: 500+ diverse training records
✅ **Phase 3**: Models trained with ≥80% accuracy
✅ **Phase 4**: Integrated into weekly workflow
✅ **Final**: Running in production with monitoring

## References

- Generic Bug Detector: `docs/BUG_CATEGORIZATION_AND_GENERIC_TESTING.md`
- Quick Start: `docs/BUG_DETECTION_QUICKSTART.md`
- Full Integration: `docs/BUG_DETECTION_ML_INTEGRATION.md`
- Implementation: See `scripts/` directory

## Next Steps

1. **Immediately**: Run `npm run test:bugs:generic` to verify setup
2. **This week**: Integrate into CI/CD pipeline
3. **Next week**: Start automated data collection
4. **Week 3**: Analyze collected data
5. **Week 5**: Train models
6. **Week 6+**: Deploy and monitor

---

**Last Updated**: May 25, 2026
**Status**: Implementation Ready
**Owner**: DevOps Team
