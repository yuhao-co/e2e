/**
 * Traveloka Android home-page i18n quick audit (deterministic).
 *
 * For each target locale we:
 *   1. adb tap "Akun" tab → settings gear.
 *   2. Tap "Mata Uang" / currency row, scroll list, tap target currency by ISO code.
 *   3. (Auto-returns to settings.) Tap language row, scroll list, tap target label.
 *   4. Press back twice to return to Home, screenshot.
 *   5. Send screenshot to local Qwen2.5-VL via /v1/chat/completions, asking it
 *      to list every visible string NOT in the expected language.
 *
 * Output: audit-output/home-i18n/<id>.{png,json} + summary.json.
 *
 * Run:
 *   npx tsx tests/traveloka-home-i18n.ts
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import OpenAI from 'openai';

const PACKAGE = 'com.traveloka.android';
const OUT = path.resolve(__dirname, '..', 'audit-output', 'home-i18n');

type Locale = {
  id: string;
  /** ISO 4217 code we look for in the currency list. */
  currencyCode: string;
  /** Native label as shown in the language list. */
  languageLabel: string;
  /** Language name we feed to the VLM. */
  expected: string;
  /** Script families expected to dominate the page text. */
  scripts: string[];
};

const LOCALES: Locale[] = [
  // English first to baseline.
  { id: 'en', currencyCode: 'SGD', languageLabel: 'English',   expected: 'English',            scripts: ['Latin'] },
  { id: 'id', currencyCode: 'IDR', languageLabel: 'Indonesia', expected: 'Indonesian',         scripts: ['Latin'] },
  { id: 'zh', currencyCode: 'CNY', languageLabel: '中文',       expected: 'Simplified Chinese', scripts: ['Han (Chinese)'] },
  { id: 'ko', currencyCode: 'KRW', languageLabel: '한국어',     expected: 'Korean',             scripts: ['Hangul'] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function adb(...args: string[]): string {
  // Some adb subcommands (monkey) write progress to stderr; we don't care.
  return execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function screencap(dest: string) {
  adb('shell', 'screencap', '-p', '/sdcard/_now.png');
  adb('pull', '/sdcard/_now.png', dest);
}

function tap(x: number, y: number) {
  adb('shell', 'input', 'tap', String(x), String(y));
}

function back() {
  adb('shell', 'input', 'keyevent', '4');
}

function dumpUi(): string {
  // exec-out streams the XML directly without writing to /sdcard.
  return execFileSync('adb', ['exec-out', 'uiautomator', 'dump', '/dev/tty'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

type UiNode = {
  text: string;
  bounds: { x: number; y: number; w: number; h: number };
  scrollable: boolean;
};

function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  // Greedy attribute scan. uiautomator output is well-formed enough for regex.
  const re = /<node[^>]*\btext="([^"]*)"[^>]*\bscrollable="(true|false)"[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const [, text, scrollable, x1, y1, x2, y2] = m;
    nodes.push({
      text: text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
      scrollable: scrollable === 'true',
      bounds: { x: +x1, y: +y1, w: +x2 - +x1, h: +y2 - +y1 },
    });
  }
  return nodes;
}

function findNodeByText(nodes: UiNode[], text: string): UiNode | undefined {
  return nodes.find((n) => n.text === text);
}

/**
 * The Android system can pop a "Download language?" dialog when the app
 * requests a locale that is not yet on device. If we see it, tap "Download"
 * (the app bundles the strings, but the system asks for confirmation).
 */
async function dismissDownloadDialog() {
  const xml = dumpUi();
  const nodes = parseUiNodes(xml);
  if (!nodes.some((n) => /Download language\??/i.test(n.text))) return;
  console.log('  [warn] Android "Download language?" dialog detected; tapping Download');
  const dl = nodes.find((n) => n.text === 'Download' || n.text === 'DOWNLOAD' || n.text === 'Install');
  if (dl) {
    tap(dl.bounds.x + dl.bounds.w / 2, dl.bounds.y + dl.bounds.h / 2);
    await sleep(3000);
  }
}

/** Scroll the list until a node with exact `text` is on screen, then return it. */
async function scrollUntilVisible(text: string, maxSteps = 40): Promise<UiNode> {
  let lastDigest = '';
  let stableCount = 0;
  for (let i = 0; i < maxSteps; i++) {
    const xml = dumpUi();
    const nodes = parseUiNodes(xml);
    const hit = findNodeByText(nodes, text);
    if (hit && hit.bounds.h > 0 && hit.bounds.y > 250 && hit.bounds.y < 2150) {
      return hit;
    }
    // Look at items in the scrolling region only (y between 350 and 2100).
    const inList = nodes
      .filter((n) => n.text && n.bounds.y > 350 && n.bounds.y < 2100)
      .map((n) => n.text);
    const digest = inList.join('|');
    if (digest === lastDigest) {
      stableCount++;
      if (stableCount >= 2) {
        throw new Error(`list reached the bottom without finding "${text}" (last items: ${inList.slice(-5).join(', ')})`);
      }
    } else {
      stableCount = 0;
    }
    lastDigest = digest;
    // Swipe up (scroll the list upward) within the list area only.
    adb('shell', 'input', 'swipe', '540', '1700', '540', '600', '450');
    await sleep(900);
  }
  throw new Error(`could not find row with text "${text}" after ${maxSteps} swipes`);
}

async function ensureHome() {
  // Force-stop and relaunch so each iteration starts from a known state.
  try { adb('shell', 'am', 'force-stop', PACKAGE); } catch {}
  await sleep(800);
  // Use the resolved launcher activity so we land on the splash → home,
  // not on the launcher search screen.
  try {
    adb(
      'shell', 'am', 'start',
      '-a', 'android.intent.action.MAIN',
      '-c', 'android.intent.category.LAUNCHER',
      '-n', `${PACKAGE}/.appentry.splash.AlternativeIconAlias`,
    );
  } catch (err) {
    console.error('[ensureHome] start failed:', (err as Error).message);
  }
  // Wait for splash + home to render.
  await sleep(8000);
  // Tap Home tab to be safe.
  tap(108, 2270);
  await sleep(2500);
}

async function openSettings() {
  // Bottom nav rightmost tab (Akun / Points label varies but position is constant).
  tap(970, 2270);
  await sleep(2500);
  // Top-right gear icon.
  tap(997, 200);
  await sleep(2500);
}

async function pickFromList(targetText: string, listEntryRowYHint = 1310) {
  // Caller has already tapped the row that opens this list. We just scroll
  // and tap the matching entry.
  const node = await scrollUntilVisible(targetText);
  const cx = node.bounds.x + Math.floor(node.bounds.w / 2);
  const cy = node.bounds.y + Math.floor(node.bounds.h / 2);
  tap(cx, cy);
  await sleep(2500);
}

async function switchLocale(locale: Locale) {
  console.log(`\n=== switching to ${locale.id} (${locale.expected}) ===`);
  await ensureHome();
  await openSettings();

  // Find currency row by its label "Mata Uang" (id), or scroll if needed.
  // Settings page items have stable labels; use uiautomator to find currency row.
  const settingsXml = dumpUi();
  const settingsNodes = parseUiNodes(settingsXml);
  const currencyRow = settingsNodes.find((n) =>
    /^(Mata Uang|Currency|Tiền tệ|สกุลเงิน|货币|통화|通貨)$/.test(n.text),
  );
  if (currencyRow) {
    tap(540, currencyRow.bounds.y + currencyRow.bounds.h / 2);
  } else {
    tap(540, 1310);
  }
  await sleep(2000);
  await pickFromList(locale.currencyCode);

  // Re-find language row in current language.
  const settingsXml2 = dumpUi();
  const settingsNodes2 = parseUiNodes(settingsXml2);
  const langRow = settingsNodes2.find((n) =>
    /^(Bahasa|Language|Ngôn ngữ|ภาษา|语言|언어|言語)$/.test(n.text),
  );
  if (langRow) {
    tap(540, langRow.bounds.y + langRow.bounds.h / 2);
  } else {
    tap(540, 1450);
  }
  await sleep(2000);
  await pickFromList(locale.languageLabel);

  // Handle Android system "Download language?" prompt if it appears.
  await dismissDownloadDialog();

  // After language switch the app typically reloads to home automatically.
  await sleep(5000);
}

async function captureHome(locale: Locale): Promise<string> {
  const png = path.join(OUT, `${locale.id}.png`);
  screencap(png);
  return png;
}

type Untranslated = {
  text: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
};

async function audit(locale: Locale, pngPath: string, client: OpenAI, model: string): Promise<Untranslated[]> {
  // Resize: device is 1080x2400 → drop to width 720 to keep token count sane.
  const resized = await sharp(pngPath)
    .resize({ width: 720 })
    .jpeg({ quality: 85 })
    .toBuffer();
  const dataUrl = `data:image/jpeg;base64,${resized.toString('base64')}`;

  const prompt = `This is a screenshot of the Traveloka Android home screen.
The app should be displayed in ${locale.expected} (expected script: ${locale.scripts.join(', ')}).

Task: list every visible string that is NOT in ${locale.expected}.

For each issue return an object: { "text": <the visible string verbatim>, "reason": <why it's wrong>, "severity": "high"|"medium"|"low" }.

IGNORE:
- Brand / proper names: Traveloka, TPayLater, HSBC, Maybank, Visa, Mastercard, Garuda, airline names, hotel names, city names, airport codes (SIN, CGK), country names.
- Pure numbers, prices, percentages, dates.
- The Android system status bar at the very top.
- Bottom-nav graphical icons.

Reply with ONLY a JSON array. No prose, no markdown fence. If everything is correctly in ${locale.expected}, reply [].`;

  const resp = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    },
    { timeout: 600_000 },
  );

  const raw = resp.choices[0]?.message?.content?.trim() ?? '';
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error(`[${locale.id}] non-JSON response:`, raw.slice(0, 300));
    return [];
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const client = new OpenAI({
    apiKey: process.env.MIDSCENE_MODEL_API_KEY ?? 'mlx-local',
    baseURL: process.env.MIDSCENE_MODEL_BASE_URL ?? 'http://127.0.0.1:8080/v1',
  });
  const model = process.env.MIDSCENE_MODEL_NAME ?? 'mlx-community/Qwen2.5-VL-7B-Instruct-4bit';

  // Make sure the app is in foreground at home.
  try {
    adb('shell', 'am', 'start', '-n', `${PACKAGE}/.appentry.splash.SplashActivity`);
  } catch {
    // Activity may not match exact name; fall back to monkey but ignore stderr noise.
    try { adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1'); } catch {}
  }
  await sleep(4000);
  tap(108, 2270);
  await sleep(2000);

  const summary: Record<string, { count: number; items: Untranslated[]; png: string }> = {};

  for (const locale of LOCALES) {
    try {
      await switchLocale(locale);
    } catch (err) {
      console.error(`[${locale.id}] locale switch failed:`, (err as Error).message);
      // Try to recover by going back to home.
      back(); back(); back();
      tap(108, 2270);
      await sleep(2500);
    }

    let png = '';
    try {
      png = await captureHome(locale);
    } catch (err) {
      console.error(`[${locale.id}] screencap failed:`, (err as Error).message);
      summary[locale.id] = { count: -1, items: [], png: '' };
      continue;
    }

    let items: Untranslated[] = [];
    try {
      items = await audit(locale, png, client, model);
    } catch (err) {
      console.error(`[${locale.id}] audit failed:`, (err as Error).message);
    }

    fs.writeFileSync(
      path.join(OUT, `${locale.id}.json`),
      JSON.stringify({ locale, untranslated: items }, null, 2),
    );
    summary[locale.id] = { count: items.length, items, png };
    console.log(`[${locale.id}] ${items.length} untranslated string(s)`);
    for (const it of items) console.log(`    (${it.severity}) "${it.text}" — ${it.reason}`);
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
