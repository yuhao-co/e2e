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

  // ============ 新增：三层执行策略的生命周期管理 ============
  
  /**
   * 用例执行层级（决定执行频率）
   * - active: 活跃层，在最近4周的快照中，周度执行
   * - archive: 候选库，历史4+周的用例，月度执行
   * - deep_archive: 深度存档，按需查询，不定期执行
   */
  executionLayer?: 'active' | 'archive' | 'deep_archive';

  /**
   * 用例生命周期阶段（决定质量等级）
   * - candidate: 新生成的用例，正在评估稳定性 (0-3周)
   * - stable: 已验证稳定的用例，继续监控 (3-12周)
   * - permanent: 核心回归用例，每次必须运行，永不降级
   * - retired: 完成使命/低质量，已下线功能或弃用的用例
   */
  lifecycle?: 'candidate' | 'stable' | 'permanent' | 'retired';

  /**
   * 用例稳定性统计
   * 用于自动晋升/降级/分层决策
   */
  statistics?: {
    totalRuns: number;              // 历史运行总数
    passedRuns: number;             // 历史成功次数
    failedRuns: number;             // 历史失败次数
    skippedRuns?: number;           // 跳过次数（反爬虫等）
    lastRunDate?: string;           // 最后一次运行时间
    lastRunStatus?: 'pass' | 'fail' | 'skip';
    consecutiveSuccesses?: number;  // 连续成功次数
    consecutiveFailures?: number;   // 连续失败次数
    failureRate?: number;           // 失败率 (0-1)
    averageDurationMs?: number;     // 平均执行时间
    maxDurationMs?: number;         // 历史最长执行时间
    bugsFound?: number;             // 发现过的bug数
    lastBugFoundDate?: string;      // 最后发现bug的日期
  };

  /**
   * 用例晋升/降级历史
   * 记录用例的生命周期变化和分层转移
   */
  promotion?: {
    candidate_since?: string;           // 进入候选阶段的时间
    promoted_to_stable_at?: string;     // 晋升到稳定的时间
    promoted_to_permanent_at?: string;  // 晋升到永久的时间
    promotion_reason?: string;          // 晋升原因描述
    
    moved_to_archive_at?: string;       // 移入候选库的时间
    moved_to_deep_archive_at?: string;  // 移入深度存档的时间
    
    demotion_at?: string;               // 降级时间（如果被降级）
    demotion_reason?: string;           // 降级原因
    demotion_count?: number;            // 被降级次数
  };

  /**
   * 关键事件日志
   * 追踪用例的重要变化
   */
  events?: Array<{
    timestamp: string;
    event: 'created' | 'promoted' | 'demoted' | 'moved' | 'retired' | 'revived' | 'bug_found';
    details: string;
  }>;
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
   * 新增：获取指定分层的用例（三层执行策略）
   * 
   * 活跃层 (weekly): 最近4周的候选+稳定用例 + baseline + permanent
   * 候选库 (monthly): 历史稳定用例（4+周前）
   * 深度存档 (on-demand): 已下线的用例
   */
  getCasesToRunByLayer(layer: 'active' | 'archive' | 'deep_archive'): CaseMetadata[] {
    const cases = this.loadRegistry();
    const result: CaseMetadata[] = [];
    const now = new Date().getTime();
    const fourWeeksAgo = now - 4 * 7 * 24 * 60 * 60 * 1000;

    for (const [, caseData] of Object.entries(cases)) {
      const meta = caseData as CaseMetadata;

      // 跳过已弃用的用例
      if (meta.status === 'archived') continue;

      const caseAddedTime = new Date(meta.addedDate).getTime();
      const ageWeeks = (now - caseAddedTime) / (7 * 24 * 60 * 60 * 1000);

      // 按分层过滤
      if (layer === 'active') {
        // 活跃层：最近4周 + 永久用例
        if (ageWeeks <= 4 || meta.lifecycle === 'permanent') {
          result.push(meta);
        }
      } else if (layer === 'archive') {
        // 候选库：4周以上，但已验证稳定（不包括候选和已弃用）
        if (ageWeeks > 4 && meta.lifecycle !== 'retired' && meta.lifecycle !== 'candidate') {
          result.push(meta);
        }
      } else if (layer === 'deep_archive') {
        // 深度存档：已弃用的用例，保留但不定期执行
        if (meta.lifecycle === 'retired') {
          result.push(meta);
        }
      }
    }

    return result;
  }

  /**
   * 新增：自动评估和晋升/降级用例
   */
  evaluateAndPromoteCase(caseId: string): {
    promoted?: boolean;
    demoted?: boolean;
    reason: string;
  } {
    const cases = this.loadRegistry();
    const meta = cases[caseId] as CaseMetadata | undefined;

    if (!meta || !meta.statistics) {
      return { reason: 'No statistics available' };
    }

    const stats = meta.statistics;
    const successRate = stats.totalRuns > 0 ? stats.passedRuns / stats.totalRuns : 0;
    const now = new Date().getTime();
    const ageWeeks = (now - new Date(meta.addedDate).getTime()) / (7 * 24 * 60 * 60 * 1000);

    // 候选 → 稳定: 3周内100%成功，或已有2周以上且95%+成功且发现过bug
    if (meta.lifecycle === 'candidate' && successRate >= 0.95 && stats.totalRuns >= 3) {
      if (
        (ageWeeks >= 3 && successRate === 1.0) ||
        (ageWeeks >= 2 && stats.bugsFound && stats.bugsFound > 0)
      ) {
        meta.lifecycle = 'stable';
        if (!meta.promotion) meta.promotion = {};
        meta.promotion.promoted_to_stable_at = new Date().toISOString();
        meta.promotion.promotion_reason = `Promoted after ${ageWeeks.toFixed(1)} weeks with ${(successRate * 100).toFixed(1)}% success rate`;
        this.saveRegistry(cases);
        return { promoted: true, reason: 'Promoted from candidate to stable' };
      }
    }

    // 稳定 → 永久: 8周以上且95%+成功，至少发现过1个bug或覆盖核心功能
    if (meta.lifecycle === 'stable' && successRate >= 0.95 && ageWeeks >= 8) {
      if ((stats.bugsFound && stats.bugsFound > 0) || meta.domain === 'flight-search' || meta.domain === 'flight-booking') {
        meta.lifecycle = 'permanent';
        if (!meta.promotion) meta.promotion = {};
        meta.promotion.promoted_to_permanent_at = new Date().toISOString();
        meta.promotion.promotion_reason = `Promoted to permanent after ${ageWeeks.toFixed(1)} weeks`;
        this.saveRegistry(cases);
        return { promoted: true, reason: 'Promoted from stable to permanent' };
      }
    }

    // 候选/稳定 → 已弃用: 连续失败3次或失败率>50%且年龄超过3周
    if ((meta.lifecycle === 'candidate' || meta.lifecycle === 'stable') && 
        ageWeeks >= 3 && successRate < 0.5) {
      meta.lifecycle = 'retired';
      if (!meta.promotion) meta.promotion = {};
      meta.promotion.demotion_at = new Date().toISOString();
      meta.promotion.demotion_reason = `Low success rate (${(successRate * 100).toFixed(1)}%) after ${ageWeeks.toFixed(1)} weeks`;
      this.saveRegistry(cases);
      return { demoted: true, reason: 'Demoted to retired due to low quality' };
    }

    // 稳定 → 候选: 失败率突然上升到>10%
    if (meta.lifecycle === 'stable' && stats.consecutiveFailures && stats.consecutiveFailures >= 2) {
      meta.lifecycle = 'candidate';
      if (!meta.promotion) meta.promotion = {};
      meta.promotion.demotion_at = new Date().toISOString();
      meta.promotion.demotion_reason = `Sudden failures detected (${stats.consecutiveFailures} consecutive)`;
      if (!meta.promotion.demotion_count) meta.promotion.demotion_count = 0;
      meta.promotion.demotion_count++;
      this.saveRegistry(cases);
      return { demoted: true, reason: 'Demoted from stable to candidate' };
    }

    return { reason: 'No promotion/demotion needed' };
  }

  /**
   * 新增：获取执行计划报告
   */
  getExecutionPlan(): {
    active: { count: number; cases: CaseMetadata[] };
    archive: { count: number; cases: CaseMetadata[] };
    deepArchive: { count: number; cases: CaseMetadata[] };
    estimatedMinutes: number;
  } {
    const active = this.getCasesToRunByLayer('active');
    const archive = this.getCasesToRunByLayer('archive');
    const deepArchive = this.getCasesToRunByLayer('deep_archive');

    // 估算执行时间：平均每个用例5分钟
    const estimatedMinutes = (active.length + archive.length) * 5;

    return {
      active: { count: active.length, cases: active },
      archive: { count: archive.length, cases: archive },
      deepArchive: { count: deepArchive.length, cases: deepArchive },
      estimatedMinutes,
    };
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
