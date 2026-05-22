import { expect, test } from '../fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openBookingPageFromSearchResults,
  openMetasearchBookingContactPage,
} from '../lib/traveloka-flight/workflow';

const TARGET_URL = 'https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY';

/**
 * EN Purpose: Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.
 * 中文目的: 验证本周 flight booking 改动在 desktop booking 链路下仍可稳定进入 booking 页面，并保留人工复查所需上下文。
 * EN Surface: booking
 * 中文范围: booking 页面。
 * EN Concerns: booking-entry, weekly-booking-smoke
 * 中文关注点: booking-entry、weekly-booking-smoke
 * EN Main checks: canonical desktop booking entry chain remains reachable; booking page URL is reached; booking page state is captured for weekly review.
 * 中文校验项: 标准 desktop booking 进入链路可达；成功进入 booking 页面；保留 booking 页面状态供周测复查。
 * EN Source commits: 5684ef12c6 by Ke Wu: [FIX][FLIGHT]fix: contact regex prefill (#33349)
 * 中文来源提交: 5684ef12c6 by Ke Wu: [FIX][FLIGHT]fix: contact regex prefill (#33349)
 * EN Source summary: PRD (meegle): https://project.larksuite.com/fpr/issue/detail/12249080 | address: https://project.larksuite.com/fpr/issue/detail/12249080
 * 中文来源摘要: PRD (meegle): https://project.larksuite.com/fpr/issue/detail/12249080 | address: https://project.larksuite.com/fpr/issue/detail/12249080
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

test('Traveloka weekly diff booking smoke coverage (20260522)', async ({ page }, testInfo) => {
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: "Open the desktop Traveloka flight booking flow from search results and verify the canonical booking page remains reachable for the routed weekly regression slice.",
    concerns: ['booking-contact'],
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  const directBookingUrl = process.env.TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL;
  if (directBookingUrl) {
    await openMetasearchBookingContactPage(page, { url: directBookingUrl });
  } else {
    await openBookingPageFromSearchResults(page, { url: workflowPlan.input.url });
  }

  const bookingUrl = new URL(page.url());
  expect(bookingUrl.pathname).toMatch(/\/flight\/booking/);

  const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
  if (screenshot) {
    await testInfo.attach('booking-weekly-generated.png', { body: screenshot, contentType: 'image/png' });
  }

  // Weekly diff generated candidate: refine against actual changed booking source files.
  // Suggested changed files (top 10 of 41): ["packages/flight/fpr-booking/components/BFFBookingContact/_usecases/__tests__/stripHiddenFieldsFromPrefill.test.ts","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/__tests__/usePrefillContactDetail.test.tsx","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/stripHiddenFieldsFromPrefill.ts","packages/flight/fpr-booking/components/BFFBookingContact/_usecases/usePrefillContactDetail.ts","packages/flight/fpr-booking/hooks/__tests__/useBFFValidateAddOnsAfterRevalidation.test.ts","packages/flight/fpr-booking/hooks/useBFFValidateAddOnsAfterRevalidation.ts","packages/flight/fpr-booking/utils/__tests__/constructBookingRequest.bff.test.ts","packages/flight/fpr-booking/utils/constructBookingRequest.bff.ts","packages/booking/bkg-common/__tests__/modules/TravelerDetailCache/crypto.test.ts","packages/booking/bkg-common/__tests__/modules/TravelerDetailCache/deriveCacheKey.test.ts"]
  // Omitted additional changed files: 31
  // Source hint: packages/flight/fpr-booking/components/BFFBookingContact - Desktop booking contact form.
  // Source hint: packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts - Validation rules.
});
