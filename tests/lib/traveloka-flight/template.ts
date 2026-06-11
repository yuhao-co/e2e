import { type FlightConcern } from './source-map';
import { normalizeFlightUserIntent } from './intent';

export type FlightCaseTemplateInput = {
  testName: string;
  url: string;
  userIntent: string;
  confidence?: 'high' | 'medium' | 'low';
  runtimeRoutingPaths?: string[];
  importPrefix?: string;
  extraImportBlock?: string;
  concerns?: FlightConcern[];
  sourceCommitLines?: string[];
  sourceSummaryLines?: string[];
  assertionLines?: string[];
  interactionLines?: string[];
  actionContracts?: Array<{
    stepName: string;
    scopeHint: string;
    expectedContracts: string[];
    preconditions?: string[];
    postconditions?: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;
};

function indent(lines: string[], spaces = 4) {
  const pad = ' '.repeat(spaces);
  return lines.map((line) => `${pad}${line}`).join('\n');
}

function toCommentLines(lines: string[]) {
  return lines.map((line) => ` * ${line}`).join('\n');
}

function describeConcern(concern: FlightConcern) {
  switch (concern) {
    case 'results-list':
      return {
        en: 'results list visibility and basic result-card rendering',
        zh: '结果列表可见性与基础结果卡片渲染',
      };
    case 'search-form':
      return {
        en: 'deep-link search landing and results-page readiness',
        zh: '深链搜索落地与结果页就绪状态',
      };
    case 'transit-filter':
      return {
        en: 'transit filter behavior and checked-state consistency',
        zh: '中转筛选行为与勾选状态一致性',
      };
    case 'airline-filter':
      return {
        en: 'airline filter behavior and result-airline consistency',
        zh: '航空公司筛选行为与结果航司一致性',
      };
    case 'date-flow':
      return {
        en: 'date-related flow on the flight results surface',
        zh: '机票结果页上的日期相关流程',
      };
    case 'booking-contact':
      return {
        en: 'booking contact form field rendering and validation',
        zh: '预订联系人表单字段渲染与校验',
      };
  }
}

export function createFlightCaseTemplate(input: FlightCaseTemplateInput): string {
  const normalized = normalizeFlightUserIntent({
    url: input.url,
    userIntent: input.userIntent,
  });
  const importPrefix = input.importPrefix ?? './';
  const concerns = input.concerns?.length ? input.concerns : normalized.concerns;
  const runtimeRoutingPaths = input.runtimeRoutingPaths?.length ? input.runtimeRoutingPaths : null;
  const sourceCommitLines = input.sourceCommitLines ?? [];
  const sourceSummaryLines = input.sourceSummaryLines ?? [];
  const actionContracts = input.actionContracts ?? [];
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
  const concernDescriptions = concerns.map(describeConcern);
  const sourceCommitSummary = sourceCommitLines.length
    ? sourceCommitLines.join(' | ')
    : 'No specific commit metadata was attached for this generated case.';
  const sourceSummary = sourceSummaryLines.length
    ? sourceSummaryLines.join(' | ')
    : null;
  const caseConfidence = input.confidence ?? 'medium';
  const actionContractLines = actionContracts.length
    ? [
        `EN Action contract confidence: ${caseConfidence}`,
        `中文动作契约置信度: ${caseConfidence}`,
        ...actionContracts.map(
          (action) =>
            `EN Action ${action.stepName}: scope=${action.scopeHint}; contracts=${action.expectedContracts.join(' | ')}; confidence=${action.confidence}`,
        ),
        ...actionContracts.map(
          (action) =>
            `中文动作 ${action.stepName}: 范围=${action.scopeHint}；契约=${action.expectedContracts.join(' | ')}；置信度=${action.confidence}`,
        ),
      ]
    : [];
  const caseSummaryBlock = `/**
${toCommentLines([
  `EN Purpose: ${normalized.rawUserIntent}`,
  `中文目的: 验证本周 flight 改动在 ${normalized.surface} 场景下是否仍然满足既有回归预期。`,
  `EN Surface: ${normalized.surface}`,
  `中文范围: ${normalized.surface} 页面。`,
  `EN Concerns: ${concerns.join(', ')}`,
  `中文关注点: ${concerns.join('、')}`,
  `EN Main checks: ${concernDescriptions.map((item) => item.en).join('; ')}.`,
  `中文校验项: ${concernDescriptions.map((item) => item.zh).join('；')}。`,
  `EN Source commits: ${sourceCommitSummary}`,
  `中文来源提交: ${sourceCommitSummary}`,
  ...(sourceSummary
    ? [
        `EN Source summary: ${sourceSummary}`,
        `中文来源摘要: ${sourceSummary}`,
      ]
    : []),
  ...actionContractLines,
  'EN Expectation: keep this generated case aligned with the stable Traveloka desktop baseline flow and verify only the routed regression slice.',
  '中文预期: 该生成用例必须与稳定的 Traveloka desktop 基线流程保持一致，只验证本次路由到的回归范围。',
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
  clickByIdOrAi,
} from '${importPrefix}lib/traveloka-flight/workflow';`
    : `import { expect, test } from '${importPrefix}fixture';
import {
  attachFlightWorkflowPlan,
  createFlightWorkflowPlan,
  openFlightResultsPage,
  restoreFlightSession,
  runFlightWorkflow,
  clickByIdOrAi,
} from '${importPrefix}lib/traveloka-flight/workflow';`;
  const runtimeRoutingImportBlock = runtimeRoutingPaths
    ? `import { buildFlightSourceContextFromFiles } from '${importPrefix}lib/traveloka-flight/source-map';`
    : '';
  const targetUrlBlock = runtimeRoutingPaths
    ? `const ROUTED_SOURCE_FILES = ${JSON.stringify(runtimeRoutingPaths, null, 2)};
const TARGET_URL = buildFlightSourceContextFromFiles(
  ROUTED_SOURCE_FILES,
  ${JSON.stringify(normalized.rawUserIntent)},
).url;`
    : `const TARGET_URL = '${input.url}';`;

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

  return `${importBlock}${runtimeRoutingImportBlock ? `
${runtimeRoutingImportBlock}` : ''}
${input.extraImportBlock ? `
${input.extraImportBlock}` : ''}

${targetUrlBlock}

const GENERATED_ACTION_CONTRACTS = ${JSON.stringify(actionContracts, null, 2)};

${caseSummaryBlock}

${testUseBlock}

test('${input.testName}', async ({ page, ai, aiQuery }, testInfo) => {
  // GENERATION MODE: PRD-driven regression spec.
  // Navigation strategy:
  //   - Use explicit www-derived contracts for navigation and form interaction.
  //   - If a required contract is missing at runtime, attach a shadow proposal artifact
  //     via aiQuery() for diagnosis, then fail loudly instead of letting AI continue the flow.
  //   - Keep ai()/aiQuery() as discovery or post-failure analysis tools, not the main executor.
  const workflowPlan = createFlightWorkflowPlan({
    url: TARGET_URL,
    userIntent: ${JSON.stringify(normalized.rawUserIntent)},
    concerns: ${JSON.stringify(concerns)},
  });

  await attachFlightWorkflowPlan(testInfo, workflowPlan);

  if (GENERATED_ACTION_CONTRACTS.length > 0) {
    await testInfo.attach('generated-action-contracts.json', {
      body: Buffer.from(JSON.stringify({
        caseConfidence: ${JSON.stringify(caseConfidence)},
        actionContracts: GENERATED_ACTION_CONTRACTS,
      }, null, 2)),
      contentType: 'application/json',
    });
  }

${navigationBlock}

${indent(assertions, 2)}

${indent(interactions, 2)}
});
`;
}