import { test, expect } from '../fixture';
import { GenericBugDetector } from '../lib/generic-bug-detector';

/**
 * EN Purpose: Auto-generated smoke spec for Flight Reschedule Entry.
 *   Navigates to the flight-reschedule-entry surface and runs P0 generic bug detection.
 *   Promoted from candidate → stable once it passes consistently for 3+ weeks.
 * EN Source: explore-coverage-gaps.ts — gap scan of www packages: fpr-reschedule-components, fpr-reschedule-form, fpr-reschedule-mobile, fpr-reschedule-policy-mobile, fpr-reschedule-policy, fpr-reschedule-search-result, fpr-reschedule
 * EN Domain: flight-reschedule-entry
 * EN Lifecycle: candidate
 * EN Surface: desktop
 * EN Concerns: page-load, p0-detection
 * EN Generated: 2026-05-27T04:00:02.335Z
 */

const TARGET_URL = 'https://www.traveloka.com/en-sg/flight/reschedule';

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

test('Traveloka flight Flight Reschedule Entry smoke coverage (20260527)', async ({ page }) => {
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Basic load sanity: page must have a non-empty title
  const title = await page.title();
  expect(title, 'Page title should be a valid Traveloka page, not an error page').toMatch(/traveloka|flight|airport|airline|hotel|travel/i);

  // P0 generic bug detection (layout, XSS, console errors)
  const detector = new GenericBugDetector(page, { pageType: 'flight-booking' });
  const auditResult = await detector.runFullAudit();
  const p0Issues = auditResult.filter((i) => i.severity === 'P0');

  console.log(`\n📋 Flight Reschedule Entry audit: ${auditResult.length} total issues, ${p0Issues.length} P0`);
  if (p0Issues.length > 0) {
    console.error('P0 issues found:', JSON.stringify(p0Issues, null, 2));
  }

  expect(p0Issues, `P0 bugs found on flight-reschedule-entry: ${JSON.stringify(p0Issues)}`).toHaveLength(0);
});
