import { test as base } from '@playwright/test';
import {
  PlaywrightAiFixture,
  type PlayWrightAiFixtureType,
} from '@midscene/web/playwright';
import { stealthInitScript } from '../playwright.config';
import * as fs from 'fs';
import * as path from 'path';

// Load session data (cookies and localStorage)
let sessionData: any = null;
try {
  const sessionDataPath = path.join(__dirname, '../session-data.json');
  if (fs.existsSync(sessionDataPath)) {
    sessionData = JSON.parse(fs.readFileSync(sessionDataPath, 'utf-8'));
  }
} catch (err) {
  console.warn('Failed to load session data:', err);
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
    if (sessionData && sessionData.cookies) {
      try {
        await context.addCookies(sessionData.cookies);
        console.log(`✅ Loaded ${sessionData.cookies.length} session cookies`);
      } catch (err) {
        console.warn('Failed to add cookies:', err);
      }
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
