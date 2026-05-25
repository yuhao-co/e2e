# 🚀 通用Bug检测 - 快速入门

## 1️⃣ 基本用法 (5分钟上手)

### 最简单的方式
```typescript
import { GenericBugDetector } from '../lib/generic-bug-detector';

test('检测航班页面的bugs', async ({ page }) => {
  await page.goto('https://www.traveloka.com/en-en/flight');
  
  // 一行代码，自动检测所有常见bugs
  const detector = new GenericBugDetector(page);
  const bugs = await detector.runFullAudit({
    locale: 'en-US',
    platform: 'desktop'
  });
  
  console.log(`发现 ${bugs.length} 个问题`);
  bugs.forEach(bug => console.log(`[${bug.severity}] ${bug.issue}`));
});
```

## 2️⃣ 理解检测结果

每个检测到的bug包含：
```typescript
{
  id: "unique-id-123",              // 唯一标识
  issue: "missing_translations",    // 问题类型
  category: "i18n",                 // 分类
  severity: "P1",                   // 优先级 (P0-P3)
  description: "发现10个未翻译的key", // 用户友好的描述
  evidence: { /* 详细证据 */ },     // 调试信息
  recommendation: "检查翻译文件",    // 修复建议
  detectionMethod: "automatic"       // 检测方式
}
```

## 3️⃣ 常见场景

### 场景1: 检查翻译质量
```typescript
const bugs = await detector.runFullAudit({
  locale: 'id-ID',    // 检查印尼语
  platform: 'desktop'
});

// 获取只有国际化相关的bugs
const i18nBugs = bugs.filter(b => b.category === 'i18n');
```

### 场景2: 移动端检查
```typescript
await page.setViewportSize({ width: 375, height: 667 });
const bugs = await detector.runFullAudit({
  platform: 'mobile'
});
```

### 场景3: 性能监控
```typescript
const bugs = await detector.runFullAuilt({
  performanceBaseline: {
    lcp: 2000,   // 如果LCP > 2秒就标记为bug
    cls: 0.1     // 如果CLS > 0.1就标记为bug
  }
});
```

### 场景4: 多语言对比
```typescript
const locales = ['en-US', 'id-ID', 'zh-CN'];

for (const locale of locales) {
  const bugs = await detector.runFullAudit({ locale });
  console.log(`${locale}: ${bugs.length} 个问题`);
}
```

## 4️⃣ 快速参考表

### 问题类型对照

| 问题类型 | 常见原因 | 严重程度 |
|---------|--------|--------|
| `missing_translations` | 翻译文件缺失key | P1 |
| `text_overflow_i18n` | 翻译后文本过长 | P2 |
| `character_encoding` | 字符编码不匹配 | P1 |
| `wrong_date_format` | 日期格式不符合locale | P2 |
| `wrong_currency_format` | 货币符号错误 | P2 |
| `technical_error_exposed` | 技术错误信息泄露 | P2 |
| `missing_alt_text` | 图片缺少alt属性 | P2 |
| `missing_form_labels` | 表单缺少标签 | P2 |
| `low_contrast` | 对比度不足 | P3 |
| `horizontal_overflow` | 水平滚动条 | P2 |
| `slow_lcp` | 最大内容绘制太慢 | P1 |
| `high_cls` | 累积布局偏移过大 | P2 |
| `broken_links` | 链接无效 | P2 |
| `network_error` | HTTP错误 | P1/P2 |

## 5️⃣ 集成到现有workflow

### 添加到package.json
```json
{
  "scripts": {
    "test:bugs": "playwright test tests/web/traveloka-generic-bug-detection.spec.ts",
    "test:bugs:mobile": "playwright test tests/web/traveloka-generic-bug-detection.spec.ts -g 'mobile'",
    "test:bugs:i18n": "playwright test tests/web/traveloka-generic-bug-detection.spec.ts -g 'locale'"
  }
}
```

### 运行命令
```bash
# 检测所有bugs
npm run test:bugs

# 只检测移动端
npm run test:bugs:mobile

# 只检测国际化
npm run test:bugs:i18n

# 生成HTML报告
npm run test:bugs -- --reporter=html
```

## 6️⃣ 获取分组报告

```typescript
const summary = detector.getBugsSummary();

console.log(summary);
// 输出:
// {
//   total: 15,
//   byCategory: {
//     i18n: [bug1, bug2, ...],
//     error: [bug3, ...],
//     accessibility: [bug4, ...],
//     ui: [...],
//     performance: [...]
//   },
//   summary: {
//     critical: 1,  // P0
//     high: 3,      // P1
//     medium: 8,    // P2
//     low: 3        // P3
//   },
//   executionTime: 2341  // 毫秒
// }
```

## 7️⃣ 持续监控 - 随机交互

```typescript
test('持续监控 - 模拟用户行为', async ({ page }) => {
  await page.goto('https://www.traveloka.com/en-en/flight');
  
  const detector = new GenericBugDetector(page);
  
  // 模拟用户行为：点击、输入、滚动等
  for (let i = 0; i < 10; i++) {
    // 随机交互
    await page.click('button').catch(() => {});
    await page.scroll(0, 200);
    
    // 每次交互后检测
    const bugs = await detector.runFullAudit();
    console.log(`交互${i}: 发现${bugs.length}个问题`);
  }
});
```

## 8️⃣ 集成Lark通知

```typescript
import { notifyLark } from '../scripts/run-with-lark-notify';

const bugs = await detector.runFullAudit();
const summary = detector.getBugsSummary();

// 构建消息
const message = {
  title: '🔍 通用Bug检测结果',
  content: `
发现 ${summary.total} 个问题
🔴 严重: ${summary.summary.critical}
🟠 高: ${summary.summary.high}
🟡 中: ${summary.summary.medium}
🟢 低: ${summary.summary.low}
  `,
  details: JSON.stringify(summary.byCategory, null, 2)
};

// 发送到Lark
await notifyLark(message);
```

## 9️⃣ 常见问题 (FAQ)

**Q: 为什么没有检测到我期望的bug?**
- 检查是否使用了正确的locale
- 某些bug可能需要特定的viewport或网络条件
- 查看控制台输出的详细日志

**Q: 如何自定义检测规则?**
- 修改 `generic-bug-detector.ts` 中的检测方法
- 添加新的检测方法 `checkCustomIssue()`
- 扩展 `DetectedBug` 接口

**Q: 检测速度太慢?**
- 减少等待时间：`waitForLoadState('domcontentloaded')`
- 并行运行多个detector
- 关闭某些耗时检查（如完整的性能分析）

**Q: 如何减少误报?**
- 调整严重程度阈值
- 为特定页面配置baseline
- 添加元素选择器过滤

## 🔟 下一步

1. ✅ 运行基础测试
2. ✅ 在你的页面上验证
3. ✅ 配置到CI/CD
4. ✅ 收集线上数据
5. ✅ 训练bug分类模型
6. ✅ 自动优先级排序

---

💡 **关键要点**:
- 无需PRD，只需URL和locale
- 自动分类和优先级排序
- 可生成可共享的报告
- 支持多locale和viewport对比
- 可集成LLM进行智能分析
