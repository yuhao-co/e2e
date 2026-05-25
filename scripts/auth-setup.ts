/**
 * Authentication setup script
 * Logs into Traveloka and saves session data (cookies, localStorage) to session-data.json
 * 
 * Usage:
 *   npx ts-node scripts/auth-setup.ts
 */

import { chromium, firefox, webkit } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const TEST_EMAIL = 'flpostissuance@gmail.com';
const TEST_PASSWORD = 'TvlkQAflight';
const SESSION_DATA_PATH = path.join(__dirname, '../session-data.json');

async function setupAuth() {
  console.log('🔐 Starting authentication setup for Traveloka...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('📱 Navigating to Traveloka flights page...');
    await page.goto('https://www.traveloka.com/en-en/flight', { waitUntil: 'networkidle' });

    // Wait for page to load and check if login is needed
    await page.waitForLoadState('domcontentloaded');

    // Try to find login button or go directly to login page
    console.log('🔑 Looking for login button...');
    let isLoggedIn = false;
    
    try {
      const accountMenu = await page.locator('[data-testid="account-menu"], [data-id*="account"], button:has-text("Account")').first();
      if (await accountMenu.isVisible()) {
        console.log('✅ Already logged in!');
        isLoggedIn = true;
      }
    } catch (e) {
      // Not logged in, continue to login
    }

    if (!isLoggedIn) {
      // Try to find and click login button
      const loginButtons = [
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'a:has-text("Log in")',
        '[data-testid="login-button"]',
      ];

      let found = false;
      for (const selector of loginButtons) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible()) {
            console.log(`🔘 Clicking login button: ${selector}`);
            await btn.click();
            found = true;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!found) {
        // Try direct navigation to login
        console.log('📍 Navigating directly to login page...');
        await page.goto('https://www.traveloka.com/en-en/login', { waitUntil: 'networkidle' });
      }

      // Wait for login form to appear
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000); // Extra buffer for form rendering

      // Find and fill email field
      console.log('📧 Filling email field...');
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="Email" i]',
        'input[id*="email" i]',
      ];

      let emailField = null;
      for (const selector of emailSelectors) {
        try {
          const field = page.locator(selector).first();
          if (await field.isVisible()) {
            emailField = field;
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      if (!emailField) {
        throw new Error('Could not find email input field');
      }

      await emailField.fill(TEST_EMAIL);
      console.log(`✅ Email filled: ${TEST_EMAIL}`);

      // Find and fill password field
      console.log('🔒 Filling password field...');
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id*="password" i]',
      ];

      let passwordField = null;
      for (const selector of passwordSelectors) {
        try {
          const field = page.locator(selector).first();
          if (await field.isVisible()) {
            passwordField = field;
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      if (!passwordField) {
        throw new Error('Could not find password input field');
      }

      await passwordField.fill(TEST_PASSWORD);
      console.log('✅ Password filled');

      // Click login button
      console.log('🚀 Submitting login form...');
      const submitButtons = [
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button:has-text("Sign In")',
        'button[type="submit"]',
        '[data-testid="login-submit-button"]',
      ];

      let submitted = false;
      for (const selector of submitButtons) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible()) {
            await btn.click();
            submitted = true;
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      if (!submitted) {
        throw new Error('Could not find login submit button');
      }

      // Wait for navigation and verification
      console.log('⏳ Waiting for login to complete...');
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      } catch (e) {
        console.warn('⚠️  Navigation timeout, but continuing...');
      }

      // Additional wait for any AJAX requests
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      // Verify login success
      console.log('🔍 Verifying login...');
      const accountMenus = [
        '[data-testid="account-menu"]',
        '[data-id*="account"]',
        'button:has-text("My Account")',
        'button:has-text("Account")',
      ];

      isLoggedIn = false;
      for (const selector of accountMenus) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible()) {
            console.log('✅ Login verified - account menu found');
            isLoggedIn = true;
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      if (!isLoggedIn) {
        console.warn('⚠️  Could not verify login, but continuing to save session data...');
      }
    }

    // Save session data
    console.log('💾 Saving session data...');
    const cookies = await context.cookies();
    const storageState = await context.storageState();

    const sessionData = {
      cookies: cookies,
      origins: storageState.origins || [],
    };

    fs.writeFileSync(SESSION_DATA_PATH, JSON.stringify(sessionData, null, 2));
    console.log(`✅ Session data saved to: ${SESSION_DATA_PATH}`);
    console.log(`   - Cookies: ${cookies.length}`);
    console.log(`   - Storage origins: ${storageState.origins?.length || 0}`);

  } catch (error) {
    console.error('❌ Authentication failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }

  console.log('\n✅ Authentication setup complete!');
  console.log('You can now run your tests with the authenticated session.');
}

setupAuth().catch(console.error);
