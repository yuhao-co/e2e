#!/usr/bin/env tsx
/**
 * Android Maestro Case Generator
 *
 * Pipeline: Source Context → AI (GitHub Models API) → Maestro YAML files
 *
 * Auth priority (no separate API key needed):
 *   1. GITHUB_TOKEN env var  — set automatically by gh CLI / GitHub Actions
 *   2. `gh auth token`       — read from local gh CLI session
 *   3. OPENAI_API_KEY        — fallback if you have one
 *   4. Local MLX server      — last resort (lower quality)
 *
 * Usage:
 *   tsx scripts/generate-maestro-android.ts
 *   tsx scripts/generate-maestro-android.ts --source-json path/to/source-context.json
 *   tsx scripts/generate-maestro-android.ts --dry-run
 *   tsx scripts/generate-maestro-android.ts --model claude-sonnet-4-5
 *
 * Output:
 *   maestro/flows/android/generated/<scenario-id>.yaml
 *   maestro/flows/android/run-all-android.yaml
 *   maestro/flows/android/manifest.json
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// PATH bootstrap — ensure maestro, java17, adb are always findable regardless
// of how this script is invoked (cron, npm run, IDE, android-diff-workflow.ts)
// ---------------------------------------------------------------------------
const MAESTRO_BIN_PATH = `${process.env.HOME}/.maestro/bin`;
const JAVA_BIN_PATH    = '/opt/homebrew/opt/openjdk@17/bin';
const BREW_BIN_PATH    = '/opt/homebrew/bin';
const ADB_BIN_PATH     = `${process.env.HOME}/Library/Android/sdk/platform-tools`;
process.env.JAVA_HOME = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17';
process.env.PATH = [MAESTRO_BIN_PATH, JAVA_BIN_PATH, BREW_BIN_PATH, ADB_BIN_PATH, process.env.PATH].join(':');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SOURCE_JSON = (() => {
  const idx = args.indexOf('--source-json');
  return idx !== -1 ? args[idx + 1] : null;
})();
const PRD_FILE = (() => {
  const idx = args.indexOf('--prd-file');
  return idx !== -1 ? args[idx + 1] : null;
})();
const CLI_MODEL = (() => {
  const idx = args.indexOf('--model');
  return idx !== -1 ? args[idx + 1] : null;
})();
const PENDING_SCENARIOS_FILE = (() => {
  const idx = args.indexOf('--pending-scenarios');
  return idx !== -1 ? args[idx + 1] : null;
})();
/** --extended: generate extra SSR-V4 multi-filter / mini-tray / bug-hunt scenarios */
const EXTENDED = args.includes('--extended');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OUTPUT_DIR = path.resolve('maestro/flows/android/generated');
const MANIFEST_PATH = path.resolve('maestro/flows/android/manifest.json');
const RUN_ALL_PATH = path.resolve('maestro/flows/android/run-all-android.yaml');
// STRONG CONSTRAINT: All cases are consolidated into ONE suite file per run.
// Individual per-scenario files are NEVER written. Only android-suite.yaml is the output.
const SUITE_PATH = path.resolve('maestro/flows/android/generated/android-suite.yaml');

// ---------------------------------------------------------------------------
// PAYMENT BLUEPRINT — LOCKED, verified passing 2026-06-16
// ALL payment/booking scenario generation MUST follow this file as the canonical template.
// DO NOT modify this file. DO NOT deviate from its patterns.
// ---------------------------------------------------------------------------
const PAYMENT_BLUEPRINT_PATH = path.resolve('maestro/flows/android/generated/android-booking-payment.yaml');
const PAYMENT_BLUEPRINT_YAML: string = (() => {
  try {
    return fs.readFileSync(PAYMENT_BLUEPRINT_PATH, 'utf8');
  } catch {
    return '(payment blueprint not found — ensure android-booking-payment.yaml exists)';
  }
})();
const APP_ID = 'com.traveloka.android.staging';
const MEMORY_FILE = path.resolve('config/android-learning-memory.json');

// ---------------------------------------------------------------------------
// Learning memory reader (accumulative coverage feedback)
// ---------------------------------------------------------------------------
interface LearningMemorySnapshot {
  stableScenarios: string[];
  expansionQueue: string[];
  coverageGaps: string[];
  knownFixPatterns: string[];
  totalRuns: number;
}

function readLearningMemory(): LearningMemorySnapshot {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      return {
        stableScenarios: raw.stableScenarios ?? [],
        expansionQueue: raw.expansionQueue ?? [],
        coverageGaps: raw.coverageGaps ?? [],
        knownFixPatterns: raw.knownFixPatterns ?? [],
        totalRuns: raw.totalRuns ?? 0,
      };
    }
  } catch { /* memory file not ready yet — first run */ }
  return { stableScenarios: [], expansionQueue: [], coverageGaps: [], knownFixPatterns: [], totalRuns: 0 };
}

const LEARNING_MEMORY = readLearningMemory();

// ---------------------------------------------------------------------------
// COMPOSE MIGRATION CONSTRAINT
// ---------------------------------------------------------------------------
// The flight search results page (v4) is fully Jetpack Compose.
// Old android:id values from flight_result_revamp_activity.xml and
// flight_result_card.xml do NOT appear in the Accessibility tree.
// Any test using these IDs will ALWAYS fail with "element not found".
//
// Source verification:
//   git grep testTag flight/src/main/java/**/searchresult/v4/**/*.kt
// Last audited: 2026-06-11 (traveloka/android-v3 @ develop)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// STRONG CONSTRAINT — ID ENFORCEMENT
// Verified from actual Maestro test runs (2026-06-16). Any case using a
// FORBIDDEN ID will ALWAYS fail with "element not found". These are permanently
// banned from appearing in any generated YAML.
// ---------------------------------------------------------------------------

/** IDs that are CONFIRMED NON-WORKING at runtime. NEVER use in generated YAML. */
const FORBIDDEN_XML_IDS: string[] = [
  // ── HALLUCINATED IDs (never existed in source or a11y tree) ───────────────
  // flight_result_v4_filter_button: does NOT exist in source code or a11y tree.
  //   Correct filter button Compose testTag: flight_result_filter_button_title
  'flight_result_v4_filter_button',
  // flight_result_v4_date_flow_row: does NOT exist in source code or a11y tree.
  //   Correct date strip id: widget_dateflow (XML android:id, accessible)
  'flight_result_v4_date_flow_row',
  // flight_result_v4_navbar_toolbar_title: NOT in accessibility tree.
  //   Correct title id: text_result_title (XML android:id, verified 2026-06-16)
  'flight_result_v4_navbar_toolbar_title',
  // flight_result_v4_inventory_card: NOT in a11y tree.
  //   Correct card id: card_result (XML android:id, verified 2026-06-16)
  'flight_result_v4_inventory_card',

  // ── REMOVED FROM UI / WRONG TARGET ────────────────────────────────────────
  // bm_button: floating sort suggestion pill has been REMOVED from the results UI.
  //   Correct sort button Compose testTag: flight_result_sort_button_title
  'bm_button',
  // rbg_sort: use layout_tray instead (sort tray root, XML android:id, accessible)
  'rbg_sort',
  // flight_result_v4_sort_button: shouldDisplaySortButtonInNavbar=false in staging
  //   → this button is NEVER rendered. Use flight_result_sort_button_title.
  'flight_result_v4_sort_button',

  // ── WRONG INTERACTION TARGET ───────────────────────────────────────────────
  // quick_filter_item: opens Stops bottom sheet ONLY, NOT full filter dialog.
  //   layout_filter_dialog will NEVER appear after tapping this.
  //   Use flight_result_filter_button_title for the full filter dialog.
  'quick_filter_item',
  // tvResult: is a count DISPLAY label ("25 results"), NOT a clickable apply button.
  //   Tapping it does NOT close the filter dialog. Use dbwShow to apply.
  'tvResult',

  // ── OLD XML IDs NOT IN A11Y TREE ──────────────────────────────────────────
  'result_container',
  'inventory_parent_layout',
  'filter_non_sticky',
  'filter_non_sticky_fill',
  'layout_navigation',
  'text_result_subtitle',
  'image_arrow_back',
  'image_change_search',
  'text_departure_time',
  'text_arrival_time',
  'text_displayed_price',
  'text_flight_name',
  'text_number_of_transit',
  'tv_duration_transit',
  'text_date',
  'text_price',
  'dialog_toolbar',
  'bSelect',
];

/**
 * Canonical mapping: WRONG ID → CORRECT ID
 * When validation finds a forbidden ID, show the exact correct replacement.
 * All mappings verified from actual passing test runs (2026-06-16).
 */
const COMPOSE_ID_MAP: Record<string, string> = {
  // Filter button (hallucinated ID → real Compose testTag)
  'flight_result_v4_filter_button':        'flight_result_filter_button_title',
  // Date strip (hallucinated ID → real XML android:id)
  'flight_result_v4_date_flow_row':        'widget_dateflow',
  // Navbar title (not in a11y tree → real XML android:id)
  'flight_result_v4_navbar_toolbar_title': 'text_result_title',
  // Card (not in a11y tree → real XML android:id)
  'flight_result_v4_inventory_card':       'card_result',
  // Sort button: floating pill removed → real Compose testTag
  'bm_button':                             'flight_result_sort_button_title',
  // Sort tray container: wrong ID → real XML android:id
  'rbg_sort':                              'layout_tray',
  // Sort button: never rendered → real Compose testTag
  'flight_result_v4_sort_button':          'flight_result_sort_button_title',
  // Quick filter chip: opens stops sheet only → use full filter button
  'quick_filter_item':                     'flight_result_filter_button_title',
  // Apply button: count label, not clickable → real apply button
  'tvResult':                              'dbwShow',
  // Old XML IDs → no direct replacement
  'result_container':       'text_result_title',
  'inventory_parent_layout':'card_result',
  'filter_non_sticky':      'flight_result_filter_button_title',
  'layout_navigation':      '(removed from UI)',
};

// ---------------------------------------------------------------------------
// Auth resolution — GitHub token preferred (no separate key needed)
// ---------------------------------------------------------------------------
function resolveGitHubToken(): string | null {
  // 1. Env var (GitHub Actions / manual export)
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  // 2. gh CLI session
  try {
    const token = execSync('gh auth token', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (token) return token;
  } catch { /* gh not configured */ }
  return null;
}

const githubToken = resolveGitHubToken();
const openaiKey = process.env.OPENAI_API_KEY;

// Build OpenAI-compatible client
const openai = (() => {
  if (githubToken) {
    // GitHub Models API — same endpoint, OpenAI-compatible, uses gh token
    // maxRetries=0: prevent SDK from silently retrying 429s forever (GitHub Models rate-limits aggressively)
    // timeout=60000: hard cap per request; AbortController in generateYaml() adds per-call guard too
    return new OpenAI({
      apiKey: githubToken,
      baseURL: 'https://models.inference.ai.azure.com',
      maxRetries: 0,
      timeout: 60_000,
    });
  }
  if (openaiKey) {
    return new OpenAI({ apiKey: openaiKey });
  }
  // Fallback: local MLX server
  return new OpenAI({
    apiKey: process.env.MIDSCENE_MODEL_API_KEY ?? 'local',
    baseURL: process.env.MIDSCENE_MODEL_BASE_URL ?? 'http://127.0.0.1:8080/v1',
  });
})();

const MODEL = CLI_MODEL ?? (() => {
  // gpt-4o-mini: higher GitHub Models rate limits (vs gpt-4o which caps at ~150 req/day)
  if (githubToken)  return process.env.GITHUB_MODEL ?? 'gpt-4o-mini';
  if (openaiKey)    return process.env.OPENAI_MODEL ?? 'gpt-4o';
  return process.env.MIDSCENE_MODEL_NAME ?? 'mlx-community/Qwen2.5-VL-7B-Instruct-4bit';
})();

const AUTH_SOURCE = githubToken ? 'GitHub Models (gh token)'
  : openaiKey ? 'OpenAI API'
  : 'Local MLX';

// ---------------------------------------------------------------------------
// Source context — in production, pass --source-json with extracted RN data
// Default: built-in knowledge of Traveloka Android Flight Search Results page
// ---------------------------------------------------------------------------
interface AndroidSourceContext {
  appId: string;
  screen: string;
  /** High-level steps to reach this screen from app launch */
  precondition: string[];
  /** Resource IDs verified accessible at runtime (adb uiautomator dump 2026-06-16) */
  accessibilityIds: Record<string, string>;
  /** Interactive affordances with description — fed to AI as known patterns */
  interactions: Array<{ name: string; trigger: string; outcome: string }>;
}

const DEFAULT_SOURCE_CONTEXT: AndroidSourceContext = {
  appId: APP_ID,
  screen: 'Flight Search Results',

  precondition: [
    // ─────────────────────────────────────────────────────────────────────────
    // STRONG CONSTRAINT: ALWAYS use deeplink navigation. NEVER use home screen
    // product tile navigation. FlightSearchFormV2Activity has a staging DI bug:
    // SharedPreferences cache owner persists across force-stop, causing
    // IllegalStateException crash on 2nd+ test run. Deeplink bypasses it entirely.
    //
    // Deeplink verified working (SIN→CGK, Wed 2026-06-17):
    //   traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY
    //
    // FORBIDDEN: launchApp + tapOn home tile + tapOn search_tab + tapOn btn_search
    //   These cause: IllegalStateException: Try to replace cache owner when existing
    //   cache owner is not disposed yet (FlightSearchFormV2Activity.kt:113)
    // ─────────────────────────────────────────────────────────────────────────
    '- stopApp',
    '- openLink:\n    link: "traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY"',
    '- extendedWaitUntil:\n    visible:\n      id: "card_result"\n    timeout: 30000',
  ],

  // ── VERIFIED WORKING IDs (runtime-confirmed, adb uiautomator dump 2026-06-16) ──
  // These are the ONLY IDs to use in generated YAML. Do NOT use any other IDs.
  accessibilityIds: {
    // ── Results page: accessible at runtime ─────────────────────────────────
    // XML android:id values (despite Compose migration, still in a11y tree):
    navbarTitle:            'text_result_title',                             // route header
    inventoryCard:          'card_result',                                   // each flight card
    dateFlowRow:            'widget_dateflow',                               // date-price strip row
    calendarIcon:           'image_calendar',                                // calendar icon inside date strip

    // Compose testTags (verified in UIAutomator dump):
    filterButton:           'flight_result_filter_button_title',             // opens full filter dialog
    sortButton:             'flight_result_sort_button_title',               // opens sort tray

    // ── Sort tray: XML android:id (accessible after sort button tap) ─────────
    // Open with: tapOn id: "flight_result_sort_button_title" → wait id: "layout_tray"
    sortTray:               'layout_tray',                                   // sort tray root
    // Sort options: tap radio_button by index inside layout_tray
    // Sort order (FlightSortTrayWidgetPresenter.kt, scoreShown=false):
    //   index 0 → Cheapest (SORT_PRICE_LOWEST)
    //   index 1 → Direct flight first (SORT_DIRECT_FLIGHT_FIRST)
    //   index 2 → Earliest departure (SORT_DEPARTURE_TIME_EARLIEST)
    //   index 3 → Latest departure (SORT_DEPARTURE_TIME_LATEST)
    //   index 4 → Earliest arrival (SORT_ARRIVAL_TIME_EARLIEST)
    //   index 5 → Latest arrival (SORT_ARRIVAL_TIME_LATEST)
    //   index 6 → Shortest duration (SORT_DURATION_SHORTEST)
    sortOptionRadio:        'radio_button',                                  // each sort option row

    // ── Filter dialog: XML android:id (FlightResultRevampFilterDialog) ───────
    // Open with: tapOn id: "flight_result_filter_button_title" → wait id: "layout_filter_dialog"
    filterDialog:           'layout_filter_dialog',
    filterReset:            'tvReset',
    filterApply:            'dbwShow',                                       // "Show X results" button — NOT tvResult
    filterTransitLayer:     'layer_transit',
    filterAirlineLayer:     'layer_airline',
    filterTimeLayer:        'layer_time',

    // flight_result_revamp_filter_transit_layer.xml
    filterDirect:           'button_direct',
    filterOneStop:          'button_one_transit',
    filterTwoStop:          'button_two_transit',

    // flight_filter_time_layer.xml (use scrollUntilVisible to reach — below the fold)
    filterDepartMorning:    'button_departure_morning',
    filterDepartAfternoon:  'button_departure_afternoon',
    filterDepartEvening:    'button_departure_evening',

    // ── Fare selection screen (after tapping card_result) ────────────────────
    fareTicketSection:      'flight_summary_activity_ticket_option_section',
    fareTicketContainer:    'flight_summary_activity_ticket_option_selection_container',
    farePriceDisplay:       'flight_ticketOptionPriceDisplay',
    fareBenefitSection:     'flight_ticketOptionBenefit_section',
    fareSegmentInfo:        'flight_summary_segment_info_container',
  },

  interactions: [
    {
      name: 'Navigate to Results (ALWAYS USE THIS)',
      trigger: 'stopApp → openLink traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY → wait card_result',
      outcome: 'Results page opens with flight cards (bypasses crashing FlightSearchFormV2Activity)',
    },
    {
      name: 'Apply Direct Filter (via filter dialog)',
      trigger: 'Tap flight_result_filter_button_title → wait layout_filter_dialog → tap button_direct → tap dbwShow',
      outcome: 'Only direct flights in result list',
    },
    {
      name: 'Apply 1-Stop Filter (via filter dialog)',
      trigger: 'Tap flight_result_filter_button_title → wait layout_filter_dialog → tap button_one_transit → tap dbwShow',
      outcome: 'Cards show 1-stop flights',
    },
    {
      name: 'Sort by Cheapest',
      trigger: 'Tap flight_result_sort_button_title → wait layout_tray → tap radio_button index 0',
      outcome: 'Results reload sorted by price ascending',
    },
    {
      name: 'Sort by Fastest (Shortest Duration)',
      trigger: 'Tap flight_result_sort_button_title → wait layout_tray → tap radio_button index 6',
      outcome: 'Results reload sorted by duration ascending',
    },
    {
      name: 'Open Full Filter Dialog',
      trigger: 'Tap flight_result_filter_button_title — NEVER use flight_result_v4_quick_filter_cell (opens stops sheet only)',
      outcome: 'layout_filter_dialog becomes visible with all filter sections',
    },
    {
      name: 'Reset Filters',
      trigger: 'Inside filter dialog: tap tvReset → tap dbwShow (NOT tvResult — tvResult is count label)',
      outcome: 'All filter selections cleared, full result set restored',
    },
    {
      name: 'Select Flight (View Fare Options)',
      trigger: 'Tap card_result index: 0',
      outcome: 'Navigates to fare screen; flight_summary_activity_ticket_option_section visible',
    },
    {
      name: 'Back to Results',
      trigger: 'System back gesture (- back)',
      outcome: 'Returns to results page with card_result visible',
    },
    {
      name: 'Scroll Results',
      trigger: '- scroll (bare command, no sub-keys)',
      outcome: 'More flight cards become visible',
    },
    {
      name: 'Open Price Calendar',
      trigger: 'extendedWaitUntil id: widget_dateflow → tap id: image_calendar',
      outcome: 'Calendar dialog opens',
    },
  ],

};

// ---------------------------------------------------------------------------
// Scenario definitions — each becomes one Maestro YAML file
// ---------------------------------------------------------------------------
interface ScenarioDefinition {
  id: string;
  priority: 'p0' | 'p1' | 'p2';
  category: 'smoke' | 'filter' | 'sort' | 'navigation' | 'interaction';
  name: string;
  description: string;
  /** Natural-language outline of what the case should do (fed to AI) */
  stepOutline: string[];
  /** What assertions must pass */
  successCriteria: string[];
}

const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'android-results-smoke',
    priority: 'p0',
    category: 'smoke',
    name: 'Search Results Page Loads',
    description: 'Deeplink directly to results page and verify flight cards appear',
    stepOutline: [
      'stopApp',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil visible id: card_result timeout: 30000',
      'assertVisible id: card_result (at least one card loaded)',
    ],
    successCriteria: [
      'text_result_title visible',
      'card_result visible (at least one card)',
    ],
  },
  {
    id: 'android-results-filter-direct',
    priority: 'p0',
    category: 'filter',
    name: 'Direct Flight Filter',
    description: 'Deeplink to results, open full filter dialog via flight_result_filter_button_title, apply Direct filter',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_filter_button_title — opens FlightResultRevampFilterDialog (Compose testTag, verified 2026-06-16)',
      'Wait for id: layout_filter_dialog (timeout: 15000)',
      'Tap id: button_direct — Direct flights toggle (flight_filter_transit_layer.xml verified)',
      'Tap id: dbwShow — Apply button (NOT tvResult — tvResult is count label only)',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Assert id: card_result visible',
    ],
    successCriteria: [
      'layout_filter_dialog opened then closed',
      'card_result still visible after filter applied',
    ],
  },
  {
    id: 'android-results-sort-cheapest',
    priority: 'p0',
    category: 'sort',
    name: 'Sort by Cheapest',
    description: 'Deeplink to results, tap flight_result_sort_button_title to open Sort tray, select Cheapest (radio_button index 0)',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_sort_button_title — sort button (Compose testTag, verified 2026-06-16). NEVER use bm_button (removed) or flight_result_v4_sort_button (not rendered)',
      'extendedWaitUntil id: layout_tray timeout: 10000 — sort tray root (XML android:id). NEVER use rbg_sort',
      'Tap id: radio_button index 0 — Cheapest (sort order: 0=Cheapest, 1=Direct first, 2=Earliest dep, 3=Latest dep, 4=Earliest arr, 5=Latest arr, 6=Shortest duration)',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Assert id: card_result visible',
    ],
    successCriteria: [
      'Sort tray opens via flight_result_sort_button_title',
      'Flight cards still visible after sort applied',
    ],
  },
  {
    id: 'android-results-select-flight',
    priority: 'p0',
    category: 'interaction',
    name: 'Select a Flight (View Fare Options)',
    description: 'Deeplink to results, tap card_result to navigate to fare selection screen',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: card_result index: 0',
      'extendedWaitUntil id: flight_summary_activity_ticket_option_section timeout: 15000 — fare selection screen',
      'Assert id: flight_summary_activity_ticket_option_section visible',
    ],
    successCriteria: [
      'flight_summary_activity_ticket_option_section visible after tapping card',
    ],
  },
  {
    id: 'android-results-back-to-search',
    priority: 'p0',
    category: 'navigation',
    name: 'Back to Search Form',
    description: 'Deeplink to results, use system back gesture',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Execute system back: - back',
      'Assert card_result no longer visible (left results page)',
    ],
    successCriteria: [
      'card_result no longer visible after back',
    ],
  },

  // ---------- P1 core coverage ----------
  {
    id: 'android-results-filter-one-stop',
    priority: 'p1',
    category: 'filter',
    name: '1-Stop Filter',
    description: 'Deeplink to results, open FULL filter dialog via flight_result_filter_button_title, tap button_one_transit',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_filter_button_title — Compose testTag, opens FlightResultRevampFilterDialog',
      'extendedWaitUntil id: layout_filter_dialog timeout: 15000',
      'Tap id: button_one_transit — 1-stop toggle (flight_filter_transit_layer.xml verified)',
      'Tap id: dbwShow — Apply button (NOT tvResult — tvResult is count label only)',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Assert id: card_result visible',
    ],
    successCriteria: ['Filter dialog closed', 'Cards still visible after 1-stop filter'],
  },
  {
    id: 'android-results-sort-fastest',
    priority: 'p1',
    category: 'sort',
    name: 'Sort by Fastest (Shortest Duration)',
    description: 'Deeplink to results, tap flight_result_sort_button_title, select radio_button index 6 (Shortest Duration)',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_sort_button_title — NEVER use bm_button (removed) or rbg_sort',
      'extendedWaitUntil id: layout_tray timeout: 10000',
      'Tap id: radio_button index 6 — Shortest Duration (sort order: 0=Cheapest, 6=Shortest duration)',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Assert id: card_result visible',
    ],
    successCriteria: ['Sort by Shortest duration applied, no crash'],
  },
  {
    id: 'android-results-airline-filter',
    priority: 'p1',
    category: 'filter',
    name: 'Airline Filter via Filter Dialog',
    description: 'Deeplink to results, open filter dialog via flight_result_filter_button_title, scroll to airline section, select first airline',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_filter_button_title — opens FlightResultRevampFilterDialog',
      'extendedWaitUntil id: layout_filter_dialog timeout: 15000',
      '- scroll — bare scroll only (exposes layer_airline below layer_transit)',
      'extendedWaitUntil id: layer_airline timeout: 10000',
      'Tap id: check_box index 0 — first airline checkbox',
      'Tap id: dbwShow — Apply button (NOT tvResult)',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Assert id: card_result visible',
    ],
    successCriteria: ['Airline filter applied, cards updated'],
  },
  {
    id: 'android-results-departure-time-filter',
    priority: 'p1',
    category: 'filter',
    name: 'Departure Morning Filter',
    description: 'Deeplink to results, open full filter dialog via flight_result_filter_button_title, scroll to time section, tap button_departure_morning',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_filter_button_title — Compose testTag, opens FlightResultRevampFilterDialog',
      'extendedWaitUntil id: layout_filter_dialog timeout: 15000',
      'scrollUntilVisible id: button_departure_morning direction: DOWN timeout: 15000 — reaches time section inside dialog',
      'Tap id: button_departure_morning',
      'Tap id: dbwShow — Apply button (NOT tvResult)',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Assert id: card_result visible',
    ],
    successCriteria: ['Morning departure filter applied, results updated'],
  },
  {
    id: 'android-results-reset-filters',
    priority: 'p1',
    category: 'filter',
    name: 'Reset All Filters',
    description: 'Deeplink to results, open full filter dialog, apply direct filter, tap tvReset to clear, apply with dbwShow',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_filter_button_title — Compose testTag, opens FlightResultRevampFilterDialog',
      'extendedWaitUntil id: layout_filter_dialog timeout: 15000',
      'Tap id: button_direct — select direct filter first so tvReset has something to clear',
      'Tap id: tvReset — Reset All button (flight_result_revamp_filter_dialog.xml verified)',
      'Tap id: dbwShow — Apply button with no filters active (NOT tvResult)',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Assert id: card_result visible',
    ],
    successCriteria: ['All filters cleared, full result set restored'],
  },
  {
    id: 'android-results-scroll',
    priority: 'p1',
    category: 'interaction',
    name: 'Scroll Through Results',
    description: 'Deeplink to results, scroll down with bare - scroll command to load more cards',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      '- scroll (bare command, NO sub-keys — Maestro 2.x does not support scroll direction/duration)',
      '- scroll',
      'Assert id: card_result still visible',
    ],
    successCriteria: ['No crash after scrolling, cards still visible'],
  },
  {
    id: 'android-results-price-calendar',
    priority: 'p1',
    category: 'interaction',
    name: 'View Price Calendar',
    description: 'Deeplink to results, tap image_calendar icon in widget_dateflow to open price calendar dialog',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'extendedWaitUntil id: widget_dateflow timeout: 10000 — date strip row (XML android:id, accessible). NEVER use flight_result_v4_date_flow_row (hallucinated)',
      'Tap id: image_calendar — calendar icon in the date strip (flight_result_dateflow_widget.xml verified)',
      'extendedWaitUntil id: calendar_navbar_close timeout: 10000 — FlightBloomCalendarDialog',
      'Assert id: calendar_navbar_close visible',
    ],
    successCriteria: ['FlightBloomCalendarDialog opens (calendar_navbar_close visible)'],
  },

  // ---------- P2 edge cases ----------
  {
    id: 'android-results-filter-multi-stop',
    priority: 'p2',
    category: 'filter',
    name: '2+ Stops Filter',
    description: 'Deeplink to results, open filter dialog via flight_result_filter_button_title, tap button_two_transit, apply',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_filter_button_title — Compose testTag. NEVER use flight_result_v4_filter_button (hallucinated)',
      'extendedWaitUntil id: layout_filter_dialog timeout: 15000',
      'Tap id: button_two_transit — flight_result_revamp_filter_transit_layer.xml verified',
      'Tap id: dbwShow — Apply button (NOT tvResult — tvResult is count label only)',
      'extendedWaitUntil id: card_result timeout: 30000',
    ],
    successCriteria: ['2+ stop filter applied; results or empty-state visible'],
  },
  {
    id: 'android-results-sort-best',
    priority: 'p2',
    category: 'sort',
    name: 'Sort: Direct Flight First',
    description: 'Deeplink to results, tap flight_result_sort_button_title, select radio_button index 1 (Direct flight first)',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_sort_button_title — NEVER use bm_button (removed from UI) or rbg_sort',
      'extendedWaitUntil id: layout_tray timeout: 10000 — NEVER use rbg_sort',
      'Tap id: radio_button index 1 — Direct flight first (sort order: 0=Cheapest, 1=Direct first, 2=Earliest dep, 3=Latest dep, 4=Earliest arr, 5=Latest arr, 6=Shortest duration)',
      'extendedWaitUntil id: card_result timeout: 30000',
    ],
    successCriteria: ['Best sort applied, no crash'],
  },
  {
    id: 'android-results-view-detail',
    priority: 'p2',
    category: 'interaction',
    name: 'View Flight Fare Options (Card Tap)',
    description: 'Deeplink to results, tap card_result, assert fare screen, back to results',
    stepOutline: [
      'stopApp — use deeplink navigation, NOT home screen',
      'openLink: traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: card_result index: 0',
      'extendedWaitUntil id: flight_summary_activity_ticket_option_section timeout: 15000',
      'Assert id: flight_summary_activity_ticket_option_section visible',
      '- back — return to results',
      'extendedWaitUntil id: card_result timeout: 15000',
    ],
    successCriteria: ['Detail view opens and back navigation works'],
  },
];

// ---------------------------------------------------------------------------
// Extended scenarios — SSR V4 multi-filter dialog, mini-tray, bug-hunt coverage
// Based on PR #40592: new tabbed filter dialog, mini-filter tray, sort tray,
// nonstop chip, filtered empty state, deeplink params.
// Enabled with --extended flag (android:online:bug-hunt workflow).
// ---------------------------------------------------------------------------
const EXTENDED_SCENARIOS: ScenarioDefinition[] = [
  // ── Tabbed Multi-Filter Dialog ───────────────────────────────────────────
  {
    id: 'android-ssrv4-filter-tab-transit',
    priority: 'p0',
    category: 'filter',
    name: 'SSR V4 Multi-Filter: Transit Tab',
    description: 'Open multi-filter dialog, navigate to Transit tab, apply Direct, verify',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for flight_result_filter_button_title (Compose testTag)',
      'Tap flight_result_filter_button_title to open the new multi-filter dialog',
      'Wait for filter dialog to appear',
      'Tap the Transit tab inside the tabbed navigation (FilterTopTabBar)',
      'Tap the Direct/Nonstop option inside the transit tab content',
      'Tap Apply/Done button to submit filter',
      'Wait for card_result to reload',
      'Assert card_result still visible',
    ],
    successCriteria: [
      'Multi-filter dialog opens from flight_result_filter_button_title',
      'Transit tab is navigable',
      'Direct filter applied and results update',
    ],
  },
  {
    id: 'android-ssrv4-filter-tab-time',
    priority: 'p0',
    category: 'filter',
    name: 'SSR V4 Multi-Filter: Departure Time Tab',
    description: 'Navigate to Time tab in multi-filter dialog, select morning departure',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Time tab in FilterTopTabBar',
      'Tap morning departure option (button_departure_morning or "Morning" chip)',
      'Tap Apply button',
      'Wait for card_result to reload',
      'Assert card_result visible',
    ],
    successCriteria: ['Time tab navigable', 'Morning filter applied without crash'],
  },
  {
    id: 'android-ssrv4-filter-tab-airlines',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Multi-Filter: Airlines Tab',
    description: 'Navigate to Airlines tab, select first airline, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Airlines tab in FilterTopTabBar',
      'Tap first airline item in the airline list',
      'Tap Apply button',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Airlines tab navigable', 'Airline filter applied, results visible'],
  },
  {
    id: 'android-ssrv4-filter-tab-price',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Multi-Filter: Price Tab',
    description: 'Open Price tab, interact with price range, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Price tab in FilterTopTabBar',
      'Scroll or swipe price range slider handle slightly to adjust min price',
      'Tap Apply button',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Price tab navigable', 'Price filter applied without crash'],
  },
  {
    id: 'android-ssrv4-filter-tab-duration',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Multi-Filter: Duration Tab',
    description: 'Open Duration tab, set max duration, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Duration tab in FilterTopTabBar',
      'Adjust the duration slider to a restrictive value',
      'Tap Apply button',
      'Wait for card_result or empty state to appear',
    ],
    successCriteria: ['Duration tab navigable', 'Duration filter applied; results or empty state shown'],
  },
  {
    id: 'android-ssrv4-filter-tab-airports',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Multi-Filter: Airports Tab',
    description: 'Open Airports tab, select an airport, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Airports tab in FilterTopTabBar',
      'Tap first departure airport option in the airports list',
      'Tap Apply button',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Airports tab navigable', 'Airport filter applied without crash'],
  },
  {
    id: 'android-ssrv4-filter-tab-facilities',
    priority: 'p2',
    category: 'filter',
    name: 'SSR V4 Multi-Filter: Facilities Tab',
    description: 'Open Facilities tab (e.g. meal, luggage), select option, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Scroll tab bar to find Facilities tab, tap it',
      'Tap first facility option (meal/luggage) in the facilities list',
      'Tap Apply button',
      'Wait for card_result or empty state',
    ],
    successCriteria: ['Facilities tab navigable', 'Facility filter applied without crash'],
  },

  // ── Mini-Filter Tray (SSR V4 — distinct from full dialog) ──────────────
  {
    id: 'android-ssrv4-mini-filter-tray-open',
    priority: 'p0',
    category: 'filter',
    name: 'SSR V4 Mini-Filter Tray Opens',
    description: 'Tap flight_result_v4_quick_filter_cell nonstop chip to open mini-tray',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for flight_result_v4_quick_filter_cell (Compose testTag, quick filter chips)',
      'Tap the "Nonstop" or first chip in flight_result_v4_quick_filter_cell',
      'Wait for bottom mini-filter tray to appear (FlightResultV4MiniFilterTray)',
      'Assert mini-filter tray visible (look for tray Apply/Done button)',
    ],
    successCriteria: ['Mini-filter tray appears on tapping nonstop chip'],
  },
  {
    id: 'android-ssrv4-mini-filter-tray-apply',
    priority: 'p0',
    category: 'filter',
    name: 'SSR V4 Mini-Filter Tray Apply',
    description: 'Open mini-filter tray, tap Apply, verify results reload',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for flight_result_v4_quick_filter_cell',
      'Tap first chip in flight_result_v4_quick_filter_cell to open mini-tray',
      'Wait for mini-filter tray (bottom sheet)',
      'Tap Apply button in the mini-tray',
      'Wait for card_result to reload',
      'Assert card_result visible',
    ],
    successCriteria: ['Mini-tray Apply triggers results reload without crash'],
  },
  {
    id: 'android-ssrv4-mini-filter-tray-dismiss',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Mini-Filter Tray Dismiss',
    description: 'Open mini-filter tray and swipe down to dismiss without applying',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for flight_result_v4_quick_filter_cell',
      'Tap first chip to open mini-tray',
      'Wait for mini-filter tray',
      'Swipe DOWN on the mini-filter tray to dismiss it',
      'Assert tray is gone; card_result still visible',
    ],
    successCriteria: ['Mini-tray dismisses on swipe down; results unchanged'],
  },

  // ── Sort Tray — SSR V4 (sort by Duration is new in PR #40592) ──────────
  {
    id: 'android-ssrv4-sort-duration',
    priority: 'p0',
    category: 'sort',
    name: 'SSR V4 Sort by Duration (Shortest)',
    description: 'Open sort tray, tap index 6 (Shortest Duration), verify reload',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_sort_button_title — opens sort tray (NEVER use bm_button: removed from UI)',
      'extendedWaitUntil id: layout_tray timeout: 10000 — sort tray root (NEVER use rbg_sort)',
      'Tap radio_button at index 6 (Shortest Duration) inside sort tray',
      'Wait for card_result to reload',
      'Assert card_result visible',
    ],
    successCriteria: ['Sort by Duration (index 6) applied; results reload without crash'],
  },
  {
    id: 'android-ssrv4-sort-arrival-earliest',
    priority: 'p1',
    category: 'sort',
    name: 'SSR V4 Sort by Earliest Arrival',
    description: 'Open sort tray, tap index 5 (Earliest Arrival), verify reload',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_sort_button_title — opens sort tray (NEVER use bm_button: removed from UI)',
      'extendedWaitUntil id: layout_tray timeout: 10000',
      'Tap radio_button at index 5 (Earliest Arrival)',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Earliest Arrival sort applied without crash'],
  },
  {
    id: 'android-ssrv4-sort-latest-departure',
    priority: 'p1',
    category: 'sort',
    name: 'SSR V4 Sort by Latest Departure',
    description: 'Open sort tray, tap index 4 (Latest Departure), verify reload',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_sort_button_title — opens sort tray (NEVER use bm_button: removed from UI)',
      'extendedWaitUntil id: layout_tray timeout: 10000',
      'Tap radio_button at index 4 (Latest Departure)',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Latest Departure sort applied without crash'],
  },
  {
    id: 'android-ssrv4-sort-direct-first',
    priority: 'p1',
    category: 'sort',
    name: 'SSR V4 Sort: Direct Flight First',
    description: 'Open sort tray, tap index 2 (Direct flight first), verify',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: card_result timeout: 30000',
      'Tap id: flight_result_sort_button_title — opens sort tray (NEVER use bm_button: removed from UI)',
      'extendedWaitUntil id: layout_tray timeout: 10000',
      'Tap radio_button at index 2 (Direct flight first)',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Direct flight first sort applied without crash'],
  },

  // ── Nonstop Chip (quick filter) ─────────────────────────────────────────
  {
    id: 'android-ssrv4-nonstop-chip',
    priority: 'p0',
    category: 'filter',
    name: 'SSR V4 Nonstop Chip Quick Filter',
    description: 'Tap Nonstop chip in flight_result_v4_quick_filter_cell, verify results',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for flight_result_v4_quick_filter_cell',
      'Scroll horizontally to find the Nonstop chip if needed',
      'Tap the Nonstop chip (flight_result_v4_quick_filter_cell at index 0 or labelled Nonstop)',
      'Wait for card_result to reload',
      'Assert card_result visible',
    ],
    successCriteria: ['Nonstop chip applies direct filter; results reload; cards visible'],
  },

  // ── Filtered Empty State ─────────────────────────────────────────────────
  {
    id: 'android-ssrv4-filter-empty-state',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Filtered Empty State',
    description: 'Apply very restrictive filters (direct + specific airline + morning) to trigger empty state',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'On Transit tab: tap Direct',
      'On Airlines tab: tap second and third airline (to be restrictive)',
      'On Time tab: tap Morning departure only',
      'Tap Apply button',
      'Wait for either card_result or empty state UI',
      'Take screenshot: test-results/android/android-ssrv4-filter-empty-state.png',
      'Assert screen shows either results or an empty/no-result view (not a crash)',
    ],
    successCriteria: [
      'Empty state UI appears gracefully (no crash)',
      'Empty state includes a "Clear filters" or "Reset" action button',
    ],
  },
  {
    id: 'android-ssrv4-empty-state-reset',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Empty State → Reset Filters',
    description: 'Trigger filtered empty state, then tap Reset button to restore results',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Apply restrictive filters to reach filtered empty state (reuse android-ssrv4-filter-empty-state precondition)',
      'When empty state appears, tap "Reset" or "Clear filters" button in empty state',
      'Wait for card_result to reload',
      'Assert card_result visible (results restored)',
    ],
    successCriteria: ['Tapping Reset from empty state restores the full result set'],
  },

  // ── Departure Time Filters (afternoon, evening) ──────────────────────────
  {
    id: 'android-ssrv4-filter-afternoon-departure',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Filter: Afternoon Departure',
    description: 'Open filter dialog, select Afternoon departure time, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Time tab',
      'Tap Afternoon departure option (button_departure_afternoon or "Afternoon" chip)',
      'Tap Apply button',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Afternoon departure filter applied; results update without crash'],
  },
  {
    id: 'android-ssrv4-filter-evening-departure',
    priority: 'p2',
    category: 'filter',
    name: 'SSR V4 Filter: Evening Departure',
    description: 'Open filter dialog, select Evening departure time, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Time tab',
      'Tap Evening departure option (button_departure_evening or "Evening" chip)',
      'Tap Apply button',
      'Wait for card_result or empty state',
    ],
    successCriteria: ['Evening departure filter applied without crash'],
  },
  {
    id: 'android-ssrv4-filter-arrival-morning',
    priority: 'p2',
    category: 'filter',
    name: 'SSR V4 Filter: Morning Arrival',
    description: 'Open filter Time tab, select Morning arrival, apply',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'Tap the Time tab',
      'Tap Morning arrival option (button_arrival_morning or arrival morning chip)',
      'Tap Apply button',
      'Wait for card_result to reload',
    ],
    successCriteria: ['Arrival time filter applied; results update without crash'],
  },

  // ── Pre-selected Filter State (Reapply Recent) ───────────────────────────
  {
    id: 'android-ssrv4-filter-reapply-previous',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Filter: Re-open Shows Previous Selection',
    description: 'Apply direct filter, re-open filter dialog, verify previous selection is retained',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'Wait for filter dialog',
      'On Transit tab: tap Direct',
      'Tap Apply button',
      'Wait for card_result reload',
      'Tap flight_result_filter_button_title again to reopen',
      'Assert the Transit tab shows Direct as pre-selected (take screenshot)',
    ],
    successCriteria: ['Previously applied filters are pre-selected when filter dialog reopens'],
  },

  // ── Multi-Filter + Sort Combination ─────────────────────────────────────
  {
    id: 'android-ssrv4-filter-sort-combo',
    priority: 'p1',
    category: 'interaction',
    name: 'SSR V4 Filter + Sort Combination',
    description: 'Apply Direct filter AND sort by cheapest — verify combined behavior',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'On Transit tab: tap Direct',
      'Tap dbwShow (Apply button)',
      'Wait for card_result reload',
      'Tap id: flight_result_sort_button_title — opens sort tray (NEVER use bm_button: removed from UI)',
      'extendedWaitUntil id: layout_tray timeout: 10000',
      'Wait for card_result reload',
      'Assert card_result visible',
      'Take screenshot: test-results/android/android-ssrv4-filter-sort-combo.png',
    ],
    successCriteria: ['Filter + sort combination works; results displayed without crash'],
  },

  // ── Date Flow Navigation ─────────────────────────────────────────────────
  {
    id: 'android-ssrv4-date-flow-navigation',
    priority: 'p1',
    category: 'interaction',
    name: 'SSR V4 Date Flow: Tap Next Day',
    description: 'Tap widget_dateflow to advance to the next day',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for widget_dateflow (Compose testTag)',
      'Scroll left on the date flow row to find tomorrow\'s date cell',
      'Tap the next-day date cell in widget_dateflow',
      'Wait for card_result to reload',
      'Assert card_result visible',
    ],
    successCriteria: ['Date navigation changes results; new results load without crash'],
  },

  // ── Flight Card Interaction ──────────────────────────────────────────────
  {
    id: 'android-ssrv4-card-price-visible',
    priority: 'p0',
    category: 'interaction',
    name: 'SSR V4 Flight Card: Price Section Visible',
    description: 'Assert card_result_price_section is visible on each card',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for card_result',
      'Assert card_result_price_section is visible on first card',
      'Assert card_result_connector_view is visible (duration/stops)',
      'Take screenshot: test-results/android/android-ssrv4-card-price-visible.png',
    ],
    successCriteria: [
      'card_result_price_section visible',
      'card_result_connector_view visible (duration/stops section)',
    ],
  },
  {
    id: 'android-ssrv4-card-tap-detail',
    priority: 'p0',
    category: 'interaction',
    name: 'SSR V4 Flight Card Tap → Detail Screen',
    description: 'Tap card_result to open detail; back to results',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for card_result',
      'Tap card_result (first card)',
      'Wait for detail screen to appear (new activity or bottom sheet)',
      'Take screenshot: test-results/android/android-ssrv4-card-detail.png',
      'Tap system back or back arrow to return',
      'Assert card_result visible again',
    ],
    successCriteria: ['Card tap opens detail; back returns to results list without crash'],
  },

  // ── Scroll & Load More ───────────────────────────────────────────────────
  {
    id: 'android-ssrv4-scroll-load-more',
    priority: 'p1',
    category: 'interaction',
    name: 'SSR V4 Scroll to Load More Results',
    description: 'Scroll down on results list multiple times to trigger pagination',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'Wait for card_result',
      'Scroll down on the results list',
      'Scroll down again',
      'Scroll down a third time',
      'Assert card_result still visible after scrolling',
    ],
    successCriteria: ['No crash while scrolling; more cards appear or list end is reached gracefully'],
  },

  // ── Filter Reset ─────────────────────────────────────────────────────────
  {
    id: 'android-ssrv4-filter-reset-all',
    priority: 'p1',
    category: 'filter',
    name: 'SSR V4 Reset All Filters',
    description: 'Apply multiple filters, then tap Reset to clear all and restore full results',
    stepOutline: [
      'stopApp — use deeplink navigation',
      'extendedWaitUntil id: flight_result_filter_button_title timeout: 15000',
      'Tap flight_result_filter_button_title',
      'On Transit tab: tap Direct',
      'On Time tab: tap Morning',
      'Tap Apply',
      'Wait for results reload',
      'Tap flight_result_filter_button_title again',
      'Tap Reset/Clear all button inside the filter dialog (tvReset or equivalent)',
      'Tap Apply button',
      'Wait for card_result reload',
      'Assert card_result visible (more results than before reset)',
    ],
    successCriteria: ['All filters cleared; full result set restored without crash'],
  },
];

// Active scenario set: base always included; extended appended with --extended
// --pending-scenarios: AI-discovered scenarios from new PR components are merged in
const PENDING_SCENARIOS: ScenarioDefinition[] = (() => {
  // 1. Explicit --pending-scenarios flag (from android-diff-workflow)
  // 2. Auto-resume: config/remaining-scenarios.json left by a previous quota-hit run
  const sourceFile = PENDING_SCENARIOS_FILE
    ?? (fs.existsSync(path.resolve('config/remaining-scenarios.json')) ? path.resolve('config/remaining-scenarios.json') : null);
  if (!sourceFile) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) as ScenarioDefinition[];
    const existingIds = new Set([...SCENARIOS, ...EXTENDED_SCENARIOS].map(s => s.id));
    const novel = raw.filter(s => !existingIds.has(s.id));
    if (novel.length) console.log(`  🔍 Merging ${novel.length} AI-discovered scenario(s) from ${sourceFile}`);
    // If resuming from remaining-scenarios.json, log that
    if (!PENDING_SCENARIOS_FILE && sourceFile.endsWith('remaining-scenarios.json')) {
      console.log(`  ⏩ Resuming ${raw.length} scenario(s) left over from previous quota-hit run`);
    }
    return raw; // include all (even existing IDs) when resuming quota leftovers
  } catch { return []; }
})();
const ACTIVE_SCENARIOS: ScenarioDefinition[] = [
  ...(EXTENDED ? [...SCENARIOS, ...EXTENDED_SCENARIOS] : SCENARIOS),
  ...PENDING_SCENARIOS,
];
function buildSystemPrompt(prdContent?: string, scenario?: ScenarioDefinition): string {
  const forbiddenIdList = FORBIDDEN_XML_IDS.map(id => {
    const replacement = COMPOSE_ID_MAP[id];
    return replacement ? `  "${id}" → use "${replacement}"` : `  "${id}" (no direct replacement)`;
  }).join('\n');

  // Build accumulative coverage context from learning memory
  const memCtx = (() => {
    const { stableScenarios, expansionQueue, coverageGaps, knownFixPatterns, totalRuns } = LEARNING_MEMORY;
    if (totalRuns === 0) return ''; // first run — no memory yet

    const lines: string[] = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `ACCUMULATIVE COVERAGE MEMORY (after ${totalRuns} workflow runs)`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ];

    if (stableScenarios.length) {
      lines.push(`STABLE SCENARIOS (confirmed passing — do NOT regress these):`);
      lines.push(stableScenarios.map(s => `  ✅ ${s}`).join('\n'));
    }

    if (expansionQueue.length) {
      lines.push('');
      lines.push('EXPANSION QUEUE (passed 3+ consecutive runs — generate deeper variants):');
      lines.push(expansionQueue.map(s => `  📈 ${s} → add variant scenarios (edge cases, combinations)`).join('\n'));
    }

    if (coverageGaps.length) {
      lines.push('');
      lines.push('COVERAGE GAPS (fewer than 2 stable scenarios in these categories — prioritize generating):');
      lines.push(coverageGaps.map(g => `  🔴 ${g}`).join('\n'));
    }

    if (knownFixPatterns.length) {
      lines.push('');
      lines.push('KNOWN FIX PATTERNS (learned from real failures — these constraints are proven correct):');
      lines.push(knownFixPatterns.map(p => `  🔧 ${p}`).join('\n'));
    }

    return '\n\n' + lines.join('\n');
  })();

  return `You are an expert mobile test engineer who writes Maestro YAML test cases for Android apps.
Maestro is a mobile UI testing framework that uses YAML-based test flows.

CRITICAL RULE — MULTI-LANGUAGE APP:
This app supports multiple languages (EN, ID, TH, etc.).
- INTERACTIONS (tapOn, longPressOn, scrollUntilVisible) MUST use resource IDs, NEVER text.
  ✅ CORRECT:  tapOn:\\n    id: "button_direct"
  ❌ WRONG:    tapOn: "Direct"
- ASSERTIONS (assertVisible, extendedWaitUntil) MAY use text, but prefer IDs when available.
  ✅ For page-loaded proof: assertVisible:\\n    id: "text_result_title"
  ✅ For content verification: assertVisible: "Direct"  (ok — you WANT to verify the text)

${'━'.repeat(67)}
STRONG CONSTRAINT — MANDATORY ID-ONLY LOCATORS + SOURCE LOOKUP
${'━'.repeat(67)}
EVERY tapOn / longPressOn / scrollUntilVisible MUST use id: sourced from android-v3.
This rule has ZERO exceptions. "I couldn't find the ID" is NOT an acceptable reason to
use text:. Follow this exact lookup procedure:

  STEP 1 — Check the VERIFIED IDs table in this prompt first.
  STEP 2 — If not listed, grep android-v3 source:
             git -C .cache/weekly-diff-repos/github.com_traveloka_android-v3 \\
               grep -r '@+id/' <module>/src/main/res/layout/ | grep <keyword>
             Or for Compose testTag:
             git -C .cache/weekly-diff-repos/github.com_traveloka_android-v3 \\
               grep -r 'testTag(' <module>/src/main/java/ | grep <keyword>
  STEP 3 — Use the exact id value found. NEVER guess or fabricate an ID.
  STEP 4 — Add a source comment: # Source: <FileName>.xml → @+id/<id>

IF an id genuinely cannot be found in source (rare Compose-only UI):
  — Use point: coordinates AS LAST RESORT only
  — Add comment: # NO ID IN SOURCE — coordinate fallback, Pixel7 1080×2400
  — Document the bounds from uiautomator dump

FORBIDDEN LOCATOR FORMS (will cause "element not found" or i18n failures):
  ❌ tapOn: "Any Text"          — i18n: text changes per locale
  ❌ tapOn:\n    text: "Any Text" — same problem
  ❌ tapOn:\n    label: "hint"   — label/hint are unreliable across app versions
  ❌ id: "guessed_id_name"       — if not in source or VERIFIED list, it does NOT exist
${'━'.repeat(67)}

CRITICAL RULE — RUNTIME ACCESSIBILITY IDs (flight search results page):
Despite Jetpack Compose migration, adb uiautomator dump (2026-06-16) shows that
card_result and text_result_title ARE visible in the accessibility tree at runtime.
The flight_result_v4_* Compose testTags are defined in source but do NOT appear
in the accessibility tree (missing semantics{} block in the Compose composables).

FORBIDDEN IDs (never use — verified NOT in accessibility tree at runtime):
${forbiddenIdList}

CORRECT IDs FOR RESULTS PAGE (runtime-verified via adb uiautomator dump 2026-06-16):
  "text_result_title"                      → results page navbar/header (XML android:id)
  "card_result"                            → each flight card (XML android:id)
  "widget_dateflow"                        → date-price calendar strip (XML android:id)
  "image_calendar"                         → calendar icon inside date strip (XML android:id)
  "flight_result_filter_button_title"      → Filter button (Compose testTag) — opens full dialog
  "flight_result_sort_button_title"        → Sort button (Compose testTag) — opens sort tray
  "layout_tray"                            → Sort tray root (XML android:id, visible after sort button tap)

STILL XML (retain their android:id and work normally):
  Filter dialog: layout_filter_dialog, layer_transit, button_direct,
                 button_one_transit, button_two_transit, tvReset, dbwShow,
                 button_departure_morning/afternoon/evening (flight_filter_time_widget.xml),
                 layer_airline, check_box (airline adapter item)
  Date strip:    widget_dateflow (row), image_calendar (calendar icon)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT A — SORT TRAY ENTRY POINT (verified 2026-06-16, actual test pass)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
bm_button (floating sort pill) has been REMOVED from the results page UI.
rbg_sort does NOT work as the sort tray ID — use layout_tray instead.

THE ONLY WAY TO OPEN THE SORT TRAY (verified working pattern):
  - tapOn:
      id: "flight_result_sort_button_title"   ← Compose testTag, verified 2026-06-16
  - extendedWaitUntil:
      visible:
        id: "layout_tray"                     ← sort tray root (XML android:id)
      timeout: 10000
  - tapOn:
      id: "radio_button"
      index: N                                ← see sort order below

SORT ORDER (FlightSortTrayWidgetPresenter.kt, scoreShown=false):
  index 0 → Cheapest (SORT_PRICE_LOWEST)
  index 1 → Direct flight first (SORT_DIRECT_FLIGHT_FIRST)
  index 2 → Earliest departure (SORT_DEPARTURE_TIME_EARLIEST)
  index 3 → Latest departure (SORT_DEPARTURE_TIME_LATEST)
  index 4 → Earliest arrival (SORT_ARRIVAL_TIME_EARLIEST)
  index 5 → Latest arrival (SORT_ARRIVAL_TIME_LATEST)
  index 6 → Shortest duration (SORT_DURATION_SHORTEST)

FORBIDDEN for sort:
  ❌ tapOn: id: "bm_button"                          ← REMOVED from UI, not in a11y tree
  ❌ tapOn: id: "flight_result_v4_sort_button"        ← not in a11y tree
  ❌ extendedWaitUntil: id: "rbg_sort"               ← use layout_tray instead
  ❌ tapOn: text: "Cheapest"                          ← i18n, also appears on flight cards
  ❌ tapOn: text: "Sort by"                           ← i18n

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT B — FILTER DIALOG ENTRY POINT (verified 2026-06-16, actual test pass)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
flight_result_v4_filter_button does NOT exist in source or a11y tree (hallucinated ID).
Use flight_result_filter_button_title (Compose testTag, confirmed working 2026-06-16).

THE ONLY WAY TO OPEN THE FULL FILTER DIALOG (FlightResultRevampFilterDialog):
  - tapOn:
      id: "flight_result_filter_button_title"   ← Compose testTag, verified 2026-06-16
  - extendedWaitUntil:
      visible:
        id: "layout_filter_dialog"
      timeout: 15000

FILTER DIALOG SECTION ORDER (flight_result_revamp_filter_dialog.xml):
  1. layer_transit   → button_direct, button_one_transit, button_two_transit (visible without scrolling)
  2. layer_airline   → check_box index N (need 1 scroll to expose)
  3. layer_time      → button_departure_morning etc. (need scrollUntilVisible to reach)
  4. layer_price     → slider_price_range
  5. layer_facilities, layer_flight_preferences, layer_flight_refund_reschedule

FORBIDDEN for filter entry:
  ❌ tapOn: id: "flight_result_v4_filter_button"      ← does NOT exist (hallucinated)
  ❌ tapOn: id: "flight_result_v4_quick_filter_cell"  ← opens Stops sheet, NOT full filter
  ❌ tapOn: id: "quick_filter_item"                   ← same problem

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT C — FILTER APPLY BUTTON (source verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
tvResult is a TextView that DISPLAYS the result count (e.g. "Show 25 results").
Tapping it does NOT close the dialog or apply the filter.
The actual clickable apply button is dbwShow (flight_result_revamp_filter_dialog.xml verified,
FlightResultRevampFilterDialog.kt binding.dbwShow.setOnClickListener confirmed).

CORRECT apply pattern:
  - tapOn:
      id: "dbwShow"            ← the ONLY correct apply button in the filter dialog
  - extendedWaitUntil:
      visible:
        id: "card_result"
      timeout: 30000

FORBIDDEN:
  ❌ tapOn: id: "tvResult"     ← count label, not a button; dialog will NOT close

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT D — SCROLLING INSIDE FILTER DIALOG (verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- scroll (bare) and swipe: direction: UP both scroll the RESULTS LIST behind the dialog,
  NOT the dialog's internal NestedScrollView.
- For any element inside the filter dialog that is below the fold (airline section,
  departure time buttons, price slider), you MUST use scrollUntilVisible.

CORRECT pattern to reach departure time section (or any deep filter section):
  - scrollUntilVisible:
      element:
        id: "button_departure_morning"
      direction: DOWN
      timeout: 15000

CORRECT pattern to reach airline section (1 scroll usually enough):
  - scroll                        ← bare scroll (moves dialog content down slightly)
  - extendedWaitUntil:
      visible:
        id: "layer_airline"
      timeout: 10000
  - tapOn:
      id: "check_box"             ← first airline checkbox (flight_filter_airline_adapter_item.xml)
      index: 0

FORBIDDEN inside filter dialog:
  ❌ - scroll\\n    direction: UP  ← sub-keys unsupported AND wrong target
  ❌ - swipe:\\n    direction: UP  ← scrolls results list, not dialog
  ❌ multiple bare - scroll steps  ← unreliable; use scrollUntilVisible for deep targets

STRONG CONSTRAINT — SORT TRAY OPTIONS (dynamically generated, NO individual IDs):
Source: FlightSortTrayWidgetPresenter.kt + MDSRadioButtonGroup.kt
The sort tray (flight_sort_tray_widget.xml) uses MDSRadioButtonGroup.setItems() to create
MDSRadioButton instances at runtime. Individual options have NO android:id whatsoever.
DO NOT use:  tapOn: text: "Cheapest"   ← breaks on i18n / copy changes
DO NOT use:  tapOn: text: "Lowest Price"
INSTEAD tap the inner radio button by stable ID + positional index:
  tapOn:
    id: "radio_button"
    index: N
Sort order (scoreShown=false, verified from FlightSortTrayWidgetPresenter.kt):
  index 0 → Cheapest           (SORT_PRICE_LOWEST)
  index 1 → Direct flight first (SORT_DIRECT_FLIGHT_FIRST)
  index 2 → Earliest departure  (SORT_DEPARTURE_TIME_EARLIEST)
  index 3 → Latest departure    (SORT_DEPARTURE_TIME_LATEST)
  index 4 → Earliest arrival    (SORT_ARRIVAL_TIME_EARLIEST)
  index 5 → Latest arrival      (SORT_ARRIVAL_TIME_LATEST)
  index 6 → Shortest duration   (SORT_DURATION_SHORTEST)
If scoreShown=true, all indices shift +1 (a "Best" option is inserted at index 0).

MAESTRO 2.x SYNTAX RULES — STRONG CONSTRAINTS (violations cause immediate runtime failure):

■ CORRECT PATTERNS:
1. Flow header:   appId: com.traveloka.android.staging  (line 1)  then  ---  (line 2)
2. Tap by ID:     - tapOn:\n        id: "view_resource_id"
3. Assert by ID:  - assertVisible:\n        id: "view_resource_id"
4. Assert text:   - assertVisible: "some text"
5. System back:   - back
6. Scroll:        - scroll              ← bare command ONLY, no sub-keys
7. Wait for ID:   - extendedWaitUntil:\n        visible:\n          id: "view_resource_id"\n        timeout: 30000
8. Conditional:   - runFlow:\n        when:\n          visible:\n            id: "some_id"\n        file: "path/to/flow.yaml"

■ FORBIDDEN — WILL CRASH IMMEDIATELY:
- runFlowIfVisible        ← does NOT exist in Maestro 2.x; use runFlow with when.visible
- tapOn: {id: "..."}      ← inline object syntax is INVALID; must use block indented id:
- tapOn:\\n    optional: true  ← 'optional' is NOT a property of tapOn; remove it
- assertVisible:\\n    timeout: 30000  ← 'timeout' sub-key is NOT supported on assertVisible
- waitForAnimationsToEnd  ← REMOVED in Maestro 2.x; delete it
- scroll:\\n    direction: DOWN  ← sub-keys NOT supported; use bare '- scroll'
- scroll:\\n    duration: 3000   ← sub-keys NOT supported; use bare '- scroll'
- swipeOn / swipe         ← use '- scroll' instead
- coordinates: [x, y]     ← hard-coded coordinates are forbidden
- tapOn: "text label"     ← ALL tapOn MUST use id:. FORBIDDEN to use text: as a locator in tapOn.
                            Home screen Flights tile: use id: "image_view_product_icon" index: 0
                            (after extendedWaitUntil id: "widget_highlighted_product")
                            For EVERY element, look up the android:id or Compose testTag from
                            android-v3 source, or from the VERIFIED IDs list in this prompt.
                            DO NOT use text: for home tile, filter chips, sort buttons, dialog items.
- tapOn:\n    text: "Direct"  ← WRONG — "Direct" appears in flight card labels too; use id: "button_direct"
- tapOn:\n    text: "Cheapest" ← WRONG — use id: "radio_button" index: 0 inside layout_tray
- tapOn:\n    text: "Sort by"  ← WRONG — use id: "flight_result_sort_button_title" to open sort tray
- tapOn:\n    id: "bm_button"  ← WRONG — bm_button REMOVED from UI. Use id: "flight_result_sort_button_title"
- tapOn:\n    id: "flight_result_v4_filter_button" ← WRONG — does not exist. Use id: "flight_result_filter_button_title"
- tapOn:\n    id: "flight_result_v4_date_flow_row" ← WRONG — does not exist. Use id: "widget_dateflow"
- launchApp / tapOn home tile / tapOn search_tab ← WRONG — FlightSearchFormV2Activity crashes on 2nd+ run.
                            ALWAYS use: stopApp → openLink traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY
- runFlow: file: "other.yaml"  ← NEVER reference external .yaml files; ALL steps must be inlined in this single file

■ VERIFIED WORKING PATTERNS (from android-all-scenarios-suite.yaml, 12/12 pass 2026-06-16):
  # CORRECT: Deeplink navigation (ALWAYS use this, NEVER use home screen tile)
  - stopApp
  - openLink:
      link: "traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY"
  - extendedWaitUntil:
      visible:
        id: "card_result"
      timeout: 30000
  # CORRECT: Open filter dialog
  - tapOn:
      id: "flight_result_filter_button_title"
  # CORRECT: Open sort tray
  - tapOn:
      id: "flight_result_sort_button_title"
  - extendedWaitUntil:
      visible:
        id: "layout_tray"
      timeout: 10000
  # CORRECT: Tap sort option by index
  - tapOn:
      id: "radio_button"
      index: 0
  # CORRECT: Assert with id (runtime-verified XML android:id)
  - assertVisible:
      id: "card_result"
  # CORRECT: Wait until element visible
  - extendedWaitUntil:
      visible:
        id: "card_result"
      timeout: 30000
  # CORRECT: Conditional flow (runFlow + when, NOT runFlowIfVisible)
  - runFlow:
      when:
        visible:
          id: "some_dismiss_button"
      file: "dismiss-overlay.yaml"
  # CORRECT: Scroll (no sub-keys)
  - scroll

11. Add comments explaining each step and its source file

Return ONLY the YAML content, no markdown fences, no explanation.${scenario && isPaymentScenario(scenario) ? buildPaymentBlueprintSection() : ''}${prdContent ? `

---
## PRD CONTEXT (from recent merged PRs — use to guide scenario generation)

The following product requirement document(s) describe recent changes merged into android-v3.
Use this to generate more relevant test scenarios that cover the described behaviors.

${prdContent.length > 6000 ? prdContent.slice(0, 6000) + '\n\n[...truncated...]' : prdContent}` : ''}${memCtx}`;
}

function buildPaymentBlueprintSection(): string {
  return `

${'━'.repeat(67)}
PAYMENT / BOOKING SCENARIO BLUEPRINT — MANDATORY CANONICAL REFERENCE
${'━'.repeat(67)}
The following YAML is the FULLY LOCKED, runtime-verified blueprint for any scenario
that involves payment, booking, credit card form, contact details, fare selection,
or the Continue-to-Payment CTA.

RULES:
  1. ALL payment-related scenarios MUST reproduce the exact same ID and step pattern
     shown below. Do NOT invent new IDs for payment pages.
  2. Phase order is MANDATORY: Fare Selection → Traveler → Contact → Booking Form
     → Enhance Your Trip interstitial → Payment CC Form → Pay.
  3. Turbulence-safe patterns (runFlow when: visible: error_button) MUST be preserved.
  4. Point-based coordinates for phone/email are device-specific (Pixel7 1080×2400)
     and must NOT be changed without a fresh uiautomator dump.
  5. The Pay button requires hideKeyboard + scroll BEFORE extendedWaitUntil.

BLUEPRINT (copy patterns exactly — IDs are uiautomator-confirmed 2026-06-16):
\`\`\`yaml
${PAYMENT_BLUEPRINT_YAML}
\`\`\``;
}

// ---------------------------------------------------------------------------
// Payment scenario detector
// ---------------------------------------------------------------------------
function isPaymentScenario(scenario: ScenarioDefinition): boolean {
  const text = [
    scenario.id,
    scenario.name,
    scenario.description,
    ...scenario.stepOutline,
  ].join(' ').toLowerCase();
  return /payment|booking|book|credit.?card|cc.?form|\bpay\b|checkout|contact.?detail|traveler|passenger|fare.select|bff_button_continue|primary_submit_button|frame_input_card_form/.test(text);
}

// ---------------------------------------------------------------------------
// Source-code ID query — greps android-v3 repo for relevant IDs before generation
// ---------------------------------------------------------------------------
function querySourceIdsForScenario(scenario: ScenarioDefinition): string {
  const REPO = path.join(process.cwd(), '.cache/weekly-diff-repos/github.com_traveloka_android-v3');
  if (!fs.existsSync(REPO)) return '(android-v3 repo not cloned — skipping source query)';

  // Build keyword list from scenario name + stepOutline
  const keywords = [
    scenario.name,
    ...scenario.stepOutline,
    scenario.description,
  ].join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4 && !['flight', 'results', 'screen', 'visible', 'assert', 'navigate', 'android', 'return', 'should', 'using', 'after', 'button', 'swipe', 'scroll'].includes(w));

  const uniqueKeywords = [...new Set(keywords)].slice(0, 6);
  if (uniqueKeywords.length === 0) return '';

  try {
    // Grep android-v3 flight layout XMLs for @+id values in relevant files
    const grepPattern = uniqueKeywords.join('|');
    const grepCmd = `grep -rl "${grepPattern}" "${REPO}/flight/src/main/res/layout" 2>/dev/null | head -5`;
    const relevantFiles = execSync(grepCmd, { encoding: 'utf8', timeout: 10000 }).trim();
    if (!relevantFiles) return '';

    // Extract all @+id values from the matched files
    const idCmd = `echo "${relevantFiles}" | xargs grep -h '@+id/' 2>/dev/null | grep -oE '@\\+id/[^"]+' | sort -u | head -40`;
    const rawIds = execSync(idCmd, { encoding: 'utf8', timeout: 10000 }).trim();
    const ids = rawIds.split('\n').map((l) => l.replace('@+id/', '').trim()).filter(Boolean);
    if (ids.length === 0) return '';
    return ids.join(', ');
  } catch {
    return '';
  }
}

function buildUserPrompt(context: AndroidSourceContext, scenario: ScenarioDefinition): string {
  // Query android-v3 source for scenario-specific IDs at generation time
  const sourceQueryIds = querySourceIdsForScenario(scenario);
  const accessibilityIdsList = Object.entries(context.accessibilityIds)
    .map(([name, id]) => `  ${name}: "${id}"`)
    .join('\n');

  return `Generate a Maestro YAML test case for this scenario.

## App Context
AppId: ${context.appId}
Screen: ${context.screen}

## How to Reach This Screen (Precondition — copy EXACTLY, do not modify)
${context.precondition.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## VERIFIED ACCESSIBILITY IDs — USE THESE, DO NOT GUESS
These IDs are confirmed present in the Android Accessibility tree (UIAutomator-verified + source-audited).
RULE: ALL tapOn and assertVisible MUST use id: from this list or from Source Query below.
NEVER invent an id that is not listed here.
\`\`\`
${accessibilityIdsList}
\`\`\`

## Source Query — IDs found in android-v3 source for this scenario
(These are android:id values from the relevant XML layout files. Use these for filter/tray/dialog interactions.)
${sourceQueryIds || '(no additional source IDs found)'}

## Known Interaction Patterns
${context.interactions.map((i) => `- ${i.name}: trigger="${i.trigger}" → "${i.outcome}"`).join('\n')}

## Scenario to Generate
ID: ${scenario.id}
Name: ${scenario.name}
Description: ${scenario.description}
Priority: ${scenario.priority}

## Steps to Implement
${scenario.stepOutline.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Success Criteria (must be verified by assertVisible or equivalent)
${scenario.successCriteria.map((c) => `- ${c}`).join('\n')}

Generate the complete Maestro YAML test case now:`;
}

// ---------------------------------------------------------------------------
// AI call with retry
// ---------------------------------------------------------------------------

// Thrown when GitHub Models 429 quota is exhausted — signals main() to stop
// generating and save remaining scenarios for the next run.
class QuotaExhaustedError extends Error {
  constructor(msg: string) { super(msg); this.name = 'QuotaExhaustedError'; }
}

async function generateYaml(
  context: AndroidSourceContext,
  scenario: ScenarioDefinition,
  prdContent?: string,
  retries = 3
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000); // 90s per call
      let response;
      try {
        response = await openai.chat.completions.create({
          model: MODEL,
          temperature: 0,
          messages: [
            { role: 'system', content: buildSystemPrompt(prdContent, scenario) },
            { role: 'user', content: buildUserPrompt(context, scenario) },
          ],
        }, { signal: controller.signal as AbortSignal });
      } finally {
        clearTimeout(timer);
      }
      const content = response.choices[0]?.message?.content ?? '';
      // Strip any accidental markdown fences
      return content
        .replace(/^```ya?ml\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 429 quota exhausted — stop immediately, no retry, let main() save remaining scenarios
      if (/429|rate.?limit|quota/i.test(msg)) {
        throw new QuotaExhaustedError(msg);
      }
      if (attempt < retries) {
        // Parse "Please wait N seconds" from GitHub Models 429 response
        const waitMatch = msg.match(/wait\s+(\d+)\s+second/i);
        const waitMs = waitMatch ? (parseInt(waitMatch[1], 10) + 2) * 1000 : 2000 * (attempt + 1);
        console.warn(`  [retry ${attempt + 1}] ${msg}`);
        console.warn(`  [rate-limit] Waiting ${Math.round(waitMs / 1000)}s before retry...`);
        await sleep(waitMs);
      } else {
        throw new Error(`AI generation failed after ${retries + 1} attempts: ${msg}`);
      }
    }
  }
  throw new Error('unreachable');
}

// ---------------------------------------------------------------------------
// YAML validation — includes Compose ID enforcement
// ---------------------------------------------------------------------------
function validateYaml(yaml: string, scenario: ScenarioDefinition): string[] {
  const warnings: string[] = [];
  if (!yaml.includes(`appId: ${APP_ID}`)) warnings.push(`Missing appId: ${APP_ID}`);
  if (!yaml.includes('---')) warnings.push('Missing --- separator');
  if (!yaml.includes('assertVisible') && !yaml.includes('extendedWaitUntil'))
    warnings.push('No assertions found — case may not verify anything');
  if (yaml.includes('coordinates:') || /\(\d+,\s*\d+\)/.test(yaml))
    warnings.push('Hard-coded coordinates detected — remove them');

  // ── MAESTRO 2.x FORBIDDEN COMMANDS ──────────────────────────────────────
  // These patterns are confirmed to cause immediate runtime failures.
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/runFlowIfVisible/,              'SYNTAX_ERROR: runFlowIfVisible does not exist in Maestro 2.x → use "runFlow" with "when.visible"'],
    [/optional:\s*true/,              'SYNTAX_ERROR: "optional: true" is not a valid tapOn property in Maestro 2.x → remove it'],
    [/assertVisible:\s*\n\s+timeout/, 'SYNTAX_ERROR: assertVisible does not support a timeout sub-key in Maestro 2.x → use extendedWaitUntil instead'],
    [/waitForAnimationsToEnd/,        'SYNTAX_ERROR: waitForAnimationsToEnd was removed in Maestro 2.x → delete this line'],
    [/scroll:\s*\n\s+direction/,      'SYNTAX_ERROR: scroll does not support direction sub-key in Maestro 2.x → use bare "- scroll"'],
    [/scroll:\s*\n\s+duration/,       'SYNTAX_ERROR: scroll does not support duration sub-key in Maestro 2.x → use bare "- scroll"'],
    [/swipeOn|swipe:/,                'SYNTAX_ERROR: swipeOn/swipe not supported → use "- scroll"'],
    [/tapOn:\s+"[^"]+"/,              'ID_REQUIRED: tapOn with inline text string is forbidden (i18n app). Look up the android:id or Compose testTag in android-v3 source and use id: block'],
    // ── STRONG CONSTRAINT: id-only locators — text:/label: are forbidden in tapOn ──
    [/tapOn:\s*\n\s+text:\s*"/,
      'ID_REQUIRED: tapOn with text: sub-key is forbidden (i18n — text changes per locale). ' +
      'Lookup procedure: (1) check VERIFIED IDs table in this prompt, (2) grep android-v3 source for @+id/<keyword> or testTag(<keyword>), (3) use exact id: value found. NEVER use text: as a tapOn locator.'],
    [/tapOn:\s*\n\s+label:\s*"/,
      'ID_REQUIRED: tapOn with label: sub-key is forbidden (labels are i18n and unreliable across app versions). ' +
      'Use id: sourced from android-v3 layout XML or Compose testTag.'],
    [/longPressOn:\s*\n\s+text:\s*"/,
      'ID_REQUIRED: longPressOn with text: sub-key is forbidden. Use id: sourced from android-v3 source.'],
    [/scrollUntilVisible:\s*\n\s+element:\s*\n\s+text:\s*"/,
      'ID_REQUIRED: scrollUntilVisible element text: is forbidden. Use element: id: sourced from android-v3 source.'],
    [/file:\s*["'][^"']+\.yaml["']/,  'SYNTAX_ERROR: runFlow with external file: reference is forbidden — inline all steps directly in this file'],
    // ── STRONG CONSTRAINT: Navigation — ALWAYS use deeplink ─────────────────
    // Verified 2026-06-16: home screen tile navigation causes FlightSearchFormV2Activity crash on 2nd+ run
    [/launchApp/,
      'NAV_ERROR: launchApp triggers home screen navigation which crashes FlightSearchFormV2Activity on 2nd+ run. ' +
      'Use: stopApp → openLink traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY → extendedWaitUntil id: "card_result"'],
    // ── STRONG CONSTRAINT A: Sort tray entry ─────────────────────────────────
    // Verified 2026-06-16: bm_button removed from UI, rbg_sort not accessible
    [/id:\s*["']?bm_button["']?/,
      'SORT_ENTRY_ERROR: bm_button has been REMOVED from the results page UI. ' +
      'Use: tapOn id: "flight_result_sort_button_title" → extendedWaitUntil id: "layout_tray" → tapOn id: "radio_button" index: N'],
    [/id:\s*["']?rbg_sort["']?/,
      'SORT_TRAY_ERROR: rbg_sort is not the correct sort tray ID. ' +
      'Use: extendedWaitUntil id: "layout_tray" (sort tray root, XML android:id, accessible 2026-06-16)'],
    [/id:\s*["']?flight_result_v4_sort_button["']?/,
      'SORT_BUTTON_ERROR: flight_result_v4_sort_button does not exist in a11y tree (shouldDisplaySortButtonInNavbar=false). ' +
      'Use: tapOn id: "flight_result_sort_button_title"'],
    // ── STRONG CONSTRAINT B: Filter dialog entry ─────────────────────────────
    // Verified 2026-06-16: flight_result_v4_filter_button is a hallucinated ID (doesn't exist)
    [/id:\s*["']?flight_result_v4_filter_button["']?/,
      'FILTER_ENTRY_ERROR: flight_result_v4_filter_button does NOT exist in source or a11y tree (hallucinated ID). ' +
      'Use: tapOn id: "flight_result_filter_button_title" (Compose testTag, verified 2026-06-16)'],
    [/id:\s*["']?(?:flight_result_v4_quick_filter_cell|quick_filter_item)["']?/,
      'FILTER_ENTRY_WARNING: quick_filter_cell/quick_filter_item opens the Stops bottom sheet, NOT the full filter dialog. ' +
      'Use: tapOn id: "flight_result_filter_button_title" for the full FlightResultRevampFilterDialog.'],
    // ── STRONG CONSTRAINT: Date strip ────────────────────────────────────────
    // Verified 2026-06-16: flight_result_v4_date_flow_row is a hallucinated ID (doesn't exist)
    [/id:\s*["']?flight_result_v4_date_flow_row["']?/,
      'DATE_STRIP_ERROR: flight_result_v4_date_flow_row does NOT exist in source or a11y tree (hallucinated ID). ' +
      'Use: id: "widget_dateflow" (date strip row) and id: "image_calendar" (calendar icon)'],
    // ── STRONG CONSTRAINT C: Apply button ────────────────────────────────────
    [/tapOn:\s*\n\s+id:\s*["']?tvResult["']?/,
      'FILTER_APPLY_ERROR: tvResult is a count display label ("Show 25 results"), NOT a clickable apply button. ' +
      'The dialog will NOT close. Use: tapOn id: "dbwShow" to apply the filter.'],
    // ── STRONG CONSTRAINT D: Scrolling inside dialog ──────────────────────────
    [/swipe:\s*\n\s+direction:\s*(UP|DOWN)/,
      'DIALOG_SCROLL_ERROR: swipe: direction: UP/DOWN scrolls the results list, NOT the dialog content. ' +
      'Use scrollUntilVisible for elements inside filter dialog below fold.'],
  ];

  for (const [pattern, message] of forbiddenPatterns) {
    if (pattern.test(yaml)) warnings.push(message);
  }

  // ── FORBIDDEN ID ENFORCEMENT ─────────────────────────────────────────────
  // All IDs in FORBIDDEN_XML_IDS are confirmed non-working at runtime (2026-06-16).
  // Any generated YAML using them will always fail with "element not found".
  for (const forbiddenId of FORBIDDEN_XML_IDS) {
    const pattern = new RegExp(`id:\\s*["']?${forbiddenId}["']?`);
    if (pattern.test(yaml)) {
      const replacement = COMPOSE_ID_MAP[forbiddenId];
      const hint = replacement ? ` → use "${replacement}" instead` : ' (no replacement — remove this step)';
      warnings.push(
        `FORBIDDEN_ID_ERROR: id "${forbiddenId}" is confirmed non-working at runtime (verified 2026-06-16).${hint}`
      );
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n🤖 Android Maestro Case Generator`);
  console.log(`   Auth   : ${AUTH_SOURCE}`);
  console.log(`   Model  : ${MODEL}`);
  console.log(`   Output : ${OUTPUT_DIR}`);
  console.log(`   Scenarios: ${ACTIVE_SCENARIOS.length}${EXTENDED ? ' (extended)' : ''}`);
  console.log(`   Dry run: ${DRY_RUN}\n`);

  // Load source context
  let context: AndroidSourceContext = DEFAULT_SOURCE_CONTEXT;
  if (SOURCE_JSON) {
    try {
      context = JSON.parse(fs.readFileSync(SOURCE_JSON, 'utf8')) as AndroidSourceContext;
      console.log(`✅ Loaded source context from: ${SOURCE_JSON}`);
    } catch {
      console.warn(`⚠️  Could not load ${SOURCE_JSON}, using default context`);
    }
  }

  // Load PRD context (from recent merged PRs via android-diff-workflow)
  let prdContent: string | undefined;
  if (PRD_FILE) {
    try {
      prdContent = fs.readFileSync(PRD_FILE, 'utf8');
      console.log(`✅ Loaded PRD context from: ${PRD_FILE} (${prdContent.length} chars)`);
    } catch {
      console.warn(`⚠️  Could not load PRD file: ${PRD_FILE} — proceeding without PRD context`);
    }
  }

  if (!DRY_RUN) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const manifest: Array<{
    id: string;
    priority: string;
    category: string;
    name: string;
    file: string;
    generatedAt: string;
    warnings: string[];
  }> = [];

  let generated = 0;
  let skipped = 0;
  let quotaHit = false;
  const remainingScenarios: ScenarioDefinition[] = [];
  const startTime = Date.now();
  // Generate individual YAML files for each scenario (one file = one flow)
  const suiteChunks: string[] = [];
  const individualFiles: Array<{ id: string; file: string }> = [];

  for (const scenario of ACTIVE_SCENARIOS) {
    // Quota was exhausted by a previous scenario — collect remaining without attempting
    if (quotaHit) {
      remainingScenarios.push(scenario);
      continue;
    }

    process.stdout.write(`  [${scenario.priority.toUpperCase()}] ${scenario.name} … `);

    if (DRY_RUN) {
      console.log('(dry-run skipped)');
      skipped++;
      continue;
    }

    try {
      const scenarioStart = Date.now();
      const yaml = await generateYaml(context, scenario, prdContent);
      const elapsed = ((Date.now() - scenarioStart) / 1000).toFixed(1);
      const warnings = validateYaml(yaml, scenario);

      // Write individual YAML file for this scenario
      const individualFile = path.join(OUTPUT_DIR, `${scenario.id}.yaml`);
      const yamlWithName = yaml.replace(
        /^(appId:[^\n]+)/m,
        `$1\nname: ${scenario.id}`
      );
      fs.writeFileSync(individualFile, yamlWithName, 'utf8');
      individualFiles.push({ id: scenario.id, file: individualFile });

      // Also accumulate for combined suite (for reference only)
      suiteChunks.push(`# === ${scenario.priority.toUpperCase()}: ${scenario.name} ===\n${yamlWithName}`);

      const relFile = path.relative(process.cwd(), individualFile);
      manifest.push({
        id: scenario.id,
        priority: scenario.priority,
        category: scenario.category,
        name: scenario.name,
        file: relFile,
        generatedAt: new Date().toISOString(),
        warnings,
      });

      if (warnings.length > 0) {
        console.log(`⚠️  (${elapsed}s) — warnings: ${warnings.join('; ')}`);
      } else {
        console.log(`✅ (${elapsed}s)`);
      }
      generated++;
      // Throttle between requests to stay within GitHub Models 60k tokens/min limit
      if (githubToken) await sleep(6000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof QuotaExhaustedError) {
        console.log(`⏸  QUOTA EXHAUSTED — stopping generation. Remaining scenarios saved for next run.`);
        quotaHit = true;
        remainingScenarios.push(scenario);
        continue;
      }
      console.log(`❌ FAILED: ${msg}`);
      manifest.push({
        id: scenario.id,
        priority: scenario.priority,
        category: scenario.category,
        name: scenario.name,
        file: `${scenario.id}.yaml`,
        generatedAt: new Date().toISOString(),
        warnings: [`GENERATION_FAILED: ${msg}`],
      });
      skipped++;
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Save remaining scenarios for next run if quota was exhausted mid-generation
  const REMAINING_PATH = path.resolve('config/remaining-scenarios.json');
  if (!DRY_RUN) {
    if (remainingScenarios.length > 0) {
      fs.writeFileSync(REMAINING_PATH, JSON.stringify(remainingScenarios, null, 2), 'utf8');
      console.log(`\n⏸  Quota hit \u2014 ${remainingScenarios.length} scenario(s) saved to ${REMAINING_PATH} for next run.`);
    } else if (fs.existsSync(REMAINING_PATH)) {
      // All scenarios completed \u2014 clear the remaining file
      fs.unlinkSync(REMAINING_PATH);
    }
  }

  if (!DRY_RUN) {
    // Write combined suite file (for reference/multi-doc compatibility)
    const suiteHeader = [
      `# Auto-generated Android Maestro Suite`,
      `# Generated: ${new Date().toISOString()}`,
      `# ${generated} cases covering flight search results`,
      `# NOTE: Individual YAML files (<caseId>.yaml) are the primary execution method`,
      `#   This file is for reference and multi-document compatibility only.`,
    ].join('\n');
    fs.writeFileSync(SUITE_PATH, `${suiteHeader}\n\n${suiteChunks.join('\n---\n\n')}\n`, 'utf8');

    // Write manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

    // run-all points to the individual flow runner (not the multi-doc suite)
    const runAllContent = [
      `# Auto-generated Android Maestro run-all`,
      `# Generated: ${new Date().toISOString()}`,
      `# NOTE: The individual <caseId>.yaml files in 'generated/' are executed sequentially`,
      `# This file is for reference only.`,
      `appId: ${APP_ID}`,
      '---',
      '',
      `- runFlow: generated/android-suite.yaml`,
    ].join('\n');
    fs.writeFileSync(RUN_ALL_PATH, runAllContent, 'utf8');

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ Generated  : ${generated} / ${ACTIVE_SCENARIOS.length} cases${EXTENDED ? ' (extended)' : ''}`);
    console.log(`⚠️  Skipped    : ${skipped}`);
    if (quotaHit) console.log(`⏸  Quota hit  : ${remainingScenarios.length} remaining → config/remaining-scenarios.json`);
    console.log(`⏱  Total time : ${totalElapsed}s`);
    console.log(`📦 Individual files : ${OUTPUT_DIR}/<caseId>.yaml (${generated} files)`);
    console.log(`📦 Suite file : ${SUITE_PATH} (reference only)`);
    console.log(`📋 Manifest   : ${MANIFEST_PATH}`);
    console.log(`▶️  Run all    : maestro test ${RUN_ALL_PATH}`);
    console.log(`${'─'.repeat(60)}\n`);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('\n❌ Generator error:', err);
  process.exit(1);
});
