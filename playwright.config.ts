import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

// Comprehensive stealth init script covering all major DataDome / bot-detection
// fingerprint vectors (mirrors puppeteer-extra-plugin-stealth evasions).
const stealthInitScript = `
(function () {
  // ── navigator.webdriver ──────────────────────────────────────────────────
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // ── Remove CDP / DevTools window variables injected by Chromium ──────────
  // Chrome DevTools client leaves window.cdc_* variables.
  const cdcRe = /^cdc_/;
  for (const key of Object.getOwnPropertyNames(window)) {
    if (cdcRe.test(key)) {
      try { delete window[key]; } catch (_) {}
    }
  }

  // ── navigator.vendor ─────────────────────────────────────────────────────
  Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });

  // ── navigator.languages ──────────────────────────────────────────────────
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

  // ── navigator.hardwareConcurrency ────────────────────────────────────────
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

  // ── navigator.plugins ────────────────────────────────────────────────────
  // Provide realistic-looking plugin list to avoid plugin.length === 0 check.
  const makePlugin = (name, desc, filename, mimeTypes) => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperties(plugin, {
      name: { value: name }, description: { value: desc },
      filename: { value: filename }, length: { value: mimeTypes.length },
    });
    mimeTypes.forEach((mt, i) => {
      const m = Object.create(MimeType.prototype);
      Object.defineProperties(m, {
        type: { value: mt.type }, suffixes: { value: mt.suffixes },
        description: { value: mt.desc }, enabledPlugin: { value: plugin },
      });
      plugin[i] = m; plugin[mt.type] = m;
    });
    return plugin;
  };
  const fakePlugins = [
    makePlugin('Chrome PDF Plugin', 'Portable Document Format',
      'internal-pdf-viewer',
      [{ type: 'application/x-google-chrome-pdf', suffixes: 'pdf', desc: 'Portable Document Format' }]),
    makePlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
      [{ type: 'application/pdf', suffixes: 'pdf', desc: '' }]),
    makePlugin('Native Client', '', 'internal-nacl-plugin',
      [{ type: 'application/x-nacl', suffixes: '', desc: 'Native Client Executable' },
       { type: 'application/x-pnacl', suffixes: '', desc: 'Portable Native Client Executable' }]),
  ];
  const pluginArray = Object.create(PluginArray.prototype);
  Object.defineProperty(pluginArray, 'length', { value: fakePlugins.length });
  fakePlugins.forEach((p, i) => { pluginArray[i] = p; pluginArray[p.name] = p; });
  Object.defineProperty(navigator, 'plugins', { get: () => pluginArray });
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const arr = Object.create(MimeTypeArray.prototype);
      const all = fakePlugins.flatMap((_, i) => Array.from({ length: fakePlugins[i].length }, (__, j) => fakePlugins[i][j]));
      Object.defineProperty(arr, 'length', { value: all.length });
      all.forEach((m, i) => { arr[i] = m; arr[m.type] = m; });
      return arr;
    }
  });

  // ── window.chrome ─────────────────────────────────────────────────────────
  if (!window.chrome) window.chrome = {};
  window.chrome.app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: () => null,
    getIsInstalled: () => false,
    runningState: () => 'cannot_run',
  };
  window.chrome.csi = () => ({
    startE: Date.now(), onloadT: Date.now(), pageT: 3147.6200000002861, tran: 15,
  });
  window.chrome.loadTimes = () => ({
    commitLoadTime: Date.now() / 1000 - 0.5,
    connectionInfo: 'h2', finishDocumentLoadTime: Date.now() / 1000 - 0.1,
    finishLoadTime: Date.now() / 1000, firstPaintAfterLoadTime: 0,
    firstPaintTime: Date.now() / 1000 - 0.3, navigationType: 'Other',
    npnNegotiatedProtocol: 'h2', requestTime: Date.now() / 1000 - 0.6,
    startLoadTime: Date.now() / 1000 - 0.55, wasAlternateProtocolAvailable: false,
    wasFetchedViaSpdy: true, wasNpnNegotiated: true,
  });
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    };
  }

  // ── Permissions API ────────────────────────────────────────────────────────
  const origPermQuery = window.navigator.permissions && window.navigator.permissions.query.bind(window.navigator.permissions);
  if (origPermQuery) {
    window.navigator.permissions.query = (params) => {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return origPermQuery(params);
    };
  }

  // ── WebGL vendor / renderer strings ───────────────────────────────────────
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParam.call(this, param);
  };
  if (window.WebGL2RenderingContext) {
    const getParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParam2.call(this, param);
    };
  }

  // ── window outer dimensions ───────────────────────────────────────────────
  if (window.outerWidth === 0) {
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
  }
  if (window.outerHeight === 0) {
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 85 });
  }

  // ── iframe contentWindow.navigator.webdriver ─────────────────────────────
  const origAttachShadow = Element.prototype.attachShadow;
  HTMLIFrameElement.prototype.__defineGetter__ && HTMLIFrameElement.prototype.__defineGetter__('contentWindow', function () {
    const win = this.contentWindow;
    if (win) {
      try { Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined }); } catch (_) {}
    }
    return win;
  });
})();
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
    ['html', { open: 'on-failure', outputFolder: 'playwright-report' }],
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
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-dev-shm-usage',
          ],
        },
      },
    },
  ],
  // Exposed for the fixture to pick up.
  metadata: { stealthInitScript },
});

export { stealthInitScript };
