import { test, expect } from '../fixture';
import { GenericBugDetector } from '../lib/generic-bug-detector';

/**
 * EN Purpose: Auto-generated smoke spec for Flight Check-in.
 *   Sub-flow: navigates with a dummy ID. Auth redirect or error state is acceptable.
 *   Only fails on P0 bugs / JS crashes / 5xx before or after redirect.
 *   Navigates to the flight-checkin-entry surface and runs P0 generic bug detection.
 *   Promoted from candidate → stable once it passes consistently for 3+ weeks.
 * EN Source: explore-coverage-gaps.ts — gap scan of www packages: fpr-check-in-components, fpr-check-in
 * EN Domain: flight-checkin-entry
 * EN Lifecycle: candidate
 * EN Surface: desktop
 * EN Concerns: page-load, p0-detection, sub-flow-redirect
 * EN Generated: 2026-05-29T04:00:06.893Z
 */

const TARGET_URL = 'https://www.traveloka.com/en-sg/flight/checkin/airline/TEST_ROUTE_ID';

test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'Asia/Shanghai',
  extraHTTPHeaders: {
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.google.com/',
  },
});

test('Traveloka flight Flight Check-in smoke coverage (20260529)', async ({ page }) => {
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Sub-flow: with a dummy ID the server will redirect to login or show an error state.
  // Both outcomes are valid — we only care that there is no crash or P0 bug.
  const finalUrl = page.url();
  const isAuthRedirect = /login|signin|auth|account/.test(finalUrl);
  const isErrorPage = //404|/500|/error/.test(finalUrl);
  console.log(`\n↪ Final URL: ${finalUrl}`);
  if (isAuthRedirect) {
    console.log('  ✅ Auth redirect — expected for sub-flow with dummy ID');
  } else if (isErrorPage) {
    console.log('  ⚠️  Error page — acceptable for dummy ID, checking for P0 bugs');
  }

  // Basic load sanity: page must have a non-empty title
  const title = await page.title();
  expect(title, 'Page title should be a valid Traveloka page, not an error page').toMatch(/traveloka|flight|airport|airline|hotel|travel/i);

  // P0 generic bug detection (layout, XSS, console errors)
  const detector = new GenericBugDetector(page, { pageType: 'flight-booking' });
  const auditResult = await detector.runFullAudit();
  const p0Issues = auditResult.filter((i) => i.severity === 'P0');

  console.log(`\n📋 Flight Check-in audit: ${auditResult.length} total issues, ${p0Issues.length} P0`);
  if (p0Issues.length > 0) {
    console.error('P0 issues found:', JSON.stringify(p0Issues, null, 2));
  }

  expect(p0Issues, `P0 bugs found on flight-checkin-entry: ${JSON.stringify(p0Issues)}`).toHaveLength(0);
});
