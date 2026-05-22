# d2p 产品理论假设书 (v0.7 — Round 2 grill 后)

> v0.7 修订自 v0.6。改动来自 Round 2 三个 adversarial subagent：red team / 失败模式找寻者 / 邻域 collapse 分析。
> Round 2 揭出 10 处新 P1，承重墙问题（v0.6 没动到）。v0.7 修：经济模型自洽性 / 大厂分层 / dogfood 工程化 enforce / 红线 governance / 数字诚实。
> 总 falsifier 12 条带时间表。

---

## 0. 状态 + 收敛性

**Round 1 → v0.6**: 修学术 hygiene 11 处 (academic foundation 引用), cosmetic 完成。
**Round 2 → v0.7**: 修承重墙 10 处 (经济模型、governance、工程化、大厂分层)。
**Round 2 未收敛**: 新 P1 数量与 Round 1 不重叠——每轮挖新维度。Round 3 候选 POV：end-user / 法律合规 / 5 年后讣告 / 哲学家。**是否再跑 Round 3，建议见 §13**。

**v0.7 整体诚实度跳跃**: 从 "看起来严谨" 到 "明示承重墙未 measured + governance 待落地"。

---

## 1. 身份 — 3 问

### Q1.1 一句话讲清楚 d2p。

**A**: AI 时代的测试程序员。AI 写代码越来越快，但写出来能不能用还要测试程序员判——d2p 把这个测试程序员自动化了。

**caveat (从 v0.6 保留)**: "测试程序员" persona 在 agile 时代被 *whole-team approach* dissolve。更精确 framing: **"自动化嵌进 dev loop 的 QA function"**，不是 "复活独立 QA 角色"。顶层 punchline 仍用前者（大众易懂），技术细节走下层。

---

### Q1.2 跟 cc / Cursor / Devin 啥区别？

**A**: 他们代替**开发者**，d2p 代替**测试程序员**。两个不同角色。开发者继续用 cc / Cursor 写代码，d2p 做独立第三方 QA。两个叠加 = full team。

**foundation (v0.6 修)**: 真正理论祖父是 **Knight-Leveson 1986** *"An Experimental Evaluation of the Assumption of Independence in Multiversion Programming"* (IEEE TSE 12(1):96-109, <https://ieeexplore.ieee.org/document/1702342>)——证独立开发多版本程序失败 statistically 相关。这是 cross-engine reviewer 的理论祖父。

---

### Q1.3 跟 TestSprite / Mabl / Specmatic / Kiro / Spec Kit 啥区别？

**A**: 他们要用户**先写 spec**，d2p **不要**。d2p 只要 demo + vision，严格 spec 由系统造。

**🔧 v0.7 加 caveat (邻域 collapse #6 + #2)**: 这条差异化的**护城河窗口只剩 6-9 个月**——AWS Kiro 在 2026 Q1 ship "demo → spec inference" 概率 70%；GitHub Spec Kit 是 OSS 社区随时 PR。**v0.7 显式承认**: 单"自造 spec"这一条不够护城河，要靠多条 redundant 差异化（agent agnostic + 本地 + 不持 key + 真 cross-engine + 自造 spec）**叠加**才形成 niche moat。任一掉了不致命，全部掉了 d2p 死。

新 falsifier F11 锁这条 (见 §11)。

---

## 2. 定位 — 3 问

### Q2.1 🔧 v0.7 重写: SAM / TAM 数字到底是什么？

**v0.5 写 "$2.41T TAM"** → Round 1 学术 audit + VC P1 攻击为 TAM 膨胀。
**v0.6 写 "5-10 万 power user, SAM in dollar = $0"** → Round 2 red team R1 攻击为 GIGO 套娃（"50-100 万 base × 5-10% conversion" 两个乘数都是猜的）。

**v0.7 修订**: **承认 SAM 无法精确估算**。

**已知 facts**:
- CISQ 2022 美国软件质量差损失上限 ~$2.41T（社会成本，非市场容量）。Krasner 切片 testing/QA-related ~$0.6T。
- GitHub Copilot 2025 报 2000 万付费用户（Microsoft 财报）。Cursor 2026 Q1 估 100 万付费（无 verified primary）。
- d2p 服务的子集：在乎 agent agnostic + 反 vendor-lock + 本地 + OSS——**数量未知**。
- 大厂 PM 估算 "5-10 万 global power user"，但**Round 2 R1 承认这是 GIGO**——大厂 PM 看自家 telemetry，看不到 d2p 想触达的反 vendor-lock 部落。

**真实 SAM 估算结论**: **我们不知道**。

操作: 不在 marketing material 写具体 SAM 数字。Walking skeleton 跑通后 instrument anonymous opt-in counter（如果用户允许），3 个月内给真实 active install 数。在那之前 **任何 SAM claim 都是 work of fiction**。

**这条 honest framing 比给假数字更值钱**——VC 听了会 pass 是好事（d2p 本来不收 equity 见 §4.1）。

---

### Q2.2 AI 写的代码 AI 自己测不行吗？

**A**: 不行。基础 foundation: Knight-Leveson 1986 N-version 独立性失败（Q1.2 已引）。

操作: d2p reviewer pipeline 4 层每层换 model + 换 prompt frame。**但降低多少 fault correlation 未实测**（见 Q3.1 ablation）。

---

### Q2.3 🔧 v0.7 重写: LLM 越来越强 d2p 不就被淘汰了？

**v0.5**: monotonic "LLM 越强 d2p 越值钱"——学术 audit P1。
**v0.6**: conditional + "18-24 月 leverage 窗口"——Round 2 R2 攻击窗口数字凭空。

**v0.7 修订**:

**窗口长度未知**。

- doc 2 §10.2 SWE-agent 证明在当前 (2025-2026) frontier model 下 ACI > model — 是 single empirical observation, 不是 trend prediction。
- 历史 prior 模糊: AutoGPT pattern → 被原生 LLM 吸收用了 ~18 月（GPT-3.5 → GPT-4 期）; SWE-agent ACI → cc/Claude Code 内置类似 harness 用了 ~9 月。**没有统一数字**。
- **Sutton "Bitter Lesson"** (<http://www.incompleteideas.net/IncIdeas/BitterLesson.html>) 是反向 prior——历史上 model-centric 长期胜 system-centric。
  - **为什么 d2p 这次可能例外** (v0.7 加辩护)：Bitter Lesson 适用于 *ML research 中长期算法竞争*；d2p 处在 *已 commodity LLM 上的工程封装层*，跟 Bitter Lesson 描述的对象不同。但这条辩护**未经验证**，可能错。

**v0.7 操作**: 不押注具体窗口长度。所有 hypothesis 6 个月内 measure（见 §11 falsifier 时间表）。如果 6 个月内任何 F1-F12 触发 → 不论窗口长短，hypothesis 重写。

---

## 3. 技术 — 5 问

### Q3.1 🔧 v0.7 重写: 4 层 reviewer 凭啥 + 默认 cross-engine?

**v0.6 留下问题** (Round 2 R9 P2): Littlewood-Miller 1989 承认 N-version diversity 收益**递减且强依赖 fault correlation** — 但 MVP-0 默认 `claude --model X -p` 全 Claude，**fault correlation 极高，4 层 diversity 收益接近 0**。

**v0.7 修订: MVP-0 强制 cross-engine**。

具体规则:
- Layer 1 (static gate): deterministic 工具，无 LLM
- Layer 2 (alignment probe): **必须用与 Layer 3 不同 family 的 model**——例如 Layer 2 用 Claude Haiku，Layer 3 用 GPT-4o-mini 或 Gemini Flash
- Layer 3 (behavioral): preset runner，无 LLM 判定
- Layer 4 (adversarial): **必须用与 Layer 2 不同 family**

意味着 MVP-0 用户**至少需要 2 家 LLM provider 凭证**。这跟 §9 红线 4 "不持 API key" 不冲突——用户在自己 cc / Codex CLI / Gemini CLI 各自登录。

**对 Q4.3 大厂抄袭分析的影响**: cross-engine 不再只是 marketing claim，是 MVP-0 default。**Anthropic 同款必无法做真 cross-engine**（不愿调 GPT 当 reviewer），d2p 的护城河有了具体工程依据。

**承认弱点**: 这条增加 MVP-0 onboarding friction（用户要登 2 家）。Walking skeleton 阶段先证可行性，UX 优化在 MVP-1+。

---

### Q3.2 vision verdict 是 LLM 判 LLM 输出，不自欺欺人吗？

**A** (v0.6 已修): 部分是。三条防御 (cross-engine + 不单独成立 + 学术诚实承认 Salay 2017 反对方)。

操作 (v0.7 加锐): MVP-0 cross-engine default (Q3.1 改) 直接落地这条防御的工程实现，不是 promise。

---

### Q3.3 不让用户审 diff，trust 怎么来？

**A** (v0.6): trust by checkable transparency（不是 by faith）。dashboard query reviewer 决策 raw output。

**FAANG Q1 / 场景 3 加锐**: dashboard-as-primary-UI 跟 PR-anchored 工作流冲突。

**🔧 v0.7 提前到 MVP-0.5**: PR-comment / GitHub status-check 集成 (原 MVP-1)。理由：场景 3 (Anthropic Studio launch 11-04) 跟 d2p PR 集成 ship 时间 race；如果 d2p PR 集成 ship 在 Anthropic Studio 之后，d2p 完全失这条 surface 战。

---

### Q3.4 Class C / D bug 漏了怎么办？

**A** (v0.6): 漏。明说漏。Bug class taxonomy A/B/C/D，C/D 出 scope。

**Round 2 场景 1 加锐**: Trajectory #3 (resume PDF, Class D 业务规则失败) 是 d2p 最容易 stall 的具体场景——**Class D 误漏直接导致 founder dogfood stall**。

**v0.7 操作**: Q6.4 spec sanity gate 从 MVP-1 提前到 MVP-0.5（场景 1 防御）。Class D 仍不抓 100%，但 spec sanity gate 至少 detect "demo bug 抄进 spec" 和 "vision 没写但用户真在乎的 capability" 两类失败。

---

### Q3.5 严格 done 系统造——具体怎么造？

**A** (v0.6 已修): 三步 (解析 demo / 解析 vision / 合成 done 标准)。Kaner + Trae SOLO "共享直觉非 lineage"（footnote）。

**Round 2 邻域 #6 加锐 (Kiro 抢做)**: 这条差异化窗口只剩 6-9 月（v0.7 在 Q1.3 已明示）。

操作 (v0.7): 把这条**当短期窗口对待**，6 月内 ship MVP-0 demo→product 闭环证明跑得通；不当永久护城河。

---

## 4. 商业 — 4 问

### Q4.1 🔧 v0.7 重写: 开源不变现，你怎么活？

**v0.6 写**: SQLite Consortium / curl Sovereign Tech Fund / Linux Foundation 类比。

**Round 2 R7 攻击 (P1)**: SQLite 被嵌入 iPhone (Apple 是 structural stakeholder); curl 被嵌入 OS distro。**d2p 用户跑 hackathon-scale 项目，没有商业实体 P&L 跟 d2p 健康挂钩——没有 stakeholder 持续 patron**。

**v0.7 修订 (诚实)**:

**承认 patron 路径在当前未识别明确 stakeholder**。

候选 stakeholder (按可能性排序):
1. **agent infra 公司** (E2B / Modal / Daytona): 如果 d2p 流行，会有用户把 d2p 跑在 E2B sandbox 上——E2B 有可能 sponsor d2p 来 commodify 自家 platform。但 d2p §5.2 是本地形态，所以 E2B 实际 stake **可能很小**。
2. **LLM provider 中性 entity**: 如 OpenSSF / Linux Foundation AI——但**他们历史 grant 量级 €5-50K/年**（R7 已指出），养不起一个全职 maintainer。
3. **隐私 / 主权 IT advocacy**: GitHub Sponsors / Patreon / 个人捐赠——长期 base 不稳。
4. **企业自己 fork 出 commercial version**: 类比 Redhat / Linux Kernel。但 d2p §9 红线 1 禁卖企业版——**只能允许第三方 fork**，那 fork 厂商 vs d2p 原项目 stake 关系不清。

**结论 (诚实)**: **0-2 年作者 self-funded** 是真实状态，2-5 年 patron 路径**当前无明确依靠**。

**v0.7 操作 (R6 + 场景 3 加锐)**:
- **Month 3 之前** 启动 outreach 到 OpenSSF / Sovereign Tech Fund / GitHub Sponsors / 任何 agent infra 公司，确认是否有 sponsor 意愿——**不等项目 mature**。
- 如果 month 6 仍未识别任何 stakeholder 意愿，**承认 d2p 是 hobby project + sustainability risk**——可能等同 §11 falsifier F13（新加）触发。

**这条 v0.7 不假装解决了**。

---

### Q4.2 为啥不卖企业版？

**A** (v0.6 已修): 接受 risk。区分 "卖企业版" vs "接 corporate sponsor"——后者跟 SQLite Consortium 同模式，不扭曲产品方向。

但 Q4.1 修订后，**corporate sponsor 路径未识别明确 stakeholder**，所以 "接 sponsor" 当前也是空 promise。**承认这条**。

---

### Q4.3 🔧 v0.7 重写: 大厂分层

**v0.6 把"大厂"混谈**——Round 2 G 邻域 #6 + #2 攻击为 false 论证。**大厂分两类**:

**Type A — Model lab (Anthropic / OpenAI / Mistral)**:
- 收入主体: API tokens
- 结构性 vendor-lock: 必锁自家 model
- 抄 d2p 同款 (cc + reviewer pipeline + auto-merge): 6-12 月，eng-month 4-8
- **d2p 真护城河**: cross-engine reviewer + agent agnostic + 不持 API key + 不卖企业版

**Type B — Platform / IDE vendor (AWS Kiro / GitHub Copilot Workspace / Microsoft / Google)**:
- 收入主体: cloud / IDE subscription / enterprise contract
- **没有 vendor-lock 结构约束**——他们卖 platform 不卖 model，可以随便调 GPT-4 / Claude / Gemini 当 reviewer。
- 抄 d2p 同款 (含真 cross-engine): 3-5 月，eng-month 2-4
- **AWS Kiro 2025-09 已 ship spec-driven IDE**，加 "demo → spec inference" + "cross-engine reviewer" 概率 70% 在 12 月内
- **GitHub Copilot Workspace** distribution 比 d2p 大 4 个数量级
- **d2p 对 Type B 的护城河实际很弱**: 本地形态 + OSS + 不上传 codebase——只服务 trust-沉重 / 反 SaaS 意识形态 niche

**Round 2 邻域 collapse 总结**:
- 对 Type A: v0.6 §Q4.3 锁的 5 条护城河仍成立（vendor lock 结构性）
- 对 Type B: **v0.6 论证 broken**。Kiro / Copilot Workspace 不受 vendor lock 约束，可以真 cross-engine。**d2p 对 Type B 的真护城河只剩 "OSS + 本地 + 反 SaaS"**——服务的 user 全球估算 < 5 万（更窄）。

**v0.7 操作**: 把 Q4.3 表格分两类。**对 Type B 承认 d2p 护城河窄**。

加 F11 falsifier 锁这条 (见 §11)。

---

### Q4.4 Specmatic / Linear / TestSprite 都做了，你晚了吗？

**A** (v0.6 修): 部分晚。差异化窗口是四件叠加（generic codebase + autopilot + no-approval + 自造 spec）。

**Round 2 Q4.3 加锐**: AWS Kiro 是 Type B 但**已经做 spec-driven**——Q4.4 不再只是 API-layer Specmatic 的竞争，是 IDE-layer Kiro 的竞争。Kiro 加"demo→spec inference" + "cross-engine reviewer" 后 d2p 四件叠加里少 2 件（自造 spec、cross-engine），窗口压缩到 1-2 件。

操作 (v0.7): 紧迫感升一级。MVP-0 ship 时间表收紧到 month 3（不是 6）。

---

## 5. Scope — 4 问

### Q5.1 为啥 demo→product？

**A** (v0.6): MVP-0 首发用例。"demo-as-anchor" 大厂 PM 说没人在抄——12-18 月独占窗口。

**Round 2 邻域 #6 加锐**: Kiro 抢做后，"demo→spec inference" 在 IDE 内集成会吃掉这条 framing。**独占窗口实际 6-9 月，不是 12-18 月**。

---

### Q5.2 为啥本地不云？

**A** (v0.6 修): 三条理由互锁（trust posture + 选 A + stateful 数据风险）。无 foundation 直接背书，产品哲学。

---

### Q5.3 vision 跟 demo 完全 mismatch 怎么办？

**A** (v0.6): elicit 阶段 detect 让用户决策。

---

### Q5.4 🔧 v0.7 修订: monorepo / FAANG-scale out-of-scope

**v0.6 写**: "物理不可行" → Round 2 R4 攻击为 "把工程懒包装成 axiom"——git sparse-checkout + partial clone 在 2022 起已能 sub-repo work，Chromium 团队就用这套。

**v0.7 承认**:

**真原因是工程优先级**，不是物理不可行。

具体:
- Git sparse-checkout + partial clone 技术上可行
- Bazel + 子集 build 工程难（10-20 eng-month）
- d2p 4 层 reviewer 设计假设 "demo folder" = self-contained，monorepo 子集**可能**仍 self-contained 但 d2p 没做这个工程

**v0.7 决定**:
- **MVP-0 / MVP-1 不打 monorepo 市场**——工程优先级太高，会拖整个项目。
- **MVP-2+ 可能加 monorepo support**——通过 adapter pattern + sparse-checkout 集成。
- **不写进 §9 红线**（v0.6 错把这当 axiom），改成 MVP roadmap 上的 explicit deferred feature。

红线 7 删除。从 7 条红线退回 6 条 + 1 条 deferred feature。

---

## 6. 失败模式 — 5 问

### Q6.1 reviewer 把对的代码 reject 了怎么办？

**A** (v0.6): false positive 必然，<5% 才能 ship。MVP-1: cross-engine voting / MVP-2: human-in-loop / MVP-3: self-tuning。

操作 (v0.7): MVP-1 cross-engine voting 跟 Q3.1 提前的 cross-engine default 合并——MVP-0 已经是 cross-engine，MVP-1 加 voting 逻辑（不再是 "AND"，是 "2/3 多数"）。

---

### Q6.2 agent 死循环烧钱怎么办？

**A** (v0.6 已修): hard cost cap + graceful degradation (partial-PASS) 模式。

---

### Q6.3 用户跑一晚上回来还没双绿怎么办？

**A** (v0.6): dashboard 显示卡在哪 + 自动 escalate 三种情况。

---

### Q6.4 🔧 v0.7 重要: spec sanity gate 提前到 MVP-0.5

**v0.6 写**: spec sanity gate MVP-1+ 实现。

**Round 2 场景 1 攻击 (P1)**: spec sanity gate 推迟 + founder dogfood 2 周 commit = **循环依赖 = founder stall**。Trajectory #3 (Class D 业务规则失败) 就是 spec sanity gate 缺失直接导致 stall。

**v0.7 修订**: spec sanity gate **提前到 MVP-0.5**——walking skeleton 跑通后**立刻**实现，不等 MVP-1。

具体实现 (从场景 1 counterfactual):
- elicit 完 vision 后，独立 LLM (不同 frame) 反向生成 "如果这 product hostile user 用，最坏会怎么破"
- 跟用户 elicit 的 vision diff，超过阈值 escalate
- MVP-0.5 thin version: 5-10 个 standard 维度的 hostile use case (Unicode handling / authentication boundary / data validation / 等)

承认弱点: spec sanity gate v1 不能抓 100% Class D bug，但能抓 "用户没在 demo 展示但在 ship 后真用户秒发现" 的子集。

---

### Q6.5 🔧 v0.7 重写: 没 SaaS 怎么知道用户在用 / iterate？

**v0.6 写**: anonymous opt-in telemetry via "Tor-like relay 或 batch upload"。

**Round 2 R10 攻击 (P2)**: "Tor-like relay" 是 hand-wave。Tor-like 关键基础设施要 1-5K/year server cost，§4.1 经济模型不支持。

**v0.7 修订**: **MVP-0 / MVP-0.5 不实现 anonymous telemetry**。

承认: 在没识别明确 patron stakeholder（Q4.1 修订）+ 没 server budget 之前，做不了真正的 anonymous telemetry。

替代信号:
- GitHub stars / forks / issues (manual analytics)
- Anonymous-by-default 用户自发 share trajectory log (类似 SQLite "consortium 共享 best practice" 模式)
- 6 个月内目标识别 ~10 个 d2p heavy user，建议他们 公开 trajectory log 到 `docs/community-trajectories/`

**MVP-1+ 才考虑做 telemetry**——前提是 patron stakeholder 识别。

---

## 7. 终极 grill — 6 问

### Q7.1 6 个月做不到 first-pass-strict-pass 30%，停吗？

**A** (v0.6): 不一定停，retrospect 哪条 hypothesis 错。不允许降标准。

---

### Q7.2 Anthropic 抢 ship 怎么办？

**A** (v0.6 已修): 用 Round 1 PM 数据。Type A 大厂结构性 vendor lock，d2p 5 条护城河仍成立。

**Round 2 G 邻域 #4 + §Q4.3 重写加锐**: 但**对 Type B 平台 / IDE vendor (AWS Kiro / GitHub Workspace)** d2p 护城河窄。这条要承认。

---

### Q7.3 你为啥不是 d2p 用户而是 d2p 作者？

**A** (v0.6): 作者 ≠ 用户 = 红灯。

---

### Q7.4 🔧 v0.7 重要: founder dogfood 工程化 enforce

**v0.6 写**: 2 周内 3 个 trajectory。**Round 2 R6 + 场景 1 攻击**: 文档承诺非工程承诺，循环依赖 (#3 trajectory Class D 失败导致 spec sanity gate 需求，但 sanity gate 推到 MVP-1+ 没做)。

**v0.7 修订: 工程化 dogfood-debt mode**:

具体落地 4 artifact (场景 1 防御原话):

1. **`tools/dogfood-stall-watchdog.mjs`** (Node, ~150 LOC) — 每天 UTC 03:00 跑，扫 `docs/dogfood/`，trajectory 文件 > 5 天没 commit 更新 → "stalled" 状态。若 stalled ≥ 2 个 → 触发 P1 alert.
2. **`.github/workflows/dogfood-watchdog.yml`** — cron 跑 watchdog，P1 alert 自动开 GitHub issue。
3. **`docs/dogfood/_INVARIANT.md`** — 规则：dogfood-debt mode 下 **禁止 merge feature PR**，只允许 fix stall 根因 PR。exit 条件：stall ≤ 1 且 ≥ 1 个 trajectory 7 天内有 commit。
4. **`tests/dogfood-invariant.test.mjs`** — vitest 验证 watchdog 逻辑（满足 CLAUDE.md `surface_without_self_test`）。

**红线变成 enforced**——不再是文字 axiom。Q9.7 改成 enforced red line (见 §9)。

trajectory commit 顺序 (改 v0.6):
- 用户 dogfood Trajectory #1 → **立刻评估 spec sanity gate 是否阻塞**
- 如果 #1 暴露 Class D 漏抓 → **暂停 trajectory pipeline**，先 ship MVP-0.5 spec sanity gate
- 然后才继续 #2, #3

不允许在 spec sanity gate 没 ship 前硬冲 3 个 trajectory。Q6.4 提前到 MVP-0.5 跟 Q7.4 顺序匹配。

---

### Q7.5 🔧 v0.7 修订: head-to-head benchmark cost-adjusted

**v0.6 写**: "d2p 比 cc 自审 detection 高 <15% 就不值"。**Round 2 R11 攻击 (P2)**: 15% 凭空，没考虑 cost 不对等。如果 Arm B (d2p) 多 15% detection 但花 4× token，仍不值。

**v0.7 修订**: pass criterion 改为 **cost-adjusted marginal benefit**:

- 计算 `detection_per_dollar` for Arm A vs Arm B
- d2p 必须 detection_per_dollar **≥ 0.6 ×** Arm A (即每美元额外 detection 不能比 cc 自审差 40% 以上)
- 同时 absolute detection 必须 high  Arm A **at least 25%** (容错率)

例: Arm A cc 自审 detection 50%, cost $1.00, 每美元 0.5
Arm B d2p 4 层 detection 70%, cost $3.00, 每美元 0.233
detection_per_dollar(Arm B) / detection_per_dollar(Arm A) = 0.466 → **不达标 0.6 阈值**
absolute detection delta = 20% → **不达标 25% 阈值**
→ **d2p 4 层证伪**

这是更严格的 benchmark。Round 2 R11 的 pass band 太松攻击命中——v0.7 严格化。

加 vs EvoSuite + vs Specmatic 两条 baseline (场景 2 防御)。

---

### Q7.6 跟 EvoSuite 56.4% 怎么比？

**A** (v0.6 修): metric definition 不同 (EvoSuite 是 detection rate, d2p 是端到端 success rate)。Q7.5 head-to-head 加 EvoSuite arm。

---

## 8. 还能 grill 出来的留白 (🔧 v0.7 更新)

v0.7 已答 28 问。Round 1 + Round 2 累计 7 个 grill POV。还能 grill 的：

- **Q8.1** LLM provider cut off 某用户/地区，d2p fail-over 路径？
- **Q8.2** severity 怎么管？P1 reviewer 决策跟 P3 同等权重？
- **Q8.3** 不同 agent calibration drift > 5% 怎么办？
- **Q8.4** 用户 vision 用 jargon (fintech / 医学 / 法律) reviewer 不懂咋办？
- **Q8.5** 双绿之后用户不爽——feedback 怎么进下一轮？
- **Q8.6** 红线 6 governance 实际操作（v0.7 §9.6 已加 governance 设计但未落地）
- **Q8.7** 5 年后 d2p 的讣告——从已死视角分析为什么死？(Round 3 候选 POV)
- **Q8.8** end-user 真用户视角：作为 hackathon dev 我会不会用？(Round 3 候选 POV)

---

## 9. 产品精神红线 — 7 条 (从 v0.6 的 7 条 → v0.7 重整为 6 + 1 deferred)

**v0.6 7 条** → **v0.7 6 + 1 deferred**:

1. **不卖企业版 / hosted SaaS / multi-tenant** (不变)
2. **不让用户审 diff 作为 default workflow** (不变)
3. **不放低严格 done 标准** (不变)
4. **默认 CLI subprocess，d2p 不中转 key**——默认 cc / Codex / Gemini CLI subprocess（用户已登录 = d2p 可用）。**允许** opt-in HTTP+key fallback（anthropic-api / openai-compat 覆盖 MiniMax / DeepSeek / OpenRouter / Codex-via-OpenRouter 等 token-plan 用户）——key 存用户本地 `~/.d2p/config.json`，d2p **不转发** key 给自家 server，**不上传** key 到任何第三方除用户配置的 baseUrl。Spirit: 用户控制 key 始终在用户机器上。**v0.7 修订自 α 决策**（之前 hard "不持 key" 跟现实 MiniMax / DeepSeek 用户 break）。
5. **不 vendor-lock LLM 提供商**——MVP-0 强制 cross-engine default (Q3.1) 落地这条 (不变)
6. 🔧 **不为大厂在抄而妥协红线 1-5** + **governance 设计** (v0.7 加):
   - **Multi-maintainer 否决**: 项目 ≥3 maintainer 时，任何红线松绑 PR 需要 ≥2/3 maintainer approve。MVP-0 阶段 (只 1 maintainer) 这条 enforce 不了——**承认这条 v0.7 仍是 willpower**，未来工程化。
   - **OSS license 条款**: 探索 license-level enforce（如类似 Anti-996 license 加 commercial-fork 限制——但这跟 OSI compliant 冲突）。**当前未识别可行 license enforce 路径**。
   - 红线 6 v0.7 仍主要是 willpower，但**显式承认 governance 缺失**，不假装 enforce 落地。
7. **🆕 v0.7 工程化红线: dogfood-debt mode**——见 Q7.4，由 watchdog + GitHub Action enforce。**这是第一条 enforced 红线（前 6 条都是 willpower / 哲学）**。

**v0.6 红线 7 (monorepo out)** → 降级为 deferred feature (Q5.4 修)，不在红线里。

---

## 10. MVP roadmap (🔧 v0.7 重要重排)

**MVP-0 (Walking Skeleton)**:
- 真闭环 demo→product (端到端 cc subprocess + 4 层 reviewer + 自动 merge)
- **Cross-engine default** (Layer 2/4 强制不同 LLM family) — 从 MVP-1 提前
- Cost cap (hard $5 / 10 iter) + graceful degradation (partial-PASS)

**MVP-0.5 (在 walking skeleton 跑通之后立刻)**:
- 🔧 **Spec sanity gate v1** (5-10 standard hostile use case dimensions) — 从 MVP-1 提前
- 🔧 **PR-comment / GitHub status-check 集成** — 从 MVP-1 提前
- 🔧 **Dogfood-debt mode** (4 artifact: watchdog + workflow + invariant + test) — 新加
- 🔧 **Sponsor outreach** (OpenSSF / Sovereign Tech Fund / GitHub Sponsors) — 不等项目 mature

**MVP-1**:
- Cross-engine voting (2/3 多数) reviewer (替代 v0.6 的 cross-engine default — 已提前到 MVP-0)
- OTel exporter (reviewer 决策 emit 到 Honeycomb / Datadog)
- Adapter pattern static gate (消费现有 CI status)
- Anonymous opt-in telemetry (前提: 已识别 sponsor)
- Head-to-head benchmark vs cc 自审 + EvoSuite + Specmatic (Q7.5)

**MVP-2**:
- Monorepo / FAANG-scale support (Q5.4 deferred)
- Reviewer self-tuning via Anthropic prompt caching
- Class C bug 探索 (deterministic simulation testing 集成 — 可选 Antithesis API)

**MVP-3+**:
- Spec sanity gate v2+ (覆盖更多 Class D 维度)
- 学习用户 historical override → 改善 reviewer prompt
- Foundation 治理 (≥3 maintainer 达成时正式 governance 工程化)

---

## 11. Falsifier 12 条 + 🔧 v0.7 时间表

**v0.6 10 个 falsifier** + **v0.7 加 F11 + F12 + F13** = 13 条带时间表:

| # | Falsifier | Measure 时间 | Owner |
|---|---|---|---|
| **F1** | ≥50% 首批用户在 6 月后要求 "我想看 diff 才 trust" | Month 6 user survey | founder |
| **F2** | 双绿 ship 后 ≥30% artifact 在用户第一周 reject | Month 4 onwards 持续 measure (community trajectory log) | founder |
| **F3** | cc CLI 重大架构变（如砍 `-p` flag） | 持续 monitor，Anthropic public roadmap | founder |
| **F4** | 首批用户主体不是 "demo 持有者" | Month 4-6 user interview | founder |
| **F5** | 单 LLM 调用直接生成双绿比例 ≥50% | Month 3 head-to-head benchmark (Q7.5) | founder |
| **F6** | Token cost per session 中位数 > 用户支付意愿 | Month 3-6 (跟 trajectory dogfood 同步) | founder |
| **F7** | Cross-agent calibration drift > 5% | Month 3 cross-engine fixture test | founder |
| **F8** | 单 LLM SWE-bench Pro >70% pass | 持续 monitor (frontier model release) | founder |
| **F9** | d2p 真实用户 codebase 里 Class C+D 占用户痛 >50% | Month 6 community trajectory analysis | founder |
| **F10** | head-to-head benchmark d2p 比 cc 自审 cost-adjusted **detection_per_dollar < 0.6×** Arm A | Month 3 (Q7.5 重定义) | founder |
| **🆕 F11** | AWS Kiro / GitHub Spec Kit ship "demo→spec inference" 后 d2p 真实用户增速 <10%/月 | Month 6-12 (跟 Kiro launch 时间 align) | founder |
| **🆕 F12** | False-PASS-when-buggy (双绿但有 bug) 中位数 > 15% | Month 3-6 internal benchmark | founder |
| **🆕 F13** | Month 6 仍未识别任何明确 sponsor / patron stakeholder 意愿 | Month 6 sponsor outreach status | founder |

**碰任一 F1-F13 = v1 重做 hypothesis**。**所有 measure 时间在 Month 3-12 范围内**——short-loop measurable。

---

## 12. 三层 framing — 不变

| 层 | 给谁讲 | 一句话 |
|---|---|---|
| 顶层 punchline | 用户 / 路人 | **"AI 时代的测试程序员"** |
| 中层定位 | 工程师 / 评审 | "agentic coding 工业化"（后训练类比） |
| 底层纪律 | 团队 / 设计决策 | "为 agent 设计让它更容易输出完美工作的环境 + 严格 done 系统造" |

---

## 13. Round 2 修订摘要 + 下一步

### v0.7 修订 10 处 P1 (Round 2 新增):

1. (Q1.3) 自造 spec 护城河窗口承认 6-9 月 + 多 redundant 差异化叠加才形成 niche moat
2. (Q2.1) SAM "5-10 万" 改成 "无法精确估算"，停止给假数字
3. (Q2.3) 删 18-24 月窗口数字，所有 hypothesis 6-12 月 measure
4. (Q3.1) MVP-0 强制 cross-engine default — 落地差异化、解 Littlewood-Miller 收益递减矛盾
5. (Q3.3) PR-comment 集成提前到 MVP-0.5 (场景 3 防御)
6. (Q4.1) Patron stakeholder identification 不假装解决，承认 0-2 年 self-funded
7. (Q4.3) 大厂分层 Type A vs Type B，承认 Type B (AWS Kiro / GitHub Workspace) 护城河窄
8. (Q5.4) Monorepo 从红线降级为 deferred feature
9. (Q6.4) Spec sanity gate 提前到 MVP-0.5 (场景 1 防御)
10. (Q7.4) Dogfood-debt mode 工程化 enforce (watchdog + GitHub Action + invariant + test)

### v0.7 修过的 5 处 P2:

11. (Q3.1) MVP-0 cross-engine 默认解 Littlewood-Miller 矛盾
12. (Q6.5) anonymous telemetry MVP-0 不做，承认
13. (Q7.5) head-to-head benchmark cost-adjusted criterion (detection_per_dollar)
14. F11 + F12 + F13 加 falsifier
15. 12-13 条 falsifier 都给时间表

### v0.7 修过的 3 处 P3:

16. (Q2.3) Bitter Lesson 反向 prior 加"为什么 d2p 例外"辩护（承认未验证）
17. §9 red line 6 governance 设计加 + 承认 enforcement 缺失
18. Niche framing v0.6 当护城河——v0.7 承认是退路非护城河

### Round 2 收敛性分析

- **Round 1 P1**: 11 条（学术 hygiene / 经济模型 / TAM / dogfood / 大厂抄袭）
- **Round 2 P1**: 10 条（**与 Round 1 不重叠**——数字诚实 / 大厂分层 / spec sanity 提前 / governance / dogfood 工程化）

**未收敛**——每轮挖新维度。

### Round 3 候选 POV

如果继续 grill:
- **end-user / hackathon dev 视角**: 真用户会用吗？（v0.7 Q1.1 还没真验过）
- **5 年后讣告视角**: 从已死回看为什么死（v0.7 Q8.7 留白）
- **法律 / 合规视角**: OSS license 选哪个？governance 工程化怎么 enforce？
- **哲学家视角**: d2p 产品哲学跟工程现实有几条矛盾？

**建议**: 暂停 grill 进入实操。理由:
- v0.7 落地 10 处工程化修订 (cross-engine / spec sanity gate / dogfood watchdog / PR 集成) **需要 walking skeleton 跑通**才能验证。
- 不跑工程，再 grill 只是文档迭代。
- 4 轮 grill (Round 1 + Round 2) 累计 7 POV 已经覆盖大多数严肃 attack 维度。**继续 grill 边际收益递减**。

**推荐下一步**: walking skeleton commit 后立刻按 §10 MVP-0.5 顺序工程化落地 Q6.4 + Q7.4 + Q3.3 三条 v0.7 关键修订。然后 Trajectory #1 真跑。然后基于真数据回来跑 Round 3。

---

## 附录 A: foundations 引用对照表 (🔧 v0.7 更新)

| 章节 | 主要 foundation 引用 |
|---|---|
| Q1.2 cross-engine 理论祖父 | **Knight-Leveson 1986** N-version 独立性 |
| Q1.3 spec generation 差异 | doc 1 §3.3 Kaner、SA4 调研 |
| Q2.1 SAM 不可估算 | 不引 foundation——honest framing |
| Q2.3 leverage 窗口未知 + Bitter Lesson 反向 | doc 2 §10.2、Sutton Bitter Lesson、doc 6 §4.6 |
| Q3.1 MVP-0 cross-engine 默认 | **Littlewood-Miller 1989** diversity 收益递减 |
| Q3.2 vision verdict 防御 | **Frankl-Hamlet-Littlewood-Strigini 1998**、**Salay 2017** 反向 |
| Q3.3 PR-comment 集成 | doc 5 §3.3 Honeycomb、Doshi-Velez & Kim 2017 XAI、FAANG Q1 命中 |
| Q3.4 Class C/D 边界 | doc 6 §4.4、doc 3 §3.5 |
| Q3.5 严格 done 系统造 | doc 1 §3.3 Kaner footnote |
| Q4.1 patron stakeholder 不明 | 实事求是 |
| Q4.3 大厂分层 | Round 2 邻域 collapse 分析 + Round 1 大厂 PM |
| Q5.2 本地 | 产品哲学 |
| Q5.4 monorepo deferred | Round 2 R4 |
| Q6.4 spec sanity gate MVP-0.5 | Round 2 场景 1 防御 |
| Q6.5 telemetry deferred | Round 2 R10 + Q4.1 经济 |
| Q7.4 dogfood-debt mode | Round 2 场景 1 防御 + R6 工程化 |
| Q7.5 cost-adjusted benchmark | Round 2 R11 |

---

**v0.7 status**:
- 28 个 Q grill 过两轮 7 POV
- 6 + 1 deferred 红线 (1 条 enforced)
- 13 条 falsifier 带时间表
- MVP-0 / 0.5 / 1 / 2 / 3 roadmap 修订
- **未 measured 数字**: SAM、leverage 窗口、抄袭 eng-month estimate 全部明示是猜测
- 经济模型: 0-2 年 self-funded 承认，2-5 年 stakeholder 路径不假装解决

到此为止: **v0.7 是当前可以承载实际工程的 hypothesis**。继续文档迭代收益递减；下一步建议开工程。
