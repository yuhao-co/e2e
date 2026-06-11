import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildWeeklyQualityPlan } from './lib/weekly-quality-planner';

function parseArgs(argv: string[]) {
  const parsed = {
    changedFiles: [] as string[],
    userIntent: '',
    summaryFile: '',
    output: 'generated-cases/weekly-diff/weekly-quality-plan.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--changed-file') {
      const next = argv[index + 1];
      if (next) {
        parsed.changedFiles.push(next);
        index += 1;
      }
      continue;
    }
    if (arg === '--intent') {
      parsed.userIntent = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--summary-file') {
      parsed.summaryFile = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--output') {
      parsed.output = argv[index + 1] ?? parsed.output;
      index += 1;
    }
  }

  return parsed;
}

function readSignalsFromSummaryFile(summaryFilePath: string): {
  changedFiles: string[];
  userIntent: string;
} {
  const resolvedPath = path.resolve(process.cwd(), summaryFilePath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const summary = JSON.parse(raw) as {
    changedFiles?: Array<{ filePath?: string }>;
    candidates?: Array<{
      id?: string;
      confidence?: 'high' | 'medium' | 'low';
      confidenceScore?: number;
      mainLaneEligible?: boolean;
      mainLaneGateReason?: string;
      suggestedUserIntent?: string;
      concerns?: string[];
      domain?: string;
      actionContracts?: Array<unknown>;
      webSpecFileName?: string;
    }>;
  };

  const changedFiles = (summary.changedFiles ?? [])
    .map((entry) => entry.filePath)
    .filter((filePath): filePath is string => Boolean(filePath));

  const userIntent = (summary.candidates ?? [])
    .map((candidate) => {
      const concernText = candidate.concerns?.join(', ') ?? '';
      return [candidate.suggestedUserIntent, candidate.domain, concernText]
        .filter(Boolean)
        .join(' | ');
    })
    .filter(Boolean)
    .join(' || ');

  const generatedCandidates = (summary.candidates ?? []).map((candidate) => ({
    id: candidate.id ?? 'unknown',
    domain: candidate.domain ?? 'unknown',
    confidence: candidate.confidence ?? 'low',
    confidenceScore: candidate.confidenceScore,
    mainLaneEligible: candidate.mainLaneEligible,
    mainLaneGateReason: candidate.mainLaneGateReason,
    concerns: candidate.concerns,
    actionContractCount: candidate.actionContracts?.length ?? 0,
    webSpecFileName: candidate.webSpecFileName,
  }));

  return {
    changedFiles,
    userIntent,
    generatedCandidates,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summarySignals = args.summaryFile
    ? readSignalsFromSummaryFile(args.summaryFile)
    : { changedFiles: [] as string[], userIntent: '', generatedCandidates: [] as ReturnType<typeof readSignalsFromSummaryFile>['generatedCandidates'] };
  const plan = buildWeeklyQualityPlan({
    changedFiles: args.changedFiles.length > 0 ? args.changedFiles : summarySignals.changedFiles,
    userIntent: args.userIntent || summarySignals.userIntent,
    generatedCandidates: summarySignals.generatedCandidates,
  });

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  console.log(`[weekly-quality] wrote standalone plan to ${path.relative(process.cwd(), outputPath)}`);
  console.log(`[weekly-quality] suggested packs: ${plan.suggestedPacks.map((pack) => pack.id).join(', ') || 'none'}`);
  console.log(`[weekly-quality] suggested oracle bundles: ${plan.suggestedOracleBundles.map((bundle) => bundle.id).join(', ') || 'none'}`);
}

main();