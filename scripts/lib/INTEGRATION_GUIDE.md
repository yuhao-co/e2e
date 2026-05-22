/**
 * Integration Guide: Using Accumulation System
 * 
 * This shows how to integrate the three-layer accumulation into
 * generate-cases-from-weekly-diff.ts
 */

// ===== OLD CODE (OVERWRITE) =====
/*
function main() {
  // ...
  const outputRoot = path.resolve(process.cwd(), args.outputDir, 'latest');
  
  if (!args.dryRun) {
    resetOutputDir(outputRoot);  // ❌ DELETES EVERYTHING
    writeArtifacts(outputRoot, markdown, candidates, changedFiles);
  }
}
*/

// ===== NEW CODE (ACCUMULATE) =====
/*
import { createAccumulator } from './lib/accumulation-orchestrator';

function main() {
  const args = parseArgs(process.argv.slice(2));
  
  // ... existing code to get candidates ...
  
  const outputRoot = path.resolve(process.cwd(), args.outputDir);
  const prNumber = extractPRNumberFromCommits(changedFiles);  // NEW
  
  // Create accumulator (replaces resetOutputDir)
  const accumulator = createAccumulator(outputRoot, prNumber);  // NEW
  const targetDir = accumulator.getTargetDirectory();  // NEW: pr-32211/, not latest/
  
  if (!args.dryRun) {
    let acceptedCount = 0;
    
    // Process each candidate with deduplication
    for (const candidate of candidates) {
      const result = accumulator.processCandidateCase(candidate);  // NEW: checks for duplicates
      
      if (!result.isDuplicate) {
        // Write case file to target directory
        writeArtifacts(result.path, markdown, [candidate], changedFiles);
        acceptedCount++;
      } else {
        console.log(`[main] Skipped duplicate: ${result.duplicateOf}`);
      }
    }
    
    // Finalize and update manifest
    const summary = accumulator.finalize(acceptedCount, 
      candidates.map(c => c.domain));  // NEW
    
    console.log('');
    console.log(JSON.stringify(summary, null, 2));
  }
}
*/

// ===== EXTRACTION HELPER =====
/*
function extractPRNumberFromCommits(changedFiles: string[]): number | undefined {
  // Try to find PR number from recent git log
  try {
    const output = execSync('git log -1 --format=%B', { encoding: 'utf8' });
    const match = output.match(/#(\d+)/);
    if (match) return Number(match[1]);
  } catch {
    // fallback to undefined
  }
  return undefined;
}
*/

// ===== SCOPE FILTERING (WEB/FLIGHT ONLY) =====
/*
function isFocusedCandidate(candidate: Candidate): boolean {
  const domain = candidate.domain;
  
  // Only web desktop flight booking & search
  const isRelevantDomain = 
    domain === 'flight-search' || domain === 'flight-booking';
  
  if (!isRelevantDomain) return false;
  
  // Ignore non-web surfaces
  if (candidate.targetTests?.some(t => 
    t.includes('android') || 
    t.includes('home-i18n')
  )) {
    return false;
  }
  
  return true;
}

// In main():
const focusedCandidates = candidates.filter(isFocusedCandidate);
*/

// ===== CLI EXTENSIONS =====
/*
// Add to parseArgs():
// --run-mode incremental|full|pr-focused (default: auto-detect)
// --dry-run (existing, still works)

// Usage examples:
// npx tsx scripts/generate-cases-from-weekly-diff.ts \
//   --repo-path . \
//   --base-ref origin/master \
//   --focus-domain flight-search,flight-booking \
//   --run-mode incremental

// Generate for a specific PR:
// npx tsx scripts/generate-cases-from-weekly-diff.ts \
//   --repo-path . \
//   --pr-number 32211 \
//   --run-mode pr-focused
*/

// ===== OUTPUT STRUCTURE (AFTER INTEGRATION) =====
/*
generated-cases/
├─ manifest.json                    ← Central index + statistics
├─ registry.yaml                    ← All cases metadata
├─ baseline/
│  └─ baseline-cases.json
├─ pr-32211/                        ← NEW: Not deleted anymore!
│  ├─ case-1.json
│  ├─ case-2.json
│  └─ _metadata.json
├─ pr-32212/                        ← ACCUMULATES each week
│  └─ ...
├─ snapshot-2026-05-22/             ← Alternative: time-based
│  └─ ...
└─ latest/                          ← OPTIONAL: Symlink to newest
    └─ (symlink to pr-32212/)
*/

// ===== MANIFEST EXAMPLE OUTPUT =====
/*
{
  "version": "1.0",
  "lastUpdated": "2026-05-22T10:30:00Z",
  "layers": {
    "baseline": {
      "frozen": true,
      "caseCount": 15,
      "checksumHash": "abc123...",
      "description": "Core flight booking & search flows"
    },
    "committed": [
      {
        "id": "pr-32211",
        "type": "pr",
        "prNumber": 32211,
        "timestamp": "2026-05-22T08:00:00Z",
        "caseCount": 3,
        "domains": ["flight-search", "flight-booking"],
        "intentHashes": ["h1", "h2", "h3"],
        "status": "active",
        "checksumHash": "def456..."
      },
      {
        "id": "pr-32212",
        "type": "pr",
        "prNumber": 32212,
        "timestamp": "2026-05-22T09:30:00Z",
        "caseCount": 2,
        "domains": ["flight-booking"],
        "intentHashes": ["h4", "h5"],
        "status": "active",
        "checksumHash": "ghi789..."
      }
    ]
  },
  "statistics": {
    "totalCases": 20,
    "byDomain": {
      "flight-search": 10,
      "flight-booking": 10
    },
    "byStatus": {
      "active": 20,
      "deprecated": 0
    }
  },
  "runHistory": [
    {
      "timestamp": "2026-05-22T10:00:00Z",
      "totalRun": 20,
      "passed": 19,
      "failed": 1,
      "failedCases": ["pr-32211-case-2"]
    }
  ]
}
*/

// ===== BENEFITS =====
/*
✅ Never lose test cases (no resetOutputDir)
✅ Automatic deduplication (by intent hash)
✅ Track PR history (pr-32211, pr-32212, ...)
✅ Smart run modes (incremental, full, pr-focused)
✅ Statistics & analytics (byDomain, runHistory)
✅ Version control friendly (proper Git structure)
✅ Easy to debug (manifest.json tells full story)
*/

export {};
