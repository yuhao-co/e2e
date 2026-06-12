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

/** Old XML android:id values that NO LONGER exist in the Accessibility tree */
const FORBIDDEN_XML_IDS: string[] = [
  // flight_result_revamp_activity.xml — migrated to Compose
  'result_container',
  'inventory_parent_layout',
  'filter_non_sticky',
  'filter_non_sticky_fill',
  'widget_dateflow',
  'layout_navigation',
  'text_result_title',
  'text_result_subtitle',
  'image_arrow_back',
  'image_change_search',
  // flight_result_card.xml — migrated to Compose
  'card_result',
  'text_departure_time',
  'text_arrival_time',
  'text_displayed_price',
  'text_flight_name',
  'text_number_of_transit',
  'tv_duration_transit',
  // sort/filter composite — Compose, NOT in a11y tree
  'layout_tray',
  'rbg_sort',
  // ── VERIFIED BROKEN (adb uiautomator dump 2026-06-12) ─────────────────────
  // flight_result_v4_sort_button: shouldDisplaySortButtonInNavbar=false in staging
  //   → button never rendered; sort MUST be opened via bm_button (floating pill)
  'flight_result_v4_sort_button',
  // quick_filter_item / quick_filter_cell: opens STOPS bottom sheet only,
  //   NOT the full FlightResultRevampFilterDialog.
  //   layout_filter_dialog will NEVER appear after tapping these.
  //   Always use flight_result_v4_filter_button for the full filter dialog.
  'quick_filter_item',
  // tvResult: is a count DISPLAY label (e.g. "25 results"), NOT a clickable button.
  //   Tapping it does NOT close the filter dialog or apply the filter.
  //   Always use dbwShow to apply/close the filter dialog.
  'tvResult',
  // date flow items — no testTag on individual items
  'text_date',
  'text_price',
  // card detail dialog — verify before use
  'dialog_toolbar',
  'bSelect',
];

/**
 * Canonical mapping: old XML android:id → new Compose testTag
 * Use these in generated YAML files.
 * Source: flight/src/main/java/com/traveloka/android/flight/ui/searchresult/v4/route/view/
 */
const COMPOSE_ID_MAP: Record<string, string> = {
  // flight_result_revamp_activity.xml → Compose
  result_container:        'flight_result_v4_navbar_toolbar_title',
  inventory_parent_layout: 'flight_result_v4_inventory_card',
  card_result:             'flight_result_v4_inventory_card',
  filter_non_sticky:       'flight_result_v4_filter_button',
  widget_dateflow:         'flight_result_v4_date_flow_row',
  text_result_title:       'flight_result_v4_navbar_toolbar_title',
  image_change_search:     'flight_result_v4_navbar_toolbar_subtitle_chevron',
  // ── SORT TRAY (adb dump verified 2026-06-12) ─────────────────────────────
  // layout_tray / rbg_sort appear in Sort tray XML but are NOT in a11y tree.
  // flight_result_v4_sort_button never renders (shouldDisplaySortButtonInNavbar=false in staging).
  // CORRECT approach: tap bm_button (floating pill) → wait rbg_sort → tap radio_button index N
  // Sort indices (confirmed from adb uiautomator dump while Sort tray open):
  //   index 0 → Cheapest            index 1 → Shortest duration
  //   index 2 → Direct flights first index 3 → Earliest departure
  //   index 4 → Latest departure     index 5 → Earliest arrival
  //   index 6 → Latest arrival
  layout_tray:             'bm_button',   // entry point for sort tray
  rbg_sort:                'bm_button',   // entry point for sort tray
  flight_result_v4_sort_button: 'bm_button',
  // ── FILTER DIALOG (adb dump verified 2026-06-12) ─────────────────────────
  // quick_filter_item / quick_filter_cell → opens Stops bottom sheet ONLY
  //   (uses check_box + button_apply_filter pattern, NOT the full filter dialog)
  // CORRECT entry: flight_result_v4_filter_button → opens FlightResultRevampFilterDialog
  //   (layout_filter_dialog with button_direct, button_one_transit, dbwShow, tvReset)
  quick_filter_item:       'flight_result_v4_filter_button',
  // tvResult is a count label ("25 results"), NOT the apply button.
  // CORRECT apply button: dbwShow  (flight_result_revamp_filter_dialog.xml verified)
  tvResult:                'dbwShow',
  // NOT Compose-migrated (XML IDs still valid in filter dialog):
  //   layout_filter_dialog, layer_transit, button_direct, button_one_transit, button_two_transit,
  //   button_departure_morning (in flight_filter_time_widget.xml — use scrollUntilVisible to reach),
  //   layer_airline, check_box (airline adapter item), tvReset, dbwShow
  //   search_tab, btn_search, layout_search_form
  //   bm_button (floating sort pill — Compose testTag, confirmed in a11y tree)
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
  /** Text labels visible on screen, keyed by section */
  textLabels: Record<string, string[]>;
  /** RN testID / accessibilityLabel values */
  accessibilityIds: Record<string, string>;
  /** Enum/option values (filter values, sort values) */
  enums: Record<string, string[]>;
  /** Interactive affordances with description */
  interactions: Array<{ name: string; trigger: string; outcome: string }>;
  /** API calls the screen makes (for waitForResponse hints) */
  apiEndpoints?: string[];
}

const DEFAULT_SOURCE_CONTEXT: AndroidSourceContext = {
  appId: APP_ID,
  screen: 'Flight Search Results',

  precondition: [
    '- launchApp',
    '- tapOn:\n    text: "Flights"      # Home screen product tile has NO android:id — text match is the ONLY contract',
    '- assertVisible:\n    id: "search_tab"',
    '- tapOn:\n    id: "search_tab"',
    '- assertVisible:\n    id: "btn_search"',
    '- tapOn:\n    id: "btn_search"     # btn_search is the blue Search CTA (hangar_widget.xml line 209)',
    '- assertVisible:\n    id: "flight_result_v4_navbar_toolbar_title"',
    '- extendedWaitUntil:\n    visible:\n      id: "flight_result_v4_inventory_card"\n    timeout: 30000',
  ],

  // Text labels: ONLY use these for assertVisible (language-specific assertions).
  // NEVER use these in tapOn — use viewIds instead.
  textLabels: {
    // Locale: EN-SG (Singapore). Will differ in ID/TH locales.
    filterChips: ['Direct', '1 Stop', '2+ Stops', 'Airline', 'Price', 'Departure Time'],
    sortOptions: ['Cheapest', 'Fastest', 'Best'],
    filterSheet: ['Apply', 'Reset'],
  },

  // ── COMPOSE semantic testTags (flight search results v4) ─────────────────
  // Source: traveloka/android-v3 → flight/src/main/java/…/searchresult/v4/route/view/
  // Audited: 2026-06-11 via `git grep testTag`
  // ⚠️  The results page is fully Compose. Old android:id values (result_container,
  //    card_result, inventory_parent_layout, widget_dateflow, etc.) do NOT exist
  //    in the Accessibility tree. Always use the flight_result_v4_* IDs below.
  accessibilityIds: {
    // ── Results page: COMPOSE IDs (FlightResultV4*) ──────────────────────────
    // FlightResultV4NavbarView.kt
    navbarTitle:            'flight_result_v4_navbar_toolbar_title',       // route header (SIN→CGK)
    navbarChevron:          'flight_result_v4_navbar_toolbar_subtitle_chevron', // change-search
    navbarPriceAlert:       'flight_result_v4_navbar_price_alert_icon',

    // FlightResultV4SortAndFilterView.kt
    filterButton:           'flight_result_v4_filter_button',              // opens filter dialog (Compose testTag, in UIAutomator dump)
    // sortButton:          'flight_result_v4_sort_button'  ← ONLY in navbar when shouldDisplaySortButtonInNavbar=true
    // When shouldDisplaySortButtonInNavbar=false (staging), the floating pill is used instead:
    sortButtonPill:         'bm_button',                                   // Bloom DS pill — ONLY 1 instance on results page (UIAutomator dump confirmed)
    quickFilterCell:        'flight_result_v4_quick_filter_cell',          // Stops/Airlines/Time chips (Compose testTag)

    // FlightResultV4DateFlowComposeView.kt (testTag on ROW container, not individual dates)
    dateFlowRow:            'flight_result_v4_date_flow_row',              // price calendar strip
    // ⚠️  Individual date items have NO testTag — use text: "Sat, 13 Jun" for taps

    // FlightResultV4InventoryCardComposeView.kt
    inventoryCard:          'flight_result_v4_inventory_card',             // each flight card
    cardPriceSection:       'flight_result_v4_inventory_card_price_section',
    cardConnector:          'flight_result_v4_inventory_card_connector_view', // duration/stops
    cardAirlineSection:     'flight_result_v4_inventory_card_airline_logo_and_baggage_section',
    topPickCampaign:        'flight_result_v4_top_pick_campaign_container',

    // ── Filter dialog: STILL XML (flight_result_revamp_filter_dialog.xml) ────
    filterDialog:           'layout_filter_dialog',
    filterClose:            'ivClose',
    filterReset:            'tvReset',
    filterApply:            'dbwShow',   // "Show X results" button
    filterTransitLayer:     'layer_transit',
    filterAirlineLayer:     'layer_airline',
    filterTimeLayer:        'layer_time',
    filterPriceLayer:       'layer_price',

    // flight_result_revamp_filter_transit_layer.xml
    filterDirect:           'button_direct',
    filterOneStop:          'button_one_transit',
    filterTwoStop:          'button_two_transit',

    // flight_filter_time_layer.xml  (verify before use — not yet UIAutomator-confirmed)
    filterDepartMorning:    'button_departure_morning',
    filterDepartAfternoon:  'button_departure_afternoon',
    filterDepartEvening:    'button_departure_evening',

    // ── Sort tray: STILL XML (flight_sort_tray_widget.xml) ────────────────────
    // Opened by tapping bm_button (sort pill on results page)
    sortTray:               'layout_tray',                                 // tray root
    sortRadioGroup:         'rbg_sort',                                    // RadioButtonGroup container
    // Sort options in sort tray: tap radio_button by index (UIAutomator dump confirmed)
    // radio_button index 0 = LOWEST_PRICE (Cheapest)
    // radio_button index 1 = EARLIEST_DEPARTURE
    // radio_button index 2 = LATEST_DEPARTURE
    // radio_button index 3 = SHORTEST_DURATION
    // ⚠️  flight_filter_radiobutton_layout is NOT in the accessibility tree — use radio_button instead
    sortOptionRadio:        'radio_button',                                // each sort option row

    // ── Fare selection screen (after tapping flight_result_v4_inventory_card) ────
    // UIAutomator dump 2026-06-11 confirmed IDs:
    fareTicketSection:      'flight_summary_activity_ticket_option_section',    // fare options section root
    fareTicketContainer:    'flight_summary_activity_ticket_option_selection_container',
    farePriceDisplay:       'flight_ticketOptionPriceDisplay',                  // price shown per option
    fareBenefitSection:     'flight_ticketOptionBenefit_section',
    fareSegmentInfo:        'flight_summary_segment_info_container',
    fareButtonDetail:       'button_detail',
    // ⚠️  ticket_option_card_container is NOT in the accessibility tree — use flight_summary_activity_ticket_option_section

    // ── Search form: STILL XML (flight_search_form_activity.xml) ─────────────
    searchTab:              'search_tab',
    searchButton:           'btn_search',
    searchFormLayout:       'layout_search_form',
  },

  enums: {
    stops: ['Direct', '1 Stop', '2+ Stops'],
    sort: ['Cheapest', 'Fastest', 'Best'],
  },

  interactions: [
    {
      name: 'Apply Direct Filter (via filter dialog)',
      trigger: 'Tap flight_result_v4_filter_button to open full filter dialog, then tap button_direct, then tap dbwShow',
      outcome: 'Only direct flights in result list; card tv_duration_transit shows "Direct"',
    },
    {
      name: 'Apply 1-Stop Filter (via filter dialog)',
      trigger: 'Tap flight_result_v4_filter_button → wait layout_filter_dialog → tap button_one_transit → tap dbwShow',
      outcome: 'Cards show 1-stop flights',
    },
    {
      name: 'Sort Cheapest',
      trigger: 'Tap bm_button (floating pill) → wait rbg_sort → tap radio_button index 0 (Cheapest)',
      outcome: 'Results reload sorted by price ascending',
    },
    {
      name: 'Sort Fastest',
      trigger: 'Tap bm_button (floating pill) → wait rbg_sort → tap radio_button index 1 (Shortest duration)',
      outcome: 'Results reload sorted by duration ascending',
    },
    {
      name: 'Open Full Filter Sheet',
      trigger: 'Tap flight_result_v4_filter_button — NOT quick_filter_cell (that opens Stops sheet only)',
      outcome: 'layout_filter_dialog becomes visible with all filter sections',
    },
    {
      name: 'Reset Filters',
      trigger: 'Inside filter dialog, tap tvReset (top toolbar)',
      outcome: 'All filter selections cleared; tap dbwShow (NOT tvResult) to apply',
    },
    {
      name: 'View Flight Detail',
      trigger: 'Tap flight_result_v4_inventory_card (Compose) on a card',
      outcome: 'Detail screen or bottom sheet opens showing full flight info',
    },
    {
      name: 'Back to Search',
      trigger: 'System back gesture (swipeRight from left edge) or tap search_tab',
      outcome: 'Returns to search form',
    },
    {
      name: 'Scroll Results',
      trigger: 'Swipe UP on flight_result_v4_navbar_toolbar_title (Compose)',
      outcome: 'More flight cards visible',
    },
  ],

  apiEndpoints: [
    '/v3/flight/search/results',
    '/v3/flight/search/filter',
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
    description: 'Navigate from home → search → results and verify flight cards appear',
    stepOutline: [
      'launchApp',
      'tapOn text "Flights" (home tile — text only, no id available)',
      'assertVisible id: search_tab',
      'tapOn id: search_tab',
      'assertVisible id: btn_search',
      'tapOn id: btn_search',
      'assertVisible id: flight_result_v4_navbar_toolbar_title',
      'extendedWaitUntil visible id: flight_result_v4_inventory_card timeout: 30000',
      'assertVisible id: flight_result_v4_inventory_card (at least one card loaded)',
    ],
    successCriteria: [
      'flight_result_v4_navbar_toolbar_title visible',
      'flight_result_v4_inventory_card visible (at least one card)',
    ],
  },
  {
    id: 'android-results-filter-direct',
    priority: 'p0',
    category: 'filter',
    name: 'Direct Flight Filter',
    description: 'Open full filter dialog via flight_result_v4_filter_button, apply Direct filter, verify results',
    stepOutline: [
      'Navigate to search results (precondition)',
      'Wait for flight_result_v4_inventory_card (Compose id, timeout: 30000)',
      'Tap id: flight_result_v4_filter_button — opens full filter dialog (layout_filter_dialog)',
      'Wait for id: layout_filter_dialog (timeout: 15000)',
      'Tap id: button_direct — Direct flights checkbox (flight_filter_transit_layer.xml verified)',
      'Tap id: dbwShow — Apply/Show Results button (verified via adb uiautomator dump)',
      'Wait for flight_result_v4_navbar_toolbar_title to reload (extendedWaitUntil Compose id)',
      'Assert at least one card visible (id: flight_result_v4_inventory_card)',
    ],
    successCriteria: [
      'layout_filter_dialog opened then closed',
      'flight_result_v4_inventory_card still visible after filter applied',
    ],
  },
  {
    id: 'android-results-sort-cheapest',
    priority: 'p0',
    category: 'sort',
    name: 'Sort by Cheapest',
    description: 'Tap bm_button (floating sort suggestion) to open Sort tray, select Cheapest (radio_button index 0)',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_inventory_card (Compose id, timeout: 30000)',
      'Tap id: bm_button — floating sort/filter suggestion pill at bottom of results page (verified via adb dump)',
      'Wait for id: rbg_sort — Sort tray container appears (flight package, timeout: 10000)',
      'Tap id: radio_button index 0 — Cheapest option (index 0 in Sort tray: Cheapest, 1=Shortest duration, 2=Direct first)',
      'Wait for flight_result_v4_navbar_toolbar_title to reload (extendedWaitUntil)',
      'Assert flight_result_v4_inventory_card still visible',
    ],
    successCriteria: [
      'Sort tray opens via bm_button',
      'Flight cards still visible after sort applied',
    ],
  },
  {
    id: 'android-results-select-flight',
    priority: 'p0',
    category: 'interaction',
    name: 'Select a Flight (View Detail)',
    description: 'Tap flight_result_v4_inventory_card to open flight detail',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_inventory_card (Compose id, timeout: 30000)',
      'Tap first flight_result_v4_inventory_card (Compose id)',
      'Wait for detail screen to appear (new screen or bottom sheet)',
      'Assert we are no longer on the plain results list (takeScreenshot for verification)',
    ],
    successCriteria: [
      'Tapping card navigates away from list or opens detail overlay',
    ],
  },
  {
    id: 'android-results-back-to-search',
    priority: 'p0',
    category: 'navigation',
    name: 'Back to Search Form',
    description: 'Use system back gesture to return to search form',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_navbar_toolbar_title (Compose id)',
      'Execute system back gesture: back (native Android back button/swipe)',
      'Assert we leave the results page (flight_result_v4_navbar_toolbar_title not visible)',
    ],
    successCriteria: [
      'flight_result_v4_navbar_toolbar_title no longer visible after back',
    ],
  },

  // ---------- P1 core coverage ----------
  {
    id: 'android-results-filter-one-stop',
    priority: 'p1',
    category: 'filter',
    name: '1-Stop Filter',
    description: 'Open FULL filter dialog via flight_result_v4_filter_button, tap button_one_transit, apply with dbwShow',
    stepOutline: [
      'Navigate to search results',
      'extendedWaitUntil id: flight_result_v4_inventory_card (timeout: 30000)',
      'Tap id: flight_result_v4_filter_button — opens FlightResultRevampFilterDialog (layout_filter_dialog)',
      'extendedWaitUntil id: layout_filter_dialog (timeout: 15000)',
      'Tap id: button_one_transit — 1-stop toggle (flight_filter_transit_layer.xml verified)',
      'Tap id: dbwShow — Apply/Show Results button (NOT tvResult — tvResult is just count label)',
      'extendedWaitUntil id: flight_result_v4_navbar_toolbar_title (timeout: 30000)',
      'Assert id: flight_result_v4_inventory_card visible',
    ],
    successCriteria: ['Filter dialog closed', 'Cards still visible after 1-stop filter'],
  },
  {
    id: 'android-results-sort-fastest',
    priority: 'p1',
    category: 'sort',
    name: 'Sort by Fastest',
    description: 'Tap bm_button (floating sort pill), select radio_button index 1 (Shortest duration)',
    stepOutline: [
      'Navigate to search results',
      'extendedWaitUntil id: flight_result_v4_inventory_card (timeout: 30000)',
      'Tap id: bm_button — floating sort suggestion pill (same as sort-cheapest entry)',
      'extendedWaitUntil id: rbg_sort (timeout: 10000)',
      'Tap id: radio_button index 1 — Shortest duration (sort tray index: 0=Cheapest, 1=Shortest duration, 2=Direct first)',
      'extendedWaitUntil id: flight_result_v4_navbar_toolbar_title (timeout: 30000)',
      'Assert id: flight_result_v4_inventory_card visible',
    ],
    successCriteria: ['Sort by Shortest duration applied, no crash'],
  },
  {
    id: 'android-results-airline-filter',
    priority: 'p1',
    category: 'filter',
    name: 'Airline Filter via Bottom Sheet',
    description: 'Open FULL filter dialog via flight_result_v4_filter_button, scroll once to reach layer_airline, tap check_box index 0, apply with dbwShow',
    stepOutline: [
      'Navigate to search results',
      'extendedWaitUntil id: flight_result_v4_inventory_card (timeout: 30000)',
      'Tap id: flight_result_v4_filter_button — opens FlightResultRevampFilterDialog',
      'extendedWaitUntil id: layout_filter_dialog (timeout: 15000)',
      'scroll — dialog order is: layer_transit → layer_airline → layer_time. One scroll exposes layer_airline',
      'extendedWaitUntil id: layer_airline (timeout: 10000)',
      'Tap id: check_box index 0 — first airline checkbox (flight_filter_airline_adapter_item.xml verified)',
      'Tap id: dbwShow — Apply button (NOT tvResult)',
      'extendedWaitUntil id: flight_result_v4_navbar_toolbar_title (timeout: 30000)',
      'Assert id: flight_result_v4_inventory_card visible',
    ],
    successCriteria: ['Airline filter applied, cards updated'],
  },
  {
    id: 'android-results-departure-time-filter',
    priority: 'p1',
    category: 'filter',
    name: 'Departure Morning Filter',
    description: 'Open FULL filter dialog, scroll twice to reach layer_time (after transit+airline), tap button_departure_morning, apply with dbwShow',
    stepOutline: [
      'Navigate to search results',
      'extendedWaitUntil id: flight_result_v4_inventory_card (timeout: 30000)',
      'Tap id: flight_result_v4_filter_button — opens FlightResultRevampFilterDialog',
      'extendedWaitUntil id: layout_filter_dialog (timeout: 15000)',
      'scroll/swipe NOT reliable inside filter dialog — use scrollUntilVisible instead',
      'scrollUntilVisible id: button_departure_morning direction: DOWN timeout: 15000 — FlightResultRevampFilterTimeWidget inflates flight_filter_time_widget.xml. scrollUntilVisible correctly targets the dialog scrollable container',
      'extendedWaitUntil id: button_departure_morning is already satisfied by scrollUntilVisible',
      'Tap id: button_departure_morning',
      'Tap id: dbwShow — Apply button (NOT tvResult)',
      'extendedWaitUntil id: flight_result_v4_navbar_toolbar_title (timeout: 30000)',
      'Assert id: flight_result_v4_inventory_card visible',
    ],
    successCriteria: ['Morning departure filter applied, results updated'],
  },
  {
    id: 'android-results-reset-filters',
    priority: 'p1',
    category: 'filter',
    name: 'Reset All Filters',
    description: 'Open FULL filter dialog, apply direct filter, tap tvReset to clear, apply with dbwShow',
    stepOutline: [
      'Navigate to search results',
      'extendedWaitUntil id: flight_result_v4_inventory_card (timeout: 30000)',
      'Tap id: flight_result_v4_filter_button — opens FlightResultRevampFilterDialog',
      'extendedWaitUntil id: layout_filter_dialog (timeout: 15000)',
      'Tap id: button_direct — select direct filter first so tvReset has something to clear',
      'Tap id: tvReset — Reset All button (flight_result_revamp_filter_dialog.xml verified)',
      'Tap id: dbwShow — Apply button with no filters active (NOT tvResult)',
      'extendedWaitUntil id: flight_result_v4_navbar_toolbar_title (timeout: 30000)',
      'Assert id: flight_result_v4_inventory_card visible',
    ],
    successCriteria: ['All filters cleared, full result set restored'],
  },
  {
    id: 'android-results-scroll',
    priority: 'p1',
    category: 'interaction',
    name: 'Scroll Through Results',
    description: 'Swipe up on flight_result_v4_navbar_toolbar_title to scroll and load more cards',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_inventory_card (Compose id)',
      'Swipe UP on flight_result_v4_navbar_toolbar_title (Compose id)',
      'Swipe UP again',
      'Assert flight_result_v4_inventory_card still visible',
    ],
    successCriteria: ['No crash after scrolling, cards still visible'],
  },
  {
    id: 'android-results-price-calendar',
    priority: 'p1',
    category: 'interaction',
    name: 'View Price Calendar',
    description: 'Tap calendar icon at far-right of flight_result_v4_date_flow_row (no testTag, use coordinates 96%,14%) to open FlightBloomCalendarDialog, assert calendar_navbar_close visible',
    stepOutline: [
      'Navigate to search results',
      'extendedWaitUntil id: flight_result_v4_inventory_card (timeout: 30000)',
      'extendedWaitUntil id: flight_result_v4_date_flow_row (timeout: 10000)',
      'Tap point: "96%, 14%" — calendar icon at far-right of date_flow_row (bounds [0,283][1080,410], icon at x≈1040, y≈346)',
      'NOTE: calendar icon has NO testTag in FlightResultV4DateFlowComposeView.kt — coordinate tap is the ONLY option',
      'extendedWaitUntil id: calendar_navbar_close (timeout: 10000) — FlightBloomCalendarDialog testTag verified',
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
    description: 'Open filter dialog, tap button_two_transit, apply',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_navbar_toolbar_title (Compose id)',
      'Tap flight_result_v4_filter_button to open full filter dialog (NOT quick_filter_cell)',
      'Wait for layout_filter_dialog (id)',
      'Tap button_two_transit (id: button_two_transit — flight_result_revamp_filter_transit_layer.xml)',
      'Tap dbwShow to apply (NOT tvResult — tvResult is count label only)',
      'Wait for flight_result_v4_navbar_toolbar_title reload',
    ],
    successCriteria: ['2+ stop filter applied; results or empty-state visible'],
  },
  {
    id: 'android-results-sort-best',
    priority: 'p2',
    category: 'sort',
    name: 'Sort by Best',
    description: 'Tap sort index 2 (Best) in sort tray',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_navbar_toolbar_title (Compose id)',
      'Tap bm_button (floating sort pill) to open sort tray (NOT flight_result_v4_sort_button — not in a11y tree)',
      'Wait for rbg_sort to appear',
      'Tap the radio_button at index 2 (Direct first) to sort',
      'Wait for flight_result_v4_navbar_toolbar_title to reload',
    ],
    successCriteria: ['Best sort applied, no crash'],
  },
  {
    id: 'android-results-view-detail',
    priority: 'p2',
    category: 'interaction',
    name: 'View Flight Detail (Card Tap)',
    description: 'Tap flight_result_v4_inventory_card to open detail, check layout',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_inventory_card (Compose id)',
      'Tap flight_result_v4_inventory_card (Compose id)',
      'Wait for detail overlay or new screen',
      'Take screenshot: test-results/android/android-results-view-detail.png',
      'Tap back to return to results (system back)',
      'Assert flight_result_v4_navbar_toolbar_title visible again (Compose id)',
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
      'Navigate to search results (SSR V4 page)',
      'Wait for flight_result_v4_filter_button (Compose testTag)',
      'Tap flight_result_v4_filter_button to open the new multi-filter dialog',
      'Wait for filter dialog to appear',
      'Tap the Transit tab inside the tabbed navigation (FilterTopTabBar)',
      'Tap the Direct/Nonstop option inside the transit tab content',
      'Tap Apply/Done button to submit filter',
      'Wait for flight_result_v4_inventory_card to reload',
      'Assert flight_result_v4_inventory_card still visible',
    ],
    successCriteria: [
      'Multi-filter dialog opens from flight_result_v4_filter_button',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Time tab in FilterTopTabBar',
      'Tap morning departure option (button_departure_morning or "Morning" chip)',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card to reload',
      'Assert flight_result_v4_inventory_card visible',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Airlines tab in FilterTopTabBar',
      'Tap first airline item in the airline list',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Price tab in FilterTopTabBar',
      'Scroll or swipe price range slider handle slightly to adjust min price',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Duration tab in FilterTopTabBar',
      'Adjust the duration slider to a restrictive value',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card or empty state to appear',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Airports tab in FilterTopTabBar',
      'Tap first departure airport option in the airports list',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Scroll tab bar to find Facilities tab, tap it',
      'Tap first facility option (meal/luggage) in the facilities list',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card or empty state',
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
      'Navigate to search results',
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
      'Navigate to search results',
      'Wait for flight_result_v4_quick_filter_cell',
      'Tap first chip in flight_result_v4_quick_filter_cell to open mini-tray',
      'Wait for mini-filter tray (bottom sheet)',
      'Tap Apply button in the mini-tray',
      'Wait for flight_result_v4_inventory_card to reload',
      'Assert flight_result_v4_inventory_card visible',
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
      'Navigate to search results',
      'Wait for flight_result_v4_quick_filter_cell',
      'Tap first chip to open mini-tray',
      'Wait for mini-filter tray',
      'Swipe DOWN on the mini-filter tray to dismiss it',
      'Assert tray is gone; flight_result_v4_inventory_card still visible',
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
      'Navigate to search results',
      'Wait for flight_result_v4_navbar_toolbar_title',
      'Tap bm_button (floating sort pill) to open sort tray',
      'Wait for rbg_sort (sort tray container)',
      'Tap radio_button at index 6 (Shortest Duration) inside sort tray',
      'Wait for flight_result_v4_inventory_card to reload',
      'Assert flight_result_v4_inventory_card visible',
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
      'Navigate to search results',
      'Wait for flight_result_v4_navbar_toolbar_title',
      'Tap bm_button (floating sort pill) to open sort tray',
      'Wait for rbg_sort',
      'Tap radio_button at index 5 (Earliest Arrival)',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_navbar_toolbar_title',
      'Tap bm_button (floating sort pill) to open sort tray',
      'Wait for rbg_sort',
      'Tap radio_button at index 4 (Latest Departure)',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_navbar_toolbar_title',
      'Tap bm_button (floating sort pill) to open sort tray',
      'Wait for rbg_sort',
      'Tap radio_button at index 2 (Direct flight first)',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_quick_filter_cell',
      'Scroll horizontally to find the Nonstop chip if needed',
      'Tap the Nonstop chip (flight_result_v4_quick_filter_cell at index 0 or labelled Nonstop)',
      'Wait for flight_result_v4_inventory_card to reload',
      'Assert flight_result_v4_inventory_card visible',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'On Transit tab: tap Direct',
      'On Airlines tab: tap second and third airline (to be restrictive)',
      'On Time tab: tap Morning departure only',
      'Tap Apply button',
      'Wait for either flight_result_v4_inventory_card or empty state UI',
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
      'Navigate to search results',
      'Apply restrictive filters to reach filtered empty state (reuse android-ssrv4-filter-empty-state precondition)',
      'When empty state appears, tap "Reset" or "Clear filters" button in empty state',
      'Wait for flight_result_v4_inventory_card to reload',
      'Assert flight_result_v4_inventory_card visible (results restored)',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Time tab',
      'Tap Afternoon departure option (button_departure_afternoon or "Afternoon" chip)',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Time tab',
      'Tap Evening departure option (button_departure_evening or "Evening" chip)',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card or empty state',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'Tap the Time tab',
      'Tap Morning arrival option (button_arrival_morning or arrival morning chip)',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card to reload',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'Wait for filter dialog',
      'On Transit tab: tap Direct',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card reload',
      'Tap flight_result_v4_filter_button again to reopen',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'On Transit tab: tap Direct',
      'Tap dbwShow (Apply button)',
      'Wait for flight_result_v4_inventory_card reload',
      'Tap bm_button (floating sort pill) to open sort tray',
      'Wait for rbg_sort',
      'Wait for flight_result_v4_inventory_card reload',
      'Assert flight_result_v4_inventory_card visible',
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
    description: 'Tap flight_result_v4_date_flow_row to advance to the next day',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_date_flow_row (Compose testTag)',
      'Scroll left on the date flow row to find tomorrow\'s date cell',
      'Tap the next-day date cell in flight_result_v4_date_flow_row',
      'Wait for flight_result_v4_inventory_card to reload',
      'Assert flight_result_v4_inventory_card visible',
    ],
    successCriteria: ['Date navigation changes results; new results load without crash'],
  },

  // ── Flight Card Interaction ──────────────────────────────────────────────
  {
    id: 'android-ssrv4-card-price-visible',
    priority: 'p0',
    category: 'interaction',
    name: 'SSR V4 Flight Card: Price Section Visible',
    description: 'Assert flight_result_v4_inventory_card_price_section is visible on each card',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_inventory_card',
      'Assert flight_result_v4_inventory_card_price_section is visible on first card',
      'Assert flight_result_v4_inventory_card_connector_view is visible (duration/stops)',
      'Take screenshot: test-results/android/android-ssrv4-card-price-visible.png',
    ],
    successCriteria: [
      'flight_result_v4_inventory_card_price_section visible',
      'flight_result_v4_inventory_card_connector_view visible (duration/stops section)',
    ],
  },
  {
    id: 'android-ssrv4-card-tap-detail',
    priority: 'p0',
    category: 'interaction',
    name: 'SSR V4 Flight Card Tap → Detail Screen',
    description: 'Tap flight_result_v4_inventory_card to open detail; back to results',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_inventory_card',
      'Tap flight_result_v4_inventory_card (first card)',
      'Wait for detail screen to appear (new activity or bottom sheet)',
      'Take screenshot: test-results/android/android-ssrv4-card-detail.png',
      'Tap system back or back arrow to return',
      'Assert flight_result_v4_inventory_card visible again',
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
      'Navigate to search results',
      'Wait for flight_result_v4_inventory_card',
      'Scroll down on the results list',
      'Scroll down again',
      'Scroll down a third time',
      'Assert flight_result_v4_inventory_card still visible after scrolling',
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
      'Navigate to search results',
      'Wait for flight_result_v4_filter_button',
      'Tap flight_result_v4_filter_button',
      'On Transit tab: tap Direct',
      'On Time tab: tap Morning',
      'Tap Apply',
      'Wait for results reload',
      'Tap flight_result_v4_filter_button again',
      'Tap Reset/Clear all button inside the filter dialog (tvReset or equivalent)',
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card reload',
      'Assert flight_result_v4_inventory_card visible (more results than before reset)',
    ],
    successCriteria: ['All filters cleared; full result set restored without crash'],
  },
];

// Active scenario set: base always included; extended appended with --extended
const ACTIVE_SCENARIOS: ScenarioDefinition[] = EXTENDED
  ? [...SCENARIOS, ...EXTENDED_SCENARIOS]
  : SCENARIOS;
function buildSystemPrompt(prdContent?: string): string {
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
  ✅ For page-loaded proof: assertVisible:\\n    id: "flight_result_v4_navbar_toolbar_title"
  ✅ For content verification: assertVisible: "Direct"  (ok — you WANT to verify the text)

CRITICAL RULE — COMPOSE MIGRATION (flight search results page):
The flight search RESULTS page has been fully migrated to Jetpack Compose (v4).
Old android:id values from XML layout files NO LONGER appear in the Accessibility tree.
Using them will ALWAYS cause "element not found" failures.

FORBIDDEN XML IDs (never use for the results page) and their replacements:
${forbiddenIdList}

CORRECT Compose testTag IDs (source: searchresult/v4/route/view/**/*.kt):
  "flight_result_v4_navbar_toolbar_title"            → results page header
  "flight_result_v4_navbar_toolbar_subtitle_chevron" → change-search chevron
  "flight_result_v4_date_flow_row"                   → date-price calendar strip
  "flight_result_v4_filter_button"                   → Filter button (opens full filter dialog)
  "flight_result_v4_quick_filter_cell"               → Stops/Airlines/Time chips (opens Stops sheet ONLY — NOT full filter dialog)
  "flight_result_v4_inventory_card"                  → each flight card
  "flight_result_v4_inventory_card_price_section"    → price area on card
  "flight_result_v4_inventory_card_connector_view"   → duration/stops on card
  "bm_button"                                        → floating sort pill (sort tray entry — shouldDisplaySortButtonInNavbar=false in staging)

STILL XML (retain their android:id and work normally):
  Filter dialog: layout_filter_dialog, layer_transit, button_direct,
                 button_one_transit, button_two_transit, tvReset, dbwShow,
                 button_departure_morning/afternoon/evening (flight_filter_time_widget.xml),
                 layer_airline, check_box (airline adapter item)
  Search form:   search_tab, btn_search, layout_search_form
  Sort pill:     bm_button (Compose testTag — confirmed in a11y tree)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT A — SORT TRAY ENTRY POINT (adb dump verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
flight_result_v4_sort_button DOES NOT EXIST in the a11y tree in staging.
shouldDisplaySortButtonInNavbar=false → the sort navbar button is never rendered.

THE ONLY WAY TO OPEN THE SORT TRAY:
  - tapOn:
      id: "bm_button"          ← floating sort suggestion pill at bottom of results page
  - extendedWaitUntil:
      visible:
        id: "rbg_sort"         ← wait for Sort tray container to appear
      timeout: 10000
  - tapOn:
      id: "radio_button"
      index: N                 ← see sort order below

SORT ORDER (confirmed from adb uiautomator dump while Sort tray open, 2026-06-12):
  index 0 → Cheapest (SORT_PRICE_LOWEST)
  index 1 → Shortest duration
  index 2 → Direct flights first
  index 3 → Earliest departure
  index 4 → Latest departure
  index 5 → Earliest arrival
  index 6 → Latest arrival

FORBIDDEN for sort:
  ❌ tapOn: id: "flight_result_v4_sort_button"   ← not in a11y tree
  ❌ tapOn: id: "rbg_sort"                        ← not in a11y tree (flight module prefix)
  ❌ tapOn: text: "Cheapest"                      ← i18n, also appears on flight cards
  ❌ tapOn: text: "Sort by"                       ← i18n

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRONG CONSTRAINT B — FILTER DIALOG ENTRY POINT (adb dump verified 2026-06-12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
flight_result_v4_quick_filter_cell opens the STOPS BOTTOM SHEET only.
It uses check_box + button_apply_filter. layout_filter_dialog will NEVER appear after tapping it.

THE ONLY WAY TO OPEN THE FULL FILTER DIALOG (FlightResultRevampFilterDialog):
  - tapOn:
      id: "flight_result_v4_filter_button"
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
  ❌ tapOn: id: "flight_result_v4_quick_filter_cell"  ← opens Stops sheet, NOT full filter
  ❌ tapOn: id: "quick_filter_item"                    ← same problem

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
        id: "flight_result_v4_navbar_toolbar_title"
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
                            The only exception in the ENTIRE codebase:
                            tapOn:\\n    text: "Flights"  (home screen tile — zero android:id, no testTag)
                            For EVERY other element, look up the android:id or Compose testTag from
                            android-v3 source, or from the VERIFIED IDs list in this prompt.
                            DO NOT use text: for filter chips, sort buttons, dialog items, or any other element.
- tapOn:\n    text: "Direct"  ← WRONG — "Direct" appears in flight card labels too; use id: "button_direct"
- tapOn:\n    text: "Cheapest" ← WRONG — use id: "flight_filter_radiobutton_layout" index: 0
- tapOn:\n    text: "Sort by"  ← WRONG — use id: "bm_button" for sort pill (1 instance on results page)
- runFlow: file: "other.yaml"  ← NEVER reference external .yaml files; ALL steps must be inlined in this single file

■ VERIFIED WORKING PATTERNS (from android-all-scenarios-suite.yaml — 23/23 pass):
  # Tap by resource id
  - tapOn:
      id: "flight_result_v4_filter_button"
  # Assert with id
  - assertVisible:
      id: "flight_result_v4_inventory_card"
  # Wait until element visible
  - extendedWaitUntil:
      visible:
        id: "flight_result_v4_inventory_card"
      timeout: 30000
  # Conditional flow (runFlow + when, NOT runFlowIfVisible)
  - runFlow:
      when:
        visible:
          id: "some_dismiss_button"
      file: "dismiss-overlay.yaml"
  # Tap radio by index
  - tapOn:
      id: "radio_button"
      index: 0
  # Scroll (no sub-keys)
  - scroll

11. Add comments explaining each step and its source file

Return ONLY the YAML content, no markdown fences, no explanation.${prdContent ? `

---
## PRD CONTEXT (from recent merged PRs — use to guide scenario generation)

The following product requirement document(s) describe recent changes merged into android-v3.
Use this to generate more relevant test scenarios that cover the described behaviors.

${prdContent.length > 6000 ? prdContent.slice(0, 6000) + '\n\n[...truncated...]' : prdContent}` : ''}${memCtx}`;
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
async function generateYaml(
  context: AndroidSourceContext,
  scenario: ScenarioDefinition,
  prdContent?: string,
  retries = 2
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
            { role: 'system', content: buildSystemPrompt(prdContent) },
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
      if (attempt < retries) {
        console.warn(`  [retry ${attempt + 1}] ${msg}`);
        await sleep(2000 * (attempt + 1));
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
  // Discovered from actual run failures on 2026-06-11 (exit code 2).
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/runFlowIfVisible/,              'SYNTAX_ERROR: runFlowIfVisible does not exist in Maestro 2.x → use "runFlow" with "when.visible"'],
    [/optional:\s*true/,              'SYNTAX_ERROR: "optional: true" is not a valid tapOn property in Maestro 2.x → remove it'],
    [/assertVisible:\s*\n\s+timeout/, 'SYNTAX_ERROR: assertVisible does not support a timeout sub-key in Maestro 2.x → use extendedWaitUntil instead'],
    [/waitForAnimationsToEnd/,        'SYNTAX_ERROR: waitForAnimationsToEnd was removed in Maestro 2.x → delete this line'],
    [/scroll:\s*\n\s+direction/,      'SYNTAX_ERROR: scroll does not support direction sub-key in Maestro 2.x → use bare "- scroll"'],
    [/scroll:\s*\n\s+duration/,       'SYNTAX_ERROR: scroll does not support duration sub-key in Maestro 2.x → use bare "- scroll"'],
    [/swipeOn|swipe:/,                'SYNTAX_ERROR: swipeOn/swipe not supported → use "- scroll"'],
    [/tapOn:\s+"[^"]+"/,              'SYNTAX_ERROR: tapOn with text string is forbidden (i18n app) → must use id: block'],
    [/file:\s*["'][^"']+\.yaml["']/,  'SYNTAX_ERROR: runFlow with external file: reference is forbidden — referenced yaml files do not exist at runtime. Inline all steps directly in this file instead.'],
    // ── SESSION-VERIFIED CONSTRAINTS (2026-06-12) ────────────────────────
    // Constraint A: Sort tray — flight_result_v4_sort_button never rendered
    [/id:\s*["']?flight_result_v4_sort_button["']?/,
      'SORT_ENTRY_ERROR: flight_result_v4_sort_button does not exist in a11y tree (shouldDisplaySortButtonInNavbar=false in staging). ' +
      'Use: tapOn id: "bm_button" → extendedWaitUntil id: "rbg_sort" → tapOn id: "radio_button" index: N'],
    // Constraint B: Filter entry — quick_filter_cell opens Stops sheet, not full filter
    [/id:\s*["']?(?:flight_result_v4_quick_filter_cell|quick_filter_item)["']?(?:[\s\S]*?tapOn[\s\S]*?id:\s*["']?layout_filter_dialog["']?)?/,
      'FILTER_ENTRY_WARNING: quick_filter_cell/quick_filter_item opens the Stops bottom sheet, NOT the full FlightResultRevampFilterDialog. ' +
      'layout_filter_dialog will never appear. Use: tapOn id: "flight_result_v4_filter_button" instead.'],
    // Constraint C: Apply button — tvResult is a count label, not the apply button
    [/tapOn:\s*\n\s+id:\s*["']?tvResult["']?/,
      'FILTER_APPLY_ERROR: tvResult is a count display label ("Show 25 results"), NOT a clickable apply button. ' +
      'The dialog will NOT close. Use: tapOn id: "dbwShow" to apply the filter.'],
    // Constraint D: Scrolling inside dialog — swipe hits results list, not dialog content
    [/swipe:\s*\n\s+direction:\s*(UP|DOWN)/,
      'DIALOG_SCROLL_ERROR: swipe: direction: UP/DOWN scrolls the results list behind the dialog, NOT the dialog content. ' +
      'For elements inside filter dialog below fold, use: scrollUntilVisible: element: id: "target_id" direction: DOWN timeout: 15000'],
  ];

  for (const [pattern, message] of forbiddenPatterns) {
    if (pattern.test(yaml)) warnings.push(message);
  }

  // ── COMPOSE ID ENFORCEMENT ───────────────────────────────────────────────
  // These old XML android:id values no longer appear in the Accessibility tree
  // after the flight results page was migrated to Jetpack Compose (v4).
  // Any generated YAML using them will always fail at runtime.
  for (const forbiddenId of FORBIDDEN_XML_IDS) {
    const pattern = new RegExp(`id:\\s*["']?${forbiddenId}["']?`);
    if (pattern.test(yaml)) {
      const replacement = COMPOSE_ID_MAP[forbiddenId];
      const hint = replacement ? ` → use "${replacement}" instead` : ' (no direct replacement; see COMPOSE_ID_MAP)';
      warnings.push(
        `COMPOSE_MIGRATION_ERROR: id "${forbiddenId}" is a forbidden old XML android:id.` +
        ` This ID does not exist in the Accessibility tree (Compose migration).${hint}`
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
  const startTime = Date.now();
  // Generate individual YAML files for each scenario (one file = one flow)
  const suiteChunks: string[] = [];
  const individualFiles: Array<{ id: string; file: string }> = [];

  for (const scenario of ACTIVE_SCENARIOS) {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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
