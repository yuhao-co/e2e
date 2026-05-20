export type FlightSurface = 'search-entry' | 'search-results';

export type FlightConcern =
  | 'search-form'
  | 'results-list'
  | 'transit-filter'
  | 'airline-filter'
  | 'date-flow';

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

// Keep Traveloka's public web repo pinned here so future cases can route from
// a user URL + intent to the most likely owning source module first.
export const TRAVELOKA_WWW_REPOSITORY = 'https://github.com/traveloka/www';

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
};

const concernKeywords: Array<[FlightConcern, RegExp]> = [
  ['transit-filter', /transit|stop|layover/i],
  ['airline-filter', /airline|carrier/i],
  ['date-flow', /date|calendar|depart|return/i],
  ['results-list', /result|flight list|price|sort/i],
  ['search-form', /search|origin|destination|passenger|round-trip|one-way/i],
];

export function inferFlightSurface(url: string): FlightSurface {
  const { pathname } = new URL(url);

  if (/\/flight\/(fullsearch|fulltwosearch)/.test(pathname)) {
    return 'search-results';
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

  if (concerns.size === 0) {
    concerns.add(surface === 'search-results' ? 'results-list' : 'search-form');
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