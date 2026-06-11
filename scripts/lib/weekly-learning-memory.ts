import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CapabilityPack,
  WeeklyLearningMemory,
  WeeklyLearningMemoryLesson,
  WeeklyVerifiedLearningLesson,
} from './weekly-quality-types';

export const DEFAULT_WEEKLY_LEARNING_MEMORY_PATH = 'config/weekly-learning-memory.json';

function normalizeLessonKey(packId: string, trigger: string, action: string): string {
  return `${packId}::${trigger.trim()}::${action.trim()}`.toLowerCase();
}

export function readWeeklyLearningMemory(filePath = DEFAULT_WEEKLY_LEARNING_MEMORY_PATH): WeeklyLearningMemory | null {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as WeeklyLearningMemory;
}

export function writeWeeklyLearningMemory(memory: WeeklyLearningMemory, filePath = DEFAULT_WEEKLY_LEARNING_MEMORY_PATH): void {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
}

export function mergeVerifiedLessonsIntoLearningMemory(
  existingMemory: WeeklyLearningMemory | null,
  lessons: WeeklyVerifiedLearningLesson[],
  threshold: number,
): { memory: WeeklyLearningMemory; promotedLessons: WeeklyLearningMemoryLesson[]; updatedLessons: WeeklyLearningMemoryLesson[] } {
  const byLessonKey = new Map<string, WeeklyLearningMemoryLesson>();
  for (const lesson of existingMemory?.lessons ?? []) {
    byLessonKey.set(lesson.lessonKey, lesson);
  }

  const promotedLessons: WeeklyLearningMemoryLesson[] = [];
  const updatedLessons: WeeklyLearningMemoryLesson[] = [];

  for (const lesson of lessons) {
    const lessonKey = lesson.lessonKey || normalizeLessonKey(lesson.packId, lesson.trigger, lesson.action);
    const existing = byLessonKey.get(lessonKey);
    const mergedFailureClasses = Array.from(new Set([...(existing?.sourceFailureClasses ?? []), ...lesson.sourceFailureClasses]));
    const mergedRunIds = Array.from(new Set([...(existing?.observedRunIds ?? []), ...lesson.observedRunIds]));
    const successfulReruns = (existing?.successfulReruns ?? 0) + lesson.successfulReruns;
    const shouldPromote = successfulReruns >= threshold;

    const mergedLesson: WeeklyLearningMemoryLesson = {
      packId: lesson.packId,
      lessonKey,
      trigger: lesson.trigger,
      action: lesson.action,
      sourceFailureClasses: mergedFailureClasses,
      observedRunIds: mergedRunIds,
      successfulReruns,
      firstVerifiedAt: existing?.firstVerifiedAt ?? lesson.verifiedAt,
      lastVerifiedAt: lesson.verifiedAt,
      status: shouldPromote ? 'promoted' : (existing?.status ?? 'candidate'),
      promotedAt: shouldPromote ? (existing?.promotedAt ?? lesson.verifiedAt) : existing?.promotedAt,
    };

    byLessonKey.set(lessonKey, mergedLesson);
    updatedLessons.push(mergedLesson);
    if (shouldPromote && existing?.status !== 'promoted') {
      promotedLessons.push(mergedLesson);
    }
  }

  return {
    memory: {
      generatedAt: new Date().toISOString(),
      lessons: Array.from(byLessonKey.values()).sort((left, right) => right.successfulReruns - left.successfulReruns),
    },
    promotedLessons,
    updatedLessons,
  };
}

export function applyLearningMemoryToCapabilityPack(
  pack: CapabilityPack,
  memory: WeeklyLearningMemory | null,
): CapabilityPack {
  const promotedLessons = (memory?.lessons ?? []).filter(
    (lesson) => lesson.packId === pack.id && lesson.status === 'promoted',
  );

  if (promotedLessons.length === 0) {
    return pack;
  }

  return {
    ...pack,
    repairHints: [
      ...pack.repairHints,
      ...promotedLessons.map((lesson) => ({
        trigger: `learning:${lesson.trigger}`,
        action: lesson.action,
      })),
    ],
  };
}