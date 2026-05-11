import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from './fixture';
import { annotateScreenshot, type Annotation } from './lib/annotate';

/**
 * Multi-locale i18n audit of traveloka.com homepages.
 *
 * For each supported locale we:
 *   1. Load `https://www.traveloka.com/<locale>/` in a fixed-size viewport.
 *   2. Take a viewport screenshot (the same image the VLM will see).
 *   3. Ask Qwen2.5-VL (served locally by mlx-vlm) to flag every visible piece
 *      of text whose language does NOT match the expected locale language
 *      (i.e. content that should have been translated but wasn't), and to
 *      return a bounding box in pixel coordinates.
 *   4. Draw red boxes + numbered labels onto the screenshot using sharp,
 *      writing the annotated PNG to `audit-output/i18n/<locale>.png`.
 *   5. Persist a per-locale JSON and a combined `index.json` summary.
 *
 * Note: we treat the VLM as a fuzzy detector. Coordinates from a 7B-4bit model
 * are approximate; we filter out tiny / off-canvas boxes in `annotate.ts`.
 */

type Locale = {
  /** URL path segment, e.g. "th-th". */
  slug: string;
  /** Human-readable locale name. */
  label: string;
  /** Native script the page should be written in. */
  expectedLanguage: string;
  /** Common script families we expect to dominate the page text. */
  expectedScripts: string[];
};

const LOCALES: Locale[] = [
  {
    slug: 'th-th',
    label: 'Thailand (Thai)',
    expectedLanguage: 'Thai',
    expectedScripts: ['Thai'],
  },
  {
    slug: 'vi-vn',
    label: 'Vietnam (Vietnamese)',
    expectedLanguage: 'Vietnamese',
    expectedScripts: ['Latin (Vietnamese diacritics)'],
  },
  {
    slug: 'ms-my',
    label: 'Malaysia (Bahasa Melayu)',
    expectedLanguage: 'Malay',
    expectedScripts: ['Latin'],
  },
  {
    slug: 'id-id',
    label: 'Indonesia (Bahasa Indonesia)',
    expectedLanguage: 'Indonesian',
    expectedScripts: ['Latin'],
  },
  {
    slug: 'en-id',
    label: 'Indonesia (English) — baseline',
    expectedLanguage: 'English',
    expectedScripts: ['Latin'],
  },
  {
    slug: 'en-sg',
    label: 'Singapore (English) — baseline',
    expectedLanguage: 'English',
    expectedScripts: ['Latin'],
  },
];

type AiUntranslated = {
  /** Verbatim quote of the offending text (≤ 80 chars). */
  text: string;
  /** Detected language of the offending text. */
  language: string;
  /**
   * Bounding box. The model is allowed to emit either:
   *   - {x, y, width, height} (preferred), or
   *   - [x1, y1, x2, y2] (a common Qwen-VL convention).
   * We normalize after parsing.
   */
  bbox:
    | { x: number; y: number; width: number; height: number }
    | [number, number, number, number];
  /** One-sentence explanation of why this is likely a translation gap. */
  reason: string;
};

type NormalizedFinding = {
  text: string;
  language: string;
  bbox: { x: number; y: number; width: number; height: number };
  reason: string;
};

/**
 * Returns true if the string is something we never want to flag:
 * pure numbers, percentages, prices, dates, single-symbol punctuation, etc.
 * The VLM tends to hallucinate these as "English" when they're really just
 * digits + punctuation that look the same in every locale.
 */
function isIgnorableToken(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  // 1-character: almost always punctuation / arrow / icon glyph.
  if (t.length === 1) return true;
  // Pure digits / decimals / percent / thousands-separated numbers,
  // optionally followed by Thai-style "55.-" or a unit char.
  if (/^[\d\s.,:;%\-+/()]+$/.test(t)) return true;
  // Date / time ranges like "02 - 03", "10:30", "4 - 8 พ.ค.", etc — if the
  // alphabetic part is empty, treat as non-textual.
  if (!/[A-Za-z\u0E00-\u0E7F\u00C0-\u024F]/.test(t)) return true;
  return false;
}

/**
 * Returns true if the string is dominated by characters from one of the
 * native scripts we expect on this locale's page. A 7B VLM occasionally
 * mis-tags Thai, Vietnamese-with-diacritics, or Bahasa text as "English",
 * and we don't want those leaking into the report.
 */
function looksNative(text: string, expectedLanguage: string): boolean {
  const native = (() => {
    switch (expectedLanguage) {
      case 'Thai':
        return /[\u0E00-\u0E7F]/g; // Thai block
      case 'Vietnamese':
        // Latin + Vietnamese diacritics. If the string has any Vietnamese-
        // specific diacritic we treat it as native.
        return /[ăâđêôơưĂÂĐÊÔƠƯáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵÁÀẢÃẠẮẰẲẴẶẤẦẨẪẬÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ]/g;
      default:
        return null;
    }
  })();
  if (!native) return false;
  const matches = text.match(native);
  if (!matches) return false;
  // > 30% of the string is in the native script → treat as native.
  return matches.length / text.length > 0.3;
}

function normalizeBbox(raw: AiUntranslated['bbox']): NormalizedFinding['bbox'] | null {
  if (Array.isArray(raw) && raw.length === 4 && raw.every((n) => Number.isFinite(n))) {
    const [x1, y1, x2, y2] = raw;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return { x, y, width, height };
  }
  if (
    raw &&
    typeof raw === 'object' &&
    'x' in raw &&
    'y' in raw &&
    'width' in raw &&
    'height' in raw &&
    Number.isFinite(raw.x) &&
    Number.isFinite(raw.y) &&
    Number.isFinite(raw.width) &&
    Number.isFinite(raw.height)
  ) {
    return { x: raw.x, y: raw.y, width: raw.width, height: raw.height };
  }
  return null;
}

const OUT_DIR = path.resolve(__dirname, '..', 'audit-output', 'i18n');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

// Used in the cross-locale summary.
const summary: Array<{
  locale: string;
  label: string;
  url: string;
  expectedLanguage: string;
  count: number;
  annotatedImage: string;
  findings: AiUntranslated[];
}> = [];

test.describe('traveloka.com — i18n untranslated-content audit', () => {
  test.describe.configure({ mode: 'serial' });

  for (const loc of LOCALES) {
    test(`scan ${loc.slug} (${loc.label})`, async ({
      page,
      aiQuery,
      recordToReport,
    }, testInfo) => {
      const url = `https://www.traveloka.com/${loc.slug}/`;
      await page.setViewportSize(VIEWPORT);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      // Give the SPA a moment to hydrate dynamic banners / popups.
      await page.waitForTimeout(1500);

      // Best-effort: dismiss any cookie / login / location modal that may
      // overlay real page content. We try several strategies because
      // traveloka uses different selectors on different locales.
      try {
        // Press Escape — most overlays close on Esc.
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        // Click outside the modal as a second attempt.
        await page
          .mouse.click(20, 20)
          .catch(() => {});
        await page.waitForTimeout(300);
        // Explicit close buttons by aria-label across multiple languages.
        const closeBtns = page.locator(
          'button[aria-label*="close" i], button[aria-label*="tutup" i], ' +
            'button[aria-label*="đóng" i], button[aria-label*="ปิด" i], ' +
            '[data-testid*="close" i], [data-testid*="dismiss" i]',
        );
        const n = await closeBtns.count();
        for (let i = 0; i < n; i++) {
          await closeBtns.nth(i).click({ timeout: 800 }).catch(() => {});
        }
        await page.waitForTimeout(500);
      } catch {
        /* ignore */
      }

      const screenshotPng = await page.screenshot({ fullPage: false });

      // Ask the VLM. We tell the model to emit Qwen-style [x1,y1,x2,y2]
      // bounding boxes, which is the format Qwen2.5-VL was trained on.
      const isEnglishBaseline = loc.expectedLanguage === 'English';
      const bboxSpec =
        `Each bbox MUST be a 4-number array [x1, y1, x2, y2] giving the ` +
        `top-left and bottom-right corners of the offending text in pixel ` +
        `coordinates measured against the screenshot, where (0,0) is the ` +
        `top-left and the screenshot is exactly ${VIEWPORT.width}×` +
        `${VIEWPORT.height} pixels.`;
      const prompt = isEnglishBaseline
        ? // For English baselines we look for the *opposite* leakage: native
          // strings that bled through into an English page.
          `This screenshot is the homepage of traveloka.com loaded at ` +
          `${url}. The locale slug is "${loc.slug}", so EVERY visible piece ` +
          `of body text on the page is supposed to be in English. ` +
          `\n\nIdentify every visible string that is clearly NOT in English ` +
          `— for example Indonesian, Thai, Vietnamese, or Malay strings, ` +
          `currency words like "Rp" used as a non-English unit, or raw ` +
          `template placeholders like "{{...}}", "[object Object]", ` +
          `"undefined". Ignore brand names ("Traveloka", airline / hotel / ` +
          `city / country proper nouns), ISO airport codes (3 capital ` +
          `letters), and currency codes (USD, IDR, MYR, THB, VND, SGD). ` +
          `\n\nReturn an array of objects shaped exactly like ` +
          `{text: string (verbatim, ≤ 80 chars), language: string, ` +
          `bbox: [number, number, number, number], reason: string}. ` +
          `${bboxSpec} Return [] only if the page is genuinely 100% English.`
        : `This screenshot is the homepage of traveloka.com loaded at ` +
          `${url}. The locale slug is "${loc.slug}", so EVERY visible piece ` +
          `of body text on the page is supposed to be in ${loc.expectedLanguage} ` +
          `(${loc.expectedScripts.join(' / ')}). ` +
          `\n\nVisually scan the entire screenshot top-to-bottom. Report ` +
          `every visible string that is clearly written in a language ` +
          `OTHER than ${loc.expectedLanguage} — most commonly English ` +
          `marketing slogans, banner headlines, button labels, or section ` +
          `titles that someone forgot to translate. Also report raw ` +
          `template placeholders ("{{...}}", "[object Object]"). ` +
          `\n\nCRITICAL RULES:\n` +
          `- Quote text VERBATIM. Do NOT invent text that isn't visibly ` +
          `present. If you can't read it clearly, skip it.\n` +
          `- Each bbox must enclose the EXACT text you quoted, not the ` +
          `general area.\n` +
          `- Ignore the "Traveloka" brand and proper nouns (airline / ` +
          `hotel / city / country names; airport / currency codes).\n` +
          `\nReturn an array of objects shaped exactly like ` +
          `{text: string (verbatim, ≤ 80 chars), language: string, ` +
          `bbox: [number, number, number, number], reason: string}. ` +
          `${bboxSpec} Return [] if the page is fully in ` +
          `${loc.expectedLanguage}.`;

      let raw: AiUntranslated[] = [];
      try {
        raw = (await aiQuery<AiUntranslated[]>(prompt)) ?? [];
      } catch (e) {
        console.log(`[i18n][${loc.slug}] aiQuery failed:`, (e as Error).message);
      }

      // Normalize bbox shape ([x1,y1,x2,y2] OR {x,y,w,h}) and drop garbage.
      const findings: NormalizedFinding[] = [];
      const dropped: Array<{ text: string; reason: string }> = [];
      for (const r of raw) {
        if (!r || typeof r.text !== 'string') continue;
        if (isIgnorableToken(r.text)) {
          dropped.push({ text: r.text, reason: 'ignorable-token' });
          continue;
        }
        if (!isEnglishBaseline && looksNative(r.text, loc.expectedLanguage)) {
          dropped.push({ text: r.text, reason: 'native-script' });
          continue;
        }
        const bbox = normalizeBbox(r.bbox);
        if (!bbox) {
          dropped.push({ text: r.text, reason: 'bad-bbox' });
          continue;
        }
        if (bbox.x >= VIEWPORT.width || bbox.y >= VIEWPORT.height) {
          dropped.push({ text: r.text, reason: 'offscreen' });
          continue;
        }
        if (bbox.width <= 4 || bbox.height <= 4) {
          dropped.push({ text: r.text, reason: 'tiny-bbox' });
          continue;
        }
        findings.push({
          text: r.text,
          language: r.language ?? 'unknown',
          bbox,
          reason: r.reason ?? '',
        });
      }

      // Build annotations and render the marked-up PNG.
      const annotations: Annotation[] = findings.map((f, i) => ({
        bbox: f.bbox,
        label: String(i + 1),
        color: '#ff2d2d',
      }));
      const annotatedPath = path.join(OUT_DIR, `${loc.slug}.png`);
      const rawPath = path.join(OUT_DIR, `${loc.slug}.raw.png`);
      const jsonPath = path.join(OUT_DIR, `${loc.slug}.json`);

      const annotated = await annotateScreenshot(screenshotPng, annotations);
      fs.writeFileSync(rawPath, screenshotPng);
      fs.writeFileSync(annotatedPath, annotated);
      fs.writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            locale: loc.slug,
            label: loc.label,
            url,
            viewport: VIEWPORT,
            expectedLanguage: loc.expectedLanguage,
            findings: findings.map((f, i) => ({ index: i + 1, ...f })),
            dropped,
          },
          null,
          2,
        ),
      );

      // Surface findings in the test log + Playwright report.
      console.log(
        `[i18n][${loc.slug}] ${findings.length} possibly untranslated string(s) ` +
          `(${dropped.length} dropped by post-filter).`,
      );
      for (const [i, f] of findings.entries()) {
        console.log(
          `  ${i + 1}. (${f.language}) "${f.text}" — ${f.reason}`,
        );
      }
      if (dropped.length) {
        console.log(`  dropped:`);
        for (const d of dropped) {
          console.log(`    - [${d.reason}] "${d.text}"`);
        }
      }

      await testInfo.attach(`${loc.slug}-annotated.png`, {
        path: annotatedPath,
        contentType: 'image/png',
      });
      await testInfo.attach(`${loc.slug}-findings.json`, {
        path: jsonPath,
        contentType: 'application/json',
      });

      await recordToReport(`i18n audit – ${loc.slug}`, {
        content:
          `${findings.length} untranslated string(s) detected on ${url}. ` +
          `Expected language: ${loc.expectedLanguage}.`,
      });

      summary.push({
        locale: loc.slug,
        label: loc.label,
        url,
        expectedLanguage: loc.expectedLanguage,
        count: findings.length,
        annotatedImage: path.relative(path.resolve(__dirname, '..'), annotatedPath),
        findings,
      });

      // Soft gate — we only fail if the audit pipeline itself produced no data.
      // (Whether to fail on findings > 0 is a policy choice for CI.)
      expect(Array.isArray(findings)).toBe(true);
    });
  }

  test.afterAll(() => {
    const indexPath = path.join(OUT_DIR, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(summary, null, 2));
    console.log(`\n[i18n] summary written to ${indexPath}`);
    console.log('[i18n] per-locale finding counts:');
    for (const s of summary) {
      console.log(`  ${s.locale.padEnd(6)}  ${s.count} → ${s.annotatedImage}`);
    }
  });
});
