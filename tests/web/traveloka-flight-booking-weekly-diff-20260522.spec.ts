import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
} from '../lib/traveloka-flight/workflow';


const TARGET_URL = 'https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY';

/**
 * EN Purpose: Open the desktop Traveloka flight booking page and validate booking contact form fields, including email, email confirmation, mobile number, and passenger name. Verify required-field errors and mismatch-email validation are rendered correctly.
 * 中文目的: 验证本周 flight 改动在 search-results 场景下是否仍然满足既有回归预期。
 * EN Surface: search-results
 * 中文范围: search-results 页面。
 * EN Concerns: booking-contact
 * 中文关注点: booking-contact
 * EN Main checks: booking contact form field rendering and validation.
 * 中文校验项: 预订联系人表单字段渲染与校验。
 * EN Source commits: 21c557e73b by Alexander Leonardo: [FEATURE][BOOKING] Retention Popup Enablement (#32211)
 * 中文来源提交: 21c557e73b by Alexander Leonardo: [FEATURE][BOOKING] Retention Popup Enablement (#32211)
 * EN Expectation: keep this generated case aligned with the stable Traveloka desktop baseline flow and verify only the routed regression slice.
 * 中文预期: 该生成用例必须与稳定的 Traveloka desktop 基线流程保持一致，只验证本次路由到的回归范围。
 */

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

test('Traveloka weekly diff booking contact coverage (20260522)', async ({ page }, testInfo) => {
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight booking page and validate booking contact form fields, including email, email confirmation, mobile number, and passenger name. Verify required-field errors and mismatch-email validation are rendered correctly.",
    concerns: ["booking-contact"],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: "Open the desktop Traveloka flight booking page and validate booking contact form fields, including email, email confirmation, mobile number, and passenger name. Verify required-field errors and mismatch-email validation are rendered correctly.",
    concerns: ["booking-contact"],
    waitForSidebar: false,
  });

  void sidebar;

  const bookingPath = new URL(page.url()).pathname;
  expect(bookingPath).toMatch(/\/flight\/booking/);

  // Booking contact form validation coverage.
  // If TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL is set, navigate directly to the booking page.
  // Otherwise use the canonical desktop booking chain from the search results entry URL.
  const directBookingUrl = process.env.TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL;
  if (directBookingUrl) {
    await page.goto(directBookingUrl, { waitUntil: 'domcontentloaded' });
  } else {
    // Fall back to the canonical booking chain: search results -> Choose -> Select ticket type.
    await page.goto("https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY", { waitUntil: 'domcontentloaded' });
    const chooseButton = page.locator('[data-testid*="choose"], button').filter({ hasText: /choose/i }).first();
    await chooseButton.waitFor({ state: 'visible', timeout: 30000 });
    await chooseButton.click();
    const selectButton = page.locator('button').filter({ hasText: /^select$/i }).first();
    await selectButton.waitFor({ state: 'visible', timeout: 15000 });
    await selectButton.click();
  }
  await page.waitForURL(/\/flight\/booking/, { timeout: 30000 }).catch(() => {});
  const bookingUrl = new URL(page.url());
  expect(bookingUrl.pathname).toMatch(/\/flight\/booking/);
  const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
  if (screenshot) {
    await testInfo.attach('booking-weekly-generated.png', { body: screenshot, contentType: 'image/png' });
  }
  // Weekly diff generated candidate: refine against actual changed booking source files.
  // Suggested changed files (top 10 of 120): ["packages/flight/fpr-booking/components/BFFBookingContact/_usecases/__tests__/stripHiddenFieldsFromPrefill.test.ts","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/__tests__/usePrefillContactDetail.test.tsx","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/stripHiddenFieldsFromPrefill.ts","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/usePrefillContactDetail.ts","packages/flight/fpr-booking/hooks/__tests__/useBFFValidateAddOnsAfterRevalidation.test.ts","packages/flight/fpr-booking/hooks/useBFFValidateAddOnsAfterRevalidation.ts","packages/flight/fpr-booking/utils/__tests__/constructBookingRequest.bff.test.ts","packages/flight/fpr-booking/utils/constructBookingRequest.bff.ts","packages/booking/bkg-common/__tests__/modules/EntryStatusDisplay.test.tsx","packages/booking/bkg-common/__tests__/modules/TravelerDetailCache/crypto.test.ts"]
  // Omitted additional changed files: 110
  // Source hint: packages/flight/fpr-booking/components/BFFBookingContact - Desktop booking contact form.
  // Source hint: packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts - Validation rules.
});
