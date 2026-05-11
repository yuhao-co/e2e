/**
 * Midscene Android E2E test for Traveloka.
 *
 * Prereqs (already prepared by setup):
 *   - MLX Qwen2.5-VL server on http://127.0.0.1:8080/v1 (npm run mlx:server -- --bg)
 *   - Android emulator running (avd: traveloka_test) with com.traveloka.android installed
 *   - .env loaded with MIDSCENE_MODEL_* vars
 *
 * Run:
 *   npx tsx tests/traveloka-android.spec.ts
 */
import 'dotenv/config';
import { agentFromAdbDevice } from '@midscene/android';

const PACKAGE = 'com.traveloka.android';

async function main() {
  console.log('[setup] connecting to first adb device…');
  const agent = await agentFromAdbDevice(undefined, {
    autoDismissKeyboard: true,
  });

  console.log('[setup] launching Traveloka…');
  await agent.launch(PACKAGE);
  // Give the splash + home screen time to render under the slow local VLM.
  await new Promise((r) => setTimeout(r, 8000));

  // Step 1a: handle the "Hello! Welcome to Traveloka" onboarding screen
  // (Preferred Currency + Preferred Language + Continue button).
  await agent.aiAction(
    'If a "Welcome to Traveloka" onboarding screen is shown with currency and language ' +
    'preference selectors, tap the blue "Continue" button at the bottom. ' +
    'If that screen is not visible, do nothing.'
  );
  await new Promise((r) => setTimeout(r, 4000));

  // Step 1b: dismiss any follow-up permission / notification dialogs.
  await agent.aiAction(
    'Dismiss any system or in-app permission dialog (location, notifications, etc.) ' +
    'by tapping "Allow", "While using the app", "OK", or "Got it". ' +
    'If no such dialog is visible, do nothing.'
  );
  await new Promise((r) => setTimeout(r, 3000));

  // Step 2: assert we are on the home screen.
  await agent.aiAssert(
    'The Traveloka home screen is visible with product entry tiles ' +
    'such as Flight, Hotel, or similar travel categories.'
  );

  // Step 3: open the Flight product.
  await agent.aiAction('Tap the "Flights" (or "Flight") tile/button on the home screen.');
  await new Promise((r) => setTimeout(r, 3000));

  // Step 4: extract what the search form shows.
  const flightForm = await agent.aiQuery(
    '{ originField: string, destinationField: string, dateField: string, passengerField: string }',
    'Read the flight search form. Return the visible text in each field. ' +
    'If a field is empty, return an empty string.'
  );
  console.log('[result] flight search form:', flightForm);

  await agent.aiAssert(
    'A flight search form is visible with fields for departure city, ' +
    'arrival city, departure date, and passengers/class.'
  );

  console.log('[done] Traveloka Android smoke test passed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
