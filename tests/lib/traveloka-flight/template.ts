import { type FlightConcern } from './source-map';
import { normalizeFlightUserIntent } from './intent';

export type FlightCaseTemplateInput = {
  testName: string;
  url: string;
  userIntent: string;
  importPrefix?: string;
  extraImportBlock?: string;
  concerns?: FlightConcern[];
  sourceCommitLines?: string[];
  sourceSummaryLines?: string[];
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
  const sourceCommitLines = input.sourceCommitLines ?? [];
  const sourceSummaryLines = input.sourceSummaryLines ?? [];
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

test('${input.testName}', async ({ page, ai }, testInfo) => {
  // ai = Midscene visual AI (MLX local model); used as fallback when data-id/data-testid is absent.
  // clickByIdOrAi(page, root, id, description, ai) tries data-id first, then ai().
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