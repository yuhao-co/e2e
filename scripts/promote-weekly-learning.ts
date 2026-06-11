import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  mergeVerifiedLessonsIntoLearningMemory,
  readWeeklyLearningMemory,
  writeWeeklyLearningMemory,
} from './lib/weekly-learning-memory';
import { writePromotedLessonsToManagedBlocks } from './lib/weekly-learning-writeback';
import {
  WeeklyLearningPromotionResult,
  WeeklyQualityCalibrationResult,
} from './lib/weekly-quality-types';

function parseArgs(argv: string[]) {
  const parsed = {
    calibrationFile: 'generated-cases/weekly-diff/weekly-quality-calibration.json',
    memoryFile: 'config/weekly-learning-memory.json',
    output: 'generated-cases/weekly-diff/weekly-learning-promotion.json',
    threshold: 2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--calibration-file') {
      parsed.calibrationFile = argv[index + 1] ?? parsed.calibrationFile;
      index += 1;
      continue;
    }
    if (arg === '--memory-file') {
      parsed.memoryFile = argv[index + 1] ?? parsed.memoryFile;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      parsed.output = argv[index + 1] ?? parsed.output;
      index += 1;
      continue;
    }
    if (arg === '--threshold') {
      parsed.threshold = Number(argv[index + 1] ?? parsed.threshold);
      index += 1;
    }
  }

  return parsed;
}

function readJsonIfExists<T>(filePath: string): T | null {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as T;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const calibration = readJsonIfExists<WeeklyQualityCalibrationResult>(args.calibrationFile);
  const existingMemory = readWeeklyLearningMemory(args.memoryFile);
  const lessons = calibration?.verifiedLessons ?? [];
  const merged = mergeVerifiedLessonsIntoLearningMemory(existingMemory, lessons, args.threshold);

  writeWeeklyLearningMemory(merged.memory, args.memoryFile);
  const writtenFiles = writePromotedLessonsToManagedBlocks(merged.memory);

  const result: WeeklyLearningPromotionResult = {
    generatedAt: new Date().toISOString(),
    promotedLessons: merged.promotedLessons,
    updatedLessons: merged.updatedLessons,
    threshold: args.threshold,
    writtenFiles,
  };

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`[weekly-quality] wrote learning memory to ${args.memoryFile}`);
  console.log(`[weekly-quality] wrote learning promotion result to ${path.relative(process.cwd(), outputPath)}`);
  console.log(`[weekly-quality] verified lessons processed: ${lessons.length}`);
  console.log(`[weekly-quality] promoted lessons: ${merged.promotedLessons.length}`);
  if (writtenFiles.length > 0) {
    console.log(`[weekly-quality] updated managed source/docs: ${writtenFiles.join(', ')}`);
  }
}

main();