export type FlightSurface = 'search-entry' | 'search-results' | 'booking';

export type FlightConcern =
  | 'search-form'
  | 'results-list'
  | 'transit-filter'
  | 'airline-filter'
  | 'date-flow'
  | 'booking-contact';

export type SourceHint = {
  sourcePath: string;
  reason: string;
};

export type FlightSourceContext = {
  product: 'flight';
  repository: string;
  surface: FlightSurface;
  concerns: FlightConcern[];
  sourceHints: SourceHint[];
  filterKeys: string[];
  optionKeys: string[];
  userIntent: string;
  url: string;
};

export const DEFAULT_FLIGHT_RESULTS_URL =
  'https://www.traveloka.com/en-sg/flight/fulltwosearch?ap=SIN.JKTA&dt=20-5-2026.22-5-2026&ps=1.0.0&sc=ECONOMY';

// Keep Traveloka's public web repo pinned here so future cases can route from
// a user URL + intent to the most likely owning source module first.
export const TRAVELOKA_WWW_REPOSITORY = 'https://github.com/traveloka/www';

const FLIGHT_BOOKING_SOURCE_HINTS: SourceHint[] = [
  {
    sourcePath: 'packages/flight/fpr-booking/components/BFFBookingContact/BFFBookingContactForm.tsx',
    reason: 'Desktop booking contact form component owning email, name, and mobile fields.',
  },
  {
    sourcePath: 'packages/flight/fpr-booking/handlers/bookingContactValidationHandler.ts',
    reason: 'Booking contact validation handler driving field-level error rules.',
  },
];

const FLIGHT_RESULTS_SOURCE_HINTS: Record<FlightConcern, SourceHint[]> = {
  'search-form': [
    {
      sourcePath:
        'packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx',
      reason: 'Desktop flight results filter sidebar component for the current v2 surface.',
    },
  ],
  'results-list': [
    {
      sourcePath:
        'packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx',
      reason: 'Closest verified results-page component discovered for current desktop flight surface.',
    },
  ],
  'transit-filter': [
    {
      sourcePath:
        'packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx',
      reason: 'Contains the transitCount and transitPoints filter state used by the desktop results sidebar.',
    },
    {
      sourcePath:
        'packages/flight/fpr-search-result-v2/hooks/__tests__/useFilterChangeHandler.test.js',
      reason: 'Verifies transitCount values such as DIRECT and ONE_TRANSIT, which anchor option semantics.',
    },
  ],
  'airline-filter': [
    {
      sourcePath:
        'packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx',
      reason: 'Desktop results sidebar owns airline and other facet rendering.',
    },
  ],
  'date-flow': [
    {
      sourcePath:
        'packages/flight/fpr-search-result-v2/components/FlightSearchSidebar/FlightSearchSidebarFilter.tsx',
      reason: 'Closest verified desktop results component for date-flow and filter interactions.',
    },
  ],
  'booking-contact': FLIGHT_BOOKING_SOURCE_HINTS,
};

const concernKeywords: Array<[FlightConcern, RegExp]> = [
  ['transit-filter', /\b(transit|stop|layover)\b/i],
  ['airline-filter', /\b(airline|carrier)\b/i],
  ['date-flow', /\b(date|calendar|depart|return)\b/i],
  ['results-list', /\b(result|flight list|price|sort)\b/i],
  ['booking-contact', /\b(booking|contact|email|passenger detail|name|mobile|validation)\b/i],
  ['search-form', /\b(search|origin|destination|passenger|round-trip|one-way)\b/i],
];

const resultsPathIndicators = [
  /fpr-search-result-v2/i,
  /flightsearchsidebarfilter/i,
  /filter/i,
  /result/i,
  /fare/i,
  /price/i,
  /sort/i,
  /airline/i,
  /transit/i,
  /layover/i,
  /carrier/i,
];

const bookingPathIndicators = [
  /fpr-booking/i,
  /bookingcontact/i,
  /travelerdetail/i,
  /booking.*validation/i,
  /payment/i,
  /checkout/i,
];

export function inferFlightCanonicalUrlFromFiles(filePaths: string[]): string {
  const normalized = filePaths.map((filePath) => filePath.toLowerCase());
  const pointsToResultsSurface = normalized.some((filePath) =>
    resultsPathIndicators.some((pattern) => pattern.test(filePath)),
  );
  const pointsToBookingChain = normalized.some((filePath) =>
    bookingPathIndicators.some((pattern) => pattern.test(filePath)),
  );

  if (pointsToResultsSurface || pointsToBookingChain) {
    return DEFAULT_FLIGHT_RESULTS_URL;
  }

  return DEFAULT_FLIGHT_RESULTS_URL;
}

export function buildFlightSourceContextFromFiles(filePaths: string[], userIntent = ''): FlightSourceContext {
  const url = inferFlightCanonicalUrlFromFiles(filePaths);
  return buildFlightSourceContext(url, userIntent);
}

export function inferFlightSurface(url: string): FlightSurface {
  const { pathname } = new URL(url);

  if (/\/flight\/(fullsearch|fulltwosearch)/.test(pathname)) {
    return 'search-results';
  }

  if (/\/flight\/booking/.test(pathname)) {
    return 'booking';
  }

  return 'search-entry';
}

export function buildFlightSourceContext(url: string, userIntent = ''): FlightSourceContext {
  const surface = inferFlightSurface(url);
  const concerns = new Set<FlightConcern>();

  for (const [concern, pattern] of concernKeywords) {
    if (pattern.test(userIntent)) {
      concerns.add(concern);
    }
  }

  if (surface === 'search-results') {
    concerns.add('results-list');
  }

  if (surface === 'booking') {
    concerns.add('booking-contact');
  }

  if (concerns.size === 0) {
    if (surface === 'search-results') {
      concerns.add('results-list');
    } else if (surface === 'booking') {
      concerns.add('booking-contact');
    } else {
      concerns.add('search-form');
    }
  }

  const orderedConcerns = Array.from(concerns);
  // Keep the source narrowing deterministic: URL decides the surface, intent
  // words decide the concern, and concern decides the first code locations.
  const sourceHints = orderedConcerns.flatMap((concern) => FLIGHT_RESULTS_SOURCE_HINTS[concern] ?? []);
  const filterKeys = orderedConcerns.includes('transit-filter')
    ? ['transitCount', 'transitPoints']
    : [];
  const optionKeys = orderedConcerns.includes('transit-filter')
    ? ['DIRECT', 'ONE_TRANSIT', 'TWO_PLUS_TRANSIT']
    : [];

  return {
    product: 'flight',
    repository: TRAVELOKA_WWW_REPOSITORY,
    surface,
    concerns: orderedConcerns,
    sourceHints,
    filterKeys,
    optionKeys,
    userIntent,
    url,
  };
}