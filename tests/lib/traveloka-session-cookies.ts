import { type BrowserContext, type Page } from '@playwright/test';

import sessionState from './traveloka-session-state.json';

type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

type SessionStorageItem = {
  name: string;
  value: string;
};

type SessionOrigin = {
  origin: string;
  localStorage: SessionStorageItem[];
  sessionStorage?: SessionStorageItem[];
};

type SessionState = {
  cookies: SessionCookie[];
  origins: SessionOrigin[];
};

const typedSessionState = sessionState as SessionState;

export const travelokaSessionCookies = typedSessionState.cookies.map((cookie) => ({
  ...cookie,
  expires: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined,
}));

export const travelokaSessionOrigins = typedSessionState.origins;

async function seedOriginStorage(page: Page, originState: SessionOrigin) {
  // Storage APIs are origin-scoped, so each origin must be opened once before
  // localStorage/sessionStorage can be restored into the browser context.
  await page.goto(originState.origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ localStorageItems, sessionStorageItems }) => {
    localStorageItems.forEach((item) => {
      localStorage.setItem(item.name, item.value);
    });

    sessionStorageItems.forEach((item) => {
      sessionStorage.setItem(item.name, item.value);
    });
  }, {
    localStorageItems: originState.localStorage,
    sessionStorageItems: originState.sessionStorage ?? [],
  });
}

export async function applyTravelokaSessionState(page: Page) {
  const context: BrowserContext = page.context();
  await context.addCookies(travelokaSessionCookies);

  for (const originState of travelokaSessionOrigins) {
    await seedOriginStorage(page, originState);
  }
}
