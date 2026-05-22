# 三层执行策略实现指南

## 📋 目标

解决每周自动测试无限增长的问题：
- ✅ 周度执行时间控制在 ~60 分钟
- ✅ 所有历史用例永久保存，从不删除
- ✅ 自动晋升稳定用例为永久回归
- ✅ 月度全量验证发现回归 bug
- ✅ 按需快速复活存档用例进行调查

---

## 🏗️ 三层执行架构

### 1️⃣ **活跃层 (Active Layer) - 周度执行**

**执行频率**: 每周一次  
**预期时间**: ~60 分钟  
**包含内容**:
- 最近 4 周新增的所有用例（candidate + stable）
- 所有 permanent（永久）用例
- 新增 PR 的用例优先运行

**目的**: 快速反馈、持续验证最新功能

**示例时间表**:
```
Week 1-4:   pr-32211, pr-32210, pr-32209, permanent-cases (总计 ~20-40 cases)
Week 5+:    当新用例进入第5周时，自动移至候选库
```

### 2️⃣ **候选库 (Archive Layer) - 月度执行**

**执行频率**: 每月一次（可选：每两周一次）  
**预期时间**: ~180 分钟（全量历史验证）  
**包含内容**:
- 超过 4 周的稳定（stable）用例
- 非永久、非新候选的所有旧用例
- 进行中的长期稳定性验证

**目的**: 发现回归 bug、验证历史功能完整性、评估晋升候选

**示例时间表**:
```
Month 1, Week 1:  pr-32208, pr-32207, pr-32206, ... (所有 4+ 周的用例)
Month 1, Week 2:  (无执行)
Month 1, Week 3:  (无执行)
Month 1, Week 4:  (无执行)
Month 2, Week 1:  再次执行候选库 (新增用例可能已晋升为 permanent)
```

### 3️⃣ **深度存档 (Deep Archive) - 按需执行**

**执行频率**: 按需（特殊查询或调查）  
**预期时间**: 几分钟到几小时（取决于查询）  
**包含内容**:
- 已下线功能的用例（lifecycle: retired）
- 历史低质量用例
- 功能被删除的用例

**目的**: 快速查询、追踪历史 bug、复活用例进行回归验证

**示例查询**:
```
# 查询关于航班搜索的所有历史用例（包括已下线）
SELECT * FROM deep_archive WHERE domain='flight-search' 

# 复活特定用例进行回归验证
REVIVE pr-32000-case-7 FOR manual-regression-test
```

---

## 🔄 用例生命周期模型

### 状态转换流程

```
                   ┌─────────────────────┐
                   │   新建用例 (PR)     │
                   └──────────┬──────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │   候选 (1-3周)      │   ◄── 活跃层 周度执行
                   │  100% 成功 OR      │
                   │  发现 bug           │
                   └──────────┬──────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
          (95%+ 成功)│        (失败 3 次)│
                    ▼                   ▼
          ┌──────────────────┐  ┌────────────┐
          │  稳定 (3-12周)   │  │ 已弃用     │
          │ 月度监控        │  │ (深度存档) │
          │ 发现回归        │  └────────────┘
          └──────────┬───────┘
                     │
          (8周+ & 95%)│
                     ▼
          ┌──────────────────┐
          │ 永久 (∞周)       │  ◄── 活跃层 周度执行
          │ 核心回归用例    │      永不降级
          │ 永不迁移        │
          └──────────────────┘
```

### 生命周期判定规则

#### 候选 → 稳定 (promotion_rules.candidate_to_stable)
```
触发条件:
  - 年龄 >= 3 周 AND 成功率 == 100% (无任何失败)
  - OR 年龄 >= 2 周 AND 成功率 >= 95% AND 发现过 bug
  - OR 运行次数 >= 3 次 AND 成功率 >= 95%

效果:
  - lifecycle: candidate → stable
  - 记录时间戳: promotion.promoted_to_stable_at
  - 移至月度验证池（但仍在 4 周内也在活跃层）
```

#### 稳定 → 永久 (promotion_rules.stable_to_permanent)
```
触发条件:
  - 年龄 >= 8 周
  - 成功率 >= 95%
  - AND (发现过 bug OR 覆盖核心流程)

效果:
  - lifecycle: stable → permanent
  - 记录时间戳: promotion.promoted_to_permanent_at
  - 永远在活跃层，周度执行
  - 永不自动降级
```

#### 任何 → 已弃用 (promotion_rules.demotion_to_retired)
```
触发条件:
  - (candidate OR stable) AND 年龄 >= 3 周
  - AND 成功率 < 50% (严重失败)
  - OR 连续失败 >= 3 次

效果:
  - lifecycle: X → retired
  - 移至深度存档
  - 不再定期执行
  - 可手动查询/复活

说明: 不能自动清除，必须人工复活才能重新活跃
```

---

## 💾 数据模型扩展

### CaseMetadata 新增字段

```typescript
interface CaseMetadata {
  // 既有字段...
  id: string;
  prNumber?: number;
  domain: 'flight-search' | 'flight-booking' | 'other';
  intent: string;
  intentHash: string;
  path: string;
  addedDate: string;
  status: 'active' | 'deprecated' | 'archived';

  // ============ 新增字段 ============

  /**
   * 执行层级（决定执行频率）
   * active: 周度执行
   * archive: 月度执行
   * deep_archive: 按需执行
   */
  executionLayer?: 'active' | 'archive' | 'deep_archive';

  /**
   * 生命周期阶段（决定质量等级）
   * candidate: 0-3周，评估阶段
   * stable: 3-12周，监控阶段
   * permanent: 永久核心用例，永不降级
   * retired: 已下线，深度存档
   */
  lifecycle?: 'candidate' | 'stable' | 'permanent' | 'retired';

  /**
   * 稳定性统计
   */
  statistics?: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
    skippedRuns?: number;
    lastRunDate?: string;
    lastRunStatus?: 'pass' | 'fail' | 'skip';
    consecutiveSuccesses?: number;
    consecutiveFailures?: number;
    failureRate?: number;
    averageDurationMs?: number;
    maxDurationMs?: number;
    bugsFound?: number;
    lastBugFoundDate?: string;
  };

  /**
   * 晋升/降级历史
   */
  promotion?: {
    candidate_since?: string;
    promoted_to_stable_at?: string;
    promoted_to_permanent_at?: string;
    promotion_reason?: string;
    moved_to_archive_at?: string;
    moved_to_deep_archive_at?: string;
    demotion_at?: string;
    demotion_reason?: string;
    demotion_count?: number;
  };

  /**
   * 事件日志
   */
  events?: Array<{
    timestamp: string;
    event: 'created' | 'promoted' | 'demoted' | 'moved' | 'retired' | 'revived' | 'bug_found';
    details: string;
  }>;
}
```

---

## 🔧 实现步骤

### ✅ Phase 1: 数据模型扩展 (已完成)

- [x] 扩展 CaseMetadata 接口
- [x] 添加 executionLayer、lifecycle、statistics、promotion、events 字段
- [x] 保持向后兼容

### ⏳ Phase 2: 核心方法实现 (进行中)

#### 已实现的方法

1. **getCasesToRunByLayer(layer)** ✅
   ```typescript
   // 根据分层获取用例
   const activeCases = manifest.getCasesToRunByLayer('active');
   const archiveCases = manifest.getCasesToRunByLayer('archive');
   const deepArchiveCases = manifest.getCasesToRunByLayer('deep_archive');
   ```

2. **evaluateAndPromoteCase(caseId)** ✅
   ```typescript
   // 自动评估并晋升/降级用例
   const result = manifest.evaluateAndPromoteCase('pr-32211-case-1');
   if (result.promoted) {
     console.log('晋升成功:', result.reason);
   }
   ```

3. **getExecutionPlan()** ✅
   ```typescript
   // 获取执行计划
   const plan = manifest.getExecutionPlan();
   console.log(`周度: ${plan.active.count} cases`);
   console.log(`月度: ${plan.archive.count} cases`);
   ```

#### 待实现的方法

1. **scheduleAndExecute()** - 根据执行计划自动调度执行
2. **generateLifecycleReport()** - 生成生命周期变化报告
3. **queryDeepArchive(criteria)** - 查询深度存档
4. **reviveCase(caseId)** - 复活已下线用例

### ⏳ Phase 3: 工作流集成 (待开始)

1. 修改 `run-accumulated-cases.ts` 支持 `--layer` 参数
2. 修改 `weekly-diff-workflow.ts` 仅执行活跃层
3. 创建 `run-monthly-archive.ts` 脚本
4. 集成自动晋升引擎到执行流程

### ⏳ Phase 4: 监控和报告 (待开始)

1. 生成周度执行报告
2. 生成月度归档报告
3. 生成生命周期分析报告
4. Lark 集成通知

---

## 📊 演示结果

运行 `scripts/test-case-lifecycle-strategy.ts` 的输出示例：

```
📌 活跃层 (Active Layer) - 周度执行
用例数: 4, 预估时间: 20 分钟
  • pr-32211-case-1 [candidate ] 2 runs, 100.0% pass
  • pr-32210-case-2 [candidate ] 8 runs, 100.0% pass
  • pr-32209-case-3 [stable    ] 12 runs, 91.7% pass
  • pr-32200-case-6 [permanent ] 50 runs, 100.0% pass

📦 候选库 (Archive Layer) - 月度执行
用例数: 2, 预估时间: 10 分钟
  • pr-32208-case-4 [stable    ] 4.0周前, 93.8% pass
  • pr-32207-case-5 [stable    ] 5.0周前, 95.0% pass

🗂️  深度存档 (Deep Archive) - 按需执行
用例数: 1
  • pr-32000-case-7 [retired   ] 30 runs, 50.0% pass

周度执行: 4 cases, 约 20 分钟
月度执行: 2 cases, 约 10 分钟
按需执行: 1 cases, 随时可查询/复活
```

---

## 🎯 关键特性

### 1. **无数据丢失**
- 所有用例永久保存
- 深度存档可随时查询
- 支持用例复活

### 2. **执行时间控制**
- 周度 ~60 分钟（4-6 个用例 × 5 分钟）
- 月度 ~180 分钟（全历史验证）
- 按需查询（几分钟到几小时）

### 3. **自动晋升**
- 候选 → 稳定：3 周 100% 或 2 周 95%
- 稳定 → 永久：8 周 95%+
- 自动降级：失败率 <50% 或连续失败

### 4. **成本优化**
- 新用例集中在活跃层
- 老用例转移到月度验证
- 已下线用例进入存档

### 5. **bug 发现**
- 每周快速反馈
- 每月全面回归验证
- 历史数据完整查询

---

## 🚀 下一步行动

1. **集成到工作流**
   ```bash
   # 运行活跃层（周度）
   npm run test:accumulated -- --layer active
   
   # 运行候选库（月度）
   npm run test:accumulated -- --layer archive
   
   # 查询深度存档
   npm run query:archive -- --filter "domain:flight-search"
   ```

2. **配置自动化**
   - cron job：每周一执行活跃层
   - cron job：每月第一天执行候选库
   - 触发器：PR 发布时执行 PR focused

3. **监控告警**
   - 追踪晋升/降级情况
   - 监测失败率突增
   - 定期报告生命周期变化

---

## 📖 相关文档

- `CASE_LIFECYCLE_ASSESSMENT.md` - 现状分析
- `CASE_LIFECYCLE_REVISED_STRATEGY.md` - 总体策略
- `PRD_EXTRACTION_WORKFLOW.md` - PRD 提取工作流
- `test-case-lifecycle-strategy.ts` - 演示脚本

