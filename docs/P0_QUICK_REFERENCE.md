# P0 Bug Analysis - Quick Reference

## 🚨 What is P0?

**P0 = Critical/Blocker Bug**

Symptoms:
- ❌ Feature completely broken
- ❌ Users cannot proceed
- ❌ Revenue/Security impact
- ❌ Data loss visible

Examples:
- Page is blank
- Search button doesn't work
- Payment gateway down
- User data corrupted
- Security vulnerability exposed

---

## 📊 Our 11 P0 Rules

| Rule | Condition | Impact |
|------|-----------|--------|
| **page_blank** | Content < 100 chars | Can't see anything |
| **page_timeout** | Load > 30s | Users give up |
| **search_form_broken** | Button disabled/frozen | Can't search |
| **booking_form_broken** | Submit button disabled | Can't book |
| **payment_gateway_down** | API 5xx errors | Can't pay |
| **data_corruption** | undefined/NaN visible | Data trust lost |
| **security_breach** | XSS/CSRF/SQL detected | Account at risk |
| **critical_button_stuck** | pointer-events:none | Completely stuck |
| **network_critical_error** | 502/503/504 | Service down |
| **currency_missing** | No $ symbol in prices | User confused |
| **session_expired** | Auth token missing | Kicked out |

---

## 🔄 Three-Stage Detection Model

### Stage 1: PRE-FLIGHT (Before generation)
```bash
npm run analyze:p0

# Checks:
✅ Are P0 rules loaded?
✅ Are generated specs verified?
✅ Is integration complete?
```

### Stage 2: GENERATION (During spec creation)
```typescript
// Automatically injected into generated specs:
import { GenericBugDetector } from '../lib/generic-bug-detector';
const detector = new GenericBugDetector(page);
const results = await detector.runFullAudit({ /* ... */ });
const p0Issues = results.filter(b => b.severity === 'P0');
expect(p0Issues).toHaveLength(0);  // ZERO TOLERANCE
```

### Stage 3: EXECUTION (During test run)
```bash
npm run weekly-diff
→ Each generated spec runs P0 detection automatically
→ If any P0 found → Test FAILS + Lark notification
```

---

## ⚡ Key Commands

```bash
# Check P0 integration status
npm run analyze:p0

# Generate specs + run P0 detection
npm run weekly-diff

# Verify generated specs have P0 checks
npm run test:bugs:generic

# View bug training data
npm run bug-data:stats
```

---

## 🎯 Detection Execution Order

```
1️⃣ Page-Level Checks (fastest fail)
   - Page visible?
   - Page loaded?

2️⃣ Form-Level Checks (core interaction)
   - Search form clickable?
   - Booking form clickable?
   - Buttons enabled?

3️⃣ API-Level Checks (network health)
   - 5xx errors?
   - Timeouts?

4️⃣ Data-Level Checks (user trust)
   - Data corruption?
   - Price format?

5️⃣ Security-Level Checks (risk defense)
   - XSS detected?
   - CSRF token present?
```

---

## 📈 Expected Workflow Output

```
🚨 [P0-detection] PRE-FLIGHT CHECK: Running P0 critical bug analysis...
✅ [P0-detection] P0 pre-flight check PASSED - no critical bugs detected

[bug-detection] Generating PRD for reference...
✅ [bug-detection] PRD generated

[bug-detection] Verifying generated specs include P0 detection...
✅ [bug-detection] Generated specs verification PASSED

[bug-detection] Collecting bug data for ML training...
✅ [bug-detection] Data collection completed
📊 [bug-detection] Training data: data/bug-detection/training-data.jsonl

[weekly-diff] running accumulated weekly flight specs: 5
 - tests/web/traveloka-flight-weekly-diff-20260525.spec.ts
 - tests/web/traveloka-flight-booking-weekly-diff-20260525.spec.ts
 - ... (running with P0 checks automatically)
```

---

## ❌ What Happens If P0 Found

```bash
npm run weekly-diff

# Output:
❌ [P0-detection] P0 pre-flight check FAILED - critical bugs detected!
   - page_blank: Page content is blank or unreadable
   - payment_gateway_down: Payment gateway unreachable (502 error)

# Lark Notification:
🚨 P0 Critical Bugs Detected
   [flight-search] 2 P0 issues found
   
   Details:
   • page_blank: Content < 100 chars (evidence: contentLength=0)
   • payment_gateway_down: HTTP 502 errors detected

# Build Status:
❌ FAILED (P0 bugs must be fixed before merge)
```

---

## ✅ Best Practices We Follow

| Practice | Why | How |
|----------|-----|-----|
| **Early Detection** | Fail fast | P0 checks run first |
| **Zero Tolerance** | No exceptions | `expect(p0Issues).toHaveLength(0)` |
| **Automation** | Reduce manual errors | All checks automated |
| **Alerts** | Quick response | Lark notifications |
| **Tracking** | Trends matter | ML training data collected |
| **Configuration** | Easy updates | config/p0-detection-rules.json |

---

## 🔍 How P0 Detection Works (Technical)

```typescript
// Inside generic-bug-detector.ts

private async detectP0Issues(pageType) {
  // 1. Check if page has content
  const contentLength = await this.page.evaluate(() => 
    document.body.innerText.length
  );
  if (contentLength < 100) → P0_PAGE_BLANK

  // 2. Check if page loaded in time
  if (Date.now() - startTime > 30000) → P0_PAGE_TIMEOUT

  // 3. Check if search form works
  const searchBtn = document.querySelector('button[type="submit"]');
  if (searchBtn.disabled || searchBtn.style.pointerEvents === 'none') 
    → P0_SEARCH_FORM_BROKEN

  // 4. Check for network errors
  this.page.on('response', response => {
    if (response.status() >= 500 && response.url().includes('payment'))
      → P0_PAYMENT_GATEWAY_DOWN
  });

  // 5. Check for data corruption
  if (pageText.includes('undefined') || pageText.includes('NaN'))
    → P0_DATA_CORRUPTION

  // ... (11 total checks)
}

// In generated test spec:
const detector = new GenericBugDetector(page);
const results = await detector.runFullAudit();
const p0Issues = results.filter(b => b.severity === 'P0');
expect(p0Issues).toHaveLength(0);  // ← MUST BE 0
```

---

## 📚 Documentation

- [Full Guide](./P0_DETECTION_SYSTEM.md)
- [Industry Best Practices](./P0_ANALYSIS_INDUSTRY_BEST_PRACTICES.md)
- [Generated-Only Enforcement](./P0_GENERATED_ONLY_ENFORCEMENT.md)

---

## 🎓 Learning Path

1. **Understand**: What are P0s? Why do they matter?
   → Read this document

2. **Implement**: How are they detected?
   → Check generic-bug-detector.ts

3. **Configure**: How to add new rules?
   → Edit config/p0-detection-rules.json

4. **Automate**: How to run automatically?
   → Use: `npm run weekly-diff`

5. **Monitor**: How to track trends?
   → Use: `npm run bug-data:stats`

---

## 💬 Quick Q&A

**Q: Why 11 rules and not more?**
A: These are the critical ones for flight booking. More = slower tests + false positives.

**Q: Can a test pass with P0 bugs?**
A: NO. `expect(p0Issues).toHaveLength(0)` forces zero tolerance.

**Q: How often does P0 detection run?**
A: Every time you run `npm run weekly-diff` (recommended: daily).

**Q: What if a P0 is found?**
A: Test fails + Lark notification → Fix → Re-run → Success

**Q: Can I disable P0 detection?**
A: Set `RUN_BUG_DETECTION=0 npm run weekly-diff` (NOT recommended)
