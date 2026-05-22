# 05 — 现代质量工程

> Doc 4 是 QA 作为 discipline / 流程 / 标准。
> 这一份是过去 25 年互联网公司怎么把它**工程化**——CI/CD pipeline、SRE、observability、chaos engineering、feature flag、production debugging、continuous verification。
> 在 LLM agent 时代，这一层的基础设施和 vocabulary 是 agent 产品赖以运行的衬底。

---

## 0. 这份文档的六条线索

1. **CI/CD lineage** —— Booch 1996 (词起源) → Beck XP → Fowler → Humble/Farley CD → Phoenix Project / DevOps Handbook / Accelerate DORA。
2. **SRE 兴起** —— Treynor Sloss 创立 SRE / Google SRE Book 三部曲 / error budget / SLO-SLI-SLA / four golden signals / blameless postmortem。
3. **Observability** —— Dapper 2010 → OpenTelemetry / Honeycomb 高基数事件 / eBPF / Sentry-Datadog-New Relic。
4. **Chaos engineering** —— Recovery-Oriented Computing 2002 → Crash-Only 2003 → Netflix Simian Army 2011 → Principles of Chaos / Gremlin / AWS Well-Architected。
5. **Feature flag + experimentation** —— Facebook Dark Launch 2008 → LaunchDarkly / Statsig / Optimizely → Kohavi 控制实验 → OpenFeature CNCF。
6. **Production debugging + continuous verification** —— rr / Pernosco / WinDbg TTD / Replay.io / AWS S3 ShardStore / FoundationDB DST / Antithesis / Jepsen。

---

## 1. CI/CD 谱系

### 1.1 词起源——Booch 1996

**Booch, G. *Object Solutions: Managing the Object-Oriented Project*, Addison-Wesley 1996**，ISBN 0-8053-0594-7。Booch 在 OO 项目管理上下文里**首次用了 "continuous integration" 一词**（per Fowler 后来文章），但只是一句过场，不是 named practice。

### 1.2 XP 把 CI 命名成 practice——Beck 1999

**Beck, K. *Extreme Programming Explained*, 1st ed., Addison-Wesley 1999**，ISBN 0-201-61641-6。XP 把 CI 列为 named practice：每天至少 integrate + test 一次。

> *"Self-testing code is so important to Continuous Integration that it is a necessary prerequisite."*

### 1.3 Fowler 经典 CI 文章

**Fowler, M. "Continuous Integration,"** martinfowler.com 2000-09 首版；2006 / 2024 重大修订（<https://martinfowler.com/articles/continuousIntegration.html>）。

> *"Continuous Integration is a software development practice where each member of a team merges their changes into a codebase together with their colleagues' changes at least daily."*

2006 版给出 **10 点 CI checklist**：single source repo / automated build / self-testing build / 每天 commit 到 mainline / 每次 commit 都 build / fast build / test in clone of prod / artifact 易取 / build status visible / automated deploy。

### 1.4 Continuous Delivery——Humble-Farley 2010

**Humble, J. & Farley, D. *Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation*, Addison-Wesley 2010**，ISBN 0-321-60191-2，Jolt Excellence Award 2011。

把 CI 延展到完整 release pipeline：**deployment pipeline 作为 first-class architectural artifact**，每次 change 产 release candidate，依次 commit-stage / automated acceptance / manual acceptance / production deployment gate。"If it hurts, do it more often"——short feedback cycle 的操作纪律。

### 1.5 Phoenix Project / DevOps Handbook / Accelerate——把它做成可教学的

**Kim, G., Behr, K., Spafford, G. *The Phoenix Project*, IT Revolution Press 2013**，ISBN 0-9882625-0-1。商业小说把 DevOps 转型用 "**Three Ways**"（flow / feedback / continual learning）讲。直接 inspiration 是 Goldratt *The Goal* 把 IT operation 类比成 manufacturing constraint theory。

**Kim, G., Humble, J., Debois, P., Willis, J. *The DevOps Handbook*, IT Revolution Press 2016**，ISBN 1-942788-00-3。把小说叙述操作化成 100+ 实践 pattern。

**Forsgren, N., Humble, J., Kim, G. *Accelerate: The Science of Lean Software and DevOps*, IT Revolution Press 2018**，ISBN 1-942788-33-X，Shingo Publication Award。**4 年 survey 数据 + 严格 SEM 统计**证明 **throughput 与 stability 正相关**，不是 trade-off——杀掉 "speed vs quality" 那套二元对立。给出 **DORA Four Keys**：

| Metric | 测什么 |
|---|---|
| **Deployment Frequency** | 部署频率 |
| **Lead Time for Changes** | commit → 上线时间 |
| **Change Failure Rate** | 部署后失败 % |
| **Time to Restore Service** | 故障恢复时间 |

### 1.6 DORA 2024——AI 时代第一份调研

**DORA / Google Cloud. *2024 Accelerate State of DevOps Report*, 2024-10**（<https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report>）。Marks 第 10 年 DORA 测量。

最关键的发现：**AI 采用上升与 delivery 指标的反向相关**——

> *"As AI adoption increased, it was accompanied by an estimated decrease in delivery throughput by 1.5%, and an estimated reduction in delivery stability by 7.2%."*

这个 1.5% throughput 降 + 7.2% stability 降是 2024 年 LLM agent 给软件工程效率的第一个工业 macroscale data point。对 d2p 这一类产品的含义：**不能只 marketing "AI 加速"，要诚实面对 stability 风险**。

### 1.7 Trunk-Based Development + Hermetic Build

**Hammant, P.** <https://trunkbaseddevelopment.com/> ——**TBD**：单一长寿命 `trunk` branch，短寿命 feature branch（小时-天量级），branch-by-abstraction 处理大重构。GitFlow 长寿命 feature branch 是反模式。

**Bazel hermetic builds**（<https://bazel.build/basics/hermeticity>）——

> *"When given the same input source code and product configuration, a hermetic build system always returns the same output by isolating the build from changes to the host system."*

是 reliable remote cache + remote execution + reproducible CI 的前提。

### 1.8 CI 平台 + 工业规模

工具栈：**Jenkins**（Kawaguchi 2004 Hudson → 2011 Oracle 商标纠纷后 fork）/ **CircleCI** (2011) / **GitHub Actions** (2018 launch, 2019-11 CI/CD GA) / **GitLab CI** (2012-11)。

**Uber SubmitQueue**（EuroSys 2019，The Morning Paper summary: <https://blog.acolyer.org/2019/04/18/keeping-master-green-at-scale/>）——把 monorepo mainline green 从 ~52% 拉到持续 green。**speculation engine** 同时跑多个 pending change 的 build，只串行化 merge step。是单仓万级工程师 CI 唯一已知 scale solution。

### 1.9 行为代码分析——Tornhill

**Tornhill, A. *Your Code as a Crime Scene*, Pragmatic 2015**（<https://pragprog.com/titles/atcrime/>）和 ***Software Design X-Rays*, Pragmatic 2018**——把 VCS 历史 + 复杂度 metric 合成预测 defect-prone module。**hotspot = 高 churn × 高复杂度**是经验证的 defect prior。

对 agent 产品的意义：**用户的 commit history 是 bug 优先级的最佳信号源**。Agent 不读 git log 是浪费 leverage。

---

## 2. Site Reliability Engineering——Google 把运维做成软件工程

### 2.1 Treynor Sloss 创立 SRE

Ben Treynor Sloss 2003 加入 Google，把"运维"reframe 成"软件工程师做运维"——SRE = Site Reliability Engineer。著名定义：

> *"SRE is what happens when you ask a software engineer to design an operations function."* —— Treynor Sloss

### 2.2 Google SRE 三部曲

**Beyer, B., Jones, C., Petoff, J., Murphy, N.R. (eds.) *Site Reliability Engineering: How Google Runs Production Systems*, O'Reilly 2016**，ISBN 978-1-491-92912-4（开源 <https://sre.google/sre-book/table-of-contents/>）。

**Beyer, B. et al. (eds.) *The Site Reliability Workbook*, O'Reilly 2018**，ISBN 978-1-492-02950-2（<https://sre.google/workbook/table-of-contents/>）。

**Adkins, H. et al. (eds.) *Building Secure and Reliable Systems*, O'Reilly 2020**，ISBN 978-1-492-08312-2（<https://sre.google/books/building-secure-reliable-systems/>）。

### 2.3 Error Budget——Ch. 3

> *"100% is the wrong reliability target for basically everything. ... Once you have a target of 99.99% availability, your error budget is 0.01% — and unspent error budget is the leverage that lets you ship features."*

把 reliability 和 velocity 从对立变成 **一个 budget 两边花**：reliability 高于 SLO = 有 budget 可以多 push 新 feature；低于 SLO = 冻结 feature work。这是 SRE-era 最重要的 organizational invariant。

### 2.4 SLO / SLI / SLA——Ch. 4

- **SLI** (Service Level Indicator) —— 量测什么（latency p99、availability、error rate）
- **SLO** (Service Level Objective) —— internal 目标（如 99.95% 99 percentile latency < 200ms）
- **SLA** (Service Level Agreement) —— external 合同（违反有钱赔）

三者命名混淆是 SRE 圈最常见的入门错误。SRE Book Ch. 4 verbatim 给出 distinction。

### 2.5 Toil——Ch. 5

> *"Toil is the kind of work tied to running a production service that tends to be manual, repetitive, automatable, tactical, devoid of enduring value, and that scales linearly as a service grows."*

SRE Book 给的硬规则：**单个 SRE toil time < 50%**。超过这条把人变 ops，不是 software engineer。

### 2.6 Four Golden Signals——Ch. 6

> *"If you can only measure four metrics of your user-facing system, focus on these four."*

| Signal | 量什么 |
|---|---|
| **Latency** | 请求时长 |
| **Traffic** | 请求/s |
| **Errors** | 失败率 |
| **Saturation** | 系统满载程度 |

是 modern monitoring dashboard 的事实模板。

### 2.7 Postmortem Culture——Ch. 15

> *"Our postmortems are blameless: focus is on root cause and prevention. They are not about punishing those involved."*

Blameless postmortem 是 SRE 文化的核心 organizational ritual。给所有 incident 一个学习产出，而不是问责产出。

---

## 3. Observability——三柱与高基数

### 3.1 Dapper——distributed tracing 的奠基

**Sigelman, B.H., Barroso, L.A., Burrows, M., Stephenson, P., Plakal, M., Beaver, D., Jaspan, S., Shanbhag, C. "Dapper, a Large-Scale Distributed Systems Tracing Infrastructure,"** Google Technical Report 2010（<https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/>）。

设计目标：*"low overhead, application-level transparency, and ubiquitous deployment."* 引入 **trace ID + span + parent-child causal edge + annotation** 词汇。**采样 + instrument shared library** 而不是每服务自己埋。Zipkin / Jaeger / OpenTelemetry 都是 Dapper 嫡传。

### 3.2 OpenTelemetry——CNCF 标准

**OpenTelemetry**（<https://opentelemetry.io/>）—— 2019 由 OpenTracing + OpenCensus 合并，CNCF graduated。

> *"Instrument your code once using OpenTelemetry APIs and SDKs. Export telemetry data to any observability backend… Switch backends without touching your application code."*

事实上的 telemetry on-disk + on-wire schema。**任何 agent 想吃 production 数据，先吃 OTel-shaped event**。

### 3.3 Honeycomb + Majors 的"三柱不够"反命题

传统 observability 三柱：**metrics + logs + traces**。Charity Majors / Liz Fong-Jones / George Miranda *Observability Engineering: Achieving Production Excellence*, O'Reilly 2022，ISBN 978-1-492-07696-4——主张三柱**不够**：metrics 聚合后丢 cardinality，logs free-text 难 query，traces 没有跨 attribute 的 ad-hoc 查询能力。

替代方案：**high-cardinality 列存的 wide event**——每事件几十到几百 attribute（user_id、build_sha、region、device、feature_flag…），允许 ad-hoc query。

**BubbleUp** (<https://www.honeycomb.io/platform/bubbleup>)——用户在 heatmap 选异常区间，BubbleUp 自动 diff 所有 attribute 找出 baseline 和异常的真实差异。是 *automated outlier attribution* 的当前 SOTA。

### 3.4 eBPF——内核级 production 观察

**Gregg, B. *BPF Performance Tools: Linux System and Application Observability*, Addison-Wesley 2019**，ISBN 978-0-13-655482-0（<https://www.brendangregg.com/>）。

eBPF 让用户把 verified safe program attach 到 syscall / function entry / tracepoint，**生产级观察不需要重启、不需要 instrument、不需要符号表协作**。`bcc` / `bpftrace` 让非 kernel 工程师能用。Parca / Pixie / Polar Signals / Cilium Hubble 都基于此。

### 3.5 Sentry / Datadog / New Relic——商业基线

- **Sentry**（<https://sentry.io/>）—— stacktrace 分组 + source map + 现在加了 LLM-fronted "Issues" agent。
- **Datadog**（<https://www.datadoghq.com/>）—— *"See inside any stack, any app, at any scale, anywhere."* 2025 Gartner Observability Magic Quadrant Leader。
- **New Relic**（<https://newrelic.com/>）—— *"Intelligent Observability resolves issues at scale—before they impact your bottom line."*

任何 agent bug-finder 的商业 baseline 是这三家。

### 3.6 Majors 的"production is the only test environment"

**Majors, C. "Testing in Production: Why You Should Never Stop Doing It,"** Honeycomb blog（<https://www.honeycomb.io/blog/testing-in-production>）：

> *"Every deploy is a test. In production. Every user doing something to your site is a test in production."*
> *"You can't spin up a copy of Facebook… You can't spin up a copy of the national power grid."*

**Sridharan, C. "Testing in Production: the hard parts,"** Medium 2019（<https://copyconstruct.medium.com/testing-in-production-the-hard-parts-3f06cefaf592>）：

> *"'Testing in production' is merely the continuous and ongoing verification that the system does indeed function as designed."*

这是 testing-in-prod 学派的两大文献。对 agent 产品的含义：**bug-finder agent 必须能消费 production telemetry，不能只跑 pre-prod test**。

---

## 4. Chaos Engineering

### 4.1 思想前史——Crash-Only + ROC

**Candea, G. & Fox, A. "Crash-Only Software,"** *HotOS-IX 2003*（<https://www.usenix.org/legacy/events/hotos03/tech/full_papers/candea/candea.pdf>）。命题：**唯一 shutdown 路径就是 crash**——这样每个组件本来就被设计成 crash-recover。是 Chaos Monkey "随机杀 instance" 哲学基础。

**Patterson et al. "Recovery-Oriented Computing (ROC): Motivation, Definition, Techniques, and Case Studies,"** UC Berkeley TR UCB/CSD-02-1175, 2002（<https://www2.eecs.berkeley.edu/Pubs/TechRpts/2002/5574.html>）。

> *"Recovery Oriented Computing (ROC) takes the perspective that hardware faults, software bugs, and operator errors are facts to be coped with, not problems to be solved."*

把 dependability 度量从 MTTF (Mean Time To Failure) 转 **MTTR (Mean Time To Recover)**。是 chaos engineering 的哲学前提。

### 4.2 Netflix Simian Army——2011

Netflix Tech Blog 2011-07-19 "The Netflix Simian Army"（<https://netflixtechblog.com/the-netflix-simian-army-16e57fbab116>）。

- **Chaos Monkey** —— 随机杀 cluster instance
- **Latency Monkey** —— RPC 注入延迟
- **Conformity Monkey** —— 找不合规 instance
- **Doctor Monkey** —— health check
- **Janitor Monkey** —— 清理 unused resource
- **Security Monkey** —— 找 SG 配置 / SSL 过期
- **10-18 Monkey** —— l10n / i18n 问题
- **Chaos Gorilla** —— 模拟整个 AZ 挂

把"你的服务必须容忍 peer 缺失"从季度演习变成**持续 enforced invariant**。

### 4.3 Principles of Chaos——manifesto

**Rosenthal, C. et al.** <https://principlesofchaos.org/>。

> *"Chaos Engineering is the discipline of experimenting on a system in order to build confidence in the system's capability to withstand turbulent conditions in production."*

四步法：
1. 定义 **steady state** 作为正常行为的可测 output
2. 假设 steady state 在 control 和 experimental 组都将持续
3. 引入反映现实事件的变量（server crash / disk fail / network partition）
4. 试图通过 detect steady state 在两组的差异**反证**该假设

5 个 advanced principle：Build a Hypothesis around Steady-State Behavior / Vary Real-World Events / Run Experiments in Production / Automate Experiments to Run Continuously / Minimize Blast Radius。

### 4.4 学术化 + 工业化

**Basiri, A. et al. "Chaos Engineering,"** *IEEE Software* 33(3), May/June 2016, pp. 35–41, DOI 10.1109/MS.2016.60（arXiv:1702.05843）。第一篇 peer-reviewed 学术 chaos engineering 论文。

**Rosenthal, C. & Jones, N. *Chaos Engineering: System Resiliency in Practice*, O'Reilly 2020**，ISBN 978-1-492-04386-7。标准实战书。

**Gremlin**（<https://www.gremlin.com/>）—— Kolton Andrus (ex-Netflix Chaos Team) + Matthew Fornaciari (ex-Amazon) 2016 创立。"Failure as a Service"——hosted SaaS 化 chaos engineering。

**Toxiproxy** (<https://github.com/Shopify/toxiproxy>) / **Chaos Mesh** (<https://chaos-mesh.org/>，CNCF) / **LitmusChaos** (<https://litmuschaos.io/>，CNCF) —— 三大开源工具栈。

### 4.5 AWS Well-Architected 正式化

**AWS Well-Architected Reliability Pillar, REL12-BP04 / REL12-BP05** —— 2018 起 AWS 把 chaos engineering 写进 Well-Architected Framework 作为 official guidance。

> *"Chaos engineering provides your teams with capabilities to continually inject real world disruptions (simulations) in a controlled way at the service provider, infrastructure, workload, and component level, with minimal to no impact to your customers."*

这是 chaos engineering 从 Netflix 文化跨入 hyperscaler 标准的标志。AWS Fault Injection Service (FIS) 是配套工具。

---

## 5. Feature Flag + Experimentation

### 5.1 Hodgson taxonomy 2017

**Hodgson, P. "Feature Toggles (aka Feature Flags),"** martinfowler.com 2017-10-09（<https://martinfowler.com/articles/feature-toggles.html>）。

按 longevity × dynamism 两维四类：
- **Release Toggle** —— 短寿命，部署/发布解耦
- **Experiment Toggle** —— A/B 测试
- **Ops Toggle** —— 永久，性能 / 容量 / 紧急 kill switch
- **Permission Toggle** —— 永久，feature entitlement

> *"With feature-flagged systems our Continuous Delivery process becomes more complex, particularly in regard to testing."*

每个 live toggle 都把可执行 config 空间乘倍。Agent bug-finder 必须 flag-aware（读 toggle store / 枚举 cohort）。

### 5.2 工业平台

**LaunchDarkly** (<https://launchdarkly.com/>) —— Harbaugh + Kodumal 2014 创立，category-defining。

**Statsig** (<https://statsig.com/>) —— 2021，新一代 experimentation + 用户分析；OpenAI 是公开客户。

**Optimizely** (<https://www.optimizely.com/>) —— Siroker + Koomen 2010，in-browser A/B testing 先驱。

### 5.3 Dark Launch——Facebook 2008

**Letuchy, E. "Facebook Chat,"** Engineering at Meta 2008-05-13（<https://engineering.fb.com/2008/05/13/web/facebook-chat/>）。"dark launch"一词正式入业界。

> *"A 'dark launch' period in which Facebook pages would make connections to the chat servers, query for presence information and simulate message sends without a single UI element drawn on the page."*

是 modern shadow traffic / ghost traffic / tee-based testing 的祖父。

### 5.4 Canary Release——Sato 2014

**Sato, D. "CanaryRelease,"** martinfowler.com bliki 2014-06-25（<https://martinfowler.com/bliki/CanaryRelease.html>）：

> *"Canary release is a technique to reduce the risk of introducing a new software version in production by slowly rolling out the change to a small subset of users before rolling it out to the entire infrastructure."*

### 5.5 Kohavi Trustworthy Experiments

**Kohavi, R., Henne, R.M., Sommerfield, D. "Practical guide to controlled experiments on the web,"** *KDD 2007*, DOI 10.1145/1281192.1281295（<https://ai.stanford.edu/~ronnyk/2007GuideControlledExperiments.pdf>）。

> *"One accurate measurement is worth more than a thousand expert opinions."* —— Grace Hopper (paper epigraph)

引入 **HiPPO** (Highest-Paid Person's Opinion) 框架 + 实验架构 / randomization / hashing pitfall / statistical power 标准化。

**Kohavi, R., Tang, D., Xu, Y. *Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing*, Cambridge UP 2020**（<https://experimentguide.com/>），ISBN 978-1-108-72426-5。当前标准教科书。覆盖 SRM / peeking / multiple comparisons / **Twyman's Law**（任何看起来有趣或不寻常的数字通常是错的——extraordinary claim 要求 extraordinary proof）。

### 5.6 OpenFeature——CNCF 标准

**OpenFeature**（<https://openfeature.dev/>，CNCF incubating，Apache-2）。Vendor-neutral feature flag SDK：单一 API `client.getBooleanValue(...)` 后端可以是 LaunchDarkly / Statsig / Flagd / Unleash / ConfigCat / GrowthBook。**像 OpenTelemetry 一样消除 vendor lock-in**。

---

## 6. Production Debugging——record-replay + time-travel

### 6.1 rr——Mozilla 把 record-replay 工业化

**O'Callahan, R., Jones, C., Froyd, N., Huey, K., Noll, A., Partush, N. "Engineering Record And Replay For Deployability,"** *USENIX ATC 2017*（arXiv:1705.05937，主页 <https://rr-project.org/>）。

deterministic record + replay for Linux user-space C/C++：捕获 syscall / signal / scheduling，replay 时 100% 重现。**整个 firefox test suite slowdown 仅 ~1.2×**——modest 到能日常用。`gdb` reverse-step / reverse-continue 在 rr backend 下变得真正可用。

### 6.2 GDB Reverse Execution

**GDB Reverse Execution** 从 GDB 7.0 (2009) 起支持（<https://sourceware.org/gdb/current/onlinedocs/gdb/Reverse-Execution.html>）—— `reverse-continue` / `reverse-step` / `reverse-stepi` / `reverse-next` / `reverse-finish` / `set exec-direction`。

> *"Some side effects are easier to undo than others. For instance, memory and registers are relatively easy, but device I/O is hard."*

### 6.3 Pernosco——rr + cloud-indexed

**Pernosco**（<https://pernos.co/>）—— O'Callahan 等创立的商业 rr 升级版。把 rr trace 上传，indexed 服务化的 omniscient debugger：每个变量每时刻的值 / data-flow + control-flow back-pointer / shareable notebook。**用户报告"a typical bug is quashed about 5 times faster"**。

### 6.4 WinDbg Time Travel Debugging

**Microsoft WinDbg TTD** 2017 起（<https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/time-travel-debugging-overview>）。`.run` trace + `.idx` index，WinDbg scrub forward/backward，LINQ-queryable data model object。Recording overhead ~10-20×；playback read-only。

### 6.5 Replay.io——JS 时代的 time-travel

**Replay.io**（<https://replay.io/>）——记录每次 Playwright CI run（DOM + network + JS execution），跑 agent 把 failure 归因到具体源码行 + 自动 PR comment。**ships Replay MCP** 让 IDE 里的 coding agent 查询同一份 time-travel data。**是当前最直接的 "AI agent reading a replay" 模板**。

---

## 7. AI-Before-Agents——LLM 之前的 AI 测试生成

### 7.1 EvoSuite 工业化——SEB Life & Pension 2017

**Almasi, M.M., Hemmati, H., Fraser, G., Arcuri, A., Benefelds, J. "An Industrial Evaluation of Unit Test Generation: Finding Real Faults in a Financial Application,"** *ICSE-SEIP 2017*（<https://www.evosuite.org/wp-content/papercite-data/pdf/icse17_experience.pdf>）。

EvoSuite (search-based) + Randoop 对比 SEB Life & Pension Riga 的人寿/养老保险产品 calculator 引擎。**生成测试套件 detect 高达 56.40% (EvoSuite) 和 38.00% (Randoop) 的真实 fault**。第一个学术 search-based test gen 在受监管金融行业的工业落地。

### 7.2 Pynguin——Python 上的 EvoSuite

**Lukasczyk, S. & Fraser, G. "Pynguin: Automated Unit Test Generation for Python,"** *ICSE 2022 Demo*, arXiv:2202.05218（<https://www.pynguin.eu/>）。把 search-based test gen 带进 Python——动态类型靠 type annotation + runtime observation 推。

### 7.3 Snyk Code (← DeepCode)

DeepCode 2020 被 Snyk 收购、改名 **Snyk Code**（<https://snyk.io/>）。是早期把 static analysis 当 ML 问题（从 OSS commit 学 vulnerability pattern）的商业落地。

### 7.4 GitHub Copilot Autofix——LLM 进 code scanning

**Hanley, M. "Found means fixed: Secure code more than three times faster with Copilot Autofix,"** GitHub Blog 2024-08-14（<https://github.blog/news-insights/product-news/secure-code-more-than-three-times-faster-with-copilot-autofix/>）。

公开 beta 数据：**Autofix 让开发者修漏洞比 manual 快 3+ 倍**——median 28 分钟 vs 1.5 小时；XSS 7×、SQL injection 12×。

### 7.5 PBT 工业 case

- **Hypothesis at Stripe** —— Ritchie, S. "Supporting Hypothesis," Stripe Blog 2017-09-01（<https://stripe.com/blog/hypothesis>）。Stripe 资助 MacIver 的 Hypothesis 库。用例：Radar fraud-detection ML pipeline 的统计 invariant。
- **Quviq QuickCheck** —— John Hughes + Thomas Arts（<https://quviq.com/>）。客户：Ericsson、Volvo Cars、AUTOSAR 联盟。是 PBT 跨进 safety-relevant embedded system 最长运行的工业证据。
- **Jane Street Base_quickcheck** —— OCaml PBT 库（<https://github.com/janestreet/base_quickcheck>）。量化金融公司把 PBT 作 table stakes。

---

## 8. Continuous Verification——production-grade formal methods 的现代化

### 8.1 AWS S3 ShardStore——Lightweight Formal Methods

**Bornholt, J. et al. (12 authors). "Using Lightweight Formal Methods to Validate a Key-Value Storage Node in Amazon S3,"** *SOSP 2021* (Best Paper), DOI 10.1145/3477132.3483540（<https://jamesbornholt.com/papers/shardstore-sosp21.pdf>）。

把 formal methods 操作化成**持续 CI 活动**而非一次性证明：可执行 reference model + conformance checking + bounded property exploration。**ShardStore 上找到 16 个深度 bug，代码 overhead ~14%**。

这是 modern continuous verification 在 production storage 上的标杆 case study。

### 8.2 FoundationDB DST + Antithesis

**Wilson, W. "Testing Distributed Systems w/ Deterministic Simulation,"** *Strange Loop 2014*（<https://www.youtube.com/watch?v=4fFDFbi3toc>）。

FoundationDB 团队建 mocked network / filesystem / clock，整个 db 跑在 single-threaded simulator 里 + 注入 failure。**确定性让一个观测到的 bug 永远可复现**。Antithesis、TigerBeetle、Resonate、sled 都沿这条线。

**Antithesis**（<https://antithesis.com/>）—— Will Wilson 创立的商业 DST as a service。公开 case：Confluent 40× 更快 change verification、MongoDB 找出 75+ severe bug 其他方法漏掉。

### 8.3 Jepsen

**Kingsbury, K. *Jepsen — Distributed Systems Safety Research*,** <https://jepsen.io/>。

工作负载 generator + 故障注入器 (network partition / clock skew / process crash) + linearizability / isolation checker (Knossos / Elle)。把"vendor 说 X 一致性"变成"在 1000 次 fault run 里真实发生 Y"。Jepsen report 已成分布式 db 正确性 claim 的 de-facto 外部审计。

### 8.4 Sridharan——continuous verification as SRE practice

**Sridharan, C. "Testing in Production: the hard parts,"** Medium 2019-09-29（<https://copyconstruct.medium.com/testing-in-production-the-hard-parts-3f06cefaf592>）—— 把 testing-in-prod 重新框定为 SRE 时代的 **continuous verification**：持续观察 + probe live system。

---

## 9. 这一条道路的整体形状

把 1996–2026 三十年压成几个轴：

| 年代 | CI/CD | 运维质量 | observability | 测试范式 |
|---|---|---|---|---|
| **1990s** | Booch "CI" 一词 | (separate ops) | log file | unit test |
| **2000s 早** | Beck XP 1999 + Fowler CI | crash-only / ROC | Dapper 2010 | TDD + acceptance test |
| **2010s** | Humble-Farley CD + Kim Phoenix | Google SRE Book + error budget | OTel + Honeycomb 高基数 | Chaos Monkey + Jepsen + Hypothesis |
| **2020s** | Accelerate + DORA Four Keys | SRE 工作坊 + secure & reliable systems | OTel 标准化 + eBPF + Replay.io | DST + Antithesis + S3 lightweight FM + LLM agent |

反复出现的 pattern：**每一代 quality engineering practice 都把上一代的"特例"变成"基础设施"**——unit test 是 1990s 的特例，2010s 的基础设施；canary release 是 2010s 的特例，2020s 的基础设施。当前 LLM agent 处在"特例"阶段，2030s 大概率变基础设施。**d2p 这一类产品要设计成"我们是 next decade 的 basic infra"而不是"我们是当下的高端工具"**。

第二个 pattern：**production telemetry 是 ground truth，pre-prod test 只能 approximate**。Sridharan / Majors / DORA / S3 ShardStore 都指向同一个真相。**Agent bug-finder 必须能消费 production 数据，不能只靠 dev 时的 static analysis + test execution**——否则你测的不是真实系统。

第三个 pattern：**economic model 在变**。Boehm 1981 的 "100× 后期代价" 在 cloud-native + canary + fast rollback 下不再绝对，但**对 stateful system 仍然适用**（Brooker doc 4 §2.8）。Agent 产品要按 target system class 分别设计：stateless web app push canary + rollback，stateful system push upfront verification。

---

## 📚 还该读什么

1. **Forsgren, Humble, Kim *Accelerate*, IT Revolution 2018** —— Four Keys 的统计基础。读完知道为什么 stability 和 throughput 不是 trade-off。
2. **Google SRE Book + Workbook + Building Secure and Reliable Systems**（<https://sre.google/books/>）—— 三部曲免费可读。Error budget / SLO / toil / postmortem culture 在这里学。
3. **Majors, Fong-Jones, Miranda *Observability Engineering*, O'Reilly 2022**——为什么 metrics+logs+traces 三柱不够，high-cardinality wide event 是替代方案。
4. **Rosenthal & Jones *Chaos Engineering: System Resiliency in Practice*, O'Reilly 2020**——chaos engineering 实战手册，Netflix-only 文化故事之外。
5. **Bornholt et al. "Using Lightweight Formal Methods to Validate a Key-Value Storage Node in Amazon S3," SOSP 2021**（<https://jamesbornholt.com/papers/shardstore-sosp21.pdf>）——continuous verification 在 production storage 上的当前 SOTA case study。

## ❓ 我还没搞清楚的 3 个问题

1. **DORA 2024 报 AI 让 stability -7.2% 是 short-term effect 还是 structural？** 如果 2025 / 2026 DORA report 趋势反转（AI 反而提升 stability），整个 LLM agent 在 DevOps 里的 framing 会变。
2. **Antithesis / DST as a service 在 2026 商业落地到什么程度？** Confluent / MongoDB 是 public case，但 mid-market SaaS 公司能不能负担 / 配合得了 DST 还没看到数据。这关系到 d2p 该不该把 DST 当作 default 验证范式。
3. **OpenFeature CNCF 标准在 2026 实际 adoption 率多少？** 如果它真的像 OpenTelemetry 一样成为事实标准，agent 产品只要 integrate OpenFeature 就 cross-vendor compatible；如果它没起来，agent 要给每家 LaunchDarkly / Statsig 单独写 adapter。

## 💡 对产品的具体启发

1. **DORA Four Keys 是 marketing 最好用的语言。**用户 already 用这套度量评估自己——agent 产品给自己定 KPI "我们把 lead time 从 X 降到 Y、change failure rate 从 P 降到 Q" 最有说服力。
2. **学 Honeycomb 高基数 wide event 模型而不是 metric + log。**agent 内部 telemetry / agent-to-user 报告应该是 attribute-rich event，每条 finding 带 file / line / commit / author / risk_class / confidence / similar_past_bug 等多 attribute——下游用户能 ad-hoc query。
3. **拥抱 testing in production——但区分 stateless vs stateful。**Stateless web app push canary + dark launch + observability，agent 在 production telemetry 上跑；stateful system push S3-style lightweight formal methods + DST，agent 在 simulation 上跑。**不要把两种 system class 当成同一个产品**。
4. **学 Pernosco 5× 加速的 economics framing。**Agent 产品对外的 ROI claim 应该是"快多少倍 close bug"，不是"recall %"。前者用户立刻懂，后者要解释半天。
5. **学 OpenFeature / OpenTelemetry 的中立标准 framing。**长远讲 agent 产品要在 vendor-neutral 接口上跑——OpenTelemetry 吃 trace / OpenFeature 吃 flag / OTel logs 吃 log。一旦绑某一家（Datadog / LaunchDarkly / Sentry），enterprise sales 就被锁。

---

**文档边界**

这份只到 CI/CD-era / SRE-era / observability-era / DST-era 的现代质量工程。**Agent 时代的综合 + 5 个保留 + 5 个抛弃 + 对照表**留给 doc 6——下一份。
