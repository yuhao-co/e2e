# 周度测试用例生命周期管理 - 当前状态评估

**日期**: May 22, 2026  
**评估对象**: 当前积累系统是否实现了有界执行范围和用例晋升

---

## 📊 当前实现状态

### ✅ 已实现的基础设施

| 功能 | 状态 | 位置 |
|------|------|------|
| 三层架构 (baseline + committed + registry) | ✅ | `accumulation-manifest.ts` |
| 按 PR/snapshot 组织用例目录 | ✅ | `accumulation-orchestrator.ts` |
| 用例元数据跟踪 (addedDate, status) | ✅ | `CaseMetadata` interface |
| 用例去重 (intentHash) | ✅ | `accumulation-manifest.ts` |
| 运行历史记录 (runHistory) | ✅ | `recordRunResult()` |
| 三种运行模式 (incremental/full/pr-focused) | ✅ | `getCasesToRun()` |

### ❌ 缺失的关键特性

| 功能 | 状态 | 需求 | 影响 |
|------|------|------|------|
| **时间窗口执行限制** | ❌ | "只运行最近 N 周的用例" | 会导致无限增长 |
| **用例晋升流程** | ❌ | 将稳定用例 → 永久回归用例 | 无法识别稳定用例 |
| **用例生命周期** | ❌ | candidate → stable → permanent | 无法区分用例质量 |
| **自动归档机制** | ❌ | 过时用例自动标记为 archived | 无法清理过期用例 |
| **分阶段验证** | ❌ | 候选用例与回归用例分开执行 | 无法控制执行范围 |
| **稳定性指标** | ❌ | 用例通过率、历史成功率 | 无法判断何时晋升 |

---

## 📈 当前执行流程的问题

### 问题 1: 无界增长 ❌

```
Week 1: Generate 5 cases → Total: 5
Week 2: Generate 8 cases → Total: 13
Week 3: Generate 6 cases → Total: 19
...
Week 52: Generate 10 cases → Total: ??? (potentially 300+)

每周执行所有用例 ⇒ 无限制增长 ⇒ 执行时间爆炸
```

**当前代码**:
```typescript
// run-accumulated-cases.ts
getCasesToRun(mode: 'incremental' | 'full' | 'all', prNumber?: number)
  └─ mode='full' 返回所有活跃用例 (无时间限制)
```

### 问题 2: 无法区分用例质量 ❌

```
用例1 (Week 1): 50 周前生成，100% 成功率 → 应该晋升为回归用例
用例2 (Week 1): 50 周前生成，30% 失败率  → 应该归档
用例3 (Week 52): 刚生成，质量未知        → 应该在候选阶段

但目前所有用例 status = 'active'，无法区分
```

### 问题 3: 无分阶段验证 ❌

```
候选阶段 (Candidate):
  - 新生成的周度用例
  - 每周运行 1 次，评估稳定性
  - 如果失败，查看日志调整
  - 3 周内 100% 成功 → 晋升

稳定阶段 (Stable):
  - 晋升的用例
  - 与候选用例混合执行
  - 监控其是否仍然稳定

永久回归 (Permanent):
  - 核心功能用例
  - 每次运行都必须通过

但目前没有这些区分，全部混在一起运行
```

---

## 📋 需要实现的完整方案

### 1. 用例生命周期状态

```typescript
// 增强 CaseMetadata
interface CaseMetadata {
  // ... 现有字段
  
  // 新增：生命周期管理
  lifecycle: 'candidate' | 'stable' | 'permanent' | 'archived';
  
  // 新增：稳定性数据
  statistics: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
    lastRunDate?: string;
    consecutiveSuccesses?: number;  // 连续成功次数
  };
  
  // 新增：晋升信息
  promotion?: {
    promotedAt?: string;
    promotedFrom: 'candidate' | 'stable';
    promotionReason: string;
  };
}
```

### 2. 时间窗口执行策略

```typescript
// 新增运行模式
interface ExecutionStrategy {
  // 执行范围
  windowWeeks: number;      // 只运行最近 N 周的用例
  includeBaseline: boolean; // 是否包含基础回归用例
  includePermanent: boolean;// 是否包含永久用例
  
  // 分层执行
  executeCandidates: boolean;  // 运行候选用例
  executeStable: boolean;      // 运行稳定用例
  
  // 时间限制
  maxDurationMinutes?: number; // 最大执行时间
}

// 示例
{
  windowWeeks: 4,           // 只运行最近 4 周的用例
  includeBaseline: true,    // 总是运行基础用例
  includePermanent: true,   // 总是运行永久用例
  executeCandidates: true,  // 运行候选用例（新生成的）
  executeStable: true,      // 运行稳定用例
  maxDurationMinutes: 60    // 最多 60 分钟
}
```

### 3. 自动晋升流程

```
Candidate Phase (周度1-3):
  └─ 每周运行一次
  └─ 跟踪成功率
  └─ 3 周内 100% 成功 ⇒ 晋升到 Stable

Stable Phase (周度4-12):
  └─ 每周与候选用例混合运行
  └─ 如果失败率 > 5% ⇒ 降级回 Candidate
  └─ 8 周 > 95% 成功 ⇒ 晋升到 Permanent

Permanent:
  └─ 核心回归用例
  └─ 每次都必须运行和通过
  └─ 如果失败，即时告警
```

### 4. 归档策略

```typescript
// 自动归档条件
if (case.lifecycle === 'candidate' && 
    now - case.addedDate > 3 weeks &&
    case.statistics.failureRate > 50%) {
  // 归档：太不稳定，不适合继续
  case.status = 'archived';
  case.lifecycle = 'archived';
}

if (case.lifecycle === 'stable' && 
    now - case.lastRunDate > 8 weeks) {
  // 归档：超过 8 周未运行
  case.status = 'archived';
}
```

---

## 🏗️ 推荐实现顺序

### Phase 1: 数据模型扩展 (Week 1)
- [ ] 扩展 `CaseMetadata` 加入生命周期字段
- [ ] 扩展 `Manifest` 加入晋升规则配置
- [ ] 迁移现有数据到新模型

### Phase 2: 时间窗口执行 (Week 1-2)
- [ ] 实现 `ExecutionStrategy` 接口
- [ ] 修改 `getCasesToRun()` 支持时间窗口
- [ ] 添加默认 4 周时间窗口

### Phase 3: 自动晋升引擎 (Week 2)
- [ ] 实现 `PromotionEngine` 类
- [ ] 跟踪用例成功率
- [ ] 自动晋升/降级逻辑

### Phase 4: 分阶段执行 (Week 2-3)
- [ ] 修改 `run-accumulated-cases.ts` 支持分层执行
- [ ] 候选用例单独统计
- [ ] 分别发送通知

### Phase 5: 归档和清理 (Week 3)
- [ ] 自动识别需要归档的用例
- [ ] 定期清理过期快照目录
- [ ] 保留归档记录

---

## 📊 最终推荐的执行策略

### 默认周度工作流

```
Stage 1: Generate (每周)
  └─ 根据 git diff 生成新用例
  └─ 所有新用例进入 candidate 阶段

Stage 2: Execute (每周)
  └─ 运行范围:
     ├─ 基础用例 (baseline)           - 总是运行
     ├─ 永久回归用例 (permanent)      - 总是运行
     ├─ 最近 4 周的稳定用例 (stable)  - 条件运行
     └─ 最近 2 周的候选用例 (candidate) - 仅运行新用例

Stage 3: Validate & Promote (每周)
  └─ 检查用例稳定性
  └─ 执行晋升/降级逻辑
  └─ 更新用例元数据

Stage 4: Archive (每月)
  └─ 标记 3+ 周无改进的用例
  └─ 清理过期快照目录
  └─ 生成归档报告

Stage 5: Report (每周)
  └─ Lark 通知: 本周执行结果
  └─ 包含: 新用例, 晋升用例, 失败用例
  └─ 链接: 完整报告, 历史趋势
```

### 执行时间控制

```
总执行时间: 最多 60 分钟 / 周
├─ Baseline: 10 min (总是运行)
├─ Permanent: 15 min (总是运行)
├─ Recent Stable (4 weeks): 20 min
├─ Recent Candidate (2 weeks): 10 min
└─ Reserve: 5 min (缓冲)
```

---

## 对比: 当前 vs 推荐

| 方面 | 当前 | 推荐 |
|------|------|------|
| 执行范围 | ❌ 无限(全部用例) | ✅ 有界(4周 + baseline) |
| 执行时间 | ❌ 无限增长 | ✅ 固定 ~60 min |
| 用例质量 | ❌ 无法区分 | ✅ candidate/stable/permanent |
| 自动化晋升 | ❌ 手工管理 | ✅ 自动执行 |
| 过期清理 | ❌ 无 | ✅ 自动归档 |
| 故障排查 | ❌ 混乱(100+ 用例) | ✅ 清晰(20-30 用例) |
| 信息噪音 | ❌ 高 | ✅ 低 |

---

## 💡 结论

**当前系统**:
- ✅ 有基础架构 (manifest, registry, 分层)
- ❌ **缺少生命周期管理** (无时间窗口、无晋升、无清理)

**问题**:
- 周度用例无限增长
- 无法识别稳定用例
- 执行时间和复杂度持续增加
- 难以维护和故障排查

**推荐**:
- 立即实施 4 周时间窗口限制
- 实现自动晋升逻辑
- 集成分阶段执行

**优先级**:
1. 🔴 高: 时间窗口执行 (防止无限增长)
2. 🟠 中: 自动晋升引擎 (识别稳定用例)
3. 🟡 低: 归档机制 (清理过期用例)

---

**建议**: 立即着手实现 Phase 1-2，否则 8 周后系统将无法维护。
