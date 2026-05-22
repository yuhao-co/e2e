# 🔔 Lark 通知集成

## 设置 Lark Webhook

### 1. 获取 Webhook URL

在飞书中创建一个自定义应用或机器人，获取 Webhook URL。

### 2. 配置环境变量

```bash
# 方式 1: .env 文件
echo "LARK_WEBHOOK_URL=https://open.larksuite.com/open-apis/bot/v2/hook/xxx" > .env

# 方式 2: 环境变量
export LARK_WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/xxx"

# 方式 3: npm scripts (package.json)
"scripts": {
  "test:weekly": "LARK_WEBHOOK_URL=xxx npx tsx scripts/generate-cases-from-weekly-diff.ts --run-cases"
}
```

## 自动通知流程

### 生成用例时
```bash
npx tsx scripts/generate-cases-from-weekly-diff.ts --since-days 7 --run-cases
# ✅ 生成完成后自动发送通知
```

### 运行用例时
```bash
npx tsx scripts/run-accumulated-cases.ts --mode full
# ✅ 运行完成后自动发送通知
```

## 通知内容

### 📊 生成通知
显示：
- 生成的新用例数量
- 总累积用例数
- 按域分布
- 存储位置

### ✅/❌ 运行通知
显示：
- 总运行数
- 通过/失败/跳过数
- 失败的用例名称
- 执行时间
- 执行模式

## 禁用通知

如果 `LARK_WEBHOOK_URL` 未设置，通知功能会自动禁用（输出警告但不影响主程序）。

## 故障排查

| 问题 | 解决方案 |
|------|--------|
| 通知未发送 | 检查 `LARK_WEBHOOK_URL` 环境变量是否正确 |
| Webhook 超时 | 检查网络连接和 Webhook 地址有效性 |
| 消息格式错误 | 查看 `lark-notifier.ts` 中的 `escapeLarkText` 转义规则 |

## 模块位置

- **通知模块**: [scripts/lib/lark-notifier.ts](scripts/lib/lark-notifier.ts)
- **集成生成脚本**: [scripts/generate-cases-from-weekly-diff.ts](scripts/generate-cases-from-weekly-diff.ts)
- **集成运行脚本**: [scripts/run-accumulated-cases.ts](scripts/run-accumulated-cases.ts)
