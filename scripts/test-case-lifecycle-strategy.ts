#!/usr/bin/env tsx

/**
 * 三层执行策略演示脚本
 * 
 * 演示如何使用新的分层执行策略：
 * 1. 活跃层 (weekly): 最近4周用例 + baseline + permanent
 * 2. 候选库 (monthly): 历史4+周的稳定用例
 * 3. 深度存档 (on-demand): 已下线用例
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface CaseMetadata {
  id: string;
  lifecycle?: 'candidate' | 'stable' | 'permanent' | 'retired';
  addedDate: string;
  statistics?: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
  };
}

// 模拟数据：创建一些不同年龄的用例
function createMockCases(): Record<string, CaseMetadata> {
  const now = new Date().getTime();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  return {
    // 候选用例：1周前创建
    'pr-32211-case-1': {
      id: 'pr-32211-case-1',
      lifecycle: 'candidate',
      addedDate: new Date(now - 1 * oneWeek).toISOString(),
      statistics: { totalRuns: 2, passedRuns: 2, failedRuns: 0 },
    },

    // 候选用例：2周前创建
    'pr-32210-case-2': {
      id: 'pr-32210-case-2',
      lifecycle: 'candidate',
      addedDate: new Date(now - 2 * oneWeek).toISOString(),
      statistics: { totalRuns: 8, passedRuns: 8, failedRuns: 0 },
    },

    // 稳定用例：3周前创建
    'pr-32209-case-3': {
      id: 'pr-32209-case-3',
      lifecycle: 'stable',
      addedDate: new Date(now - 3 * oneWeek).toISOString(),
      statistics: { totalRuns: 12, passedRuns: 11, failedRuns: 1 },
    },

    // 稳定用例：4周前创建（即将进入候选库）
    'pr-32208-case-4': {
      id: 'pr-32208-case-4',
      lifecycle: 'stable',
      addedDate: new Date(now - 4 * oneWeek).toISOString(),
      statistics: { totalRuns: 16, passedRuns: 15, failedRuns: 1 },
    },

    // 稳定用例：5周前创建（候选库）
    'pr-32207-case-5': {
      id: 'pr-32207-case-5',
      lifecycle: 'stable',
      addedDate: new Date(now - 5 * oneWeek).toISOString(),
      statistics: { totalRuns: 20, passedRuns: 19, failedRuns: 1 },
    },

    // 永久用例：8周前创建（始终在活跃层）
    'pr-32200-case-6': {
      id: 'pr-32200-case-6',
      lifecycle: 'permanent',
      addedDate: new Date(now - 8 * oneWeek).toISOString(),
      statistics: { totalRuns: 50, passedRuns: 50, failedRuns: 0 },
    },

    // 已下线用例：12周前创建（深度存档）
    'pr-32000-case-7': {
      id: 'pr-32000-case-7',
      lifecycle: 'retired',
      addedDate: new Date(now - 12 * oneWeek).toISOString(),
      statistics: { totalRuns: 30, passedRuns: 15, failedRuns: 15 },
    },
  };
}

/**
 * 模拟分层执行逻辑
 */
function getExecutionLayers(cases: Record<string, CaseMetadata>) {
  const now = new Date().getTime();
  const fourWeeksAgo = now - 4 * 7 * 24 * 60 * 60 * 1000;

  const layers = {
    active: [] as string[],
    archive: [] as string[],
    deepArchive: [] as string[],
  };

  for (const [id, caseData] of Object.entries(cases)) {
    const ageWeeks = (now - new Date(caseData.addedDate).getTime()) / (7 * 24 * 60 * 60 * 1000);

    // 活跃层：最近4周 + 永久
    if (ageWeeks <= 4 || caseData.lifecycle === 'permanent') {
      layers.active.push(id);
    } 
    // 候选库：4周以上，但已验证稳定
    else if (ageWeeks > 4 && caseData.lifecycle !== 'retired' && caseData.lifecycle !== 'candidate') {
      layers.archive.push(id);
    } 
    // 深度存档：已下线
    else if (caseData.lifecycle === 'retired') {
      layers.deepArchive.push(id);
    }
  }

  return layers;
}

/**
 * 生成报告
 */
function generateReport(cases: Record<string, CaseMetadata>) {
  const layers = getExecutionLayers(cases);

  console.log('\n' + '='.repeat(70));
  console.log('📊 三层执行策略演示报告');
  console.log('='.repeat(70) + '\n');

  console.log('📌 活跃层 (Active Layer) - 周度执行');
  console.log('-'.repeat(70));
  console.log(`用例数: ${layers.active.length}`);
  console.log(`预估时间: ${layers.active.length * 5} 分钟`);
  console.log('用例列表:');
  layers.active.forEach(id => {
    const c = cases[id];
    const stats = c.statistics;
    const passRate = stats ? ((stats.passedRuns / stats.totalRuns) * 100).toFixed(1) : 'N/A';
    console.log(
      `  • ${id.padEnd(20)} [${c.lifecycle?.padEnd(10)}] ${stats?.totalRuns || 0} runs, ${passRate}% pass`
    );
  });

  console.log('\n📦 候选库 (Archive Layer) - 月度执行');
  console.log('-'.repeat(70));
  console.log(`用例数: ${layers.archive.length}`);
  console.log(`预估时间: ${layers.archive.length * 5} 分钟`);
  console.log('用例列表:');
  layers.archive.forEach(id => {
    const c = cases[id];
    const stats = c.statistics;
    const passRate = stats ? ((stats.passedRuns / stats.totalRuns) * 100).toFixed(1) : 'N/A';
    const ageWeeks = (new Date().getTime() - new Date(c.addedDate).getTime()) / (7 * 24 * 60 * 60 * 1000);
    console.log(
      `  • ${id.padEnd(20)} [${c.lifecycle?.padEnd(10)}] ${ageWeeks.toFixed(1)}周前, ${passRate}% pass`
    );
  });

  console.log('\n🗂️  深度存档 (Deep Archive) - 按需执行');
  console.log('-'.repeat(70));
  console.log(`用例数: ${layers.deepArchive.length}`);
  console.log('用例列表:');
  layers.deepArchive.forEach(id => {
    const c = cases[id];
    const stats = c.statistics;
    const passRate = stats ? ((stats.passedRuns / stats.totalRuns) * 100).toFixed(1) : 'N/A';
    console.log(
      `  • ${id.padEnd(20)} [${c.lifecycle?.padEnd(10)}] ${stats?.totalRuns || 0} runs, ${passRate}% pass`
    );
  });

  console.log('\n📈 执行计划汇总');
  console.log('-'.repeat(70));
  console.log(`周度执行 (每周):  ${layers.active.length} cases, 约 ${layers.active.length * 5} 分钟`);
  console.log(`月度执行 (每月):  ${layers.archive.length} cases, 约 ${layers.archive.length * 5} 分钟`);
  console.log(`按需执行 (特殊):  ${layers.deepArchive.length} cases, 随时可查询/复活`);
  console.log(`\n✅ 总执行时间控制在可管理范围内`);
  console.log(`✅ 所有历史数据完整保留，永不丢失`);
  console.log(`✅ 可随时复活任何存档用例进行调查`);

  console.log('\n' + '='.repeat(70) + '\n');
}

/**
 * 演示用例晋升逻辑
 */
function demonstratePromotion(cases: Record<string, CaseMetadata>) {
  console.log('🎯 用例晋升演示');
  console.log('-'.repeat(70));

  const case2 = cases['pr-32210-case-2'];
  if (case2.statistics && case2.statistics.totalRuns >= 3) {
    const successRate = case2.statistics.passedRuns / case2.statistics.totalRuns;
    if (successRate >= 0.95) {
      console.log(
        `✅ ${case2.id}: 可晋升 candidate → stable (${case2.statistics.totalRuns} runs, 100% pass)`
      );
    }
  }

  const case5 = cases['pr-32207-case-5'];
  console.log(
    `✅ ${case5.id}: 已在候选库执行中，月度检查是否升级为 permanent (${case5.statistics?.totalRuns || 0} runs, 95% pass)`
  );

  const case7 = cases['pr-32000-case-7'];
  console.log(
    `⚠️  ${case7.id}: 已归档为 retired (50% 失败率，可按需查询)`
  );

  console.log('');
}

// 主程序
async function main() {
  console.log('🚀 三层执行策略演示\n');

  // 创建模拟用例
  const cases = createMockCases();

  // 展示执行分层
  generateReport(cases);

  // 展示晋升逻辑
  demonstratePromotion(cases);

  console.log('💡 核心优势:');
  console.log('  1. 周度执行时间固定 (~60 min)，不会无限增长');
  console.log('  2. 所有历史用例完整保留，永不丢失');
  console.log('  3. 月度全量验证，发现回归bug');
  console.log('  4. 按需快速查询和复活存档用例');
  console.log('  5. 自动晋升稳定用例为永久回归');
  console.log('  6. 清晰的用例质量分层\n');
}

main().catch(console.error);
