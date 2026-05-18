# d2p 新 phase：mockup-first — 先 HTML 原型对齐预期再 differ/implementer

> d2p 给用户做事的工作流新增一个 leading phase：用户给完 demo + vision 后，**d2p 先用 HTML/CSS 把"成品长啥样"做出来**，给用户审；用户对齐预期后，differ 拿着 vision + approved mockup 一起找 gap，再走 implementer / reviewer / merge。

**Scope source**：用户 2026-05-18：
> "d2p 产品的使用过程，也可以参考这个 — 能通过 html 先实现用户预期效果的就先实现一下，之后再进行找、修改、验证"

**这个 plan 本身也走 mockup-first**：Batch 1 是把"mockup phase 在 d2p UI 上长啥样"做成静态原型，你浏览器点完拍板，再开发真实 mockup-implementer agent。

---

## Acceptance checklist（开工前自检）

1. **目标**：vision finalize 后、differ 启动前，自动跑 mockup-implementer，输出静态 HTML/CSS 落到 `<demo>/.d2p/mockup/`；UI 展示给用户审；用户「approve / 修订建议 / 跳过」三选一；approved mockup 作为 differ 的额外输入
2. **不变量**：差不动现有 vision elicit / differ / implementer / reviewer 主流程；不破 UI 单测；不引新 npm dep；CLAUDE.md / README 产品定位文档不动
3. **验证命令**：`npm test` 全绿 + `node scripts/smoke-mockup-phase.mjs`（Batch 5 新增）+ 真 cc 手 smoke 一个 saas-web fixture
4. **不做**：① UI-less demos（cli-tool / library / api-service）暂不强制 mockup phase（degrade 成 "spec sketch" 是 follow-up） ② mockup 不带真实数据 fetch（纯静态展示）③ mockup 不进 git commit 主分支（只存 `.d2p/mockup/`） ④ 不动 Mode A multi-turn 那一套（独立 plan）
5. **完成标准**：saas-web 类 fixture 跑通；UI 上能看到 mockup → 用户能 approve / 提建议 → differ 看到 mockup 输入；测试可由他人 clone + `npm test` 复跑

---

## Plan — 具体改什么

### Batch 1（mockup of the mockup phase）— 静态原型，先给你点头

**Plan**

把"mockup phase 在 d2p UI 上的样子"用 React + mock data 做出来，preview 路径访问：

- `?preview=mockup-phase/drafting` — mockup-implementer 正在跑
- `?preview=mockup-phase/review` — mockup 跑完，用户在审
- `?preview=mockup-phase/approved` — 用户点头，进 differ
- `?preview=mockup-phase/revising` — 用户提了建议，mockup-implementer 再跑一轮

UI 内容：
- **drafting** 态：spinner + "d2p 正在为你画产品成品的样子…" + "已经画好 N / M 页" 进度
- **review** 态：主区 iframe 显示当前 page；侧边缩略导航（点切页）；底部操作行 [✓ 这就是我想要的] [✎ 我想改一下] [→ 跳过这步]
- **revising** 态：review 布局 + 半透明遮罩 "正在按你的建议重画…"
- **approved** 态：缩略 + 大字 "✓ 已对齐预期 · differ 正在按这个目标找 gap…"

不接后端，纯 mock data + preview route。

**Expected Outputs**

- `ui/src/mock/mockupPhase.ts` — 类型定义 + 4 个 canned states（mockupDrafting / mockupReview / mockupRevising / mockupApproved）
- `ui/src/components/MockupPhasePanel.tsx` — 4 态布局组件，Tailwind + 现有色盘
- `ui/src/preview/Preview.tsx`（改）— 加 `?preview=mockup-phase/<state>` 路由分支
- `ui/src/preview/PreviewIndex.tsx`（改）— 加 "Mockup-first phase" section card，4 链接
- `ui/src/components/MockupPhasePanel.test.tsx` — jsdom 单测 8-10 条
- `ui/tests-e2e/mockup-phase.spec.ts` — Playwright e2e，4 态各 screenshot
- `docs/plans/2026-05-18-mockup-first-phase.md`（本文）— 扩充到 6-batch 完整 plan

**How To Verify**

```bash
# 1. 单测全绿
cd ui && npx vitest run

# 2. TypeScript clean
cd ui && npx tsc --noEmit

# 3. 浏览器各 preview 路径手动验证（或 Playwright e2e）
#    ?preview=mockup-phase/drafting
#    ?preview=mockup-phase/review
#    ?preview=mockup-phase/revising
#    ?preview=mockup-phase/approved

# 4. Playwright e2e（截图落 design-screenshots/）
cd ui && npx playwright test tests-e2e/mockup-phase.spec.ts
```

**Probes**

```
1. haiku probe: "MockupPhasePanel component receives phase='review', pages=[{name,route,title,description,htmlPreviewSrc}×3].
   What distinct visible elements MUST appear?" → JSON {elements: string[]}
2. sonnet subagent (fresh): 同问 → JSON
3. real run: jsdom render + screen.getAllByRole → verbatim DOM output
```

---

### Batch 2 — daemon 侧 mockup-implementer agent role

**Plan**

在 daemon 里新增 mockup-implementer agent role，orchestrator 在 vision finalize 后插入 `MOCKUP_DRAFTING` 状态。

具体改动：
- 新 prompts/role：`mockup-implementer.md`（输入：vision.md + project type + 现有 README → 输出：多个 HTML + inline CSS + 假数据）
- `daemon/src/orchestrator/phases.ts`（改）：vision finalize 后插入 `MOCKUP_DRAFTING` → `MOCKUP_REVIEW` 状态机
- `daemon/src/agents/mockupImplementer.ts`（新）：子进程 `cc --model sonnet -p` 驱动，解析输出 html 块，写到 `.d2p/mockup/`
- 新 SSE event kinds：`MOCKUP_DRAFTING` / `MOCKUP_PAGE_WRITTEN` / `MOCKUP_PROPOSED` / `MOCKUP_APPROVED` / `MOCKUP_REVISION_REQUESTED`
- `daemon/src/db/migrations/<next>-mockups.ts`（新）：`mockups` 表 (session_id, version, paths_json, status, user_feedback, created_at)
- `daemon/src/routes/mockup.ts`（新）：`GET /api/sessions/:id/mockup` / `POST /api/sessions/:id/mockup/approve` / `POST /api/sessions/:id/mockup/revise`
- `daemon/src/server.ts`（改）：注册新 routes

**Expected Outputs**

- `prompts/mockup-implementer.md` — agent system prompt
- `daemon/src/agents/mockupImplementer.ts`
- `daemon/src/orchestrator/phases.ts`（改）
- `daemon/src/db/migrations/<next>-mockups.ts`
- `daemon/src/routes/mockup.ts`
- `daemon/src/server.ts`（改）
- `daemon/src/tests/mockupImplementer.test.ts` — vitest：子进程输出解析 + html 写盘
- `daemon/src/tests/routes-mockup.test.ts` — vitest：3 routes smoke（in-process）

**How To Verify**

```bash
cd daemon && npx vitest run    # 全绿，含新 2 个测试文件
# smoke：
node scripts/smoke-mockup-phase.mjs --step=agent-only
# 期望输出：
# [mockup-implementer] wrote 3 pages to .d2p/mockup/
# [mockup routes] GET /api/sessions/1/mockup → {pages:3, status:'proposed'}
```

**Probes**

```
1. haiku probe: "mockup-implementer 的 system prompt 应该包含哪些关键指令？" → JSON {must_include: string[]}
2. sonnet subagent (fresh): 同问 → JSON
3. real run: 跑 smoke-mockup-phase.mjs --step=agent-only，捕获 stdout，提取 pages 列表
```

---

### Batch 3 — differ 吃 mockup 输入

**Plan**

differ 拿到 vision.md + approved mockup 一起找 gap。

具体改动：
- `daemon/src/agents/differ.ts`（改）：读 `.d2p/mockup/manifest.json`（若存在），把 approved pages 概要注入 differ prompt（HTML → 短意图描述，避免 token 爆炸）
- `daemon/src/prompts/differ.md`（改）：加 `{{mockupContext}}` 占位符
- `ui/src/types.ts`（改）：`Gap.source` 扩展为 `'preset' | 'vision' | 'mockup' | 'both' | 'all'`
- `daemon/src/types.ts`（改）：同步扩展 `GapSource`
- `daemon/src/tests/differ-mockup.test.ts`（新）：fixture diff — saas-web + mockup 输入，断言 gap 列表包含 `source: 'mockup'` 项

**Expected Outputs**

- `daemon/src/agents/differ.ts`（改）
- `daemon/src/prompts/differ.md`（改）
- `daemon/src/types.ts`（改）
- `ui/src/types.ts`（改）
- `daemon/src/tests/differ-mockup.test.ts`（新）

**How To Verify**

```bash
cd daemon && npx vitest run
# 新测试 differ-mockup 通过，gap 列表出现 source:'mockup' 项
node scripts/smoke-mockup-phase.mjs --step=differ-only
# 期望: gap list contains >=1 item with source:'mockup'
```

**Probes**

```
1. haiku probe: "given an approved mockup with pages [landing,dashboard,settings], what gap titles might differ generate with source='mockup'?" → JSON {gaps: string[]}
2. sonnet subagent (fresh): 同问 → JSON
3. real run: smoke differ-only → verbatim gap list
```

---

### Batch 4 — Wire-in：UI 接真 SSE + 真 HTTP

**Plan**

把 Batch 1 的静态 mockup preview 接到真 daemon。

具体改动：
- `ui/src/store.ts`（改）：新增 `mockupPhase: MockupPhaseState | null` 字段；SSE handler 处理新 event kinds
- `ui/src/api.ts`（改）：新增 `approveMockup(sessionId)` / `reviseMockup(sessionId, feedback)` / `skipMockup(sessionId)`
- `ui/src/components/Workspace.tsx`（改）：在 session LOOPING 前插入 mockup phase 面板（若 mockupPhase 非 null 且非 approved）
- `MockupPhasePanel.tsx`（改）：从 prop/store 取真实 state；approve / revise / skip 按钮触发 api.ts 调用
- `ui/src/components/MockupPhasePanel.test.tsx`（改）：新增 api mock + approve/revise 回调测试
- Playwright e2e：`mockup-phase.spec.ts` 加 `approve-flow` test（fake-daemon + fake-claude shim）

**Expected Outputs**

- `ui/src/store.ts`（改）
- `ui/src/api.ts`（改）
- `ui/src/components/Workspace.tsx`（改）
- `ui/src/components/MockupPhasePanel.tsx`（改）
- `ui/src/components/MockupPhasePanel.test.tsx`（改）
- `ui/tests-e2e/mockup-phase.spec.ts`（改）

**How To Verify**

```bash
cd ui && npx vitest run   # 全绿，含新 api mock 测试
cd ui && npx playwright test tests-e2e/mockup-phase.spec.ts
# approve-flow: GET /mockup → 3 pages, POST /approve → differ starts
node scripts/smoke-mockup-phase.mjs   # full end-to-end smoke
```

**Probes**

```
1. haiku: "POST /api/sessions/1/mockup/approve after approve, what does the SSE stream emit next?" → JSON {events: string[]}
2. sonnet subagent (fresh): 同问 → JSON
3. real run: smoke full → verbatim SSE log
```

---

### Batch 5 — smoke + cross-engine probe

**Plan**

完整 smoke 脚本 + 跨引擎 prompt 一致性验证。

具体改动：
- `scripts/smoke-mockup-phase.mjs`（新）— fake-claude 输出固定 3 页 HTML；断言：
  1. `.d2p/mockup/landing.html` 落地
  2. GET /api/sessions/1/mockup → `{status:'proposed', pages:3}`
  3. POST /approve → SSE emit `MOCKUP_APPROVED`
  4. differ gap 列表 ≥1 item with `source:'mockup'`
- FEATURE-VALIDATION 1+2+3 跨引擎核对 mockup-implementer prompt 输出 schema

**Expected Outputs**

- `scripts/smoke-mockup-phase.mjs`
- FEATURE-VALIDATION report（3-way JSON compare，commit message body 里 inline）

**How To Verify**

```bash
node scripts/smoke-mockup-phase.mjs
# 期望：All 4 assertions PASS
# Exit 0
```

**Probes**

```
1. haiku: "given vision='SaaS notes app with auth' + projectType='saas-web', what mockup pages MUST exist?" → {pages:['landing','dashboard','settings']}
2. sonnet subagent (fresh): 同问 → JSON
3. real run: fake-claude 跑 mockup-implementer → 输出 pages 列表
```

Gate 1 ≠ Gate 2（`jq -S` byte-identical）→ 不 ship，重审 prompt。

---

### Batch 6 — plan followup + retrospective

**Plan**

回顾 Batch 1-5 执行情况，记录设计决策与遗留风险，更新 DEV-DOC。

具体改动：
- `docs/plans/2026-05-18-mockup-first-phase.md`（本文，增补 Batch 6 section）— 执行结果 / 偏差记录 / 性能数据
- `docs/DEV-DOC.md`（改）— §orchestrator 新增 mockup phase 状态机节点；§schema 新增 mockups 表
- `docs/plans/2026-05-18-mockup-first-retrospective.md`（新）— 回顾文档

**Expected Outputs**

- `docs/plans/2026-05-18-mockup-first-phase.md`（更新）
- `docs/DEV-DOC.md`（改）
- `docs/plans/2026-05-18-mockup-first-retrospective.md`（新）

**How To Verify**

```bash
# 人工 review：DEV-DOC 新增的状态机与 Batch 2 实现一致
grep -n 'MOCKUP_DRAFTING' docs/DEV-DOC.md   # must appear
grep -n 'mockups' docs/DEV-DOC.md           # must appear
```

**Probes**

N/A（docs-only batch）。

---

## Expected Outputs（全 6 batch 汇总）

完成后：
- 7+ 新 daemon 源文件（mockup-implementer agent / routes / migration / differ 改）
- 7+ 新 UI 源文件（mockupPhase.ts / MockupPhasePanel.tsx / store 改 / api 改 / Workspace 改 / 两个测试）
- 1 个 smoke 脚本（smoke-mockup-phase.mjs）
- 2 个 plan / retro 文档
- saas-web fixture 跑通完整 vision → mockup → approve → differ 链

---

## How To Verify（全链路）

```bash
# Gate 1 — 单测
cd daemon && npx vitest run
cd ui && npx vitest run

# Gate 2 — TypeScript clean
cd ui && npx tsc --noEmit
cd daemon && npx tsc --noEmit

# Gate 3 — smoke（Batch 5）
node scripts/smoke-mockup-phase.mjs

# Gate 4 — 真 cc 手 smoke（Batch 5，saas-web fixture）
# vision finalize → MOCKUP_DRAFTING → .d2p/mockup/ 落地 → UI approve → differ starts
```

---

## Probes (FEATURE-VALIDATION 1+2+3 — 全流程)

```
1. haiku probe: "given vision='SaaS notes app with auth' + projectType='saas-web', what mockup pages MUST exist?"
   → canonical JSON {pages: string[]}
2. sonnet subagent (fresh context): 同问 → JSON
3. real run: fake-claude 跑 mockup-implementer → 输出 pages 列表
```
`jq -S` 三方 byte-identical 才 ship。

---

## 不做什么（防漂移）

- ❌ 不引新 npm dep
- ❌ 不让 mockup-implementer 写真实业务逻辑（mockup 仅 HTML/CSS + 假数据）
- ❌ 不强制每个 demo 都跑 mockup phase（CLI / library / api-service 类 demo 用户可跳过）
- ❌ 不把 mockup 进 main branch commit（只存 `.d2p/mockup/`，gitignore）
- ❌ 不替 user 决定 approve / revise（user 没点头不走 differ）
- ❌ 不动产品定位文档主框架

---

## Out of scope（follow-up）

- UI-less project type 的 mockup degrade 形态（spec sketch / OpenAPI yaml stub 等）
- mockup 的多版本对比（v1 vs v2 visual diff）
- mockup 自动从 vision 推断 page 列表（先靠 prompt 让 cc 自己决定）
- mockup 跨 session 复用（同一 demo 再跑时复用上次 approved mockup）

---

## 与 Mode A 搬迁 plan 的关系

mockup-first phase 是 **vision finalize 之后、differ 之前** 插入；Mode A multi-turn 自治是 **implementer 阶段** 的 complex gap 走自治。两套互不冲突，可独立开发。
