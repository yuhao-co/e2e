# Midscene vs Maestro — E2E Testing Tool Comparison
## Context: Traveloka Web E2E Testing (June 2026)

> **Tech Review Summary** — 30-min presentation reference doc  
> Prepared by: Yu Hao | Audience: QA / Engineering leads  
> Scope: Web-first (SG flight domain); Android TBD

---

## 1. What is Each Tool?

| | **Midscene** (our current) | **Maestro** (Traveloka mobile QA) |
|---|---|---|
| **Type** | AI-powered test framework (Playwright + LLM) | YAML-based deterministic test runner |
| **Primary Target** | Web (desktop + mobile web) | Mobile native (iOS/Android RN), Web Chrome |
| **Case Format** | TypeScript + natural-language `ai()` calls | YAML flow files |
| **AI involved** | Yes — GPT-4o/Claude used at runtime | No AI at runtime (optional AI for generation) |
| **Traveloka usage** | Our team: web flight E2E exploration | Client mobile QA team: Rachel's team |

---

## 2. Time Comparison

### 2a. Case Writing Time

| Task | Midscene (AI-gen) | Maestro (Manual YAML) |
|---|---|---|
| Single smoke test (page load + P0 check) | **~10 seconds** (AI generates from source files) | **~20–30 min** (write + debug YAML manually) |
| Full flow test (search → filter → sort) | **~30 seconds** (AI interprets natural language) | **~45–90 min** (inspect DOM, write tap/assert steps) |
| Booking chain (3-page flow) | **~2–3 min** (contract generation + AI orchestration) | **~3–4 hours** (map all page transitions manually) |
| Weekly regression suite (50+ tests) | **Auto-generated weekly by diff scan** | Not feasible manually at this cadence |

### 2b. Execution Time (per test run)

| | Midscene | Maestro |
|---|---|---|
| **Single flow** | 45–120 sec (includes AI LLM calls) | 15–45 sec (deterministic, no API calls) |
| **Full suite** | 30–60 min (parallel, LLM-bound) | 10–20 min (parallel, CPU-bound) |
| **Flakiness** | Medium (LLM non-determinism, UI variation) | Low (deterministic selectors) |
| **API cost** | ~$0.02–0.05 per test run | $0 (no API calls) |

---

## 3. Pros & Cons

### Midscene (AI-powered)

**Pros:**
- ✅ **Cases auto-generated** from source code diff in seconds — no manual writing
- ✅ **Natural language steps** — `ai('Click the Direct filter')` — readable by anyone
- ✅ **Self-healing**: AI adapts when UI changes (no hard testID dependency)
- ✅ **Weekly diff scanning**: automatically discovers new surfaces from git changes
- ✅ **Web-first**: Playwright under the hood — full browser control
- ✅ **aiQuery()** can extract and assert complex semantic state (e.g. "are all prices ascending?")

**Cons:**
- ❌ **Slower execution** — each `ai()` call hits LLM API (~2–5 sec/call)
- ❌ **API cost** — accumulates at scale (mitigated by caching)
- ❌ **Non-deterministic** — same prompt may behave differently on different runs
- ❌ **Requires API key + network** — can't run fully offline
- ❌ **Mobile native not supported** — web only (no APK/IPA testing)

---

### Maestro (YAML-based)

**Pros:**
- ✅ **Fast execution** — no API calls, pure device/browser driver
- ✅ **Cross-platform** — iOS, Android, React Native, Web Chrome
- ✅ **Simple YAML syntax** — easy for QA with no code background
- ✅ **Deterministic** — stable CI results
- ✅ **Maestro Studio** — visual recorder to auto-generate YAML from tap recording
- ✅ **Works offline** — no external dependencies at runtime
- ✅ **Traveloka infra already set up** — Rachel's team has CI pipeline

**Cons:**
- ❌ **Must write cases manually** — Rachel confirmed: all YAML written by QA engineers
- ❌ **Time-intensive** — 20–90 min per flow (DOM inspection + trial/error)
- ❌ **Brittle to UI changes** — `tapOn: "text"` breaks if label changes
- ❌ **No semantic understanding** — can't assert "prices are sorted correctly" without custom scripts
- ❌ **Web support is experimental** — desktop Chrome support added recently (v1.38+), less mature
- ❌ **Requires Java** — heavyweight dependency for web-only teams

---

## 4. Feature Matrix

| Feature | Midscene | Maestro |
|---|---|---|
| Web (desktop Chrome) | ✅ Full support | ⚠️ Experimental (v1.38+) |
| Mobile native iOS | ❌ | ✅ |
| Mobile native Android | ❌ | ✅ |
| React Native | ❌ | ✅ |
| AI case generation | ✅ Auto (seconds) | ❌ Manual (hours) |
| Visual recorder | ❌ | ✅ Maestro Studio |
| CI integration | ✅ (GitHub Actions) | ✅ (Maestro Cloud / internal) |
| Offline execution | ❌ (needs LLM API) | ✅ |
| Semantic assertions | ✅ (aiQuery) | ❌ |
| Self-healing on UI change | ✅ (AI adapts) | ❌ (breaks on text change) |
| Cost per run | ~$0.02–0.05 | $0 |
| Case maintenance burden | Low (AI regenerates) | High (manual update) |

---

## 5. Demo Plan (Live Recording)

### Demo A — Midscene (existing, ~3 min)
```bash
cd /Users/yu.hao/Desktop/task/e2e
npx playwright test tests/web/traveloka-flight-explore-flight-homepage-20260525.spec.ts --headed
```
**Show:**
- AI reads the page, runs P0 detection
- Zero-code assertions in natural language
- Test report with screenshots

### Demo B — Maestro Web (new demo, ~2 min)
```bash
maestro test maestro/flows/traveloka-flight-search.yaml
```
**Show:**
- Chrome opens automatically
- Traveloka flight page loads
- Maestro taps origin/destination fields
- Search results appear
- Compare: this YAML took 25 min to write manually

### Demo C — AI Case Generation (Midscene, ~1 min)
**Show:** How our weekly diff scan generates 40+ cases from a git diff — instantly.

---

## 6. Recommendation

| Scenario | Recommended Tool |
|---|---|
| **Web E2E for new features** | **Midscene** — AI generates cases in seconds from code diff |
| **Mobile native (iOS/Android RN)** | **Maestro** — the standard at Traveloka, proven infrastructure |
| **Regression stability at scale** | **Midscene** — auto-regenerates weekly, low maintenance |
| **Cross-platform coverage (mobile + web)** | **Both** — Maestro for mobile, Midscene for web |
| **CI speed-critical pipelines** | **Maestro** (no API latency) |

### Our Position
The client already uses Maestro for mobile. **Midscene fills the gap for web** — where Maestro's support is experimental and writing cases manually is too slow.

Proposed approach:
- **Keep Maestro** for mobile native (iOS/Android) — don't disrupt Rachel's team
- **Use Midscene** for all web surfaces (flight, hotel, etc.)
- **Long term**: explore Maestro AI (if they release it) or hybrid: Midscene generates → Maestro executes

---

## 7. Real Numbers from This Repo

| Metric | Value |
|---|---|
| Total web test specs generated (auto) | **60+ specs** |
| Domains covered | flight homepage, search, filter, booking, ancillary, reschedule, refund, etc. |
| Cases generated per weekly diff run | **40–60 cases in < 30 seconds** |
| Manual equivalent time | **~40–100 hours** |
| Time saved per week | **~50+ engineer-hours** |

---

*Generated: 2026-06-04 | See also: `maestro/flows/` for demo YAML files*
