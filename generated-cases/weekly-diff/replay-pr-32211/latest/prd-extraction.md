# PRD Extraction

## Retrieval Method
Content retrieved exclusively via MCP Lark document raw-content command path using document token `XT84wK4x8ig9NKk0rIelDoB6gkg`.

## Source URL
`https://traveloka.sg.larksuite.com/wiki/XT84wK4x8ig9NKk0rIelDoB6gkg`

## Access Status
Success. MCP Lark raw-content returned readable PRD content for `[2026-01] Retention Dropoff` / `Booking Form Dropoff Retention Popup`.

## Key Requirements
- Goal: reduce unintentional exits and improve Booking Form to Payment conversion for Old SBF and SBF 5.0.
- Backend adds nullable `retentionPopupDisplay` data to `v2/trip/booking-v3/bookingPage` and `v2/trip/booking/bookingPage`.
- Popup content includes image, title, description, primary button text, and secondary button text.
- Title and description support HTML; some text colors come from backend response.
- Only show retention popup when `retentionPopupDisplay` is not null.
- Popup must be shown only once; if either native browser or Traveloka popup has already shown, do not show again.
- App leave triggers showing popup: nav-bar back, native back gesture, and Old SBF home navigation via three-dot menu.
- App leave triggers not showing popup: login navigation, booking/create-booking back-action modals, successful next-page navigation.
- Mobile web: use only Traveloka retention on nav-bar back; no dependable native browser retention. iOS unsupported, Android partial.
- Desktop web: Traveloka retention on Traveloka logo click; native browser retention on native exit behaviors like back, tab close, browser close, `Cmd/Ctrl+W`.
- Tracking required for popup show, primary click, secondary click, and back-to-previous-page; native browser popup cannot track click events.

## Risks
- Browser support differs by platform, especially mobile web and native `beforeunload` behavior.
- HTML rendering in title/description may create formatting or sanitization inconsistencies.
- One-time display logic must stay consistent across Traveloka popup and native browser popup.
- Tracking parity is incomplete because native browser popup click events are not trackable.
- Behavior matrix differs across apps, mobile web, desktop web, Old SBF, and SBF 5.0.

## Test Implications
- Validate null vs non-null `retentionPopupDisplay` behavior.
- Verify one-time popup suppression after any retention popup has been shown.
- Cover platform-specific exit conditions for apps, mobile web, and desktop web.
- Verify desktop native exit scenarios separately from Traveloka-triggered popup scenarios.
- Check HTML rendering and styled text handling in title/description.
- Validate analytics emission for show, primary click, secondary click, and back-to-previous-page where supported.
- Confirm no popup on excluded navigations such as login, API back-action dialogs, and successful booking continuation.

## Open Questions
- Exact backend contract details for `imageUrl`, `primaryButtonText`, and `secondaryButtonText` were marked TBD in parts of the PRD/MoM.
- Exact event names and payload schema should be confirmed from the linked tracking sheet/finalized tracking schema.
- Persistence scope of the “show only once” rule is not explicit: page session, tab session, browser session, or user session.
- HTML support boundaries and sanitization rules are not specified.
