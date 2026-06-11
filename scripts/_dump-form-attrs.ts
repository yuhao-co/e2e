import { chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const authFiles = fs.readdirSync('./auth-pool').filter(f => f.endsWith('.json'));
const storageState = path.resolve('./auth-pool', authFiles[0]);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ storageState });
  const page = await ctx.newPage();

  const today = new Date();
  today.setDate(today.getDate() + 14);
  const dt = `${today.getDate()}-${today.getMonth()+1}-${today.getFullYear()}`;
  await page.goto(`https://www.traveloka.com/en-sg/flight/fullsearch?ap=SIN.JKTA&dt=${dt}&ps=1.0.0&sc=ECONOMY`, { waitUntil: 'domcontentloaded' });

  await page.locator('[data-testid="flight-inventory-card-button"]').first().waitFor({ timeout: 15000 });
  await page.locator('[data-testid="flight-inventory-card-button"]').first().click();
  await page.getByText(/Select ticket type/i).waitFor({ timeout: 15000 }).catch(() => {});
  await page.locator('[data-testid="button_ticket_option_select_1"]').first().click();
  await page.waitForFunction(() => location.href.includes('/flight/booking'), { timeout: 20000 });
  console.log('[dump] on booking page:', page.url());

  // Wait for actual form inputs to appear — "Full Name" label means contact form is ready
  await page.getByLabel('Full Name').waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => page.getByText('Full Name').waitFor({ timeout: 10000 }).catch(() => {}));
  console.log('[dump] form visible, dumping inputs...');

  const result = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    return inputs.map(el => ({
      tag: el.tagName,
      id: el.id || null,
      name: (el as HTMLInputElement).name || null,
      type: (el as HTMLInputElement).type || null,
      placeholder: (el as HTMLInputElement).placeholder || null,
      testid: el.getAttribute('data-testid'),
      ariaLabel: el.getAttribute('aria-label'),
      parentTestid: el.closest('[data-testid]')?.getAttribute('data-testid') || null,
      visible: (el as HTMLElement).offsetParent !== null,
    }));
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
