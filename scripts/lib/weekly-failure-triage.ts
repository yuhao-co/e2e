import * as fs from 'node:fs';
import * as path from 'node:path';
import { WEEKLY_CAPABILITY_PACKS } from './weekly-capability-registry';
import { WeeklyFailureArtifact, WeeklyFailureTriageItem } from './weekly-quality-types';

export interface WeeklyFailureTriageOptions {
  rootDir: string;
}

function walk(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function classifyArtifact(filePath: string): WeeklyFailureArtifact['type'] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('trace.zip')) return 'trace';
  if (lower.endsWith('.png') || lower.includes('screenshot')) return 'screenshot';
  if (lower.endsWith('.webm')) return 'video';
  if (lower.endsWith('error-context.md')) return 'error-context';
  if (lower.endsWith('.log') || lower.endsWith('.txt') || lower.endsWith('.md')) return 'log';
  return 'unknown';
}

function inferProbablePackIds(artifacts: WeeklyFailureArtifact[]): string[] {
  const text = artifacts.map((artifact) => artifact.path).join(' ').toLowerCase();
  const matches = WEEKLY_CAPABILITY_PACKS
    .filter((pack) =>
      pack.concernClusters.some((cluster) => text.includes(cluster))
        || pack.id.split('-').some((token) => token.length > 3 && text.includes(token)),
    )
    .map((pack) => pack.id);

  if (matches.length > 0) {
    return matches;
  }

  if (/(payment|checkout|creditcard|pay)/i.test(text)) {
    return ['flight-booking-payment'];
  }

  if (/(booking|traveler|contact)/i.test(text)) {
    return ['flight-booking-contact'];
  }

  if (/(airline|sidebar|filter)/i.test(text)) {
    return ['flight-filter-airline'];
  }

  return ['flight-search-results'];
}

function classifyFailure(artifacts: WeeklyFailureArtifact[]): WeeklyFailureTriageItem['probableFailureClass'] {
  const text = artifacts.map((artifact) => artifact.path).join(' ').toLowerCase();
  if (/(restricted|datadome|captcha|blocked|forbidden)/i.test(text)) {
    return 'environment-drift-likely';
  }
  if (/(trace|error-context)/i.test(text) && /(iframe|frame|dialog|overlay|handoff)/i.test(text)) {
    return 'runtime-workflow-drift-likely';
  }
  if (/(testid|selector|locator|contract)/i.test(text)) {
    return 'source-contract-drift-likely';
  }
  if (artifacts.some((artifact) => artifact.type === 'trace' || artifact.type === 'error-context')) {
    return 'product-regression-likely';
  }
  return 'inconclusive';
}

function suggestNextAction(failureClass: WeeklyFailureTriageItem['probableFailureClass']): string {
  switch (failureClass) {
    case 'environment-drift-likely':
      return 'Retry with clean auth state or a different time slot before filing a product bug.';
    case 'runtime-workflow-drift-likely':
      return 'Inspect trace steps and update the capability pack workflow boundary, not just a selector.';
    case 'source-contract-drift-likely':
      return 'Refresh selectors and route contracts from Traveloka WWW source before rerunning.';
    case 'product-regression-likely':
      return 'Preserve trace evidence and file a bug candidate with impacted journey, route, and artifacts.';
    case 'inconclusive':
    default:
      return 'Collect more runtime evidence before classifying the failure.';
  }
}

export function triageWeeklyFailures(options: WeeklyFailureTriageOptions): WeeklyFailureTriageItem[] {
  const files = walk(options.rootDir);
  const byRun = new Map<string, WeeklyFailureArtifact[]>();

  for (const filePath of files) {
    const type = classifyArtifact(filePath);
    if (type === 'unknown') {
      continue;
    }

    const relative = path.relative(options.rootDir, filePath);
    const runId = relative.split(path.sep)[0] || 'root';
    const current = byRun.get(runId) ?? [];
    current.push({ path: relative, type });
    byRun.set(runId, current);
  }

  return Array.from(byRun.entries()).map(([runId, artifacts]) => {
    const probableFailureClass = classifyFailure(artifacts);
    return {
      runId,
      artifacts,
      probableCapabilityPackIds: inferProbablePackIds(artifacts),
      probableFailureClass,
      evidence: artifacts.map((artifact) => `${artifact.type}: ${artifact.path}`),
      suggestedNextAction: suggestNextAction(probableFailureClass),
    };
  });
}