import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 自动生成 Playwright 认证 session
 * 可在 CI/CD 环境中运行（headless 模式）
 * 
 * 使用方式：
 *   npx ts-node scripts/generate-auth-session.ts [tester1]
 * 
 * 环境变量：
 *   TRAVELOKA_EMAIL - 登陆邮箱（默认：flpostissuance@gmail.com）
 *   TRAVELOKA_PASSWORD - 密码（默认：TvlkQAflight）
 *   SESSION_OUTPUT - 输出文件路径（默认：auth-pool/tester1.json）
 */

const EMAIL = process.env.TRAVELOKA_EMAIL || 'flpostissuance@gmail.com';
const PASSWORD = process.env.TRAVELOKA_PASSWORD || 'TvlkQAflight';
const ACCOUNT_NAME = process.argv[2] || 'tester1';
const OUTPUT_FILE = process.env.SESSION_OUTPUT || `auth-pool/${ACCOUNT_NAME}.json`;

async function generateAuthSession() {
  console.log(`🔐 Generating auth session for ${ACCOUNT_NAME}...`);
  console.log(`📧 Email: ${EMAIL}`);
  console.log(`💾 Output: ${OUTPUT_FILE}`);
  
  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true, // Headless mode for CI/CD
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('\n📱 Loading Traveloka login page...');
    await page.goto('https://www.traveloka.com/en-en/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find and fill email field
    console.log('📧 Filling email field...');
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    
    if (!(await emailInput.isVisible({ timeout: 10000 }).catch(() => false))) {
      throw new Error('Email input field not found or not visible');
    }

    await emailInput.click();
    await emailInput.fill(EMAIL);
    await page.waitForTimeout(500);

    // Find and fill password field
    console.log('🔒 Filling password field...');
    const passwordInput = page.locator('input[type="password"]').first();
    
    if (!(await passwordInput.isVisible({ timeout: 10000 }).catch(() => false))) {
      throw new Error('Password input field not found or not visible');
    }

    await passwordInput.click();
    await passwordInput.fill(PASSWORD);
    await page.waitForTimeout(500);

    // Find and click submit button
    console.log('🚀 Submitting login form...');
    const submitBtn = page.locator('button[type="submit"]').first();
    
    if (!(await submitBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
      throw new Error('Submit button not found or not visible');
    }

    await submitBtn.click();

    // Wait for navigation to complete
    console.log('⏳ Waiting for login to complete...');
    try {
      await Promise.race([
        page.waitForNavigation({ timeout: 30000 }).catch(() => {}),
        page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
      ]);
    } catch (e) {
      console.warn('⚠️  Navigation timeout, but continuing to save session...');
    }

    await page.waitForTimeout(3000);

    // Save session
    console.log('💾 Saving session data...');
    const cookies = await context.cookies();
    const storageState = await context.storageState();

    const sessionData = {
      cookies,
      origins: storageState.origins || [],
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sessionData, null, 2));
    
    console.log('\n✅ Session generated successfully!');
    console.log(`   - File: ${OUTPUT_FILE}`);
    console.log(`   - Cookies: ${cookies.length}`);
    console.log(`   - Storage origins: ${storageState.origins?.length || 0}`);

    await context.close();
  } catch (error) {
    console.error('\n❌ Failed to generate session:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

generateAuthSession().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
