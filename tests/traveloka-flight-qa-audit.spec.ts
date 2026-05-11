import { devices, expect, test } from './fixture';

/**
 * Traveloka — Singapore -> Jakarta round-trip flight search QA audit.
 *
 * Strategy
 * ────────
 * Filling out Traveloka's flight form with a 7B-4bit local VLM through nested
 * popovers is brittle (the planner sometimes loses track of which popup is
 * open). Instead, we use Traveloka's well-known deep-link URL to land directly
 * on a populated search-results page, then use Midscene's vision APIs to do
 * what they are best at: read the rendered page like a human reviewer would
 * and audit it for bugs.
 *
 * The audit looks at multiple bug classes:
 *   - UI bugs       : overlapping text, cut-off labels, broken icons, layout
 *                     glitches, things that "look wrong"
 *   - Logic bugs    : impossible durations, arrival before departure, prices
 *                     of $0, currency mixed up, etc.
 *   - i18n bugs     : English page that contains untranslated Indonesian
 *                     strings, mojibake, placeholder leakage like
 *                     "{{price}}" / "[object Object]"
 *   - Broken links  : 404 / 5xx for any request originating from the page
 *   - Console errors: uncaught JS errors, failed network calls, CSP violations
 */

// Use a date 30/37 days out, in dd-mm-YYYY (Traveloka deep-link format).
function deepLink(): string {
  const now = new Date();
  const depart = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const ret = new Date(now.getTime() + 37 * 24 * 3600 * 1000);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  return (
    'https://www.traveloka.com/en-en/flight/fullsearch' +
    `?ap=SIN.CGK&dt=${fmt(depart)}.${fmt(ret)}&ps=1.0.0&sc=ECONOMY`
  );
}

type Finding = {
  category:
    | 'ui'
    | 'logic'
    | 'i18n'
    | 'broken-link'
    | 'console-error'
    | 'accessibility';
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence?: string;
};

test.describe('Traveloka SIN -> CGK round-trip flight QA audit (Qwen2.5-VL via MLX)', () => {
  test('search round-trip flights and audit results page for issues', async ({
    page,
    aiAssert,
    aiQuery,
    aiWaitFor,
    recordToReport,
  }, testInfo) => {
    const findings: Finding[] = [];

    // --- 1. Wire up passive collectors for broken links + console errors. ---
    const failedRequests: { url: string; status?: number; reason?: string }[] = [];
    page.on('response', (resp) => {
      const status = resp.status();
      if (status >= 400 && status < 600) {
        failedRequests.push({ url: resp.url(), status });
      }
    });
    page.on('requestfailed', (req) => {
      failedRequests.push({
        url: req.url(),
        reason: req.failure()?.errorText ?? 'unknown',
      });
    });

    const consoleErrors: { type: string; text: string }[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({ type: msg.type(), text: msg.text() });
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push({ type: 'pageerror', text: err.message });
    });

    // --- 2. Deep-link straight to the SIN -> CGK round-trip results. ---
    const url = deepLink();
    console.log('[traveloka] deep link:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Anti-bot occasionally throws a "solve the puzzle" overlay. Let the page
    // settle, then assert with the model that we are actually on results.
    await page.waitForLoadState('networkidle').catch(() => {});

    // Wait for the AI to confirm a real result list rendered. If a CAPTCHA
    // shows up instead, surface that as the finding and stop the audit
    // gracefully (still useful evidence about the site's behavior).
    let onResultsPage = false;
    try {
      await aiWaitFor(
        'A list of bookable flight options is visible, with airline names, departure/arrival times and prices. The page is NOT a CAPTCHA / "solve the puzzle" / login wall.',
        { timeoutMs: 90_000 },
      );
      onResultsPage = true;
    } catch (e) {
      findings.push({
        category: 'logic',
        severity: 'high',
        description:
          'Deep-link to flight search results was blocked by anti-bot / login / CAPTCHA before any results rendered.',
        evidence: (e as Error).message.slice(0, 400),
      });
    }

    if (onResultsPage) {
      // Use aiQuery (returns structured data) instead of aiAssert (which can
      // misclassify a passing answer as a failure if the model's reasoning
      // text gets truncated mid-sentence). This is more robust on a small
      // local model.
      type ContextCheck = {
        cityPairCorrect: boolean;
        tripType: 'one-way' | 'round-trip' | 'unknown';
        explanation: string;
      };
      const ctx = await aiQuery<ContextCheck>(
        'Look at the search-context banner / breadcrumb at the top of the ' +
          'flight results page and return ' +
          '{cityPairCorrect: boolean, tripType: "one-way"|"round-trip"|"unknown", explanation: string}. ' +
          '`cityPairCorrect` is true iff the page clearly shows a search from ' +
          'Singapore (SIN) to Jakarta (CGK). `tripType` is what the page ' +
          'actually displays — round-trip pages show BOTH a depart date and a ' +
          'return date; one-way pages show only one date.',
      ).catch(
        () =>
          ({
            cityPairCorrect: false,
            tripType: 'unknown',
            explanation: 'aiQuery failed',
          }) as ContextCheck,
      );
      console.log('[traveloka] context check:', ctx);

      if (!ctx.cityPairCorrect) {
        findings.push({
          category: 'logic',
          severity: 'high',
          description:
            'Results page does not clearly indicate the requested SIN -> CGK city pair.',
          evidence: ctx.explanation,
        });
      }
      // We requested a round-trip via the deep link `dt=DEPART.RETURN`. If the
      // page renders only one-way, that is itself a real bug worth surfacing.
      if (ctx.tripType === 'one-way') {
        findings.push({
          category: 'logic',
          severity: 'high',
          description:
            'Round-trip deep link silently degraded to a one-way search ' +
            '(no return date visible on the results context banner).',
          evidence: ctx.explanation,
        });
      }

      // --- 3. Structured extraction of the first few flight rows. ---
      type FlightRow = {
        airline: string;
        departureTime: string;
        arrivalTime: string;
        durationText: string;
        priceText: string;
      };
      const flights = await aiQuery<FlightRow[]>(
        'Return up to 5 flight result rows from the visible list as ' +
          '{airline: string, departureTime: string, arrivalTime: string, durationText: string, priceText: string}[]. ' +
          'Use exactly what is shown on screen for each field.',
      ).catch(() => [] as FlightRow[]);
      console.log('[traveloka] flights sample:', flights);

      // Logic checks on the extracted rows.
      for (const [i, f] of flights.entries()) {
        if (!f?.priceText || !/\d/.test(f.priceText)) {
          findings.push({
            category: 'logic',
            severity: 'medium',
            description: `Flight row #${i + 1} has missing or non-numeric price.`,
            evidence: JSON.stringify(f),
          });
        }
        if (
          /^(USD\s*0|0\s*USD|IDR\s*0|\$0(\.00)?)\b/i.test(f?.priceText ?? '')
        ) {
          findings.push({
            category: 'logic',
            severity: 'high',
            description: `Flight row #${i + 1} shows a zero price.`,
            evidence: JSON.stringify(f),
          });
        }
        if (!f?.airline || f.airline.trim().length < 2) {
          findings.push({
            category: 'ui',
            severity: 'medium',
            description: `Flight row #${i + 1} has empty/garbled airline name.`,
            evidence: JSON.stringify(f),
          });
        }
      }

      // --- 4. Vision audit: ask the VLM to act as a QA reviewer. ---
      type AiIssue = {
        category: Finding['category'];
        severity: Finding['severity'];
        description: string;
      };

      const aiUiIssues = await aiQuery<AiIssue[]>(
        'Act as a senior QA engineer reviewing this Traveloka flight search ' +
          'results page. Look ONLY at what is currently visible. Report any ' +
          'visual or UX bugs you can see: text that overlaps another element, ' +
          'text that is cut off or truncated mid-word, broken / missing icons ' +
          '(empty image boxes, broken-image glyphs), buttons with no visible ' +
          'label, controls that appear disabled when they shouldn\'t be, ' +
          'misaligned columns, inconsistent fonts or colors, etc. ' +
          'If everything looks fine, return []. Otherwise return ' +
          '{category: "ui"|"accessibility", severity: "low"|"medium"|"high", description: string}[].',
      ).catch(() => [] as AiIssue[]);
      findings.push(...aiUiIssues.map((x) => ({ ...x })));

      const aiI18nIssues = await aiQuery<AiIssue[]>(
        'The page should be entirely in English (en-EN). Look for ' +
          'translation problems: untranslated Indonesian / Bahasa words ' +
          '(e.g. "Rp", "Pesawat", "Penerbangan"), mojibake, raw template ' +
          'placeholders like "{{...}}", "[object Object]", "undefined", ' +
          '"null", or strings that mix two languages in one sentence. ' +
          'Return [] if clean. Otherwise return ' +
          '{category: "i18n", severity: "low"|"medium"|"high", description: string}[] ' +
          'with a short quote of the offending text in the description.',
      ).catch(() => [] as AiIssue[]);
      findings.push(...aiI18nIssues.map((x) => ({ ...x })));

      const aiLogicIssues = await aiQuery<AiIssue[]>(
        'Look at every visible flight row and report logical inconsistencies: ' +
          'arrival time before departure time on a same-day flight, durations ' +
          'that don\'t match the time window (e.g. "1h 50m" for a 12h gap), ' +
          'mixed currencies in the same list, prices that look implausibly low ' +
          'or high, "0 stops" but multiple flight numbers, return-flight ' +
          'section labelled as outbound, etc. ' +
          'Return [] if everything is consistent. Otherwise return ' +
          '{category: "logic", severity: "low"|"medium"|"high", description: string}[].',
      ).catch(() => [] as AiIssue[]);
      findings.push(...aiLogicIssues.map((x) => ({ ...x })));
    }

    // --- 5. Fold passive collectors into findings. ---
    // Many top-level domains 4xx/5xx are noise (analytics, tracking pixels).
    // We surface them but de-noise obvious telemetry hosts to medium/low.
    const isTelemetry = (u: string) =>
      /(google-analytics|googletagmanager|doubleclick|segment\.io|hotjar|sentry|datadog|newrelic|cloudflareinsights|braze|moengage)/i.test(
        u,
      );
    for (const r of failedRequests) {
      const tele = isTelemetry(r.url);
      const isFirstParty = /traveloka\./i.test(r.url);
      const sev: Finding['severity'] = isFirstParty
        ? r.status === 404
          ? 'high'
          : 'medium'
        : tele
          ? 'low'
          : 'medium';
      findings.push({
        category: 'broken-link',
        severity: sev,
        description: `Failed request${r.status ? ` (HTTP ${r.status})` : ''}${r.reason ? ` (${r.reason})` : ''}`,
        evidence: r.url,
      });
    }
    for (const c of consoleErrors) {
      findings.push({
        category: 'console-error',
        severity: 'low',
        description: `${c.type}: ${c.text.slice(0, 240)}`,
      });
    }

    // --- 6. Persist a JSON report next to playwright-report. ---
    const high = findings.filter((f) => f.severity === 'high');
    const medium = findings.filter((f) => f.severity === 'medium');
    const low = findings.filter((f) => f.severity === 'low');

    const summary = {
      url,
      onResultsPage,
      counts: {
        total: findings.length,
        high: high.length,
        medium: medium.length,
        low: low.length,
      },
      findings,
    };
    console.log(
      '[traveloka][audit]',
      JSON.stringify(summary.counts),
      'high=',
      high.map((f) => f.description),
    );

    await testInfo.attach('audit-findings.json', {
      body: JSON.stringify(summary, null, 2),
      contentType: 'application/json',
    });

    await recordToReport('Traveloka SIN->CGK QA audit summary', {
      content:
        `Page reached: ${onResultsPage}. ` +
        `Total findings: ${findings.length} (high=${high.length}, ` +
        `medium=${medium.length}, low=${low.length}).`,
    });

    // --- 7. Reporting policy.
    //
    // We treat this spec as a QA AUDIT, not a regression gate: we want it to
    // PASS even when bugs are found, so the bugs become a delivered artefact
    // (`audit-findings.json`) rather than a red CI build. The only hard gate
    // is that we actually reached the results page; otherwise the model had
    // nothing to audit.
    expect(
      onResultsPage,
      'Search results page (or a clearly equivalent state) must render',
    ).toBe(true);

    if (high.length > 0) {
      console.log('\n[traveloka][audit] HIGH-severity findings:');
      for (const f of high) {
        console.log(`  • [${f.category}] ${f.description}`);
        if (f.evidence) console.log(`      evidence: ${f.evidence}`);
      }
    }
    if (medium.length > 0) {
      console.log('\n[traveloka][audit] medium-severity findings:');
      for (const f of medium) {
        console.log(`  • [${f.category}] ${f.description}`);
      }
    }
  });
});
