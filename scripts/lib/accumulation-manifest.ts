/**
 * Accumulation Manifest Management
 * 
 * Three-layer accumulation architecture:
 * - Baseline: frozen core test cases
 * - Committed: PR-driven accumulated cases
 * - Registry: deduplication and versioning
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface CaseMetadata {
  id: string;
  prNumber?: number;
  domain: 'flight-search' | 'flight-booking' | 'other';
  intent: string;
  intentHash: string;
  path: string;
  addedDate: string;
  status: 'active' | 'deprecated' | 'archived';
  checksumHash?: string;
}

export interface CommittedLayer {
  id: string; // pr-32211
  type: 'pr' | 'commit' | 'snapshot';
  prNumber?: number;
  commitSha?: string;
  timestamp: string;
  caseCount: number;
  domains: string[];
  intentHashes: string[];
  status: 'active' | 'deprecated';
  checksumHash: string;
}

export interface Manifest {
  version: string;
  lastUpdated: string;
  layers: {
    baseline: {
      frozen: boolean;
      caseCount: number;
      checksumHash: string;
      description: string;
    };
    committed: CommittedLayer[];
  };
  statistics: {
    totalCases: number;
    byDomain: Record<string, number>;
    byStatus: Record<string, number>;
  };
  runHistory: Array<{
    timestamp: string;
    totalRun: number;
    passed: number;
    failed: number;
    failedCases?: string[];
  }>;
}

export class AccumulationManifest {
  private manifestPath: string;
  private registryPath: string;
  private manifest: Manifest;

  constructor(outputDir: string) {
    this.manifestPath = path.join(outputDir, 'manifest.json');
    this.registryPath = path.join(outputDir, 'registry.yaml');
    this.manifest = this.loadOrCreateManifest();
  }

  private loadOrCreateManifest(): Manifest {
    if (fs.existsSync(this.manifestPath)) {
      try {
        const content = fs.readFileSync(this.manifestPath, 'utf8');
        return JSON.parse(content);
      } catch (e) {
        console.warn('Failed to parse existing manifest, creating new one:', e);
      }
    }

    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      layers: {
        baseline: {
          frozen: true,
          caseCount: 0,
          checksumHash: '',
          description: 'Core flight booking & search flows (stable)',
        },
        committed: [],
      },
      statistics: {
        totalCases: 0,
        byDomain: {},
        byStatus: {},
      },
      runHistory: [],
    };
  }

  /**
   * Generate intent hash for deduplication
   * Combines domain, steps, assertions into unique signature
   */
  generateIntentHash(candidate: {
    domain: string;
    userIntent: string;
    suggestedUserIntent: string;
    concerns?: string[];
    changedFiles: string[];
  }): string {
    const key = [
      candidate.domain,
      candidate.userIntent || candidate.suggestedUserIntent,
      (candidate.concerns || []).sort().join('|'),
      candidate.changedFiles.slice(0, 5).sort().join('|'), // Top 5 files
    ].join('::');

    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * Check if case already exists by intent hash
   */
  checkDuplicate(intentHash: string): CaseMetadata | null {
    for (const layer of this.manifest.layers.committed) {
      if (layer.intentHashes.includes(intentHash)) {
        // Load registry to find exact case
        const cases = this.loadRegistry();
        for (const [, caseData] of Object.entries(cases)) {
          if ((caseData as any).intentHash === intentHash) {
            return caseData as CaseMetadata;
          }
        }
      }
    }
    return null;
  }

  /**
   * Add new committed layer (typically for a PR)
   */
  addCommittedLayer(layer: Omit<CommittedLayer, 'checksumHash'>): string {
    // Remove deprecated layer if it has the same prNumber
    if (layer.prNumber) {
      this.manifest.layers.committed = this.manifest.layers.committed.filter(
        (existing) => existing.prNumber !== layer.prNumber,
      );
    }

    const checksumHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(layer))
      .digest('hex')
      .substring(0, 16);

    const fullLayer: CommittedLayer = {
      ...layer,
      checksumHash,
    };

    this.manifest.layers.committed.push(fullLayer);
    this.updateStatistics();
    this.manifest.lastUpdated = new Date().toISOString();

    return fullLayer.id;
  }

  /**
   * Register a new case
   */
  registerCase(metadata: CaseMetadata): void {
    const registry = this.loadRegistry();
    registry[metadata.id] = metadata;
    this.saveRegistry(registry);

    // Update layer's intent hashes
    const layerId = metadata.id.split('-').slice(0, 2).join('-'); // pr-32211 from pr-32211-case-1
    const layer = this.manifest.layers.committed.find((l) => l.id === layerId);
    if (layer && !layer.intentHashes.includes(metadata.intentHash)) {
      layer.intentHashes.push(metadata.intentHash);
      layer.caseCount += 1;
    }

    this.updateStatistics();
  }

  /**
   * Load registry of all cases (external YAML)
   */
  private loadRegistry(): Record<string, CaseMetadata> {
    // Simplified - in production use proper YAML parser
    if (fs.existsSync(this.registryPath)) {
      const content = fs.readFileSync(this.registryPath, 'utf8');
      // Parse YAML (use js-yaml in real implementation)
      try {
        return JSON.parse(content); // Simplified
      } catch {
        return {};
      }
    }
    return {};
  }

  /**
   * Save registry
   */
  private saveRegistry(registry: Record<string, CaseMetadata>): void {
    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2));
  }

  /**
   * Update statistics
   */
  private updateStatistics(): void {
    let totalCases = this.manifest.layers.baseline.caseCount;
    const byDomain: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const layer of this.manifest.layers.committed) {
      if (layer.status === 'active') {
        totalCases += layer.caseCount;
        for (const domain of layer.domains) {
          byDomain[domain] = (byDomain[domain] || 0) + (layer.caseCount / layer.domains.length);
        }
      }
    }

    this.manifest.statistics = {
      totalCases,
      byDomain,
      byStatus: {
        active: totalCases,
        deprecated: this.manifest.layers.committed.filter((l) => l.status === 'deprecated').length,
      },
    };
  }

  /**
   * Record test run result
   */
  recordRunResult(result: {
    totalRun: number;
    passed: number;
    failed: number;
    failedCases?: string[];
  }): void {
    this.manifest.runHistory.push({
      timestamp: new Date().toISOString(),
      ...result,
    });

    // Keep last 10 runs
    if (this.manifest.runHistory.length > 10) {
      this.manifest.runHistory = this.manifest.runHistory.slice(-10);
    }

    this.save();
  }

  /**
   * Get run mode (incremental vs full)
   */
  getRunMode(since?: string): 'incremental' | 'full' {
    if (!since && this.manifest.runHistory.length === 0) {
      return 'full';
    }

    const lastRun = this.manifest.runHistory[this.manifest.runHistory.length - 1];
    if (!lastRun) return 'full';

    // If last run was more than 24 hours ago, default to full
    const lastRunTime = new Date(lastRun.timestamp).getTime();
    const now = new Date().getTime();
    if (now - lastRunTime > 24 * 60 * 60 * 1000) {
      return 'full';
    }

    return 'incremental';
  }

  /**
   * Get cases to run based on mode
   */
  getCasesToRun(mode: 'incremental' | 'full' | 'pr-focused', prNumber?: number) {
    const cases = this.loadRegistry();
    const result: CaseMetadata[] = [];

    for (const [, caseData] of Object.entries(cases)) {
      const meta = caseData as CaseMetadata;

      // Filter by status
      if (meta.status !== 'active') continue;

      // Filter by mode
      if (mode === 'pr-focused' && prNumber) {
        if (meta.prNumber !== prNumber) continue;
      } else if (mode === 'incremental') {
        // Only cases added since last run
        const lastRun = this.manifest.runHistory[this.manifest.runHistory.length - 1];
        if (lastRun) {
          const caseAddedTime = new Date(meta.addedDate).getTime();
          const lastRunTime = new Date(lastRun.timestamp).getTime();
          if (caseAddedTime < lastRunTime) continue;
        }
      }

      result.push(meta);
    }

    return result;
  }

  /**
   * Save manifest to disk
   */
  save(): void {
    this.manifest.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  /**
   * Get current manifest
   */
  getManifest(): Manifest {
    return this.manifest;
  }
}
