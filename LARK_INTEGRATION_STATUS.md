# Lark 通知集成完成 ✅

**日期**: 2026-05-22  
**状态**: 已投入使用

---

## 🎯 实现内容

### 1. **创建 Lark 通知模块**
新文件: `/scripts/lib/lark-notifier.ts`
- ✅ 封装 Lark webhook 通信逻辑
- ✅ 提供 `notifyTestResults()` 函数（测试运行结果）
- ✅ 提供 `notifyCustom()` 函数（自定义消息）
- ✅ 自动转义 Lark markdown 特殊字符
- ✅ 环境变量 `LARK_WEBHOOK_URL` 支持

### 2. **集成到生成脚本**
修改: `/scripts/generate-cases-from-weekly-diff.ts`
- ✅ 导入 `notifyCustom` 函数
- ✅ 生成完成后自动发送通知
- ✅ 包含统计信息：生成数量、总数、按域分布
- ✅ 显示输出位置（pr-XXXXX/ 或 snapshot-DATE/）

### 3. **集成到运行脚本**
修改: `/scripts/run-accumulated-cases.ts`
- ✅ 导入 `notifyTestResults` 函数
- ✅ 运行完成后自动发送通知
- ✅ 包含详细结果：总数、通过/失败/跳过数
- ✅ 列出失败的用例名称

### 4. **文档更新**
- ✅ [LARK_NOTIFICATION_SETUP.md](LARK_NOTIFICATION_SETUP.md) - 配置指南
- ✅ [QUICK_START.md](QUICK_START.md) - 更新快速参考
- ✅ 添加故障排查指南

---

## 📊 通知流程

### 生成阶段通知
```
npx tsx scripts/generate-cases-from-weekly-diff.ts --run-cases
         ↓
    [生成 N 个用例]
         ↓
    [发送 Lark 通知]
         ├─ 标题: 📊 Weekly Diff Generation Complete
         ├─ 内容: 生成数量、总数、分布
         └─ 颜色: 绿色(成功)或黄色(部分)
```

### 运行阶段通知
```
npx tsx scripts/run-accumulated-cases.ts --mode full
         ↓
    [运行所有用例]
         ↓
    [发送 Lark 通知]
         ├─ 标题: ✅/❌ Test Execution Results
         ├─ 内容: 通过/失败/跳过数、失败用例
         └─ 颜色: 绿色(全通过)或红色(有失败)
```

---

## 🚀 使用方式

### 设置 Lark Webhook

```bash
# 方式 1: 环境变量
export LARK_WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/xxx"

# 方式 2: .env 文件
echo "LARK_WEBHOOK_URL=https://..." > .env

# 方式 3: 直接在命令中
LARK_WEBHOOK_URL="https://..." npx tsx scripts/generate-cases-from-weekly-diff.ts
```

### 自动发送通知

```bash
# 生成 + 运行 + 通知
npx tsx scripts/generate-cases-from-weekly-diff.ts \
  --since-days 7 \
  --emit-web-spec \
  --run-cases

# 仅运行 + 通知
npx tsx scripts/run-accumulated-cases.ts --mode full

# 如果未设置 LARK_WEBHOOK_URL，通知会自动禁用（无错误提示）
```

---

## 📋 通知内容示例

### 生成通知
```
📊 Weekly Diff Generation Complete

Generated: 7/10 new cases
Total accumulated: 43

By domain:
• flight-search: 22
• flight-booking: 21

Location: generated-cases/pr-32211/

✅ Test cases auto-run (see separate notification)
```

### 运行通知
```
✅ Test Execution Results

Mode: full
Total: 43 | Passed: 40 | Failed: 3 | Skipped: 0
Pass Rate: 93%
Duration: 2m 15s

Failed Cases: pr-32211-case-2, pr-32212-case-1, +1 more
```

---

## 🔧 技术细节

### Lark 卡片格式
- 使用 Lark 交互式卡片 (interactive)
- 支持 Markdown 文本 (lark_md tag)
- 彩色头部: 绿色(green)、黄色(yellow)、红色(red)

### 错误处理
- 通知失败不会影响主程序
- 自动捕获异常并打印警告
- 无 LARK_WEBHOOK_URL 时自动禁用

### 环保考虑
- 通知仅在流程完成时发送（非实时）
- 减少数据传输（仅摘要统计）

---

## ✅ 完成清单

- [x] 创建 `lark-notifier.ts` 模块
- [x] 集成到 `generate-cases-from-weekly-diff.ts`
- [x] 集成到 `run-accumulated-cases.ts`
- [x] 环境变量支持
- [x] 错误处理
- [x] 文档更新
- [x] 测试通过

---

## 📁 相关文件

- **通知模块**: [scripts/lib/lark-notifier.ts](scripts/lib/lark-notifier.ts)
- **生成脚本**: [scripts/generate-cases-from-weekly-diff.ts](scripts/generate-cases-from-weekly-diff.ts) (已集成)
- **运行脚本**: [scripts/run-accumulated-cases.ts](scripts/run-accumulated-cases.ts) (已集成)
- **配置指南**: [LARK_NOTIFICATION_SETUP.md](LARK_NOTIFICATION_SETUP.md)
- **快速参考**: [QUICK_START.md](QUICK_START.md) (已更新)

---

**系统状态**: ✅ 准生产环境  
**Lark 通知**: ✅ 已激活（需设置 LARK_WEBHOOK_URL）  
**最后更新**: 2026-05-22
