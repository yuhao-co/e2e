import { OracleBundle } from './weekly-quality-types';

export const WEEKLY_ORACLE_BUNDLES: OracleBundle[] = [
  {
    id: 'flight-search-route-health',
    title: 'Search route and result health',
    appliesTo: ['search-form', 'results-list', 'date-flow'],
    checks: [
      {
        id: 'search-route-family',
        kind: 'route-pattern',
        description: 'Page remains on a valid flight search route family.',
        severity: 'P1',
        routePattern: '/flight/(fullsearch|fulltwosearch)',
      },
      {
        id: 'results-cta-visible',
        kind: 'element-visible',
        description: 'At least one results CTA remains visible.',
        severity: 'P1',
        selector: '[data-testid="flight-inventory-card-button"]',
      },
      {
        id: 'restricted-page-absent',
        kind: 'restricted-page-absent',
        description: 'Traveloka block or restricted page is not rendered.',
        severity: 'P0',
      },
      {
        id: 'fatal-console-errors',
        kind: 'console-health',
        description: 'No fatal console failures around the search slice.',
        severity: 'P2',
      },
    ],
  },
  {
    id: 'flight-filter-oracles',
    title: 'Filter interaction and sidebar integrity',
    appliesTo: ['airline-filter'],
    checks: [
      {
        id: 'sidebar-visible',
        kind: 'element-visible',
        description: 'Sidebar filter root remains visible.',
        severity: 'P1',
        selector: '[data-testid="flight-search-sidebar-filter"]',
      },
      {
        id: 'filter-actionable',
        kind: 'element-actionable',
        description: 'A scoped filter expansion control remains actionable.',
        severity: 'P1',
        selector: '[data-id="IcSystemChevronDown"]',
      },
    ],
  },
  {
    id: 'booking-contact-oracles',
    title: 'Booking contact and submit integrity',
    appliesTo: ['booking-contact'],
    checks: [
      {
        id: 'booking-route-family',
        kind: 'route-pattern',
        description: 'Workflow lands on the booking route family.',
        severity: 'P1',
        routePattern: '/flight/booking',
      },
      {
        id: 'booking-submit-visible',
        kind: 'element-visible',
        description: 'Authoritative booking submit CTA remains visible.',
        severity: 'P1',
        selector: '[data-testid="bff-submit-page"]',
      },
      {
        id: 'booking-submit-actionable',
        kind: 'element-actionable',
        description: 'Authoritative booking submit CTA remains actionable.',
        severity: 'P0',
        selector: '[data-testid="bff-submit-page"]',
      },
    ],
  },
  {
    id: 'payment-chain-oracles',
    title: 'Booking to payment handoff integrity',
    appliesTo: ['payment-chain', 'booking-contact'],
    checks: [
      {
        id: 'payment-handoff-detected',
        kind: 'handoff-detected',
        description: 'Booking submit causes handoff into payment selection.',
        severity: 'P0',
        routePattern: '/payment/(v2/)?selection',
      },
      {
        id: 'credit-card-option-visible',
        kind: 'element-visible',
        description: 'Credit card option remains visible on payment selection.',
        severity: 'P1',
        selector: '[data-testid*="paymentOptionGroup-Credit Card"]',
      },
      {
        id: 'payment-pay-button-visible',
        kind: 'element-visible',
        description: 'Main-page paymentPayButton remains visible.',
        severity: 'P0',
        selector: '[data-testid="paymentPayButton"]',
      },
      {
        id: 'payment-network-health',
        kind: 'network-health',
        description: 'No payment-related 4xx or 5xx failure dominates the run.',
        severity: 'P0',
        networkPattern: '(payment|checkout|pay)',
      },
      {
        id: 'payment-step-timing',
        kind: 'timing-budget',
        description: 'Payment handoff completes within a bounded budget.',
        severity: 'P2',
        timingBudgetMs: 30000,
      },
    ],
  },
];

export function findOracleBundlesForConcerns(concerns: string[]): OracleBundle[] {
  return WEEKLY_ORACLE_BUNDLES.filter((bundle) =>
    bundle.appliesTo.some((concern) => concerns.includes(concern)),
  );
}