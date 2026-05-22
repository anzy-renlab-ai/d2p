# 00 — 总目录

> 6 篇 foundations 的索引页。给"产品理论假设书"查阅用。
> 每篇一句话概述 + 关键 verified fact 列表 + 跨篇主线。
>
> 所有 URL 在各篇正文里都有完整 citation。这一页只放最高频引用的几条。

---

## 一句话总览

| Doc | 主题 | 时间跨度 |
|---|---|---|
| **01** | 测试科学奠基 (Dijkstra / Myers / Beizer / Kaner + mutation testing 学派) | 1947 – 2018 |
| **02** | Bug 发现研究前沿（fuzz / symex / PBT / SBFL / APR / LLM agent） | 1990 – 2026 |
| **03** | 形式方法与类型系统（Hoare / model checking / abstract interp / SMT / dependent type） | 1967 – 2026 |
| **04** | QA 作为一门学科（Shewhart-Deming-Crosby / 标准 / CMM / Context-Driven） | 1931 – 2026 |
| **05** | 现代质量工程（CI/CD / SRE / observability / chaos / feature flag / continuous verification） | 1996 – 2026 |
| **06** | Agent 时代综合（5 保留 + 5 抛弃 + 30 概念对照表 + 产品决策清单） | 综合 |

---

## Doc 01 — 测试科学的奠基

**主线**：testing 不是 verification，是 falsification。"测够"严格意义上是不可达的工程目标，所有 coverage / mutation / PBT 都是这个不可达目标的工程妥协。

**关键 fact**：
- **Dijkstra 1969 NATO + EWD249 1970**: *"Program testing can be used to show the presence of bugs, but never to show their absence!"*
- **Myers 1979**: *"Testing is the process of executing a program with the intent of finding errors"* / *"a successful test case is one that detects an as-yet undiscovered error."*
- **Beizer 1990 pesticide paradox**: *"Every method you use to prevent or find bugs leaves a residue of subtler bugs against which those methods are ineffectual."*
- **Kaner-Bach-Pettichord 2002** Context-Driven Principle #5: *"The product is a solution. If the problem isn't solved, the product doesn't work."*
- **Goodenough-Gerhart 1975**（IEEE TSE）首次形式化 reliable + valid criterion。
- **Howden 1976**（IEEE TSE）Theorem 2: 不存在可计算 procedure 生成 reliable test set。
- **Hamlet 1987**（IPL）概率正确性：3000 次 pass 只买 95% 置信度下 MTTF > 1000。
- **Weyuker 1986 / 1988** 11 公理：antidecomposition + anticomposition → unit test 全过 ≠ system 对。
- **DeMillo-Lipton-Sayward 1978** mutation testing + competent programmer + coupling effect 双假设。
- **Chilenski-Miller 1994** MC/DC，**RTCA DO-178B/C** Level A 法定要求。
- **Inozemtseva-Holmes ICSE 2014 (MIP)**: *"Coverage … should not be used as a quality target because it is not a good indicator of test suite effectiveness."*
- **Petrović-Ivanković ICSE-SEIP 2018 Google mutation testing**: 6000 工程师参与，覆盖 30% diff，触达 14000+ author。

**三个永恒案例**：Therac-25 (1985–87)、Ariane 5 Flight 501 (1996)、Mars Climate Orbiter (1999)。

---

## Doc 02 — Bug 发现研究前沿（1990s – 2026）

**主线**：每 5–8 年一个 *"in real conditions it doesn't work"* 论文推翻上一代主流——Inozemtseva 2014 推 coverage、Smith 2015 推 APR、Pearson 2017 推 SBFL、OpenAI 2026 推 SWE-bench Verified。**工业 ship 的 bug-finder 全是 hybrid stack，不是单一算法**。

**关键 fact**：
- **Miller 1990 CACM**: 给 UNIX 工具喂 random bytes，25–33% 崩溃。
- **AFL 2013 Zalewski** + **AFLFast Böhme et al. CCS 2016**: power schedule 提速 14×。
- **OSS-Fuzz 2016 Google**: 截至 2025-05，1000+ 项目里找到 **13000+ 漏洞 + 50000+ bug**，跑在 ~100000 VM。
- **King 1976 CACM** symbolic execution → **DART (PLDI 2005) + CUTE (FSE 2005)** concolic → **KLEE (OSDI 2008)** Coreutils 89 工具平均 line coverage >90%，找出 3 个潜伏 15+ 年的 bug → **SAGE 2008/2012** Microsoft 用它找出 Windows 7 开发 ~1/3 的 fuzz bug → **Driller (NDSS 2016)** AFL+KLEE hybrid 进 DARPA CGC 决赛。
- **Cadar-Sen CACM 2013** 列 symbolic execution 四堵墙：path explosion / SMT 复杂度 / memory model / environment model。
- **QuickCheck (Claessen-Hughes ICFP 2000)** → **Hypothesis (JOSS 2019)**：byte-stream shrink + strategy model 把 PBT 带进 Python 主流。
- **EvoSuite (Fraser-Arcuri FSE 2011)** + **Randoop (Pacheco-Lahiri-Ernst-Ball ICSE 2007)** → **Shamshiri 2015 ASE**: 三工具合力 detect Defects4J 357 真 bug **仅 55.7%**，单工具 ~20%。
- **Tarantula (Jones-Harrold-Stasko ICSE 2002)** / **Ochiai 2006 PRDC** / **D\* 2010** SBFL → **Pearson et al. ICSE 2017**: 在 3242 个 mutant 上 reproduce 的 10 个主张，在 323 个真 bug 上**每一条都被 refute**。
- **Zeller ddmin 2002** O(n²) 把 896 行 HTML crash 缩到一个 `<SELECT>` tag。
- **GenProg (Weimer ICSE 2009) → SemFix / Prophet / Angelix** → **Smith 2015 FSE overfitting**: APR patch 大多在 held-out test 上失败。
- **Codex 2021 HumanEval pass@1 28.8%** → **SWE-bench (ICLR 2024)** Claude 2 仅 1.96% → **SWE-agent (NeurIPS 2024)** 同模型 12.5% (改 ACI 不换 model) → **Anthropic Claude Code 2025-02 preview / 2025-05 GA**。
- **2026-02 OpenAI 撤 SWE-bench Verified** —— 59.4% failed test case 本身有缺陷 + frontier model verbatim 复现 gold patch (training contamination 证据)。

---

## Doc 03 — 形式方法与类型系统

**主线**：另一条道路。Testing 是 falsification 抽样；formal methods 是 deduction 排除。工业 ROI 集中在 4 个领域：航空（Astrée DO-178）/ OS kernel（seL4）/ 密码学（HACL\* F\*）/ 分布式 design spec（TLA+ AWS）。

**关键 fact**：
- **Floyd 1967** → **Hoare 1969 CACM**: *"Computer programming is an exact science … by purely deductive reasoning."* Turing Award 1980。
- **Dijkstra 1975 EWD472 + 1976 *Discipline of Programming***: `wp(S, R)` + guarded commands。
- **Hoare CSP 1978 CACM**: Go / Erlang channel 的祖父。
- **Z (Spivey)** / **VDM (Jones)** / **B (Abrial)** → **Paris Métro Line 14 (Météor, FM 1999)** 全 B-method 开发 + Atelier B + Ada 代码生成，1998 首条全自动驾驶地铁线。
- **Pnueli LTL FOCS 1977**（Turing 1996）+ **Clarke-Emerson CTL 1981 / Queille-Sifakis CESAR 1982**（Turing 2007）。
- **SPIN (Holzmann TSE 1997)** NASA JPL 飞行软件。
- **BMC (Biere et al. TACAS 1999)**: SAT-based bounded model checking → CBMC / ESBMC / SeaHorn。
- **TLA+ (Lamport 2002)** + **Newcombe et al. CACM 2015** AWS: DynamoDB **35-step counterexample** *"that could lead to losing data … had passed unnoticed through extensive design reviews, code reviews, and testing."*
- **SLAM (Ball-Rajamani POPL 2002)** + **SLAM2 (FMCAD 2010)**: Windows Driver Verifier **<4% false alarm**。
- **Cousot-Cousot POPL 1977**: abstract interpretation。**Astrée (PLDI 2003)** 在 Airbus A340 / A380 fly-by-wire 上**零 false alarm**。
- **Coverity 2010 CACM lesson**: *"No bug is too foolish to check for. Given enough code, developers will write almost anything you can think of."*
- **FB Infer (NFM 2015)** + **Sadowski Google CACM 2018**: surface findings at code review，把 false positive 压到接近零。
- **DP 1960 → DPLL 1962 → GRASP CDCL 1999 → Chaff 2001 (VSIDS + Two-Watched Literals)**.
- **Nelson-Oppen 1979 theory combination** + **DPLL(T) 2004** → **Z3 (TACAS 2008, SIGPLAN Award 2015)**: SDV / SAGE / Pex / Dafny / VCC / Verve / Hyper-V 全在用。
- **Hindley 1969 + Milner 1978**: *"Well-typed programs cannot go wrong."* Milner Turing 1991。
- **Curry-Howard (Howard 1980)** + **Martin-Löf 1984 ITT**: dependent type 哲学根基。
- **CompCert (Leroy CACM 2009)**: 完整 C 编译器在 Coq 里证明。
- **seL4 (Klein SOSP 2009)**: 8700 行 C + 600 行 assembly 完整证明 functional correctness。
- **Rust ownership** + **RustBelt (Jung POPL 2018)** Coq+Iris 证明 safe Rust + unsafe stdlib (Cell, RefCell, Mutex, Rc, Arc) soundness。
- **Linux 6.1 (2022-10)** 接受 Rust；**Android 13** 新 native code ~21% Rust。

---

## Doc 04 — QA 作为一门学科

**主线**：bug 不只是技术问题，是组织决策。30+ 年 ISTQB 标准化派与 Context-Driven 派的撕裂没愈合。QA 作为独立部门在大厂已塌缩。

**关键 fact**：
- **Shewhart 1931 SPC** + control chart → **Deming 1986** 14 Points + Deming Prize 1951 → **Juran Trilogy** (planning / control / improvement) → **Crosby 1979 *Quality Is Free*** Zero Defects → **TQM** (Feigenbaum 1961 / Ishikawa 1985) → **Six Sigma DMAIC** (Motorola 1986 / GE 1995)。
- **Boehm 1981 *Software Engineering Economics*** + **NIST 2002 RTI report**: **$59.5 billion / year** —— 不充分软件测试基础设施的成本。
- **CISQ 2022 (Krasner)**: 美国 poor software quality **cost 上升到 $2.41 trillion**, accumulated tech debt $1.52T。
- **Capers Jones DRE**: 美国均 85% / 优秀 >95% / 顶尖 >99%。
- **ISO/IEC 25010 (2011)** 8 quality char → **2023 修订** 加 safety = 9 个。
- **ISO/IEC/IEEE 29119 (2013/2022)** + **Stop 29119 petition (2014)**: 3000+ tester 签名上书，Kaner / Bach / Bolton 领头：*"there is no consensus … as to their content."*
- **Humphrey 1988 IEEE Software** Maturity Framework → **CMM 1991 → CMMI v1.3 2010 (CMU/SEI-2010-TR-033)** → 商业化（CMMI Institute → ISACA）。
- **Agile Manifesto 2001** (17 signers 含 Brian Marick) → **Beck XP + TDD 2002** → **Crispin-Gregory *Agile Testing* 2008**: whole-team approach to quality。
- **Marick Testing Quadrants 2003** (business-facing × technology-facing × supporting-team × critique-product 的 2×2)。
- **Test Pyramid (Cohn 2009 + Fowler 2012)** vs **Testing Trophy (Dodds 2021)**: stack 之差不是对错之争。
- **Bach exploratory testing 2003** + **SBTM 2000**: *"simultaneous learning, test design, and test execution."*
- **Kuhn-Wallace-Gallo IEEE TSE 2004**: 几乎所有观测 software failure 由 **≤4-6 参数交互**触发。
- **ISTQB 100万+ certification** (2025-04)，但 **Microsoft 2014 废 SDET role**；**WQR 2024-25**: ~1/2 公司把 QE 嵌进 agile team。
- **Bach 1999** *"What Software Reality Is Really About"*: *"More about people working together than defined processes, more about science than computer science, and more about understanding than documentation."*

---

## Doc 05 — 现代质量工程

**主线**：过去 25 年互联网公司怎么把 QA 工程化。CI/CD / SRE / observability / chaos / feature flag / continuous verification 是 agent 时代基础设施衬底。**Production telemetry 是 ground truth，pre-prod 永远 approximate**。

**关键 fact**：
- **Booch 1996** 首次用 "continuous integration" 一词；**Beck XP 1999** 把 CI 命名成 named practice；**Fowler 2000/2024** martinfowler.com 经典 CI 10-point checklist。
- **Humble-Farley *Continuous Delivery* 2010**: deployment pipeline 作 first-class architectural artifact。
- **Kim *The Phoenix Project* 2013 + *DevOps Handbook* 2016 + *Accelerate* 2018**: DORA Four Keys (deployment frequency / lead time / change failure rate / time to restore)。
- **DORA 2024 report**: *"As AI adoption increased, it was accompanied by an estimated decrease in delivery throughput by 1.5%, and an estimated reduction in delivery stability by 7.2%."*
- **Bazel hermetic builds**: *"hermetic build system always returns the same output by isolating the build from changes to the host system."*
- **Uber SubmitQueue EuroSys 2019**: monorepo mainline green 从 52% → 持续 green，via speculation engine。
- **Treynor Sloss 2003** 创立 SRE: *"SRE is what happens when you ask a software engineer to design an operations function."*
- **Google SRE Book 三部曲 (2016/2018/2020)** sre.google：error budget / SLO-SLI-SLA / toil < 50% / Four Golden Signals (latency / traffic / errors / saturation) / blameless postmortem。
- **Dapper 2010 Google**: trace ID + span + parent-child causal edge。**OpenTelemetry CNCF graduated** (2019 merger of OpenTracing + OpenCensus)。
- **Honeycomb high-cardinality wide event** vs metrics+logs+traces 三柱：**BubbleUp** automated outlier attribution。
- **Brendan Gregg eBPF (BPF Performance Tools 2019)**: production-grade kernel-level 观察无需重启。
- **Crash-Only Software (HotOS 2003)** + **Recovery-Oriented Computing (Berkeley 2002)**: MTTR > MTTF.
- **Netflix Simian Army 2011**: Chaos Monkey + Latency / Conformity / Doctor / Janitor / Security / 10-18 / Chaos Gorilla。
- **Principles of Chaos manifesto (2014)** + **Basiri et al. IEEE Software 2016**: 四步法 + 5 advanced principles (steady-state hypothesis / vary real-world events / run in production / automate continuously / minimize blast radius)。
- **Gremlin (Andrus + Fornaciari 2016)** Failure-as-a-Service；**Toxiproxy / Chaos Mesh / LitmusChaos** 三大开源；**AWS REL12-BP04/05** 正式纳入 Well-Architected。
- **Facebook Dark Launch 2008** (chat 上线前先 simulate)；**LaunchDarkly (2014) / Statsig (2021) / Optimizely (2010)** feature flag platform。
- **Canary Release (Sato 2014)** + **Kohavi KDD 2007 / *Trustworthy Online Controlled Experiments* 2020**: HiPPO + Twyman's Law。
- **OpenFeature CNCF**: vendor-neutral feature flag SDK。
- **rr Mozilla (USENIX ATC 2017)**: deterministic record-replay，Firefox slowdown ~1.2×。**Pernosco**: *"a typical bug is quashed about 5 times faster."*
- **WinDbg TTD (2017)** Windows time-travel；**Replay.io** JS time-travel + MCP for AI agent。
- **EvoSuite SEB Life & Pension (ICSE-SEIP 2017)**: 真 fault detect 高达 56.4%。
- **Pynguin (ICSE 2022 demo)** Python search-based test gen。
- **GitHub Copilot Autofix (2024-08)**: 漏洞修复 3× 提速；SQL injection 12×。
- **Hypothesis at Stripe (2017)**: 资助 PBT 用于 Radar fraud-detection。
- **Quviq QuickCheck**: Ericsson / Volvo Cars / AUTOSAR。
- **AWS S3 ShardStore SOSP 2021 (Best Paper)**: lightweight formal methods + executable reference model + bounded property，**16 bugs / 14% code overhead**。
- **FoundationDB DST (Will Wilson Strange Loop 2014)** + **Antithesis**: Confluent 40× faster verification / MongoDB 75+ severe bugs。
- **Jepsen (Kingsbury)**: 分布式 db 一致性外部审计事实标准。

---

## Doc 06 — Agent 时代综合

**主线**：从前 5 篇提炼 5 条保留原则 + 5 条主动抛弃做法，加 30+ 概念对照表 + 7 条产品理论假设 + 10 条产品决策清单。

**5 条保留原则**：
1. Dijkstra 1969 认识论非对称 —— 永远别 claim "find all bugs"
2. Bug 是 mission-dependent —— agent 启动先 elicit vision
3. Hybrid stack 而非单一算法 —— agent 是 orchestrator
4. Diff-only + Continuous Reasoning —— 嵌进 PR review
5. Production telemetry 是 ground truth —— agent 必须吃 production data

**5 条主动抛弃**：
1. Coverage 作 KPI（改用 DRE / mutation kill rate）
2. Universal best-practice testing（ISTQB / 29119 标准化路线）
3. Pre-prod gate 作唯一质量门禁（stateless 改 canary，stateful 改 DST + lightweight FM）
4. Synthetic / mutant benchmark 作主要验证（改用户私有 benchmark + replay-based）
5. QA 作独立部门（agent 嵌进 dev inner loop）

**对照表**：30+ 经典 QA 概念到 agent 时代对应物——**淘汰 6 个 / 继承 8 个 / 进化 12 个 / 合作 2 个 / 分裂 2 个**。绝大多数是进化不是替代。

---

## 五条跨篇主线

1. **认识论非对称**——doc 1 §2 Dijkstra → doc 2 §11 每代被推翻 pattern → doc 3 §0 formal methods 试图 verify → doc 6 §1.1 agent 时代更严重。**结论**：不要 claim "find all bugs"。

2. **Coverage 不等于 effectiveness**——doc 1 §7 Inozemtseva → doc 2 §6 mutation testing → doc 4 §2.5 DRE → doc 6 §2.1 抛弃 coverage as KPI。**结论**：marketing metric 用 DRE / mutation kill rate。

3. **标准化 vs Context-Driven**——doc 1 §3.3 Kaner 7 principles → doc 4 §5 Stop 29119 → doc 6 §1.2 mission-aware framing。**结论**：第一个 prompt 是"你要解决什么"。

4. **Pre-prod 是 approximation, production 是 ground truth**——doc 4 §2.8 Brooker stateful 不可 rollback → doc 5 §3.6 Majors *"Every deploy is a test in production"* → doc 5 §8 S3 ShardStore continuous verification → doc 6 §1.5 product 必须吃 production data。**结论**：架构有 production telemetry pipeline。

5. **QA 部门塌缩，agent 嵌进 dev inner loop**——doc 4 §6 Crispin-Gregory whole-team → doc 4 §8.2 Microsoft 2014 废 SDET → doc 5 §1 DevOps Three Ways → doc 6 §2.5 抛弃 QA 部门 framing。**结论**：persona 是 developer + tech lead + SRE，不是 QA manager。

---

## 阅读顺序建议

- **第一次读全部**：1 → 2 → 3 → 4 → 5 → 6（按时间和抽象层级递进）。
- **直接写产品理论假设书**：6 → 0 → 反查 1/2/3/4/5 里需要的 fact。
- **回应 enterprise customer 关于"测试方法"的问题**：4 → 1。
- **回应 dev 关于"找 bug 算法"的问题**：2 → 3。
- **回应 SRE / DevOps 关于"集成"的问题**：5。
- **写 marketing copy**：6 §4（7 条产品假设）+ 6 §决策清单（10 条）。

---

## 文件清单

| 文件 | 字数（中文） | 引用数 |
|---|---|---|
| `00-index.md`（本页） | ~3500 | 全索引 |
| `01-foundations-of-testing-science.md` | ~6800 | 50+ |
| `02-bug-finding-research-frontier.md` | ~9500 | 70+ |
| `03-formal-methods-and-types.md` | ~9000 | 60+ |
| `04-qa-as-discipline.md` | ~8500 | 60+ |
| `05-modern-quality-engineering.md` | ~8500 | 70+ |
| `06-the-agent-era-synthesis.md` | ~7500 | 综合 |
| **总计** | **~53000 字** | **310+** |

所有 URL 在原始 SA 调研里都被 WebFetch 验证过；ACM DL / IEEE Xplore / ISO catalog / Springer 等 bot-blocked 的 URL 通过 DBLP / Crossref / 作者 homepage / 二手 mirror 交叉验证。少数 UNVERIFIED 项在原文已显式标注（如部分 IEEE 1044-2009 catalog 直链、Smithsonian moth 馆藏 URL pattern、Knuth *Errors of TeX* 开源 PDF 镜像、Stripe TLA+ blog post）。

---

**结束**

6 篇文档 + 索引 = 完整 foundations 包，约 5.3 万字、310+ 引用。用户的下一步是基于这套底座写 *产品理论假设书*（5–10 页）。建议从 doc 06 §4 "产品理论假设的种子" 起草，回查 doc 01–05 里的 verified fact 充实论证。
