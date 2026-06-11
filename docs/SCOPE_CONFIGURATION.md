# Bug Detection Scope Configuration

## Current Focus: Web Desktop Only

The bug detection system is currently focused on **Web Desktop** only, with specific attention to two critical flows:
1. **Flight Search** - Search results and filtering
2. **Flight Booking** - Checkout, payment selection, and booking confirmation

## Scope Boundaries

### ✅ In Scope

**Platforms:**
- Web Desktop

**Flows:**
- Flight Search (flight-search)
- Flight Booking (flight-booking)

**Features:**
- i18n detection (translations, date/currency formats)
- Error handling (404s, 5xx errors)
- Accessibility issues
- Performance monitoring
- UI integrity checks

### ❌ Out of Scope (For Now)

**Platforms:**
- Mobile/Tablet
- Android/iOS Native
- Web responsive mobile views

**Flows:**
- Hotel search/booking
- Activities
- Trains
- Account management
- Home page
- Other domains

**Features:**
- Responsive design checks (mobile)
- Touch-specific interactions
- Mobile navigation

## Implementation Details

### Page Type Detection

The detector automatically identifies page type from URL:

```typescript
// Flight Search
https://www.traveloka.com/en-en/flights/CGK/NRT/2026-06-15
→ pageType: 'flight-search'

// Flight Booking
https://www.traveloka.com/en-en/booking
→ pageType: 'flight-booking'
```

### Configuration

When running tests:

```typescript
const detector = new GenericBugDetector(page);
const bugs = await detector.runFullAudit({
  platform: 'desktop',        // Only desktop
  pageType: 'flight-search',  // or 'flight-booking'
  locale: 'en-US',
  performanceBaseline: { lcp: 2500, cls: 0.1 }
});
```

### Weekly-Diff Integration

The weekly-diff workflow is hard-locked to these domains:

```bash
# From: scripts/generate-cases-from-weekly-diff.ts
FORCED_FOCUS_DOMAINS = ['flight-search', 'flight-booking']
```

This ensures:
- Only changes to flight search/booking are analyzed
- Other domains are automatically filtered
- Desktop-only assumptions are baked in

## Test Coverage

### Current Test Scenarios

1. **Flight Search Results** (`flight-search`)
   - Bug detection on search results page
   - Multi-locale testing (en-US, id-ID, zh-CN)
   - Performance baseline: LCP 2500ms, CLS 0.1

2. **Flight Booking** (`flight-booking`)
  - Bug detection on booking page
  - Payment-selection follow-through for booking-sensitive weekly cases
  - Bottom CTA and payment gateway handoff checks when payment is in scope

### Locked Booking => Payment Evidence

For weekly-diff and bug-detection related generated cases that touch the desktop payment slice, treat these files as locked evidence:

- [docs/traveloka-flight-booking-payment-chain-lock.md](/Users/yu.hao/Desktop/task/e2e/docs/traveloka-flight-booking-payment-chain-lock.md)
- [tests/web/traveloka-flight-booking-payment-e2e.spec.ts](/Users/yu.hao/Desktop/task/e2e/tests/web/traveloka-flight-booking-payment-e2e.spec.ts)

This lock is specifically intended to prevent accidental drift in the validated `booking => payment` chain, especially around the payfrm iframe, referrer-sensitive credit-card setup, and main-page `paymentPayButton` contract.
   - Critical issue flagging (P0/P1)
   - Performance baseline: LCP 3000ms, CLS 0.15

### Test Execution

```bash
# Run Web Desktop bug detection only
npm run test:bugs:generic

# This runs:
# - tests/web/traveloka-generic-bug-detection.spec.ts
# - Only desktop scenarios
# - Only flight-search and flight-booking flows
```

## Future Scope Expansion

To expand scope beyond current boundaries:

### Adding Mobile Support
1. Update `GenericBugDetector.runFullAudit()` to enable mobile checks
2. Add responsive design detection methods
3. Create mobile-specific test scenarios
4. Update performance baselines for mobile

### Adding New Domains
1. Update `FORCED_FOCUS_DOMAINS` in weekly-diff script
2. Add domain-specific detection logic
3. Create domain-specific test scenarios
4. Train models separately for each domain

### Example: Enabling Mobile

```typescript
// Current (desktop only)
if (platform !== 'desktop') {
  return this.bugs;
}

// Future (to enable mobile)
if (platform === 'mobile') {
  await this.checkResponsiveDesign('mobile');
  await this.checkTouchInteractions();
}
```

## Data Collection Scope

Training data is collected with scope metadata:

```json
{
  "id": "timestamp-index",
  "bugData": {
    "issue": "missing_translations",
    "category": "i18n",
    "severity": "P1",
    "pageType": "flight-search"  // Scope context
  },
  "features": {
    "platform": 0,  // 0 = desktop only
    "locale": 0,    // encoded locale
    "pageType": "flight-search"
  }
}
```

This allows:
- Separate model training per page type
- Separate metrics per flow
- Clear traceability of training data origin

## Configuration Environment Variables

```bash
# Enable/disable bug detection in weekly-diff
RUN_BUG_DETECTION=1 npm run weekly-diff    # default
RUN_BUG_DETECTION=0 npm run weekly-diff    # skip detection

# Force specific locale for detection
DETECTION_LOCALE=id-ID npm run test:bugs:generic

# Weekly-diff scope (hardcoded, not configurable)
FOCUS_DOMAIN=flight-search,flight-booking  # Cannot be changed
```

## Status

- ✅ Web Desktop: Fully implemented
- ✅ Flight Search: Fully implemented  
- ✅ Flight Booking: Fully implemented
- ⏳ Mobile: Not implemented
- ⏳ Other domains: Not implemented

## Notes

1. **Platform Enforcement**: Non-desktop platforms are skipped with no detection
2. **Page Type Detection**: Automatic from URL, manual override supported
3. **Weekly-Diff Lock**: Hard-coded domain focus cannot be bypassed (by design)
4. **Model Training**: Single unified model trained on all page types (can be split later)
5. **Extensible**: Can be extended to other domains/platforms without breaking existing code

---

**Last Updated**: May 25, 2026
**Scope Status**: Focused (Web Desktop / Flight Only)
**Expandable**: Yes, when ready to support additional platforms/domains
