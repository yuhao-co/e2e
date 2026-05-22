# PRD Extraction

## Retrieval Method
Content retrieved exclusively via the MCP Lark document raw-content command path using document token `XT84wK4x8ig9NKk0rIelDoB6gkg`.

## Source URL
`https://traveloka.sg.larksuite.com/wiki/XT84wK4x8ig9NKk0rIelDoB6gkg`

## Access Status
Success. MCP Lark raw-content returned readable PRD content.

## Key Requirements
- Goal: reduce unintentional exits and improve Booking Form to Payment conversion.
- Scope includes Old SBF and SBF 5.0.
- Backend adds nullable `retentionPopupDisplay` data in `v2/trip/booking-v3/bookingPage` and `v2/trip/booking/bookingPage`.
- Backend controls experiment and feature logic.
- Popup content fields come from backend: image URL, title, description, primary button text, secondary button text.
- Title and description support HTML, including response-driven text colors.
- Only show retention behavior when `retentionPopupDisplay` is not null.
- Show retention popup only once; if either native-browser or Traveloka popup has appeared, do not show it again.
- App retention should show on back button, native back gesture, and Old SBF back-to-home action; not on login navigation, API back-action dialogs, or successful next-page navigation.
- Mobile web should use Traveloka retention on nav-bar back only; no reliable native browser retention.
- Desktop web should use Traveloka retention on Traveloka-logo exit and native browser retention on browser/tab/window exit behaviors.
- Tracking required for popup show, primary click, secondary click, and back-to-previous-page, with native browser popup limited in click tracking support.

## Risks
- Browser-native retention support is inconsistent, especially on mobile web and unsupported on iOS mobile web.
- One-time display logic across native and Traveloka popups may be easy to regress.
- HTML rendering from backend content introduces rendering and styling consistency risk.
- Tracking parity differs between Traveloka popup and native browser popup.
- Some FE-BE contract details were marked TBD or finalized later in MoM notes.

## Test Implications
- Validate nullable and non-null `retentionPopupDisplay` responses for both Old SBF and SBF 5.0 paths.
- Verify exact leave conditions per platform: apps, mobile web, desktop web.
- Verify one-time display behavior across both popup types in the same session/flow.
- Verify HTML title/description rendering, including colored text.
- Verify backend-driven content mapping for image and button texts.
- Verify native-browser retention only where supported, and absence where unsupported.
- Verify analytics for show/back events on all supported surfaces and click events only for Traveloka popup.

## Open Questions
- Exact FE-BE contract details for image/button fields should be confirmed against the latest backend documentation.
- Expected behavior after primary vs secondary button clicks is not explicit in this extracted content.
- Persistence boundary for "show only once" is unclear: page lifecycle, tab session, browser session, or user session.
- Tracking schema details and event names are referenced externally and not fully specified in this PRD text.
