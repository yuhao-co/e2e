/**
 * Traveloka Android: flight search UI + i18n audit.
 *
 * Flow per locale:
 *   1. Switch app language via My Account → Settings (or Welcome screen on first run).
 *   2. Return to Home, tap the Flights tile.
 *   3. Capture the flight search form, run UI audit + i18n audit.
 *   4. Tap Search to reach the results page (using whatever default values
 *      the app fills in). Capture and audit again.
 *   5. Save annotated screenshots + JSON to audit-output/android/<locale>/.
 *
 * Run:
 *   npx tsx tests/traveloka-android-audit.spec.ts
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { agentFromAdbDevice, type AndroidAgent } from '@midscene/android';
import { annotateScreenshot, type Annotation } from './lib/annotate';

type RawDefect = {
  label: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  bbox: [number, number, number, number];
};

function toAnnotations(items: RawDefect[], color: string): Annotation[] {
  return items
    .filter((it) => Array.isArray(it.bbox) && it.bbox.length === 4)
    .map((it, i) => ({
      label: `${i + 1}: ${it.label}`,
      color,
      bbox: {
        x: it.bbox[0],
        y: it.bbox[1],
        width: it.bbox[2],
        height: it.bbox[3],
      },
    }));
}

const PACKAGE = 'com.traveloka.android';
const OUT_ROOT = path.resolve(__dirname, '..', 'audit-output', 'android');

type Locale = {
  /** App language label as shown in the Traveloka language picker. */
  label: string;
  /** Stable filesystem-friendly id. */
  id: string;
  /** Language Qwen should expect to dominate the screen. */
  expectedLanguage: string;
  /** Script families we expect. */
  expectedScripts: string[];
};

const LOCALES: Locale[] = [
  {
    id: 'en',
    label: 'English',
    expectedLanguage: 'English',
    expectedScripts: ['Latin'],
  },
  {
    id: 'id',
    label: 'Bahasa Indonesia',
    expectedLanguage: 'Indonesian',
    expectedScripts: ['Latin'],
  },
  {
    id: 'zh',
    label: '中文',
    expectedLanguage: 'Simplified Chinese',
    expectedScripts: ['Han (Chinese)'],
  },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function adbScreencap(dest: string) {
  // High-fidelity screenshot directly from the device (Midscene's internal
  // screenshots are also available via report HTML, but we want pixel-accurate
  // copies for the annotator).
  const tmpOnDevice = '/sdcard/ms_audit.png';
  execSync(`adb shell screencap -p ${tmpOnDevice}`);
  execSync(`adb pull ${tmpOnDevice} "${dest}"`, { stdio: 'pipe' });
}

async function uiAudit(
  agent: AndroidAgent,
  screen: string,
  locale: Locale,
): Promise<RawDefect[]> {
  const result = await agent.aiQuery<RawDefect[]>(
    `Array<{
      label: string,
      reason: string,
      severity: "high" | "medium" | "low",
      bbox: [number, number, number, number]
    }>`,
    `You are auditing the "${screen}" screen of the Traveloka Android app.
The app is currently set to ${locale.expectedLanguage} (${locale.label}).
Identify every visible UI defect, including but not limited to:
  - Text that is truncated by ellipsis when there is room to show it.
  - Text that overflows or overlaps another element.
  - Buttons or labels that are clipped, misaligned, or have inconsistent padding.
  - Missing or broken icons / images (gray placeholder, broken-image glyph).
  - Empty fields that should have placeholder text but show nothing.
  - Visible variable placeholders such as "{{name}}", "%s", "null", "undefined".
  - Overlapping touch targets.
For each defect, return a pixel-coordinate bbox [x, y, width, height] of the offending region.
If there are no defects, return [].`,
  );
  return Array.isArray(result) ? result : [];
}

async function i18nAudit(
  agent: AndroidAgent,
  screen: string,
  locale: Locale,
): Promise<RawDefect[]> {
  const result = await agent.aiQuery<RawDefect[]>(
    `Array<{
      label: string,
      reason: string,
      severity: "high" | "medium" | "low",
      bbox: [number, number, number, number]
    }>`,
    `You are auditing translations on the "${screen}" screen of the Traveloka Android app.
The app is currently set to ${locale.expectedLanguage} (${locale.label}).
The expected script family is: ${locale.expectedScripts.join(', ')}.
Flag every piece of visible text whose language does NOT match ${locale.expectedLanguage}.
Specifically include:
  - Strings still in English when the app should be in ${locale.expectedLanguage}.
  - Strings mixing two languages in the same sentence.
  - Untranslated keys such as "common.search.flight" or "{key}".
  - Currency / date / number formats that don't match the locale.
Exclude:
  - Brand/product names ("Traveloka", "HSBC", "Maybank", airline names, airport codes like "SIN").
  - Numbers and prices on their own.
  - Status icons and the Android system status bar (top 80 pixels).
For each issue, return a pixel-coordinate bbox [x, y, width, height].
If there are no issues, return [].`,
  );
  return Array.isArray(result) ? result : [];
}

async function ensureLanguage(agent: AndroidAgent, locale: Locale) {
  console.log(`\n=== switching app language to ${locale.label} ===`);
  // Open the My Account tab from the bottom navigation.
  await agent.aiAction(
    'Tap the "My Account" tab in the bottom navigation bar (rightmost tab with a person/avatar icon).',
  );
  await sleep(2500);

  // Navigate into the language settings. Traveloka usually exposes a
  // "Country & Language" or "Language" entry under account settings.
  await agent.aiAction(
    'Scroll if needed and tap the row that lets the user change app language. ' +
    'It is typically labeled "Country & Language", "Language", "Bahasa", or shows ' +
    'a globe icon. If a settings sub-screen is required, navigate there first.',
  );
  await sleep(2500);

  await agent.aiAction(
    `Select "${locale.label}" from the language list. ` +
    'Then tap any "Save", "Apply", "Confirm" or back button required to commit the choice.',
  );
  await sleep(4000);

  // Return to Home tab.
  await agent.aiAction('Tap the "Home" tab in the bottom navigation bar (leftmost tab).');
  await sleep(2500);
}

async function openFlightSearch(agent: AndroidAgent) {
  await agent.aiAction(
    'On the Traveloka home screen, tap the "Flights" / "Pesawat" / "机票" product tile ' +
    '(the one with an airplane icon). Wait for the flight search form to appear.',
  );
  await sleep(4000);
}

async function submitSearch(agent: AndroidAgent) {
  // Use whatever values are pre-filled. Just press the primary search button.
  await agent.aiAction(
    'Tap the primary "Search Flights" / "Cari Penerbangan" / "搜索航班" button at the bottom ' +
    'of the flight search form to run a search with the currently filled values.',
  );
  // Results pages can be slow to load.
  await sleep(10000);
}

async function captureAndAudit(
  agent: AndroidAgent,
  locale: Locale,
  screenName: 'flight-search' | 'flight-results',
) {
  const dir = path.join(OUT_ROOT, locale.id);
  fs.mkdirSync(dir, { recursive: true });
  const rawPath = path.join(dir, `${screenName}.png`);
  adbScreencap(rawPath);

  const ui = await uiAudit(agent, screenName, locale);
  const i18n = await i18nAudit(agent, screenName, locale);

  const annotations: Annotation[] = [
    ...toAnnotations(ui, '#ff8800'),       // orange = UI defects
    ...toAnnotations(i18n, '#ff2d2d'),     // red    = i18n defects
  ];

  const annotated = path.join(dir, `${screenName}.annotated.png`);
  const rawBuf = fs.readFileSync(rawPath);
  const outBuf = await annotateScreenshot(rawBuf, annotations);
  fs.writeFileSync(annotated, outBuf);

  fs.writeFileSync(
    path.join(dir, `${screenName}.json`),
    JSON.stringify({ locale, screen: screenName, ui, i18n }, null, 2),
  );

  console.log(
    `[${locale.id}/${screenName}] ui=${ui.length} i18n=${i18n.length} ` +
    `→ ${path.relative(process.cwd(), annotated)}`,
  );
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const summary: Record<string, unknown>[] = [];

  const agent = await agentFromAdbDevice(undefined, { autoDismissKeyboard: true });
  await agent.launch(PACKAGE);
  await sleep(6000);

  // Make sure we start from the home screen each run.
  await agent.aiAction(
    'If a popup, banner, permission dialog or onboarding overlay is blocking the ' +
    'Traveloka home screen, dismiss it (Continue / Allow / Got it / X). ' +
    'If nothing is blocking, do nothing.',
  );
  await sleep(2000);

  for (const locale of LOCALES) {
    try {
      await ensureLanguage(agent, locale);
    } catch (err) {
      console.error(`[${locale.id}] language switch failed:`, (err as Error).message);
    }

    await openFlightSearch(agent);
    await captureAndAudit(agent, locale, 'flight-search');

    try {
      await submitSearch(agent);
      await captureAndAudit(agent, locale, 'flight-results');
    } catch (err) {
      console.error(`[${locale.id}] results capture failed:`, (err as Error).message);
    }

    // Back to home for next locale iteration.
    await agent.aiAction(
      'Tap the back arrow / system back as many times as needed until the Traveloka ' +
      'home screen with product tiles (Flights, Hotels, etc.) is visible.',
    );
    await sleep(3000);

    summary.push({ locale: locale.id, status: 'done' });
  }

  fs.writeFileSync(
    path.join(OUT_ROOT, 'index.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(`\n[done] artifacts in ${OUT_ROOT}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
