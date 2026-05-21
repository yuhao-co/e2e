import { test } from '../fixture';
import {
  assertMetasearchEmailConfirmationBehavior,
  openBookingPageFromSearchResults,
  openMetasearchBookingContactPage,
} from '../lib/traveloka-flight/workflow';

const DESKTOP_RESULTS_URL =
  'https://www.traveloka.com/en-en/flight/fullsearch?ap=JKTA.DPS&dt=21-5-2026.NA&ps=1.0.0&sc=ECONOMY';

const sourceContext = {
  doc: 'https://traveloka.sg.larksuite.com/wiki/GgkIwomEViKVUvkjYRklv5iPgoe',
  requirement: {
    title: 'Double Email Confirmation Field',
    scope: ['desktop web', 'direct metasearch only', 'Travelko only booking flows'],
    rules: {
      empty: 'Please re-enter your email',
      mismatch: 'Please input the same email address',
      validation: 'Email confirmation field is mandatory and must match the primary email.',
    },
  },
};

/**
 * EN Purpose: Validate the desktop booking-form slice of the Travelko-only metasearch PRD by checking that the email confirmation field is rendered and enforces required + mismatch validation.
 * 中文目的: 验证 Travelko only 直连 metasearch PRD 在 desktop booking form 的切片：确认二次邮箱输入框出现，并校验必填和不一致错误。
 * EN Note: Prefer a direct metasearch booking URL when configured; otherwise fall back to the canonical desktop booking chain as an eligibility probe.
 * 中文说明: 优先使用已配置的直连 metasearch booking URL；若未配置，则退回到已验证的 desktop booking chain 作为 eligibility probe。
 */

test.describe('Traveloka metasearch booking email confirmation', () => {
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

  test('desktop booking shows email confirmation field and validation errors for metasearch cohort', async ({
    page,
  }, testInfo) => {
    await testInfo.attach('traveloka-metasearch-email-confirmation-source.json', {
      body: Buffer.from(JSON.stringify(sourceContext, null, 2)),
      contentType: 'application/json',
    });

    const directMetasearchBookingUrl = process.env.TRAVELOKA_METASEARCH_BOOKING_DESKTOP_URL;

    if (directMetasearchBookingUrl) {
      await openMetasearchBookingContactPage(page, {
        url: directMetasearchBookingUrl,
        viewport: { width: 1440, height: 900 },
      });
    } else {
      await openBookingPageFromSearchResults(page, {
        url: DESKTOP_RESULTS_URL,
        viewport: { width: 1440, height: 900 },
      });
    }

    await assertMetasearchEmailConfirmationBehavior(page, {
      email: 'qa-metasearch@example.com',
      requiredErrorText: sourceContext.requirement.rules.empty,
      mismatchErrorText: sourceContext.requirement.rules.mismatch,
    });

    const afterValidation = await page.screenshot({ fullPage: false }).catch(() => null);
    if (afterValidation) {
      await testInfo.attach('traveloka-metasearch-email-confirmation-after-validation.png', {
        body: afterValidation,
        contentType: 'image/png',
      });
    }
  });
});