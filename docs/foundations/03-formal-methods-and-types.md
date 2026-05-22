# 03 — 形式方法与类型系统

> Doc 1+2 是「通过测试找 bug」那条线（testing as falsification）。
> 这一份是另一条道路：**通过证明排除 bug**（verification as deduction）。
> 历史上两条线互相敌对——Dijkstra 1969 那句 "testing shows presence not absence" 是这条线的奠基宣言。
> 在 LLM agent 时代它们正在融合——proof assistant 上的 AI tactic、SMT-solver 后端的 LLM 引导，是当前最热的研究前沿。

---

## 0. 这条道路在解决什么不同的问题

Testing 是 **sampling**：跑 N 个 input，没崩 = N 次没崩。Hamlet 1987 已证 N 必须巨大才有意义的概率上界。

Formal methods 是 **deduction**：在 program / spec 上做数学证明，结论是「对所有合法 input 都成立」。代价是写 spec + 写 invariant + 选合适的抽象——这部分人类成本高到工业界长期回避。

但有 4 个领域 ROI 算得过来：
1. **航空 / 安全关键嵌入式** —— Astrée 证明 Airbus A340/A380 fly-by-wire 无 runtime error。
2. **OS kernel** —— seL4 是史上第一个被完整证明 functional correctness 的通用内核。
3. **密码学 / 协议** —— Microsoft Project Everest 用 F\* 证明 TLS 1.3 / HACL\*，shipping 在 Firefox / Linux / Tezos。
4. **分布式系统 design-level spec** —— AWS 用 TLA+ 在 DynamoDB / S3 / EBS 找到了 35-step counterexample，"没有 review + test 能发现"。

这四个领域的共同点：**bug 一旦发生，代价不是 100 倍而是 10^4 倍**。Astrée、seL4、F\*、TLA+ 都不便宜，但便宜过坠机 / 漏密钥 / 数据丢失。

---

## 1. 公理语义——Floyd 1967 / Hoare 1969 / Dijkstra 1975

### 1.1 Floyd 1967——给程序赋意义

**Floyd, R.W. "Assigning Meanings to Programs,"** *Proc. AMS Symposia in Applied Mathematics* vol. 19, 1967, pp. 19–32（PDF 镜像：<https://courses.grainger.illinois.edu/cs477/sp2015/floyd.pdf>）。

Floyd 第一次系统地给 flowchart 程序的每个点贴 logical assertion，用 induction over flow graph 证明 partial-correctness、total-correctness、equivalence、termination。引入 verification condition、inductive assertion、well-founded set for termination——是 Hoare triple / model checking / 现代 static analyzer 的共同祖父。

ACM Turing Award 1978。

### 1.2 Hoare 1969——Hoare triple

**Hoare, C.A.R. "An Axiomatic Basis for Computer Programming,"** *CACM* vol. 12 no. 10, Oct 1969, pp. 576–580, 583, DOI 10.1145/363235.363259（CMU 镜像：<https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf>）。

Hoare 把 Floyd 的 flowchart-level 公理化提升到**程序文本上**的语法层级——`{P} S {Q}`：如果 P 在 S 执行前成立、S 终止、那么 Q 在执行后成立。给出 assignment / composition / conditional / iteration 的推理规则。今天所有 Hoare-logic verifier（Dafny / Frama-C / KeY / OpenJML / Why3）都是这套规则的直接后裔。

> *"Computer programming is an exact science in that all the properties of a program and all the consequences of executing it in any given environment can, in principle, be found out from the text of the program itself by means of purely deductive reasoning."*

Turing Award 1980。

### 1.3 Dijkstra 1975 / 1976——weakest precondition + guarded commands

**Dijkstra, E.W. "Guarded commands, nondeterminacy and formal derivation of programs,"** *CACM* vol. 18 no. 8, Aug 1975, pp. 453–457, DOI 10.1145/360933.360975（EWD472, <https://www.cs.utexas.edu/~EWD/transcriptions/EWD04xx/EWD472.html>）；book-length: *A Discipline of Programming*, Prentice-Hall 1976, ISBN 0-13-215871-X。

引入：
1. **Guarded commands** `if B1 -> S1 [] B2 -> S2 fi` —— 多个 guard 同时成立时**显式 nondeterministic 选择**。
2. **`wp(S, R)`** —— 让 S 终止于满足 R 状态所需的**最弱前置条件**。

> *"We shall use the notation 'wp(S, R)' to denote the weakest pre-condition for the initial state such that activation of S is guaranteed to lead to a properly terminating activity leaving the system in a final state satisfying the post-condition R."* —— EWD472

这套 calculus 是后面 refinement calculus（Back & von Wright 1998；Morgan 1994 *Programming from Specifications*, <https://www.cs.ox.ac.uk/publications/books/PfS/>）和现代 verification condition generator 的数学骨架。

### 1.4 Hoare 1978——CSP

**Hoare, C.A.R. "Communicating Sequential Processes,"** *CACM* vol. 21 no. 8, Aug 1978, pp. 666–677, DOI 10.1145/359576.359585。

input / output / parallel composition 作为 first-class primitive；同步通信代替共享内存。这是 occam / Go channel / Erlang / Rust async / Elixir 的祖父，也是 doc 5 chaos engineering 时代 concurrency 模型的源头。

---

## 2. 三大规约语言——Z / VDM / B

### 2.1 Z

**Spivey, J.M. *The Z Notation: A Reference Manual*, 2nd ed.**, Prentice Hall 1992, ISBN 0-13-978529-9（开源镜像：<https://www.cs.umd.edu/~mvz/handouts/z-manual.pdf>）。

基于 typed set theory + predicate logic + **schema calculus**——给规约一种「模块化」的结构。IBM CICS reverification、ProofPower、Z/Eves 都基于它。Z 的 schema 直接影响了 B 和 TLA+。

### 2.2 VDM

**Jones, C.B. *Systematic Software Development Using VDM*, 2nd ed.**, Prentice Hall 1990（Newcastle 主页：<https://www.ncl.ac.uk/computing/people/profile/cliffjones.html>）。

来自 IBM Vienna 的 PL/I formal semantics 项目。和 Z 的差别：**显式 pre/postcondition operation spec**，**partial function via Logic of Partial Functions (LPF)**，data reification with retrieve function。ISO/IEC 13817-1 / Overture / VDMTools 是它的现代化身。

### 2.3 B method + Météor / Paris Métro line 14

**Abrial, J.-R. *The B-Book: Assigning Programs to Meanings*, Cambridge University Press 1996, ISBN 0-521-49619-5**。

Abrial（也是 Z 的发明者）后来设计 B method：set-theoretic spec via **Abstract Machine** + **Generalised Substitution Language (GSL)** + 自动 / 半自动 refinement。Proof obligation 由 Atelier B / ProB 验。

**工业 case：Behm, P., Benoit, P., Faivre, A., Meynadier, J.-M. "Météor: A Successful Application of B in a Large Project,"** *FM 1999*, LNCS 1708, pp. 369–387, DOI 10.1007/3-540-48119-2_22 —— **RATP/Matra/Siemens 用 B 开发 Paris Métro Line 14 (Météor)** 的 Software Automatic Train Operation。1998 年 10 月开通，巴黎第一条全自动驾驶地铁线。formally specified Abstract Machine 经 Atelier B refine 到 Ada，所有 proof obligation 在部署前 discharge。

后续 Event-B（Rodin 平台）继承了这条线索，被用于 Eurostar / 核电厂 / 汽车 ECU。

---

## 3. Model Checking——把无穷状态空间变可决定

### 3.1 Pnueli 1977 LTL

**Pnueli, A. "The Temporal Logic of Programs,"** *FOCS 1977*, pp. 46–57, DOI 10.1109/SFCS.1977.32。

把 Prior 的 tense logic 引进计算机科学，作为 **reactive system**（never-terminating program: OS, controller, distributed protocol）的规约语言。Hoare pre/postcondition 在 non-terminating program 上塌掉；LTL 给了 "safety"（`G ¬bad`）和 "liveness"（`F good`）以及 `X`、`U` 一套词汇。

Turing Award 1996："*for seminal work introducing temporal logic into computing science and for outstanding contributions to program and systems verification.*"

### 3.2 Clarke-Emerson 1981 / Queille-Sifakis 1982——model checking 诞生

**Clarke, E.M. & Emerson, E.A. "Design and Synthesis of Synchronization Skeletons Using Branching Time Temporal Logic,"** *Workshop on Logics of Programs 1981*, Springer LNCS 131, pp. 52–71 —— 引入 CTL + 第一个 polynomial-time model-checking 算法。

**Queille, J.-P. & Sifakis, J. "Specification and Verification of Concurrent Systems in CESAR,"** *Symposium on Programming 1982*, LNCS 137, pp. 337–351, DOI 10.1007/3-540-11494-7_22 —— 同期独立 Grenoble 团队搞出 **CESAR**，第一个 running model checker。

两条独立 1981–82 发明之路解释了 2007 Turing 共授（Clarke + Emerson + Sifakis）：*"for their roles in developing model checking into a highly effective verification technology."*

### 3.3 SPIN——explicit-state 引擎

**Holzmann, G.J. "The Model Checker SPIN,"** *IEEE TSE* vol. 23 no. 5, May 1997, pp. 279–295, DOI 10.1109/32.588521（主页：<https://spinroot.com/spin/whatispin.html>）。

Promela（C-like guarded-command 建模语言）+ LTL / never-claim 规约 + **on-the-fly state exploration + partial-order reduction + bitstate hashing**。ACM System Software Award 2002。Holzmann 2003 进 NASA JPL，把 SPIN 用于飞行软件。

### 3.4 BDD-based / SAT-based

**McMillan, K.L. "Symbolic Model Checking: An Approach to the State Explosion Problem,"** PhD CMU 1992；Kluwer 1993 ISBN 0-7923-9380-5 —— 用 Ordered Binary Decision Diagram (Bryant 1986) 表示 transition relation / reachable set，让 10^20+ state 的硬件能验。SMV → NuSMV → nuXmv 是这条线的工具。

**Biere, A., Cimatti, A., Clarke, E.M., Zhu, Y. "Symbolic Model Checking without BDDs,"** *TACAS 1999*, LNCS 1579, pp. 193–207, DOI 10.1007/3-540-49059-0_14 —— **Bounded Model Checking (BMC)**：unroll transition relation `k` 步，编码成 SAT 实例，"是否有长度 ≤k 的 counterexample？" 不证整体正确，只找有限深度的 bug，但因为 SAT solver 工业化（Chaff、MiniSat），速度上吊打 BDD。CBMC / ESBMC / SeaHorn 是后裔。

### 3.5 TLA+ 与 AWS——分布式系统的工业胜利

**Lamport, L. *Specifying Systems: The TLA+ Language and Tools for Hardware and Software Engineers*,** Addison-Wesley 2002, ISBN 0-321-14306-X（<https://lamport.azurewebsites.net/tla/book.html>）。

TLA+ = Pnueli temporal logic + Lamport 自己的 action-based concurrency model。规约写成 set-theoretic 数学；TLC model checker 跑 finite instance；TLAPS 做 proof。syntax 是数学教科书不是编程语言，反而**工业界更易接受**。

**Newcombe, C., Rath, T., Zhang, F., Munteanu, B., Brooker, M., Deardeuff, M. "How Amazon Web Services Uses Formal Methods,"** *CACM* vol. 58 no. 4, April 2015, pp. 66–73, DOI 10.1145/2699417（开源 PDF: <https://assets.amazon.science/67/f9/92733d574c11ba1a11bd08bfb8ae/how-amazon-web-services-uses-formal-methods.pdf>）。

是 2010s 最被引的工业 formal methods 案例。AWS 工程师（不是研究员）从 2011 年起在 DynamoDB / S3 / EBS / 内部 lock manager 上用 TLA+。最著名的发现：**一个 35 high-level step 的 DynamoDB counterexample，"that could lead to losing data if a particular sequence of failures and recovery steps was interleaved with other processing"**，且 *"had passed unnoticed through extensive design reviews, code reviews, and testing."*

对 agent 产品的实际含义：**concurrency / distributed-system bug 的"实际深度"在 30+ steps 量级**。LLM agent 想抓这一类 bug，必须有处理 30+ step interleaving 的能力——这是 model checking 给的能力，单纯 testing 给不了。

### 3.6 SLAM——Microsoft Windows Driver Verifier

**Ball, T. & Rajamani, S.K. "The SLAM Project: Debugging System Software via Static Analysis,"** *POPL 2002*, DOI 10.1145/503272.503274（项目页：<https://www.microsoft.com/en-us/research/project/slam/>）。

**Predicate abstraction + CEGAR (Counterexample-Guided Abstraction Refinement)**：把 C 程序抽象成 Boolean program (BEBOP model checker)，跑 model checking；如果出 false alarm，refine 抽象（Newton predicate discovery）；迭代到收敛。

SDV (Static Driver Verifier) 集成进 Windows Driver Kit，SLAM2 (FMCAD 2010) 把 false alarm 压到 **<4%**。Microsoft Driver Quality Team 拿 2009 Engineering Excellence Award。

**这个 <4% 是工业 static analysis 接受度的天花板**——超过这个 false-positive rate，开发者会忽略所有报告。

### 3.7 Vardi 2001——LTL vs CTL 终局

**Vardi, M.Y. "Branching vs. Linear Time: Final Showdown,"** *TACAS 2001*, LNCS 2031, pp. 1–22, DOI 10.1007/3-540-45319-9_1（<https://www.cs.rice.edu/~vardi/papers/etaps01-ver13.pdf>）。

行业 1990s 普遍认为「CTL polynomial-time、LTL PSPACE-complete，所以 CTL 是 right logic」。Vardi 论证：CTL 作为**规约语言**有根本缺陷——"*unintuitive and hard to use, it does not lend itself to compositional reasoning, and it is fundamentally incompatible with semiformal verification.*"

工业最终选 LTL：PSL、SystemVerilog SVA、TLA+ 都是 linear-time 语义。CTL 留在 NuSMV / nuXmv 学术工具里。

**对 agent 产品的意义**：如果 agent 要 emit specification 语言，emit LTL，不要 emit CTL。

---

## 4. Abstract Interpretation——Cousot 给"sound 近似"一个数学框架

### 4.1 Cousot 1977 / 1979 奠基

**Cousot, P. & Cousot, R. "Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs by Construction or Approximation of Fixpoints,"** *POPL 1977*, DOI 10.1145/512950.512973（<https://www.di.ens.fr/~cousot/COUSOTpapers/POPL77.shtml>）。

> *"A program denotes computations in some universe of objects. Abstract interpretation of programs consists in using that denotation to describe computations in another universe of abstract objects, so that the results of abstract execution give some information on the actual computations."*

POPL 1979 (DOI 10.1145/567752.567778) 用 **Galois connection** 给出从 concrete domain 到 abstract domain 的 systematic 推导方法。每一个现代 static analyzer 谈"interval / polyhedra / octagon / widening"，都在这个框架下。

### 4.2 Astrée——零 false alarm 的 Airbus 验证

**Blanchet, B., Cousot, P., Cousot, R., Feret, J., Mauborgne, L., Miné, A., Monniaux, D., Rival, X. "A Static Analyzer for Large Safety-Critical Software,"** *PLDI 2003*, DOI 10.1145/781131.781153（<https://www.di.ens.fr/~cousot/COUSOTpapers/PLDI03.shtml>）。

Astrée 专攻 C 同步嵌入式控制软件，证明**absence of runtime error**（overflow / div-by-zero / array OOB / invalid pointer）。著名战绩：**在 Airbus A340 / A380 fly-by-wire primary control software 上跑出零 false alarm**——这是 sound 静态分析在工业最罕见的成就。

> *"We show that abstract interpretation-based static program analysis can be made efficient and precise enough to formally verify a class of properties for a family of large programs with few or no false alarms."*

秘诀：组合多个专用 abstract domain（interval、octagon、ellipsoid、decision tree），按程序族 parametrize。这是 abstract interpretation 在工业唯一打通的姿势——不通用，按 domain 专门化。

### 4.3 Coverity——Engler 把它做成商业

**Engler, D., Chelf, B., Chou, A., Hallem, S. "Checking System Rules Using System-Specific, Programmer-Written Compiler Extensions,"** *OSDI 2000*；**Engler, D., Chen, D.Y., Hallem, S., Chou, A., Chelf, B. "Bugs as Deviant Behavior: A General Approach to Inferring Errors in Systems Code,"** *SOSP 2001*, DOI 10.1145/502034.502041。

Stanford 组的 Metal / xgcc 系统：让工程师写 **system-specific compiler extension**（"spin_lock 必须匹配 spin_unlock"、"user pointer 必须先 validate"），靠 Metal infrastructure 跑跨整个 codebase。SOSP 2001 加 statistical inference："**bug 是 majority programmer 行为的偏离**，分析器自己从代码挖规则。"

商业化为 Coverity Inc.，2014 年被 Synopsys ~$375M 收购。

**Bessey, A. et al. "A Few Billion Lines of Code Later: Using Static Analysis to Find Bugs in the Real World,"** *CACM* 53(2), Feb 2010, pp. 66–75, DOI 10.1145/1646353.1646374（<https://lwn.net/Articles/374255/>）——10 年商业化的诚实复盘。金句：

> *"No bug is too foolish to check for. Given enough code, developers will write almost anything you can think of."*
> *"Parsing is considered a solved problem. Unfortunately, this view is naïve, rooted in the widely believed myth that programming languages exist."*

这两句话对 agent 产品同样适用——**用户的代码长什么样比你想的离谱得多**。

### 4.4 Facebook Infer——continuous reasoning

**Calcagno, C., Distefano, D., Dubreil, J., Gabi, D., Hooimeijer, P., Luca, M., O'Hearn, P., Papakonstantinou, I., Purbrick, J., Rodriguez, D. "Moving Fast with Software Verification,"** *NFM 2015*, DOI 10.1007/978-3-319-17524-9_1（<https://fbinfer.com/>）。

来自 Monoidics（O'Hearn 团队，Facebook 2013 收购）的 separation logic + bi-abduction 做 compositional inter-procedural shape analysis。关键不是定理而是**集成模式**——只在 code review 的 diff 上报 bug，让开发者 in-flow 改。每天扫数千个 diff 的 codebase, 数十亿 user。

O'Hearn 2018 LICS 主题演讲叫这个范式 **Continuous Reasoning**——验证不是 batch 一次跑全 codebase，是嵌进 code review pipeline 持续跑 diff。对 agent 产品直接相关：**agent 的产品形态应是 continuous reasoner 而不是 batch tool**。

### 4.5 ESC/Java / CodeQL / Sadowski 2018

**Flanagan, C., Leino, K.R.M., Lillibridge, M., Nelson, G., Saxe, J.B., Stata, R. "Extended Static Checking for Java,"** *PLDI 2002*, DOI 10.1145/512529.512558。**Unsound and incomplete by design**——为 usability 牺牲 guarantee。JML / OpenJML / KeY / Krakatoa / Why3-Java / Dafny 的祖父。

**de Moor, O. et al. ".QL for source code analysis,"** *SCAM 2007*；**Avgustinov, P. et al. "QL: Object-oriented Queries on Relational Data,"** *ECOOP 2016*, DOI 10.4230/LIPIcs.ECOOP.2016.2 —— Semmle .QL（GitHub 2019 收购，重命名 **CodeQL**）。把源码当 relational DB，Datalog-derived OO query 语言写 structural / dataflow analysis。是 GitHub Advanced Security 和大多数 CVE variant analysis（如 log4j 后续）的 backbone。

**Sadowski, C., Aftandilian, E., Eagle, A., Miller-Cushon, L., Jaspan, C. "Lessons from Building Static Analysis Tools at Google,"** *CACM* 61(4), April 2018, DOI 10.1145/3188720（<https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/>）—— Google FindBugs → Error Prone → Tricorder 的 10 年经验：

1. **在 code review 把 finding surface**，不是单独 inbox。
2. **让开发者 rate false positive cost**，把 false positive 压到接近零。
3. **建分析器 as plugin**，不是 monolith。
4. **fix 比 warning 重要**——自动修建议比挑刺更有 ROI。

这是 agent 产品的工业 playbook。

---

## 5. SMT Solver——每一个验证工具的引擎室

### 5.1 SAT 谱系

**Davis, M. & Putnam, H. "A Computing Procedure for Quantification Theory,"** *JACM* 7(3), July 1960, pp. 201–215 —— DP 程序。

**Davis, M., Logemann, G., Loveland, D. "A Machine Program for Theorem-Proving,"** *CACM* 5(7), July 1962, pp. 394–397 —— **DPLL**：把 DP 的 resolution 换成 case-splitting + backtracking。今天所有 SAT solver 都是 DPLL + 三件套（conflict analysis、learned clause、restart）。

**Marques-Silva, J.P. & Sakallah, K.A. "GRASP: A Search Algorithm for Propositional Satisfiability,"** *IEEE TC* 48(5), May 1999, pp. 506–521, DOI 10.1109/12.769433 —— **CDCL (Conflict-Driven Clause Learning)**：每次冲突 analyze implication graph，derive learned clause + 非时序 backjumping。把 SAT 从学术好奇变成工业 verification infrastructure。

**Moskewicz, M.W., Madigan, C.F., Zhao, Y., Zhang, L., Malik, S. "Chaff: Engineering an Efficient SAT Solver,"** *DAC 2001*, DOI 10.1145/378239.379017 —— **Two-Watched Literals**（unit propagation 常数时间）+ **VSIDS** decision heuristic。比 GRASP 快 1–2 个数量级，是现代 CDCL 引擎的工程模板。

**Eén, N. & Sörensson, N. "An Extensible SAT-solver,"** *SAT 2003* —— **MiniSat**：~600 行 C++ CDCL，是后面所有 SAT solver 的教学起点 + 代码母本。

### 5.2 SMT = SAT + theory

**Nelson, G. & Oppen, D.C. "Simplification by Cooperating Decision Procedures,"** *ACM TOPLAS* 1(2), Oct 1979, pp. 245–257, DOI 10.1145/357073.357079 —— **Nelson-Oppen theory combination**：给 stably-infinite + signature-disjoint 的两个 theory，可以把它们的 union 也做出 decision procedure，靠在两边交换 shared variable equality。**没这条结果就没有 SMT**——SMT 本质就是 SAT + 多个 theory solver 协作。

**Ganzinger, H., Hagen, G., Nieuwenhuis, R., Oliveras, A., Tinelli, C. "DPLL(T): Fast Decision Procedures,"** *CAV 2004*, DOI 10.1007/978-3-540-27813-9_14 —— **lazy SMT architecture**：CDCL 把 theory atom 当 Boolean variable 做 search，专门 T-solver 检查 theory consistency；不一致就 learn theory lemma 反馈到 CDCL。今天所有 SMT solver 的标准架构。

### 5.3 现代 SMT 工具栈

| 工具 | 论文 | 主页 | 强项 |
|---|---|---|---|
| **Z3** | de Moura-Bjørner *TACAS 2008* DOI 10.1007/978-3-540-78800-3_24 | <https://github.com/Z3Prover/z3> | 通用第一选 |
| **cvc5** | Barbosa et al. *TACAS 2022* DOI 10.1007/978-3-030-99524-9_24 | <https://cvc5.github.io/> | strings, datatypes, SyGuS |
| **Bitwuzla** | Niemetz-Preiner *CAV 2023* | <https://bitwuzla.github.io/> | QF_BV / FP / array |
| **Yices** | Dutertre *CAV 2014* | <https://yices.csl.sri.com/> | nonlinear real arithmetic via MCSat |

**SMT-LIB**（<https://smt-lib.org/>）—— 当前 v2.7 (Feb 2025) 是 input 标准。**SMT-COMP**（<https://smt-comp.github.io/>）—— 每年 80+ logic 分类竞赛，是 "用哪个 solver 做哪类查询" 的 ground truth。

Z3 拿 **2015 ACM SIGPLAN Software Award**——评语："*transforming the landscape of software analysis and verification.*" 工业部署：

- Microsoft **SDV / SLAM2** (Windows Driver Verifier) 用 Z3
- Microsoft **SAGE** (Windows whitebox fuzzer，doc 2 §5.3) Z3 backend
- Microsoft **Pex / IntelliTest** (.NET test gen) Z3 backend
- **Dafny / Boogie / VCC / Spec# / F\* / Verve / Hyper-V verification** 全部 Z3
- KLEE 现支持 Z3 作 STP 备选

**对 agent 产品**：任何 verification component，Z3 是 default embedding；cvc5 是 cross-check 第二引擎；Bitwuzla 是 binary / firmware analysis 的 QF_BV 之选。

---

## 6. Type System——从 Hindley-Milner 到 dependent types

### 6.1 Hindley-Milner——polymorphic type 推理

**Hindley, J.R. "The Principal Type-Scheme of an Object in Combinatory Logic,"** *Trans. AMS* 146, Dec 1969, pp. 29–60, DOI 10.2307/1995158 —— combinator 的 principal type-scheme 存在 + 可算。

**Milner, R. "A Theory of Type Polymorphism in Programming,"** *JCSS* 17(3), Dec 1978, pp. 348–375, DOI 10.1016/0022-0000(78)90014-4 —— 引入 let-polymorphism + **Algorithm W** + 证明 soundness。

> *"Well-typed programs cannot go wrong."*

Milner Turing Award 1991。**Damas-Milner POPL 1982** (DOI 10.1145/582153.582176) 给出 completeness 证明 + 现在叫 Damas-Milner type system 的清洁化版本。

这是 ML / OCaml / Haskell（class extension 前）/ Elm / Standard ML 共同的 type inference 算法母本。**Milner 那句 "well-typed programs cannot go wrong" 是程序语言理论里被引最多的一句话**，也是每个 typed bug-finder 在哲学上的前提。

### 6.2 Curry-Howard + Martin-Löf

**Howard, W.A. "The Formulae-as-Types Notion of Construction,"** in Seldin & Hindley (eds.) *To H.B. Curry: Essays...*, Academic Press 1980, pp. 479–490（1969 已私下流传）。**Curry-Howard correspondence**——proposition = type, proof = program, proof normalization = term reduction。让"verified software"与"mathematical proof"成为同一种 artifact。

**Martin-Löf, P. *Intuitionistic Type Theory*,** Bibliopolis 1984；早期版 "Constructive Mathematics and Computer Programming," 1979/1982 北荷兰 DOI 10.1016/S0049-237X(09)70189-2 —— **Martin-Löf Type Theory (MLTT)**：identity type、Π-type、Σ-type、universe、W-type。每个现代 proof assistant 都是 MLTT 直接后裔。

Martin-Löf 的 judgement vs proposition 区分（"A is a type" 是 judgement，A 是 proposition）是 dependent-type verification 的哲学基础。

### 6.3 Coq / Lean / Idris / Agda / F\*

**Coquand, T. & Huet, G. "The Calculus of Constructions,"** *Information and Computation* 76(2/3), 1988, pp. 95–120, DOI 10.1016/0890-5401(88)90005-3 —— **CoC**。后扩展到 **Calculus of Inductive Constructions (CIC)**，是 Coq / Rocq（<https://rocq-prover.org/>）逻辑内核。

**Leroy, X. "Formal Verification of a Realistic Compiler,"** *CACM* 52(7), July 2009, pp. 107–115, DOI 10.1145/1538788.1538814 —— **CompCert**：从 C 子集（Clight）到 PowerPC / ARM / x86 assembly 全 chain 在 Coq 里证明正确。"*verification ensures that safety properties established for source code remain valid in the compiled executable.*"

**Klein, G. et al. "seL4: Formal Verification of an OS Kernel,"** *SOSP 2009*, DOI 10.1145/1629575.1629596（<https://trustworthy.systems/>）—— 史上第一个 functional correctness 被完整 mechanize 证明的通用 OS kernel。8700 行 C + 600 行 assembly，在 Isabelle/HOL 里证明 strictly follows 抽象 spec。

**de Moura, L. et al. "The Lean Theorem Prover,"** *CADE-25 2015*, DOI 10.1007/978-3-319-21401-6_26（<https://lean-lang.org/>）。Lean 4 (2021) 自托管 + 通用编程语言。**Mathlib**（<https://leanprover-community.github.io/>）是世界最大 mechanized 数学库，跨 analysis / algebra / topology / category theory / number theory。

**Brady, E. "Idris, a general-purpose dependently typed programming language,"** *JFP* 23(5), Sept 2013, pp. 552–593, DOI 10.1017/S095679681300018X。**Type-driven development**——先写 type，后让 compiler 引导填实现。

**Norell, U. "Dependently Typed Programming in Agda,"** *AFP 2008* lecture, Springer LNCS 5832, DOI 10.1007/978-3-642-04652-0_5。Agda 的"holes as proof-construction primitive"成了 Idris / Lean / Coq Companion mode 的模板。

**Swamy, N. et al. "Dependent Types and Multi-Monadic Effects in F\*,"** *POPL 2016*, DOI 10.1145/2837614.2837655（<https://www.fstar-lang.org/>）—— **F\*** = dependent type + effect system + refinement type + SMT 自动化。Microsoft Project Everest 用 F\* 证 TLS 1.3 实现 HACL\* 和 miTLS，shipping 在 **Firefox / Linux kernel / Tezos blockchain**。

### 6.4 Refinement type——SMT 自动化的 dependent type

**Vazou, N., Seidel, E.L., Jhala, R., Vytiniotis, D., Peyton-Jones, S. "Refinement Types for Haskell,"** *ICFP 2014*, DOI 10.1145/2628136.2628161 —— **Liquid Haskell**：在 Haskell 类型上加 logical predicate，SMT 检查。能在 10000+ 行 Haskell 库代码上证 96% 递归函数 terminating + array-bounds safety + program-specific invariant。是 "lightweight verification" 的当前最强工业 prototype。

---

## 7. Contract + Production type system + Rust

### 7.1 Design by Contract——Eiffel / Meyer

**Meyer, B. "Applying 'Design by Contract',"** *IEEE Computer* 25(10), Oct 1992, pp. 40–51, DOI 10.1109/2.161279（ETH PDF: <https://se.inf.ethz.ch/~meyer/publications/computer/contract.pdf>）；book *Object-Oriented Software Construction*, 2nd ed., Prentice Hall 1997, ISBN 0-13-629155-4, 1254 + xxviii 页。

每个 routine 带 precondition + postcondition + class-level invariant——把非正式 spec 变成可检验的 caller-supplier 互相义务。JML / Spec# / Dafny / Frama-C ACSL / 现代 Pyre / Sorbet refinement annotation 都是后裔。

### 7.2 JML / Spec# / Dafny / Frama-C

- **JML** (Java Modeling Language, Leavens et al. 1999, <https://www.jmlspecs.org/>)——Java 上的 DbC，`//@` 注释。jmlc runtime check / ESC/Java2 static / KeY 和 OpenJML SMT-backed verifier。
- **Spec#** (Barnett-Leino-Schulte CASSIS 2004, DOI 10.1007/978-3-540-30569-9_3, MSR <https://www.microsoft.com/en-us/research/project/spec/>)——C# 加 non-null reference type + pre/post + object invariant，Boogie + Z3 后端。
- **Dafny** (Leino LPAR-16 2010, DOI 10.1007/978-3-642-17511-4_20, <https://dafny.org/>)——Spec# 的直接后代。imperative + class-based + pre/post + loop invariant + decreases + ghost code。AWS 用它做密码学库 + authorization 库的 functional correctness 证明。
- **Frama-C** (Cuoq et al. SEFM 2012, DOI 10.1007/978-3-642-33826-7_16, <https://frama-c.com/>)——C 上的 ACSL spec + WP (deductive proof) / EVA (abstract interpretation) / E-ACSL (runtime check)。航空 / 核电 C 代码的事实标准 toolchain。CEA LIST 维护。

### 7.3 Rust——ownership + RustBelt

Rust ownership / borrow checker（Klabnik & Nichols *The Rust Programming Language*, No Starch Press 2019, 开源 <https://doc.rust-lang.org/book/>）——把 affine type + region inference 编进 type system，**静态阻止 use-after-free / double-free / data race，不要 GC**。

> *"Ownership is Rust's most unique feature and has deep implications for the rest of the language. It enables Rust to make memory safety guarantees without needing a garbage collector."* —— Rust Book ch. 4

**Jung, R., Jourdan, J.-H., Krebbers, R., Dreyer, D. "RustBelt: Securing the Foundations of the Rust Programming Language,"** *POPL 2018*, DOI 10.1145/3158154 —— Coq + Iris separation logic 里**第一次完整证明 safe Rust 子集 + unsafe stdlib primitive (Cell, RefCell, Mutex, Rc, Arc) 的 type system soundness**。

工业 Rust adoption：
- **Linux kernel 6.1 (Oct 2022)** —— Torvalds approve Rust support，<https://www.kernel.org/doc/html/v6.1/rust/index.html>
- **Android 13** —— Google Security Blog "Memory Safe Languages in Android 13"，新 native code ~21% Rust（2022-12）
- **Cloudflare Pingora** —— Rust 异步多线程 HTTP proxy framework，<https://blog.cloudflare.com/pingora-open-source/>

这是 30 年来 systems 编程语言唯一一次成功的代际更替——**靠 type system 不是靠 testing**。对 agent 产品的含义：bug 不止是"我们写测试找它"，更彻底的是"我们用 type system 让它写不出来"。

### 7.4 Gradual typing + 工业 pluggable type system

**Bracha, G. "Pluggable Type Systems,"** OOPSLA 2004 Workshop（<https://bracha.org/pluggableTypesPosition.pdf>）—— type 应可选、可移除，不改变 runtime。

**Siek, J.G. & Taha, W. "Gradual Typing for Functional Languages,"** *Scheme Workshop 2006* —— 形式化 calculus：`?`（dynamic）type、type consistency、全 annotate 时恢复 full static safety。

**TypeScript**（Anders Hejlsberg / Microsoft, 2012-10-01 发布）—— gradual typing 的最大部署，跨 Google / Microsoft / Airbnb / Slack。

同代工业 pluggable / gradual checker：
- **Sorbet** (Stripe, Ruby, <https://sorbet.org/>)——"millions of lines [of Ruby] across thousands of developers"
- **Pyre / Pyright / mypy** (Python, Meta / Microsoft)
- **Hack** (Meta, PHP)
- **Flow** (Meta, JS)

**对 agent 产品的含义**：gradual / pluggable type system 是大型动态语言代码库 ship 不烂的事实标准。Agent 想给 Python / Ruby / JS 项目报 bug，不集成 mypy / Sorbet / Flow 的 inference 输出是浪费。

### 7.5 ATS / Stainless / Why3——研究级 verifier

- **ATS** (Xi-Pfenning POPL 1999, DOI 10.1145/292540.292560, <http://www.ats-lang.org/>)——index-refined dependent type，Presburger-decidable index domain。Liquid Haskell / F\* 的祖父。
- **Stainless** (Hamza-Voirol-Kunčak OOPSLA 2019, DOI 10.1145/3360592, EPFL, <https://github.com/epfl-lara/stainless>)——higher-order Scala 上的 refinement-typed verification。Inox / Z3 / CVC4 后端。
- **Why3 / WhyML** (Filliâtre-Paskevich ESOP 2013, DOI 10.1007/978-3-642-37036-6_8, <https://www.why3.org/>)—— 中间 verification language，前端有 Frama-C/WP / SPARK 2014 / Krakatoa；后端 dispatch Alt-Ergo / Z3 / CVC4 / Coq / Isabelle。

---

## 8. 这一条道路的整体形状

把 1967–2026 压成几个维度对比：

| 维度 | Testing 道路 (doc 1+2) | Formal Methods 道路 (this doc) |
|---|---|---|
| 认识论 | falsification（找反例） | deduction（证明排除反例存在） |
| 主要 cost | 测试人力 + 测试时间 | spec 人力 + proof 人力 + 复杂度限制 |
| 主要 leverage | 自动化 + 规模 | 抽象 + theorem prover |
| 工业渗透 | 几乎所有软件 | 4 个领域：航空 / OS kernel / crypto / 分布式 design |
| 标志事件 | KLEE 找 Coreutils 15 年潜伏 bug (2008) | AWS DynamoDB 35-step counterexample (2015) |
| 当前痛点 | benchmark 失真、coverage 弱 | spec 写作成本高、扩展性差 |

**两条道路在 LLM agent 时代正在融合**：

- **LLM 写 spec**——把"用户描述需求 → 半自动生成 TLA+ / Dafny spec"做出来，formal methods 最贵的环节(写 spec)成本骤降。
- **LLM 引导 proof assistant**——Lean Copilot、Coq Proverbot9001、GPT-f 系列已经能自动 close 简单 lemma。Mathlib formalization 速度 2023 之后明显加快。
- **LLM 引导 SMT** —— "为 solver 选 tactic / 分解 goal" 这类元层任务在 LLM 上很自然。
- **形式 methods 给 LLM agent 当 oracle** —— Doc 2 §6 PBT 的"property as oracle"思路、Liquid Haskell refinement type 的"SMT 决策" 思路，都是 LLM 生成 + 形式工具验证 的范本。

**Agent 产品的关键选择**：你做 testing-side agent 还是 verification-side agent？
- testing-side：找 bug 但不证明正确性。门槛低、市场大、上限是 KLEE / Defects4J。
- verification-side：在用户给定 spec 下证明 absence of bug。门槛高、市场小、上限是 Astrée / seL4。
- **hybrid agent**：用 LLM 生成 spec + dispatch SMT/verifier。这是 2026 形式方法工业化最现实的入口，也是当前 frontier lab 的研究热点。

---

## 📚 还该读什么

1. **Pierce, B.C. *Types and Programming Languages*, MIT Press 2002**（<https://www.cis.upenn.edu/~bcpierce/tapl/>）—— type system 的标准教科书，从 STLC 到 dependent type 渐进式。
2. **Wadler, P. "Propositions as Types," CACM 58(12), Dec 2015, pp. 75–84, DOI 10.1145/2699407**（<https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf>）—— Curry-Howard 的科普版，读完知道为什么 type system 和 logic 是同一件事。
3. **Lamport TLA+ video course**（<https://lamport.azurewebsites.net/video/videos.html>）—— 比 Lamport 2002 book 更易上手，Lamport 自己讲的 14 集系列。
4. **Bessey et al. 2010 "A Few Billion Lines of Code Later," CACM 53(2)** —— 工业 static analysis 全部 lesson 在这一篇。读完决定 agent 产品要不要给 false positive 让步。
5. **Newcombe et al. 2015 "How Amazon Web Services Uses Formal Methods," CACM 58(4)**（<https://assets.amazon.science/67/f9/92733d574c11ba1a11bd08bfb8ae/how-amazon-web-services-uses-formal-methods.pdf>）—— TLA+ 在工业能跑的 single best 案例研究。

## ❓ 我还没搞清楚的 3 个问题

1. **LLM 自动 Lean / Coq proof 的当前 SOTA 到什么程度？** 看到 Lean Copilot / Proverbot9001 / DSP 之类工具，但缺一个工业 benchmark 说"LLM 现在能 close mathlib 里 X% 的 sorry"。这关系到 agent 产品在 proof side 能押多少注。
2. **TLA+ / Dafny 这一类 design-level spec 在 LLM 时代有没有"semi-automated draft"工具能用？** Newcombe 2015 之后 AWS 的经验更多是工程师培训 cost 高。如果 LLM 能把 spec 起草成本降一个数量级，formal methods 工业化的 economics 会变。
3. **Rust 在 systems 编程里 30 年代际替代 C 的 timeline 大概多长？** Linux 6.1 (2022) 进 mainline 之后 4 年了，但 kernel 里 Rust 子系统增长速度看起来比 2022 时预期慢。如果 Rust 把 memory safety 类 bug 在 systems 软件里干掉，agent 产品在"找 memory safety bug"这一类就少了 70%+ 的市场。

## 💡 对产品的具体启发

1. **承认形式方法不会替代 testing，testing 也不会替代形式方法——两者覆盖不同的 bug 类。**Coverage / mutation testing 抓 unit-level 的 "off-by-one + 边界遗漏"，formal methods 抓 "concurrency + distributed + protocol-level 30+ step interleaving"。Agent 产品的 marketing 应明确"我们抓哪一类"——这是 doc 2 §11 "honest scoping" 的 formal-methods 版本。
2. **把 LLM 当成 spec / contract 生成器，把 SMT / model checker 当成 oracle。**这是当前最现实的 LLM + formal methods 融合姿势——Dafny / Liquid Haskell / Frama-C 的 pre/post condition 写起来繁琐，LLM 把它降到自然语言描述就够。下游 verifier 是 deterministic 的，**不会幻觉**。
3. **学 Google Sadowski 2018 的 false-positive economics。**<4% false alarm 是开发者会改的天花板，超过这个数 finding 会被忽略。Agent 报 bug 的 ROI 取决于"开发者改的成本 / 信号准确率"，不取决于 raw recall。
4. **学 Facebook Infer continuous reasoning 模型。**不要 batch 跑全 codebase，只跑 diff，在 code review 现场报。这是 doc 2 §6.7 Google diff-based mutation testing 的 formal-methods 版——同一个 UX 取向。
5. **Type system 是更彻底的 bug-find：让 bug 写不出来。**Rust 代际替代 C 的核心 ROI 是 memory safety bug 在 type system 层被排除。Agent 产品如果有能力帮用户**迁移代码到更强 type system**（Python → mypy/Pyre、JS → TypeScript、C → Rust），这条产品线比"找 bug 报告 bug"上限高得多。

---

**文档边界**

这份只到 verification deduction 那条道路。process / management / QA 作为 discipline 留给 doc 4；CI/CD / SRE / observability / chaos engineering 留给 doc 5；agent 时代综合给 doc 6。
