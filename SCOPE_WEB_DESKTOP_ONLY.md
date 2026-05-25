# Web Desktop Flight Bug Detection - Quick Reference

## ✅ Current Scope (May 25, 2026)

**Platform**: Web Desktop only  
**Flows**: Flight Search + Flight Booking  
**Status**: Ready for production use

## Quick Commands

```bash
# Run integrated weekly-diff with bug detection
npm run weekly-diff

# Skip bug detection
npm run weekly-diff:no-bugs

# Run detection tests only
npm run test:bugs:generic

# Check training data
npm run bug-data:stats

# Train ML models
npm run model:train
```

## What Gets Detected

### Flight Search Pages
- Missing translations
- Text overflow
- Wrong date/currency formats
- Broken links
- Performance issues (LCP, CLS)
- Accessibility issues

### Flight Booking Pages  
- All of the above
- Button state consistency
- Form validation issues
- Network errors

## What's Excluded

❌ Mobile views  
❌ Hotel/Trains/Activities  
❌ Home page  
❌ Other domains  
❌ Responsive design checks  

## Test Coverage

```typescript
// Flight Search Page Test
await page.goto('https://www.traveloka.com/en-en/flights/CGK/NRT/2026-06-15');
const bugs = await detector.runFullAudit({
  platform: 'desktop',
  pageType: 'flight-search'
});

// Flight Booking Page Test
await page.goto('https://www.traveloka.com/en-en/booking');
const bugs = await detector.runFullAudit({
  platform: 'desktop',
  pageType: 'flight-booking'
});
```

## Data Collection

```bash
# Training data location
data/bug-detection/training-data.jsonl

# Each record includes
{
  "bugData": { "pageType": "flight-search" },
  "features": { "platform": 0 }  // 0=desktop
}
```

## Integration Files

- `scripts/run-weekly-diff-case-generator.sh` - Integrated workflow
- `tests/lib/generic-bug-detector.ts` - Detection engine (web desktop only)
- `tests/web/traveloka-generic-bug-detection.spec.ts` - Test cases (flight flows only)
- `docs/SCOPE_CONFIGURATION.md` - Full scope documentation

## To Expand Scope Later

When ready to add mobile/other domains:
1. See `docs/SCOPE_CONFIGURATION.md` section "Future Scope Expansion"
2. Update detector for new platform/domain
3. Create separate test scenarios
4. Train separate models if needed

## Status

✅ Web Desktop: Fully implemented  
✅ Flight Search: Fully implemented  
✅ Flight Booking: Fully implemented  
✅ Integrated with weekly-diff: Yes  
✅ Training data collection: Active  
⏳ Mobile: Not implemented  
⏳ Other domains: Not implemented  

---

**For detailed scope info**: See [SCOPE_CONFIGURATION.md](SCOPE_CONFIGURATION.md)  
**For integration details**: See [INTEGRATION_NOTES.md](INTEGRATION_NOTES.md)  
**For full guide**: See [BUG_DETECTION_ML_INTEGRATION.md](BUG_DETECTION_ML_INTEGRATION.md)
