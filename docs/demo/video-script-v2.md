# ZeroU — 2min Demo Video Script v2 (Production-Ready)

> 总长 113s · 镜头 10 个 · wow moments M1-M5 全用并升级
> Fixture 源：`D:/lll/managed-projects/agent-game-platform/.d2p/session-summary.md`
> 真 PR：https://github.com/anzy-renlab-ai/agent-game-platform/pull/6
> 真 commit sha：`5aedd6e` · `4b58841` · `3d2ad5f` · `53df272`
> 视觉语言锚点：Linear / Devin Sub-agent / Notion AI Connectors / Apple WWDC product montage / Vercel Frontend Cloud

---

## 0. Master Spec

### 0.1 技术规格

| 项 | 值 |
|---|---|
| **总长** | 113s（10 镜头连续，无 gap） |
| **目标分辨率** | 3840×2160 (4K UHD) 主交付；1920×1080 (FHD) 网页嵌入版；1080×1920 竖版做切片 |
| **帧率** | 60fps 主交付（保证 panel slide / UI 动效丝滑），24fps 用于镜头 1/10（cinematic feel） |
| **长宽比** | 16:9 主交付；9:16 病毒切片；1:1 X / LinkedIn |
| **色彩空间** | Rec.709 · sRGB · 8-bit 输出；工程文件 12-bit ProRes 4444 中间档 |
| **音频** | 48kHz / 24-bit / Stereo · LUFS -14（YouTube / Twitter standard）· True Peak ≤ -1 dBTP |
| **编解码** | 主交付 H.265 (HEVC) 40Mbps · 网页 H.264 18Mbps · 母版 ProRes 422 HQ |
| **字体三件套** | Headline: **Söhne Breit Halbfett** (fallback: Inter Display Semibold) · Body: **Söhne Buch** (fallback: Inter Regular) · Mono: **Berkeley Mono Regular** (fallback: JetBrains Mono Regular) |
| **基础字色** | Foreground `#EDEDED` · Muted `#8A8A8A` · Accent `#7CFFB2` (mint pulse) · Alert `#FF3B3B` (M2 only) |
| **背景** | Pure `#0A0A0B`（非纯黑，留 grain 余量）· Panel `#121214` · Border `#1F1F22` |
| **LUT 主基调** | Custom "ZeroU Mono" — Bleach Bypass 浓度 25% + Teal-shadow / Mint-highlight split toning（详 §5） |

### 0.2 整体节奏曲线图（ASCII）

```
镜头切换密度
  ▲
  │
高│                                    ██   ██
  │                              ██    ██   ██  ██
  │              ██   ██    ██   ██    ██   ██  ██
中│        ██    ██   ██    ██   ██    ██   ██  ██
  │  ██    ██    ██   ██    ██   ██    ██   ██  ██   ██
低│  ██    ██    ██   ██    ██   ██    ██   ██  ██   ██
  └──┴─────┴─────┴────┴─────┴────┴─────┴────┴───┴────┴──▶ time
     S1    S2    S3   S4    S5   S6    S7   S8  S9   S10
     0-8   8-18  18- 35-   48-   60-   78-  93- 103- 108-
                 35  48    60    78    93   103 108  113

BPM 曲线
  ▲
110│                                    ████████████
  │                              ▒▒▒▒                ▒▒
105│                        ▒▒▒▒                       ▒▒
  │              ▒▒▒▒▒▒                                 ▒▒
 95│        ▒▒▒▒                                          ▒▒
  │  ▒▒▒▒                                                  ▒▒▒
 80│▓▓                                                       ▓▓
  └──┴─────┴─────┴────┴─────┴────┴─────┴────┴───┴────┴──▶ time
   intro  buildup       drop / climax (M2→M3→M5)        outro
```

- **intro (0-18s)** 80 BPM · pad-only · 单点钢琴
- **buildup (18-60s)** 95→105 BPM · click + tick + tom 叠加
- **climax (60-103s)** 110 BPM · 含 1 个红光 sting drop (M2) + 全鼓段 (M3)
- **outro (103-113s)** 衰减回 80 BPM · 单 pad sustain 到静音

### 0.3 5 个 wow moment 总览

| ID | 镜头 | 升级要点 | 关键技术 |
|---|---|---|---|
| **M1** | S5 SessionsBoard 6 角色亮起 | Spring 弹性 + role-tint 波浪染色 | After Effects · spring(180, 18) · stagger 110ms |
| **M2** | S6 Adversarial 红光攻击 → rollback → 重写 | Glitch transition + chromatic aberration + 高速 SFX | DaVinci Resolve · Twitch + Prism + Datamosh |
| **M3** | S7 Preset 32 项延时翻绿 | Stagger 60ms 鞭子 effect（不同时变） | AE · Wave Warp + per-cell delay |
| **M4** | S3 Vision A/B/C → vision.md | 选项卡 morph 进 markdown + mono typewriter + cursor blink | AE · Shape Morph + SplitType char animator |
| **M5** | S8/S9 PR chip → 真 GitHub | 浏览器窗口 isometric 倾斜 + dolly-in 推近 PR body | Cinema 4D Lite Camera + AE Real Lens Blur |

---

## 1. Pre-production Asset Manifest

### 1.1 录屏类（Playwright 真 UI 录制）

| ID | 内容 | 路径 / 来源 | 输出格式 | 备注 |
|---|---|---|---|---|
| A01 | ProjectsHome 卡片视图 | `D:/lll/d2p/ui/src/components/ProjectsHome.tsx` | PNG 4K + WebM 8s | 截净底，不含浏览器 chrome |
| A02 | MultiTurnPanel 三轮 A/B/C | `D:/lll/d2p/ui/src/components/MultiTurnPanel.tsx` 驱动 fixture | WebM 12s 60fps | 录 3 次操作 → AE 拼 |
| A03 | vision.md 真文本 | `D:/lll/managed-projects/agent-game-platform/.d2p/vision.md` | TXT 直接读 | 喂给 SplitType / Lottie |
| A04 | PresetChecklistView 32 圆点 | `D:/lll/d2p/ui/src/components/PresetChecklistView.tsx` | PNG 4K x32 帧 | 每个圆点状态切片 |
| A05 | GapList 26 条 | `D:/lll/d2p/ui/src/components/GapList.tsx` 走 fixture | PNG 4K + WebM 6s | scrollable 末态 |
| A06 | SessionsBoard 6 卡片 | `D:/lll/d2p/ui/src/components/SessionsBoard.tsx` + fixture event replay | WebM 14s 60fps | 注入 event stream 让 6 卡依次激活 |
| A07 | CommitDiffDrawer 红光 + diff | `D:/lll/d2p/ui/src/components/CommitDiffDrawer.tsx` 渲染 commit `4b58841` | PNG 4K + WebM 6s | diff 内容来自真 commit |
| A08 | PresetProgress 多状态 | `D:/lll/d2p/ui/src/components/PresetProgress.tsx` | PNG 4K x8 帧（不同百分比） | AE timeRemap 拼延时 |
| A09 | CommitsTimeline 4 sha | `D:/lll/d2p/ui/src/components/CommitsTimeline.tsx` | WebM 8s | sha：`5aedd6e` / `4b58841` / `3d2ad5f` / `53df272` |
| A10 | CostBadge $4.24 + token | `D:/lll/d2p/ui/src/components/CostBadge.tsx` | PNG 4K + WebM 6s | 录 ticker rolling |
| A11 | SessionsList NEED_HUMAN 末态 | `D:/lll/d2p/ui/src/components/SessionsList.tsx` 走 24 条 fixture | WebM 7s | 横向 marquee |
| A12 | GitHub PR #6 真页面 | https://github.com/anzy-renlab-ai/agent-game-platform/pull/6 | WebM 10s 60fps | 用 Chrome 1440p 录原始页面 |

### 1.2 合成类（AE / DaVinci 制作）

| ID | 内容 | 工具 | 时长 | 备注 |
|---|---|---|---|---|
| B01 | 日 / 夜背景 gradient 切换 | AE Gradient Ramp + Time Remap | 8s | 镜头 1 |
| B02 | 4 个 "NOT DONE" isometric 卡 + 红章 | Figma → AE 3D Layer + Inertia bounce | 10s | 镜头 2 |
| B03 | Hexagon detector 自旋图标 | AE Shape Layer + rotation expression | 4s | 镜头 4 |
| B04 | Glitch transition (M2) | DaVinci Resolve Fusion / AE Datamosh | 0.5s | S5→S6 切点 |
| B05 | Particle burst (M3 完成) | AE Particular | 0.8s | S7 末尾 32 全绿瞬间 |
| B06 | Isometric browser window 倾斜 | Cinema 4D Lite + 真 PR 截屏映射 | 4s | 镜头 8 |
| B07 | Logo 收尾卡 | AE Shape Layer + 字幕 | 5s | 镜头 10 |

### 1.3 音频类

| ID | 内容 | 来源 | 时长 |
|---|---|---|---|
| C01 | 主配乐 base track | Artlist 关键词 "minimal tech pulse build" / 备选 "ambient grid hopeful" | 113s |
| C02 | Drop 段 climax loop | Artlist 关键词 "synth wave low climax 110bpm" | 18s（覆 S6-S7） |
| C03 | Sting · M2 red attack | Epidemic Sound "cinematic impact dark sub" | 0.8s |
| C04 | Reverse swoosh · M2 rollback | Epidemic Sound "reverse riser glitch short" | 0.6s |
| C05 | Tick × 32 (preset 翻绿) | Custom Foley · soft analog click 880Hz | 60ms x32 |
| C06 | Bell × 4 (commit sha 落定) | Custom Foley · brass mallet C5 | 200ms x4 |
| C07 | Ping (PR chip 弹) | Custom Foley · glass tap G5 | 180ms |
| C08 | Mid-tom × 6 (S5 卡片亮) | Custom Foley · soft tom + reverb | 320ms x6 |
| C09 | Pad sustain (outro) | Artlist "warm pad sunrise C major" | 10s |
| C10 | Typewriter click (S3 vision.md) | Custom Foley · IBM Selectric sample, every 4-th char | per-char |
| C11 | Narrator VO 中文版 | 录音棚 · 男中音 · 朗读速度 240 syl/min | 95s 净 |
| C12 | Narrator VO 英文版 | 录音棚 · British male calm · 180 wpm | 95s 净 |

### 1.4 字幕 / 文字资产

| ID | 内容 | 字体 | 字号 (1080p 基准) | 颜色 |
|---|---|---|---|---|
| T01 | Hook 文案 "Drop a demo. Ship a product." | Söhne Breit Halbfett | 96 px | `#EDEDED` |
| T02 | 镜头小标 "vision.md · auto-generated" | Berkeley Mono | 24 px | `#8A8A8A` |
| T03 | preset 标签 "preset: saas-web · 32 checks · 26 gaps" | Berkeley Mono | 28 px | `#7CFFB2` |
| T04 | Attempt counter "attempt 3 · all green" | Berkeley Mono | 22 px | `#7CFFB2` |
| T05 | Cost stamp "1h 31min · \$4.24 · 454k+238k tok" | Berkeley Mono | 32 px | `#EDEDED` |
| T06 | PR URL "github.com/anzy-renlab-ai/agent-game-platform/pull/6" | Berkeley Mono | 26 px | `#8A8A8A` |
| T07 | CTA URL "ZeroU.dev" | Söhne Breit Halbfett | 120 px | `#EDEDED` |
| T08 | CTA tagline "Drop in a demo. Wake up to a product." | Söhne Buch | 36 px | `#EDEDED` |

---

## 2. Shot-by-Shot Storyboard

---

### 镜头 1 [0:00 – 0:08 · 8s] — Hook：拖入 demo

**视觉描述**（≥100 字）

开场全黑 `#0A0A0B`，0:00.5 一个 `28×28` 的 mono cursor 从画面左下角 `(120, 1860)` 以速度 1200 px/s 朝中心移动；0:01.2 拖着一枚 file-folder 图标 `agent-game-platform/` 进入屏幕；图标尺寸 192×192 px，folder tab 高光 `#7CFFB2 12% opacity`。0:03 demo 文件夹被拖入屏幕正中的 ZeroU app 窗口；窗口边框 `1px solid #1F1F22`、外发光 `box-shadow: 0 0 48px rgba(124,255,178,0.18)`。0:04 文件夹"吸入"窗口的同时，背景从 deep night `#0A0A0B` 渐变到 dawn mist `#1A1A20`，再在 0:07 闪一记冷晨蓝 `#2B3540`。右下角时钟数字（Berkeley Mono 36px）从 `23:47` 以 number ticker 每 0.4s 跳 1 小时翻到 `06:12`，配 6 次轻 tick。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| cursor 移入 | 1200ms | cubic-bezier(0.22, 1, 0.36, 1) | 500ms | @0% (120,1860) opacity 0 · @30% (520,1400) opacity 1 · @100% (960,540) hold |
| folder 吸入 | 700ms | cubic-bezier(0.65, 0, 0.35, 1) | 3000ms | @0% scale 1, rotate 0 · @60% scale 0.4 rotate -8° · @100% scale 0 opacity 0 |
| app 窗口 glow pulse | 800ms | easeOutQuart | 3000ms | @0% box-shadow 0 0 0 mint @0 · @50% 0 0 64px mint @0.32 · @100% 0 0 48px mint @0.18 |
| 背景 gradient | 4000ms | easeInOutCubic | 3500ms | @0% `#0A0A0B` · @60% `#1A1A20` · @100% `#2B3540` |
| 时钟数字 ticker | 2400ms | linear (1 步 400ms) | 4400ms | 23:47 → 00:47 → 02:47 → 03:47 → 04:47 → 05:47 → 06:12 |

**转场到 S2**

- **类型**：**Linear Wipe 90°（从下往上）**, Premiere/Resolve 原生 transition
- **时长**：12 帧 @ 60fps（200ms）
- **缓动**：easeInOutQuart
- **方向**：bottom → top
- **附加**：transition 内部叠 8% film grain，避免硬切感

**文字 / 数字动画**

- 时钟数字 `06:12`：Berkeley Mono 36px / weight 400 / letter-spacing 2px · `#7CFFB2` glow filter `drop-shadow(0 0 6px rgba(124,255,178,0.5))`
- 入场动画：number ticker, 每位独立 flip card 翻牌
- 中文版无 hook 文字（让画面说话）；英文版底部小字 `Söhne Buch 22px @ #8A8A8A` 于 0:06 mask-reveal 出现 "wake up to a product"，0:07.5 淡出。

**音频**

- 0:00.0 单 pad C2 sustain（C09 提前播）淡入 ramp 1500ms 到 -22 LUFS
- 0:03 folder 吸入 → 一记 sub bass 30Hz 触底 200ms
- 0:04–0:07 时钟跳：6 记 soft analog click (C05 用 880Hz 弱化版) 每 0.4s 一记
- 0:07.5 准备进 S2 的 piano up-note：钢琴 C5 单音 600ms
- 留白：0:00–0:00.5 完全静音 0.5s（建立 cinematic 距离感）
- 旁白：0:01 中文 "你扔进去一个 demo。" / 0:04 "一觉醒来，它是个产品。" · 英文 "Drop in a demo." / "Wake up to a product."

**调色 / 视觉**

- LUT: "ZeroU Mono v1" · black point `#0A0A0B` / white point `#EDEDED` / saturation 60%
- Grain intensity: 18 (35mm 模拟)
- Bloom: 中等强度，highlight threshold 92%, intensity 0.35
- Chromatic aberration: 微量 0.3px（仅角落）

**风格 / 镜头**

- 拍摄方向：cinematic
- 帧率：24fps（这一镜头独有，营造电影感）
- 摄像头模拟：极缓 push-in，从 100% scale 推到 102% scale，匀速 8s

**可执行实现路径**

1. Playwright 截 ProjectsHome 真组件（A01）保存 PNG 4K
2. AE 中铺背景 gradient（B01）
3. 导入 PNG 做窗口
4. AE 中绘 folder + cursor 动画
5. 时钟用 Lottie 或 AE expression 做 number ticker
6. 加 LUT + bloom + grain
7. 输出 ProRes 422 HQ → 主时间线

---

### 镜头 2 [0:08 – 0:18 · 10s] — 问题陈述

**视觉描述**（≥100 字）

切到一面"未完成 demo 墙"。背景 `#0A0A0B`，正中悬浮 4 张 isometric 卡片（45° / 30° 双轴倾斜），分别标注 "CHANGELOG"、"README"、"CI pipeline"、"CSRF check"。每张卡 480×320 px，卡面材质 `#121214` + 1px border `#1F1F22`、上边缘 inner highlight 6%。每张卡右上角盖一枚红色 stamp "NOT SHIPPED"，stamp 用 Söhne Breit Halbfett 28px / `#FF3B3B 80% opacity` / rotation -12° / drop shadow `0 2px 8px rgba(255,59,59,0.4)`，stamp 落下时带轻微"砸下"的 0.5s spring overshoot。卡片背景层是文件夹墙：96 个半透明 `demo-*/` folder 缩略图以 6x16 网格平铺，opacity 8%，缓慢从右向左视差滚动（30 px/s），制造"成千上万被遗忘的 demo"感。0:14 一张额外卡片从画面左侧飞入对接，凸显"还有更多"。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| 4 张卡片入场 | 700ms / 卡 | spring(stiffness 220, damping 22) | stagger 150ms（800ms / 950ms / 1100ms / 1250ms） | @0% translateY 80px scale 0.9 opacity 0 rotateX 45° · @100% 原位 scale 1 opacity 1 rotateX 30° |
| Stamp 砸下 | 500ms | cubic-bezier(0.34, 1.56, 0.64, 1)（含轻 overshoot） | 每张卡入场 + 400ms | @0% scale 2.5 opacity 0 rotate -8° · @70% scale 0.95 opacity 1 rotate -13° · @100% scale 1 opacity 1 rotate -12° |
| 文件夹墙视差 | 10000ms loop | linear | 0ms | translateX 0 → -1200px loop |
| 额外卡飞入 | 600ms | cubic-bezier(0.22, 1, 0.36, 1) | 6500ms | @0% (-200, 540) opacity 0 · @100% (180, 540) opacity 1 |

**转场到 S3**

- **类型**：**Whip Pan + Motion Blur**（向右 whip pan）, AE Camera Lens Blur + Position
- **时长**：14 帧 @ 60fps（233ms）
- **缓动**：easeInQuart 在头部 / easeOutQuart 在尾部
- **方向**：horizontal whip right-to-left
- **附加**：whip pan 中段加 22% motion blur，到 S3 时残留 8% blur 1 帧再清

**文字 / 数字动画**

- 卡片标题：Söhne Breit Halbfett 32px · `#EDEDED` · 入场 SplitType per-word stagger 60ms · mask reveal 上→下
- "NOT SHIPPED" 戳：Söhne Breit Halbfett 28px · `#FF3B3B` · scale-down + opacity reveal · 同时叠 1 帧白闪 `#FFFFFF 50% opacity`
- 底部字幕：Berkeley Mono 24px `#8A8A8A`：中文 "demo 永远停在 demo。"，0:14 切到 "十件该做的事，没一个人做。"，每句 mask reveal 左→右 400ms

**音频**

- 0:08 → 0:10 配乐回到 low 密度，pad 继续 + 一次 piano single note C5
- 0:10–0:17 stamp 砸 4 次，每次 stamp 落下：一记低频 thump 80Hz · 80ms + 上层薄 click 2kHz
- 0:14 额外卡飞入：whip swoosh "shh-thwap" 220ms
- 0:17.5 配乐节奏开始爬升，hi-hat 1/4 拍密度上来
- 旁白：0:09 中文 "demo 永远停在 demo。" / 0:13 "十件该做的事，没一个人做。" · 英文 "Demos stay demos." / "The boring ten percent never ships."

**调色 / 视觉**

- LUT: "ZeroU Mono v1"，但 stamp 红区域 mask 出来保留 100% 饱和 + slight bloom (intensity 0.5)
- Grain: 22 (略提升，强调"灰心"质感)
- Vignette: 14% 边缘暗角，焦点收向卡片
- Background blur: 文件夹墙做 8px gaussian blur

**风格 / 镜头**

- 拍摄方向：technical / cinematic-minimal
- 帧率：60fps
- 摄像头模拟：static + 极缓 zoom-in（100% → 104%），背景因 parallax 移动产生 depth 错觉

**可执行实现路径**

1. Figma 设计 4 张 isometric 卡片 + stamp（导出 SVG 高保真）
2. AE 导入 SVG → 设为 3D Layer，调 45/30° rotation
3. AE Particular 不需要；纯 shape layer + expression 做入场
4. 文件夹墙：Figma 出单 folder PNG → AE puppet pin loop scroll
5. 加 LUT + vignette
6. 输出 ProRes 422 HQ

**真 / Mock**

- MOCK — 卡片名取自 fixture session-summary.md 真 NEED_HUMAN 列表前 4 条（CHANGELOG / README / CI pipeline / CSRF check）
- 文件夹墙：纯设计资产

---

### 镜头 3 [0:18 – 0:35 · 17s] — Vision elicit（**M4 升级**）

**视觉描述**（≥100 字）

屏幕一分为二，比例 5:7（左 :右）。左侧 ZeroU 真 MultiTurnPanel 组件（`MultiTurnPanel.tsx`）：标题 "Tell me your vision" Söhne Breit Halbfett 36px，下方一行 AI 提问 "How will the product make money?"。再下方三张选项卡 A/B/C 横向排列，每张 280×120 px：A "Rake fee per game" / B "Subscription" / C "Ads"。光标移动选 A，A 卡片瞬间亮起 mint accent `#7CFFB2` border + 16px outer glow。0:21 切到第二轮："Primary user?" → A "Casual players" / B "Pros" / C "Streamers"，选 A。0:25 第三轮："Initial moat?" → A "AI-native UX" / B "Speed" / C "Brand"，选 A。

右侧 7/12 屏：`vision.md` 文件以 mono typewriter 逐字浮现，背景 `#0A0A0B`，文字 Berkeley Mono 28px `#EDEDED`。三轮 elicit 完成后，每个 A 选项卡进行 **morph 动画**——选项卡的 shape 直接 flow 进 vision.md 对应段落的 markdown 行。第一行 `# Vision: Rake-fee online card platform`，第二行 `## Target users\n- Casual players...`，第三行 `## Initial moat\n- AI-native onboarding`。光标 `▌` 始终闪烁（每 530ms 一拍）。0:33 文件末尾盖一枚小章 "auto-generated · vision.md"。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| 选项卡 A 选中（每轮） | 240ms | cubic-bezier(0.16, 1, 0.3, 1) | per-round | @0% border `#1F1F22` glow 0 · @100% border `#7CFFB2` glow 16px @0.45 |
| 选项卡 morph 进 markdown | 900ms | cubic-bezier(0.65, 0, 0.35, 1) | per-round + 300ms | @0% 原位 rect 280×120 · @50% morph 中间形 (吸入路径) · @100% 进入 markdown 行 transform 0 opacity 0 |
| typewriter 字符 reveal | per-char 35ms | linear | morph 完成后 100ms | SplitType per-char · 每字符 opacity 0→1 35ms |
| 光标 `▌` blink | 1060ms loop | step-end | 0ms | @0% opacity 1 · @50% opacity 0 · @100% opacity 1 |
| 三轮叠化间转场 | 350ms | easeInOutCubic | per-round end | cross dissolve 21 帧 |
| 0:33 章 stamp | 400ms | cubic-bezier(0.34, 1.56, 0.64, 1) | 14500ms | 同 S2 stamp 配方但用 mint `#7CFFB2` |

**转场到 S4**

- **类型**：**Mask Wipe 圆心展开**, AE Linear Wipe 中心向外 + Feather 80px
- **时长**：18 帧 @ 60fps（300ms）
- **缓动**：cubic-bezier(0.83, 0, 0.17, 1)
- **方向**：center → out
- **附加**：wipe 中心起点放在 vision.md 末尾 stamp 位置，营造"文档变成下一镜头"

**文字 / 数字动画**

- 选项卡 A/B/C 文案：Söhne Buch 24px `#EDEDED` · 选中后 weight 切到 Söhne Breit Halbfett
- 选中态 mint glow：`box-shadow: 0 0 24px rgba(124,255,178,0.45), inset 0 0 0 1px #7CFFB2`
- vision.md typewriter：Berkeley Mono 28px / line-height 1.5 / letter-spacing 0
- markdown 标题（`#`、`##`）入场时配 0.5 帧弹性 scale 1.02 → 1
- 右上角小标 "vision.md · auto-generated" Berkeley Mono 20px `#8A8A8A`

**音频**

- 0:18–0:25 配乐进 95 BPM，加 1/8 拍 hi-hat
- 每字符 typewriter：C10 IBM Selectric click 每第 4 字一记（保留呼吸感，不密）
- 选项卡选中：一记 soft "tap" 1.2kHz 60ms · 每轮 1 次共 3 次
- Morph：低频 whoosh 220Hz 400ms 每轮 1 次
- 0:33 章 stamp：mid-tom 200Hz 180ms
- 旁白：0:19 中文 "不写 PRD。" / 0:24 "你只回答 A 还是 B。" · 英文 "No PRD." / "Just A, B, or C."

**调色 / 视觉**

- LUT: "ZeroU Mono v1"
- vision.md 区域单独加 +5% saturation 在 mint hue（让 markdown 标题略显眼）
- Grain: 16
- Bloom: 选项卡选中态边缘 bloom intensity 0.55

**风格 / 镜头**

- 拍摄方向：precise · technical · Linear-style
- 帧率：60fps（typewriter 必须 60fps 否则不丝滑）
- 摄像头模拟：static，无 push/pull；保持桌面级稳定感

**可执行实现路径**

1. Playwright 录 MultiTurnPanel 三轮真交互（A02），每轮存独立 WebM
2. AE 中分屏：左 5/12 放 A02，右 7/12 留空
3. AE SplitType 文字 reveal：把真 vision.md（A03）按字符切分，per-char 动画
4. Shape Layer 做 A 选项卡的 morph 路径（关键帧关键节点：rect → curved blob → 进入对应 markdown 行的 horizontal stripe）
5. 光标用 AE expression `time % 1.06 < 0.53 ? 100 : 0` 控制 opacity
6. 加 LUT + bloom
7. ProRes 422 HQ

**真 / Mock**

- REAL — 左屏组件真录；vision.md 内容 100% 取自 `D:/lll/managed-projects/agent-game-platform/.d2p/vision.md`
- 选项卡 morph 是 AE 合成（M4 升级核心）

---

### 镜头 4 [0:35 – 0:48 · 13s] — Detector + Preset 32 项 + GapList

**视觉描述**（≥100 字）

切到全屏 `#0A0A0B`。画面中心一个六边形 detector 图标（绘制方式：6 边正多边形 outline 2px `#7CFFB2` + 内部六角光栅）自旋一圈（360°），每秒 360° 速度。0:36 自旋完成时停在中心，弹出一个 mono 标签 "saas-web · confidence 0.91"。0:37 detector 图标向上飘移 200px，下方展开 PresetChecklistView 的 32 个 4×8 棋盘格圆点，每个圆点 32×32 px，间距 16px。0:38–0:43 像扫描线从左上 (0,0) 到右下 (3,7) 依次激活，第一波全部先变 ZeroU mint pulse（不分绿灰），扫描线本身是一道 24px 厚的 mint glow 横条以 800px/s 移动。0:43 完成扫描后，右侧 GapList 26 条 gap 名称从右滑入，每条卡片标 P1/P2/P3 优先级彩色 chip：P1 `#FF3B3B` / P2 `#FFB23B` / P3 `#7CFFB2`。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| Detector 自旋 | 1000ms | cubic-bezier(0.65, 0, 0.35, 1) | 0ms | rotate 0° → 360° |
| 弹出标签 "saas-web · 0.91" | 350ms | spring(220, 18) | 1000ms | @0% scale 0.6 opacity 0 · @70% scale 1.05 · @100% scale 1 opacity 1 |
| Detector 向上飘移 | 600ms | easeOutQuart | 1500ms | translateY 0 → -200 |
| 棋盘格出现（容器淡入） | 400ms | easeOutQuart | 1800ms | opacity 0→1 scale 0.96→1 |
| 扫描线移动 | 5000ms | linear | 2300ms | left -100px → right 100% |
| 圆点激活（per-cell） | 180ms | cubic-bezier(0.34, 1.56, 0.64, 1) | 扫描线到达时刻（约 stagger 156ms） | @0% scale 1 fill `#1F1F22` · @50% scale 1.3 fill `#7CFFB2` · @100% scale 1 fill `#7CFFB2` |
| GapList 26 条滑入 | 9000ms 总长 | per-card cubic-bezier(0.22, 1, 0.36, 1) | 7500ms（扫描完成 - 1s 前重叠） | stagger 230ms · translateX +120→0 opacity 0→1 |

**转场到 S5**

- **类型**：**Cross Dissolve 16 frames**（Premiere 内置）
- **时长**：16 帧 @ 60fps（266ms）
- **缓动**：linear（dissolve 本身就够柔）
- **附加**：在 dissolve 中段加一帧 5% mint flash 作为节拍触发

**文字 / 数字动画**

- "saas-web · confidence 0.91"：Berkeley Mono 26px `#7CFFB2` glow 8px
- 圆点 hover label（每个圆点上方浮现 1 帧的小标签）：Berkeley Mono 16px `#8A8A8A`，仅可见 200ms 然后消失
- GapList 卡片：标题 Söhne Buch 22px `#EDEDED` + chip Berkeley Mono 14px 反色
- 顶部居中字幕 "preset: saas-web · 32 checks · 26 gaps"：Berkeley Mono 28px `#7CFFB2`，mask reveal 左→右 600ms

**音频**

- Detector 自旋：长 swoosh 200Hz→1000Hz sweep 1000ms
- 标签弹出：一记 mint "tap" 880Hz 80ms
- 扫描线移动 + 圆点激活：连续 32 记 tick (C05)，每 156ms 一记，与扫描位置同步
- GapList 滑入：连续 26 记轻 "shh" paper sound 60ms（避免太尖锐）
- 0:42 配乐 BPM 抬到 105
- 旁白：0:37 中文 "它先认出这是个 SaaS。" / 0:42 "然后照单子挑出 26 件没做的事。" · 英文 "Auto-detected: SaaS web." / "Twenty-six gaps to close."

**调色 / 视觉**

- LUT: "ZeroU Mono v1" + mint 区域 saturation +8%
- Grain: 14（这镜头精度优先，颗粒压低）
- Bloom: 圆点激活态 intensity 0.4，扫描线 intensity 0.7

**风格 / 镜头**

- 拍摄方向：technical / precise / Vercel-grid 美学
- 帧率：60fps
- 摄像头模拟：static · 末尾 1s 极缓 pull-back（100%→97%）露出 GapList 全貌

**可执行实现路径**

1. Playwright 截 PresetChecklistView（A04）32 帧（每个圆点状态切片）
2. Playwright 截 GapList 真 26 条 fixture（A05）
3. AE 绘 hexagon detector（Shape Layer + rotation expression）
4. AE 合成扫描线（Solid + Mask + Glow）
5. AE 每个圆点用 Time Remap + scale expression 控制激活
6. GapList 用 layer slide + stagger expression
7. LUT + bloom + grain
8. ProRes 422 HQ

**真 / Mock**

- HYBRID — PresetChecklistView 数据 + GapList 26 条全部真 fixture；detector 图标 + 扫描线 + 标签是 AE 合成

---

### 镜头 5 [0:48 – 1:00 · 12s] — SessionsBoard 6 角色（**M1 升级**）

**视觉描述**（≥100 字）

切到 SessionsBoard 真全屏（A06）。布局：2×3 网格 6 张 agent 卡片：上排 **detector · elicitor · differ**，下排 **implementer · reviewer · merger**。每张卡 540×360 px，间距 32px，整体居中。卡面 `#121214`，顶部 36px 区是 agent 头标，含 6px×6px 状态 LED（初始灰 `#3A3A3A`，激活后 mint `#7CFFB2`）+ agent 名 Söhne Breit Halbfett 24px。下方为实时 log 区域 Berkeley Mono 18px。0:48 起 6 张卡以 110ms 间隔依次"亮起"——**M1 升级核心**：不是简单 fade，而是 (a) spring 弹性 scale 1→1.05→1，(b) 卡片激活瞬间 role-tint 染色波浪 effect——一道 mint glow 从卡片左上角扫过对角线到右下角，扫过期间卡背景被 tint 上 1% mint，扫过后 LED 切 mint，log 区开始打字。整段 6 张卡形成一条 110ms stagger 的弹性波浪，第 6 张卡（merger）落定时整体一记 fill 鼓点。右下角 CostBadge 同步 ticker 从 `$0.00` 滚到 `$1.12`。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| 每张卡入场 spring | 600ms | spring(stiffness 180, damping 18) | stagger 110ms（0 / 110 / 220 / 330 / 440 / 550 ms） | @0% scale 0.94 opacity 0 · @60% scale 1.05 opacity 1 · @100% scale 1 |
| 卡片 role-tint 对角扫光 | 800ms | cubic-bezier(0.22, 1, 0.36, 1) | 每张卡入场 + 200ms | @0% gradient 位置 -100% mint @0 · @100% 位置 +200% mint @0.18 |
| LED 灰→mint | 240ms | easeOutQuart | 每张卡入场 + 800ms | @0% fill `#3A3A3A` · @100% fill `#7CFFB2` + glow 4px |
| log 行打字 | 1600ms | linear | 每张卡入场 + 1000ms | per-char 25ms |
| Cost ticker $0.00→$1.12 | 9000ms | easeInOutCubic | 1500ms | number ticker 1/100 美分粒度 |

**转场到 S6**

- **类型**：**Glitch Cut**（短 datamosh + RGB split）
- **时长**：6 帧 @ 60fps（100ms）
- **缓动**：n/a（cut + glitch overlay）
- **附加**：转场 6 帧内叠 RGB split 4px + scanline + 1 帧黑场，预示 M2 红光威胁

**文字 / 数字动画**

- Agent 名：Söhne Breit Halbfett 24px `#EDEDED` · 入场时 SplitType per-word fade 200ms
- Log 行内容（真 fixture）：
  - detector → `classified saas-web (0.91) · 24ms`
  - elicitor → `vision A/B/C → vision.md @ rev 4`
  - differ → `26 gaps queued · 14 P1 / 8 P2 / 4 P3`
  - implementer → `branch fix/docs-changelog-missing · commit 5aedd6e`
  - reviewer → `static ok · alignment ok · behavioral ok · adversarial...`
  - merger → `waiting for adversarial gate...`
- Log 颜色：sha 高亮 `#7CFFB2`，其他 `#8A8A8A`，关键词 `#EDEDED`
- CostBadge：Berkeley Mono 32px `#EDEDED` glow 4px `#7CFFB2`

**音频**

- 0:48 6 张卡依次亮起 → 6 记 mid-tom (C08)，每 110ms 一记
- 第 6 张卡落定 → 一段 0.8s drum fill（snare roll → kick + crash）
- log 打字底层薄薄一层 typing texture
- 配乐 BPM 105，开始有完整鼓组
- 旁白：0:49 中文 "六个 agent 各管一段。" / 0:54 "看牌的是你，洗牌的是它们。" · 英文 "Six agents, one assembly line." / "You watch. They build."

**调色 / 视觉**

- LUT: "ZeroU Mono v1"
- 卡片激活态有 +6% mint saturation 局部 mask
- Grain: 14
- Bloom: 中等 0.35
- 整镜头加 ultra-fine scanline overlay 3% opacity（致敬 Devin sub-agent demo）

**风格 / 镜头**

- 拍摄方向：technical / Devin-style orchestration
- 帧率：60fps
- 摄像头模拟：极缓 dolly-in（100%→103%），最后 1s 加速到 push-in 准备进 S6

**可执行实现路径**

1. Playwright 录 SessionsBoard fixture 事件流 14s（A06）
2. AE 中导入 A06，做 spring scale 动画（用 spring expression）
3. AE 绘 diagonal glow stripe，gradient mask 在每张卡上扫过
4. LED 用 Lottie 或 AE shape layer 控制 fill 切换
5. CostBadge ticker：AE Slider Control + expression rounding
6. ProRes 422 HQ

**真 / Mock**

- REAL — SessionsBoard、CostBadge、log 行内容全部真 fixture
- M1 升级的 spring 弹性 + role-tint 对角扫光是 AE 后期合成

---

### 镜头 6 [1:00 – 1:18 · 18s] — Reviewer 4 层 + Adversarial 红光（**M2 升级**）

**视觉描述**（≥100 字）

切到全新 layout。左 3/12 屏一列纵向 4 个 reviewer gate 卡片：**Static gate · Alignment probe · Behavioral · Adversarial**。每个卡 280×180 px，初始 `#121214` border `#1F1F22`。前 3 个在 1:00–1:06 依次弹出绿勾（mint check icon），每个间隔 1.5s。1:07 第 4 个 Adversarial 开始闪烁红光 3 次后整张卡爆出红光 `#FF3B3B`——**M2 升级核心**：(a) **glitch transition** 整屏 datamosh + scanline + RGB split + 1 帧 inverted color；(b) **chromatic aberration** 在红光峰值时全屏增至 6px，余韵 1.5s 拉回；(c) 弹出小气泡 "attack vector: CSRF token reuse on /login"，红字 `#FF3B3B` Söhne Breit Halbfett 22px。右 9/12 屏 CommitDiffDrawer（A07）打开 commit `4b58841`，diff 内容真实可读，红光峰值瞬间一道红色 rollback 箭头从 commit 划回 worktree。1:13 切第二轮：同 commit 重新 implementer 重写，4 gate 重新走，全部绿勾。底部 attempt counter "attempt 3 · all green"。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| 前 3 gate 绿勾 | 240ms 每个 | spring(220, 18) | 0 / 1500 / 3000ms | @0% scale 0 opacity 0 · @60% scale 1.1 · @100% scale 1 opacity 1 |
| Adversarial 红光闪烁 | 3×120ms（亮）+ 80ms（暗） | step-end | 7000ms | opacity 0→1→0→1→0→1 |
| Adversarial 爆光（峰值） | 400ms | cubic-bezier(0.16, 1, 0.3, 1) | 7600ms | @0% bg `#FF3B3B 0%` · @40% bg `#FF3B3B 100%` glow 64px · @100% bg `#FF3B3B 60%` glow 24px |
| Chromatic aberration | 1500ms | easeOutQuart | 7600ms | @0% 0px · @20% 6px · @100% 0.3px |
| Glitch overlay (datamosh) | 600ms | step-end (frame-by-frame) | 7600ms | RGB split + scanline + 1 帧 inversion @ peak |
| Rollback 箭头 | 700ms | cubic-bezier(0.65, 0, 0.35, 1) | 8200ms | path stroke from commit dot back to worktree dot |
| 第二轮叠化 | 800ms | easeInOutCubic | 11000ms | dissolve + 配回绿光 |
| Attempt counter ticker | 400ms | easeOutQuart | 11500ms | "1 · ATTEMPT_3" mask reveal |

**转场到 S7**

- **类型**：**Linear Wipe 90° + Glow Bloom**（绿光从下往上洗刷）
- **时长**：22 帧 @ 60fps（366ms）
- **缓动**：cubic-bezier(0.83, 0, 0.17, 1)
- **方向**：bottom → top
- **附加**：wipe 前缘有 32px mint glow 带，类似"通关绿光扫过"

**文字 / 数字动画**

- Gate 名：Söhne Breit Halbfett 22px · 绿色 `#7CFFB2` (passed) / 红色 `#FF3B3B` (failed)
- Attack bubble "CSRF token reuse on /login"：Söhne Breit Halbfett 22px `#FF3B3B` glow 8px + 1px outline `#0A0A0B`
- Attempt counter "attempt 3 · all green"：Berkeley Mono 22px `#7CFFB2`
- 字幕 1:08 "Adversarial gate · rejected" Berkeley Mono 24px `#FF3B3B`
- 字幕 1:14 "attempt 3 · all green" Berkeley Mono 24px `#7CFFB2`

**音频**

- 1:00–1:06 前 3 gate 绿勾：3 记 mint chime（C5 bell）每记 200ms
- 1:07 闪烁前奏：低频 build-up rumble 30Hz 上升 600ms
- 1:07.6 **红光峰值**：一记 cinematic impact sting (C03) 低频 sub + reverse riser，0.8s
- 1:08 rollback 箭头：reverse swoosh (C04) 600ms
- 1:09–1:12 短暂死寂 1.5s（只剩 pad 残响），制造"出事了"的紧张
- 1:13 第二轮：节奏回来，配乐 110 BPM 全鼓段进入
- 1:14 attempt counter 落定：一记 victory ping `+ 一记 bell C7`
- 旁白：1:02 中文 "过不了就退回去。" / 1:09 "它对自己比你严。" · 英文 "Failed audit? Roll back. Try again." / "Sixty-one times if it takes."

**调色 / 视觉**

- LUT: "ZeroU Mono v1"，红光段临时切到 "ZeroU Alert" LUT（push red channel +30, desaturate green / blue）
- 红光峰值 1 帧：全屏 invert + RGB split 6px + scanline 6%
- Grain: 24（红光段提高，强化压迫感）
- Bloom: 红光区域 intensity 1.2（极高）；绿勾区域 intensity 0.45
- Vignette: 红光峰值 25%；其他时段 12%

**风格 / 镜头**

- 拍摄方向：cinematic / 紧张
- 帧率：60fps（glitch 段保留 60fps，部分 1 帧做 30fps drop frame 仿故障）
- 摄像头模拟：static + 红光峰值瞬间 0.2s 镜头微震（amplitude 4px）

**可执行实现路径**

1. Playwright 截 CommitDiffDrawer 渲染 commit `4b58841` diff（A07）
2. AE 中绘 4 个 gate 卡片（Shape Layer），用 spring scale 控制绿勾入场
3. DaVinci Resolve Fusion 做 glitch transition（Datamosh + Optical Flow + Scanline）
4. AE Optics Compensation + RGB split 做 chromatic aberration
5. AE 绘 rollback 箭头（path animator stroke 0→100）
6. 一帧 invert + scanline overlay 用 Solid + Levels + Pattern
7. 第二轮叠化：dissolve 21 帧
8. ProRes 4444（这一镜头需保留 alpha + 高色深给 glitch）

**真 / Mock**

- HYBRID — gate 卡 + CommitDiffDrawer 渲染 commit `4b58841` 真 diff；红光 + glitch + rollback 箭头 AE 合成

---

### 镜头 7 [1:18 – 1:33 · 15s] — Preset 32 项延时翻绿（**M3 升级**）

**视觉描述**（≥100 字）

切到 PresetProgress 大视图（A08）全屏，4×8 棋盘格 32 个格放大占 70% 屏幕宽。每格 96×96 px，间距 24px。初始全灰 `#1F1F22`。**M3 升级核心**：32 个格 **不同时变绿**，而是按 60ms stagger 鞭子（whip）effect 从左上 → 右下扫过——但鞭子曲线不是 linear，是 cubic-bezier(0.22, 1, 0.36, 1) 让头部慢、中段最快、尾部稍 overshoot。每个格翻绿瞬间 scale 1→1.15→1（spring overshoot）。镜头压缩 1h 31min 真 session 到 12 秒。中部一行实时计数器 "8 done · 12 partial · 8 missing" Berkeley Mono 32px，数字 ticker rolling。右下角 CostBadge `$1.12` → `$4.24` ticker，旁边 token "454k in / 238k out"。背景叠 CommitsTimeline 瀑布（A09）：4 个 sha `5aedd6e`（CHANGELOG）/ `4b58841`（README）/ `3d2ad5f` / `53df272` 从顶部慢慢瀑布下滑，每个 sha 落定一记 bell。1:32 棋盘格末格翻绿瞬间 → 一记 particle burst（B05）32 个 mint 粒子从中心向外扩散。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| 32 格鞭子翻绿（per-cell） | 280ms | spring(stiffness 240, damping 16) | stagger 60ms 但按 cubic-bezier(0.22, 1, 0.36, 1) 重映射（前 8 格慢, 中间 16 格快, 后 8 格稍慢 + overshoot） | @0% scale 1 fill `#1F1F22` · @50% scale 1.15 fill `#7CFFB2` · @100% scale 1 fill `#7CFFB2` |
| 计数器 ticker | 12000ms | linear（per-step 400ms） | 0ms | "0 done · 0 partial · 32 missing" → "8 · 12 · 8" 分 3 段并行 |
| Cost ticker $1.12 → $4.24 | 11000ms | easeInOutCubic | 500ms | 0.01 步进 |
| Token ticker | 11000ms | easeInOutCubic | 500ms | "0k / 0k" → "454k / 238k" |
| Commit sha 瀑布（per-sha） | 600ms 落 + 300ms 停 | cubic-bezier(0.22, 1, 0.36, 1) | 1000 / 4500 / 8000 / 11500 ms | translateY -100→当前位 opacity 0→1 |
| Particle burst 末尾 | 1000ms | easeOutQuart | 13500ms | 32 粒子从中心向外 600px scale 1→0 |

**转场到 S8**

- **类型**：**Zoom Punch + Particle Persistence**（mint 粒子穿越到 S8）
- **时长**：14 帧 @ 60fps（233ms）
- **缓动**：cubic-bezier(0.83, 0, 0.17, 1)
- **方向**：center scale 100% → 115%（短暂 punch in） → 切 S8 后回 100%
- **附加**：S7 末尾的粒子继续在 S8 前 0.5s 漂浮残留，制造连贯感

**文字 / 数字动画**

- 计数器：Berkeley Mono 32px · 数字部分 weight 600 · 颜色按状态变化（done `#7CFFB2` / partial `#FFB23B` / missing `#8A8A8A`）
- CostBadge：Berkeley Mono 36px · `$4.24` 落定瞬间 0.4 帧 mint flash glow 16px
- Token: Berkeley Mono 24px `#8A8A8A`
- Commit sha：Berkeley Mono 22px monospace · sha 部分 `#7CFFB2` + commit msg 部分 `#8A8A8A`
- 顶部居中字幕 "1h 31min · \$4.24 · 454k+238k tok" Berkeley Mono 32px `#EDEDED`，1:30 mask reveal 出现

**音频**

- 1:18 进入 climax 110 BPM
- 32 格翻绿：每格一记 soft analog click (C05) 880Hz · 60ms · 总共 32 记按鞭子曲线时间分布
- 4 个 commit sha 落定：4 记 bell C5 (C06) 200ms
- 1:32 particle burst：一记 mint chime + sweep 高频 800Hz→4kHz 600ms
- 1:33 一记 sub bass + crash 准备进 PR chip
- 旁白：1:21 中文 "一小时三十一分钟。" / 1:27 "四块二毛四。" · 英文 "One hour, thirty-one minutes." / "Four dollars twenty-four."

**调色 / 视觉**

- LUT: "ZeroU Mono v1"，但 mint 区域 saturation +12%（这是全片最饱和瞬间）
- Grain: 12（精度优先）
- Bloom: 翻绿格 intensity 0.55，末尾 particle burst intensity 0.8
- Light leak: 1:30–1:33 极轻一道 mint light leak 从左上斜下来 8% opacity

**风格 / 镜头**

- 拍摄方向：technical / hopeful / climax
- 帧率：60fps（鞭子需要丝滑）
- 摄像头模拟：极缓 pull-back（100%→96%）露出更多 commit timeline；末 1s push-in 准备进 S8

**可执行实现路径**

1. Playwright 截 PresetProgress 8 帧不同百分比（A08）
2. AE 用 Time Remap 拼成延时摄影
3. 32 格 per-cell delay 用 expression `index * 0.06 + ease(time/12) * remap` 控制翻绿时刻
4. 计数器 ticker 用 Slider Control + expression rounding
5. CommitsTimeline 录 A09 → 直接放底层
6. AE Particular 做 particle burst（emitter 中心，32 粒子，velocity 600）
7. ProRes 422 HQ

**真 / Mock**

- REAL — PresetProgress / CostBadge / CommitsTimeline / 4 个真 sha 全部真组件 + 真 fixture
- 鞭子 stagger 曲线 + particle burst 是 AE 合成

---

### 镜头 8 [1:33 – 1:43 · 10s] — PR chip → GitHub 真页面（**M5 升级 part 1**）

**视觉描述**（≥100 字）

切回 SessionsBoard 右上角。1:33 一个 PR chip 横幅从右上角弹出，280×64 px：左侧 GitHub octocat 16px logo · 中间 "PR #6 opened" Söhne Breit Halbfett 20px · 右侧 "anzy-renlab-ai/agent-game-platform" Berkeley Mono 14px `#8A8A8A`。chip 入场带 mint glow 24px + spring overshoot scale 0.9→1.05→1。1:35 chip 被推近至全屏，作为整个 GitHub PR 浏览器窗口的"种子"——**M5 升级核心**：用 Cinema 4D Lite Camera 做 **isometric tilted browser window** 出现，浏览器框架 1920×1080 等比绘制，但整体倾斜 18° around Y-axis + 6° around X-axis（呈现 3D 立体效果），背景仍是 ZeroU `#0A0A0B`。1:38 镜头开始 **dolly-in 推近 PR body**：从远景 isometric 状态平滑过渡到正面 0° 视角同时拉近 scale 1.4，焦点逐渐对到 PR body 文字区域。PR body 真截屏（A12）包含：标题 "ZeroU session #4 · 2 merged · 24 NEED_HUMAN" / 4 个 commit 列表 sha 清晰可读 / Files changed 3 标签。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| PR chip 弹出 | 600ms | spring(180, 16) | 0ms | @0% scale 0.9 opacity 0 translateX +40 · @60% scale 1.05 opacity 1 · @100% scale 1 |
| chip 全屏化 | 800ms | cubic-bezier(0.22, 1, 0.36, 1) | 2000ms | scale 1→4.2 + position toward center |
| Isometric 浏览器窗出现 | 1000ms | cubic-bezier(0.65, 0, 0.35, 1) | 2400ms | rotateY 0→18° rotateX 0→6° + scale 0.7→1 + opacity 0→1 |
| Dolly-in 到 PR body | 2200ms | cubic-bezier(0.83, 0, 0.17, 1) | 4800ms | rotateY 18°→0° rotateX 6°→0° + scale 1→1.4 + focal point shift |
| PR body 内文聚焦 | 800ms | easeOutQuart | 6500ms | blur 12px→0 + opacity 0.6→1 |

**转场到 S9**

- **类型**：**Match Cut**（PR body 末尾的 NEED_HUMAN list 匹配 S9 SessionsList 末态）
- **时长**：12 帧 @ 60fps（200ms）
- **缓动**：linear（match cut 本身就是视觉匹配）
- **附加**：把 PR body 里的 "24 NEED_HUMAN" 这行文字在 S8 末帧和 S9 首帧位置完全对齐，制造无缝感

**文字 / 数字动画**

- PR chip 文字 "PR #6 opened"：Söhne Breit Halbfett 20px `#EDEDED` · 入场 mask reveal 上→下 300ms
- chip 内 octocat icon：1px stroke `#EDEDED`，入场 200ms scale 0.8→1
- PR URL 字幕 "github.com/anzy-renlab-ai/agent-game-platform/pull/6" Berkeley Mono 24px `#8A8A8A` · 1:35 mask reveal 左→右 600ms 出现，常驻到 1:43

**音频**

- 1:33 chip 弹出：一记 ping (C07) glass tap G5 180ms
- 1:35 全屏化：低频 whoosh + bell C5 220ms
- 1:38 dolly-in：一记 "tape rewind" reverse sweep 800ms（高级感）
- 1:40 focus 聚焦：一记 soft click + 配乐回到主旋律 mid
- 旁白：1:34 中文 "不是建议清单。" / 1:38 "是真的 PR。" · 英文 "Not a checklist." / "A real pull request."

**调色 / 视觉**

- LUT: "ZeroU Mono v1"，PR 截屏区域 +5% saturation（让 GitHub 绿 / 紫 chip 略显眼但不刺）
- Grain: 14
- Bloom: chip 入场 intensity 0.55；浏览器窗 isometric 时 intensity 0.4
- Real lens blur: 1:38 推近时景深效果，远景模糊 12px

**风格 / 镜头**

- 拍摄方向：cinematic / WWDC product montage 风
- 帧率：60fps（推近必须丝滑）
- 摄像头模拟：从 chip 推近到 isometric browser，再 dolly-in 到正面，是连续 3 段 camera 路径

**可执行实现路径**

1. Playwright 录 GitHub PR #6 真页面 1440p × 10s（A12）
2. AE 中导入 A12 作为 Texture，映射到 C4D Lite 的 Plane
3. C4D Lite Camera 做 3 段 motion path（chip→isometric→dolly-in）
4. AE Real Lens Blur 加景深
5. ZBrush 不需要；纯 C4D Lite + AE 即可
6. chip 入场用 Shape Layer + spring expression
7. ProRes 422 HQ

**真 / Mock**

- REAL — PR 页面 100% 真录屏 PR #6
- chip 入场动画 + isometric 倾斜 + dolly-in 是 C4D + AE 合成

---

### 镜头 9 [1:43 – 1:50 · 7s] — NEED_HUMAN 列表（**M5 升级 part 2**）

**视觉描述**（≥100 字）

切回 ZeroU app 全屏，SessionsList 末态（A11）。顶部双绿徽章："preset 8/28 done" Berkeley Mono 28px `#7CFFB2` + "vision verdict NO（pending human）" Berkeley Mono 28px `#FFB23B`。下方 NEED_HUMAN 列表横向无限滚动 6+ 卡片：`ci-pipeline-missing` / `license-file-missing` / `auth-password-recovery` / `db-backup-path` / `ui-empty-states` / `vision-social-features-unverified`。每张卡 320×140 px，卡面 `#121214` + 1px border `#1F1F22`，右侧 "Hand off" 按钮 Söhne Buch 14px `#7CFFB2` + 微微 pulse glow 2s loop。卡片以 60 px/s 速度向左 marquee，无限循环。1:48 整体镜头开始 zoom-out 4%，准备进 CTA。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| 顶部徽章入场 | 500ms 每个 | easeOutQuart | 0 / 200ms（错位） | translateY -20→0 opacity 0→1 + mask reveal 左→右 400ms |
| NEED_HUMAN 卡片整列入场 | 700ms | cubic-bezier(0.22, 1, 0.36, 1) | 500ms | translateX +200→0 opacity 0→1 |
| 横向 marquee | 6000ms loop | linear | 1500ms | translateX 0 → -1920px loop |
| Hand off 按钮 pulse | 2000ms loop | easeInOutSine | 0ms | @0% glow 4px @0.3 · @50% glow 12px @0.5 · @100% glow 4px @0.3 |
| 末尾 zoom-out | 800ms | easeInOutCubic | 5500ms | scale 1→0.96 + opacity 1→0.85 |

**转场到 S10**

- **类型**：**Dip to Black + Bloom Fade**
- **时长**：18 帧 @ 60fps（300ms）
- **缓动**：easeInOutCubic
- **方向**：scene → black → CTA
- **附加**：dip to black 中段叠 8% white bloom（仅 2 帧），制造"曙光"感

**文字 / 数字动画**

- 徽章 "preset 8/28 done"：Berkeley Mono 28px `#7CFFB2` glow 6px
- 徽章 "vision verdict NO"：Berkeley Mono 28px `#FFB23B` glow 6px
- 卡片标题：Söhne Buch 18px `#EDEDED` · letter-spacing 0.2px
- "Hand off" 按钮：Söhne Buch 14px `#7CFFB2`
- 字幕 1:44 "24 items handed back · merger paused" Berkeley Mono 22px `#8A8A8A` · mask reveal 左→右 500ms

**音频**

- 1:43 切入：一记 soft "tab" 200ms
- 配乐进 mid 密度收尾，鼓点开始衰减
- 1:48 zoom-out 同时一记 reverse cymbal 700ms
- 1:49.7 dip to black：完全静音 0.3s
- 旁白：1:44 中文 "剩下 24 件，它知道自己不该做。" / 1:48 "这种事留给你。" · 英文 "The other twenty-four?" / "It knows when to stop and ask."

**调色 / 视觉**

- LUT: "ZeroU Mono v1"
- Grain: 14
- Bloom: 0.3（收敛）
- Vignette: 16%（向 CTA 过渡）

**风格 / 镜头**

- 拍摄方向：documentary / pacing-down
- 帧率：60fps
- 摄像头模拟：static + 末尾 pull-back

**可执行实现路径**

1. Playwright 录 SessionsList 末态 7s（A11）
2. AE 中加横向 marquee（layer position expression `time * 60 % width`）
3. 顶部徽章用 Shape Layer + SplitType reveal
4. Hand off pulse 用 expression `value + sin(time*PI)*0.2`
5. Zoom-out 用 transform scale keyframe
6. ProRes 422 HQ

**真 / Mock**

- REAL — SessionsList、徽章、NEED_HUMAN 24 条全部真 fixture
- marquee + pulse 是 AE 后期合成

---

### 镜头 10 [1:50 – 1:53 · 3s] — CTA

**视觉描述**（≥100 字）

切全黑 `#0A0A0B`。1:50.3 中心淡入 ZeroU 字母 logo，Söhne Breit Halbfett 240px / `#EDEDED` / letter-spacing 8px，伴随 mask reveal 从中心向两侧展开。1:51 下方一行 Söhne Buch 36px `#EDEDED` "Drop in a demo. Wake up to a product." mask reveal 左→右 600ms。再下方 Söhne Breit Halbfett 120px `#EDEDED` URL "ZeroU.dev"，mint mint underline 4px 从左到右 stroke 800ms 同步出现，配合 underline 末端一记 mint glow pulse。右下角 Berkeley Mono 18px `#8A8A8A` 三行小字 "Built on Claude" / "git-native" / "open source"。1:52.8 整体保持 0.2s 然后单 pad sustain 衰减到完全静音 + 黑场淡出。

**精确动画曲线**

| 元素 | duration | easing | delay | 关键帧 |
|---|---|---|---|---|
| Logo 字母 mask reveal | 800ms | cubic-bezier(0.22, 1, 0.36, 1) | 300ms | mask center → outward + opacity 0→1 |
| Tagline 入场 | 600ms | easeOutQuart | 1100ms | mask reveal left→right + opacity 0→1 |
| URL "ZeroU.dev" + underline stroke | 800ms | cubic-bezier(0.65, 0, 0.35, 1) | 1700ms | mask reveal + underline stroke 0→100% |
| Underline mint pulse | 600ms | easeInOutSine | 2500ms | glow 0→16px→4px |
| 右下角小字 | 500ms | easeOutQuart | 2000ms | stagger 100ms · opacity 0→1 |
| 最终淡出黑场 | 500ms | easeInQuart | 2700ms | opacity 1→0 |

**转场到 End**

- 最终淡出黑场后保留 0.3s 静帧（视频文件末尾留白）

**文字 / 数字动画**

- Logo: Söhne Breit Halbfett 240px `#EDEDED` letter-spacing 8px · 入场 mask center reveal · drop shadow `0 4px 20px rgba(124,255,178,0.18)`
- Tagline: Söhne Buch 36px `#EDEDED`
- URL: Söhne Breit Halbfett 120px `#EDEDED` + mint underline 4px `#7CFFB2`
- 三行 corner text: Berkeley Mono 18px `#8A8A8A`

**音频**

- 配乐 outro 80 BPM 单 pad C2 sustain 从 mid → -32 LUFS 持续衰减
- 1:51 一记 mint chime + 一记 long reverse cymbal 1.5s
- 1:52 URL underline stroke 完成：一记 soft "tap" + bell C5 short
- 1:52.8 完全衰减到静音
- 旁白：1:51 中文 "ZeroU 点 dev。" · 英文 "ZeroU dot dev."（极简，留白）

**调色 / 视觉**

- LUT: "ZeroU Mono v1"
- Grain: 18（结尾略提升，电影感）
- Bloom: logo 区域 intensity 0.5；underline 区域 intensity 0.7
- 无 vignette（CTA 卡需要清爽）

**风格 / 镜头**

- 拍摄方向：cinematic minimal / Apple WWDC outro 风
- 帧率：24fps（与开头 S1 呼应）
- 摄像头模拟：完全 static，让 typography 自己说话

**可执行实现路径**

1. AE Shape Layer 绘 logo（或 import SVG）
2. AE mask + reveal expression
3. URL underline 用 Trim Paths
4. mint glow 用 Outer Glow effect
5. 直接 export ProRes 422 HQ

**真 / Mock**

- MOCK — 全 AE 合成

---

## 3. Voiceover Script（双语完整版）

### 3.1 录音指导

| 项 | 中文版 | 英文版 |
|---|---|---|
| 推荐声线 | 男中音 · 32-42 岁 · 沉稳 · 略带笃定 | British male · 28-38 岁 · calm authority · slight rasp |
| 语速 | 240 syl / min | 180 wpm |
| 节奏 | 每句 ≤15 字 · 句间 0.4-0.8s 停顿 | each line ≤20 syllables · 0.5-0.9s pause |
| 录音环境 | 全消声室 · Neumann TLM 103 · pop filter | 同左 |
| 后期处理 | de-ess 4-6kHz -3dB · gentle compress 3:1 · subtle plate reverb 8% | 同左 |
| 不要 | 不要 hype 不要笑声 不要呼吸过重 | no hype, no laugh, breath cleanup |

### 3.2 中文版完整旁白（10 句对应 10 镜头）

| 时间码 | 文案 | 字数 | 备注 |
|---|---|---|---|
| 0:01 – 0:04 | "你扔进去一个 demo。" | 8 | 留白 0.6s 后接下一句 |
| 0:04 – 0:07 | "一觉醒来，它是个产品。" | 10 | S1 收尾 |
| 0:09 – 0:12 | "demo 永远停在 demo。" | 9 | S2 头 |
| 0:13 – 0:17 | "十件该做的事，没一个人做。" | 12 | S2 尾 |
| 0:19 – 0:22 | "不写 PRD。" | 4 | S3 头 |
| 0:24 – 0:27 | "你只回答 A 还是 B。" | 9 | S3 中 |
| 0:37 – 0:40 | "它先认出这是个 SaaS。" | 10 | S4 头 |
| 0:42 – 0:46 | "然后照单子挑出 26 件没做的事。" | 14 | S4 尾 |
| 0:49 – 0:53 | "六个 agent 各管一段。" | 10 | S5 头 |
| 0:54 – 0:58 | "看牌的是你，洗牌的是它们。" | 12 | S5 尾 |
| 1:02 – 1:05 | "过不了就退回去。" | 7 | S6 头 |
| 1:09 – 1:12 | "它对自己比你严。" | 7 | S6 第二轮前 |
| 1:21 – 1:25 | "一小时三十一分钟。" | 9 | S7 头 |
| 1:27 – 1:30 | "四块二毛四。" | 5 | S7 尾 |
| 1:34 – 1:37 | "不是建议清单。" | 6 | S8 头 |
| 1:38 – 1:41 | "是真的 PR。" | 5 | S8 尾 |
| 1:44 – 1:47 | "剩下 24 件，它知道自己不该做。" | 13 | S9 头 |
| 1:48 – 1:50 | "这种事留给你。" | 6 | S9 尾 |
| 1:51 – 1:52.5 | "ZeroU 点 dev。" | 6 | S10 |

### 3.3 英文版完整旁白

| 时间码 | Line | 音节 | 备注 |
|---|---|---|---|
| 0:01 – 0:04 | "Drop in a demo." | 4 | 留白后接 |
| 0:04 – 0:07 | "Wake up to a product." | 6 | |
| 0:09 – 0:12 | "Demos stay demos." | 4 | |
| 0:13 – 0:17 | "The boring ten percent never ships." | 9 | |
| 0:19 – 0:22 | "No PRD." | 2 | |
| 0:24 – 0:27 | "Just A, B, or C." | 5 | |
| 0:37 – 0:40 | "Auto-detected: SaaS web." | 7 | |
| 0:42 – 0:46 | "Twenty-six gaps to close." | 7 | |
| 0:49 – 0:53 | "Six agents, one assembly line." | 8 | |
| 0:54 – 0:58 | "You watch. They build." | 5 | |
| 1:02 – 1:05 | "Failed audit? Roll back." | 6 | |
| 1:09 – 1:12 | "Try again. Sixty-one times if it takes." | 11 | |
| 1:21 – 1:25 | "One hour, thirty-one minutes." | 7 | |
| 1:27 – 1:30 | "Four dollars, twenty-four." | 6 | |
| 1:34 – 1:37 | "Not a checklist." | 4 | |
| 1:38 – 1:41 | "A real pull request." | 5 | |
| 1:44 – 1:47 | "The other twenty-four?" | 5 | |
| 1:48 – 1:50 | "It knows when to stop and ask." | 8 | |
| 1:51 – 1:52.5 | "ZeroU dot dev." | 4 | |

---

## 4. Music Cue Sheet

| 段 | 时间 | BPM | Mood | Track Reference | Density | LUFS Target |
|---|---|---|---|---|---|---|
| intro | 0:00 – 0:18 | 80 | sleepy, anticipation | Artlist "Minimal Pad Sunrise" / Epidemic "Quiet Beginning" | low (pad + 1 piano note) | -22 |
| buildup-1 | 0:18 – 0:35 | 95 | curious, clean | Artlist "Tech Grid Build 95bpm" | mid (typewriter + hi-hat 1/8) | -18 |
| buildup-2 | 0:35 – 0:48 | 105 | confident march | Artlist "Geometric Pulse 105" | mid-high (kick + snare) | -16 |
| pre-drop | 0:48 – 1:00 | 105 | orchestrate | Artlist "Subagent Assembly" (or "Studio Move 105") | high (full drums) | -15 |
| tension | 1:00 – 1:13 | 105 → 90 (decel) | dread, glitch | Epidemic "Cinematic Dark Sting" + reverse riser | high → low spike | -12 peak sting / -22 dead zone |
| drop / climax | 1:13 – 1:33 | 110 | victory march | Artlist "Synth Wave Climax 110" | full (drums + bass + lead) | -14 |
| descent | 1:33 – 1:48 | 105 → 95 | satisfied, declarative | Artlist "Soft Synth Outro Build-down" | mid (drum simplifies) | -16 |
| outro | 1:48 – 1:53 | 80 | wake-up, calm | Artlist "Warm Pad Sunrise C" (C09) | low (pad sustain only) | -22 → silent |

### Sting / SFX 时间码

| 时间 | SFX | 说明 |
|---|---|---|
| 0:03 | Sub bass 30Hz thump 200ms | folder 吸入命中 |
| 0:04 – 0:07 | 6× soft click | 时钟跳 |
| 0:07.5 | Piano C5 single note | S2 预备 |
| 0:10 – 0:17 | 4× low thump 80Hz | 4 张 NOT_SHIPPED 卡片 stamp 砸下 |
| 0:18 + 每 1.7s | Selectric typewriter click | S3 vision.md typewriter（per 4-th char） |
| 0:24 | Soft tap 1.2kHz | S3 选项卡 A 选中 |
| 0:35 | Long sweep 200→1000Hz | S4 detector 自旋 |
| 0:38 – 0:43 | 32× analog click 880Hz | S4 棋盘格扫描 + S7 翻绿（**注意 S7 也用这个 SFX 但 stagger 不同**） |
| 0:48 – 0:54 | 6× mid-tom 200Hz | S5 6 张 agent 卡片亮起 |
| 0:54 | Drum fill (0.8s) | S5 第 6 张落定 |
| 1:00 – 1:06 | 3× bell C5 | S6 前 3 gate 绿勾 |
| 1:07 | Build-up rumble 30Hz | S6 红光前奏 |
| 1:07.6 | **Cinematic impact sting** (C03) | **M2 红光峰值** |
| 1:08 | Reverse swoosh (C04) | M2 rollback |
| 1:09 – 1:12 | 死寂 1.5s | 紧张留白 |
| 1:14 | Victory ping + bell C7 | 第二轮全绿 |
| 1:18 | Sub bass + crash | S7 进入 climax |
| 1:18 – 1:32 | 32× analog click 880Hz（鞭子 stagger） | S7 preset 翻绿 |
| 1:21 / 1:24 / 1:27 / 1:30 | 4× bell C5 (C06) | 4 个 commit sha 落定 |
| 1:32 | Mint chime + sweep 800→4kHz | S7 particle burst |
| 1:33 | Glass ping G5 (C07) | S8 PR chip |
| 1:35 | Low whoosh + bell | chip 全屏化 |
| 1:38 | Reverse tape sweep 800ms | dolly-in 推近 |
| 1:48 | Reverse cymbal 700ms | S9 zoom-out |
| 1:49.7 – 1:50 | 完全静音 0.3s | dip to black |
| 1:51 | Mint chime + reverse cymbal 1.5s | S10 logo |
| 1:52 | Soft tap + bell C5 | S10 URL underline 完成 |
| 1:52.8 – 1:53 | Pad sustain → 静音 | outro |

---

## 5. Color Grading Notes

### 5.1 主 LUT "ZeroU Mono v1"

| 参数 | 值 |
|---|---|
| Black point | RGB(10, 10, 11) `#0A0A0B`（提 4 个 IRE 不到纯黑） |
| White point | RGB(237, 237, 237) `#EDEDED`（压 7 个 IRE 不到纯白） |
| Saturation | 60%（全片基调，强 mono） |
| Hue shift | 整体 +2° toward cyan |
| Shadow tone | Split toning toward teal `#2A4A50` 强度 18% |
| Highlight tone | Split toning toward mint `#A8FFD0` 强度 12% |
| Bleach Bypass | 25% 浓度（提高 luminance 对比、压低 saturation 局部） |
| Contrast curve | S-curve 中等 · 0.25 lift / 0.85 gamma / 1.10 gain |
| Saturation curve | sat-vs-sat 中段+8% / 高 sat 段-15%（防过饱和） |

### 5.2 备用 LUT "ZeroU Alert"（仅 S6 红光段）

| 参数 | 值 |
|---|---|
| Red channel | +30 luminance |
| Green channel | -15 saturation |
| Blue channel | -10 saturation |
| Contrast | S-curve 强 0.35 / 0.75 / 1.20 |
| Grain | +8 over base |
| Vignette | +12% over base |

### 5.3 关键镜头微调

| 镜头 | 微调 |
|---|---|
| S1 | 夜→晨 gradient 用单独 hue rotation 跨 4s，让背景颜色变化在 LUT 之后做 |
| S3 | vision.md 区域单独 +5% saturation in mint hue |
| S4 | 圆点 mint 区域 +8% saturation；扫描线区域加 +15% bloom |
| S6 | 红光段全屏切 "ZeroU Alert" LUT；峰值 1 帧 invert + RGB split |
| S7 | mint 区域 +12% saturation（全片最饱和瞬间）；1:30 加 mint light leak 8% |
| S8 | PR 截屏区域 +5% saturation（让 GitHub UI 略显眼） |
| S10 | logo + URL 加 drop shadow mint glow 24px |

### 5.4 颗粒度 (Grain Intensity)

| 镜头 | Grain (0-100) |
|---|---|
| S1 | 18 |
| S2 | 22 |
| S3 | 16 |
| S4 | 14 |
| S5 | 14 |
| S6 | 24 |
| S7 | 12 |
| S8 | 14 |
| S9 | 14 |
| S10 | 18 |

### 5.5 后期 stack 顺序

`Source` → `Denoise (light, only on录屏)` → `Primary LUT (ZeroU Mono v1)` → `Secondary corrections (per-shot)` → `Bloom` → `Chromatic Aberration (微量 0.3px corners)` → `Grain` → `Vignette` → `Output`

---

## 6. Editor's Cheat Sheet（贴墙速查表）

```
┌──────────────────────────────────────────────────────────────────────┐
│  ZeroU 2min Demo · Production Cheat Sheet                            │
├──────────────────────────────────────────────────────────────────────┤
│  TOTAL: 113s · 60fps · 4K · LUFS -14 · Söhne / Berkeley Mono         │
├──────────────────────────────────────────────────────────────────────┤
│  HARD CONSTRAINTS（不能改）                                          │
│  - 真数据: 1h31min · $4.24 · 454k+238k tok · 24 NEED_HUMAN · attempt 3│
│  - 真 sha: 5aedd6e / 4b58841 / 3d2ad5f / 53df272                     │
│  - 真 PR: github.com/anzy-renlab-ai/agent-game-platform/pull/6       │
│  - Accent: #7CFFB2 mint · Alert: #FF3B3B (M2 only)                   │
│  - 不用 emoji · 不用"未来感/颠覆/革命"空话                            │
├──────────────────────────────────────────────────────────────────────┤
│  WOW MOMENTS 时间码                                                  │
│  M4 vision.md morph    0:18 – 0:35                                   │
│  M1 SessionsBoard 6   0:48 – 1:00 (stagger 110ms)                    │
│  M2 Adversarial 红光   1:07.6 (cinematic sting + glitch)              │
│  M3 Preset 32 鞭子     1:18 – 1:32 (stagger 60ms whip curve)         │
│  M5 PR chip → GitHub  1:33 – 1:43 (isometric → dolly-in)             │
├──────────────────────────────────────────────────────────────────────┤
│  节拍切点（必须在这些时间精确切镜）                                  │
│  0:08 · 0:18 · 0:35 · 0:48 · 1:00 · 1:18 · 1:33 · 1:43 · 1:50 · 1:53 │
├──────────────────────────────────────────────────────────────────────┤
│  EASING 速查                                                         │
│  spring 弹性     → spring(180-240, 16-22)                            │
│  Apple-style 入场 → cubic-bezier(0.22, 1, 0.36, 1)                   │
│  快进慢出         → cubic-bezier(0.83, 0, 0.17, 1)                   │
│  Overshoot       → cubic-bezier(0.34, 1.56, 0.64, 1)                 │
│  Linear 扫描线    → linear                                            │
├──────────────────────────────────────────────────────────────────────┤
│  TRANSITION 速查                                                     │
│  S1→S2 Linear Wipe 90° 200ms (bottom→top)                            │
│  S2→S3 Whip Pan + Motion Blur 233ms                                  │
│  S3→S4 Mask Wipe center 300ms                                        │
│  S4→S5 Cross Dissolve 266ms + 1 帧 mint flash                        │
│  S5→S6 Glitch Cut 100ms + RGB split + 1 帧黑                         │
│  S6→S7 Linear Wipe 90° + green glow 366ms                            │
│  S7→S8 Zoom Punch + Particle Persistence 233ms                       │
│  S8→S9 Match Cut on "24 NEED_HUMAN" 200ms                            │
│  S9→S10 Dip to Black + Bloom Fade 300ms                              │
├──────────────────────────────────────────────────────────────────────┤
│  AUDIO HOT POINTS                                                    │
│  1:07.6 → CINEMATIC IMPACT STING (full -12 LUFS peak, 100ms attack)  │
│  1:09 – 1:12 → 1.5s DEAD AIR (pad residual only)                     │
│  1:32 → particle chime + bell C5                                     │
│  1:49.7 – 1:50 → 0.3s 完全静音                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Variants

### 7.1 60s 速剪版（投资人 pitch + Twitter）

总长 60s · 删 / 压缩地图：

| 原镜头 | 新时长 | 处理 |
|---|---|---|
| S1 Hook | 5s (-3s) | 缩短 cursor 移入，直接进 folder 吸入 |
| S2 问题 | 4s (-6s) | 删除 4 张卡片漂浮 → 只显示 1 张 + stamp 砸下 |
| **S3 Vision** | 8s (-9s) | 删除三轮中第一轮，从第二轮直接进；morph 保留 |
| S4 detector + preset | 6s (-7s) | 删除 detector 自旋，直接 preset 扫描 + GapList 数字 |
| **S5 SessionsBoard** | 7s (-5s) | 6 卡片 stagger 改 70ms（更快），不展示 log 内容 |
| **S6 Adversarial** | 9s (-9s) | **保留红光 sting + rollback**，但删除前 3 gate 绿勾过程，直接进 M2 |
| **S7 Preset 翻绿** | 8s (-7s) | 鞭子 stagger 改 40ms（更快），不展示 4 sha 逐个落定，只在末尾闪 |
| S8 PR chip | 6s (-4s) | 删除 isometric 段，直接 chip 弹出 → GitHub PR 推近 |
| S9 NEED_HUMAN | 4s (-3s) | 只展示双绿徽章 + 1 行 marquee |
| S10 CTA | 3s | 保持原状 |
| **合计** | 60s | |

变体差异：
- 跳过 detector 镜头（节省 4s）
- M2 / M3 / M5 三个 wow moment 必保留（吸引力核心）
- 投资人切片对话节奏可加快 1.15x，pitch 场景需要密度

### 7.2 30s 病毒切片（grab list · 5 个）

| 切片 ID | 时间段 | 内容 | 适合平台 | Hook 句 |
|---|---|---|---|---|
| **Viral-1: Wake Up** | S1 + S10 拼接 | "Drop a demo" → "Wake up to a product" 头尾呼应 | Twitter / X | 把 demo 丢进去，醒来是个产品 |
| **Viral-2: M2 红光** | S6 完整 | Reviewer 自我否决 + rollback + 第二轮全绿 | LinkedIn / Twitter | 它对自己比你严：61 次重试 |
| **Viral-3: M3 32 翻绿** | S7 完整 + 末尾 cost stamp | Preset 棋盘格鞭子翻绿 + \$4.24 + 1h31min | Twitter / TikTok | 1h31min · \$4.24 · 32 项任务 |
| **Viral-4: M5 PR 落地** | S8 完整 + S10 | PR chip → GitHub PR 推近 → CTA | Twitter / LinkedIn | 不是建议清单，是真的 PR |
| **Viral-5: M1 集群** | S5 完整（拉伸到 18s） | 6 个 agent 流水线 stagger | YouTube Shorts | 6 个 agent，一条流水线 |

每个切片附带：
- 中文字幕 burned-in（病毒切片必须有字幕，无需声音也能看懂）
- 末尾 2s 固定 CTA 卡："ZeroU.dev"
- 9:16 竖版重剪：把 16:9 素材中心 cropped + reframed

### 7.3 切片技术备注

- 30s 切片字幕 burn-in：Söhne Breit Halbfett 48px @ 1080p 竖版，居中底部，距底边 200px
- 字幕背景：黑色 80% opacity 圆角 8px 内边距 16px（保证可读性）
- 末尾 CTA：保持主版的 ZeroU 字 logo + URL "ZeroU.dev"
- 不带原版旁白时配纯音乐 + sound design

---

## 附录 · 视频剪辑师执行链

**第 1 阶段（资产采集）：**
1. Playwright 录所有真组件（A01-A12，共 12 段录屏）→ 单独存 `assets/raw/`
2. 录制 PR #6 真页面 1440p
3. 准备字体 / LUT / 音乐 / SFX 库

**第 2 阶段（合成块）：**
4. AE 项目模板按 10 个镜头建 10 个 comp
5. 每个 comp 按 §2 storyboard 实现动画曲线
6. 关键 wow moment 单独工作流：
   - M1 SessionsBoard：spring expression + diagonal glow
   - M2 Adversarial：DaVinci Fusion glitch + chromatic aberration
   - M3 Preset 鞭子：per-cell stagger expression
   - M4 vision.md morph：Shape Layer path morph
   - M5 GitHub isometric：Cinema 4D Lite camera

**第 3 阶段（剪辑组接）：**
7. Premiere/Resolve 主时间线：按节拍切点（0:08 / 0:18 / 0:35 / 0:48 / 1:00 / 1:18 / 1:33 / 1:43 / 1:50 / 1:53）放置
8. 实现 §2 中每个转场（cross dissolve / whip pan / mask wipe / glitch cut / linear wipe / zoom punch / match cut / dip to black）

**第 4 阶段（音频）：**
9. 录制旁白（中文 + 英文双版本）
10. 配乐分段（intro / buildup / climax / outro）按 §4 cue sheet 摆放
11. SFX 精确摆点（按 §4 stinger 表），关键 1:07.6 红光 sting 必须精准

**第 5 阶段（调色）：**
12. 应用 "ZeroU Mono v1" 主 LUT
13. 每镜头 secondary corrections（§5.3）
14. Grain / Bloom / Vignette stack（§5.5）

**第 6 阶段（输出）：**
15. 主交付 H.265 4K @ 60fps · ProRes 422 HQ 母版
16. 网页版 H.264 FHD @ 60fps
17. 60s 速剪版 + 5 个 30s 病毒切片（§7）
18. 横版 / 竖版 / 方版三规格输出

**第 7 阶段（QC）：**
19. LUFS / True Peak 校验
20. 字体渲染检查（不同播放器）
21. 节拍切点精度验证（每个切点必须在 BPM 网格上）
22. wow moment 时间码硬验证：M1@0:48 / M2@1:07.6 / M3@1:18-1:32 / M4@0:18-0:35 / M5@1:33-1:43
