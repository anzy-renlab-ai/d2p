# d2p 新 phase：mockup-first — 先 HTML 原型对齐预期再 differ/implementer

> d2p 给用户做事的工作流新增一个 leading phase：用户给完 demo + vision 后，**d2p 先用 HTML/CSS 把"成品长啥样"做出来**，给用户审；用户对齐预期后，differ 拿着 vision + approved mockup 一起找 gap，再走 implementer / reviewer / merge。

**Scope source**：用户 2026-05-18：
> "d2p 产品的使用过程，也可以参考这个 — 能通过 html 先实现用户预期效果的就先实现一下，之后再进行找、修改、验证"

**这个 plan 本身也走 mockup-first**：Batch 1 是把"mockup phase 在 d2p UI 上长啥样"做成静态原型，你浏览器点完拍板，再开发真实 mockup-implementer agent。

---

## Acceptance checklist（开工前自检）

1. **目标**：vision finalize 后、differ 启动前，自动跑 mockup-implementer，输出静态 HTML/CSS 落到 `<demo>/.d2p/mockup/`；UI 展示给用户审；用户「approve / 修订建议 / 跳过」三选一；approved mockup 作为 differ 的额外输入
2. **不变量**：差不动现有 vision elicit / differ / implementer / reviewer 主流程；不破 71 单测；不引新 npm dep；CLAUDE.md / README 产品定位文档不动
3. **验证命令**：`npm test` 全绿 + `node scripts/smoke-mockup-phase.mjs`（新增）+ 真 cc 手 smoke 一个 saas-web fixture
4. **不做**：① UI-less demos（cli-tool / library / api-service）暂不强制 mockup phase（degrade 成 "spec sketch" 是 follow-up） ② mockup 不带真实数据 fetch（纯静态展示）③ mockup 不进 git commit 主分支（只存 `.d2p/mockup/`） ④ 不动 Mode A multi-turn 那一套（独立 plan）
5. **完成标准**：saas-web 类 fixture 跑通；UI 上能看到 mockup → 用户能 approve / 提建议 → differ 看到 mockup 输入；测试可由他人 clone + `npm test` 复跑

---

## Plan — 具体改什么

### Batch 1（mockup of the mockup phase）— 静态原型，先给你点头

把"mockup phase 在 d2p UI 上的样子"用 React + mock data 做出来，preview 路径访问：
- `?preview=mockup-phase/drafting` — mockup-implementer 正在跑
- `?preview=mockup-phase/review` — mockup 跑完，用户在审
- `?preview=mockup-phase/approved` — 用户点头，进 differ
- `?preview=mockup-phase/revising` — 用户提了建议，mockup-implementer 再跑一轮

UI 内容：
- 一个新 Phase Pill（在现有 Workspace 顶栏 status 后），可能值：`vision → mockup → differ → loop → done`
- mockup 区：iframe 嵌入 `<demo>/.d2p/mockup/index.html`（mock 数据时直接渲染一段假 HTML）+ 缩略导航（landing / dashboard / settings 等多页 mockup）
- 用户操作面板：**approve** / **提建议**（text input） / **跳过**（直接进 differ）
- 给 differ 的"输入预览"卡片：vision.md + approved mockup pages 列表

**Batch 1 acceptance**：你浏览器打开 `?preview=mockup-phase/...` 看每个 state 的样子 → 点头 / 改建议 / 拒。

### Batch 2 — daemon 侧 mockup-implementer agent role

- 新 prompts/role：`mockup-implementer`（输入：vision.md + project type + 现有 README → 输出：多个 HTML 文件 + CSS + 假数据）
- 新 orchestrator phase：vision finalize 后插入 `MOCKUP_DRAFTING` 状态
- 新 SSE event kinds：`MOCKUP_DRAFTING` / `MOCKUP_PAGE_WRITTEN` / `MOCKUP_PROPOSED` / `MOCKUP_APPROVED` / `MOCKUP_REVISION_REQUESTED`
- 新 SQLite 表 `mockups`：(session_id, version, paths_json, status, user_feedback, created_at)
- HTTP routes：`GET /api/sessions/:id/mockup` / `POST /api/sessions/:id/mockup/approve` / `POST /api/sessions/:id/mockup/revise`

### Batch 3 — differ 吃 mockup 输入

- differ prompt 加 approved mockup 上下文（用 HTML → 简短意图描述，避免 token 爆）
- gap 来源新加 `'mockup'`（已有 `'preset' | 'vision' | 'both'` → 扩展为 `'preset' | 'vision' | 'mockup' | 'both' | 'all'`）
- 测试：差分 saas-web fixture 前后 gap 列表差异

### Batch 4 — Wire-in + UI 真后端

- preview 路径切到真 SSE
- Workspace 新增 mockup phase 操作面板（替换 mock）
- jsdom + Playwright e2e

### Batch 5 — smoke + cross-engine probe

- `scripts/smoke-mockup-phase.mjs` — fake-claude 输出固定 HTML，断言 mockup 落地 + UI approve flow
- 真 cc 手 smoke：一个最小 saas-web fixture 跑完整 vision → mockup → approve → differ 链
- FEATURE-VALIDATION 1+2+3：mockup-implementer prompt 跨引擎一致性

---

## Expected Outputs

完成后：
- 6+ 新源文件（agent prompt / orchestrator phase / route / store / UI 组件 / mock data）
- 1 个新 migration（`<next>-mockups.ts`）
- `<demo>/.d2p/mockup/` 目录约定（多 html + 一份 manifest.json）
- 1 个新 PR + ≥5 conventional commits
- saas-web fixture demo 跑过完整流程

---

## How To Verify

### Gate 1 — preview 视觉验收（Batch 1）
你浏览器 4 个 state 都看一遍 → "好" / "改 X"

### Gate 2 — 单测 / smoke（Batch 2-5）
```bash
cd D:/lll/d2p/daemon && npm test
cd D:/lll/d2p/ui && npm test
node scripts/smoke-mockup-phase.mjs
```

### Gate 3 — 真 cc 手 smoke（Batch 5）
跑 fixture saas-web demo，验证：
- vision finalize 后自动进 MOCKUP_DRAFTING
- 5 分钟内 `.d2p/mockup/index.html` 落地
- UI 上 mockup 区可见
- 点 approve → differ 启动 + gap 列表里能看到从 mockup 来的 gap

### Gate 4 — 跨引擎 probe（Batch 5）
mockup-implementer prompt 在 claude-cli / openai-compat / anthropic-api 三 engine 下输出"项目类型 saas-web + vision X"时，给出的 HTML 页面集是否一致（schema 层一致：包含 landing / dashboard / settings 三页）。

---

## Probes (FEATURE-VALIDATION 1+2+3)

```
1. haiku probe: "given vision='SaaS notes app with auth' + projectType='saas-web', what mockup pages MUST exist?" → canonical JSON {pages: string[]}
2. sonnet subagent (fresh context): 同问 → JSON
3. real run: fake-claude 跑 mockup-implementer → 输出 pages 列表
```
`jq -S` 三方 byte-identical 才 ship。

---

## 不做什么（防漂移）

- ❌ 不引新 npm dep（HTML 生成走 cc / openai-compat 即可，不要拉 puppeteer / playwright 渲染器）
- ❌ 不让 mockup-implementer 写真实业务逻辑（mockup 仅 HTML/CSS + 假数据）
- ❌ 不强制每个 demo 都跑 mockup phase（CLI / library / api-service 类 demo 用户可跳过 / 后续 degrade 成 spec sketch）
- ❌ 不把 mockup 进 main branch commit（只存 `.d2p/mockup/`，gitignore）
- ❌ 不替 user 决定 approve / revise（user 没点头不走 differ）
- ❌ 不动产品定位文档主框架（mockup phase 是"工作流补充"，不是"产品转向"）

---

## Out of scope（follow-up）

- UI-less project type 的 mockup degrade 形态（spec sketch / OpenAPI yaml stub 等）
- mockup 的多版本对比（v1 vs v2 visual diff）
- mockup 自动从 vision 推断 page 列表（先靠 prompt 让 cc 自己决定）
- mockup 跨 session 复用（同一 demo 再跑时复用上次 approved mockup）

---

## 与 Mode A 搬迁 plan 的关系

mockup-first phase 是 **vision finalize 之后、differ 之前** 插入；Mode A multi-turn 自治是 **implementer 阶段** 的 complex gap 走自治。两套互不冲突，可独立开发。建议执行顺序：

1. 完成 Mode A 搬迁（plan `2026-05-18-mode-a-import.md` Batch 1-6）
2. 开 mockup-first（本 plan Batch 1-5）

或者并行——Batch 1（两个 plan 各自的 mockup batch）是纯前端 mock，写集不重叠。
