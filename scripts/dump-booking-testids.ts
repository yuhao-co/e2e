/**
 * Quick script: navigate to booking page and dump all data-testid attributes.
 * Run: npx tsx scripts/dump-booking-testids.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const AUTH_POOL_DIR = path.join(__dirname, '../auth-pool');
const BASE_URL = 'https://www.traveloka.com';

function departDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
}

const SEARCH_URL = `${BASE_URL}/en-sg/flight/fullsearch?ap=SIN.JKTA&dt=${departDate()}&ps=1.0.0&sc=ECONOMY`;

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });

  // Load session cookies from auth-pool
  const files = fs.readdirSync(AUTH_POOL_DIR).filter(f => f.endsWith('.json'));
  if (files.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(AUTH_POOL_DIR, files[0]), 'utf-8'));
    if (data.cookies) {
      await context.addCookies(data.cookies);
      console.log(`Loaded ${data.cookies.length} cookies from ${files[0]}`);
    }
  }

  const page = await context.newPage();

  console.log('Navigating to search page...');
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click first flight card
  const flightCard = page.locator('[data-testid="flight-inventory-card-button"]').first();
  await flightCard.waitFor({ state: 'visible', timeout: 20000 });
  console.log('Clicking first flight card...');
  await flightCard.click();
  await page.waitForTimeout(2000);

  // Click select button in drawer
  const selectBtn = page.locator('[data-testid="button_ticket_option_select_1"]').first();
  if (await selectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await selectBtn.click();
    console.log('Clicked ticket select button');
  }

  // Wait for booking page
  await page.waitForURL(/\/flight\/booking/, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  console.log(`Current URL: ${page.url()}`);

  // Dump all data-testid attributes
  const testIds = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid]');
    const result: Array<{ testid: string; tag: string; text: string; visible: boolean }> = [];
    elements.forEach(el => {
      const testid = el.getAttribute('data-testid') || '';
      const tag = el.tagName.toLowerCase();
      const text = (el as HTMLElement).innerText?.slice(0, 80).replace(/\n/g, ' ').trim() || '';
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      result.push({ testid, tag, text, visible });
    });
    return result;
  });

  // Also dump data-id attributes
  const dataIds = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-id]');
    const result: Array<{ dataid: string; tag: string; text: string }> = [];
    elements.forEach(el => {
      const dataid = el.getAttribute('data-id') || '';
      const tag = el.tagName.toLowerCase();
      const text = (el as HTMLElement).innerText?.slice(0, 80).replace(/\n/g, ' ').trim() || '';
      result.push({ dataid, tag, text });
    });
    return result;
  });

  console.log('\n=== data-testid attributes on booking page ===');
  testIds.forEach(({ testid, tag, text, visible }) => {
    console.log(`[${visible ? 'VISIBLE' : 'hidden'}] <${tag}> [${testid}] "${text}"`);
  });

  console.log('\n=== data-id attributes on booking page ===');
  dataIds.forEach(({ dataid, tag, text }) => {
    console.log(`<${tag}> [${dataid}] "${text}"`);
  });

  // Dump all inputs/selects inside contact and traveler sections
  const formFields = await page.evaluate(() => {
    const sections = [
      { name: 'BOOKING_CONTACT', selector: '[data-testid="dynamic-component-BOOKING_CONTACT"]' },
      { name: 'BOOKING_TRAVELER', selector: '[data-testid="dynamic-component-BOOKING_TRAVELER"]' },
    ];
    const result: Record<string, any[]> = {};
    for (const { name, selector } of sections) {
      const root = document.querySelector(selector);
      if (!root) { result[name] = []; continue; }
      const fields: any[] = [];
      root.querySelectorAll('input, select, textarea').forEach((el) => {
        const e = el as HTMLInputElement | HTMLSelectElement;
        fields.push({
          tag: e.tagName.toLowerCase(),
          type: (e as HTMLInputElement).type ?? '',
          name: e.name,
          placeholder: (e as HTMLInputElement).placeholder ?? '',
          testid: e.getAttribute('data-testid') ?? '',
          value: e.value,
          ariaLabel: e.getAttribute('aria-label') ?? '',
          id: e.id,
          options: e.tagName === 'SELECT'
            ? Array.from((e as HTMLSelectElement).options).slice(0, 6).map(o => o.value + ':' + o.text)
            : undefined,
        });
      });
      result[name] = fields;
    }
    return result;
  });

  console.log('\n=== Input fields inside BOOKING_CONTACT ===');
  (formFields['BOOKING_CONTACT'] ?? []).forEach((f: any) => console.log(JSON.stringify(f)));
  console.log('\n=== Input fields inside BOOKING_TRAVELER ===');
  (formFields['BOOKING_TRAVELER'] ?? []).forEach((f: any) => console.log(JSON.stringify(f)));

  // Save to file
  const output = { url: page.url(), testIds, dataIds, formFields };
  const outPath = path.join(__dirname, '../booking-testids-dump.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to ${outPath}`);

  await page.waitForTimeout(5000); // pause to view
  await browser.close();
}

main().catch(console.error);
