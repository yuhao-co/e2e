import { test as base } from '@playwright/test';
import {
  PlaywrightAiFixture,
  type PlayWrightAiFixtureType,
} from '@midscene/web/playwright';
import { stealthInitScript } from '../playwright.config';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_DATA_PATH = path.join(__dirname, '../session-data.json');
const AUTH_POOL_DIR = path.join(__dirname, '../auth-pool');

// Load or pick session data from auth-pool
let sessionData: any = null;

function loadSessionFromPool(): any {
  // Check if auth-pool exists
  if (!fs.existsSync(AUTH_POOL_DIR)) {
    return null;
  }

  // Get all .json files from auth-pool
  const files = fs.readdirSync(AUTH_POOL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(AUTH_POOL_DIR, f));

  if (files.length === 0) {
    return null;
  }

  // Pick a random file from the pool
  const randomFile = files[Math.floor(Math.random() * files.length)];
  
  try {
    const data = JSON.parse(fs.readFileSync(randomFile, 'utf-8'));
    console.log(`✅ Loaded session from auth pool: ${path.basename(randomFile)}`);
    return data;
  } catch (err) {
    console.warn(`Failed to load session from ${randomFile}:`, err);
    return null;
  }
}

// Try to load session: first from auth-pool, then from legacy session-data.json
try {
  // Try auth-pool first (for teams)
  sessionData = loadSessionFromPool();
  
  // Fallback to session-data.json (for local development)
  if (!sessionData && fs.existsSync(SESSION_DATA_PATH)) {
    sessionData = JSON.parse(fs.readFileSync(SESSION_DATA_PATH, 'utf-8'));
    console.log('✅ Loaded session data from session-data.json');
  }
} catch (err) {
  console.warn('⚠️  Failed to load session data:', err);
}

// Helper function to inject localStorage data
function createLocalStorageInitScript(storageData: any): string {
  if (!storageData || !storageData.localStorage) {
    return '';
  }
  
  const items = storageData.localStorage.map((item: any) => ({
    name: item.name,
    value: item.value,
  }));
  
  return `
    (function() {
      try {
        const items = ${JSON.stringify(items)};
        items.forEach(function(item) {
          try {
            localStorage.setItem(item.name, item.value);
          } catch (e) {
            console.warn('Failed to set localStorage item:', item.name, e);
          }
        });
        console.log('✅ Injected ' + items.length + ' localStorage items via init script');
      } catch (e) {
        console.warn('Failed to inject localStorage:', e);
      }
    })();
  `;
}

// Compose Midscene's AI fixture with a small stealth fixture that injects an
// init script into every new BrowserContext. This is enough to bypass naive
// `navigator.webdriver`-based bot detection.
const stealthFixture = {
  context: async (
    { context }: { context: import('@playwright/test').BrowserContext },
    use: (ctx: import('@playwright/test').BrowserContext) => Promise<void>,
  ) => {
    // Inject both stealth and localStorage scripts
    let combinedScript = stealthInitScript;
    
    if (sessionData && sessionData.origins && sessionData.origins.length > 0) {
      const storageData = sessionData.origins[0];
      const localStorageScript = createLocalStorageInitScript(storageData);
      combinedScript += '\n' + localStorageScript;
    }
    
    await context.addInitScript({ content: combinedScript });
    
    // Add session cookies if available
    if (sessionData && sessionData.cookies && sessionData.cookies.length > 0) {
      try {
        await context.addCookies(sessionData.cookies);
        console.log(`✅ Loaded ${sessionData.cookies.length} session cookies`);
      } catch (err) {
        console.warn('Failed to add cookies:', err);
      }
    } else {
      console.log('ℹ️  No session cookies available. Tests requiring auth may fail.');
      console.log('   To fix: export session data via: npx playwright codegen --save-storage=session-data.json https://www.traveloka.com/en-en/flight');
    }
    
    await use(context);
  },
};

export const test = base
  .extend(stealthFixture)
  .extend<PlayWrightAiFixtureType>(
    PlaywrightAiFixture({
      // Local 7B-4bit MLX model is slow; allow more time for the page/network
      // to settle before the next screenshot is fed to the model.
      waitForNetworkIdleTimeout: 5_000,
      waitForNavigationTimeout: 30_000,
    }),
  );

export { devices, expect } from '@playwright/test';
