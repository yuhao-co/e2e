import { test as base } from '@playwright/test';
import {
  PlaywrightAiFixture,
  type PlayWrightAiFixtureType,
} from '@midscene/web/playwright';
import { stealthInitScript } from '../playwright.config';

// Compose Midscene's AI fixture with a small stealth fixture that injects an
// init script into every new BrowserContext. This is enough to bypass naive
// `navigator.webdriver`-based bot detection.
const stealthFixture = {
  context: async (
    { context }: { context: import('@playwright/test').BrowserContext },
    use: (ctx: import('@playwright/test').BrowserContext) => Promise<void>,
  ) => {
    await context.addInitScript({ content: stealthInitScript });
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
