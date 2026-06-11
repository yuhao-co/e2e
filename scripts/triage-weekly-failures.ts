import * as fs from 'node:fs';
import * as path from 'node:path';
import { triageWeeklyFailures } from './lib/weekly-failure-triage';

function parseArgs(argv: string[]) {
  const parsed = {
    rootDir: 'test-results',
    output: 'generated-cases/weekly-diff/weekly-failure-triage.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root-dir') {
      parsed.rootDir = argv[index + 1] ?? parsed.rootDir;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const items = triageWeeklyFailures({
    rootDir: path.resolve(process.cwd(), args.rootDir),
  });

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`, 'utf8');

  console.log(`[weekly-quality] wrote standalone triage to ${path.relative(process.cwd(), outputPath)}`);
  console.log(`[weekly-quality] triaged runs: ${items.length}`);
  for (const item of items) {
    console.log(`- ${item.runId}: ${item.probableFailureClass} -> ${item.probableCapabilityPackIds.join(', ')}`);
  }
}

main();