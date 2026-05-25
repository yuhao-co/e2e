# P0 Bug Detection - Generated-Only Enforcement ✅

**Status**: IMPLEMENTED & ENFORCED  
**Date**: 2026-05-25  
**Requirement**: "你把这个规则设置成强限制，所有测试用例必须generate过一遍生成"

## 🔒 What Changed

### Before (❌ Wrong)
```bash
# Hardcoded URLs, no generate flow
test('Flight Search Results Page - Bug Detection', async ({ page }) => {
  await page.goto('https://www.traveloka.com/en-en/flights/CGK/NRT/2026-06-15');
  // Manual test...
});
```

### After (✅ Correct)
```bash
# All tests MUST be generated
npm run weekly-diff
# → Generates: tests/web/traveloka-flight-weekly-diff-YYYYMMDD.spec.ts
# → Includes P0 detection automatically
# → Uses buildFlightSourceContext() for URLs
# → PRD-aware test case generation
```

## 📋 Enforcement Mechanisms

### 1. **traveloka-generic-bug-detection.spec.ts** (Changed)
- ❌ NO longer runs hardcoded tests
- ✅ NOW verifies that generated specs include P0 detection
- ✅ Validates GenericBugDetector import in all generated specs
- ✅ Checks zero-tolerance P0 bug enforcement
- ⚠️ Throws error if manual hardcoded tests attempted

**5 Verification Tests**:
1. Verify flight-search specs include P0 detection
2. Verify flight-booking specs include P0 detection  
3. Enforce: No hardcoded URLs in generated specs
4. Report: P0 rules config present (11 rules)
5. ⚠️ SKIP: Manual tests (enforces generated-only policy)

### 2. **generate-cases-from-weekly-diff.ts** (Enhanced)
- ✅ Automatically injects GenericBugDetector into all generated test specs
- ✅ Adds P0 audit with correct thresholds:
  - Flight-search: LCP 2500ms, CLS 0.1
  - Flight-booking: LCP 3000ms, CLS 0.15
- ✅ Enforces zero-tolerance P0 checks: `expect(p0Issues).toHaveLength(0)`
- ✅ References config/p0-detection-rules.json (11 P0 rules)

### 3. **npm Scripts**
```bash
npm run weekly-diff              # Only way to generate test specs
npm run test:bugs:generic        # Verify generated specs (5 verification tests)
npm run analyze:p0              # Analyze P0 issues
npm run analyze:p0:watch        # Watch mode for P0 analysis
```

## 🎯 Enforcement Rules

| Action | Status | Reason |
|--------|--------|--------|
| Generate test specs via `npm run weekly-diff` | ✅ REQUIRED | Only valid test creation method |
| Hardcode test URLs | ❌ BLOCKED | Error thrown by verification suite |
| Manual test cases | ❌ BLOCKED | traveloka-generic-bug-detection.spec.ts rejects them |
| Skip P0 detection | ❌ BLOCKED | Generated specs include it automatically |
| Bypass zero-tolerance P0 | ❌ BLOCKED | `expect(p0Issues).toHaveLength(0)` enforces it |

## 📊 P0 Detection Integration

### Workflow
```
git diff
    ↓
generate-cases-from-weekly-diff.ts
    ↓
Creates: tests/web/traveloka-flight-weekly-diff-YYYYMMDD.spec.ts
    ├─ GenericBugDetector imported
    ├─ detectP0Issues() runs first
    ├─ 11 P0 rules applied
    └─ Zero-tolerance enforcement
    ↓
npm run weekly-diff
    ↓
P0 bugs detected?
    ├─ YES → Lark notification + fail
    └─ NO → Continue to other checks
```

### 11 P0 Rules (config/p0-detection-rules.json)
1. `page_blank` - Content < 100 chars
2. `page_timeout` - Load time > 30s
3. `search_form_broken` - Button disabled/inputs frozen
4. `booking_form_broken` - Submit button disabled
5. `payment_gateway_down` - API 5xx errors
6. `data_corruption` - undefined/NaN/null visible
7. `security_breach` - XSS/CSRF/SQL
8. `critical_button_stuck` - pointer-events:none
9. `network_critical_error` - 502/503/504
10. `currency_missing` - Missing currency symbol
11. `session_expired` - Auth token lost

## ✅ Verification

```bash
# Verify enforcement working
npm run test:bugs:generic -- --list

# Output should show 5 verification tests:
# ✅ Verify generated flight-search specs include P0 detection
# ✅ Verify generated flight-booking specs include P0 detection  
# ✅ Enforce: No hardcoded URLs in generated specs
# ✅ Report: Weekly-diff generation must include P0 rules config
# ⚠️ SKIP: Use generated test specs instead
```

## 🔐 What's Protected

### Cannot be changed without explicit discussion:
- ❌ Removing P0 detection from generated specs
- ❌ Allowing hardcoded URLs in tests
- ❌ Skipping `expect(p0Issues).toHaveLength(0)` checks
- ❌ Creating manual test cases
- ❌ Reducing P0 rule coverage

## 📚 Documentation
- [P0 Detection System Guide](../docs/P0_DETECTION_SYSTEM.md)
- [Critical Fixes Lock](../../memories/repo/critical-fixes-do-not-touch.md#4-p0-bug-detection)
