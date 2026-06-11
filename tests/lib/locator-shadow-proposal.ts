import type { Page, TestInfo } from '@playwright/test';

type AiQueryFn = <T = unknown>(prompt: string) => Promise<T>;

export type LocatorShadowProposalInput = {
  page: Page;
  testInfo: TestInfo;
  aiQuery?: AiQueryFn;
  stepName: string;
  contractDescription: string;
  expectedContracts: string[];
  analysisPrompt: string;
  scopeHint?: string;
};

type LocatorShadowProposalArtifact = {
  kind: 'locator-shadow-proposal';
  capturedAt: string;
  currentUrl: string;
  stepName: string;
  contractDescription: string;
  expectedContracts: string[];
  scopeHint?: string;
  analysisPrompt: string;
  proposal: unknown;
  proposalError?: string;
};

export async function attachLocatorShadowProposal({
  page,
  testInfo,
  aiQuery,
  stepName,
  contractDescription,
  expectedContracts,
  analysisPrompt,
  scopeHint,
}: LocatorShadowProposalInput): Promise<void> {
  const artifact: LocatorShadowProposalArtifact = {
    kind: 'locator-shadow-proposal',
    capturedAt: new Date().toISOString(),
    currentUrl: page.url(),
    stepName,
    contractDescription,
    expectedContracts,
    scopeHint,
    analysisPrompt,
    proposal: null,
  };

  const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
  if (screenshot) {
    await testInfo.attach(`${stepName}-shadow-proposal.png`, {
      body: screenshot,
      contentType: 'image/png',
    });
  }

  if (aiQuery) {
    const prompt = [
      'Do NOT click or modify the page. This is post-failure diagnosis only.',
      `Step: ${stepName}`,
      `Missing contract: ${contractDescription}`,
      `Expected explicit contracts: ${expectedContracts.join(' | ')}`,
      scopeHint ? `Scope hint: ${scopeHint}` : null,
      `Task: ${analysisPrompt}`,
      'Return compact JSON with keys: likelyTarget, visibleText, containerHint, reason, confidence.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      artifact.proposal = await aiQuery(prompt);
    } catch (error) {
      artifact.proposalError = error instanceof Error ? error.message : String(error);
    }
  }

  await testInfo.attach(`${stepName}-shadow-proposal.json`, {
    body: Buffer.from(JSON.stringify(artifact, null, 2)),
    contentType: 'application/json',
  });

  console.warn(
    `[shadow-proposal] ${stepName}: missing explicit locator contract for ${contractDescription}`,
  );
}