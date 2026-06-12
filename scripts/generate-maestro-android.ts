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
  // sort/filter composite — Compose
  'layout_tray',
  'rbg_sort',
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
  layout_tray:             'flight_result_v4_sort_button',
  rbg_sort:                'flight_result_v4_sort_button',
  // Sort floating button (when shouldDisplaySortButtonInNavbar=false):
  //   Use tapOn: id: "bm_button_text" — the Bloom DS button text inside the floating sort pill
  //   NOTE: flight_result_v4_sort_button only appears in navbar when shouldDisplaySortButtonInNavbar=true
  // NOT Compose-migrated (XML IDs still valid):
  //   layout_filter_dialog, layer_transit, button_direct, tvReset, dbwShow
  //   search_tab, btn_search, layout_search_form
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
      trigger: 'Tap any chip in recycler_view_quick_filter to open filter dialog, then tap button_direct, then tap tvResult',
      outcome: 'Only direct flights in result list; card tv_duration_transit shows "Direct"',
    },
    {
      name: 'Apply 1-Stop Filter (via filter dialog)',
      trigger: 'Open filter dialog → tap button_one_transit → tap tvResult',
      outcome: 'Cards show 1-stop flights',
    },
    {
      name: 'Sort Cheapest',
      trigger: 'Tap first child of rbg_sort (index 0 = Cheapest)',
      outcome: 'Results reload sorted by price ascending',
    },
    {
      name: 'Sort Fastest',
      trigger: 'Tap second child of rbg_sort (index 1 = Fastest)',
      outcome: 'Results reload sorted by duration ascending',
    },
    {
      name: 'Open Full Filter Sheet',
      trigger: 'Tap any quick_filter_item chip in recycler_view_quick_filter',
      outcome: 'layout_filter_dialog becomes visible with all filter sections',
    },
    {
      name: 'Reset Filters',
      trigger: 'Inside filter dialog, tap tvReset',
      outcome: 'All filter selections cleared; tap tvResult to apply',
    },
    {
      name: 'View Flight Detail',
      trigger: 'Tap flight_result_container_view on a card',
      outcome: 'Detail screen or bottom sheet opens showing full flight info',
    },
    {
      name: 'Back to Search',
      trigger: 'Tap image_arrow_back',
      outcome: 'Returns to search form',
    },
    {
      name: 'Scroll Results',
      trigger: 'Swipe UP on result_container',
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
    description: 'Open filter dialog, apply Direct filter, verify results',
    stepOutline: [
      'Navigate to search results (precondition)',
      'Wait for result_container (id)',
      'Tap the first quick_filter_item chip in recycler_view_quick_filter to open filter dialog',
      'Wait for layout_filter_dialog to appear (id, timeout: 10000)',
      'Tap button_direct (id: button_direct in flight_result_revamp_filter_transit_layer.xml)',
      'Tap tvResult to apply filter (id: tvResult — Apply button)',
      'Wait for result_container to reload (extendedWaitUntil id: result_container)',
      'Assert at least one card visible (id: flight_result_container_view)',
    ],
    successCriteria: [
      'layout_filter_dialog opened then closed',
      'flight_result_container_view still visible after filter applied',
    ],
  },
  {
    id: 'android-results-sort-cheapest',
    priority: 'p0',
    category: 'sort',
    name: 'Sort by Cheapest',
    description: 'Open sort tray, tap first sort option (Cheapest), verify reload',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap rbg_sort radio group (id: rbg_sort in flight_sort_tray_widget.xml)',
      'Tap the first sort option (index 0 = Cheapest) inside rbg_sort',
      'Wait for result_container to reload',
      'Assert flight_result_container_view still visible',
    ],
    successCriteria: [
      'Sort interaction completes without crash',
      'Flight cards still visible after sort',
    ],
  },
  {
    id: 'android-results-select-flight',
    priority: 'p0',
    category: 'interaction',
    name: 'Select a Flight (View Detail)',
    description: 'Tap flight_result_container_view to open flight detail',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_container_view (id, timeout: 30000)',
      'Tap first flight_result_container_view (id: flight_result_container_view)',
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
    description: 'Tap image_arrow_back to return to search form',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap image_arrow_back (id: image_arrow_back in flight_result_revamp_activity.xml)',
      'Assert we leave the results page (result_container not visible)',
    ],
    successCriteria: [
      'result_container no longer visible after back',
    ],
  },

  // ---------- P1 core coverage ----------
  {
    id: 'android-results-filter-one-stop',
    priority: 'p1',
    category: 'filter',
    name: '1-Stop Filter',
    description: 'Open filter dialog, tap button_one_transit, apply',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap quick_filter_item to open filter dialog (id: quick_filter_item)',
      'Wait for layout_filter_dialog (id)',
      'Tap button_one_transit (id: button_one_transit — flight_result_revamp_filter_transit_layer.xml)',
      'Tap tvResult to apply (id: tvResult)',
      'Wait for result_container reload',
      'Assert flight_result_container_view visible',
    ],
    successCriteria: ['Filter dialog closed', 'Cards still visible after 1-stop filter'],
  },
  {
    id: 'android-results-sort-fastest',
    priority: 'p1',
    category: 'sort',
    name: 'Sort by Fastest',
    description: 'Tap sort index 1 (Fastest) in rbg_sort',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap rbg_sort (id: rbg_sort)',
      'Tap index 1 inside rbg_sort (Fastest)',
      'Wait for result_container reload',
      'Assert cards still visible',
    ],
    successCriteria: ['Sort by Fastest applied, no crash'],
  },
  {
    id: 'android-results-airline-filter',
    priority: 'p1',
    category: 'filter',
    name: 'Airline Filter via Bottom Sheet',
    description: 'Open filter dialog, scroll to airline section, select first airline, apply',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap quick_filter_item (id) to open filter dialog',
      'Wait for layout_filter_dialog (id)',
      'Scroll to layer_airline section (id: layer_airline)',
      'Tap first airline checkbox inside recycler_view_content under layer_airline',
      'Tap tvResult to apply (id: tvResult)',
      'Wait for result_container reload',
    ],
    successCriteria: ['Airline filter applied, cards updated'],
  },
  {
    id: 'android-results-departure-time-filter',
    priority: 'p1',
    category: 'filter',
    name: 'Departure Morning Filter',
    description: 'Open filter dialog, tap button_departure_morning, apply',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap quick_filter_item to open filter dialog',
      'Wait for layout_filter_dialog (id)',
      'Scroll to layer_time section (id: layer_time)',
      'Tap button_departure_morning (id: button_departure_morning — flight_filter_time_layer.xml)',
      'Tap tvResult to apply (id: tvResult)',
      'Wait for result_container reload',
    ],
    successCriteria: ['Morning departure filter applied, results updated'],
  },
  {
    id: 'android-results-reset-filters',
    priority: 'p1',
    category: 'filter',
    name: 'Reset All Filters',
    description: 'Apply direct filter, then open dialog and tap tvReset to clear',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap quick_filter_item to open filter dialog',
      'Wait for layout_filter_dialog (id)',
      'Tap button_direct (id) to select direct filter',
      'Tap tvReset to reset all filters (id: tvReset — flight_result_revamp_filter_dialog.xml)',
      'Tap tvResult to apply with no filters (id: tvResult)',
      'Wait for result_container reload',
      'Assert flight_result_container_view visible',
    ],
    successCriteria: ['All filters cleared, full result set restored'],
  },
  {
    id: 'android-results-scroll',
    priority: 'p1',
    category: 'interaction',
    name: 'Scroll Through Results',
    description: 'Swipe up on result_container to scroll and load more cards',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_container_view (id)',
      'Swipe UP on result_container (id: result_container)',
      'Swipe UP again',
      'Assert flight_result_container_view still visible',
    ],
    successCriteria: ['No crash after scrolling, cards still visible'],
  },
  {
    id: 'android-results-price-calendar',
    priority: 'p1',
    category: 'interaction',
    name: 'View Price Calendar',
    description: 'Tap widget_dateflow or similar to open price calendar',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap widget_dateflow (id: widget_dateflow in flight_result_revamp_activity.xml)',
      'Wait for price calendar view to appear (new screen or overlay)',
      'Take screenshot for visual verification',
    ],
    successCriteria: ['Price calendar view opens after tapping date widget'],
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
      'Wait for result_container (id)',
      'Tap quick_filter_item to open filter dialog',
      'Wait for layout_filter_dialog (id)',
      'Tap button_two_transit (id: button_two_transit — flight_result_revamp_filter_transit_layer.xml)',
      'Tap tvResult to apply (id: tvResult)',
      'Wait for result_container reload',
    ],
    successCriteria: ['2+ stop filter applied; results or empty-state visible'],
  },
  {
    id: 'android-results-sort-best',
    priority: 'p2',
    category: 'sort',
    name: 'Sort by Best',
    description: 'Tap sort index 2 (Best) in rbg_sort',
    stepOutline: [
      'Navigate to search results',
      'Wait for result_container (id)',
      'Tap rbg_sort (id: rbg_sort)',
      'Tap index 2 inside rbg_sort (Best)',
      'Wait for result_container reload',
    ],
    successCriteria: ['Best sort applied, no crash'],
  },
  {
    id: 'android-results-view-detail',
    priority: 'p2',
    category: 'interaction',
    name: 'View Flight Detail (Card Tap)',
    description: 'Tap flight_result_container_view to open detail, check layout',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_container_view (id)',
      'Tap flight_result_container_view (id: flight_result_container_view)',
      'Wait for detail overlay or new screen',
      'Take screenshot: test-results/android/android-results-view-detail.png',
      'Tap back to return to results (image_arrow_back or system back)',
      'Assert result_container visible again (id)',
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
      'Wait for flight_result_v4_sort_button (Compose testTag)',
      'Tap flight_result_v4_sort_button to open sort tray',
      'Wait for sort tray bottom sheet',
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
    description: 'Open sort tray, tap index 4 (Earliest Arrival), verify reload',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_sort_button',
      'Tap flight_result_v4_sort_button',
      'Wait for sort tray',
      'Tap radio_button at index 4 (Earliest Arrival)',
      'Wait for flight_result_v4_inventory_card to reload',
    ],
    successCriteria: ['Earliest Arrival sort applied without crash'],
  },
  {
    id: 'android-ssrv4-sort-latest-departure',
    priority: 'p1',
    category: 'sort',
    name: 'SSR V4 Sort by Latest Departure',
    description: 'Open sort tray, tap index 3 (Latest Departure), verify reload',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_sort_button',
      'Tap flight_result_v4_sort_button',
      'Wait for sort tray',
      'Tap radio_button at index 3 (Latest Departure)',
      'Wait for flight_result_v4_inventory_card to reload',
    ],
    successCriteria: ['Latest Departure sort applied without crash'],
  },
  {
    id: 'android-ssrv4-sort-direct-first',
    priority: 'p1',
    category: 'sort',
    name: 'SSR V4 Sort: Direct Flight First',
    description: 'Open sort tray, tap index 1 (Direct flight first), verify',
    stepOutline: [
      'Navigate to search results',
      'Wait for flight_result_v4_sort_button',
      'Tap flight_result_v4_sort_button',
      'Wait for sort tray',
      'Tap radio_button at index 1 (Direct flight first)',
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
      'Tap Apply button',
      'Wait for flight_result_v4_inventory_card reload',
      'Tap flight_result_v4_sort_button to open sort tray',
      'Tap radio_button at index 0 (Cheapest)',
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
  "flight_result_v4_filter_button"                   → Filter button
  "flight_result_v4_sort_button"                     → Sort button
  "flight_result_v4_quick_filter_cell"               → Stops/Airlines/Time chips
  "flight_result_v4_inventory_card"                  → each flight card
  "flight_result_v4_inventory_card_price_section"    → price area on card
  "flight_result_v4_inventory_card_connector_view"   → duration/stops on card

STILL XML (retain their android:id and work normally):
  Filter dialog: layout_filter_dialog, layer_transit, button_direct,
                 button_one_transit, button_two_transit, tvReset, dbwShow
  Search form:   search_tab, btn_search, layout_search_form

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

${prdContent.length > 6000 ? prdContent.slice(0, 6000) + '\n\n[...truncated...]' : prdContent}` : ''}`;
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
  // STRONG CONSTRAINT: accumulate all case YAML — written as ONE combined suite file at the end.
  const suiteChunks: string[] = [];

  for (const scenario of ACTIVE_SCENARIOS) {
    const relFile = path.relative(process.cwd(), SUITE_PATH);
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

      // STRONG CONSTRAINT: do NOT write individual files — accumulate into suite only
      suiteChunks.push(`# === ${scenario.priority.toUpperCase()}: ${scenario.name} ===\n${yaml}`);
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
        file: relFile,
        generatedAt: new Date().toISOString(),
        warnings: [`GENERATION_FAILED: ${msg}`],
      });
      skipped++;
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!DRY_RUN) {
    // STRONG CONSTRAINT: write ONE combined suite file — no individual per-scenario files
    const suiteHeader = [
      `# Auto-generated Android Maestro Suite`,
      `# Generated: ${new Date().toISOString()}`,
      `# ${generated} cases covering flight search results`,
      `# STRONG CONSTRAINT: This is the single source of truth for this run.`,
      `#   Do NOT split into per-scenario files.`,
    ].join('\n');
    fs.writeFileSync(SUITE_PATH, `${suiteHeader}\n\n${suiteChunks.join('\n---\n\n')}\n`, 'utf8');

    // Write manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

    // run-all simply points at the single suite file
    const runAllContent = [
      `# Auto-generated Android Maestro run-all`,
      `# Generated: ${new Date().toISOString()}`,
      `# STRONG CONSTRAINT: Always references the single android-suite.yaml — never per-scenario files.`,
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
    console.log(`📦 Suite file : ${SUITE_PATH}`);
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
