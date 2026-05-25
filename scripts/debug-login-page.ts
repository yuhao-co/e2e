import { chromium } from '@playwright/test';
import * as fs from 'fs';

async function debugLoginPage() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🌐 Navigating to login page...');
  await page.goto('https://www.traveloka.com/en-en/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  console.log('📸 Taking screenshot...');
  await page.screenshot({ path: '/tmp/login-page.png' });

  console.log('🔍 Finding all input fields...');
  const inputs = await page.locator('input').all();
  console.log(`Found ${inputs.length} input elements`);

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    const id = await input.getAttribute('id');
    const placeholder = await input.getAttribute('placeholder');
    const visible = await input.isVisible().catch(() => false);
    console.log(`  ${i}: type=${type}, name=${name}, id=${id}, placeholder=${placeholder}, visible=${visible}`);
  }

  console.log('\n🔍 Finding all buttons...');
  const buttons = await page.locator('button').all();
  console.log(`Found ${buttons.length} button elements`);

  for (let i = 0; i < Math.min(10, buttons.length); i++) {
    const btn = buttons[i];
    const text = await btn.textContent();
    const type = await btn.getAttribute('type');
    const visible = await btn.isVisible().catch(() => false);
    console.log(`  ${i}: text="${text}", type=${type}, visible=${visible}`);
  }

  console.log('\n📄 Saving page HTML to debug-login.html...');
  const html = await page.content();
  fs.writeFileSync('/tmp/debug-login.html', html);

  console.log('Done! Check /tmp/login-page.png and /tmp/debug-login.html');
  await browser.close();
}

debugLoginPage().catch(console.error);
