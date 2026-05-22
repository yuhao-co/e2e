# 三层执行策略 - 快速参考卡片

## 🎯 一句话总结
用例自动分层执行（周/月/按需），解决无限增长问题，保留全部数据。

---

## 🚀 快速开始

### 获取执行计划
```typescript
const manifest = new AccumulationManifest();
const plan = manifest.getExecutionPlan();

console.log(`周度执行: ${plan.active.count} 个用例, 约 ${plan.estimatedMinutes} 分钟`);
console.log(`月度执行: ${plan.archive.count} 个用例`);
console.log(`深度存档: ${plan.deepArchive.count} 个用例`);
```

### 获取分层用例
```typescript
// 周度用例
const weeklyTests = manifest.getCasesToRunByLayer('active');

// 月度用例
const monthlyTests = manifest.getCasesToRunByLayer('archive');

// 已下线用例（可查询/复活）
const archived = manifest.getCasesToRunByLayer('deep_archive');
```

### 自动晋升用例
```typescript
// 评估用例质量，自动晋升
const result = manifest.evaluateAndPromoteCase('pr-32211-case-1');

if (result.promoted) {
  console.log(`✅ 晋升成功: ${result.reason}`);
} else if (result.demoted) {
  console.log(`⚠️  降级: ${result.reason}`);
} else {
  console.log(`ℹ️  保持现状: ${result.reason}`);
}
```

---

## 📊 三层对照表

| 层级 | 频率 | 时间 | 用例 | 示例 |
|------|------|------|------|------|
| 活跃 (Active) | 周度 | ~60 min | 最近 4 周 + permanent | 4 cases → 20 min |
| 候选库 (Archive) | 月度 | ~180 min | 4+ 周的 stable | 2-5 cases → 10-25 min |
| 深度存档 (Deep Archive) | 按需 | 变动 | retired/已下线 | 按查询 |

---

## 🎯 生命周期速查表

### candidate (0-3 周)
- ✅ 首次进入活跃层
- 📊 收集稳定性数据
- ↗️ 晋升条件: 3 周 100% 或 2 周 95%+ + bug

### stable (3-12 周)
- ✅ 验证通过，进入月度验证池
- 📊 继续收集长期数据
- ↗️ 晋升条件: 8 周 95%+ + bug/核心功能
- ↙️ 降级条件: 连续失败 3 次

### permanent (∞周)
- ✅ 核心回归用例，周度必须执行
- 🔒 永不自动降级
- 📊 追踪发现的 bug 数

### retired
- ❌ 已下线/低质量
- 📦 移至深度存档
- 🔄 可随时手动复活

---

## 📈 常见场景

### 场景 1: 新 PR 添加用例
```
新用例创建
  ↓
进入 active 层的 candidate 阶段
  ↓
周度运行时执行（最近 4 周）
  ↓
3 周后如果成功率 ≥ 95% → 晋升为 stable
  ↓
8 周后如果发现过 bug → 晋升为 permanent
```

### 场景 2: 旧用例长期验证
```
stable 阶段用例（4 周外）
  ↓
移至 archive 层
  ↓
月度运行时执行
  ↓
持续监控回归
```

### 场景 3: 已下线功能
```
用例失败率 > 50% 且 > 3 周
  ↓
自动移至 retired
  ↓
进入 deep_archive 层
  ↓
按需查询（例如追踪历史 bug）
```

---

## 💾 数据字段速查

### 新增字段
```typescript
// 执行分层
executionLayer: 'active' | 'archive' | 'deep_archive'

// 生命周期
lifecycle: 'candidate' | 'stable' | 'permanent' | 'retired'

// 关键统计
statistics: {
  totalRuns,              // 总运行数
  passedRuns,            // 成功数
  failedRuns,            // 失败数
  consecutiveSuccesses,  // 连续成功次数
  failureRate,           // 失败率 0-1
  bugsFound,             // 发现的 bug 数
  lastBugFoundDate,      // 最后发现 bug 时间
  averageDurationMs      // 平均耗时
}

// 晋升历史
promotion: {
  candidate_since,           // 进入候选时间
  promoted_to_stable_at,     // 晋升稳定时间
  promoted_to_permanent_at,  // 晋升永久时间
  demotion_at,              // 降级时间
  demotion_reason,          // 降级原因
}

// 事件日志
events: [
  { timestamp, event: 'promoted', details: '...' },
  { timestamp, event: 'demoted', details: '...' }
]
```

---

## 🔍 API 简览

### 新方法
```typescript
// 按层级获取用例
getCasesToRunByLayer(layer: 'active' | 'archive' | 'deep_archive'): CaseMetadata[]

// 自动评估并晋升/降级
evaluateAndPromoteCase(caseId: string): { promoted?, demoted?, reason }

// 获取执行计划
getExecutionPlan(): { active, archive, deepArchive, estimatedMinutes }
```

### 既有方法（保持不变）
```typescript
getCasesToRun(mode: 'incremental' | 'full' | 'pr-focused'): CaseMetadata[]
registerCase(metadata: CaseMetadata): void
recordRunResult(result): void
```

---

## 📝 典型 Workflow

### 周度执行流程
```bash
# 1. 获取执行计划
npm run test:get-plan

# 2. 执行活跃层用例
npm run test:accumulated -- --layer active

# 3. 自动晋升用例
npm run test:evaluate-and-promote

# 4. 发送报告
npm run test:report -- --weekly
```

### 月度执行流程
```bash
# 1. 执行候选库用例
npm run test:accumulated -- --layer archive

# 2. 检查晋升候选
npm run test:check-promotions

# 3. 发送月度报告
npm run test:report -- --monthly
```

### 查询和复活
```bash
# 查询深度存档中的特定用例
npm run test:archive:query -- --filter "domain:flight-search"

# 复活特定用例进行回归测试
npm run test:archive:revive -- --caseId "pr-32000-case-7"
```

---

## 📊 预期效果

**优化前**:
- 周度用例: 20 → 40 → 60 → ... (无限增长)
- 执行时间: 100 min → 200 min → 300 min ...
- 数据管理: 无结构化分层

**优化后**:
- 周度用例: 4-6 个（固定）
- 执行时间: ~60 min（固定）
- 数据管理: 三层结构清晰
- bug 发现: 周度 + 月度双覆盖

---

## 🎓 更多信息

- 📖 详细实现: `CASE_LIFECYCLE_IMPLEMENTATION_GUIDE.md`
- 📊 完成报告: `CASE_LIFECYCLE_PHASE1_COMPLETION_REPORT.md`
- 🧪 演示脚本: `test-case-lifecycle-strategy.ts`
- 🎯 总体策略: `CASE_LIFECYCLE_REVISED_STRATEGY.md`

---

## ❓ FAQ

**Q: 会不会删除用例？**  
A: 不会。所有用例永久保存，已下线用例进入 deep_archive，可随时查询/复活。

**Q: 周度执行时间真的能控制在 60 分钟？**  
A: 是的。活跃层仅保留最近 4 周的用例，平均 4-6 个 × 5 分钟 = 20-30 分钟（含验证、报告约 60 分钟）。

**Q: 新 PR 的用例什么时候开始执行？**  
A: 立即开始，进入 active 层的 candidate 阶段，周度执行。

**Q: 如何手动复活已下线的用例？**  
A: 调用 `reviveCase(caseId)` 将其从 retired 改为 candidate，重新进入周度验证。

**Q: 是否支持自定义晋升规则？**  
A: 是的，可以在 `evaluateAndPromoteCase()` 中修改条件参数。

---

**版本**: 1.0  
**更新**: 2025-05-22  
**维护**: GitHub Copilot (Claude Haiku 4.5)
