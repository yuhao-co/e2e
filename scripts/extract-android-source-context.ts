#!/usr/bin/env tsx
/**
 * Android Source Context Extractor
 *
 * Reads the live android-v3 source repo and extracts:
 *   - All Compose testTag IDs from flight UI source (.kt)
 *   - Relevant XML android:id from layout files (.xml)
 *   - Categorised into: resultPage, sort, filter, navigation, card, search
 *
 * Output: .cache/android-source-context.json (AndroidSourceContext format)
 *
 * Called automatically by android-diff-workflow.ts before case generation.
 * STRONG CONSTRAINT: Case generator MUST use this file via --source-json.
 *   Generated IDs in test cases that are NOT in this file are invalid.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const REPO = path.resolve('.cache/weekly-diff-repos/github.com_traveloka_android-v3');
const OUTPUT = path.resolve('.cache/android-source-context.json');
const APP_ID = 'com.traveloka.android.staging';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function gitGrep(pattern: string, pathSpec: string): string {
  try {
    return execSync(
      `git -C "${REPO}" grep -rn '${pattern}' -- '${pathSpec}' 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
  } catch {
    return '';
  }
}

function extractTestTags(output: string): string[] {
  const matches = output.match(/"([a-z][a-z0-9_]+)"/g) ?? [];
  return [...new Set(
    matches.map(m => m.replace(/"/g, '')).filter(id => id.startsWith('flight_') || ['search_tab', 'btn_search'].includes(id))
  )].sort();
}

function extractXmlIds(output: string): string[] {
  const matches = output.match(/@\+id\/([a-z][a-z0-9_]+)/g) ?? [];
  return [...new Set(matches.map(m => m.replace('@+id/', '')))].sort();
}

function filterByCategory(ids: string[], patterns: RegExp[]): string[] {
  return ids.filter(id => patterns.some(p => p.test(id)));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(REPO)) {
    console.error(`❌ android-v3 repo not found: ${REPO}`);
    console.error('   Run sync step first to clone/pull the repo.');
    process.exit(1);
  }

  console.log('🔍 Extracting testTags from android-v3 source...');
  const repoHead = execSync(`git -C "${REPO}" rev-parse --short HEAD 2>/dev/null || echo unknown`, { encoding: 'utf8' }).trim();
  console.log(`   Repo HEAD: ${repoHead}`);

  // Extract all testTags from flight source
  const flightKtOutput = gitGrep('testTag', 'flight/src/main/java/com/traveloka/android/flight');
  const allTestTags = extractTestTags(flightKtOutput);

  // Extract XML android:ids from flight layout files
  const flightXmlOutput = gitGrep('android:id=', 'flight/src/main/res');
  const allXmlIds = extractXmlIds(flightXmlOutput);

  // Categorize
  const resultPageIds = filterByCategory(allTestTags, [/^flight_result_v4_/]);
  const sortIds = filterByCategory(allTestTags, [/sort/]).concat(
    filterByCategory(allXmlIds, [/^rbg_sort|sort/])
  );
  const filterIds = filterByCategory(allTestTags, [/filter|quick_filter/]).concat(
    filterByCategory(allXmlIds, [/filter|dbwShow|dbw_show/])
  );
  const navIds = filterByCategory(allTestTags, [/navbar|changeflight/]).concat(['search_tab']);
  const cardIds = filterByCategory(allTestTags, [/inventory_card|top_pick|banner|coupon/]);
  const searchXmlIds = filterByCategory(allXmlIds, [/^btn_search$|^search_tab$|^btn_swap$|^btn_estnaton$|^date/]);

  // Build AndroidSourceContext
  const context = {
    _meta: {
      extractedAt: new Date().toISOString(),
      repoHead,
      source: 'android-v3 live git grep',
    },
    appId: APP_ID,
    screen: 'Flight Search Results',

    precondition: [
      '- launchApp',
      '- tapOn:\n    text: "Flights"      # Home screen product tile — no testTag, text-only contract',
      '- assertVisible:\n    id: "search_tab"',
      '- tapOn:\n    id: "search_tab"',
      '- assertVisible:\n    id: "btn_search"',
      '- tapOn:\n    id: "btn_search"',
      '- assertVisible:\n    id: "flight_result_v4_navbar_toolbar_title"',
      '- extendedWaitUntil:\n    visible:\n      id: "flight_result_v4_inventory_card"\n    timeout: 30000',
    ],

    textLabels: {
      filterChips: ['Direct', '1 Stop', '2+ Stops', 'Airline', 'Price', 'Departure Time'],
      sortOptions: ['Cheapest', 'Fastest', 'Best'],
      filterSheet: ['Apply', 'Reset'],
      note: 'NEVER use text labels in tapOn — use id: only. Text labels are locale-sensitive.',
    },

    // All IDs grouped by function — sourced live from android-v3
    accessibilityIds: {
      // Results page root controls
      resultPage: resultPageIds,
      // Sort controls
      sort: [...new Set(sortIds)],
      // Filter controls
      filter: [...new Set(filterIds)],
      // Navigation / navbar
      navigation: [...new Set(navIds)],
      // Flight card elements
      card: cardIds,
      // Search form (XML-based, still valid in hangar_widget.xml)
      searchForm: [...new Set(['btn_search', 'search_tab', ...searchXmlIds])],
    },

    // FORBIDDEN IDs — old XML ids replaced by Compose testTags
    // Sourced from COMPOSE_ID_MAP in generate-maestro-android.ts
    forbiddenIds: {
      rbg_sort: 'flight_result_v4_sort_button',
      result_container: 'flight_result_v4_navbar_toolbar_title',
      image_arrow_back: '(no direct replacement — use back gesture or assertVisible on previous screen)',
      bm_button: 'flight_result_v4_sort_button',
      button_direct: 'flight_result_v4_quick_filter_cell (index: 0)',
      dbwShow: 'flight_result_v4_filter_button',
      flight_result_filter_list: '(removed — filter via flight_result_v4_filter_button)',
    },

    interactions: [
      { name: 'Open Sort Sheet', trigger: 'tapOn: id: "flight_result_v4_sort_button"', outcome: 'Sort bottom sheet opens' },
      { name: 'Open Filter Sheet', trigger: 'tapOn: id: "flight_result_v4_filter_button"', outcome: 'Filter bottom sheet opens' },
      { name: 'Quick Filter (Direct)', trigger: 'tapOn: id: "flight_result_v4_quick_filter_cell"\n  index: 0', outcome: 'Direct flights filtered' },
      { name: 'Open Date Flow', trigger: 'tapOn: id: "flight_result_v4_date_flow_row"', outcome: 'Date flow calendar opens' },
      { name: 'Select Flight Card', trigger: 'tapOn: id: "flight_result_v4_inventory_card"\n  index: 0', outcome: 'Flight detail opens' },
      { name: 'View Price Calendar', trigger: 'tapOn: id: "flight_result_v4_date_flow_row"', outcome: 'Price calendar visible' },
    ],

    apiEndpoints: [
      '/v1/flight/search/results',
      '/v1/flight/search/filter',
    ],
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(context, null, 2), 'utf8');

  console.log(`✅ Source context written: ${OUTPUT}`);
  console.log(`   Result page IDs  : ${resultPageIds.length}`);
  console.log(`   Sort IDs         : ${[...new Set(sortIds)].length}`);
  console.log(`   Filter IDs       : ${[...new Set(filterIds)].length}`);
  console.log(`   Total testTags   : ${allTestTags.length}`);
}

main();
