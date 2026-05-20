import { type FlightConcern, inferFlightSurface } from './source-map';

export type FlightIntentInput = {
  url: string;
  userIntent: string;
};

export type NormalizedFlightIntent = {
  rawUserIntent: string;
  canonicalIntent: string;
  promptIntent: string;
  surface: ReturnType<typeof inferFlightSurface>;
  concerns: FlightConcern[];
  localeHints: string[];
};

const concernRules: Array<[FlightConcern, RegExp]> = [
  ['transit-filter', /\b(transit|stop|layover)\b/i],
  ['airline-filter', /\b(airline|carrier)\b/i],
  ['date-flow', /\b(date|calendar|depart|return)\b/i],
  ['results-list', /\b(result|list|price|fare|sort)\b/i],
  ['search-form', /\b(search|origin|destination|passenger|round-trip|one-way)\b/i],
];

const localeRules: Array<[string, RegExp]> = [
  ['desktop', /desktop|web/i],
  ['mobile', /mobile|app|android|ios/i],
  ['filter', /filter|facet/i],
  ['results', /results|result page/i],
];

function toCanonicalSentence(userIntent: string, url: string) {
  const normalized = userIntent
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。！？]+$/u, '');

  return [
    'Interpret this as a Traveloka flight automation task.',
    `User intent: ${normalized || 'Open the target flight page and validate the requested behavior.'}`,
    `Target URL: ${url}`,
    'Rewrite the task into precise test-oriented English before choosing locators or assertions.',
  ].join(' ');
}

export function normalizeFlightUserIntent(input: FlightIntentInput): NormalizedFlightIntent {
  const surface = inferFlightSurface(input.url);
  const concerns = concernRules
    .filter(([, pattern]) => pattern.test(input.userIntent))
    .map(([concern]) => concern);
  const localeHints = localeRules
    .filter(([, pattern]) => pattern.test(input.userIntent))
    .map(([hint]) => hint);

  if (surface === 'search-results' && !concerns.includes('results-list')) {
    concerns.push('results-list');
  }

  if (concerns.length === 0) {
    concerns.push(surface === 'search-results' ? 'results-list' : 'search-form');
  }

  const canonicalIntent = toCanonicalSentence(input.userIntent, input.url);

  return {
    rawUserIntent: input.userIntent,
    canonicalIntent,
    // This is the stable internal phrasing fed into source routing and future
    // test generation so different user wording collapses into one house style.
    promptIntent: canonicalIntent,
    surface,
    concerns,
    localeHints,
  };
}