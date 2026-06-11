#!/usr/bin/env tsx
/**
 * explore-coverage-gaps.ts
 *
 * Autonomous coverage expansion: scans the www codebase fpr-* packages,
 * identifies domains not yet covered by any test spec, and generates
 * minimal smoke specs for each gap (up to --limit per run).
 *
 * Design principles:
 * - Additive only: never touches existing specs or the weekly-diff workflow
 * - Gradual: generates at most --limit new specs per invocation (default 3)
 * - Deduplicated: uses AccumulationManifest intentHash to skip re-generation
 * - lifecycle: 'candidate' — specs must pass consistently before promotion
 * - Desktop-first: mobile surfaces are skipped per team priority
 *
 * Usage:
 *   tsx scripts/explore-coverage-gaps.ts
 *   tsx scripts/explore-coverage-gaps.ts --limit 5
 *   tsx scripts/explore-coverage-gaps.ts --dry-run
 *   tsx scripts/explore-coverage-gaps.ts --list-gaps
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  AccumulationManifest,
  type CaseMetadata,
} from './lib/accumulation-manifest';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIST_GAPS = args.includes('--list-gaps');
const limitIdx = args.indexOf('--limit');
const MAX_NEW_SPECS = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '3', 10) : 3;

const WWW_REPO = path.resolve(
  __dirname,
  '../.cache/weekly-diff-repos/github.com_traveloka_www',
);
const TESTS_WEB_DIR = path.resolve(__dirname, '../tests/web');
const BOOKING_FIXTURE_PATH = path.resolve(__dirname, '../data/booking-fixture.json');

// ---------------------------------------------------------------------------
// Domain map: fpr-* package name prefix → exploration target
//
// Each entry describes one testable surface:
//   - key:         fpr-* package name prefix (matched with startsWith)
//   - domain:      logical test domain used in manifest / dedup
//   - label:       human-readable name
//   - url:         target URL to navigate (SEARCH_DATE_* replaced at runtime)
//   - pageType:    passed to GenericBugDetector
//   - priority:    1 = highest, runs first
//   - skipMobile:  always skip (default); this field is reserved for future use
// ---------------------------------------------------------------------------

interface DomainEntry {
  pkgPrefixes: string[];
  domain: string;
  label: string;
  urlTemplate: string; // DEPART_DATE / RETURN_DATE replaced at runtime
  pageType: 'flight-search' | 'flight-booking';
  priority: number;
  /**
   * Sub-flow: page requires a real bookingId/routeId to show content.
   * With a dummy ID the server will redirect to login or show an error state — both are acceptable.
   * The spec only checks there is no JS crash / P0 bug / 5xx before or after redirect.
   */
  subFlow?: boolean;
  /**
   * Requires a real invoiceId from a previous successful booking run.
   * The spec reads data/booking-fixture.json written by the payment e2e spec.
   * If no fixture exists, the spec is skipped with a warning (not failed).
   * urlTemplate may contain INVOICE_ID / AUTH_TOKEN placeholders.
   */
  requiresBooking?: boolean;
}

// Dates 14 and 21 days from today, formatted as D-M-YYYY (Traveloka URL format)
function travelokaDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
}

const DOMAIN_MAP: DomainEntry[] = [
  // ── Priority 1: Core entry points ────────────────────────────────────
  {
    pkgPrefixes: ['fpr-homepage'],
    domain: 'flight-homepage',
    label: 'Flight Homepage',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight',
    pageType: 'flight-search',
    priority: 1,
  },
  {
    pkgPrefixes: ['fpr-metasearch'],
    domain: 'flight-metasearch',
    label: 'Flight Metasearch',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=DEPART_DATE.RETURN_DATE&ps=1.0.0&sc=ECONOMY',
    pageType: 'flight-search',
    priority: 1,
  },
  {
    pkgPrefixes: ['fpr-booking', 'fpr-booking-desktop'],
    domain: 'flight-booking-e2e',
    label: 'Flight Booking → Payment E2E',
    // Full search→booking→payment path — runs the dedicated e2e spec, not a simple goto.
    // The spec itself handles search + booking form + payment navigation.
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/fullsearch?ap=SIN.JKTA&dt=DEPART_DATE&ps=1.0.0&sc=ECONOMY',
    pageType: 'flight-booking',
    priority: 1,
    subFlow: true,
  },
  {
    pkgPrefixes: ['fpr-ohka'],
    domain: 'flight-discover',
    label: 'Flight Discover',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/discover',
    pageType: 'flight-search',
    priority: 1,
  },
  {
    pkgPrefixes: ['fpr-nimbus', 'fpr-search-form'],
    domain: 'flight-multicity',
    label: 'Flight Multi-city Search',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/multicitysearch',
    pageType: 'flight-search',
    priority: 1,
  },

  // ── Priority 2: Core post-search/post-booking flows ──────────────────
  {
    pkgPrefixes: ['fpr-flight-status'],
    domain: 'flight-status',
    label: 'Flight Status',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/flight-status',
    pageType: 'flight-search',
    priority: 2,
  },
  {
    pkgPrefixes: ['fpr-price-alert'],
    domain: 'flight-price-alert',
    label: 'Flight Price Alert',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/priceAlert',
    pageType: 'flight-booking',
    priority: 2,
  },
  {
    pkgPrefixes: ['fpr-price-freeze'],
    domain: 'flight-price-freeze',
    label: 'Flight Price Freeze',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/price-freeze',
    pageType: 'flight-booking',
    priority: 2,
  },
  {
    pkgPrefixes: ['fpr-cheapest-date-travel'],
    domain: 'flight-cheapest-date',
    label: 'Flight Cheapest Date',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/cheapestDate',
    pageType: 'flight-search',
    priority: 2,
  },
  {
    pkgPrefixes: ['fpr-group-booking'],
    domain: 'flight-group-booking',
    label: 'Flight Group Booking',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/group-booking',
    pageType: 'flight-booking',
    priority: 2,
  },

  // ── Priority 3: Post-booking sub-flows (auth redirect expected) ───────
  {
    pkgPrefixes: ['fpr-reschedule'],
    domain: 'flight-reschedule-entry',
    label: 'Flight Reschedule Entry',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/reschedule',
    pageType: 'flight-booking',
    priority: 3,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-reschedule'],
    domain: 'flight-reschedule-info',
    label: 'Flight Reschedule Info',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/reschedule/info/INVOICE_ID',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-reschedule'],
    domain: 'flight-reschedule-selection',
    label: 'Flight Reschedule Selection',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/reschedule/selection',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-refund'],
    domain: 'flight-refund-entry',
    label: 'Flight Refund Entry',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/refund/alternative',
    pageType: 'flight-booking',
    priority: 3,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-refund'],
    domain: 'flight-refund-info',
    label: 'Flight Refund Info',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/refund/info/INVOICE_ID',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-check-in'],
    domain: 'flight-checkin-entry',
    label: 'Flight Check-in',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/checkin/airline/INVOICE_ID',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-extra-baggages'],
    domain: 'flight-add-baggage',
    label: 'Flight Add Baggage',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/add-baggage/INVOICE_ID',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-ancillary'],
    domain: 'flight-ancillary',
    label: 'Flight Ancillary Add-ons',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/ancillary/INVOICE_ID',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-post-seat'],
    domain: 'flight-seat-selection',
    label: 'Flight Seat Selection',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/seat-selection/INVOICE_ID',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-preflight'],
    domain: 'flight-preflight',
    label: 'Flight Pre-flight Check',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/preflight/landingPage/INVOICE_ID/INVOICE_ID',
    pageType: 'flight-booking',
    priority: 3,
    subFlow: true,
    requiresBooking: true,
  },
  {
    pkgPrefixes: ['fpr-travel-credit'],
    domain: 'flight-airline-travel-credit',
    label: 'Flight Airline Travel Credit',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/airline-travel-credit',
    pageType: 'flight-booking',
    priority: 3,
  },

  // ── Priority 4: SEO / info pages ──────────────────────────────────────
  {
    pkgPrefixes: ['fpr-seo-route', 'fpr-seo-airline-destination', 'fpr-seo-destination'],
    domain: 'flight-seo-destination',
    label: 'Flight SEO Destination',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/to/bali-id',
    pageType: 'flight-search',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-country-page'],
    domain: 'flight-country-page',
    label: 'Flight Country Page',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/country/indonesia',
    pageType: 'flight-search',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-airport'],
    domain: 'flight-airport-page',
    label: 'Flight Airport Page',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/airport/cgk',
    pageType: 'flight-search',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-seo-airline-v2', 'fpr-seo-airline-destination'],
    domain: 'flight-airline-page',
    label: 'Flight Airline Page',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/airline/garuda-indonesia',
    pageType: 'flight-search',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-seo-route-v2', 'fpr-seo-route'],
    domain: 'flight-route-page',
    label: 'Flight Route Page',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/route/sin-cgk',
    pageType: 'flight-search',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-safe-travel'],
    domain: 'flight-safe-travel',
    label: 'Flight Safe Travel',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/safe-travel',
    pageType: 'flight-search',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-force-majeure'],
    domain: 'flight-force-majeure',
    label: 'Flight Force Majeure',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/force-majeure',
    pageType: 'flight-booking',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-general-info'],
    domain: 'flight-general-info',
    label: 'Flight General Info',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/general-info',
    pageType: 'flight-search',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-carbon-offset'],
    domain: 'flight-carbon-offset',
    label: 'Flight Carbon Offset',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/carbon-offset',
    pageType: 'flight-booking',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-booking-tracker'],
    domain: 'flight-booking-tracker',
    label: 'Flight Booking Tracker',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/order',
    pageType: 'flight-booking',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-flight-changes'],
    domain: 'flight-changes',
    label: 'Flight Changes',
    urlTemplate: 'https://www.traveloka.com/en-sg/flight/changes',
    pageType: 'flight-booking',
    priority: 4,
  },
  {
    pkgPrefixes: ['fpr-visa'],
    domain: 'flight-visa-info',
    label: 'Visa Info',
    urlTemplate: 'https://www.traveloka.com/en-sg/visa/visa-info',
    pageType: 'flight-search',
    priority: 4,
  },
];

// Packages that should never generate specs:
// - pure component libraries (no standalone pages)
// - mobile surfaces (desktop-first priority)
// - internal tooling, tracking, devtools
// - already covered by weekly-diff pipeline

const SKIP_PREFIXES = [
  '-components',
  '-mobile',
  'app-mobile',
  'fpr-common',
  'fpr-tracking',
  'fpr-devtools',
  'fpr-internal-tools',
  'fpr-datadog',
  'fpr-performance-tracker',
  'fpr-trpc',
  'fpr-search-result',   // covered by weekly-diff
  'fpr-search-form',     // covered by weekly-diff
  'fpr-booking-mobile',
  'fpr-booking-addon',
  'fpr-booking-components',
  'fpr-booking-product-summary',
  'fpr-bundle',
  'fpr-tax',
  'fpr-ticket',
  'fpr-tdm',
  'fpr-airlink',
  'fpr-airline-redirection',
  'fpr-coupon',
  'fpr-installment',
  'fpr-jetset',
  'fpr-latios',
  'fpr-mcp',
  'fpr-merchandising',
  'fpr-nachos',
  'fpr-neon',
  'fpr-nimbus',
  'fpr-npc',
  'fpr-outbound',
  'fpr-pax-type-average',
  'fpr-payment',
  'fpr-pepe',
  'fpr-promo-banner',
  'fpr-refund-communication',
  'fpr-servo',
  'fpr-share-feature',
  'fpr-skypack',
  'fpr-todi',
  'fpr-transit',
  'fpr-wci',
  'fpr-wibu',
  'fpr-ibda',
  'fpr-dart',
  'fpr-baggage-details',
  'fpr-affi',
  'fpr-desktop-ticket',
  'fpr-flight-card',
  'fpr-th-expat',
  'fpr-prioritizing',
  'fpr-reschedule-components',
  'fpr-reschedule-form',
  'fpr-reschedule-policy',
  'fpr-reschedule-search',
  'fpr-seo-components',
  'fpr-seo-search',
  'fpr-seo-v2',
  'fpr-seo-airport-v2', // airport covered by flight-airport-page
  'fpr-seo-country-v2', // country covered by flight-country-page
  'fpr-date-flow',
  'fpr-price-table',
  'fpr-mobile-components',
  'fpr-mobile-ticket',
];

// ---------------------------------------------------------------------------
// Step 1: Get fpr-* packages from www cached repo
// ---------------------------------------------------------------------------

function getFprPackages(): string[] {
  if (!fs.existsSync(WWW_REPO)) {
    console.warn(`⚠️  www repo not found at ${WWW_REPO}`);
    console.warn('   Run npm run weekly-diff first to clone it.');
    return [];
  }

  try {
    const output = execSync(
      `git -C "${WWW_REPO}" ls-tree --name-only HEAD packages/flight/ 2>/dev/null`,
      { encoding: 'utf8' },
    );
    return output
      .split('\n')
      .map((line) => line.replace('packages/flight/', '').trim())
      .filter((name) => name.startsWith('fpr-'));
  } catch {
    console.warn('⚠️  Could not list fpr-* packages from www repo');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 2: Check which domains are already covered
// ---------------------------------------------------------------------------

function getExistingDomains(): Set<string> {
  const covered = new Set<string>();

  // From spec file names / content
  if (!fs.existsSync(TESTS_WEB_DIR)) return covered;

  // The booking→payment e2e spec permanently covers the booking e2e domain
  const paymentSpecExists = fs.existsSync(
    path.join(TESTS_WEB_DIR, 'traveloka-flight-booking-payment-e2e.spec.ts'),
  );
  if (paymentSpecExists) {
    covered.add('flight-booking-e2e');
  }

  const specs = fs.readdirSync(TESTS_WEB_DIR).filter((f) => f.endsWith('.spec.ts'));
  for (const spec of specs) {
    const content = fs.readFileSync(path.join(TESTS_WEB_DIR, spec), 'utf8');

    // Check comment header for domain fields or match file names
    for (const entry of DOMAIN_MAP) {
      if (content.includes(`domain: '${entry.domain}'`) ||
          content.includes(`domain: "${entry.domain}"`) ||
          spec.includes(entry.domain) ||
          (entry.domain === 'flight-homepage' && content.includes('traveloka.com/en-sg/flight\n') && !content.includes('fullsearch') && !content.includes('fulltwosearch'))) {
        covered.add(entry.domain);
      }
    }
  }

  // From manifest registry
  const registryPath = path.join(TESTS_WEB_DIR, 'registry.yaml');
  if (fs.existsSync(registryPath)) {
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      for (const [, meta] of Object.entries(registry)) {
        const m = meta as any;
        if (m.domain) covered.add(m.domain);
        // also scan intent for domain keywords
        if (typeof m.intent === 'string') {
          for (const entry of DOMAIN_MAP) {
            if (m.intent.toLowerCase().includes(entry.domain.replace('flight-', ''))) {
              covered.add(entry.domain);
            }
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  return covered;
}

// ---------------------------------------------------------------------------
// Step 3: Identify gaps — DOMAIN_MAP entries whose packages exist in www
//         but whose domain is not yet in existing specs
// ---------------------------------------------------------------------------

interface CoverageGap {
  entry: DomainEntry;
  packages: string[];
}

function findGaps(fprPackages: string[], coveredDomains: Set<string>): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  for (const entry of DOMAIN_MAP) {
    if (coveredDomains.has(entry.domain)) continue;

    // Check if any of the package prefixes exist in the www repo
    const matchingPkgs = fprPackages.filter((pkg) =>
      entry.pkgPrefixes.some((prefix) => pkg === prefix || pkg.startsWith(prefix + '-')),
    );
    if (matchingPkgs.length === 0) continue;

    gaps.push({ entry, packages: matchingPkgs });
  }

  // Sort by priority
  gaps.sort((a, b) => a.entry.priority - b.entry.priority);
  return gaps;
}

// ---------------------------------------------------------------------------
// Step 4: Generate smoke spec content for a gap
// ---------------------------------------------------------------------------

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function buildIntentHash(domain: string): string {
  const key = [domain, 'smoke-coverage', 'page-load,p0-detection'].join('::');
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
}

function buildUrl(template: string, invoiceId?: string): string {
  return template
    .replace('DEPART_DATE', travelokaDate(14))
    .replace('RETURN_DATE', travelokaDate(21))
    .replace(/INVOICE_ID/g, invoiceId ?? 'TEST_BOOKING_ID');
}

function readBookingFixture(): { invoiceId: string; auth: string; capturedAt: string } | null {
  try {
    if (!fs.existsSync(BOOKING_FIXTURE_PATH)) return null;
    const fixture = JSON.parse(fs.readFileSync(BOOKING_FIXTURE_PATH, 'utf8'));
    // Fixture expires after 48 hours (payment URL tokens are time-limited)
    const age = Date.now() - new Date(fixture.capturedAt).getTime();
    if (age > 48 * 60 * 60 * 1000) {
      console.warn(`⚠️  booking-fixture.json is stale (${Math.round(age / 3600000)}h old) — skipping requiresBooking specs`);
      return null;
    }
    return fixture;
  } catch {
    return null;
  }
}

function generateSpecContent(gap: CoverageGap, date: string, fixture?: { invoiceId: string; auth: string; capturedAt: string } | null): string {
  const { entry } = gap;
  const url = buildUrl(entry.urlTemplate, fixture?.invoiceId);
  const specTitle = `Traveloka flight ${entry.label} smoke coverage (${date})`;
  const pkgList = gap.packages.join(', ');

  const subFlowNote = entry.subFlow
    ? `\n *   Sub-flow: navigates with a dummy ID. Auth redirect or error state is acceptable.\n *   Only fails on P0 bugs / JS crashes / 5xx before or after redirect.`
    : '';
  const requiresBookingNote = entry.requiresBooking
    ? `\n *   Requires booking: reads invoiceId from data/booking-fixture.json (written by payment e2e).\n *   Skipped (not failed) when no fresh fixture is available.`
    : '';

  const subFlowAssertion = entry.subFlow ? `
  // Sub-flow: with a dummy ID the server will redirect to login or show an error state.
  // Both outcomes are valid — we only care that there is no crash or P0 bug.
  const finalUrl = page.url();
  const isAuthRedirect = /login|signin|auth|account/.test(finalUrl);
  const isErrorPage = /\/404|\/500|\/error/.test(finalUrl);
  console.log(\`\\n↪ Final URL: \${finalUrl}\`);
  if (isAuthRedirect) {
    console.log('  ✅ Auth redirect — expected for sub-flow with dummy ID');
  } else if (isErrorPage) {
    console.log('  ⚠️  Error page — acceptable for dummy ID, checking for P0 bugs');
  }
` : '';

  const requiresBookingBlock = entry.requiresBooking ? `
import * as fs from 'node:fs';
import * as path from 'node:path';

const BOOKING_FIXTURE_PATH = path.resolve(__dirname, '../../data/booking-fixture.json');

function loadBookingFixture(): { invoiceId: string; auth: string } | null {
  try {
    if (!fs.existsSync(BOOKING_FIXTURE_PATH)) return null;
    const f = JSON.parse(fs.readFileSync(BOOKING_FIXTURE_PATH, 'utf8'));
    const age = Date.now() - new Date(f.capturedAt).getTime();
    if (age > 48 * 60 * 60 * 1000) return null; // stale after 48h
    return f;
  } catch { return null; }
}` : '';

  return `import { test, expect } from '../fixture';
import { GenericBugDetector } from '../lib/generic-bug-detector';
${requiresBookingBlock}
/**
 * EN Purpose: Auto-generated smoke spec for ${entry.label}.${subFlowNote}${requiresBookingNote}
 *   Navigates to the ${entry.domain} surface and runs P0 generic bug detection.
 *   Promoted from candidate → stable once it passes consistently for 3+ weeks.
 * EN Source: explore-coverage-gaps.ts — gap scan of www packages: ${pkgList}
 * EN Domain: ${entry.domain}
 * EN Lifecycle: candidate
 * EN Surface: desktop
 * EN Concerns: page-load, p0-detection${entry.subFlow ? ', sub-flow-redirect' : ''}${entry.requiresBooking ? ', requires-booking-fixture' : ''}
 * EN Generated: ${new Date().toISOString()}
 */

const TARGET_URL = '${url}';

test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'Asia/Shanghai',
  extraHTTPHeaders: {
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.google.com/',
  },
});

test('${specTitle}', async ({ page }) => {${entry.requiresBooking ? `
  const fixture = loadBookingFixture();
  if (!fixture) {
    console.warn('[skip] No fresh booking fixture — run traveloka-flight-booking-payment-e2e.spec.ts first to generate data/booking-fixture.json');
    test.skip();
    return;
  }
  console.log('[fixture] invoiceId:', fixture.invoiceId);` : ''}
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
${subFlowAssertion}
  // Basic load sanity: page must have a non-empty title
  const title = await page.title();
  expect(title, 'Page title should not be empty after load').toBeTruthy();

  // P0 generic bug detection (layout, XSS, console errors)
  const detector = new GenericBugDetector(page, { pageType: '${entry.pageType}' });
  const auditResult = await detector.runFullAudit();
  const p0Issues = auditResult.filter((i) => i.severity === 'P0');

  console.log(\`\\n📋 ${entry.label} audit: \${auditResult.length} total issues, \${p0Issues.length} P0\`);
  if (p0Issues.length > 0) {
    console.error('P0 issues found:', JSON.stringify(p0Issues, null, 2));
  }

  expect(p0Issues, \`P0 bugs found on ${entry.domain}: \${JSON.stringify(p0Issues)}\`).toHaveLength(0);
});
`;
}

// ---------------------------------------------------------------------------
// Step 5: Register in AccumulationManifest
// ---------------------------------------------------------------------------

function registerSpec(
  gap: CoverageGap,
  specPath: string,
  specId: string,
  intentHash: string,
): void {
  const manifest = new AccumulationManifest(TESTS_WEB_DIR);

  // Add a committed layer for this exploration batch if not already present today
  const layerId = `explore-${todayStamp()}`;
  const existingLayers = (manifest as any).manifest?.layers?.committed ?? [];
  const alreadyHasLayer = existingLayers.some((l: any) => l.id === layerId);

  if (!alreadyHasLayer) {
    manifest.addCommittedLayer({
      id: layerId,
      type: 'snapshot',
      timestamp: new Date().toISOString(),
      caseCount: 0,
      domains: [gap.entry.domain],
      intentHashes: [],
      status: 'active',
    });
  }

  const caseMeta: CaseMetadata = {
    id: `${layerId}-${gap.entry.domain}`,
    domain: 'other',
    intent: `Smoke coverage for ${gap.entry.label}: page load + P0 detection`,
    intentHash,
    path: path.relative(path.resolve(__dirname, '..'), specPath),
    addedDate: new Date().toISOString().substring(0, 10),
    status: 'active',
    executionLayer: 'active',
    lifecycle: 'candidate',
    promotion: {
      candidate_since: new Date().toISOString().substring(0, 10),
    },
    statistics: {
      totalRuns: 0,
      passedRuns: 0,
      failedRuns: 0,
    },
  };

  manifest.registerCase(caseMeta);
  manifest.save();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🔭 explore-coverage-gaps — autonomous coverage expansion\n');

  const fprPackages = getFprPackages();
  console.log(`📦 www repo: ${fprPackages.length} fpr-* packages found`);

  const coveredDomains = getExistingDomains();
  console.log(`✅ Already covered domains: ${coveredDomains.size}`);
  if (coveredDomains.size > 0) {
    for (const d of coveredDomains) console.log(`   - ${d}`);
  }

  const gaps = findGaps(fprPackages, coveredDomains);
  console.log(`\n🔍 Coverage gaps found: ${gaps.length}`);

  if (gaps.length === 0) {
    console.log('🎉 No gaps — all mapped domains are already covered!');
    return;
  }

  for (const gap of gaps) {
    const status = coveredDomains.has(gap.entry.domain) ? '✅' : '❌';
    console.log(`   ${status} ${gap.entry.domain} (priority ${gap.entry.priority}) — packages: ${gap.packages.join(', ')}`);
  }

  if (LIST_GAPS) {
    console.log('\n(--list-gaps mode: no specs generated)');
    return;
  }

  const toGenerate = gaps.slice(0, MAX_NEW_SPECS);
  console.log(`\n📝 Generating ${toGenerate.length} new smoke spec(s) (--limit ${MAX_NEW_SPECS})...\n`);

  const date = todayStamp();
  const generated: string[] = [];

  for (const gap of toGenerate) {
    const intentHash = buildIntentHash(gap.entry.domain);

    // Dedup check via manifest
    const manifest = new AccumulationManifest(TESTS_WEB_DIR);
    const existing = manifest.checkDuplicate(intentHash);
    if (existing) {
      console.log(`⏭  ${gap.entry.domain}: already registered (intentHash ${intentHash}), skipping`);
      continue;
    }

    const fileName = `traveloka-flight-explore-${gap.entry.domain}-${date}.spec.ts`;
    const specPath = path.join(TESTS_WEB_DIR, fileName);

    // Also check if a file with this domain already exists (different date stamp)
    const existingFile = fs.readdirSync(TESTS_WEB_DIR).find(
      (f) => f.includes(`explore-${gap.entry.domain}`) && f.endsWith('.spec.ts'),
    );
    if (existingFile) {
      console.log(`⏭  ${gap.entry.domain}: spec file already exists (${existingFile}), skipping`);
      continue;
    }

    // requiresBooking: read fixture once and pass to generator
    let fixture: { invoiceId: string; auth: string; capturedAt: string } | null = null;
    if (gap.entry.requiresBooking) {
      fixture = readBookingFixture();
      if (!fixture) {
        console.log(`⏭  ${gap.entry.domain}: requires booking fixture (data/booking-fixture.json not found or stale) — spec generated with skip guard`);
      }
    }

    const content = generateSpecContent(gap, date, fixture);
    const specId = `explore-${date}-${gap.entry.domain}`;

    if (DRY_RUN) {
      console.log(`🔲 [dry-run] Would write: ${fileName}`);
      console.log('─'.repeat(60));
      console.log(content.slice(0, 400) + '...');
      console.log('─'.repeat(60));
    } else {
      fs.writeFileSync(specPath, content, 'utf8');
      registerSpec(gap, specPath, specId, intentHash);
      console.log(`✅ Generated: ${fileName}`);
    }

    generated.push(fileName);
  }

  if (!DRY_RUN) {
    console.log(`\n✅ Done. ${generated.length} new spec(s) created in tests/web/`);
    console.log('\nNext steps:');
    console.log('  Run once to validate:');
    console.log(`  npx playwright test ${generated.map((f) => `tests/web/${f}`).join(' ')} --workers=1`);
    console.log('\n  Or add to weekly schedule:');
    console.log('  npm run explore:run');
  }
}

main().catch((err) => {
  console.error('❌ explore-coverage-gaps failed:', err);
  process.exit(1);
});
