# 🔒 LOCKED WORKFLOW SPECIFICATION

**Version**: 1.0-LOCKED  
**Last Updated**: 2026-05-22  
**Status**: LOCKED - Changes require full documentation

---

## ⛔ IMMUTABLE WORKFLOW STAGES

The following stages **CANNOT** be reordered, skipped, or modified:

```
1. validate-environment        (Check all dependencies exist)
      ↓
2. generate-cases             (Extract diff, create test cases)
      ↓
3. verify-accumulation        (Verify manifest.json structure)
      ↓
4. run-cases                  (Execute all accumulated tests)
      ↓
5. send-notification          (Send results to Lark bot)
      ↓
6. archive-results            (Save manifest snapshot)
```

**Rationale**:
- Order ensures reproducibility and traceability
- Each stage depends on previous stage's outputs
- Skipping stages breaks audit trail and case management

---

## ✅ ALLOWED CUSTOMIZATION (Configuration Only)

These parameters can be customized via CLI flags **WITHOUT** code changes:

| Option | Purpose | Default | Notes |
|--------|---------|---------|-------|
| `--since-days <n>` | Days back to analyze | 7 | Range: 1-365 |
| `--emit-web-spec` | Generate .spec.ts files | false | Enables runnable tests |
| `--skip-run` | Skip test execution | false | For debug mode only |

**Example**:
```bash
# Standard weekly run (7 days, with specs)
npx tsx scripts/weekly-diff-workflow.ts --since-days 7 --emit-web-spec

# Debug mode (no test execution)
npx tsx scripts/weekly-diff-workflow.ts --skip-run

# Extended analysis (14 days back)
npx tsx scripts/weekly-diff-workflow.ts --since-days 14
```

---

## 🔐 CODE-LOCKED CONSTRAINTS

These are hardcoded in the workflow and **CANNOT** be changed via configuration:

```typescript
// Core constraints (in weekly-diff-workflow.ts)
constraints: {
  maxCasesPerRun: 100,              // Prevent runaway case growth
  minPassRateForSuccess: 0,         // Allow any pass rate (not critical)
  maxDurationMs: 3600000,           // 1 hour max execution time
}

// Required files (MUST exist)
requiredFiles: [
  'scripts/generate-cases-from-weekly-diff.ts',
  'scripts/run-accumulated-cases.ts',
  'scripts/lib/accumulation-orchestrator.ts',
  'scripts/lib/accumulation-manifest.ts',
  'scripts/lib/enhanced-locator-generator.ts',
  'scripts/lib/lark-notifier.ts',
  'session-data.json',
  'playwright.config.ts',
  'tsconfig.json',
]

// Required git setup
- Must be in a git repository
- Must have origin/master branch
```

---

## 🚫 FORBIDDEN MODIFICATIONS

**DO NOT MODIFY** (violations require full review + documentation):

### 1. Core Workflow Scripts
- ❌ `weekly-diff-workflow.ts` - Locked entry point (read-only)
- ❌ Reordering/removing stages
- ❌ Adding conditional logic that skips stages

### 2. Accumulation System
- ❌ `scripts/lib/accumulation-manifest.ts` - Manifest structure
- ❌ `scripts/lib/accumulation-orchestrator.ts` - Deduplication logic
- ❌ Changing output directory structure (pr-XXXXX/, snapshot-*)
- ❌ Modifying intent hash algorithm

### 3. Notification System
- ❌ `scripts/lib/lark-notifier.ts` - Notification format
- ❌ Webhook authentication
- ❌ Message card structure

### 4. Test Infrastructure
- ❌ `tests/fixture.ts` - Session injection
- ❌ `session-data.json` - Auth tokens (refresh only)
- ❌ Playwright configuration (use provided config)

---

## 📋 CHANGE CONTROL PROCESS

To modify ANY locked component:

### Step 1: Document Requirement
```
WHY: [Business reason for change]
WHAT: [Specific code/behavior to change]
IMPACT: [Who/what is affected]
RISK: [Potential breaking changes]
```

### Step 2: Create Change Proposal
```
File: WORKFLOW_CHANGES.md
Add:
  - Date & Author
  - Requirement from Step 1
  - Proposed code changes
  - Rollback plan
  - Testing strategy
```

### Step 3: Version Bump
Update `LOCKED_WORKFLOW.version` (only on approval):
```
1.0-LOCKED → 1.1-LOCKED (minor change)
1.0-LOCKED → 2.0-LOCKED (breaking change)
```

### Step 4: Document in CHANGELOG
```
## [New Version] - YYYY-MM-DD
### Changed
- [What changed]
- [Why it changed]
- [Migration path for existing users]
```

---

## ✅ VALIDATION CHECKLIST

Before running workflow, verify:

- [ ] `npx tsx scripts/weekly-diff-workflow.ts --help` shows expected help
- [ ] `generated-cases/manifest.json` has correct structure
- [ ] `LARK_WEBHOOK_URL` set (optional, but recommended)
- [ ] `session-data.json` has valid cookies (not expired)
- [ ] Git repo is clean: `git status` shows no unexpected changes
- [ ] Last 7 days have actual code changes: `git log --oneline -20 origin/master`

---

## 📊 EXPECTED OUTPUTS

After running `npx tsx scripts/weekly-diff-workflow.ts`:

```
generated-cases/
├─ manifest.json                    ✅ Updated with run history
├─ registry.yaml                    ✅ Updated with new cases
├─ pr-32211/                        ✅ New cases accumulated here
│  ├─ case-1.json
│  ├─ case-1.spec.ts                (only if --emit-web-spec)
│  └─ ...
└─ _archives/
   └─ manifest-2026-05-22T...json   ✅ Timestamped snapshot

Console Output:
  ✅ validate-environment
  ✅ generate-cases
  ✅ verify-accumulation
  ✅ run-cases (or ✅ with warning)
  ✅ send-notification
  ✅ archive-results
```

---

## 🆘 TROUBLESHOOTING

| Issue | Solution |
|-------|----------|
| Stage validation fails | Check all required files exist in root |
| No cases generated | Verify git changes exist: `git diff origin/master --name-only` |
| Run stage times out | Check anti-crawler blocking; reduce test count manually |
| Notification not sent | Verify `LARK_WEBHOOK_URL` environment variable |
| Archive fails | Disk space full? Check: `df -h` |

---

## 📞 ESCALATION

If workflow modification is needed:

1. **Minor tuning** (config only)  
   → Use CLI flags: `--since-days`, `--emit-web-spec`

2. **Bug fix** (non-breaking)  
   → File issue with reproduction steps

3. **Feature addition** (new stage/logic)  
   → Contact: [Owner/Team Lead]  
   → Process: Change Control (see above)

4. **Emergency override** (workflow stuck)  
   → Emergency mode: Run individual scripts directly  
   → `npx tsx scripts/run-accumulated-cases.ts --mode full`  
   → Report issue immediately after

---

## 📝 VERSION HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 1.0-LOCKED | 2026-05-22 | Initial locked workflow |

---

**LOCKED - Do not modify without explicit approval**

Last Review: 2026-05-22  
Next Review: 2026-06-22 (if no critical issues)
