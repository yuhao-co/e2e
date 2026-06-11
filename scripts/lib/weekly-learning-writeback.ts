import * as fs from 'node:fs';
import * as path from 'node:path';
import { WEEKLY_CAPABILITY_PACKS } from './weekly-capability-registry';
import { WeeklyLearningMemory } from './weekly-quality-types';

const REGISTRY_FILE = 'scripts/lib/weekly-capability-registry.ts';
const REGISTRY_START = '/* AUTO_PROMOTED_HINTS_START */';
const REGISTRY_END = '/* AUTO_PROMOTED_HINTS_END */';
const DOC_START = '<!-- AUTO_PROMOTED_LESSONS_START -->';
const DOC_END = '<!-- AUTO_PROMOTED_LESSONS_END -->';

function replaceManagedBlock(content: string, startMarker: string, endMarker: string, replacement: string): string {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return content;
  }

  const before = content.slice(0, startIndex + startMarker.length);
  const after = content.slice(endIndex);
  return `${before}\n${replacement}\n${after}`;
}

function renderRegistryBlock(memory: WeeklyLearningMemory | null): string {
  const promoted = (memory?.lessons ?? []).filter((lesson) => lesson.status === 'promoted');
  if (promoted.length === 0) {
    return '  // No promoted lessons yet.';
  }

  const byPack = new Map<string, Array<{ trigger: string; action: string }>>();
  for (const lesson of promoted) {
    const current = byPack.get(lesson.packId) ?? [];
    current.push({ trigger: lesson.trigger, action: lesson.action });
    byPack.set(lesson.packId, current);
  }

  return Array.from(byPack.entries())
    .map(([packId, hints]) => {
      const renderedHints = hints
        .map((hint) => `    { trigger: ${JSON.stringify(hint.trigger)}, action: ${JSON.stringify(hint.action)} },`)
        .join('\n');
      return `  ${JSON.stringify(packId)}: [\n${renderedHints}\n  ],`;
    })
    .join('\n');
}

function buildDocSection(docPath: string, memory: WeeklyLearningMemory | null): string {
  const promoted = (memory?.lessons ?? []).filter((lesson) => lesson.status === 'promoted');
  const packsForDoc = WEEKLY_CAPABILITY_PACKS.filter((pack) => pack.owningDocs.includes(docPath));
  const lines: string[] = ['## Verified Stable Lessons'];

  for (const pack of packsForDoc) {
    const lessons = promoted.filter((lesson) => lesson.packId === pack.id);
    if (lessons.length === 0) {
      continue;
    }

    lines.push(`### ${pack.id}`);
    for (const lesson of lessons) {
      lines.push(`- Trigger: ${lesson.trigger}`);
      lines.push(`- Action: ${lesson.action}`);
      lines.push(`- Promoted after ${lesson.successfulReruns} verified rerun(s)`);
    }
    lines.push('');
  }

  if (lines.length === 1) {
    lines.push('- No promoted lessons yet.');
  }

  return lines.join('\n').trimEnd();
}

function ensureDocMarkers(content: string): string {
  if (content.includes(DOC_START) && content.includes(DOC_END)) {
    return content;
  }

  return `${content.trimEnd()}\n\n${DOC_START}\n## Verified Stable Lessons\n- No promoted lessons yet.\n${DOC_END}\n`;
}

export function writePromotedLessonsToManagedBlocks(memory: WeeklyLearningMemory | null): string[] {
  const updatedFiles: string[] = [];

  const registryPath = path.resolve(process.cwd(), REGISTRY_FILE);
  if (fs.existsSync(registryPath)) {
    const original = fs.readFileSync(registryPath, 'utf8');
    const updated = replaceManagedBlock(original, REGISTRY_START, REGISTRY_END, renderRegistryBlock(memory));
    if (updated !== original) {
      fs.writeFileSync(registryPath, updated, 'utf8');
      updatedFiles.push(REGISTRY_FILE);
    }
  }

  const docPaths = new Set(
    WEEKLY_CAPABILITY_PACKS.flatMap((pack) => pack.owningDocs),
  );

  for (const docPath of docPaths) {
    const resolved = path.resolve(process.cwd(), docPath);
    if (!fs.existsSync(resolved)) {
      continue;
    }

    const original = fs.readFileSync(resolved, 'utf8');
    const withMarkers = ensureDocMarkers(original);
    const updated = replaceManagedBlock(withMarkers, DOC_START, DOC_END, buildDocSection(docPath, memory));
    if (updated !== original) {
      fs.writeFileSync(resolved, updated, 'utf8');
      updatedFiles.push(docPath);
    }
  }

  return updatedFiles;
}