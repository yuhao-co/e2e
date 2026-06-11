import { applyFeedbackToCapabilityPack, readWeeklyCapabilityFeedbackOverlay } from './weekly-capability-feedback';
import { applyLearningMemoryToCapabilityPack, readWeeklyLearningMemory } from './weekly-learning-memory';
import { CapabilityPack } from './weekly-quality-types';

export const AUTO_PROMOTED_CAPABILITY_HINTS: Record<string, Array<{ trigger: string; action: string }>> = {
/* AUTO_PROMOTED_HINTS_START */
  "flight-booking-contact": [
    { trigger: "ticket type drawer not visible", action: "Wait for [data-testid=\"view_fsv2_ticket_option_card_0\"] (TicketOptionCard.tsx anchor), then click [data-testid=\"button_fsv2_ticket_option_select_0\"]. Pattern is button_fsv2_ticket_option_select_${index} where index=0 for first option. NEVER use button_ticket_option_select_1 or ticket-type-drawer — confirmed wrong from www source." },
    { trigger: "ai-fallback triggered for ticket drawer", action: "Root cause: spec used wrong testid. Fix: source selector from TicketOptionCard.tsx via `git show HEAD:packages/flight/fpr-bundle/StackedBundleSummaryTray/TicketOptionsTray/TicketOptionsSection/TicketOptionCard.tsx | grep testID`. Do NOT rely on ai() as primary for this step." },
    { trigger: "www cache is bare repo no working tree", action: "www source at .cache/weekly-diff-repos/github.com_traveloka_www is a BARE git repo. grep -r on filesystem returns nothing. Must use: `git -C .cache/weekly-diff-repos/github.com_traveloka_www show HEAD:<relative-path> | grep testID`. Never guess testids." },
  ],
  "flight-booking-payment": [
    { trigger: "booking chain reached payment successfully", action: "Full booking chain confirmed working 2026-05-29: search → Choose ([data-testid=\"flight-inventory-card-button\"]) → wait view_fsv2_ticket_option_card_0 → Select button_fsv2_ticket_option_select_0 → booking form → contact/traveler fill via ai() → bff-next-page → bff-submit-page → payment. CC form inside #creditCardPaymentFormIframe (cross-origin, use frame.locator). Do NOT submit payment." },
  ],
/* AUTO_PROMOTED_HINTS_END */
};

export const WEEKLY_CAPABILITY_PACKS: CapabilityPack[] = [
  {
    id: 'flight-search-results',
    title: 'Flight search results canary',
    surfaces: ['flight-search'],
    concernClusters: ['search-form', 'results-list', 'date-flow'],
    owningDocs: [
      'docs/weekly-diff-case-generator.md',
      'docs/traveloka-flight-booking-case-generation.md',
    ],
    owningBaselines: [
      'tests/web/traveloka-flight-weekly-diff-generated.spec.ts',
    ],
    sourcePackages: [
      'packages/flight/fpr-search-result-v2',
      'packages/flight/fpr-search-results',
      'packages/flight/app-desktop/pages',
    ],
    entryStrategy: 'Route from shared flight source-map to desktop results surface, not guessed deep links.',
    routePatterns: ['/flight/fullsearch', '/flight/fulltwosearch'],
    criticalSelectors: [
      '[data-testid="desktop-default-form"]',
      '[data-testid="flight-inventory-card-button"]',
      '[data-id="desktop-default-search-button"]',
    ],
    steps: [
      {
        id: 'open-results-surface',
        description: 'Open the stable desktop search or results surface via shared routing.',
        routePattern: '/flight/(fullsearch|fulltwosearch)',
      },
      {
        id: 'search-form-interaction',
        description: 'Exercise the search form or ensure it remains actionable on the results surface.',
        selectors: ['[data-testid="desktop-default-form"]', '[data-id="desktop-default-search-button"]'],
        frameScope: 'main-page',
      },
      {
        id: 'results-card-visible',
        description: 'Verify result cards remain visible and actionable.',
        selectors: ['[data-testid="flight-inventory-card-button"]'],
        frameScope: 'main-page',
      },
    ],
    repairHints: [
      {
        trigger: 'results CTA missing',
        action: 'Re-read the owning WWW sidebar or inventory-card component before changing selectors.',
      },
      {
        trigger: 'route mismatch',
        action: 'Re-check shared route constants and redirects before introducing a new URL.',
      },
    ],
  },
  {
    id: 'flight-filter-airline',
    title: 'Airline and sidebar filter pack',
    surfaces: ['flight-search'],
    concernClusters: ['airline-filter', 'results-list'],
    owningDocs: [
      'docs/weekly-diff-case-generator.md',
    ],
    owningBaselines: [
      'tests/web/traveloka-flight-weekly-diff-20260527.spec.ts',
    ],
    sourcePackages: [
      'packages/flight/fpr-search-result-v2/components/FlightSearchSidebar',
    ],
    entryStrategy: 'Start from stable search results surface, then scope interactions to sidebar-owned filter sections.',
    routePatterns: ['/flight/fullsearch', '/flight/fulltwosearch'],
    criticalSelectors: [
      '[data-testid="flight-search-sidebar-filter"]',
      '[data-id="IcSystemChevronDown"]',
    ],
    steps: [
      {
        id: 'open-sidebar',
        description: 'Find the scoped filter sidebar first, not generic page text.',
        selectors: ['[data-testid="flight-search-sidebar-filter"]'],
      },
      {
        id: 'expand-collapsed-group',
        description: 'Expand the targeted MoreFilterMenu section before clicking nested options.',
        selectors: ['[data-id="IcSystemChevronDown"]'],
      },
    ],
    repairHints: [
      {
        trigger: 'filter row click no-op',
        action: 'Treat accordion expansion and nested option selection as separate steps.',
      },
    ],
  },
  {
    id: 'flight-booking-contact',
    title: 'Booking contact canary',
    surfaces: ['flight-booking'],
    concernClusters: ['booking-contact'],
    owningDocs: [
      'docs/traveloka-flight-booking-case-generation.md',
    ],
    owningBaselines: [
      'tests/web/traveloka-flight-booking-weekly-diff-20260527.spec.ts',
    ],
    sourcePackages: [
      'packages/flight/fpr-booking',
      'packages/flight/fpr-booking-desktop',
    ],
    entryStrategy: 'Reach booking from search results chain instead of hardcoding a booking URL.',
    routePatterns: ['/flight/booking'],
    criticalSelectors: [
      '[data-testid="bff-next-page"]',
      '[data-testid="bff-submit-page"]',
      '[data-testid="contact_form_chunk2_save_button"]',
    ],
    steps: [
      {
        id: 'open-booking-from-results',
        description: 'Use Choose then Select to land on booking. Ticket option drawer anchor: view_fsv2_ticket_option_card_0. Select button: button_fsv2_ticket_option_select_${index} (index=0).',
        selectors: ['[data-testid="flight-inventory-card-button"]', '[data-testid="view_fsv2_ticket_option_card_0"]', '[data-testid="button_fsv2_ticket_option_select_0"]'],
      },
      {
        id: 'fill-contact',
        description: 'Fill contact and traveler chunks using WWW-derived contracts.',
        selectors: ['[data-testid="contact_form_chunk2_save_button"]', '[data-testid="bff-next-page"]'],
      },
      {
        id: 'submit-booking',
        description: 'Use authoritative booking submit CTA.',
        selectors: ['[data-testid="bff-submit-page"]'],
      },
    ],
    repairHints: [
      {
        trigger: 'contact fields drift',
        action: 'Refresh the booking contract from fpr-booking source rather than using placeholder selectors.',
      },
      {
        trigger: 'ticket type drawer not found',
        action: 'Confirmed www source (TicketOptionCard.tsx): wait for [data-testid="view_fsv2_ticket_option_card_0"], then click [data-testid="button_fsv2_ticket_option_select_0"]. NEVER use button_ticket_option_select_1 or ticket-type-drawer — those are wrong.',
      },
    ],
  },
  {
    id: 'flight-booking-payment',
    title: 'Booking to payment handoff pack',
    surfaces: ['flight-booking', 'payment-selection'],
    concernClusters: ['booking-contact', 'payment-chain'],
    owningDocs: [
      'docs/traveloka-flight-booking-payment-chain-lock.md',
      'docs/traveloka-flight-booking-case-generation.md',
    ],
    owningBaselines: [
      'tests/web/traveloka-flight-booking-payment-e2e.spec.ts',
    ],
    sourcePackages: [
      'packages/flight/fpr-booking',
      'packages/payment/pay-desktop-selection-v2',
      'packages/payment/app-desktop',
    ],
    entryStrategy: 'Start from results, walk the proven booking chain, then validate the dynamic handoff into payment selection.',
    routePatterns: ['/flight/booking', '/payment/v2/selection', '/payment/selection'],
    criticalSelectors: [
      '[data-testid="bff-submit-page"]',
      '[data-testid*="paymentOptionGroup-Credit Card"]',
      '#creditCardPaymentFormIframe',
      '[data-testid="paymentPayButton"]',
    ],
    steps: [
      {
        id: 'booking-submit-loop',
        description: 'Drive the booking submit loop until a payment-selection handoff appears.',
        selectors: ['[data-testid="bff-submit-page"]'],
        routePattern: '/payment/(v2/)?selection',
      },
      {
        id: 'select-credit-card',
        description: 'Select credit card payment option from the payment selection app.',
        selectors: ['[data-testid*="paymentOptionGroup-Credit Card"]'],
        frameScope: 'main-page',
      },
      {
        id: 'fill-iframe-form',
        description: 'Interact with the payform iframe and reload it with referer when needed.',
        selectors: ['#creditCardPaymentFormIframe'],
        frameScope: 'iframe',
      },
      {
        id: 'submit-payment',
        description: 'Use the bottom main-page paymentPayButton after card details are present.',
        selectors: ['[data-testid="paymentPayButton"]'],
        frameScope: 'main-page',
      },
    ],
    repairHints: [
      {
        trigger: 'iframe loads but fields inaccessible',
        action: 'Re-apply frame.goto with referer using the current payment URL.',
      },
      {
        trigger: 'pay CTA missing inside iframe',
        action: 'Check the main page bottom CTA before assuming the iframe contract changed.',
      },
      {
        trigger: 'payment URL mismatch',
        action: 'Validate route family only; never hardcode invoiceId or auth tokens.',
      },
    ],
  },
];

export function listCapabilityPackIds(): string[] {
  return WEEKLY_CAPABILITY_PACKS.map((pack) => pack.id);
}

export function findCapabilityPackById(id: string): CapabilityPack | undefined {
  return WEEKLY_CAPABILITY_PACKS.find((pack) => pack.id === id);
}

export function findCapabilityPackByIdWithFeedback(id: string): CapabilityPack | undefined {
  const pack = findCapabilityPackById(id);
  if (!pack) {
    return undefined;
  }

  const withFeedback = applyFeedbackToCapabilityPack(pack, readWeeklyCapabilityFeedbackOverlay());
  const withLearning = applyLearningMemoryToCapabilityPack(withFeedback, readWeeklyLearningMemory());
  const promotedHints = AUTO_PROMOTED_CAPABILITY_HINTS[id] ?? [];
  if (promotedHints.length === 0) {
    return withLearning;
  }

  return {
    ...withLearning,
    repairHints: [...withLearning.repairHints, ...promotedHints],
  };
}