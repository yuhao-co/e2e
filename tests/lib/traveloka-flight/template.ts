import { type FlightConcern } from './source-map';
import { normalizeFlightUserIntent } from './intent';

export type FlightCaseTemplateInput = {
  testName: string;
  url: string;
  userIntent: string;
  concerns?: FlightConcern[];
  assertionLines?: string[];
  interactionLines?: string[];
};

function indent(lines: string[], spaces = 4) {
  const pad = ' '.repeat(spaces);
  return lines.map((line) => `${pad}${line}`).join('\n');
}

export function createFlightCaseTemplate(input: FlightCaseTemplateInput): string {
  const normalized = normalizeFlightUserIntent({
    url: input.url,
    userIntent: input.userIntent,
  });
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

  const importBlock = useSearchWorkflow
    ? `import { expect, test } from './fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightSearchTask,
  restoreFlightSession,
} from './lib/traveloka-flight/workflow';`
    : `import { expect, test } from './fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightResultsPage,
  restoreFlightSession,
  runFlightWorkflow,
} from './lib/traveloka-flight/workflow';`;

  const navigationBlock = useSearchWorkflow
    ? `  await restoreFlightSession(page);

  const { sidebar } = await openFlightSearchTask(page, {
    url: workflowPlan.input.url,
    userIntent: ${JSON.stringify(normalized.rawUserIntent)},
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

const TARGET_URL = '${input.url}';

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