# [Metasearch] Q2-26 Improvement

This document contains high level of requirement for each projects that will be queued for Q2

## [Kexin] Email Confirmation field

JP metasearch partner requested to have this feature in Traveloka because they often get complaint from customer that not receiving email. Hence adding 2 fields can help to reduce the error. Better yet if email field can validate whether email domain exist and email account is valid.

**Risk if not enabled**: domestic routes won't be enabled for Traveloka (trip also not enabled in Traveloka for dom routes)

### Requirements:
- Config per affiliateId in BE
- AB test in BE
- Direct metasearch only

### Comments from @Kexin Yang
- **[Proposal] Email validation mechanism**: to enquire User team about such capability
- **[Proposal] Email typo detection and correction suggestion**: e.g. If user input `youtiao@gmail.co` then suggest "do you mean `youtiao@gmail.com`"
- **[To enable late Mar] Email auto-complete**: a drop down list of suggested email domains

---

## [Kexin] [Login] Post Issuance Login Nudge

- **For non-login**: Display login nudge message
- **For no Apps install**: Display app download message

### Monitoring Metrics:
- Impression (View) and Engagement (Click) by channel
- Flight login rate by channel
- Download rate by channel
- Transaction per interface by channel

---

## [Kexin] [Download] Eticket Email Top Banner

**Status**: ONGOING Dev mid Apr - @Chen Wang（王辰）

### Goal:
To drive download Apps

### Target Audience:
- All user purchase in mweb & desktop regardless login status

---

## [Download] Abandon Retargetting - Flight Price Newsletter

### Goal:
Drive download and direct apps purchase

### Content:
- Disclaimer that price is fluctuative
- Top Domestic Price Drop
- Top International Price Drop
- Top Airline Price Drop
- Download button
- List of coupon/promo schedule

---

## [Kexin] Easy Log In for Non-Gmail and iCloud Users

### Request:
Support login via Yahoo, Outlook, ProtonMail, corporate mail, etc.

### Status:
- ✅ **Scope 1 DONE**: Login/Sign-up Nudge on Booking Form for non-gmail/apple
- 📋 **Scope 2**: Visibility of login prompt for non-gmail/apple

---

## [Kexin] [Desktop] Easy Login QR Code

### User Flow:
- Non-login user see QR Code in Desktop
- When QR Code is scanned:
  - Apps not installed → Redirect to PlayStore
  - Apps installed but not logged in → Redirect to login/register page
  - Apps installed and already logged in → Desktop is auto-login

---

## Metasearch Coupon Exclusion

### Enable Coupon Condition:
`IS_METASEARCH : DIRECT or ATTRIBUTION or FALSE`

### Definition:
- **Direct**: searchId = metasearch.{searchid}
- **Attribution**: searchId=uuid
- **False**: no metasearch attribution

### Important: Can be combined with Profiling Segmentation

---

## [Kexin] Integration with SNS

### Scope:
- Get notified of message status
- Investigate delayed emails
- Notify user if eticket not received via email
- Support OTT channels (WhatsApp) and SMS as fallback

---

## Skyscanner Login Price

### Context:
Skyscanner shows different pricing for logged-in vs non-logged-in users ($280 vs $300)

### Solution:
Return 2 types of price for Skyscanner based on user login status

### Proposed Changes:

| Funnel | issuingAgentID | routingAgentID |
|--------|----------------|----------------|
| Search | trinusa | trinusa |
| Booking | skyscannerSG-flight | trinusa |

---

## [Andro] Payment Method in Summary Page

### Context:
Trip has feature to highlight discounted price for specific payment methods

### Availability:
- **Available in**: ID, TH, PH, MY, KR
- **Not available in**: VN, JP, AU, SG

### Requirements:
- Default payment method will be free of transaction fee
- Rest of the method trx fee applies
- Need config by affiliateId

---

## Monitoring Post Issuance Flow

### Metrics:
- ✅ **[Ready]** Success Payment (by interface, affiliateId, payment partner)
- ✅ **[Ready]** Success Issuance (by interface, affiliateId, route, airline, provider)
- 🚧 Redirection after payment (need platform team)
- 🚧 Eticket Email (need to integrate with MSG team)

---

## Highlight $0 Payment Fee

For Metasearch Flow only (not Generic Summary Tray Redirection)

### Scope:
- All Interfaces (Desktop: MWeb, DWeb; Mobile: Android, iOS)

### Requirements:
- Add static text showing $0 fee in price breakdown
- Requires Design Mockup and FE filtering
- Need config by affiliateId

---

## Attribution Metasearch Handler - Supply/Booking

### Problem:
Provider excluded in booking but included in search due to different issuingAgentID

| Funnel | issuingAgentID | Result |
|--------|----------------|--------|
| Search | trinusa | ✅ Provider Included |
| Booking | skyscannerSG-flight | ❌ Provider Excluded |

### Solution:
Introduce `routingAgentID` to separate routing logic from sales attribution

---

## Metasearch Booking Panel Revalidation API

### Context:
Allow metasearch partners to refresh inventory when user lands in booking panel

### Requirements:
- Skyscanner must fill quoteId with PQID to reduce load
- Make API generic for other metasearch partners

---

## Skyscanner Routing API

### Context:
Only call routes that Traveloka wants to open (reduce API calls)

### Hard Requirement:
- Only for direct metasearch
- Attributed metasearch must follow internal configuration

### Schedule:
Called once at Midnight UTC

---

## Inventory Refresh V2

- **Flight**: Improve latency for returning result to partner
- **Naver Integration**: Need discussion for integration timeline
- **UI Improvement - JP, KR**: Need discussion for context

---

## Metasearch Rounding Price

### Context:
Skyscanner rounds up price: $10.12 → $11

### Scope:
- **Flight Demand**: No logic change (identifier from pricing if needed)
- **Flight Pricing**: 2MW effort
- **S&D and B&I**: Need effort

---

## Metasearch Co-pilot insight

### Input:
- BID

### Output:
- affiliateId, Direct/attributed metasearch, Date of travel, Date of issuance
- Airline, Trip type, Travel type
- Price change when land to summary page: yes/no + reason
- Price change when submit booking: yes/no + reason
- Spoof detection

### Requirements:
- Config per affiliateId with regex support
- During redirection to summary page: give x% to update latest price
- Cap per day with randomized timing/frequency
- Not reproducible (refresh = price update)
- Check if FE or BE implementation needed

### Methods:
1. **Option 1**: Inject search result price to HTML (easily detected by human)
2. **Option 2**: Randomise inventory validation in summary tray (easily detected by crawler)

### Weightage Prioritisation:
- Differentiate caching duration based on ODD (origin, destination, date of travel)
- Open/Close routes based on ODD
- ✅ Origin & destination done
- 🚧 Date of travel not yet
