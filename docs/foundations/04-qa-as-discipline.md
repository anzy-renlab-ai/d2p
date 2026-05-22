# 04 — QA 作为一门学科

> Doc 1 给「测试理论」地基。Doc 2 给「自动找 bug 的算法前沿」。Doc 3 给「证明排除 bug 的形式方法」。
> 这一份回答另一个问题：**作为产业，怎么组织 QA**——流程 / 角色 / 标准 / 经济。
> Bug 不只是技术问题，是组织决策。

---

## 0. 这份文档的六条线索

1. **制造业血统** —— Shewhart 1931 → Deming → Juran → Crosby → Feigenbaum → Ishikawa → Six Sigma。软件 QA 整套词汇是制造业输入。
2. **软件工程经济学** —— Boehm 1981 cost-of-fix 曲线 + NIST 2002 $59.5B + CISQ 2022 $2.41T。
3. **标准谱系** —— ISO 9001 / 9126 / 25010、IEEE 730 / 829 → ISO/IEC/IEEE 29119。
4. **过程成熟度** —— Humphrey 1988 → CMM → CMMI → SPICE / ISO 33001。
5. **Context-Driven 反抗** —— Kaner / Bach / Pettichord / Stop 29119 petition 2014。
6. **Agile 转向 + ISTQB 标准化与 SDET 退场** —— 2001 Agile Manifesto 之后 QA 部门崩解，"全队对质量负责"成主流；同期 ISTQB 1M+ certification 建立反向标准化。

---

## 1. 制造业血统——软件 QA 的祖父辈

### 1.1 Shewhart 1931——统计过程控制 (SPC) 诞生

**Shewhart, W.A. *Economic Control of Quality of Manufactured Product*, Van Nostrand 1931。**

Bell 实验室。引入 **control chart**、区分 **common cause vs special cause variation**。"任何可测过程都有分布，只对超出分布的信号做干预"——这是后面所有质量运动的母题。

### 1.2 Deming / Juran / Crosby——质量管理三巨头

**Deming, W.E. *Out of the Crisis*, MIT Press 1986**，ISBN 0-262-04115-X。把战后日本（1950 年起 JUSE 演讲，Deming Prize 1951）的统计方法 + 14 Points for Management 带回美国。

> Point 5: *"Improve constantly and forever the system of production and service, to improve quality and productivity, and thus constantly decrease costs."*

**Juran, J.M. *Quality Control Handbook* 1st ed., McGraw-Hill 1951**——**Juran Trilogy**：planning / control / improvement。比 Deming 更管理向。三段映射到软件 bug-finding：planning = test design，control = regression suite，improvement = post-mortem + root-cause loop。

**Crosby, P.B. *Quality Is Free: The Art of Making Quality Certain*, McGraw-Hill 1979**——*Zero Defects*。Martin Marietta Pershing 导弹项目的来源。Crosby 把质量投资算成 net-negative cost：rework + warranty + 信任损失 > prevention 投入。**这是后面所有 "shift-left testing pays for itself" pitch 的祖父**。

### 1.3 Feigenbaum / Ishikawa——TQM

**Feigenbaum, A.V. *Total Quality Control*, McGraw-Hill 1961** —— 第一次提出质量是 cross-functional 的事，不属于 QC 部门。

**Ishikawa, K. *What Is Total Quality Control? The Japanese Way*, Prentice Hall 1985** —— 把 Feigenbaum 带进日本工业语境：company-wide quality control、quality circle、**fishbone (cause-and-effect) diagram**。

美国海军 1985 起把这套整合叫 **TQM (Total Quality Management)**，覆盖 PDCA + Juran Trilogy + Crosby prevention。

### 1.4 Six Sigma + DMAIC

Motorola 1986（Bill Smith 提出）→ Jack Welch 1995 GE 战略级（1998 报 $350M 节省，后来 >$1B）。

**Pyzdek, T. *The Six Sigma Handbook*, 2nd ed., McGraw-Hill 2003**——**DMAIC** (Define-Measure-Analyze-Improve-Control) 是 canonical 流程；green belt / black belt / master black belt 是组织认证体系。

把 Shewhart-Deming 统计学**编进企业认证体系**。这是后面 ITIL、PMI、ISTQB 等所有"专业认证产业化"模板的祖父。

### 1.5 PDCA 循环

**Shewhart 1939** 把制造描述为三段循环 specification → production → inspection。Deming 在 1950 年日本演讲中讲，日本听众简称 **Plan-Do-Check-Act**。Deming 自己后来更喜欢 **PDSA** ("Study" 不是 "Check")——他觉得"Check 像 pass/fail gate，Study 才是 knowledge loop"。

PDCA 是所有"持续改进"循环的母模式——CI feedback、retro、AI agent self-correction loop 都是它。

---

## 2. 软件工程经济学——从 Boehm 到 CISQ

### 2.1 Boehm 1981——把 cost 算上

**Boehm, B.W. *Software Engineering Economics*, Prentice-Hall 1981**，ISBN 0-13-822122-7（Internet Archive: <https://archive.org/details/softwareengineer0000boeh>）。

引入 **COCOMO** (Constructive Cost Model) + **cost-of-fix curve**：bug 在 requirements 发现 = 1×、design = ~5-6×、code = ~10×、dev test = ~15-20×、acceptance test = ~50×、**post-release = 100-150×**（p. 40 数据来自 TRW + IBM）。

这是 1981 之后每一个 "shift-left" 论证的源头数字。Menzies et al. 2016 (arXiv:1609.04886) 用现代 agile 数据重做发现 iterative project 把曲线压平了——但**方向性结论没翻**：早期发现 cheap，后期发现贵。

### 2.2 Boehm 1988——Spiral Model

**Boehm, B.W. "A Spiral Model of Software Development and Enhancement,"** *IEEE Computer* 21(5), May 1988, pp. 61–72, DOI 10.1109/2.59。

替代 waterfall 的 **risk-driven iteration**：每圈 objective → risk analysis → development → planning。是 d2p 自己跑的那个 loop 的祖父——vision → gap → fix → review → re-check。

### 2.3 NIST 2002——$59.5B/yr

**Tassey, G. *The Economic Impacts of Inadequate Infrastructure for Software Testing*, RTI Project 7007-011, NIST, May 2002**（<https://www.nist.gov/director/planning/upload/report02-3.pdf>）。

> *"We estimate the aggregate cost of an inadequate infrastructure for software testing of approximately $59.5 billion per year."*
> *"Infrastructure improvements could reduce a portion of these costs ($22.2 billion)."*

20 年来软件质量经济学引用率最高的单篇报告。

### 2.4 Capers Jones——12000 project benchmark

**Jones, C. *Applied Software Measurement: Global Analysis of Productivity and Quality*, 3rd ed., McGraw-Hill 2008**，ISBN 978-0-07-150244-3。**12000+ project 跨 24 国**的数据，按 function point 归一化。

**Jones, C. & Bonsignour, O. *The Economics of Software Quality*, Addison-Wesley 2011**，ISBN 0-13-258220-1 —— *"integrated inspection, structural quality measurement, static analysis, and testing can achieve defect removal rates exceeding 95 percent."*

### 2.5 Defect Removal Efficiency (DRE)

Jones 给出 canonical 公式：

> DRE = defects_found_before_release / (defects_found_before_release + defects_found_in_first_90_days_post_release)

**美国软件平均 DRE ~85%；>95% 算好；<85% 算差**。单一技术达不到 95%——code inspection 单独 ~60%，static analysis ~55%，unit testing 仅 30–35%——所以 Jones 的论点是 stack 多层 defect removal。

### 2.6 CISQ 2022——$2.41T

**Krasner, H. *The Cost of Poor Software Quality in the US: A 2022 Report*, CISQ 2022-11**（<https://www.it-cisq.org/the-cost-of-poor-quality-software-in-the-us-a-2022-report/>）。

NIST 2002 的现代继任。三个驱动：可追溯到软件漏洞的 cybercrime 损失、open-source supply chain 风险、tech debt 累积。

> *"The cost of poor software quality in the US has grown to at least $2.41 trillion. The accumulated software Technical Debt (TD) has grown to ~$1.52 trillion."*

是 NIST 2002 的 ~40 倍——通胀、范围、经济增长都在里头。

### 2.7 Defect density 工业 benchmark

**McConnell, S. *Code Complete*, 2nd ed., Microsoft Press 2004**，ISBN 0-7356-1967-0。Chapter 20 是 canonical 工业 defect-density 参考：

| 组织 | in-house testing | released product |
|---|---|---|
| 行业平均 | 15–50 defects / KLOC | (取决于) |
| Microsoft Applications | 10–20 / KLOC | 0.5 / KLOC |
| IBM Cleanroom (Mills) | ~3 / KLOC | 0.1 / KLOC |
| NASA Space Shuttle on-board | 通过 formal methods + 统计 testing | **0 defects / 500K LOC** 多版本 |

**Mills Cleanroom 的 30× 提升**——比行业平均低一个数量级——是 90 年代质量工程的标杆。NASA Shuttle 是 formal methods + organizational discipline 联合产物（doc 3 §8）。

### 2.8 现代反驳——Marc Brooker stateful 反 rollback

**Brooker, M. "Software Deployment, Speed, and Safety,"** Marc's Blog 2022-01-31（<https://brooker.co.za/blog/2022/01/31/deployments.html>）。AWS Principal Engineer，给 Boehm 正交补充：

> *"Once state is corrupted, or lost, or leaked, or whatever, no amount of rolling back is going to fix the problem… Stateful systems need to have a different bar for software quality than many other kinds of systems."*

继 2023-07-28 *"Invariants: A Better Debugger?"* —— *"Omnisciently asserting global invariants is one of the most powerful abilities granted by deterministic simulation testing."*

对 agent 产品的意义：**别把"shift-right + canary + 快速 rollback"当成万灵药**。stateful 系统的 corruption 是不可逆的；upfront validation + invariant + deterministic simulation testing 仍然必需。

---

## 3. 标准谱系——ISO / IEEE 三十年

### 3.1 ISO 9001 + 9126 → 25010

**ISO 9001:2015** —— 通用质量管理体系，行业无关。对软件几乎没说什么；用 **ISO/IEC/IEEE 90003:2018** 当桥梁解释如何应用到软件。

**ISO/IEC 9126:1991** —— 6 个 quality 特性：functionality / reliability / usability / efficiency / maintainability / portability。第一个 ISO-endorsed 软件质量词汇。

**ISO/IEC 25010:2011 SQuaRE** —— 替代 9126，**8 个特性**：functional suitability、performance efficiency、compatibility、usability、reliability、**security**、maintainability、portability。9126 → 25010 的关键变化：**security 从 sub-characteristic 升到 top-level**。

**ISO/IEC 25010:2023** —— 加 **safety** 成第 9 个特性；usability 改名为 "interaction capability"，portability 改名为 "flexibility"。

### 3.2 IEEE 730 / 829 → ISO 29119

**IEEE Std 730** *Software Quality Assurance Processes*（最早 1979，最新 730-2023）——给软件 quality assurance plan (SQAP) 最低 acceptable content。

**IEEE Std 829-2008** *Software and System Test Documentation* —— 定义 8 个 test document（test plan、design spec、case spec、procedure spec、item transmittal、log、incident report、summary）。2013 被 **ISO/IEC/IEEE 29119-3** 替代。

**ISO/IEC/IEEE 29119**（5-part，2013–2022）—— 当前国际共识 software testing 标准。Part 1 (concepts)、Parts 2–4 (process / documentation / techniques)、Part 5 (keyword-driven testing)。

### 3.3 Stop 29119 petition——QA 学科最大公开撕裂

2014 年 8 月，**International Society for Software Testing (ISST)** 由 Iain McCowatt 起草、Kaner / Bach / Bolton / Pettichord 等签名 (~3000 个 tester) 上书 ISO 要求**撤回 29119 Parts 1–3 + 暂停 Parts 4–5**。

> *"Significant disagreement and sustained opposition exists amongst professional testers as to the validity of these standards, and that there is no consensus (per definition 1.7 of ISO/IEC Guide 2:2004) as to their content."* —— petition verbatim (<https://www.ipetitions.com/petition/stop29119>)

Bach 在 satisfice.com 上更激烈：*"This is why we must reject this depraved attempt by ISO to grab power and assert control over our craft."*

ISO 没撤，标准存续。但这次 petition 把 QA 学科里 **standardization camp vs context-driven camp** 的撕裂正式公开化，至今未愈。

---

## 4. CMM / CMMI / SPICE——过程成熟度运动

### 4.1 Humphrey 1988 / 1989

**Humphrey, W.S. "Characterizing the Software Process: A Maturity Framework,"** *IEEE Software* 5(2), March 1988, pp. 73–79, DOI 10.1109/52.2014 —— 5-level maturity framework (Initial / Repeatable / Defined / Managed / Optimizing)，**给 DoD 一个 rank 软件供应商的工具**。

注意：**起源是 DoD procurement，不是 software craft**——这是后来 context-driven 派批判的起点。

**Humphrey, W.S. *Managing the Software Process*, Addison-Wesley 1989**，ISBN 0-201-18095-2 —— book-length 阐述，先于 CMM v1.0 (SEI 1991) 公开。

### 4.2 CMMI v1.3

**CMMI Product Team. *CMMI for Development, Version 1.3*, CMU/SEI-2010-TR-033, November 2010** —— 最后一个 SEI 公版本，之后转商业（CMMI Institute → ISACA）。v1.3 加 agile guidance、改进高 maturity practice、对齐 staged + continuous representation。

### 4.3 PSP / TSP

**Humphrey, W.S. *A Discipline for Software Engineering*, Addison-Wesley 1995**，ISBN 0-201-54610-8 —— 把 CMM-style discipline 推到**个体工程师**层：**Time Recording Log + Defect Recording Log + Engineering Notebook**。研究队列里 PSP cohort 几个 project 内就显著降低 injected-defect rate。

工业落地差——没人想手动填 defect log。但 PSP 数据是 **per-developer defect telemetry** 唯一接近"科学"的工业数据集。Agent 产品要做"每个工程师哪一类 bug 高发"功能，这是参考。

### 4.4 SPICE / ISO 33001

**ISO/IEC 15504** (SPICE, 2003–2012) → **ISO/IEC 33001:2015** family —— ISO 的并行 CMMI 替代路线。Automotive SPICE (ASPICE) 是欧洲汽车业事实标准。

SPICE / CMMI / Six Sigma 都是 Humphrey 1988 那条线索的不同 instantiation——都属于 Pettichord 后来叫的 **Factory / Standard school**。

---

## 5. Context-Driven 反抗——Bach / Kaner / Pettichord

### 5.1 Bach 1999——What Software Reality Is Really About

**Bach, J. "What Software Reality Is Really About,"** *IEEE Computer* 32(12), Dec 1999, pp. 148–149, DOI 10.1109/2.809258（MIT 镜像 <http://sunnyday.mit.edu/16.355/bach-reality.pdf>）。

> *"More about people working together than defined processes, more about science than computer science, and more about understanding than documentation."*

这是 Bach 整个 "Software Realities" 专栏的总结，也是 context-driven 派对 CMM/CMMI 哲学批判的 single-page distillation。

### 5.2 Kaner 2006——五个学派

**Kaner, C. "Schools of Software Testing,"** kaner.com 2006-12-22（<https://kaner.com/?p=15>）。

把 testing 圈分成 5 个 school：

| School | 信念 |
|---|---|
| **Analytical** | software 是 logical artifact；testing 是 CS / 数学分支；强调严谨、客观 |
| **Factory (Standard)** | testing 是可标准化的、可重复的、可外包的工厂线工作 |
| **Quality** | testing = enforce 标准；tester 是 gatekeeper / process police |
| **Context-Driven** | testing 价值 mission-dependent；没有 best practice |
| **Agile** | testing 嵌入 development，whole team 负责 |

ISTQB / IEEE / ISO 29119 都属 Factory / Standard / Quality school；Kaner / Bach / Pettichord / Bolton / Hendrickson 属 Context-Driven school；Beck / Crispin / Gregory 属 Agile school。

### 5.3 Bach & Bolton 2013——Testing vs Checking

**Bach, J. & Bolton, M. "Testing and Checking Refined,"** satisfice.com 2013（<https://www.satisfice.com/blog/archives/856>）。

> *"Testing is the process of evaluating a product by learning about it through experiencing, exploring, and experimenting, which includes to some degree: questioning, study, modeling, observation, inference, etc."*
>
> *"Testing encompasses checking (if checking exists at all), whereas checking cannot encompass testing."*

**对 agent 产品的核心命题**：machine 能做 **checking**（algorithmic confirmation of expected facts）；只有人能做 **testing**（open-ended inquiry / learning / modeling / experimentation）。LLM agent 落在哪里？纯 confirm pre-stated expectation = checker。能 explore + conjecture + 自主提新假设 = 开始做 testing 的一部分。这条 distinction 是 agent 产品定位的判据。

---

## 6. Agile 转向——从 QA 部门到 whole team

### 6.1 Agile Manifesto 2001

**<https://agilemanifesto.org/>** —— 17 signers 包括 Beck, Cockburn, Fowler, Highsmith, Jeffries, Sutherland, Schwaber, **Brian Marick**（QA 圈代表）。

> *"Working software over comprehensive documentation."*

Marick 在 manifesto 里的存在，让 testing 从 day 1 就在 agile 桌子上有座位。

### 6.2 Beck XP + TDD

**Beck, K. *Test-Driven Development: By Example*, Addison-Wesley 2002**，ISBN 0-321-14653-0。TDD 的 *red-green-refactor* loop 作为 design tool 不只是 verification tool。

**Beck, K. & Andres, C. *Extreme Programming Explained*, 2nd ed., Addison-Wesley 2004**，ISBN 0-321-27865-8。

> *"Defects destroy the trust required for effective software development."*

XP 把质量 reframe 成"property to be designed in"，不是"phase to be inserted"。

### 6.3 Crispin & Gregory——agile testing 圣经

**Crispin, L. & Gregory, J. *Agile Testing: A Practical Guide for Testers and Agile Teams*, Addison-Wesley 2008**，ISBN 0-321-53446-8。

操作化 Brian Marick 2003 的 **Testing Quadrants**（business-facing × technology-facing × supporting-team × critique-product 的 2×2），定义 "agile testing mindset"，给出 story-test workflow、test automation pyramid、exploratory charter、release-readiness criteria。

**Crispin/Gregory 2014 *More Agile Testing***，ISBN 0-321-96705-1 —— 6 年后回访，加分布式团队 / 移动 / 受监管行业 / DevOps 转型。

**核心信条**：*Whole-team approach to quality* —— QA 不是部门是属性。

### 6.4 ATDD / BDD / Cucumber

**Gärtner, M. *ATDD by Example*, Addison-Wesley 2012**——acceptance test 取代分离的 requirement / test / doc。

**North, D. "Introducing BDD,"** *Better Software* magazine 2006-03（<https://dannorth.net/introducing-bdd/>）。

> *"Behavior-Driven Development (BDD) is a second-generation, outside-in, pull-based, multiple-stakeholder, multiple-scale, highly-collaborative, TDD variant."*

引入 **Given-When-Then** 模板和 `Should…` 测试命名约定。

**Cucumber / Gherkin**（<https://cucumber.io/>，原作者 Aslak Hellesøy 2008）—— Gherkin 自然语言 DSL 把 Given-When-Then 工程化。

### 6.5 Shift-Left 与 Smith 2001

**Smith, L. "Shift-Left Testing,"** *Dr. Dobb's Journal* 26(9), Sept 2001, pp. 56, 62 —— 命名 shift-left：把 QA 活动从"扔过墙"前移到 spec + development 期间。

> *"Pre-base-level testing could reduce QA hardware requirements by at least 75% while achieving 10 times more overall testing coverage."*

shift-right (production monitoring / observability / feature flag / chaos engineering) 是 2010s 中后期的反向运动，没有 single canonical origin paper，留给 doc 5。

---

## 7. Testing Typology——pyramid / trophy / quadrants / risk-based

### 7.1 Test Pyramid——Cohn 2009 / Fowler 2012

**Cohn, M. *Succeeding with Agile*, Addison-Wesley 2009**，ISBN 0-321-57936-4，ch. 16 —— 自底向上 unit / service-API / UI，**unit 最多 UI 最少**。

**Fowler, M. "TestPyramid,"** martinfowler.com 2012-05-01（<https://martinfowler.com/bliki/TestPyramid.html>）—— 把 Cohn 的图普及。

> *"You should have many more low-level UnitTests than high level BroadStackTests running through a GUI."*

警告 anti-pattern：**ice-cream cone**（UI 测试堆顶部，brittle expensive slow）。

### 7.2 Testing Trophy——Dodds (2018/2021)

**Dodds, K.C. "The Testing Trophy and Testing Classifications,"** kentcdodds.com 2021-06-03（<https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications>）。

JS / 前端 stack 的 pyramid 替代：static (TypeScript+ESLint) → unit → **integration（最厚）**→ e2e。

> *"The more your tests resemble the way your software is used, the more confidence they can give you."*

**Pyramid vs Trophy 不是对错之争，是 stack 之差**——Java/Backend 适合 pyramid，TypeScript/Frontend 适合 trophy。

### 7.3 Marick 2003 Testing Quadrants

**Marick, B.** *Exampler* blog 2003-08-21/22（原 URL 死了，被 Crispin-Gregory 2008 ch. 6 永久收录）。

2×2 matrix：
- 纵轴：business-facing vs technology-facing
- 横轴：supporting team vs critique product

四象限：
- **Q1** unit / component tests (技术 + 支持团队)
- **Q2** functional / story tests (业务 + 支持团队)
- **Q3** exploratory / usability tests (业务 + 批判产品)
- **Q4** performance / security / non-functional (技术 + 批判产品)

是 modern QA 最被引的心智模型——给"测试 intent 覆盖"一个词汇，不只是代码 path 覆盖。

### 7.4 Risk-Based / Exploratory / SBTM

**Bach, J. "Heuristic Risk-Based Testing,"** STQE 1(6), Nov/Dec 1999（<https://www.satisfice.com/download/heuristic-risk-based-software-testing>）—— 三步 loop：build prioritized risk list → run tests for each → re-prioritize。

**Bach, J. "Exploratory Testing Explained,"** v1.3, 2003（<https://satisfice.us/articles/et-article.pdf>）—— ET 是 *"simultaneous learning, test design, and test execution"*。tester 的产品模型、设计、执行**同时**进行不是分阶段。

**Whittaker, J.A. *Exploratory Software Testing: Tips, Tricks, Tours, and Techniques*, Addison-Wesley 2009**，ISBN 0-321-63641-4 —— 命名各种 "tour" (guidebook tour, money tour, landmark tour, intellectual tour, supermodel tour, garbage collector's tour)，让 ET 可教可分享。

**Bach, J. & Bach, J. "Session-Based Test Management,"** satisfice 2000（<https://www.satisfice.com/download/session-based-test-management>）—— ~90 分钟 timeboxed session + charter + 结构化 debrief。给 ET 加 management discipline。

**Hendrickson, E. *Explore It!*, Pragmatic 2013**，ISBN 1-937785-02-1 —— Charter formula：*"Explore <target> with <resources> to discover <information>."*

**Hendrickson Test Heuristics Cheat Sheet** —— Quality Tree Software 2006，testobsessed.com TLS broken；现 mirror 在 BBST 课程页。

### 7.5 Pairwise / Combinatorial Testing

**Kuhn, D.R., Wallace, D.R., Gallo, A.M. "Software Fault Interactions and Implications for Software Testing,"** *IEEE TSE* 30(6), June 2004, pp. 418–421, DOI 10.1109/TSE.2004.24（<https://csrc.nist.gov/pubs/journal/2004/06/software-fault-interactions-and-implications-for-s/final>）。

跨医疗器械、NASA、浏览器、服务器软件的 fault DB 分析：**几乎所有观测 failure 由 ≤4-6 参数交互触发，绝大多数 2-way 或 3-way**。所以 **t-way combinatorial testing**（小 t 覆盖所有 t-tuple）以极小成本得 exhaustive 的大部分捕 bug 力。NIST ACTS 工具是工业实现。

### 7.6 Smoke test

**McConnell, S. "Daily Build and Smoke Test,"** *IEEE Software* 1996-07（<https://stevemcconnell.com/articles/daily-build-and-smoke-test/>）。

> *"The smoke test should exercise the entire system from end to end. It does not have to be exhaustive, but it should be capable of exposing major problems."*

Smoke test 词源——硬件：通电板子，**看见烟**就停。Microsoft 90s 流行化。是 modern CI smoke job 的祖父。

---

## 8. ISTQB / SDET——标准化产业与角色塌缩

### 8.1 ISTQB

**International Software Testing Qualifications Board**，Edinburgh 2002-11 成立。69 个 member board 跨 130+ 国家，**100 万+ certification** (2025-04 数字)。

三 tier ladder：
- **Foundation Level** —— 无 prerequisite，终身有效
- **Advanced Level** —— Test Manager / Test Analyst / Technical Test Analyst 三轨
- **Expert Level** —— Foundation + Advanced + 5 年经验，7 年有效

**CTFL v4.0 (2023)** 是当前 Foundation syllabus。Glossary（<https://glossary.istqb.org/>）是 ISTQB 整个 curriculum 的语义骨架。

ASQ **CSQE** + QAI **CSTE/CMST** 是 parallel certification track，制造业血统更重 (ASQ 1946 起源 American Society for Quality Control)。

### 8.2 SDET 退场——Microsoft 2014

Microsoft 90s 推出 **SDET (Software Development Engineer in Test)** 作为独立 career track——专做 test code、自动化基础设施，与 SDE 同薪级。

**2014 年 7 月 Microsoft 正式废除 SDET role**，并 merge 进统一 "Software Engineer" ladder。同月 18000 人裁员里 SDET 占比异常高。Google / Amazon 部分跟进，部分保留 SDET title。

这是 QA 学科作为 distinct profession 在大厂里的塌缩信号。Crispin/Gregory 的 *whole team* 哲学和 ISTQB 的 *certified profession* 哲学在工业现实里前者赢了——但 ISTQB certification 数量仍在增（中小型企业 + 受监管行业），不是 zero-sum。

### 8.3 World Quality Report——产业实时数据

**Capgemini / Sogeti / OpenText. *World Quality Report 2024-25*, 16th ed.**（<https://www.capgemini.com/insights/research-library/world-quality-report-2024-25/>）。

跨 30+ 国数千 senior IT 调研。2024-25 headline：
- 约 1/3 公司在 QA 任务里集成 generative AI（test reporting、test data 生成）
- 约 1/2 公司已把 quality engineer 嵌入 agile team
- data quality 升到与 functional quality 平级

---

## 9. 这一条道路的整体形状

把 1931–2026 压成几个维度：

| 维度 | 1930s–80s 制造业输入期 | 1985–2010 标准化期 | 2001–now Agile/Context-driven 期 |
|---|---|---|---|
| 哲学 | 质量是统计可控的 | 质量是 process 成熟度 | 质量是 mission-dependent + whole team |
| 标志 | Shewhart / Deming / Crosby | CMM / CMMI / ISO 9001 / 29119 | Agile Manifesto / context-driven / Stop 29119 |
| 工具 | Control chart / fishbone | SQA Plan / process audit | TDD / BDD / SBTM / exploratory charter |
| 数字 | NIST 2002 $59.5B / Boehm 1-100x | Jones 12000 projects / DRE 85% avg | CISQ 2022 $2.41T / WQR 50% embedded QE |
| 角色 | QC 工程师 | tester / QA manager / certified prof | whole team / SDET 退场 / quality engineer 嵌入 |

**反复出现的 pattern**：每隔 ~15-20 年学科**重新定义"QA 是什么"**——SPC → TQM → Six Sigma → CMM → Agile → Context-Driven → AI-augmented。每次都没把上一代彻底否定，而是把它压成一个更小的 niche。**这是 d2p 产品定位时要直面的事**：你给的是哪一代 QA 的解决方案？

第二个 pattern：**QA 学科一直内部撕裂**——Stop 29119 是表面、内核是 *"testing as profession with certification" vs "testing as skilled craft with judgment"* 的根本分歧。这场撕裂没解决；任何 agent 产品都要选边——选 standardization 阵营则做 ISTQB-compatible 度量；选 context-driven 阵营则做 mission-aware 探索。

---

## 📚 还该读什么

1. **Crispin, L. & Gregory, J. *Agile Testing*, Addison-Wesley 2008** —— 操作化 Marick quadrants + whole team 哲学的实战书。读完知道现代 QA team 怎么 run。
2. **Bach, J. & Bolton, M. *Taking Testing Seriously: The Rapid Software Testing Approach*, Wiley 2024**，ISBN 978-1-394-25319-7 —— context-driven 派 30 年方法论的最新汇编。
3. **Kuhn, D.R., Kacker, R.N., Lei, Y. *Introduction to Combinatorial Testing*, CRC Press 2013** —— pairwise / t-way combinatorial 测试的工业操作手册。是 doc 1 §7 实证测试 effectiveness 的工程对照。
4. **Krasner, H. *Cost of Poor Software Quality in the US: A 2022 Report*, CISQ**（<https://www.it-cisq.org/wp-content/uploads/sites/6/2022/11/CPSQ-Report-Nov-22-2.pdf>）—— 给 marketing 引数字必读。
5. **Capgemini *World Quality Report* 年度报告**（<https://www.capgemini.com/insights/research-library/world-quality-report-2024-25/>）—— 每年读一次。看产业实时方向。

## ❓ 我还没搞清楚的 3 个问题

1. **agent 时代 ISTQB 还有相关性吗？** 100 万+ certification 主要在受监管行业 + 中小型企业，大厂已经把 SDET 砍了。Agent 产品 marketing 该不该 ISTQB-compatible？这关系到 enterprise sales motion。
2. **Bach-Bolton "testing vs checking" distinction 对 LLM agent 怎么用？** 一个能 explore + conjecture 的 LLM agent 是否算开始做 testing 的一部分，还是仍然只是高级 checker？这是 product framing 的核心选择。
3. **CISQ $2.41T cost of poor quality / Capers Jones DRE 85% benchmark 这一类数字，在 LLM 时代会被调整吗？** 如果 LLM agent 把某些类 bug 在 dev 期就 surface，整个 cost-of-fix 曲线可能要重算。还没看到 2024+ 的 update。

## 💡 对产品的具体启发

1. **拥抱 Boehm 100× 曲线但说清边界条件。**Menzies 2016 已证 agile / iterative project 曲线被压平。Agent 产品的核心 ROI 是把曲线**进一步压平**——在 dev 期 surface 80% bug，让 cost-of-fix 永远停在 1×–5×。这是 single best ROI narrative。
2. **学 Context-Driven School 的 mission-aware framing 而不是 ISTQB 的 universal-rule framing。**doc 1 §3.3 Kaner principle #5 + 这一份 §5 Stop 29119 都指向同一个真相：bug 是 mission-dependent。Agent 产品的第一个 prompt 应该是"你想解决什么问题"，不是"哪个目录扫"。
3. **Test Pyramid + Marick Quadrants 是 agent 内部 telemetry 的好坐标系。**别造新词汇。已经流行 20+ 年的 Q1/Q2/Q3/Q4 + base/middle/top 是用户认知里现成的；agent 用它们标记自己抓的 bug 类型，沟通成本最低。
4. **DRE 是更好的 marketing metric 而不是 coverage。**Jones 给的 85% 行业均、95% 优秀、99% 顶尖三档是用户能懂的数字。"我们的 agent 把你的 DRE 从 85% 拉到 95%" 比 "我们达到 80% line coverage" 强 10 倍。
5. **shift-right 不是万灵药——Brooker 是必读。**对 stateless / web 应用 canary + 快速 rollback 是好策略；对 stateful 系统 (数据库 / 文件系统 / financial ledger / 操作系统) 这套策略**根本性不适用**。Agent 产品要区分这两类 target，对 stateful 系统 push 更重的 upfront validation。

---

**文档边界**

这份只到 QA 作为 discipline / 流程 / 经济 / 标准。CI/CD 工具链 / SRE / observability / chaos engineering / feature flag 留给 doc 5；AI agent 时代综合给 doc 6。
