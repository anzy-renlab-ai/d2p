# ZeroU — 2min Demo Video Script

> 总长 115s · 镜头 10 个 · wow moments 用了 M1 / M2 / M3 / M4 / M5（全部 5 个）
> Fixture 源：`D:/lll/managed-projects/agent-game-platform/.d2p/session-summary.md`
> 真 PR：https://github.com/anzy-renlab-ai/agent-game-platform/pull/6

---

## 一、视频目标

让观众在 2 分钟内确信一件事：把一个本地 demo 文件夹丢给 ZeroU，开一夜，第二天醒来收到的是一个真 PR、真 commit、真上线候选——而不是一份"建议清单"。看完应当想做两个动作：**进 ZeroU.dev**、**把自己抽屉里的半成品 demo 拖进来试一次**。

## 二、整体结构（节奏曲线图）

| 段 | 时间 | 占比 | 内容关键词 |
|---|---|---|---|
| 0. Hook | 0:00 – 0:08 | 7% | 一个 demo 文件夹被拖入；"睡前 → 醒来" 切镜 |
| 1. 问题陈述 | 0:08 – 0:18 | 9% | demo 永远停在 demo；4 件事永远没人做 |
| 2. Vision elicit | 0:18 – 0:35 | 15% | A/B/C 选项 → vision.md 打字机浮现（M4） |
| 3. Gap 推断 | 0:35 – 0:48 | 11% | detector + preset 32 项点亮，gap 列表落下 |
| 4. Agent 集群启动 | 0:48 – 1:00 | 10% | SessionsBoard 6 卡片依次亮起（M1） |
| 5. Reviewer 4 层 | 1:00 – 1:18 | 16% | Adversarial 红光 → rollback → 第二轮绿（M2） |
| 6. Preset 收敛 | 1:18 – 1:33 | 13% | 32 项进度条灰转绿延时摄影（M3） |
| 7. PR 落地 | 1:33 – 1:48 | 13% | PR chip 弹出 → 跳 GitHub PR #6 + NEED_HUMAN 列（M5） |
| 8. CTA | 1:48 – 1:55 | 6% | logo + 一行文案 + URL |

## 三、逐镜头分镜表

### 镜头 1 [0:00 – 0:08] — Hook：拖入 demo

- **画面**：黑底，光标拖一个文件夹图标 `agent-game-platform/` 从桌面飞入屏幕中央 ZeroU app 窗口；窗口里出现 ProjectsHome 卡片，标题"Pick a demo to grow"。右下角时钟从 23:47 跳到 06:12，背景由深蓝渐变到晨色。
- **旁白（中文）**："你扔进去一个 demo。一觉醒来，它是个产品。"
- **旁白（英文）**："Drop in a demo. Wake up to a product."
- **字幕**：（无）
- **真/Mock**：HYBRID — ProjectsHome 用真组件 `ui/src/components/ProjectsHome.tsx` 截图 + AE 做拖入动画 + 时钟跳。
- **录制方式**：playwright 启动 `npm run dev` 截 ProjectsHome；AE 合成拖入轨迹 + 日夜渐变。
- **配乐密度**：low（单 pad 音 + 一记低 sub bass 在 0:06 拖入命中）

### 镜头 2 [0:08 – 0:18] — 问题陈述

- **画面**：4 个 to-do 卡片以 isometric 角度漂浮："CHANGELOG"、"README"、"CI pipeline"、"CSRF check"。每个卡片都盖一枚红色"NOT DONE"印章。卡片缓慢自旋，背景是堆满 `demo-*/` 命名的文件夹墙。
- **旁白（中文）**："demo 永远停在 demo。十件该做的事，没一个人做。"
- **旁白（英文）**："Demos stay demos. The boring ten percent never ships."
- **字幕**："NOT SHIPPED" 在每张卡片右上角小字常驻
- **真/Mock**：MOCK — 用 fixture 里 24 个 NEED_HUMAN 项中选 4 个真名字做卡片。
- **录制方式**：Figma 出卡片 → AE 漂浮 + 红章盖印。
- **配乐密度**：low → 0:16 一记钢琴单音上扬，准备进 elicit。

### 镜头 3 [0:18 – 0:35] — Vision elicit（M4）

- **画面**：屏幕左半 MultiTurnPanel，AI 问"你的商业模式倾向？"，下方三个选项卡 A/B/C：A 抽水 rake、B 订阅、C 广告。光标选中 A，A 卡片亮起。右半屏 `vision.md` 文件以打字机式逐字浮现："采用**抽水(rake)模式**，从每个牌局中收取一定比例的服务费用。" 三轮 A/B/C 快速叠化，vision.md 长度逐次增加到完整 5 节（产品定位 / 目标用户 / 核心场景 / 商业模式 / KPI）。
- **旁白（中文）**："不写 PRD。你只回答 A 还是 B。"
- **旁白（英文）**："No PRD. Just A, B, or C."
- **字幕**：右上角小标 `vision.md · auto-generated`
- **真/Mock**：REAL — vision 文本直接来自 `D:/lll/managed-projects/agent-game-platform/.d2p/vision.md`；MultiTurnPanel 用真组件 `ui/src/components/MultiTurnPanel.tsx`。
- **录制方式**：playwright 驱动 MultiTurnPanel 截连续 3 轮 A/B/C；vision.md 打字机用 AE 字符序列动画。
- **配乐密度**：mid — 节拍器式打字 click 与配乐同步。

### 镜头 4 [0:35 – 0:48] — detector + preset 32 项点亮

- **画面**：中心一个 6 边形 detector 图标自旋一圈后弹出标签 "saas-web · confidence 0.91"，下方 PresetChecklistView 32 个圆点像棋盘一样从左上往右下扫描点亮（全部先变亮蓝，不分绿灰）。点亮完后右侧落下 GapList 26 条 gap 名称（CHANGELOG / README / CSRF / migrations / empty-states ...），P1/P2/P3 标签彩色。
- **旁白（中文）**："它先认出这是个 SaaS。然后照单子挑出 26 件没做的事。"
- **旁白（英文）**："Auto-detected: SaaS web. Twenty-six gaps to close."
- **字幕**："preset: saas-web · 32 checks · 26 gaps"
- **真/Mock**：HYBRID — PresetChecklistView + GapList 用真组件渲染 fixture 数据；6 边 detector + 扫描动效 AE 合成。
- **录制方式**：playwright 渲染真组件截高分图 → AE 加扫描线 + 弹出标签。
- **配乐密度**：mid — 32 个 tick 与点亮节奏 1:1 对齐。

### 镜头 5 [0:48 – 1:00] — SessionsBoard 6 角色依次亮起（M1）

- **画面**：SessionsBoard 全屏，6 张 agent 卡片 2x3 矩阵：**detector / elicitor / differ / implementer / reviewer / merger**。每张卡 0.4s 间隔依次从 idle 灰转 working 蓝，spinner 转动，下方滚动出实时 log 一行（"detector: classified saas-web (0.91)"、"differ: 26 gaps queued"、"implementer: branch fix/docs-changelog-missing"...）。右下角 cost ticker 从 $0.00 缓慢爬到 $1.12。
- **旁白（中文）**："六个 agent 各管一段。看牌的是你，洗牌的是它们。"
- **旁白（英文）**："Six agents, one assembly line. You watch. They build."
- **字幕**：每张卡顶角小字 agent 名 + status
- **真/Mock**：REAL — SessionsBoard 用真组件 `ui/src/components/SessionsBoard.tsx`，事件流走 fixture replay。
- **录制方式**：playwright 跑 `npm run dev` + 注入 fixture event stream → 真屏录。
- **配乐密度**：mid → 每张卡亮起一记 mid-tom，第 6 张落定时鼓点 fill。

### 镜头 6 [1:00 – 1:18] — Reviewer 4 层 + Adversarial 红光（M2）

- **画面**：左侧一列 4 个 reviewer gate 竖向排列：**Static gate / Alignment probe / Behavioral / Adversarial**。前 3 个依次绿勾。第 4 个 Adversarial 闪烁后整张卡变红光，弹出小气泡："attack vector: CSRF token reuse on /login"。右侧 CommitDiffDrawer 出现 commit `4b58841` 高亮，瞬间一道红色 rollback 箭头从 commit 划回 worktree。镜头切到第二轮——同一 commit 重新 implementer 重写、4 个 gate 重新走一遍，这次全绿。底部小字 "attempt 3/61"。
- **旁白（中文）**："过不了就退回去。它对自己比你严。"
- **旁白（英文)**："Failed audit? Roll back. Try again. Sixty-one times if it takes."
- **字幕**："Adversarial gate · rejected" → "attempt 3 · all green"
- **真/Mock**：HYBRID — 4 gate 卡片 + CommitDiffDrawer 用真组件；红光闪烁 + rollback 箭头 AE 合成。Commit sha `4b58841` (README) 取真 fixture。
- **录制方式**：截 `CommitDiffDrawer.tsx` 渲染 commit `4b58841` diff → AE 加红光 pulse + rollback 箭头 + 第二轮叠化。
- **配乐密度**：high — 红光那一帧低频 sting；rollback 拉一记反向 swoosh；第二轮绿勾时回到主旋律。

### 镜头 7 [1:18 – 1:33] — Preset 32 项进度条灰转绿（M3）

- **画面**：PresetProgress 大视图，32 格状态从左到右延时摄影式翻绿。镜头压缩 1h 31min 真 session 到 12 秒。中部一行实时计数器 "8 done · 12 partial · 8 missing"；右下角 CostBadge 从 $1.12 滚到 $4.24，旁边 token 计数器 "454k in / 238k out"。背景 commit 流瀑布滑下：`5aedd6e` CHANGELOG、`4b58841` README、`3d2ad5f`、`53df272` 四个 sha 依次出现。
- **旁白（中文）**："一小时三十一分钟。四块二毛四。"
- **旁白（英文）**："One hour, thirty-one minutes. Four dollars twenty-four."
- **字幕**："1h 31min · \$4.24 · 454k+238k tok"
- **真/Mock**：HYBRID — PresetProgress + CostBadge + CommitsTimeline 用真组件 + fixture 数据回放；时间压缩用 AE timeRemap。
- **录制方式**：playwright 渲染 PresetProgress 各阶段快照 → AE 拼成延时摄影。
- **配乐密度**：high → 高潮段，每个 tick 一记 hi-hat，sha 落定一记 bell。

### 镜头 8 [1:33 – 1:43] — PR chip 弹出（M5 第一段）

- **画面**：SessionsBoard 右上角弹出一个 PR chip 横幅 "PR #6 opened on anzy-renlab-ai/agent-game-platform"，带 GitHub octocat 小图标。镜头推近这个 chip 全屏化，过渡到真 GitHub PR 页面截屏：标题 "ZeroU session #4 · 2 merged · 24 NEED_HUMAN"，下方 4 个 commit 列表 sha 清晰可读。
- **旁白（中文）**："不是建议清单。是真的 PR。"
- **旁白（英文)**："Not a checklist. A real pull request."
- **字幕**："github.com/anzy-renlab-ai/agent-game-platform/pull/6"
- **真/Mock**：REAL — 真截屏 PR #6 页面。
- **录制方式**：直接屏录 https://github.com/anzy-renlab-ai/agent-game-platform/pull/6 → AE 加 chip 弹出 + zoom in 过渡。
- **配乐密度**：mid → chip 落定一记 ping，过渡到 PR 页面回到中密度。

### 镜头 9 [1:43 – 1:50] — NEED_HUMAN 列表（M5 第二段）

- **画面**：切回 ZeroU app，SessionsList 末态视图。顶部双绿徽章："preset 8/28 done · vision verdict NO"。下方 NEED_HUMAN 列表横向滚动 6 条卡片：`ci-pipeline-missing`、`license-file-missing`、`auth-password-recovery`、`db-backup-path`、`ui-empty-states`、`vision-social-features-unverified`。每条卡片右侧一个 "Hand off" 按钮微微脉动。
- **旁白（中文）**："剩下 24 件，它知道自己不该做。这种事留给你。"
- **旁白（英文)**："The other twenty-four? It knows when to stop and ask."
- **字幕**："24 items handed back · merger paused"
- **真/Mock**：REAL — SessionsList + GapList 用真组件，数据走 fixture 24 个 NEED_HUMAN。
- **录制方式**：playwright 渲染末态 → 真屏录 + 横向 marquee scroll。
- **配乐密度**：mid → 收尾铺垫，鼓点淡出。

### 镜头 10 [1:50 – 1:55] — CTA

- **画面**：全黑底，ZeroU 字母 logo 居中淡入，下方一行白字 "Drop in a demo. Wake up to a product."，再下面 URL `ZeroU.dev`，右下角小字 "Built on Claude · git-native · open source"。
- **旁白（中文）**："ZeroU 点 dev。"
- **旁白（英文)**："ZeroU dot dev."
- **字幕**：（与画面同）
- **真/Mock**：MOCK — logo + 文案 AE 合成。
- **录制方式**：AE 直接出 5s 收尾卡。
- **配乐密度**：low — 主旋律最后一记长 pad 衰减到静音。

## 四、文案清单（旁白 voiceover 中英双语）

中文版完整文案（用一个 narrator 念，整段连贯，每句 ≤15 字）：

> 你扔进去一个 demo。一觉醒来，它是个产品。
> demo 永远停在 demo。十件该做的事，没一个人做。
> 不写 PRD。你只回答 A 还是 B。
> 它先认出这是个 SaaS。然后照单子挑出 26 件没做的事。
> 六个 agent 各管一段。看牌的是你，洗牌的是它们。
> 过不了就退回去。它对自己比你严。
> 一小时三十一分钟。四块二毛四。
> 不是建议清单。是真的 PR。
> 剩下 24 件，它知道自己不该做。这种事留给你。
> ZeroU 点 dev。

English version (full narration, native speaker pronunciation, each line ≤20 syllables):

> Drop in a demo. Wake up to a product.
> Demos stay demos. The boring ten percent never ships.
> No PRD. Just A, B, or C.
> Auto-detected: SaaS web. Twenty-six gaps to close.
> Six agents, one assembly line. You watch. They build.
> Failed audit? Roll back. Try again. Sixty-one times if it takes.
> One hour, thirty-one minutes. Four dollars twenty-four.
> Not a checklist. A real pull request.
> The other twenty-four? It knows when to stop and ask.
> ZeroU dot dev.

## 五、关键截图 / 录屏列表（给视频剪辑师）

| # | 内容 | 来源（真 / mock） | 路径或 URL | 时长 |
|---|---|---|---|---|
| 1 | ProjectsHome 卡片视图 | REAL | `D:/lll/d2p/ui/src/components/ProjectsHome.tsx` → playwright 截图 | 3s |
| 2 | NOT_DONE 卡片墙 | MOCK | Figma 出 4 张卡（CHANGELOG / README / CI / CSRF） | 8s |
| 3 | MultiTurnPanel A/B/C 三轮 | REAL | `D:/lll/d2p/ui/src/components/MultiTurnPanel.tsx` 驱动 fixture | 10s |
| 4 | vision.md 打字机 | REAL | `D:/lll/managed-projects/agent-game-platform/.d2p/vision.md` | 7s（与 #3 叠） |
| 5 | PresetChecklistView 32 圆点 | REAL | `D:/lll/d2p/ui/src/components/PresetChecklistView.tsx` | 6s |
| 6 | GapList 26 条 | REAL | `D:/lll/d2p/ui/src/components/GapList.tsx` 走 fixture 24+2 | 5s |
| 7 | SessionsBoard 6 卡片 | REAL | `D:/lll/d2p/ui/src/components/SessionsBoard.tsx` + fixture event replay | 12s |
| 8 | 4-gate reviewer + 红光 | HYBRID | gate 卡 mock + 真 `CommitDiffDrawer.tsx` 渲染 commit `4b58841` | 18s |
| 9 | PresetProgress 延时摄影 | HYBRID | `D:/lll/d2p/ui/src/components/PresetProgress.tsx` 多快照 + AE timeRemap | 15s |
| 10 | CommitsTimeline 4 sha 瀑布 | REAL | `D:/lll/d2p/ui/src/components/CommitsTimeline.tsx`，sha：5aedd6e / 4b58841 / 3d2ad5f / 53df272 | 与 #9 叠 |
| 11 | CostBadge \$4.24 + token 计数 | REAL | `D:/lll/d2p/ui/src/components/CostBadge.tsx` | 与 #9 叠 |
| 12 | PR chip 弹出 + GitHub PR 页 | REAL | https://github.com/anzy-renlab-ai/agent-game-platform/pull/6 屏录 | 10s |
| 13 | SessionsList NEED_HUMAN 滚动 | REAL | `D:/lll/d2p/ui/src/components/SessionsList.tsx` 走 24 条 fixture | 7s |
| 14 | CTA 卡 | MOCK | AE 5s 收尾卡 | 5s |

## 六、配乐 + 节奏要求

整体走"夜→晨"曲线。0:00–0:18 low 密度，单 pad + 单钢琴音，营造"睡前丢一个 demo"的安静；0:18–0:48 进 mid，elicit 的打字 click + detector 扫描 tick 与配乐节拍 1:1 锁帧；0:48–1:00 SessionsBoard 6 卡依次亮起，每张卡一记 mid-tom，第 6 张落定整段鼓 fill 进入主旋律。1:00–1:18 是全片唯一一段紧张（M2 adversarial 红光）：那一帧用一记低频 sting + 反向 swoosh，第二轮回绿瞬间主旋律回升。1:18–1:33 高密度高潮段（preset 32 项翻绿 + 4 个 commit sha 落定），每个 tick 配 hi-hat，每个 sha 配一记 bell。1:33–1:50 mid 密度收尾，PR chip 一记 ping，NEED_HUMAN 列鼓点淡出。1:50–1:55 单 pad 长尾衰减到静音。

## 七、收尾 CTA

最后 5 秒 frame：黑底 + ZeroU 字母 logo 居中 + 一行白字 "Drop in a demo. Wake up to a product." + URL `ZeroU.dev` + 角落小字 "Built on Claude · git-native · open source"。
主 CTA：**`ZeroU.dev`**——官网首屏 hero 直挂这条视频，下方一个 "Drop a demo" 按钮直接打开 ProjectsHome；投资人版本同 frame 但右下加 "Book demo" 二级按钮。
