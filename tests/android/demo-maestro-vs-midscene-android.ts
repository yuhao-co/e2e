/**
 * Midscene Android — Flight Search Demo
 *
 * Same scenario as Maestro: Traveloka Android app, SIN → Jakarta flight search.
 * Mirrors: maestro/flows/traveloka-android-flight-search.yaml
 *
 * Prereqs:
 *   1. Android emulator running (see README below)
 *   2. APK installed: adb install ~/Downloads/chatbot_android.apk
 *   3. MLX server running: npm run mlx:server  (or set OPENAI_* env for cloud model)
 *   4. .env has MIDSCENE_MODEL_NAME, MIDSCENE_MODEL_BASE_URL, MIDSCENE_MODEL_API_KEY
 *
 * Run:
 *   npx tsx tests/android/demo-maestro-vs-midscene-android.ts
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { agentFromAdbDevice } from '@midscene/android';

const PACKAGE = 'com.traveloka.android.staging';

async function main() {
  const startTime = Date.now();

  console.log('[1/7] Connecting to Android device via ADB…');
  const agent = await agentFromAdbDevice(undefined, {
    autoDismissKeyboard: true,
  });

  console.log('[2/7] Installing APK (skipped if already installed)…');
  // Install APK if not already present - comment out if already installed
  // await agent.installApp('~/Downloads/chatbot_android.apk');

  console.log('[3/7] Launching Traveloka staging app…');
  // NOTE: agent.launch() fails on Android 17 for this APK (am start -n not resolvable).
  // The app must already be at the home screen (pre-condition: run Maestro launchApp first,
  // or manually ensure the app is open). Midscene handles only the AI interaction part.
  // execSync(`adb shell monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`, { stdio: 'ignore' });
  await sleep(1000); // brief pause to confirm state

  console.log('[4/5] Navigating to Flight search…');
  await agent.aiAssert(
    'The Traveloka home screen is visible with a "Flights" or "Flight" tile.'
  );
  await agent.aiAction('Tap the "Flights" tile on the home screen.');
  await sleep(3000);

  console.log('[5/5] Tapping Search and verifying results…');
  await agent.aiAction('Tap the "Search" button on the flight search form.');
  await sleep(8000);

  await agent.aiAssert(
    'A list of flights from Singapore to Jakarta is visible with flight rows showing departure times. ' +
    'Filter options including "Direct" should be visible.'
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Midscene Android test PASSED in ${elapsed}s`);
  console.log('📊 Compare with Maestro: maestro/flows/traveloka-android-flight-search.yaml');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Midscene Android test FAILED:', err.message ?? err);
    process.exit(1);
  });
