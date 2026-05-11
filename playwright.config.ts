import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

// Light-touch stealth: many anti-bot pages key off `navigator.webdriver` and
// the lack of Chrome runtime hints. We patch those before any page script runs.
const stealthInitScript = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  // Provide a plausible plugin / language list.
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
  // window.chrome runtime stub.
  window.chrome = window.chrome || { runtime: {} };
  // Permissions API: 'notifications' should be 'default' for a real browser.
  const origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) =>
      params && params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  }
`;

export default defineConfig({
  testDir: './tests',
  // Local Qwen2.5-VL-7B-4bit inference is slow per call; keep generous budgets.
  timeout: 15 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['@midscene/web/playwright-reporter', { type: 'merged' }],
  ],
  use: {
    baseURL: 'https://www.traveloka.com',
    // Run real (system) Chrome instead of bundled Chromium — much friendlier
    // to anti-bot heuristics like Traveloka's "solve the puzzle" gate.
    channel: 'chrome',
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Singapore',
    actionTimeout: 60 * 1000,
    navigationTimeout: 90 * 1000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    contextOptions: {
      // Ship a stealth init script with every new context.
      // Note: addInitScript at config level isn't directly supported; we use
      // a fixture wrapper instead (see tests/fixture.ts).
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Exposed for the fixture to pick up.
  metadata: { stealthInitScript },
});

export { stealthInitScript };
