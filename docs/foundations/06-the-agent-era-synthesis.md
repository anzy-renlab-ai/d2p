# 06 — Agent 时代综合

> 不重复前 5 份。只回答一个问题：
>
> *如果你要从零设计一个 AI agent 时代的 bug 发现 + 修复产品，前 5 份里哪 5 条原则是你绝对会拿来当地基的？哪 5 条经典做法是你会主动抛弃的？*
>
> 每条给：出处、为什么在 agent 时代变得**更**重要 / 失效了、对**产品决策**的具体含义（不是代码）。

---

## 1. 五条要保留的原则

### 1.1 Dijkstra 1969 认识论非对称——*testing shows presence, not absence*

**出处。** Doc 1 §2。Dijkstra NATO 1969 / EWD249 1970（<https://www.cs.utexas.edu/~EWD/transcriptions/EWD02xx/EWD249/EWD249.html>）：

> *"Program testing can be used to show the presence of bugs, but never to show their absence!"*

**为什么在 agent 时代变得更重要。** LLM agent 是 stochastic 的——同样 input 不同 run 可能给不同输出，并且 LLM 会 confidently hallucinate。在 agent 时代加上 Hamlet 1987 的概率上界（3000 次 pass 只买 95% 置信度 MTTF>1000）：*"agent 跑了一万次都没报问题"* 几乎不构成"代码 OK"的证据。Doc 2 §11 反复出现的 pattern——每代 effective bug-finding 技术 5-8 年内被 "in real conditions it doesn't work" 论文推翻——也是这条原则的递归化。

**对产品决策的含义。** **永远不要 marketing "我们找到所有 bug" 或 "comprehensive bug detection"**。改说 "we find a characterized class of bugs and explicitly miss another class"——把 Beizer pesticide paradox 的残留显式化。具体做法：
- 产品 UI 上每个 finding 带 confidence score
- 产品文档显式列 "what we catch / what we miss"
- 不在 marketing material 写 SOTA 数字（doc 2 §10.6 OpenAI 2026 自己已经撤了 SWE-bench Verified）

---

### 1.2 Bug 是 mission-dependent——Context-Driven Principle #5

**出处。** Doc 1 §3.3（Kaner-Bach-Pettichord *Lessons Learned* 2002 / Context-Driven 7 原则 #5）、doc 4 §5（Kaner / Bach / Pettichord / Bolton / Hendrickson 反抗 ISTQB 标准化）。verbatim：

> *"The product is a solution. If the problem isn't solved, the product doesn't work."*

**为什么在 agent 时代变得更重要。** 传统 ISTQB / ISO 29119 路线假设有 universal 的"正确测试方法"——这种假设在 agent 时代彻底破产。LLM agent 拿到一个 codebase 不知道用户的 mission 时，它根本不能判定**什么算 bug**：返回 500 在 production 是灾难，在 staging 是预期；O(n²) 在 10 项列表是没事，10M 项是 incident。**这条 mission-awareness 是 agent 产品区别于纯 static analyzer 的根本能力**。

**对产品决策的含义。** Agent 产品的第一个 prompt **必须是** "你要解决什么"，不是 "扫哪个目录"：
- 启动流程：先 elicit vision（doc 1 §3.3 的延展——agent 版的 Kaner exploratory charter）
- 用户每次启动 agent，agent 先确认 mission 和 risk profile；mission 决定 oracle，oracle 决定 bug class
- 产品要 ship "什么算 bug" 的可声明输入——d2p 自己的 preset + vision 双绿门是这一原则的具象

---

### 1.3 Hybrid stack 而非单一算法

**出处。** Doc 2 §11 反复总结：Driller (AFL + KLEE) / CodaMOSA (SBST + Codex) / OSS-Fuzz (4 个引擎 + 100K VM) / Claude Code (LLM + grep/sed/git CLI) / Microsoft SAGE (concolic + DPLL(T) Z3) / FB Infer (separation logic + bi-abduction)。doc 3 §6 SMT solver 工具栈（Z3 + cvc5 + Bitwuzla + Yices 各有 strong 区域）。doc 5 §8 S3 ShardStore lightweight formal methods（reference model + conformance check + bounded property + 14% code overhead）。

**为什么在 agent 时代变得更重要。** LLM 单独的 leverage 有上限——doc 2 §10.2 SWE-bench 上 Claude 2 baseline 仅 1.96%，但配上 SWE-agent ACI 同一个 GPT-4 涨到 12.5%；doc 2 §10.3 CodaMOSA 把 LLM + SBST 混合在 173 个 benchmark 上 statistically 比 LLM-only 或 SBST-only 都好。Fan et al. ICSE-FoSE 2023 (doc 2 §10.7) 的 position paper 直说：*"hallucination 是核心障碍，hybrid（LLM + SBST / symbolic execution / type checker feedback）是必经之路"*。

**对产品决策的含义。** 产品的差异化**不**在 "我们发明了一个新算法"，**而**在 "我们把这套 building block orchestrate 得好"：
- Agent 是 orchestrator over verified building block（KLEE / Z3 / fuzzer / type checker / SBFL / production trace）
- 任何对外宣称的"我们一招包打"都是营销话术
- 产品架构必须从 day 1 设计成可插拔工具栈——一个 LLM-driven decision layer + N 个 deterministic tool

---

### 1.4 Diff-only + Continuous Reasoning

**出处。** 多条 converge：
- Doc 2 §6.7 Petrović-Ivanković *State of Mutation Testing at Google* ICSE-SEIP 2018 —— **只 mutate diff、嵌入 code review tool、arid line suppression** 是 mutation testing 在工业唯一跑得起来的姿势。
- Doc 3 §4.4 Calcagno et al. *Moving Fast with Software Verification* NFM 2015 —— Facebook Infer 把 separation logic shape analysis 嵌进 code review pipeline，每天扫数千 diff。
- Doc 3 §4.5 Sadowski *Lessons from Building Static Analysis Tools at Google* CACM 2018 —— "**surface findings at code review**, not as separate inbox; make developer rate false positive cost; build analyzer as plugin"。
- Doc 5 §1 整个 CI/CD 谱系 + DORA Four Keys 是同一个 design intuition。

**为什么在 agent 时代变得更重要。** 用户在 LLM agent 上的 attention 是稀缺资源——他在 PR review 的时候已经 in flow，agent 在那个时刻报 bug 修改成本最低。**Batch 全 codebase report 在 LLM 时代是 anti-pattern**——report 太多噪声、用户上下文已经走了。Google Sadowski 2018 把 false positive rate 压到 <4% 是开发者会改的天花板，这条数据在 LLM agent 上同样适用。

**对产品决策的含义。**
- 产品的 unit-of-work 是 diff（PR / commit / branch），不是整个 codebase
- 默认运行模式：每次 commit / PR 触发 agent，把 finding 作为 inline review comment surface
- Finding 必须 actionable——不只指出 "X 有 bug" 还要 propose fix（GitHub Copilot Autofix doc 5 §7.4 验证：fix 提案让漏洞修复速度快 3+ 倍）
- 不发 PDF report，不发 batch email

---

### 1.5 Production telemetry 是 ground truth；pre-prod 永远 approximate

**出处。**
- Doc 5 §3.6 Charity Majors *"Testing in Production: Why You Should Never Stop Doing It"* —— *"You can't spin up a copy of Facebook."*
- Doc 5 §8.4 Sridharan *"Continuous Verification"* —— *"'Testing in production' is merely the continuous and ongoing verification that the system does indeed function as designed."*
- Doc 5 §3.1 Dapper 2010 + §3.2 OpenTelemetry —— production trace 是 modern ground truth schema。
- Doc 5 §8.1 Bornholt et al. S3 ShardStore SOSP 2021 —— production-side lightweight formal methods 找出 16 个深度 bug，14% code overhead。
- Doc 2 §8.5 Pearson 2017 + §7.3 Shamshiri 2015 —— artificial fault / synthetic test 在真 bug 上几乎全军覆没。

**为什么在 agent 时代变得更重要。** LLM agent 跑在 dev 时 + static codebase 上，看不见 production traffic shape / 数据分布 / 实际并发模式。如果 agent 只用 pre-prod artifact（unit test、合成 input、static code），它系统性 miss "在真实负载下才暴露"的 bug——这正是 Beizer pesticide paradox 在 LLM agent 上的预言。Doc 2 §11 第二个 pattern："**真正 ship 的 bug-finder 不是单一算法是混合栈**" 在 production 维度同样成立——pre-prod + production telemetry 两边都要吃。

**对产品决策的含义。**
- 产品**必须**有 production telemetry ingest pipeline（OpenTelemetry / Sentry / Datadog / Honeycomb）
- 产品**必须**消费 git commit history（doc 5 §1.9 Tornhill 行为代码分析——hotspot 是经验证的 defect prior）
- agent 报的每个 finding 应该带 production context："这段代码在 prod 跑过 N 次，p99 latency M ms，相关 incident X 次"——不只 static argument
- 对 stateful 系统额外加 upfront verification（doc 4 §2.8 Brooker"stateful 不可 rollback"）

---

## 2. 五条要主动抛弃的经典做法

### 2.1 Coverage 作 quality KPI

**出处。** Doc 1 §7 Inozemtseva-Holmes ICSE 2014 (Most Influential Paper) + Kochhar 2015 真 bug 验证 + Doc 2 §6.5 Just et al. FSE 2014 (Defects4J)：

> *"Coverage, while useful for identifying under-tested parts of a program, should not be used as a quality target because it is not a good indicator of test suite effectiveness."*

**为什么这条在 agent 时代失效。** Coverage 与真 bug detection 的相关性 low-to-moderate；mutation kill rate 才是真信号。Agent 产品如果给用户一个 "test suite quality" 数字，应该是 mutation-based 不是 coverage-based。**Coverage 作 KPI 还有副作用**：开发者会写 assertion-poor 的测试堆 coverage 数字——agent 时代如果把 coverage 作 reward signal，LLM agent 会更激烈地 game 它（写一堆 `assert True` 形 test 拉满 coverage）。

**抛弃后用什么替代。** 用 doc 4 §10 Capers Jones 的 **Defect Removal Efficiency (DRE)** = bugs_found_before_release / (bugs_found_before_release + bugs_found_in_first_90_days_post_release)。Jones 数据：美国均 85%、>95% 算好、>99% 算顶尖。这是用户能懂的数字——"我们把你的 DRE 从 85% 拉到 95%" 比 "我们达到 80% line coverage" 强 10 倍。

---

### 2.2 Universal best-practice / 标准化 testing 流程

**出处。** Doc 4 §3 ISO/IEC/IEEE 29119 + Stop 29119 petition (2014, 3000+ tester 签名 + Kaner / Bach / Bolton / Pettichord 领头) + doc 4 §5.2 Kaner Schools of Software Testing 把 Factory / Standard / Quality school 框成 Context-Driven 的对立面。

**为什么这条在 agent 时代失效。** 标准化 testing 假设 testing 是可记录、可重复、可外包的工厂线工作——这个假设和 LLM agent 时代两个事实正面冲突：
1. Bach-Bolton (doc 4 §5.3) 的 *testing vs checking* distinction —— 标准化的部分是 *checking*（可决定 confirmation），可被 LLM 自动化掉；标准化不了的部分是 *testing*（open-ended inquiry），是 LLM agent 的核心 leverage。如果产品按 ISTQB syllabus 设计，它把自己定位在被自动化掉的那一侧。
2. Doc 4 §8.2 Microsoft 2014 废 SDET role + WQR 2024 ~1/2 公司把 QE 嵌进 agile team —— **作为独立流程的 "QA" 在大厂已塌缩**。

**抛弃后用什么替代。** Context-Driven 的 mission-aware framing（见保留原则 §1.2）。Agent 产品**不要**实现 ISTQB syllabus 的 universal test design technique；**要**让 agent 根据 user mission + risk profile 动态选择测试策略。

---

### 2.3 Pre-prod testing 作为唯一质量门禁

**出处。** Doc 5 §3.6 Charity Majors *"Every deploy is a test. In production."* + doc 5 §8 Continuous Verification + doc 5 §1.5 Phoenix Project Three Ways（特别第二 Way "feedback"）+ Boehm 1981 cost curve 在 cloud-native 时代被 Menzies 2016 证明已 flatten。

**为什么这条在 agent 时代失效。** Pre-prod environment 在 staffing / data / scale / traffic shape 上**根本**不能 model production。LLM agent 在 pre-prod 跑出的所有 test 都是对 production 的 approximation。同时 cloud-native / canary / fast rollback / feature flag 等工程基础设施已经把 "post-release 100× cost" 曲线压平——doc 4 §2.8 Brooker stateless 系统 case。坚持 pre-prod gate 在 stateless 域是过时投资。

**但保留例外**：doc 4 §2.8 Brooker 同时强调**对 stateful 系统**（database / file system / financial ledger / OS）rollback 失败、upfront validation 仍然必需。

**抛弃后用什么替代。**
- Stateless / web app：移到 canary release + dark launch + production observability（doc 5 §5）
- Stateful：移到 lightweight formal methods + deterministic simulation testing（doc 5 §8 S3 ShardStore + Antithesis + Jepsen）
- Agent 产品要按 target system class 分别推荐策略，不要一套打包卖

---

### 2.4 Synthetic / mutated benchmark 作为产品主要验证手段

**出处。** Doc 2 §8.5 Pearson et al. ICSE 2017 —— 在 3242 个人工注入 fault 上 reproduce 的 10 个 SBFL 主张，在 323 个真 bug 上**每一条都被 refute 或统计不显著**。doc 2 §7.3 Shamshiri 2015 EvoSuite/Randoop/Agitar 三工具合力 detect Defects4J 真 bug 仅 55.7%，单工具 ~20%。doc 2 §10.6 OpenAI 2026 自己撤 SWE-bench Verified——发现 59.4% failed test case 本身有缺陷、frontier model 能 verbatim 复现 gold patch（training contamination）。

**为什么这条在 agent 时代失效。** LLM 是从 GitHub commit history + StackOverflow 训出的——任何**公开**的 OSS benchmark 都注定被污染。"我们在 SWE-bench Verified 上 80%" 在 2026 几乎肯定包含 training-set leak。同时 synthetic mutant / 人工 inject fault 在 LLM agent 上分布偏差更大（LLM 见过的 bug 模式 vs 真 bug 模式）。

**抛弃后用什么替代。**
- 用户自己 commit history 上的真 bug benchmark（每个用户的 d2p instance 在他自己 git log 上 evaluate）
- Replay-based benchmark（doc 5 §6.5 Replay.io，doc 5 §6.3 Pernosco）—— production failure 录回 deterministic trace，把 trace 当 ground truth
- 在私有 / proprietary benchmark 上做 cross-engine validation（doc 2 §11 第二 pattern）

**对外披露上**：诚实说"我们在你这个 codebase 上跑了 X 个 historical bug，找回 Y 个"，不说"我们在公共 benchmark 上 SOTA"。

---

### 2.5 把 QA 当成独立部门 / 独立工作流

**出处。** Doc 4 §6.3 Crispin-Gregory *whole-team approach to quality* + Beck XP 1999 + doc 4 §8.2 Microsoft 2014 废 SDET + WQR 2024-25 (~50% 公司把 QE 嵌进 agile team) + DevOps Manifesto / Phoenix Project Three Ways (flow / feedback / continual learning)。

**为什么这条在 agent 时代失效。** 工业现实已经把 QA 部门拆了——agent 产品如果 design 成 "QA team uses this tool" 就把 TAM 限制在已经塌缩的市场。同时 LLM agent 的 leverage 在嵌进开发者 inner loop（IDE / CLI / PR review），不在 QA team 的 batch report 工作流。

**抛弃后用什么替代。**
- Agent 嵌进开发者 inner loop，不是放在 QA dashboard
- Persona 是 **developer + tech lead + SRE on-call**，不是 QA manager / SDET / certified tester
- Pricing 按 dev seat / repo / commit volume，不按 QA team size
- 文档 / 教程不引用 ISTQB / IEEE 730 / CMMI 词汇，引用 DORA Four Keys / SLO / DRE 词汇

---

## 3. 对照表：经典 QA 概念 → Agent 时代对应物

| 经典 QA 学科概念 | Agent 时代的对应物 | 关系 |
|---|---|---|
| **Test case design**（equivalence partitioning, boundary value, decision table——Myers 1979）| **LLM-generated test scaffolding** (TestPilot, CodaMOSA, Pynguin) | 进化 |
| **Code coverage as KPI**（statement / branch / MC-DC）| **Mutation kill rate + DRE + production-bug recall** | 淘汰 |
| **ISTQB / ISO 29119 标准化流程** | **Context-driven mission elicitation + agent dynamic strategy** | 淘汰 |
| **SBFL spectrum-based formula**（Tarantula, Ochiai, D*——Jones 2002）| **LLM 直接 explain failure + hybrid SBFL (Le et al. ISSTA 2016 learning-to-rank)** | 进化 |
| **Delta debugging / ddmin**（Zeller 1999）| **Agent-driven test-case reduction + replay-based bisection** | 继承 |
| **Mutation testing**（DeMillo 1978）| **Diff-only mutation in code review**（Google Petrović 2018, doc 2 §6.7）| 继承+缩窄 |
| **Coverage-guided fuzzing**（AFL 2013, libFuzzer, AFL++）| **LLM-seed + coverage-guided hybrid** (Klees 2018 方法学约束仍然适用) | 继承 |
| **Symbolic / Concolic execution**（KLEE, SAGE）| **Agent as orchestrator over Z3 / cvc5 / Bitwuzla** | 继承 |
| **Property-Based Testing**（QuickCheck, Hypothesis）| **LLM-generated property + PBT engine** | 继承+合作 |
| **Refinement type / dependent type**（Liquid Haskell, F\*, Lean）| **LLM 生成 spec + SMT 检查**（doc 3 §9 hybrid） | 进化 |
| **TDD red-green-refactor**（Beck 2002）| **Agent-driven TDD + LLM test author**（Anthropic Claude Code, Cursor）| 继承 |
| **Whole-team agile testing**（Crispin-Gregory 2008）| **Agent 嵌进 developer inner loop + PR review** | 进化 |
| **Test Pyramid / Trophy**（Cohn 2009, Dodds 2021）| **Tier-aware agent**: unit / integration / e2e / production-trace 分别 strategy | 继承 |
| **Smoke test**（McConnell 1996）| **CI canary + dark launch + feature flag**（doc 5 §5）| 进化 |
| **Risk-based testing**（Bach 1999）| **Agent 用 commit history hotspot + production incident 做 risk prior**（Tornhill doc 5 §1.9） | 进化 |
| **Exploratory testing + Session-Based Test Management**（Bach 2000, Hendrickson 2013）| **Agent autonomous exploration with explicit charter** | 进化 |
| **Coverage report as deliverable** | **Wide event stream**（OpenTelemetry-shaped agent telemetry, doc 5 §3.3）| 淘汰 |
| **Defect-tracking system as artifact-of-record**（IEEE 1044）| **Replay-based bug artifact**（doc 5 §6 rr / Pernosco / Replay.io）| 进化 |
| **CMMI process maturity assessment** | **DORA Four Keys**（Forsgren-Humble-Kim 2018）| 淘汰 |
| **Boehm 1-100× cost-of-fix 曲线** | **Stateless: 曲线压平（canary + rollback）；Stateful: 曲线保留（rollback 不可）** | 分裂 |
| **SQA Plan / Test Plan document**（IEEE 730 / 829）| **Agent acceptance checklist + ground-truth charter** | 淘汰 |
| **SDET role as separate career track** | **Software engineer who uses agent**（Microsoft 2014 已废）| 淘汰 |
| **Pre-prod gating as quality assurance** | **Production-first verification + canary**（stateless）/ **DST + lightweight formal methods**（stateful） | 分裂淘汰 |
| **Coverage-guided test generation**（EvoSuite, Randoop）| **LLM + coverage hybrid**（CodaMOSA, TestPilot）| 进化 |
| **NIST 2002 $59.5B / CISQ 2022 $2.41T defect cost**（doc 4 §2）| **Cost-of-fix × LLM agent leverage**（待重新算）| 继承+待 update |
| **Postmortem / blameless culture**（Google SRE Book Ch. 15）| **Agent-augmented postmortem + replay-driven RCA** | 继承+增强 |
| **Chaos Monkey / chaos engineering**（Netflix 2011, doc 5 §4）| **Agent-driven chaos experiment with steady-state hypothesis** | 继承 |
| **Error budget**（Google SRE Book Ch. 3）| **Agent reliability budget**——agent 的 false-positive rate 也要 SLO 化 | 继承+反向应用 |
| **Feature flag for safe deploy**（LaunchDarkly, doc 5 §5）| **Agent-driven flag rollout decision + flag hygiene scan** | 进化+合作 |
| **A/B testing / controlled experiment**（Kohavi 2007/2020）| **Agent 自己的 SOTA claim 必须经 Twyman-Law sanity check** | 继承+反向应用 |

读对照表：**淘汰 6 个 / 继承 8 个 / 进化 12 个 / 合作 2 个 / 分裂 2 个**。**绝大多数经典 QA 概念是 evolved 不是 replaced**——agent 时代是 50 年学科累积的延续不是断代。**真正断代的只有 6 处**：coverage 作 KPI、ISTQB 标准化、coverage-only deliverable、CMMI maturity assessment、SQA plan 文档、SDET 角色——都是 doc 4 §5 Context-Driven School 30 年前就开始批的东西。

---

## 4. 产品理论假设的种子

下面 7 条是给"产品理论假设书"用的论点骨架。每条对应一个可验证的产品决策。

### 4.1 一个 dyadic 假设：**agent 时代 bug 发现产品有两个不同 target system class**

Stateless / cloud-native 系统：测试策略 = production-first + canary + dark launch + feature flag + LLM agent 消费 production trace。
Stateful 系统：测试策略 = lightweight formal methods + deterministic simulation testing + LLM agent 消费 reference model + invariant 检查。
**一个产品同时打两个 class 是错的**。doc 4 §2.8 Brooker。

### 4.2 一个 trinity 假设：**agent + verified building block + production telemetry 三层架构是不可压缩的**

去掉 verified building block（Z3 / KLEE / fuzzer / type checker / SBFL）→ agent 在 hallucination 上无 ground truth。
去掉 production telemetry → agent 只看 pre-prod approximation，doc 5 §3.6 Majors 已证不够。
去掉 agent → 这些 building block 50 年没成为主流，是 UX 问题。
**三层缺一不可**——agent 产品的 minimum viable 架构。

### 4.3 一个 cost 假设：**Boehm 100× 曲线压平到什么程度，决定 agent 产品的 sale 路径**

如果用户 stack 已经有完整 canary + observability + fast rollback，agent 的 ROI 主要在 "找 dev-time bug 加速 PR review"——marketing 用 DORA Four Keys。
如果用户 stack 是 stateful + 不可 rollback（数据库 / 金融系统 / OS），agent 的 ROI 主要在 "找 production-survival bug 防灾"——marketing 用 S3 ShardStore-style case study + Defects4J。
两条 sale 路径 prompt-engineering 不一样、demo 不一样、pricing 不一样。

### 4.4 一个 honest scoping 假设：**显式 declare "what we catch / what we miss" 比 "comprehensive" 强 5 倍**

Doc 1 §3.2 Beizer pesticide paradox + doc 1 §2 Dijkstra epistemological asymmetry + doc 2 §11 第一 pattern (5–8 年一次的 "doesn't work in real conditions" 论文)。**产品给一个 "bug class taxonomy + recall % per class" 比给一个 unified 数字诚实**。
具体 taxonomy 建议：
- **Class A**：typo / off-by-one / null check 漏 / 类型不匹配——LLM agent 强（doc 2 §10.3 TestPilot 70% statement coverage / 92.8% novel test）
- **Class B**：API contract 违反 / pre-postcondition 错——LLM + spec generation 中等（doc 3 §7.2 Dafny / Liquid Haskell 进路）
- **Class C**：concurrency / race condition / 分布式 protocol 错——只有 model checking / DST 能抓（doc 3 §3.5 AWS DynamoDB 35-step；doc 5 §8.2 Antithesis）
- **Class D**：specification-level 错（单位错配 / interface mismatch / 业务规则误解）——任何 testing tool 都抓不到，只有 mission-aware spec 能抓（doc 1 §8.3 Mars Climate Orbiter）

### 4.5 一个 economics 假设：**DRE 是比 coverage 好 10× 的 marketing metric**

Capers Jones（doc 4 §2.5）的 85% / 95% / 99% 三档已经是用户大脑里的语言。Agent 产品对外宣称 "我们把你的 DRE 从 85% 拉到 92%" 比 "我们达到 80% line coverage" 转化率高一个数量级——doc 2 §11 + §10.6 在 LLM 时代已证 coverage 数字本身被 commoditize。

### 4.6 一个 architecture 假设：**agent 的 leverage 在 interface / orchestration，不在算法**

Doc 2 §10.2 SWE-agent 用同个 GPT-4 把 SWE-bench 从 <2% 拉到 12.5% 是改 ACI 不是改 model。Doc 3 §5.4 Driller 是 fuzz + concolic 混合的 ACI。Doc 5 §6.5 Replay MCP 是 LLM + production trace 的 ACI。**产品最贵的投入应该在 agent-to-tool / agent-to-repo / agent-to-fuzzer / agent-to-solver / agent-to-trace 的接口设计**，不在炼模型。

### 4.7 一个 UX 假设：**diff-only + 嵌进 PR review 是 agent 产品唯一能跑起来的入口**

Doc 2 §6.7 Google Petrović mutation testing 2018 + doc 3 §4.4 FB Infer + doc 3 §4.5 Sadowski Lessons from Google + doc 5 §7.4 Copilot Autofix 3× 提速——四个独立的工业 case 都收敛到同一个 UX：**只动 diff、嵌进 review tool、自动 propose fix**。Batch report 不工作，单独 dashboard 不工作，CLI 弹窗不工作。

---

## 📚 还该读什么

1. **整套前 5 份 doc** —— 这一份的引用全在那里。这一份是 index 不是 textbook。
2. **Hou et al. *LLM4SE: A Systematic Literature Review*, ACM TOSEM 2024**（arXiv:2308.10620）—— 395 篇论文的整体地形图。读完知道你做的产品在 LLM4SE 全谱里的位置。
3. **Bornholt et al. *Using Lightweight Formal Methods to Validate a Key-Value Storage Node in Amazon S3*, SOSP 2021**（<https://jamesbornholt.com/papers/shardstore-sosp21.pdf>）—— continuous verification 在 production storage 上的当前 SOTA case study。
4. **Yang et al. *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*, NeurIPS 2024**（<https://arxiv.org/abs/2405.15793>）—— "interface 比 model 重要" 这条命题的最强经验证据。
5. **Sridharan, C. *Distributed Systems Observability*, O'Reilly 2018**（开源 report）+ **Majors *Observability Engineering*, O'Reilly 2022** —— production telemetry 范式的两本姊妹书。

## ❓ 我还没搞清楚的 3 个问题

1. **5–8 年一次的 "doesn't work in real conditions" 论文 pattern (doc 2 §11) 会推翻当前哪个 agent-era 信仰？** 我的猜测有两个：(a) "LLM agent diff-only PR review" 会被一篇 "false positive rate scales with team size" 类型的论文打脸；(b) "production telemetry as ground truth" 会被一篇 "telemetry-only systems systematically miss spec-level bug" 打脸。哪个先来不知道。
2. **当 LLM 单独能力 5 年内继续上升时，hybrid stack 这条原则会不会失效？** Doc 2 §10.3 CodaMOSA 在 Codex-era 是 strict superior；如果 GPT-7 / Claude 6 在 SBST-only 域上单独 outperform CodaMOSA，hybrid 的价值会缩水到只剩 cost optimization。这是 §1.3 保留原则的 long-term risk。
3. **agent 产品的 commercial moat 在哪？** 一个被很多人 underappreciate 的事实：5 条保留原则里有 4 条本质是 UX / orchestration / interface 决定，不是算法。这意味着 moat 不在模型也不在 tool stack——在用户 codebase 的私有 telemetry + 历史 commit + production trace 的累积。这条还需要验证。

## 💡 对产品的最终决策清单

1. **目标系统 class**：stateless web app 还是 stateful 系统？两条 sale path 不要同时打。
2. **入口 UX**：diff-only + PR review embed。不做 batch dashboard。
3. **架构 trinity**：agent layer + verified building block layer + production telemetry layer，三层缺一不可。
4. **Marketing metric**：DRE % 提升，不是 coverage %。
5. **Honest scoping**：显式 declare bug class taxonomy + per-class recall。
6. **Benchmark 策略**：用户自己 git history 上的真 bug，不用公共 benchmark 报数。
7. **Persona**：developer + tech lead + SRE on-call，不是 QA manager / SDET。
8. **Pricing**：按 dev seat / repo / commit volume，不按 QA team size。
9. **文档语言**：DORA Four Keys / SLO / DRE / OpenTelemetry 词汇——不引用 ISTQB / IEEE 730 / CMMI。
10. **长期 moat**：用户私有 telemetry + commit history + production trace 的累积——把这些 data 留在用户侧，给 agent 看，不上传。

---

**文档边界**

这是第 6 份也是最后一份。前 5 份是底座，这一份是综合。索引页（`00-index.md`）整合 6 篇 + 跨篇关键 fact。
