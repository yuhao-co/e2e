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
const CLI_MODEL = (() => {
  const idx = args.indexOf('--model');
  return idx !== -1 ? args[idx + 1] : null;
})();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OUTPUT_DIR = path.resolve('maestro/flows/android/generated');
const MANIFEST_PATH = path.resolve('maestro/flows/android/manifest.json');
const RUN_ALL_PATH = path.resolve('maestro/flows/android/run-all-android.yaml');
const APP_ID = 'com.traveloka.android.staging';

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
    return new OpenAI({
      apiKey: githubToken,
      baseURL: 'https://models.inference.ai.azure.com',
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
  if (githubToken)  return process.env.GITHUB_MODEL ?? 'gpt-4o';
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
    'App launches to home screen',
    'Optional onboarding dismissed with "Continue"',
    'Tap "Flights" tile on home screen',
    'Search form shows origin "Singapore (SIN)" pre-filled',
    'Tap "Search" button to navigate to results',
    'Wait up to 30s for flight cards to appear',
  ],

  // Text labels: ONLY use these for assertVisible (language-specific assertions).
  // NEVER use these in tapOn — use viewIds instead.
  textLabels: {
    // Locale: EN-SG (Singapore). Will differ in ID/TH locales.
    filterChips: ['Direct', '1 Stop', '2+ Stops', 'Airline', 'Price', 'Departure Time'],
    sortOptions: ['Cheapest', 'Fastest', 'Best'],
    filterSheet: ['Apply', 'Reset'],
  },

  // Android resource IDs extracted from traveloka/android-v3 layout XMLs.
  // Source: flight/src/main/res/layout/
  // These are locale-independent — always prefer these for tapOn/assertVisible.
  accessibilityIds: {
    // flight_result_revamp_activity.xml
    resultContainer:        'result_container',
    backButton:             'image_arrow_back',
    changeSearch:           'image_change_search',
    routeWidget:            'widget_route',
    departureLegInfo:       'depart_leg_info',

    // flight_result_revamp_route_widget.xml (sticky filter bar)
    quickFilterRecycler:    'recycler_view_quick_filter',   // RecyclerView with filter chips
    includeBaggagePill:     'pill_include_baggage',

    // flight_result_revamp_filter_dialog.xml (full filter bottom sheet)
    filterDialog:           'layout_filter_dialog',
    filterClose:            'ivClose',
    filterReset:            'tvReset',
    filterApply:            'tvResult',                     // "Show X results" apply button
    filterTransitLayer:     'layer_transit',
    filterAirlineLayer:     'layer_airline',
    filterTimeLayer:        'layer_time',
    filterPriceLayer:       'layer_price',

    // flight_result_revamp_filter_transit_layer.xml
    filterDirect:           'button_direct',
    filterOneStop:          'button_one_transit',
    filterTwoStop:          'button_two_transit',

    // flight_filter_time_layer.xml
    filterDepartEarlyMorning: 'button_departure_early_morning',
    filterDepartMorning:    'button_departure_morning',
    filterDepartAfternoon:  'button_departure_afternoon',
    filterDepartEvening:    'button_departure_evening',
    filterArriveEarlyMorning: 'button_arrival_early_morning',
    filterArriveMorning:    'button_arrival_morning',

    // flight_sort_tray_widget.xml
    sortRadioGroup:         'rbg_sort',                     // RadioButtonGroup; tap child by index

    // flight_search_result_card_item.xml (per flight card in list)
    cardContainer:          'flight_result_container_view', // tap to open detail
    cardDepartTime:         'depart_time',
    cardArrivalTime:        'arrival_time',
    cardPrice:              'text_view_real_price',
    cardAirlineName:        'text_flight_name',
    cardDurationStops:      'tv_duration_transit',

    // flight_quick_filter_item.xml (chips inside recycler_view_quick_filter)
    quickFilterChip:        'quick_filter_item',
    quickFilterChipText:    'quick_filter_item_name',
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
      'Launch app (appId: com.traveloka.android.staging)',
      'Dismiss onboarding if visible (runFlow conditional)',
      'Tap "Flights" tile on home screen (tap by text "Flights" — home screen is EN-only)',
      'Tap Search button on search form (tap by text "Search")',
      'Wait for result_container to be visible (id: result_container, timeout: 30000)',
      'Wait for first flight card to appear (id: flight_result_container_view)',
      'Assert result_container visible (id-based)',
      'Assert at least one flight card visible (id: flight_result_container_view)',
    ],
    successCriteria: [
      'result_container visible',
      'flight_result_container_view visible (at least one card)',
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
// AI prompt builder
// ---------------------------------------------------------------------------
function buildSystemPrompt(): string {
  return `You are an expert mobile test engineer who writes Maestro YAML test cases for Android apps.
Maestro is a mobile UI testing framework that uses YAML-based test flows.

CRITICAL RULE — MULTI-LANGUAGE APP:
This app supports multiple languages (EN, ID, TH, etc.).
- INTERACTIONS (tapOn, longPressOn, scrollUntilVisible) MUST use resource IDs, NEVER text.
  ✅ CORRECT:  tapOn:\n    id: "button_direct"
  ❌ WRONG:    tapOn: "Direct"
- ASSERTIONS (assertVisible, extendedWaitUntil) MAY use text, but prefer IDs when available.
  ✅ For page-loaded proof: extendedWaitUntil:\n    visible:\n      id: "result_container"
  ✅ For content verification: assertVisible: "Direct"  (ok — you WANT to verify the text)

MAESTRO YAML SYNTAX RULES:
1. Start every flow with appId on line 1, then --- on line 2
2. Tap by resource ID:     tapOn:\n    id: "view_resource_id"
3. Wait by resource ID:    extendedWaitUntil:\n    visible:\n      id: "view_id"\n    timeout: 30000
4. Assert by ID:           assertVisible:\n    id: "view_resource_id"
5. Assert by text:         assertVisible: "some text"   (only for content-level assertions)
6. Scroll:                 scrollUntilVisible:\n    element:\n      id: "view_id"\n    direction: DOWN
7. Swipe gesture:          swipe:\n    direction: UP\n    duration: 400
8. Conditional step:       runFlow:\n    when:\n      visible:\n        id: "view_id"\n    commands:\n      - tapOn:\n          id: "..."
9. Screenshot:             takeScreenshot: "test-results/android/<caseid>-step.png"
10. Timeouts: 30000ms for network-loaded results, 10000ms for UI transitions
11. Add comments (# ...) explaining each step and its source file
12. NEVER use hard-coded coordinates
13. ALWAYS include precondition (launch → navigate to results page)
14. Add "# [layout: filename.xml]" comment showing which layout file the ID comes from

Return ONLY the YAML content, no markdown fences, no explanation.`;
}

function buildUserPrompt(context: AndroidSourceContext, scenario: ScenarioDefinition): string {
  return `Generate a Maestro YAML test case for this scenario.

## App Context
AppId: ${context.appId}
Screen: ${context.screen}

## How to Reach This Screen (Precondition)
${context.precondition.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Available Text Labels on Screen
${Object.entries(context.textLabels)
  .map(([section, labels]) => `${section}: ${labels.join(', ')}`)
  .join('\n')}

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
  retries = 2
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(context, scenario) },
        ],
      });
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
// YAML validation (basic sanity check)
// ---------------------------------------------------------------------------
function validateYaml(yaml: string, scenario: ScenarioDefinition): string[] {
  const warnings: string[] = [];
  if (!yaml.includes(`appId: ${APP_ID}`)) warnings.push(`Missing appId: ${APP_ID}`);
  if (!yaml.includes('---')) warnings.push('Missing --- separator');
  if (!yaml.includes('assertVisible') && !yaml.includes('extendedWaitUntil'))
    warnings.push('No assertions found — case may not verify anything');
  if (yaml.includes('coordinates:') || /\(\d+,\s*\d+\)/.test(yaml))
    warnings.push('Hard-coded coordinates detected — remove them');
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
  console.log(`   Scenarios: ${SCENARIOS.length}`);
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

  for (const scenario of SCENARIOS) {
    const outputFile = path.join(OUTPUT_DIR, `${scenario.id}.yaml`);
    const relFile = path.relative(process.cwd(), outputFile);
    process.stdout.write(`  [${scenario.priority.toUpperCase()}] ${scenario.name} … `);

    if (DRY_RUN) {
      console.log('(dry-run skipped)');
      skipped++;
      continue;
    }

    try {
      const scenarioStart = Date.now();
      const yaml = await generateYaml(context, scenario);
      const elapsed = ((Date.now() - scenarioStart) / 1000).toFixed(1);
      const warnings = validateYaml(yaml, scenario);

      fs.writeFileSync(outputFile, yaml, 'utf8');
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
    // Write manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

    // Write run-all orchestrator
    const p0 = manifest.filter((m) => m.priority === 'p0' && !m.warnings.some((w) => w.startsWith('GENERATION_FAILED')));
    const p1 = manifest.filter((m) => m.priority === 'p1' && !m.warnings.some((w) => w.startsWith('GENERATION_FAILED')));
    const p2 = manifest.filter((m) => m.priority === 'p2' && !m.warnings.some((w) => w.startsWith('GENERATION_FAILED')));

    const runAllContent = [
      `# Auto-generated Android Maestro run-all`,
      `# Generated: ${new Date().toISOString()}`,
      `# ${generated} cases covering flight search results`,
      `appId: ${APP_ID}`,
      '---',
      '',
      '# === P0: Critical smoke ===',
      ...p0.map((m) => `- runFlow: generated/${m.id}.yaml`),
      '',
      '# === P1: Core coverage ===',
      ...p1.map((m) => `- runFlow: generated/${m.id}.yaml`),
      '',
      '# === P2: Edge cases ===',
      ...p2.map((m) => `- runFlow: generated/${m.id}.yaml`),
    ].join('\n');

    fs.writeFileSync(RUN_ALL_PATH, runAllContent, 'utf8');

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ Generated  : ${generated} / ${SCENARIOS.length} cases`);
    console.log(`⚠️  Skipped    : ${skipped}`);
    console.log(`⏱  Total time : ${totalElapsed}s`);
    console.log(`📁 Output dir : ${OUTPUT_DIR}`);
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
