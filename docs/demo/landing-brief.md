# ZeroU — Landing Page Design Brief

> 给 Claude Design 用。读完直接动手。
> 产品本质：**ZeroU 把本地 demo 自动跑成 product**——用户给一个本地文件夹 + 多轮 elicit 的 vision，ZeroU 派 Claude Code CLI subprocess 干活，4 层 reviewer pipeline 验，自动 commit / merge / 真 push GitHub 开 PR，直到 preset 32 项 + vision verdict YES 双绿才停。
> 视觉路线：**Cursor.com**（左/右分屏 hero + IDE-screenshot 循环动画 + 多段 surface 各自一段 demo），**不走** Lovable / v0 / bolt 的 chat-first 路线。

---

## 目标受众

**主受众**：独立开发者 / 小团队 founder，已经能写出 demo（hackathon prototype、内部工具、AI 副业项目）但卡在"从 demo 到能 ship 的 product"那段最痛的产品化工作（CI、CSRF、README、备份、a11y、empty/loading states、文档同步等几十项琐事）。年龄 25–40，看过 Cursor / Devin / Cognition demo，对 agentic coding 有判断力。**不是**全新概念尝鲜用户，要他们一眼分清 ZeroU 和 Cursor / Devin 的差异。

**次受众**：DevTools 投资人 / 技术决策者——会从 "1h 31min · $4.24 · 真 PR 链接" 这种硬数据判断产品成熟度。

**看完预期 action**：
1. 点 hero 主 CTA "**克隆 demo,跑一次**" → 跳 GitHub repo + 复制 `git clone` 命令
2. 滚到 case study section 后点 "**看真 PR**" → 跳 https://github.com/anzy-renlab-ai/agent-game-platform/pull/6
3. 滚到底点 "**看完整 docs**" → 跳 `docs/DEV-DOC.md`

**转化路径**：Hero → How it works → Case study → CTA。不要弹窗,不要留邮箱表单。

---

## 设计语言要点

**字体**：
- 主标 / display：`Tiempos Headline`（serif）—— 已是 d2p UI 默认 `font-serif`,保持
- 正文 / UI：`Styrene B`(若不可用 fallback `Inter` / `system-ui`)—— 已是 d2p UI 默认 `font-sans`
- Mono(commit SHA / 命令行 / 数据):`JetBrains Mono` 或 `ui-monospace`
- **不用** Google Fonts 流行套件(Plus Jakarta / DM Sans / Geist 等)——会立刻撞 SaaS 模板脸

**主色调**:走 **d2p UI 现有的 warm-paper 色板**(就是 Anthropic / Claude 启发的 cream + coral 系),不走 cursor.com 的冷黑底。具体 hex 全部锁定在下表,不要发挥:

| 角色 | Hex | 用途 |
|---|---|---|
| paper | `#F5F2EC` | 页面背景(暖米色) |
| cream | `#FAF9F5` | 卡片 / surface 背景 |
| ink | `#1F1F1E` | 主文字 |
| muted | `#5E5C57` | 次要文字 |
| warmline | `#E5E1D8` | 分隔线 / 边框 |
| **coral** | `#C96442` | **主 accent**(主 CTA / 强调数据 / "working" 高亮) |
| coralhover | `#B85636` | 主 CTA hover |
| coralsoft | `#F0D9CC` | tinted bg / chip |
| forest | `#587A4C` | 成功态(merged / passed) |
| rust | `#B23A48` | 错误态(NEED_HUMAN / failed) |
| sage-50 / sage-600 | `#EEF3EC` / `#5A7350` | reviewer 通过 chip |
| amber-50 / amber-600 | `#FAF1E4` / `#9B6A1F` | implementer agent 色 |
| plum-50 / plum-600 | `#F4EEF4` / `#7A4F7A` | done-check agent 色 |
| slate-50 / slate-600 | `#F1F4F7` / `#52647A` | differ agent 色 |

**禁用项**:
- 不要 emoji(包括 hero 文案 / button / chip)
- 不要 stock photo / Unsplash 图片
- 不要 founder 头像 / "creator" 卡片
- 不要 testimonial 模板(没真用户)
- 不要 dark mode toggle(MVP 不做)
- 不要"AI 在为你工作" loader 动画喧宾夺主
- 不要紫色渐变 / cyber neon / glassmorphism

**素材复用**:在 Section 3 / 4 用 **ZeroU UI 真组件 / 真截图**——具体引用见素材清单。组件视觉风格已定型,不要让设计师重画 SessionCard / CommitsTimeline。

---

## 页面结构(按滚动顺序逐 section 设计)

### Section 1 — Hero(上一屏,100vh)

**Layout**:Cursor 路线——左 ~46% 文案 + CTA,右 ~54% 「mini dashboard 循环动画」。Desktop 横向 split,mobile 上下堆叠(动画在文案下面)。

**文案**:
- 主标语(serif, ~64px desktop / ~40px mobile, ink 色):
  - 中:**「demo 跑成 product」**
  - EN:**"Ship the demo. Skip the product work."**
  - 6 字中文 / 7 词英文,够短
- 副标语(sans, ~18px, muted 色, 最多 2 行):
  - 中:**「给一个本地 demo 文件夹,ZeroU 自动补完 README、CI、CSRF、备份、空态、loading、a11y——并真 push GitHub 开 PR。」**
  - EN:**"Point ZeroU at a local demo folder. It writes the README, CI, CSRF, backups, empty states, loading states, a11y — then pushes a real PR."**
- 主 CTA(coral 实底, cream 文字, 圆角 12px, py-3 px-6, hover coralhover, lift-on-hover 1px):
  - 中:**「克隆 demo,跑一次」** / EN:**"Clone the demo. Run it."**
- 次 CTA(无底色,coral 文字,下划线,hover ink):
  - 中:**「看 1h31min 真跑案例 →」** / EN:**"See a 1h 31min real run →"**

**视觉/Layout 锚点**:
- **左**:logo 字标 `ZeroU`(serif italic,coral 色,~22px)在最顶,下方留 ~80px 再放主标
- **右**:一块「mini dashboard 动画卡片」——cream 卡片,圆角 16px,shadow-cardHover,ring-1 warmline,padding 24px,占据右半 ~70% 宽 + ~70vh 高
- **底部**:三个硬数据 chip 横排(paper bg,muted 文字,~13px font-mono):
  - `1h 31min` `$4.24` `2 merged · 24 NEED_HUMAN`
  - **数据具体到分秒和美元**,不要"快速" / "便宜"这种空话

**核心动画 — Hero 右侧 mini dashboard**(必须具体可执行,Lottie 或 React state machine 实现都行):

| 帧 | 时长 | 内容 |
|---|---|---|
| 0–1s | 1s | 6 张 agent 卡片淡入(从下 8px 上升 + opacity 0→1, stagger 80ms): differ(slate) / implementer(amber) / alignment(sage) / behavioral(sage) / done-check(plum) / repo-summary(slate)。布局与 `ui/src/components/SessionsBoard.tsx` 一致——每张 ~80px 高,左边一根 1.5px coral 竖线 + role 名 + status dot |
| 1–4s | 3s | `implementer` 卡 status dot 由灰转 coral,卡片背景由 cream 转 amber-50,ring 由 warmline 转 coral/20,加 anim-breathe(2.4s ease-in-out opacity 0.6→1 循环)。卡内文字逐字打字:`fix/readme-minimal-incomplete · attempt 3` |
| 4–6s | 2s | `behavioral` 卡也亮起,sage-50 bg,文字打字:`alignment score 8.2 · APPROVE` |
| 6–7s | 1s | 右下角滑入一个 commit chip(coralsoft bg,coral 文字,~14px),内容:`✓ 4b58841 merged → main`(无 emoji,用 sage-600 的 ✓ 字符,SVG check icon 也行) |
| 7–8s | 1s | commit chip 旁再滑入 PR chip(coral/10 bg, coral 文字):`PR #6 opened on GitHub` |
| 8–10s | 2s | 整组淡出 opacity 1→0.3 → reset → 重新进入帧 0 |

**总循环 10s**,prefers-reduced-motion 时只显示终态(commit + PR chip 已出现)不做循环。

**数据点**:三个硬数据 chip(`1h 31min` / `$4.24` / `2 merged · 24 NEED_HUMAN`)放在主 CTA 下方,**这是 hero 的第二个 hook**——一眼建立可信度。

**设计 reference**:cursor.com hero 的左文案 + 右 IDE 动画 split;但配色用 warm-paper 不用 cursor 的冷暗黑。

---

### Section 2 — How it works(4 步流程)

**Layout**:全宽 paper 背景, padding 上下 96px。中央 max-w-6xl,标题居中:
- 标题(serif ~36px):中:**「4 步,从 demo 到 PR」** / EN:**"4 steps. Demo to PR."**
- 副标(sans muted):中:**「不审 diff,不写 prompt。给路径,等绿。」** / EN:**"No diff review. No prompt engineering. Give a path. Wait for green."**

**4 个 step card 横排**(desktop)/ 竖排(mobile, max-w-md):
- 每张 cream bg, rounded-2xl, shadow-card, ring-1 warmline/60, p-6
- 卡顶 ~32px 步骤序号(font-serif italic, coral 色, "01" / "02" / "03" / "04")
- 标题(sans medium, ~18px, ink)
- 描述(sans, ~14px, muted, 2-3 行)
- 卡底一个 micro icon(SVG, 1.5px stroke, coral 色, 24×24)

**4 步内容**(中/英 双语,两套文案分别在文案库列出):

| # | 中标题 | 英标题 | 描述(中) | Icon |
|---|---|---|---|---|
| 01 | 给一个路径 | Drop a path | 任意本地文件夹,ZeroU 自动 `git init`、识别栈、跑 detector,5 秒出 gap 清单。 | folder-input |
| 02 | 多轮 elicit vision | Elicit your vision | 不写 prompt——haiku 提 5–7 个具体问题(目标用户、商业模式、核心场景、不做什么),你按按钮答完即可。 | message-circle |
| 03 | 派 6 个 agent 干活 | Six agents go to work | differ / implementer / alignment / behavioral / done-check / repo-summary 并行跑;4 层 reviewer pipeline 把关——static gate → alignment probe → behavioral → adversarial(高敏 gap 才上)。 | network |
| 04 | 自动 PR 上 GitHub | PR lands on GitHub | merged commit 直接进 main + 真 push 远端 + `gh pr create`。NEED_HUMAN 的 gap 写进 PR body,带 reason code(STATIC_GATE / CONFLICT / ALIGNMENT_LOW…),你只看 PR 不看 diff。 | git-pull-request |

**核心动画 — Step 03 卡片**:
- 默认态:6 个迷你 agent dot 排成 2 行 3 列,灰色
- Hover 时:依次点亮(coral)→ 第二行第二个(behavioral)亮 sage → 出现 1px coral 连线连到 step 04 卡的 GitHub icon
- 4s 循环

**响应式**:< 1024px 4 卡变 2×2 grid;< 640px 单列纵向。

---

### Section 3 — Three killer features

**Layout**:cream 背景,padding 上下 120px。每个 feature **一行**(desktop)/ **一列**(mobile):

> **奇数 feature 文字在左、视觉在右**;**偶数 feature 反过来**——避免视觉单调,这是 cursor.com 的常用节奏。

#### Feature 1:4-layer reviewer pipeline

- **文字侧**:
  - eyebrow(font-mono, ~11px, coral, uppercase tracking-widest):`REVIEWER · 4 LAYERS`
  - 标题(serif ~32px, ink):中:**「四层 reviewer 把关,不是一只 LLM 拍脑袋」** / EN:**"Four reviewers. Not one LLM guessing."**
  - 正文(sans ~16px, muted ~28px line-height, 3-4 句):中:**「Static gate 跑真 tsc / lint / test;alignment probe 用 minimax 跨引擎对齐打分;behavioral reviewer 跑 acceptance;adversarial 只在高敏 gap 上场。任何一层 fail 自动转 NEED_HUMAN,不烧用户的钱。」** / EN:**"Static gate runs real tsc / lint / test. Alignment probe is a cross-engine score from minimax. Behavioral runs acceptance. Adversarial only fires for high-risk gaps. Any fail → NEED_HUMAN, no cost burn."**
  - bullet list(3 项, sans 14px, 前置 1.5px coral horizontal bar):
    - `STATIC_GATE` · skips when tsc / bun test 工具不在
    - `ALIGNMENT_LOW` · cross-engine 同意才过
    - `ADVERSARIAL_BREAK` · 安全敏感 gap 二次破解
- **视觉侧**:一个 ~440×420 的 SVG 流程图(垂直),节点 5 个(commit → static → alignment → behavioral → adversarial),节点是 18×18 圆点(默认 warmline,激活时 coral 带 glow),节点间 1px warmline 直线。
- **核心动画**:节点从上到下依次激活 → 第 3 / 第 4 节点中间随机出现 "X NEED_HUMAN" 红点(rust 色, 2 秒后转 sage-600 PASS),循环演示 reviewer fail 不影响整体。**6s 循环**。

#### Feature 2:6-agent SessionsBoard

- **文字侧**:
  - eyebrow:`AGENTS · 6 ROLES`
  - 标题:中:**「6 个 agent 各司其职,实时看着干」** / EN:**"Six agents, six jobs, watched live."**
  - 正文:中:**「不是黑盒后台 worker。每个 agent 当前在哪个 gap、调了几次、上一轮做了什么——全部在 UI 上,点开 drawer 看 turn-by-turn timeline。」** / EN:**"Not a black-box worker. Each agent's current gap, call count, last turn — visible. Click in for the turn-by-turn timeline."**
  - 数据 chip(font-mono, paper bg):`61 fix attempts · 2 merged · 24 escalated`
- **视觉侧**:**直接复用 `ui/src/components/SessionsBoard.tsx` 真截图**(或在 design 系统里渲染同等 layout 的 React 静态版本)。6 张 SessionCard 竖排,各角色 tint 准确(differ=slate, implementer=amber, reviewer 系=sage, done-check=plum)。
- **核心动画**:每 5s 把列表里随机一张卡的 status 切到 `working`(变 amber/sage bg + ring coral/20 + anim-breathe 2.4s),其余卡保持 idle/done 态。动画用 ZeroU UI 已有的 `anim-breathe` keyframes,**5s 周期**。

#### Feature 3:自动 PR + NEED_HUMAN 透明清单

- **文字侧**:
  - eyebrow:`PR · TRANSPARENT TRIAGE`
  - 标题:中:**「PR body 自带 triage 清单——不是 'AI 做完了',是 'AI 做完了这些 + 卡在这些'」** / EN:**"PR body ships triage. Not 'AI is done' — 'AI did these, got stuck on those.'"**
  - 正文:中:**「每个 merged fix 一个 PR(也可设 session-end mode 打总 PR)。PR body 4 段:gap meta、reviewer 评分、NEED_HUMAN 列表(每行 slug · reasonCode · title,reason code 共 13 种)、cost footer。你 review 的是 PR 不是 diff。」** / EN:**"Each merged fix gets a PR (or one session-end PR). The body has gap meta, reviewer scores, the NEED_HUMAN list (each line: slug · reasonCode · title, 13 codes total), and a cost footer. You review the PR, not the diff."**
- **视觉侧**:模拟一张 GitHub PR 截图 mockup(白底 GitHub 风,**不是** cream)——标题栏 `d2p/auto-fix/readme-minimal-incomplete-1747652183 #6 · Merged`,左侧 reviewer chip(green Approved · sage),body 区域 4 段分块(syntax highlight 用 GitHub 真色)。**截图风格** 要明显是 GitHub 而不是 ZeroU 自己,**点明 PR 真的在 GitHub 上**。
- **底部 CTA chip**(coral/10 bg,coral 文字,可点):`→ View real PR #6 on GitHub`(链接 `https://github.com/anzy-renlab-ai/agent-game-platform/pull/6`)
- **核心动画**:scroll-triggered 一次性动画——element 进入视口时 PR body 4 段从上到下淡入(stagger 200ms),不循环。

---

### Section 4 — Case study(`agent-game-platform` 真案例)

**Layout**:paper bg, padding 上下 120px。中央 max-w-5xl,**类似 Devin.ai case study 区**——左侧标题 + 客户描述,右侧大数字 + 关键 commit 链。

- 顶部 eyebrow(font-mono coral uppercase):`CASE STUDY · 2026-05-19`
- 标题(serif ~40px):中:**「1h 31min,$4.24,2 个 commit merged 到 main」** / EN:**"1h 31min. $4.24. Two merges to main."**

**Hero 数字区**(横排 4 个大数字,desktop):
| 大数字(serif ~64px coral) | 标签(sans ~13px muted uppercase) |
|---|---|
| `1h 31min` | DURATION |
| `$4.24` | TOTAL COST |
| `2 / 28` | PRESET CLOSED |
| `24` | NEED_HUMAN |

底下 token usage 小字(font-mono muted ~12px):`454,674 in · 237,787 out`

**项目描述**(2 列,cream bg 卡片 max-w-5xl, rounded-2xl, shadow-card, ring warmline/60, p-8):
- 左列(项目 vision 摘录,serif italic ~16px ink):
  > 「竞技化的德州扑克观赏与社交平台 / 抽水 rake 模式 / DAU 30%+」
- 右列(meta 列表, sans, label muted + value ink, gap-3):
  - **Project**:`agent-game-platform`
  - **Stack**:Next.js + Bun
  - **Preset**:`saas-web` (28 items)
  - **Vision verdict**:rake / 社交 / 观赏 三主线

**关键 commit 链**(垂直 timeline,**复用 `ui/src/components/CommitsTimeline.tsx` 的视觉 vocab**——sage-600 圆点 + 1px warmline 竖线 + cream 卡):
- `5aedd6e` · attempt 1 一次过 · `fix/docs-changelog-missing` · 补 CHANGELOG.md → sage `merged` chip
- `4b58841` · attempt 3 · `fix/readme-minimal-incomplete` · 扩 README → sage `merged` chip + coral `PR #6` chip
- 下方两个 commit hash 也放上做"还在跑"的视觉密度(灰):`3d2ad5f` · `53df272`

**NEED_HUMAN 列表卡**(cream bg, rounded-xl, shadow-card, ring warmline/60, p-6):
- 标题(sans medium ink):中:**「24 项卡在人类决策上,ZeroU 不假装搞定」** / EN:**"24 items need a human. ZeroU doesn't pretend otherwise."**
- 列表(font-mono ~13px muted,grid-cols-2 gap-x-6 gap-y-1.5,8 条选样):
  - `auth-csrf-protection · ALIGNMENT_LOW`
  - `auth-password-recovery · BUGGY`
  - `db-backup-path · INCOMPLETE`
  - `ci-pipeline-missing · STATIC_GATE`
  - `ui-empty-states · ALIGNMENT_LOW`
  - `ui-loading-states · BUGGY`
  - `a11y-basic-issues · INCOMPLETE`
  - `deploy-env-doc-missing · ALIGNMENT_LOW`
- 列表底部:中:**「+ 16 项 → 看完整 PR body」** / EN:**"+ 16 more → see full PR body"** + 链接到真 PR

**核心动画**:大数字区——数字 count-up 动画(scroll-triggered 进入视口时,`0` → 最终值,用 easeOutQuart 1.2s。`$4.24` 从 `$0.00` count up,`1h 31min` 从 `0 min` count up)。**一次性,不循环。**

**CTA**(底部居中):
- 主:中:**「看完整 session summary →」** / EN:**"See the full session summary →"** (链接 `D:/lll/managed-projects/agent-game-platform/.d2p/session-summary.md` 在 repo 里的 GitHub 路径)
- 次:中:**「真 PR #6 →」** / EN:**"Real PR #6 →"** (链接 `https://github.com/anzy-renlab-ai/agent-game-platform/pull/6`)

---

### Section 5 — Tech credibility

**Layout**:cream bg, padding 上下 96px。max-w-5xl 居中。

- 标题(serif ~28px ink,居中):中:**「跑在你已经信任的东西上」** / EN:**"Built on tools you already trust."**
- 副标(sans muted, max-w-2xl):中:**「ZeroU 不持任何 API key,不跑自己的模型。全部走 `claude` CLI 子进程,git 走系统 git,PR 走 gh CLI。换 API、换 key、换 model 你自己定。」** / EN:**"ZeroU holds no API keys and runs no models. Everything goes through the `claude` CLI subprocess, system `git`, and `gh` CLI. Bring your own keys, models, and limits."**

**Logo wall**(单行,desktop;两行,mobile。所有 logo 单色 muted,hover 转 ink,~32px 高):
- `Anthropic` Claude / Claude Code logo
- `git` logo
- `GitHub` logo + `gh` CLI
- `Node.js 24` (灰色文字 + JS icon)
- `TypeScript` icon
- `SQLite` (better-sqlite3)
- `vitest` icon

logo 之间 80px gap,垂直居中。**禁** logo 加阴影 / 圆框 / 卡片包装——平铺,muted 单色,sober。

底部 3 个 mini-claim chip(横排,paper bg, muted 文字, font-mono ~12px, py-2 px-4 rounded-full):
- `no api key stored`
- `your git, your remote, your gh`
- `model switch any time`

---

### Section 6 — CTA / 收尾

**Layout**:paper bg, padding 上下 140px。max-w-3xl 居中。

- 大标题(serif ~52px ink, leading-tight, 居中):中:**「现在,给 ZeroU 一个 demo」** / EN:**"Now, give ZeroU a demo."**
- 副标(sans ~17px muted, max-w-xl, 居中):中:**「不到一杯咖啡的钱,换一个 PR-ready 的 product。」** / EN:**"Less than a coffee. A PR-ready product."**

**CTA 区**(双按钮居中, gap 12px):
- 主 CTA(coral 实底, cream 文字, ~56px 高, px-8 圆角 14px, shadow-glow):中:**「克隆 demo,跑一次」** / EN:**"Clone the demo. Run it."**
  - 点击后弹一个 inline command box(paper bg, font-mono):`git clone https://github.com/<org>/zerou && cd zerou && d2p start ./your-demo` + 右侧 copy 按钮
- 次 CTA(空心,coral 边框,coral 文字,hover bg coralsoft):中:**「看 1h31min 真跑案例」** / EN:**"See the 1h 31min real run"**

**Footer**(全宽,cream bg,padding 上下 56px,border-top warmline):
- 4 列(desktop) / 单列(mobile):
  - **Product**:Features / How it works / Pricing(留空, "open-source-only for now") / Roadmap
  - **Docs**:DEV-DOC / CLAUDE.md / API reference / Preset catalog
  - **Repo**:GitHub repo / Real PR #6 / Session summary / Issues
  - **About**:Manifesto / 中文 ⇄ EN locale toggle / Contact
- 底部一行(font-mono ~12px muted):`ZeroU · MIT · built with claude code · 2026`

---

## 文案库(全 user-facing,中英双语,以 section 锚定)

### Hero
| key | 中 | EN |
|---|---|---|
| hero.title | demo 跑成 product | Ship the demo. Skip the product work. |
| hero.subtitle | 给一个本地 demo 文件夹,ZeroU 自动补完 README、CI、CSRF、备份、空态、loading、a11y——并真 push GitHub 开 PR。 | Point ZeroU at a local demo folder. It writes the README, CI, CSRF, backups, empty states, loading states, a11y — then pushes a real PR. |
| hero.cta.primary | 克隆 demo,跑一次 | Clone the demo. Run it. |
| hero.cta.secondary | 看 1h31min 真跑案例 → | See a 1h 31min real run → |
| hero.chip.duration | 1h 31min | 1h 31min |
| hero.chip.cost | $4.24 | $4.24 |
| hero.chip.merged | 2 merged · 24 NEED_HUMAN | 2 merged · 24 NEED_HUMAN |

### How it works
| key | 中 | EN |
|---|---|---|
| how.title | 4 步,从 demo 到 PR | 4 steps. Demo to PR. |
| how.subtitle | 不审 diff,不写 prompt。给路径,等绿。 | No diff review. No prompt engineering. Give a path. Wait for green. |
| how.step1.title | 给一个路径 | Drop a path |
| how.step1.desc | 任意本地文件夹,ZeroU 自动 `git init`、识别栈、跑 detector,5 秒出 gap 清单。 | Any local folder. ZeroU runs `git init`, detects the stack, runs the detector, and lists gaps in 5 seconds. |
| how.step2.title | 多轮 elicit vision | Elicit your vision |
| how.step2.desc | 不写 prompt——haiku 提 5–7 个具体问题(目标用户、商业模式、核心场景、不做什么),你按按钮答完即可。 | No prompt writing — haiku asks 5–7 specific questions (target user, business model, core scenarios, what NOT to build). You click answers. |
| how.step3.title | 派 6 个 agent 干活 | Six agents go to work |
| how.step3.desc | differ / implementer / alignment / behavioral / done-check / repo-summary 并行跑;4 层 reviewer pipeline 把关——static gate → alignment probe → behavioral → adversarial(高敏 gap 才上)。 | differ / implementer / alignment / behavioral / done-check / repo-summary run in parallel. Four reviewer layers gate the result — static → alignment → behavioral → adversarial (high-risk gaps only). |
| how.step4.title | 自动 PR 上 GitHub | PR lands on GitHub |
| how.step4.desc | merged commit 直接进 main + 真 push 远端 + `gh pr create`。NEED_HUMAN 的 gap 写进 PR body,带 reason code。你 review 的是 PR 不是 diff。 | Merged commits land on main, push to your remote, and `gh pr create` runs. NEED_HUMAN items go into the PR body with reason codes. You review the PR, not the diff. |

### Features
| key | 中 | EN |
|---|---|---|
| feat1.eyebrow | REVIEWER · 4 LAYERS | REVIEWER · 4 LAYERS |
| feat1.title | 四层 reviewer 把关,不是一只 LLM 拍脑袋 | Four reviewers. Not one LLM guessing. |
| feat1.body | Static gate 跑真 tsc / lint / test;alignment probe 用 minimax 跨引擎对齐打分;behavioral reviewer 跑 acceptance;adversarial 只在高敏 gap 上场。任何一层 fail 自动转 NEED_HUMAN,不烧用户的钱。 | Static gate runs real tsc / lint / test. Alignment probe is a cross-engine score from minimax. Behavioral runs acceptance. Adversarial only fires for high-risk gaps. Any fail → NEED_HUMAN, no cost burn. |
| feat2.eyebrow | AGENTS · 6 ROLES | AGENTS · 6 ROLES |
| feat2.title | 6 个 agent 各司其职,实时看着干 | Six agents, six jobs, watched live. |
| feat2.body | 不是黑盒后台 worker。每个 agent 当前在哪个 gap、调了几次、上一轮做了什么——全部在 UI 上,点开 drawer 看 turn-by-turn timeline。 | Not a black-box worker. Each agent's current gap, call count, last turn — visible. Click in for the turn-by-turn timeline. |
| feat3.eyebrow | PR · TRANSPARENT TRIAGE | PR · TRANSPARENT TRIAGE |
| feat3.title | PR body 自带 triage 清单 | PR body ships triage |
| feat3.body | 每个 merged fix 一个 PR。PR body 4 段:gap meta、reviewer 评分、NEED_HUMAN 列表、cost footer。你 review 的是 PR 不是 diff。 | Each merged fix gets a PR. The body has gap meta, reviewer scores, the NEED_HUMAN list, and a cost footer. You review the PR, not the diff. |

### Case study
| key | 中 | EN |
|---|---|---|
| case.eyebrow | CASE STUDY · 2026-05-19 | CASE STUDY · 2026-05-19 |
| case.title | 1h 31min,$4.24,2 个 commit merged 到 main | 1h 31min. $4.24. Two merges to main. |
| case.vision | 竞技化的德州扑克观赏与社交平台 / 抽水 rake 模式 / DAU 30%+ | (留中文,vision 是真用户原文) |
| case.needhuman.title | 24 项卡在人类决策上,ZeroU 不假装搞定 | 24 items need a human. ZeroU doesn't pretend otherwise. |
| case.cta.primary | 看完整 session summary → | See the full session summary → |
| case.cta.secondary | 真 PR #6 → | Real PR #6 → |

### Tech credibility
| key | 中 | EN |
|---|---|---|
| tech.title | 跑在你已经信任的东西上 | Built on tools you already trust. |
| tech.subtitle | ZeroU 不持任何 API key,不跑自己的模型。全部走 `claude` CLI 子进程,git 走系统 git,PR 走 gh CLI。 | ZeroU holds no API keys and runs no models. Everything goes through the `claude` CLI subprocess, system `git`, and `gh` CLI. |
| tech.chip.nokey | no api key stored | no api key stored |
| tech.chip.yourgit | your git, your remote, your gh | your git, your remote, your gh |
| tech.chip.modelswitch | model switch any time | model switch any time |

### CTA
| key | 中 | EN |
|---|---|---|
| cta.title | 现在,给 ZeroU 一个 demo | Now, give ZeroU a demo. |
| cta.subtitle | 不到一杯咖啡的钱,换一个 PR-ready 的 product。 | Less than a coffee. A PR-ready product. |
| cta.primary | 克隆 demo,跑一次 | Clone the demo. Run it. |
| cta.secondary | 看 1h31min 真跑案例 | See the 1h 31min real run |

### Footer
| key | 中 | EN |
|---|---|---|
| footer.product | 产品 | Product |
| footer.docs | 文档 | Docs |
| footer.repo | 仓库 | Repo |
| footer.about | 关于 | About |
| footer.tagline | ZeroU · MIT · built with claude code · 2026 | ZeroU · MIT · built with claude code · 2026 |

---

## 关键素材清单

| 资产 | 类型 | 来源 / 路径 | 用在哪 |
|---|---|---|---|
| SessionsBoard 真组件视觉 | React 组件 / 截图 | `D:/lll/d2p/ui/src/components/SessionsBoard.tsx` | Section 3 Feature 2 视觉侧 |
| CommitsTimeline 真组件视觉 | React 组件 / 截图 | `D:/lll/d2p/ui/src/components/CommitsTimeline.tsx` | Section 4 case study commit 链 |
| MockupPhasePanel 真组件 | React 组件 / 截图 | `D:/lll/d2p/ui/src/components/MockupPhasePanel.tsx` | (可选)Section 2 step 02 视觉补充 |
| Hero mini-dashboard 动画 | Lottie 或 React state machine | 新建 — 复用 `SessionsBoard.tsx` 的卡片 layout | Section 1 hero 右侧 |
| Reviewer pipeline 流程图 | SVG | 新建 — 5 节点垂直 | Section 3 Feature 1 视觉侧 |
| GitHub PR 截图 mockup | PNG 或 React 静态版 | mock 截图,数据用 `PR #6` + `4b58841` 真值 | Section 3 Feature 3 视觉侧 |
| 真 PR 链接 | URL | `https://github.com/anzy-renlab-ai/agent-game-platform/pull/6` | Section 3, 4, hero secondary CTA |
| 真 commit SHA 4 个 | 字符串 | `5aedd6e` `4b58841` `3d2ad5f` `53df272` | Section 4 commit 链 |
| 真 NEED_HUMAN 24 项 | 字符串列表 | `D:/lll/managed-projects/agent-game-platform/.d2p/session-summary.md` § Need Human Attention | Section 4 NEED_HUMAN 卡 |
| 真 vision 摘录 | 字符串 | 同上 § Vision | Section 4 项目描述左列 |
| 真 cost / token | 字符串 | `$4.24` / `454,674 in / 237,787 out` | Hero chip + Section 4 大数字 + meta |
| 真 duration | 字符串 | `1h 31min` | 同上 |
| Anthropic / Claude logo | SVG | 官方 brand asset | Section 5 logo wall |
| git / GitHub / Node.js / TypeScript / SQLite / vitest logo | SVG | 官方 brand asset | Section 5 logo wall |
| Step icon set | SVG | Lucide / Phosphor 单色 1.5px stroke 同款 | Section 2 step card 底部 |

**禁用素材**:Unsplash / Pexels / stock photo / 任何 founder 照片 / 任何 emoji / Apple SF Symbols(license 不允许 web)/ 紫色渐变背景。

---

## 响应式断点要求

| 断点 | 宽度 | 主要变化 |
|---|---|---|
| Mobile | < 640px | Hero split → 上下堆叠(文案在上,mini-dashboard 缩到 320×320);how 4 卡 → 单列;feature 3 行 → 单列(文字在上,视觉在下);case 大数字 → 2×2 grid;footer 4 列 → 单列折叠 |
| Tablet | 640–1024px | Hero split 保持但右侧 mini-dashboard 缩到 50%;how 4 卡 → 2×2 grid;feature 保持交替 layout;case 大数字 → 2×2 |
| Desktop | ≥ 1024px | 完整 layout |
| Wide | ≥ 1440px | max-w 锁定:hero max-w-7xl,其余 section max-w-5xl/6xl,**禁止内容拉满全宽** |

**hero 在 mobile**:CTA 必须在 above-the-fold(< 100vh 内),mini-dashboard 可缩到次屏。

---

## 性能 / a11y 硬要求

**性能**:
- **FCP** ≤ 1.0s(4G)
- **LCP** ≤ 1.5s
- **TTI** ≤ 2.5s
- 首屏图片仅 hero mini-dashboard 一张(Lottie JSON ≤ 60KB,或 SVG inline ≤ 20KB)
- 首屏 JS ≤ 150KB gzipped
- 字体 subset 中文 + EN basic latin,woff2,total ≤ 80KB
- 所有非首屏图片 `loading="lazy"`
- count-up 动画 ≤ 3 个同时跑,prefers-reduced-motion 时跳过

**a11y**:
- WCAG 2.1 AA 对比度全过——`coral #C96442` on `cream #FAF9F5` 是 4.61:1(过 AA),但 `coral on paper #F5F2EC` 是 4.27:1(过 AA),`muted #5E5C57 on paper` 是 7.06:1(过 AAA)。所有 CTA / chip 都按表内 hex 用,不要发挥导致掉对比度
- 所有交互元素 ≥ 44×44 命中区
- focus ring 必须可见(coral 2px outline + offset 2px)
- 所有动画 `prefers-reduced-motion: reduce` 时降级为静态终态
- 中英语言切换 toggle 放 footer + nav 右上,`lang` attribute 同步切换 `zh` / `en`
- 所有 chip / button / link 有 `aria-label`(中文 lang 时给中文 label,英文 lang 时给英文 label)
- 表格(费用表 / commit 链 / NEED_HUMAN 列表)用 `<table>` 或正确 `role="list"`,不用 div soup

---

## 一句话总结给 Claude Design

> warm-paper 配色 + Cursor 风左文右动画 hero,用 1h31min/$4.24/PR#6 真数据 + 真 SessionsBoard / CommitsTimeline 组件视觉建立可信度——4 步流程 + 3 杀手 feature + 1 真案例 + 信任 logo wall + 收尾 CTA,6 个 section,禁 emoji / stock / 紫色渐变。
