/**
 * Traveloka Android home-page i18n quick audit.
 *
 * Switches the in-app language through:
 *   English → Indonesian → Vietnamese → Thai → Chinese → Korean → Japanese
 * After each switch, screenshots the Home tab and asks Qwen2.5-VL to list
 * every visible string that is NOT in the expected language.
 *
 * Output:
 *   audit-output/home-i18n/<id>.png        raw screenshot
 *   audit-output/home-i18n/<id>.json       { locale, untranslated: [{text, reason}] }
 *   audit-output/home-i18n/summary.json    aggregated
 *
 * Run:
 *   npx tsx tests/traveloka-home-i18n.spec.ts
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { agentFromAdbDevice, type AndroidAgent } from '@midscene/android';

const PACKAGE = 'com.traveloka.android';
const OUT = path.resolve(__dirname, '..', 'audit-output', 'home-i18n');

type Locale = {
  id: string;
  /** Label as shown in Traveloka's in-app language picker. */
  label: string;
  /** Language name we feed to the VLM. */
  expected: string;
  /** Script family expected to dominate the page. */
  scripts: string[];
};

// Order matters: we walk the list in sequence, switching from whatever the
// previous step left us in. English first to normalise state.
const LOCALES: Locale[] = [
  { id: 'en', label: 'English',          expected: 'English',            scripts: ['Latin'] },
  { id: 'id', label: 'Bahasa Indonesia', expected: 'Indonesian',         scripts: ['Latin'] },
  { id: 'vi', label: 'Tiếng Việt',       expected: 'Vietnamese',         scripts: ['Latin (Vietnamese diacritics)'] },
  { id: 'th', label: 'ภาษาไทย',          expected: 'Thai',               scripts: ['Thai'] },
  { id: 'zh', label: '中文',              expected: 'Simplified Chinese', scripts: ['Han (Chinese)'] },
  { id: 'ko', label: '한국어',            expected: 'Korean',             scripts: ['Hangul'] },
  { id: 'ja', label: '日本語',            expected: 'Japanese',           scripts: ['Hiragana', 'Katakana', 'Kanji'] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function adbScreencap(dest: string) {
  execSync('adb shell screencap -p /sdcard/ms_audit.png');
  execSync(`adb pull /sdcard/ms_audit.png "${dest}"`, { stdio: 'pipe' });
}

type Untranslated = {
  text: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
};

async function switchLanguage(agent: AndroidAgent, locale: Locale) {
  console.log(`\n=== switching to ${locale.label} (${locale.expected}) ===`);

  // Go to My Account.
  await agent.aiAction(
    'Tap the rightmost bottom navigation tab labeled "My Account" / "Akun Saya" / ' +
    '"Tài khoản" / "บัญชีของฉัน" / "我的账户" / "내 계정" / "アカウント" ' +
    '(person/avatar icon).',
  );
  await sleep(2500);

  // Open Country & Language. The icon is a globe; label varies by locale.
  await agent.aiAction(
    'Scroll down a bit if necessary, then tap the row that opens the country and ' +
    'language settings. It has a globe icon and the label may be "Country & Language", ' +
    '"Negara & Bahasa", "Quốc gia & Ngôn ngữ", "ประเทศและภาษา", "国家和语言", "국가 및 언어", ' +
    'or "国と言語".',
  );
  await sleep(2500);

  // Tap the language field (second field, below the country/currency one).
  await agent.aiAction(
    'Tap the "Language" field (the second selectable row, below currency/country) ' +
    'to open the language picker.',
  );
  await sleep(2000);

  // Pick the target language.
  await agent.aiAction(
    `In the language list, tap the entry "${locale.label}". ` +
    'Scroll the list if needed to find it.',
  );
  await sleep(2500);

  // Confirm / save / back.
  await agent.aiAction(
    'If a Save / Apply / Confirm / Simpan / Lưu / บันทึก / 保存 / 저장 / 確認 button ' +
    'is visible, tap it. Otherwise tap the back arrow at the top-left to commit. ' +
    'Wait for the app to reload with the new language.',
  );
  await sleep(5000);

  // Back to home tab.
  await agent.aiAction(
    'Tap the leftmost bottom navigation tab (Home / Beranda / Trang chủ / หน้าแรก / ' +
    '首页 / 홈 / ホーム — bird/house icon) to return to the home screen.',
  );
  await sleep(3500);
}

async function auditHome(agent: AndroidAgent, locale: Locale) {
  fs.mkdirSync(OUT, { recursive: true });
  const png = path.join(OUT, `${locale.id}.png`);
  adbScreencap(png);

  const findings = await agent.aiQuery<Untranslated[]>(
    `Array<{ text: string, reason: string, severity: "high" | "medium" | "low" }>`,
    `The Traveloka Android home screen is currently set to ${locale.expected} ` +
    `(${locale.label}). Expected script: ${locale.scripts.join(', ')}.

List every visible piece of text that is NOT in ${locale.expected}.
For each item, set:
  - text:   the exact visible string (copy it verbatim).
  - reason: why it is wrong, e.g. "still in English", "mixed English+Indonesian",
            "untranslated key", "wrong script".
  - severity: high | medium | low.

IGNORE these (do NOT report them):
  - Brand and proper names: Traveloka, HSBC, Maybank, Visa, Mastercard,
    airline names, hotel names, city names, airport codes (SIN, CGK).
  - Pure numbers, prices, percentages, and dates.
  - The Android system status bar at the very top.
  - Bottom navigation icons that are purely graphical.
  - Promotional banner images that contain baked-in graphics text.

If everything visible is correctly in ${locale.expected}, return [].`,
  );

  const list = Array.isArray(findings) ? findings : [];
  fs.writeFileSync(
    path.join(OUT, `${locale.id}.json`),
    JSON.stringify({ locale, untranslated: list }, null, 2),
  );
  console.log(`[${locale.id}] ${list.length} untranslated string(s) → ${png}`);
  for (const f of list) {
    console.log(`  - (${f.severity}) "${f.text}" — ${f.reason}`);
  }
  return list;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const agent = await agentFromAdbDevice(undefined, { autoDismissKeyboard: true });
  await agent.launch(PACKAGE);
  await sleep(5000);

  // Make sure we start on Home (no leftover popups).
  await agent.aiAction(
    'If a popup, banner, permission dialog or onboarding overlay is blocking the ' +
    'home screen, dismiss it. Otherwise do nothing.',
  );
  await sleep(1500);
  await agent.aiAction(
    'Tap the "Home" tab at the bottom-left of the screen to make sure we are on the home screen.',
  );
  await sleep(2000);

  const summary: Record<string, { count: number; items: Untranslated[] }> = {};

  for (const locale of LOCALES) {
    try {
      await switchLanguage(agent, locale);
    } catch (err) {
      console.error(`[${locale.id}] switch failed:`, (err as Error).message);
      // Try to recover by going back to home.
      await agent.aiAction('Tap back / Home tab until the home screen is visible.').catch(() => {});
      await sleep(2000);
    }
    try {
      const items = await auditHome(agent, locale);
      summary[locale.id] = { count: items.length, items };
    } catch (err) {
      console.error(`[${locale.id}] audit failed:`, (err as Error).message);
      summary[locale.id] = { count: -1, items: [] };
    }
  }

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[done] artifacts in ${OUT}`);
  console.log('summary:');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${v.count} untranslated`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
