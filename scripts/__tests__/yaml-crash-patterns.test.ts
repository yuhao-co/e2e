/**
 * Regression tests for YAML crash-detection regex patterns.
 * Run with: tsx scripts/__tests__/yaml-crash-patterns.test.ts
 *
 * ROOT CAUSE REMINDER (2026-06-16):
 *   ^- cmd:\s*$/m  ← WRONG — `$` in /m mode matches end-of-line only, so it
 *   matches the FIRST LINE of a valid multi-line block:
 *
 *     - tapOn:          ← matches the bad regex (line ends here)
 *         id: "foo"     ← sub-keys are on the NEXT line, regex never sees them
 *
 *   Correct form uses a lookahead to check the next line:
 *     /^- cmd:[ \t]*\n(?![ \t])/m
 *
 * This bug caused ALL valid YAML files to be quarantined/deleted TWICE in
 * one session (once for extendedWaitUntil, once for tapOn). These tests
 * exist to prevent it ever happening again.
 *
 * Keep CRASH_PATTERNS in sync with:
 *   scripts/generate-maestro-android.ts  → SUITE_CRASH_PATTERNS
 *   scripts/run-maestro-android.ts       → SUITE_CRASH_PATTERNS
 */

import assert from 'node:assert/strict';

// ── Authoritative pattern set ────────────────────────────────────────────────
const CRASH_PATTERNS: Array<[RegExp, string]> = [
  [/^- tapOn:[ \t]*\n(?![ \t])/m,             'bare tapOn: (no sub-keys)'],
  [/^- extendedWaitUntil:[ \t]*\n(?![ \t])/m, 'bare extendedWaitUntil: (no sub-keys)'],
  [/^- timeout:\s*\d+/m,                       'top-level timeout:'],
  [/^- tapOn:\s*"[^"]+"\s*$/m,                 'tapOn with inline string'],
  [/^- tapOn:\s*\{/m,                          'tapOn with inline object {}'],
];

function crashes(yaml: string): string | null {
  const hit = CRASH_PATTERNS.find(([re]) => re.test(yaml));
  return hit ? hit[1] : null;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ❌  ${name}`);
    console.error(`      ${e.message}`);
    failed++;
  }
}

// ── Valid YAML must NOT be flagged ────────────────────────────────────────────
console.log('\nValid YAML — must NOT be quarantined:');

test('tapOn with id:', () => {
  assert.equal(crashes('- tapOn:\n    id: "flight_result_filter_button_title"\n'), null);
});

test('tapOn with id: and index:', () => {
  assert.equal(crashes('- tapOn:\n    id: "radio_button"\n    index: 0\n'), null);
});

test('tapOn with point:', () => {
  assert.equal(crashes('- tapOn:\n    point: "96%, 14%"\n'), null);
});

test('extendedWaitUntil block with visible + timeout', () => {
  const yaml = ['- extendedWaitUntil:', '    visible:', '      id: "card_result"', '    timeout: 30000', ''].join('\n');
  assert.equal(crashes(yaml), null);
});

test('full filter flow (real android-results-filter-direct.yaml)', () => {
  const yaml = [
    'appId: com.traveloka.android.staging',
    'name: android-results-filter-direct',
    '---',
    '- stopApp',
    '- openLink:',
    '    link: "traveloka://flight/fullsearch?ap=SIN.JKTA&dt=20260617&ps=1.0.0&sc=ECONOMY"',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: "card_result"',
    '    timeout: 30000',
    '- tapOn:',
    '    id: "flight_result_filter_button_title"',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: "layout_filter_dialog"',
    '    timeout: 15000',
    '- tapOn:',
    '    id: "button_direct"',
    '- tapOn:',
    '    id: "dbwShow"',
    '- assertVisible:',
    '    id: "card_result"',
  ].join('\n');
  assert.equal(crashes(yaml), null);
});

test('sort flow with tapOn id + index (real android-results-sort-cheapest.yaml)', () => {
  const yaml = [
    '- tapOn:',
    '    id: "flight_result_sort_button_title"',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: "layout_tray"',
    '    timeout: 15000',
    '- tapOn:',
    '    id: "radio_button"',
    '    index: 0',
  ].join('\n');
  assert.equal(crashes(yaml), null);
});

// ── Bad YAML must be caught ───────────────────────────────────────────────────
console.log('\nInvalid YAML — must be quarantined:');

test('bare tapOn: followed by another command', () => {
  assert.equal(crashes('- tapOn:\n- scroll\n'), 'bare tapOn: (no sub-keys)');
});

test('bare tapOn: followed by a comment', () => {
  assert.equal(crashes('- tapOn:\n# sanitized\n- scroll\n'), 'bare tapOn: (no sub-keys)');
});

test('bare extendedWaitUntil: followed by another command', () => {
  assert.equal(crashes('- extendedWaitUntil:\n- scroll\n'), 'bare extendedWaitUntil: (no sub-keys)');
});

test('top-level timeout: command', () => {
  assert.equal(crashes('- timeout: 5000\n- scroll\n'), 'top-level timeout:');
});

test('tapOn with inline string (i18n violation)', () => {
  assert.equal(crashes('- tapOn: "Direct"\n'), 'tapOn with inline string');
});

test('tapOn with inline object {}', () => {
  assert.equal(crashes('- tapOn: {id: "foo"}\n'), 'tapOn with inline object {}');
});

// ── NOTE: tapOn with only index: (no id:) is a runtime error, NOT suite-crash ─
test('tapOn with only index: (no id) — should NOT be quarantined (runtime error only)', () => {
  // This fails at Maestro runtime with "Config Field Required: id", but does NOT
  // crash the entire suite. Let Maestro report it per-file.
  assert.equal(crashes('- tapOn:\n    index: 0\n'), null);
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n🚨 REGRESSION DETECTED — fix CRASH_PATTERNS before proceeding');
  process.exit(1);
}
console.log('✅ All regex patterns are correct');

