import { test } from '../fixture';
import {
  assertMetasearchEmailConfirmationBehavior,
  openBookingPageFromSearchResults,
  openMetasearchBookingContactPage,
} from '../lib/traveloka-flight/workflow';

const DESKTOP_RESULTS_URL =
  'https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY';
const DESKTOP_BOOKING_URL = process.env.TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL ?? '';
const MWEB_BOOKING_URL = process.env.TRAVELOKA_METASEARCH_BOOKING_MWEB_URL ?? '';

const sourceContext = {
  pr: 'https://github.com/traveloka/www/pull/33383',
  doc: 'https://traveloka.sg.larksuite.com/docx/BIcAdsOQtoMrUHxO6kelWLkOgMb',
  requirement: {
    title: 'Double Email Confirmation Field for Travelko Direct Metasearch Bookings',
    why: 'Travelko requested a second email field to reduce complaints about missing booking confirmation emails caused by typos.',
    risk: 'Guardrail metric is CVR before payment; added friction must be controlled with affiliateId gating and A/B testing.',
    scope: ['config per affiliateId in BE', 'AB test in BE', 'direct metasearch only', 'App/MWeb/DWeb'],
    errorTexts: {
      required: 'Please re-enter your email',
      mismatch: 'Please input the same email address',
    },
  },
  changedFiles: [
    'packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactDesktop.tsx',
    'packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactMobileVDTray.tsx',
    'packages/flight/fpr-booking/components/handlers/bookingContactValidationHandler.ts',
    'packages/flight/fpr-booking/constants/ResourceQueries.bff.ts',
    'packages/flight/fpr-booking/constants/MobileResourceQueries.bff.ts',
  ],
};

/**
 * EN Purpose: Validate the Travelko direct-metasearch booking contact flow for the double email confirmation feature introduced by PR 33383, using the docx PRD as the primary source.
 * 中文目的: 基于 PR 33383 与 docx PRD，验证 Travelko direct metasearch 预订联系信息页的双邮箱确认能力。
 * EN Surface: booking-contact on direct metasearch booking flow.
 * 中文范围: direct metasearch 预订流中的 booking-contact 页面。
 * EN Booking chain: fullsearch results -> Choose -> Select ticket type drawer -> Select -> booking.
 * 中文预订链路: fullsearch 结果页 -> Choose -> Select ticket type 抽屉 -> Select -> booking。
 * EN Concerns: email-confirmation visibility, required validation, mismatch validation, desktop/mobile parity, metasearch gating.
 * 中文关注点: 邮箱确认字段展示、必填校验、不一致校验、桌面/移动端一致性、metasearch 触发条件。
 * EN Main checks: start from fullsearch results, click choose and select to reach booking; show confirmation field only on eligible Travelko direct-metasearch booking flow; surface the PRD error text "Please re-enter your email" when empty; surface the PRD error text "Please input the same email address" when mismatched; allow submit path once both email values match.
 * 中文校验项: 从 fullsearch 结果页出发，点击 choose 和 select 进入 booking；仅在符合条件的 Travelko direct metasearch 预订流展示确认字段；为空时提示 PRD 文案“Please re-enter your email”；不一致时提示 PRD 文案“Please input the same email address”；两次邮箱一致后允许继续提交链路。
 * EN Source commits: PR 33383 - [FEATURE][FLIGHT] email confirmation.
 * 中文来源提交: PR 33383 - [FEATURE][FLIGHT] email confirmation。
 * EN Source summary: PRD confirms this is Travelko-only, direct-metasearch-only, affiliate-configured and AB-tested, with exact error copy for empty and mismatched confirmation email.
 * 中文来源摘要: PRD 明确该能力仅适用于 Travelko direct metasearch，并受 affiliate 配置和 AB test 控制，同时给出了为空和不一致时的精确报错文案。
 * EN Expectation: this generated case replaces the previous search-results slice and stays focused on booking-contact validation until a direct metasearch booking URL is available.
 * 中文预期: 该生成用例替换之前错误的结果页场景，在 direct metasearch booking URL 明确前保持聚焦于 booking-contact 校验。
 */

test.describe('Traveloka weekly diff generated metasearch email confirmation coverage', () => {
  test('desktop fullsearch to booking validates email confirmation', async ({ page }, testInfo) => {

    await testInfo.attach('metasearch-email-confirmation-source.json', {
      body: Buffer.from(JSON.stringify(sourceContext, null, 2)),
      contentType: 'application/json',
    });

    await openBookingPageFromSearchResults(page, {
      url: DESKTOP_RESULTS_URL,
    });

    await assertMetasearchEmailConfirmationBehavior(page, {
      email: 'qa-metasearch@example.com',
      requiredErrorText: sourceContext.requirement.errorTexts.required,
      mismatchErrorText: sourceContext.requirement.errorTexts.mismatch,
    });
  });
});

test.describe('Traveloka weekly diff generated metasearch email confirmation coverage mobile', () => {
  test('mweb direct-metasearch booking shows and validates email confirmation', async ({ page }, testInfo) => {
    test.skip(
      !MWEB_BOOKING_URL,
      'Needs TRAVELOKA_METASEARCH_BOOKING_MWEB_URL that lands directly on the eligible metasearch booking-contact tray.',
    );

    await testInfo.attach('metasearch-email-confirmation-source.json', {
      body: Buffer.from(JSON.stringify(sourceContext, null, 2)),
      contentType: 'application/json',
    });

    await openMetasearchBookingContactPage(page, {
      url: MWEB_BOOKING_URL,
      viewport: { width: 390, height: 844 },
    });

    await assertMetasearchEmailConfirmationBehavior(page, {
      email: 'qa-metasearch@example.com',
      requiredErrorText: sourceContext.requirement.errorTexts.required,
      mismatchErrorText: sourceContext.requirement.errorTexts.mismatch,
    });
  });
});
