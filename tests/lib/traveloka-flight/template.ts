import { type FlightConcern } from './source-map';
import { normalizeFlightUserIntent } from './intent';

export type FlightCaseTemplateInput = {
  testName: string;
  url: string;
  userIntent: string;
  importPrefix?: string;
  extraImportBlock?: string;
  concerns?: FlightConcern[];
  assertionLines?: string[];
  interactionLines?: string[];
};

function indent(lines: string[], spaces = 4) {
  const pad = ' '.repeat(spaces);
  return lines.map((line) => `${pad}${line}`).join('\n');
}

function toCommentLines(lines: string[]) {
  return lines.map((line) => ` * ${line}`).join('\n');
}

export function createFlightCaseTemplate(input: FlightCaseTemplateInput): string {
  const normalized = normalizeFlightUserIntent({
    url: input.url,
    userIntent: input.userIntent,
  });
  const importPrefix = input.importPrefix ?? './';
  const concerns = input.concerns?.length ? input.concerns : normalized.concerns;
  const assertions = input.assertionLines?.length
    ? input.assertionLines
    : [
        'const currentUrl = new URL(page.url());',
        "expect(currentUrl.pathname).toBe(new URL(TARGET_URL).pathname);",
      ];
  const interactions = input.interactionLines?.length
    ? input.interactionLines
    : [
        '// Add page-specific interactions here.',
      ];
  const useSearchWorkflow = normalized.surface === 'search-results';
  const caseSummaryBlock = `/**
${toCommentLines([
  `Generated weekly flight regression case for: ${normalized.rawUserIntent}`,
  `Surface: ${normalized.surface}`,
  `Concerns: ${concerns.join(', ')}`,
  'Expectation: keep the generated case aligned with the stable Traveloka desktop baseline flow and verify only the routed regression slice.',
])}
 */`;
  const testUseBlock = `test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'Asia/Shanghai',
  extraHTTPHeaders: {
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.google.com/',
  },
});`;

  const importBlock = useSearchWorkflow
    ? `import { expect, test } from '${importPrefix}fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
} from '${importPrefix}lib/traveloka-flight/workflow';`
    : `import { expect, test } from '${importPrefix}fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightResultsPage,
  restoreFlightSession,
  runFlightWorkflow,
} from '${importPrefix}lib/traveloka-flight/workflow';`;

  const navigationBlock = useSearchWorkflow
    ? `  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: ${JSON.stringify(normalized.rawUserIntent)},
    concerns: ${JSON.stringify(concerns)},
    waitForSidebar: ${JSON.stringify(
      concerns.includes('results-list') || concerns.some((concern) => concern.endsWith('filter')),
    )},
  });

  void sidebar;`
    : `  await runFlightWorkflow(page, testInfo, [
    {
      name: 'apply-session-state',
      action: async () => {
        await restoreFlightSession(page);
      },
    },
    {
      name: 'open-target-page',
      action: async () => {
        await openFlightResultsPage(page, workflowPlan.input.url);
      },
    },
  ]);`;

  return `${importBlock}
${input.extraImportBlock ? `
${input.extraImportBlock}` : ''}

const TARGET_URL = '${input.url}';

${caseSummaryBlock}

${testUseBlock}

test('${input.testName}', async ({ page }, testInfo) => {
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: ${JSON.stringify(normalized.rawUserIntent)},
    concerns: ${JSON.stringify(concerns)},
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

${navigationBlock}

${indent(assertions, 2)}

${indent(interactions, 2)}
});
`;
}