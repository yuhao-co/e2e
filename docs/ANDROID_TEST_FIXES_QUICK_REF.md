# Android Test Failures — Quick Fix Reference

**快速查询表** — 当test失败时，根据error message快速找到修复方案

---

## 🔍 Error Message → Fix Mapping

### "Element not found: quick_filter_item"
**问题**: SSR V4 UI移除了quick filter chips  
**修复**:
```yaml
# 改用full filter dialog
- tapOn:
    id: "flight_result_filter_button_title"
- extendedWaitUntil:
    visible:
      id: "layout_filter_dialog"
    timeout: 10000
- tapOn:
    id: "button_direct"  # 选择filter option
- tapOn:
    id: "dbwShow"  # Apply
```

---

### "Assertion false: search_tab is visible" (after homepage tap)
**问题**: Navigation animation未完成就检查  
**修复**:
```yaml
# 从 assertVisible 改为 extendedWaitUntil
- tapOn:
    id: "image_view_product_icon"
    index: 0
- extendedWaitUntil:  # ← 加这个
    visible:
      id: "search_tab"
    timeout: 10000
```

---

### "Assertion false: card_result is visible" (after sort tap)
**问题**: Sort index不可用 或 timeout太短  
**修复**:
```yaml
# 使用验证过的index + 更长timeout
- tapOn:
    id: "radio_button"
    index: 1  # ← 0=Cheapest, 1=Fastest (安全)
- extendedWaitUntil:
    visible:
      id: "card_result"
    timeout: 45000  # ← 增加到45s
```

---

### "Assertion false: text_result_title is visible" (after card tap)
**问题**: 等待错误的screen元素  
**修复**:
```yaml
# 等待目标screen（fare selection）的元素
- tapOn:
    id: "card_result"
- extendedWaitUntil:
    visible:
      id: "flight_summary_activity_ticket_option_section"  # ← 不是text_result_title
    timeout: 15000
```

---

## 📋 Quick Rules (背下来)

1. **tapOn后必加extendedWaitUntil** — 永远不用assertVisible
2. **SSR V4禁用quick_filter_item** — 全部改用filter dialog
3. **Sort只用index 0或1** — ≥2需要screenshot验证
4. **Navigation后等新screen元素** — 不要等旧screen

---

## ⚡ Common Scenarios Quick Copy

### Sort by Fastest
```yaml
- tapOn:
    id: "flight_result_sort_button_title"
- extendedWaitUntil:
    visible:
      id: "layout_tray"
    timeout: 10000
- tapOn:
    id: "radio_button"
    index: 1  # Fastest
- extendedWaitUntil:
    visible:
      id: "card_result"
    timeout: 45000
```

### Apply Direct Filter (SSR V4)
```yaml
- tapOn:
    id: "flight_result_filter_button_title"
- extendedWaitUntil:
    visible:
      id: "layout_filter_dialog"
    timeout: 10000
- tapOn:
    id: "button_direct"
- tapOn:
    id: "dbwShow"
- extendedWaitUntil:
    visible:
      id: "card_result"
    timeout: 30000
```

### Homepage → Search
```yaml
- stopApp: com.android.chrome
- stopApp
- launchApp
- extendedWaitUntil:
    visible:
      id: "widget_highlighted_product"
    timeout: 30000
- tapOn:
    id: "image_view_product_icon"
    index: 0
- extendedWaitUntil:  # ← 关键：不用assertVisible
    visible:
      id: "search_tab"
    timeout: 10000
```

### View Fare Selection
```yaml
- tapOn:
    id: "card_result"
    index: 0
- extendedWaitUntil:
    visible:
      id: "flight_summary_activity_ticket_option_section"
    timeout: 15000
# 返回
- back
- extendedWaitUntil:
    visible:
      id: "card_result"
    timeout: 15000
```

---

## 🎯 Validation Checklist (生成后检查)

生成YAML后，用这个checklist自检：

- [ ] 所有tapOn后都有extendedWaitUntil（不是assertVisible）
- [ ] SSR V4 scenarios没有使用quick_filter_item
- [ ] Sort的index只用0或1
- [ ] Navigation后等待的是新screen的元素
- [ ] 所有timeout值合理（sort≥45s, nav≥10s, dialog≥5s）

---

## 📚 详细文档

完整anti-patterns分析和案例研究：
- `/memories/repo/android-maestro-anti-patterns.md`

System prompt中的集成规则：
- `scripts/generate-maestro-android.ts` → buildSystemPrompt() → CRITICAL ANTI-PATTERNS section
