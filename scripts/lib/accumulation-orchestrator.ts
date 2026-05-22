/**
 * Accumulation Orchestrator
 * 
 * Coordinates the three-layer accumulation workflow:
 * 1. Check for duplicates by intent
 * 2. Create PR-based directory (not reset)
 * 3. Update manifest and registry
 * 4. Provide selection logic for test runs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AccumulationManifest, CaseMetadata } from './accumulation-manifest';

export interface AccumulationOptions {
  outputDir: string;
  prNumber?: number;
  commitSha?: string;
  timestamp?: string;
  domains: string[];
}

export interface AccumulatedCase {
  id: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  path: string;
  manifestEntry?: CaseMetadata;
}

export class AccumulationOrchestrator {
  private manifest: AccumulationManifest;
  private options: AccumulationOptions;

  constructor(options: AccumulationOptions) {
    this.options = options;
    this.manifest = new AccumulationManifest(options.outputDir);
  }

  /**
   * Get the target directory for new cases
   * Instead of overwriting, creates PR-specific directory
   */
  getTargetDirectory(): string {
    const baseDir = this.options.outputDir;

    let dirName: string;
    if (this.options.prNumber) {
      dirName = `pr-${this.options.prNumber}`;
    } else if (this.options.timestamp) {
      const date = new Date(this.options.timestamp).toISOString().split('T')[0];
      dirName = `snapshot-${date}`;
    } else {
      dirName = `commit-${(this.options.commitSha || 'unknown').substring(0, 7)}`;
    }

    const targetDir = path.join(baseDir, dirName);
    fs.mkdirSync(targetDir, { recursive: true });

    return targetDir;
  }

  /**
   * Process a candidate case
   * - Check for duplicates
   * - Generate metadata
   * - Return decision (create or skip)
   */
  processCandidateCase(candidate: {
    id: string;
    domain: string;
    userIntent: string;
    suggestedUserIntent: string;
    concerns?: string[];
    changedFiles: string[];
    draftFileName?: string;
    draftContent?: string;
  }): AccumulatedCase {
    // Generate intent hash for deduplication
    const intentHash = this.manifest.generateIntentHash({
      domain: candidate.domain,
      userIntent: candidate.userIntent,
      suggestedUserIntent: candidate.suggestedUserIntent,
      concerns: candidate.concerns,
      changedFiles: candidate.changedFiles,
    });

    // Check for duplicate
    const duplicate = this.manifest.checkDuplicate(intentHash);
    if (duplicate) {
      console.log(
        `[accumulation] Skipping duplicate case: ${candidate.id} (matches ${duplicate.id})`,
      );
      return {
        id: candidate.id,
        isDuplicate: true,
        duplicateOf: duplicate.id,
        path: duplicate.path,
      };
    }

    // Create new case ID and path
    const caseId =
      this.options.prNumber && this.options.prNumber > 0
        ? `pr-${this.options.prNumber}-${candidate.id.split('-').pop()}`
        : `${candidate.id}-${Date.now()}`;

    const targetDir = this.getTargetDirectory();
    const casePath = path.join(targetDir, `${caseId}.json`);

    // Register case
    const metadata: CaseMetadata = {
      id: caseId,
      prNumber: this.options.prNumber,
      domain: candidate.domain as any,
      intent: candidate.userIntent || candidate.suggestedUserIntent,
      intentHash,
      path: casePath,
      addedDate: this.options.timestamp || new Date().toISOString(),
      status: 'active',
    };

    this.manifest.registerCase(metadata);

    console.log(`[accumulation] Registered new case: ${caseId}`);

    return {
      id: caseId,
      isDuplicate: false,
      path: casePath,
      manifestEntry: metadata,
    };
  }

  /**
   * Finalize accumulation
   * - Add committed layer to manifest
   * - Save manifest
   * - Return summary
   */
  finalize(caseCount: number, domains: string[]): object {
    const layerId =
      this.options.prNumber && this.options.prNumber > 0
        ? `pr-${this.options.prNumber}`
        : `snapshot-${this.options.timestamp}`;

    this.manifest.addCommittedLayer({
      id: layerId,
      type: this.options.prNumber ? 'pr' : 'snapshot',
      prNumber: this.options.prNumber,
      commitSha: this.options.commitSha,
      timestamp: this.options.timestamp || new Date().toISOString(),
      caseCount,
      domains: [...new Set(domains)],
      intentHashes: [], // Will be filled during processCandidateCase
      status: 'active',
    });

    this.manifest.save();

    const manifestData = this.manifest.getManifest();
    return {
      layerId,
      caseCount,
      domains: [...new Set(domains)],
      totalCasesNow: manifestData.statistics.totalCases,
      summary: `Added ${caseCount} new cases (domains: ${domains.join(', ')})`,
    };
  }

  /**
   * Get recommended run mode
   */
  getRecommendedRunMode(): 'incremental' | 'full' {
    return this.manifest.getRunMode();
  }

  /**
   * Get cases to run
   */
  getCasesToRun(mode?: 'incremental' | 'full' | 'pr-focused'): CaseMetadata[] {
    const runMode = mode || this.getRecommendedRunMode();
    const prNumber = this.options.prNumber;
    return this.manifest.getCasesToRun(runMode as any, prNumber);
  }

  /**
   * Record run result
   */
  recordRunResult(result: { totalRun: number; passed: number; failed: number }): void {
    this.manifest.recordRunResult(result);
  }
}

/**
 * Convenience function for typical usage
 */
export function createAccumulator(outputDir: string, prNumber?: number): AccumulationOrchestrator {
  return new AccumulationOrchestrator({
    outputDir,
    prNumber,
    domains: ['flight-search', 'flight-booking'],
    timestamp: new Date().toISOString(),
  });
}
