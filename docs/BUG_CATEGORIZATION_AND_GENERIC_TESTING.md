# Bug分类、通用case训练与线上监控指南

## 第一部分：Bug 分类体系（Group bugs by category）

### 1. Bug 分类标准框架

#### 1.1 按严重程度分类
```
Critical (P0) - 系统崩溃、无法使用
├── Blocker - 用户无法完成核心流程
├── Major - 功能严重异常但有绕过方法
├── Crash - 应用crash或页面白屏
└── Data Loss - 数据丢失或损坏

High (P1) - 功能异常影响用户体验
├── Wrong behavior - 功能行为不符合预期
├── Performance issue - 明显性能问题（>2s加载）
└── Partial failure - 某些用户或场景失败

Medium (P2) - 边界情况或优化项
├── Edge case - 特殊场景的异常
├── UI/UX issue - 显示问题不影响功能
└── Accessibility - 无障碍问题

Low (P3) - 优化建议
├── Nice to have
├── Documentation
└── Code quality
```

#### 1.2 按业务分类（针对Traveloka）
```
Search & Filter
├── Route not found - 搜索无结果
├── Filter malfunction - 筛选器失效
├── Price calculation - 价格计算错误
└── Sorting issues - 排序错误

Booking Process
├── Form validation - 表单验证错误
├── Payment gateway - 支付网关问题
├── Seat selection - 座位选择失败
└── Carry-over issues - 携带信息转移异常

Localization & i18n
├── Translation errors - 翻译错误或缺失
├── Character encoding - 字符编码问题
├── Date/time format - 日期时间格式错误
├── Currency display - 货币显示错误
└── RTL support - 从右到左语言支持

Technical Issues
├── 404 errors - 页面/API不存在
├── Network errors - 网络问题
├── JavaScript errors - JS控制台错误
├── API response issues - API响应异常
└── Performance degradation - 性能下降

UI/Visual Issues
├── Layout broken - 布局错乱
├── Missing images - 图片加载失败
├── Font issues - 字体显示异常
├── Color/contrast - 颜色对比度不足
└── Button/link state - 按钮状态错误
```

#### 1.3 按根因分类
```
Frontend Issues
├── React/Component error
├── State management error
├── Event handler issue
├── CSS/Layout problem
└── JavaScript error

Backend Issues
├── API error (5xx)
├── Data validation failure
├── Business logic error
├── Database issue
└── Integration failure

Infrastructure
├── Server down
├── Database down
├── CDN issue
├── Rate limiting
└── Timeout

Third-party
├── Payment provider
├── Analytics service
├── Maps/Location service
└── Authentication service

Environmental
├── Browser compatibility
├── Device-specific issue
├── Network condition
└── Regional/ISP issue
```

### 2. Bug 分类工具集成

#### 2.1 自动化标签系统
```typescript
// 建议在bug生成时自动标注
interface BugClassification {
  // 自动识别
  severity: "P0" | "P1" | "P2" | "P3";
  category: "search" | "booking" | "i18n" | "technical" | "ui";
  rootCause: "frontend" | "backend" | "infrastructure" | "third-party" | "environmental";
  
  // 手动补充
  domain: string;  // "flight" | "hotel" | etc
  platform: "android" | "ios" | "web-desktop" | "web-mobile";
  locale?: string;  // "en-US" | "id-ID" | etc
  
  // 元数据
  detectedBy: "automated" | "manual" | "user-report";
  reproducibility: "always" | "sometimes" | "rarely";
  affectedUsers?: number;
}
```

#### 2.2 分类工作流
```
Bug Discovered
    ↓
1️⃣ 初步分类（自动化）
   - 错误类型识别
   - 严重程度评估
   - 关键信息提取
    ↓
2️⃣ 详细分类（AI辅助）
   - 根因分析
   - 影响范围评估
   - 相关bug聚类
    ↓
3️⃣ 优先级排序
   - 严重程度 × 影响用户数 = 优先级
    ↓
4️⃣ 分配给对应团队
   - Frontend / Backend / Infrastructure / Product
```

---

## 第二部分：通用Case训练（Generic Bug Detection）

### 3. 通用bug检测类型

#### 3.1 翻译/国际化错误检测

**问题类型：**
```
✗ 翻译缺失 - 显示key而非翻译文本
  示例: "user_profile_title" 而非 "User Profile"
  
✗ 翻译占位符未替换 - 占位符如 {name} 未被替换
  示例: "Hello {name}, your order is ready" 
  
✗ 文本溢出 - 翻译后文本超过UI容器
  示例: 德文翻译通常比英文长30%
  
✗ 字符编码问题 - 特殊字符显示异常
  示例: 中文显示为方块、阿拉伯文反向
  
✗ 日期/时间格式错误 - 未按locale格式化
  示例: 显示 "05/25/2026" 在格式应为 "25/05/2026" 的地区
  
✗ 货币符号错误 - 显示错误的货币单位
  示例: 在新加坡显示 "$" 而非 "SGD"
  
✗ 复数形式错误 - 不同语言有不同复数规则
  示例: 英文 "1 item" vs "2 items"，但俄文有更复杂规则
```

**自动化检测脚本：**
```typescript
// 检测翻译缺失
async function detectMissingTranslations(page) {
  const allText = await page.locator('*').allTextContents();
  const translationKeyPattern = /^[A-Z_][A-Z0-9_]*$/;
  
  const missingKeys = allText.filter(text => 
    translationKeyPattern.test(text.trim())
  );
  
  if (missingKeys.length > 0) {
    return {
      issue: "missing_translations",
      severity: "P1",
      keys: missingKeys,
      locations: await getElementLocations(page, missingKeys)
    };
  }
}

// 检测文本溢出
async function detectTextOverflow(page) {
  const overflowElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (el.scrollWidth > el.clientWidth || 
              el.scrollHeight > el.clientHeight) &&
             style.overflow === 'hidden';
    }).map(el => ({
      tag: el.tagName,
      text: el.textContent?.substring(0, 50),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth
    }));
  });
  
  if (overflowElements.length > 0) {
    return {
      issue: "text_overflow_i18n",
      severity: "P2",
      elements: overflowElements
    };
  }
}

// 检测日期格式
async function detectDateFormatIssues(page, locale) {
  const expectedFormats = {
    'en-US': /\d{1,2}\/\d{1,2}\/\d{4}/,
    'id-ID': /\d{1,2}\/\d{1,2}\/\d{4}/,
    'de-DE': /\d{1,2}\.\d{1,2}\.\d{4}/,
    'fr-FR': /\d{1,2}\/\d{1,2}\/\d{4}/,
  };
  
  const dateElements = await page.locator('[data-test*="date"], [aria-label*="date"]').all();
  
  for (const el of dateElements) {
    const text = await el.textContent();
    const format = expectedFormats[locale];
    if (!format?.test(text)) {
      return {
        issue: "wrong_date_format",
        severity: "P2",
        locale,
        expected: locale,
        found: text,
        element: await el.getAttribute('data-test')
      };
    }
  }
}
```

#### 3.2 404 和错误页面检测

**问题类型：**
```
✗ 资源404 - 静态资源（JS、CSS、图片）加载失败
✗ API 404 - 调用不存在的API端点
✗ 页面404 - 用户访问不存在的页面
✗ 业务404 - 搜索无结果或ID不存在
✗ 错误页面显示不友好 - 用户看到技术错误而非业务消息
```

**自动化检测：**
```typescript
// 监控所有网络请求
async function detectNetworkErrors(page) {
  const errors = [];
  
  page.on('response', response => {
    if (response.status() === 404) {
      errors.push({
        issue: "404_error",
        severity: "P1",
        url: response.url(),
        type: response.url().includes('/api/') ? 'API' : 'Resource',
        status: response.status()
      });
    }
    if (response.status() >= 500) {
      errors.push({
        issue: "server_error",
        severity: "P0",
        url: response.url(),
        status: response.status()
      });
    }
  });
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({
        issue: "javascript_error",
        severity: "P1",
        message: msg.text()
      });
    }
  });
  
  return errors;
}

// 检测友好的错误消息
async function detectErrorPageQuality(page) {
  const pageTitle = await page.title();
  const pageContent = await page.content();
  
  // 检测技术错误信息泄露
  const technicalPatterns = [
    /stack trace/i,
    /exception/i,
    /at line \d+/i,
    /undefined is not a function/i,
    /Cannot read property/i,
    /SQL error/i,
    /Connection timeout/i
  ];
  
  const hasTechnicalErrors = technicalPatterns.some(p => 
    p.test(pageTitle) || p.test(pageContent)
  );
  
  if (hasTechnicalErrors) {
    return {
      issue: "technical_error_exposed",
      severity: "P2",
      recommendation: "Show user-friendly error message"
    };
  }
}

// 监控搜索结果为空
async function detectNoResultsScenarios(page) {
  const noResultsPatterns = [
    /no results found/i,
    /no flights available/i,
    /nothing found/i,
    /try different search/i
  ];
  
  const pageText = await page.textContent();
  const hasNoResults = noResultsPatterns.some(p => p.test(pageText));
  
  if (hasNoResults) {
    // 检查是否有友好的建议或替代方案
    const suggestions = await page.locator('[data-test*="suggestion"], [data-test*="alternative"]').count();
    
    return {
      issue: hasNoResults ? "no_results" : null,
      severity: "P3",
      hasSuggestions: suggestions > 0,
      suggestions
    };
  }
}
```

#### 3.3 一般UI/UX缺陷检测

**问题类型：**
```
✗ 按钮状态错误 - 禁用/启用状态不正确
✗ 加载状态缺失 - 没有加载指示器
✗ 表单验证缺失 - 允许无效输入
✗ 响应式问题 - 在特定屏幕尺寸显示异常
✗ 无障碍问题 - 缺少alt文本、标签等
✗ 对比度不足 - 文字难以阅读
✗ 链接失效 - 点击无反应或404
✗ 样式异常 - 颜色、字体、间距错误
```

**自动化检测：**
```typescript
// 检测无障碍问题
async function detectAccessibilityIssues(page) {
  const issues = [];
  
  // 检测缺失alt文本的图片
  const imagesWithoutAlt = await page.locator('img:not([alt])').count();
  if (imagesWithoutAlt > 0) {
    issues.push({
      issue: "missing_alt_text",
      severity: "P2",
      count: imagesWithoutAlt
    });
  }
  
  // 检测缺失标签的表单控件
  const inputsWithoutLabel = await page.locator('input:not([aria-label]):not([placeholder])').count();
  if (inputsWithoutLabel > 0) {
    issues.push({
      issue: "missing_form_labels",
      severity: "P2",
      count: inputsWithoutLabel
    });
  }
  
  // 检测按钮可访问性
  const buttons = await page.locator('button').all();
  for (const btn of buttons) {
    const text = await btn.textContent();
    const ariaLabel = await btn.getAttribute('aria-label');
    if (!text?.trim() && !ariaLabel) {
      issues.push({
        issue: "button_not_accessible",
        severity: "P2"
      });
    }
  }
  
  return issues;
}

// 检测对比度
async function detectContrastIssues(page) {
  const contrastIssues = await page.evaluate(() => {
    const issues = [];
    const elements = document.querySelectorAll('[data-test*="button"], a, label');
    
    for (const el of elements) {
      const color = window.getComputedStyle(el).color;
      const bgColor = window.getComputedStyle(el).backgroundColor;
      
      const contrast = calculateContrast(color, bgColor);
      if (contrast < 4.5) { // WCAG AA minimum
        issues.push({
          element: el.tagName,
          contrast: contrast.toFixed(2),
          severity: contrast < 3 ? 'P2' : 'P3'
        });
      }
    }
    return issues;
  });
  
  return contrastIssues;
}

// 检测响应式问题
async function detectResponsiveIssues(page) {
  const issues = [];
  const viewports = [
    { width: 320, height: 568, name: 'iPhone SE' },
    { width: 375, height: 667, name: 'iPhone 8' },
    { width: 414, height: 896, name: 'iPhone 11' },
    { width: 768, height: 1024, name: 'iPad' },
    { width: 1920, height: 1080, name: 'Desktop' }
  ];
  
  for (const vp of viewports) {
    await page.setViewportSize(vp);
    
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflowX) {
      issues.push({
        issue: "horizontal_overflow",
        severity: "P2",
        viewport: vp.name
      });
    }
  }
  
  return issues;
}

// 检测按钮状态
async function detectButtonStateIssues(page) {
  const issues = [];
  
  const buttons = await page.locator('button, [role="button"]').all();
  for (const btn of buttons) {
    const isDisabled = await btn.isDisabled();
    const opacity = await btn.evaluate(el => window.getComputedStyle(el).opacity);
    const cursor = await btn.evaluate(el => window.getComputedStyle(el).cursor);
    
    // 检测不一致的禁用状态
    if (isDisabled && (opacity === '1' || cursor === 'pointer')) {
      issues.push({
        issue: "inconsistent_button_state",
        severity: "P2",
        button: await btn.textContent(),
        isDisabled,
        opacity,
        cursor
      });
    }
  }
  
  return issues;
}
```

#### 3.4 性能问题检测

**问题类型：**
```
✗ 页面加载缓慢 - FCP > 2s
✗ 交互延迟 - 点击响应 > 300ms
✗ 布局抖动 - CLS > 0.1
✗ 内存泄漏 - 内存不释放
✗ 网络请求过多 - 瀑布流问题
```

**检测代码：**
```typescript
async function detectPerformanceIssues(page) {
  const metrics = await page.evaluate(() => {
    const perfData = performance.getEntriesByType('navigation')[0];
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    const clsEntries = performance.getEntriesByType('layout-shift');
    
    return {
      // 核心Web指标
      fcp: perfData?.responseStart - perfData?.fetchStart,
      lcp: lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : null,
      cls: clsEntries.reduce((sum, entry) => sum + entry.value, 0),
      loadTime: perfData?.loadEventEnd - perfData?.fetchStart,
      
      // 资源加载
      resources: performance.getEntriesByType('resource').map(r => ({
        name: r.name,
        duration: r.duration,
        size: r.transferSize
      }))
    };
  });
  
  const issues = [];
  
  if (metrics.lcp > 2000) {
    issues.push({
      issue: "slow_lcp",
      severity: "P1",
      value: metrics.lcp + "ms",
      threshold: "2000ms"
    });
  }
  
  if (metrics.cls > 0.1) {
    issues.push({
      issue: "high_cls",
      severity: "P2",
      value: metrics.cls,
      threshold: "0.1"
    });
  }
  
  // 检测资源过多
  const resourceCount = metrics.resources.length;
  if (resourceCount > 100) {
    issues.push({
      issue: "too_many_requests",
      severity: "P2",
      count: resourceCount
    });
  }
  
  return { ...metrics, issues };
}
```

### 4. 通用case的模型训练策略

#### 4.1 训练数据收集
```
数据源：
├── 历史bug数据库
│   ├── 过去发现的bug
│   ├── 用户报告
│   └── 监控告警
├── 实时监控
│   ├── 线上日志
│   ├── 用户反馈
│   └── 崩溃报告
└── 专家知识
    ├── QA团队规则
    ├── 开发team的已知问题
    └── 业界最佳实践
```

#### 4.2 特征工程
```typescript
interface BugFeature {
  // 页面特征
  pageTitle: string;
  pageUrl: string;
  viewport: { width: number; height: number };
  locale: string;
  
  // 元素特征
  elementSelector: string;
  elementType: string;
  elementText: string;
  elementAttributes: Record<string, string>;
  
  // 行为特征
  interactionType: "click" | "input" | "scroll" | "hover";
  interactionSequence: string[];
  
  // 网络特征
  networkCondition: "slow-4g" | "4g" | "3g" | "wifi";
  apiLatency: number;
  
  // 文本特征
  textLength: number;
  containsSpecialChars: boolean;
  language: string;
  
  // 视觉特征
  colorContrast: number;
  fontSize: number;
  fontFamily: string;
}
```

#### 4.3 模型训练流程
```
1. 数据准备 (70% 训练, 15% 验证, 15% 测试)
2. 特征提取
3. 模型选择
   ├── 决策树 - 用于规则化bug
   ├── 随机森林 - 用于复杂bug
   ├── XGBoost - 用于优先级排序
   └── LLM - 用于描述和root cause分析
4. 交叉验证
5. 超参数调优
6. 模型评估
```

#### 4.4 通用bug检测pipeline

```typescript
class GenericBugDetector {
  async runFullAudit(page, context) {
    const results = {
      timestamp: new Date(),
      url: page.url(),
      bugs: [],
      metrics: {}
    };
    
    // 1. 国际化检查
    results.bugs.push(...await this.checkI18n(page, context.locale));
    
    // 2. 404和错误检查
    results.bugs.push(...await this.checkErrors(page));
    
    // 3. 无障碍检查
    results.bugs.push(...await this.checkAccessibility(page));
    
    // 4. 响应式设计检查
    results.bugs.push(...await this.checkResponsiveness(page));
    
    // 5. 性能检查
    const perfIssues = await this.checkPerformance(page);
    results.bugs.push(...perfIssues.issues);
    results.metrics.performance = perfIssues.metrics;
    
    // 6. 功能完整性检查
    results.bugs.push(...await this.checkFunctional(page));
    
    // 7. AI智能检查（使用Midscene或LLM）
    results.bugs.push(...await this.runAIInspection(page));
    
    // 分组和优先级排序
    return this.groupAndPrioritizeBugs(results);
  }
  
  private groupAndPrioritizeBugs(results) {
    // 按类型分组
    const grouped = {};
    for (const bug of results.bugs) {
      grouped[bug.category] = grouped[bug.category] || [];
      grouped[bug.category].push(bug);
    }
    
    // 按优先级排序
    for (const category in grouped) {
      grouped[category].sort((a, b) => 
        this.calculatePriority(b) - this.calculatePriority(a)
      );
    }
    
    return {
      ...results,
      bugsByCategory: grouped,
      summary: {
        total: results.bugs.length,
        critical: results.bugs.filter(b => b.severity === 'P0').length,
        high: results.bugs.filter(b => b.severity === 'P1').length
      }
    };
  }
  
  private calculatePriority(bug) {
    const severityScore = {
      'P0': 1000,
      'P1': 100,
      'P2': 10,
      'P3': 1
    }[bug.severity];
    
    const impactScore = (bug.affectedElements || 1) * 10;
    return severityScore * impactScore;
  }
}
```

---

## 第三部分：实施路线图

### 5. 集成到现有的Traveloka测试系统

#### 阶段1：基础设施 (2周)
- [ ] 构建Bug分类数据库模型
- [ ] 创建通用bug检测器
- [ ] 集成到测试报告生成

#### 阶段2：国际化监控 (3周)
- [ ] 部署i18n检测
- [ ] 验证支持的语言：en, id, zh, vi, th, ko, ja
- [ ] 创建i18n bug dashboard

#### 阶段3：智能监控 (4周)
- [ ] 训练bug分类模型
- [ ] 集成Midscene AI检查
- [ ] 随机化交互探索

#### 阶段4：持续改进 (持续)
- [ ] 收集监控数据
- [ ] 反馈循环优化模型
- [ ] 定期审查新bug类型

### 6. 建议的工具栈

```
┌─────────────────────────────────────────┐
│        Playwright + Midscene             │ ← 自动化框架
├─────────────────────────────────────────┤
│  ┌──────────────┬──────────────┐        │
│  │ i18n         │ Accessibility│        │ ← 通用检测
│  │ Checker      │ Checker      │        │
│  ├──────────────┼──────────────┤        │
│  │ Performance  │ Visual       │        │
│  │ Monitor      │ Regression   │        │
│  └──────────────┴──────────────┘        │
├─────────────────────────────────────────┤
│   XGBoost / Random Forest (ML Model)     │ ← 分类和优先级
├─────────────────────────────────────────┤
│     Bug Grouping & Categorization       │ ← 分类和聚类
│            System                       │
├─────────────────────────────────────────┤
│   Lark Notifications / Dashboard        │ ← 报告和通知
└─────────────────────────────────────────┘
```

---

## 快速参考

### Bug优先级速查表
| 条件 | 优先级 |
|------|--------|
| 功能完全无法使用 | P0 |
| 核心流程阻断（>10%用户） | P1 |
| 边界情况异常（<10%用户） | P2 |
| 优化建议或文档 | P3 |

### 通用bug检测清单
- [ ] 翻译缺失/错误
- [ ] 404 / 服务器错误
- [ ] JavaScript 控制台错误
- [ ] 无障碍问题
- [ ] 响应式问题
- [ ] 性能低于基线
- [ ] 按钮/链接失效
- [ ] 表单验证失败

### 模型训练关键指标
- **精准率 (Precision)**: 避免误报
- **召回率 (Recall)**: 不遗漏真实bug
- **F1-Score**: 综合指标
- **延迟**: <500ms用于实时检测
