# 02 — Bug 发现研究前沿（1990s–now）

> Doc 1 给地基——1947–1988 那四十年。这一份接力，盘 1990 年到 2026 年的「bug 发现」工程实践全谱。
> 后面 doc 3 才进入 formal methods / type system / model checking 那条道路；doc 5 才进入 CI/CD-era / SRE / observability。

---

## 0. 这份文档的六条线索

Doc 1 在 mutation testing 工业化（Google 2018）和 ICSE 2014 Inozemtseva-Holmes 之后收尾。这一份盘下面六条：

1. **Fuzzing** —— random 到 coverage-guided 到 production-scale (Miller 1990 → AFL → OSS-Fuzz)
2. **Symbolic / Concolic execution** —— King 1976 复活 (DART → KLEE → SAGE → angr → Driller)
3. **Property-Based Testing** —— Claessen-Hughes 革命 (QuickCheck → Hypothesis → 业界)
4. **Search-Based Test Generation** —— 把测试当成搜索问题 (Korat → Randoop → EvoSuite → Pex)
5. **Bug 定位 + 自动修复** —— SBFL / 统计调试 / Delta debugging / GenProg → Prophet → Neural APR
6. **LLM 时代 (2021–2026)** —— Codex / SWE-bench / SWE-agent / Claude Code / SWE-bench Verified 2026 退役

每一条都至少有一篇"工业内部上线"的代表作和一篇"事后实证打脸"的论文。两者并列，才看得见这门学科真实的进展曲线。

---

## 1. Fuzzing 第一代：Miller 1990 与 thunderstorm

1989 年 Wisconsin 暴雨夜，Barton Miller 通过 dial-up 用 vi，电话线噪声让 vi 反复崩。他没去骂 modem，而是想：如果系统能被线路噪声整崩，那系统就该 always 被线路噪声测。

成果是 **Miller, B.P., Fredriksen, L. & So, B., "An Empirical Study of the Reliability of UNIX Utilities,"** *CACM* vol. 33 no. 12, Dec 1990, pp. 32–44, DOI 10.1145/96267.96279（Miller 自己的 UW-Madison fuzz 站：<https://pages.cs.wisc.edu/~bart/fuzz/>，1988、1990、1995、2000、2006、2020 历次研究都在）。

Miller 给一群标准 UNIX 命令喂随机字节，**25%–33% 的工具崩了或卡死**。"fuzz" 一词此时确立。1990 这篇拿了 2022 年的 Jean-Claude Laprie Award——这是这条线索 32 年后才被正式承认为奠基的注脚。

---

## 2. Fuzzing 第二代：coverage-guided

### 2.1 AFL — Zalewski 给 random 装上眼睛

2013 年 Michał Zalewski 发布 **AFL (American Fuzzy Lop)**（<https://lcamtuf.coredump.cx/afl/>，CDN 拦截但 GitHub mirror 在 <https://github.com/mirrorer/afl>）。AFL 不再纯 random——它用 compile-time instrumentation 追踪 edge coverage，跑成 GA loop：变异，留下打到新 edge 的输入，淘汰其他。

Zalewski 2014 的博文 *"Pulling JPEGs out of thin air"*（<https://lcamtuf.blogspot.com/2014/11/pulling-jpegs-out-of-thin-air.html>）是 coverage feedback 力量的著名 demo：从 seed 字符串 `"hello"` 出发，几百代之内、几亿次 `execve()` 之后，AFL 拼出了语法合法的 JPEG——一个完全不懂 JPEG 格式的 fuzzer 用 coverage 反馈反向推出了格式。

### 2.2 AFLFast — 把 fuzzing 形式化成 Markov chain

**Böhme, M., Pham, V.-T., Roychoudhury, A., "Coverage-Based Greybox Fuzzing as Markov Chain,"** *CCS 2016*, DOI 10.1145/2976749.2978428（<https://github.com/mboehme/aflfast>）。

把 AFL 的探索建模成 Markov chain 后发现：AFL 把太多预算花在高频路径上。引入 **power schedule** 给低频路径多分能量，结果 *"outperform AFL 1.96b by an order of magnitude"*，对某些 CVE 比 AFL 快 14× 找到。AFLFast 的 power schedule 现在是 AFL++ 和所有现代 greybox fuzzer 的标配。

### 2.3 工业化的工具栈

- **libFuzzer** in LLVM (<https://llvm.org/docs/LibFuzzer.html>) —— in-process coverage-guided，把目标作为函数注入，throughput 上吊打 fork-exec 模型。
- **AFL++** (<https://github.com/AFLplusplus/AFLplusplus>) —— Zalewski 停更后社区接管。Fioraldi, Maier, Eißfeldt, Heuse "AFL++: Combining Incremental Steps of Fuzzing Research," *WOOT 2020*。把十年的 fuzzing 论文（MOpt, RedQueen, laf-intel, collision-free maps）合进一个工具。
- **honggfuzz** (<https://github.com/google/honggfuzz>) —— Robert Swiecki / Google，加 Intel BTS / PT 硬件 trace，throughput up to 1M iter/sec in persistent mode。OpenSSL CVE-2016-6309 是它找的。
- **syzkaller** (<https://github.com/google/syzkaller>) —— Dmitry Vyukov / Google，专攻 OS kernel；用 syzlang 描述 syscall + KCOV 收集 kernel coverage。文档列出几千个 Linux 内核 bug。
- **AFLNet** (Pham, Böhme, Roychoudhury, *ICST 2020*, <https://github.com/aflnet/aflnet>) —— 把 AFL 扩到 stateful network protocol，用服务端 response code 作 state feedback。

### 2.4 Grammar-based

- **JQF + Zest** (Padhye, Lemieux, Sen et al. *ISSTA 2019*, <https://github.com/rohanpadhye/JQF>) —— coverage-guided fuzzing for Java，用 generator program 产生结构合法输入。
- **NAUTILUS** (Aschermann et al. *NDSS 2019*, <https://www.ndss-symposium.org/ndss-paper/nautilus-fishing-for-deep-bugs-with-grammars/>) —— context-free grammar 加 coverage feedback，subtree mutation 保持语法合法。在 ChakraCore / PHP / mruby / Lua 上 ship 6 个 CVE，*"outperforms AFL by an order of magnitude"*。

## 3. Fuzzing 第三代：OSS-Fuzz 与基础设施

2016 年 12 月 Google 发布 **OSS-Fuzz**（Mike Aizatsky / Kostya Serebryany，<https://security.googleblog.com/2016/12/announcing-oss-fuzz-continuous-fuzzing.html>，GitHub <https://github.com/google/oss-fuzz>）。开源项目提供 fuzz target，Google 跑 libFuzzer / AFL++ / honggfuzz 在 Google infra，发现 bug 自动开 issue + 90 天 disclosure。

截至 2025 年 5 月，OSS-Fuzz 在 1000+ 开源项目里找到 **13000+ 漏洞 + 50000+ 普通 bug**（README 实时统计）。背后是 **ClusterFuzz** orchestrator（<https://github.com/google/clusterfuzz>），跑在 **~100000 台 VM** 上；Chrome 团队单独用它找出 27000+ bug。

工业级 fuzzing 不是算法竞赛，是基础设施竞赛。这条 lesson 直接喂给 agent 时代：你写出更聪明的 fuzz 算法不如先把 100000 台机器接上。

## 4. Fuzzing 的方法学整顿——Klees 2018

**Klees, G., Ruef, A., Cooper, B., Wei, S., Hicks, M. "Evaluating Fuzz Testing,"** *CCS 2018* (<https://arxiv.org/abs/1808.09700>)。审了 32 篇 fuzzing 论文，**发现每一篇的实验设计都有问题**——试验次数不够、没统计检验、忽视 random seed 方差、运行时间太短、benchmark 不真实。论文给出方法学建议：

- ≥30 trials per config
- Mann-Whitney U test, p < 0.05（沿用 Arcuri & Briand）
- 报分布不只是均值
- ≥24h runtime
- 用 ground-truth bug count 的 benchmark

现在是 fuzzing 论文 reviewer 的 checklist。第 7 届 NSA Best Scientific Cybersecurity Paper 奖。

---

## 5. Symbolic Execution——King 1976 在 2005 年复活

James C. King "Symbolic Execution and Program Testing," *CACM* vol. 19 no. 7, July 1976, pp. 385–394, DOI 10.1145/360248.360252（Va Tech PDF: <https://people.cs.vt.edu/~ryder/6304/lectures/12-King_Symbolic_Execution_Program_Testing_%20King_CACM1976_mengwu.pdf>）提出 symbolic execution：把输入当符号变量传进程序，执行每个 branch 时把分支条件加进 **path condition**，用决策过程解 path condition 得到能走这条 path 的具体输入。

1976 写得太早——没有 SMT solver 也没有指针重叠的内存模型——所以这个想法睡了 30 年。复活是 2005 年。

### 5.1 DART / CUTE——concolic 执行

**Godefroid, P., Klarlund, N., Sen, K. "DART: Directed Automated Random Testing,"** *PLDI 2005*, DOI 10.1145/1065010.1065036（<https://web.eecs.umich.edu/~weimerw/2014-6610/reading/p213-godefroid.pdf>）和 **Sen, K., Marinov, D., Agha, G. "CUTE: A Concolic Unit Testing Engine for C,"** *ESEC/FSE 2005*, DOI 10.1145/1081706.1081750（<https://mir.cs.illinois.edu/marinov/publications/SenETAL05CUTE.pdf>）几乎同时给出 **concolic execution**（CONCrete + symbOLIC）：一边跑具体输入，一边记 path condition；每跑完一条 path 就 negate 最后一个 branch 让 solver 给新输入。Solver 卡住时（指针、syscall、外部库），用当下具体值兜底继续。

CUTE 同时解决了指针 / 堆的形式化——把输入表示成 **memory graphs**，pointer field 第一次 dereference 时再 lazy-initialize。这套设计现在是所有 concolic 引擎的标配。

### 5.2 EXE / KLEE——把它做成 bug-finding

**Cadar, C., Ganesh, V., Pawlowski, P., Dill, D., Engler, D. "EXE: Automatically Generating Inputs of Death,"** *CCS 2006*, DOI 10.1145/1180405.1180445（<https://web.stanford.edu/~engler/exe-ccs-06.pdf>）—— Stanford 组把 symbolic execution 武器化，目标不是 coverage 而是 crash。EXE 在 BSD/Linux packet filter、udhcpd、pcre、3 个 Linux 文件系统里 ship 了 CVE。

**Cadar, C., Dunbar, D., Engler, D. "KLEE: Unassisted and Automatic Generation of High-Coverage Tests for Complex Systems Programs,"** *OSDI 2008*（<https://www.usenix.org/legacy/event/osdi08/tech/full_papers/cadar/cadar.pdf>）是 open-source 的 EXE 重写在 LLVM bitcode 上。著名实验：

> *"On average over 90% line coverage (median: over 94%) on 89 standalone GNU Coreutils utilities."* 同时**找到 3 个潜伏 15+ 年的 bug**。

OSDI 2008 Best Paper + SIGOPS Hall of Fame。

### 5.3 SAGE——Microsoft 把它跑成产品

**Godefroid, P., Levin, M.Y., Molnar, D. "Automated Whitebox Fuzz Testing,"** *NDSS 2008*（<https://www.ndss-symposium.org/wp-content/uploads/2017/09/Automated-Whitebox-Fuzz-Testing-paper-Patrice-Godefroid.pdf>）；followup *"SAGE: Whitebox Fuzzing for Security Testing,"* *CACM* vol. 55 no. 3, March 2012, pp. 40–44, DOI 10.1145/2093548.2093564。

SAGE 在 Windows 二进制 (x86 instruction level) 上跑 concolic，专攻 file parser。**Microsoft 用 SAGE 找出了 Windows 7 开发期间 1/3 的 fuzz-discovered bug**。这是 symbolic execution 真正进入产品 release pipeline 的 existence proof。

### 5.4 angr 和 Driller——cluster 化的开源平台

**Shoshitaishvili, Y. et al. "SoK: (State of) The Art of War: Offensive Techniques in Binary Analysis,"** *IEEE S&P 2016*, DOI 10.1109/SP.2016.17（<https://oaklandsok.github.io/papers/shoshitaishvili2016.pdf>）—— SoK，把 CFG recovery / VSA / dynamic taint / symbolic execution / 各种 binary analysis 技法重新写在一个 Python 框架里。框架开源后变成事实标准 binary analysis 平台。

**Stephens, N. et al. "Driller: Augmenting Fuzzing Through Selective Symbolic Execution,"** *NDSS 2016*（<https://www.ndss-symposium.org/wp-content/uploads/2017/09/driller-augmenting-fuzzing-through-selective-symbolic-execution.pdf>）给出 **hybrid 模板**：AFL 跑得快但卡在 magic-byte 检查（`memcmp(input, "MAGIC", 5)`），把 corpus 交给 concolic 解出过 check 的输入，喂回 fuzzer。**DARPA Cyber Grand Challenge 决赛上 Shellphish 用这套晋级**。

S²E (Chipounov, Kuznetsov, Candea, *ASPLOS 2011*) 则用 modified QEMU 让 symbolic execution 跨 user/kernel 边界，"in-vivo" 跑真环境，按需 lift 成 symbolic——是 environment problem 至今最强的工程答案。

### 5.5 四堵越不过的墙

**Cadar, C. & Sen, K. "Symbolic Execution for Software Testing: Three Decades Later,"** *CACM* vol. 56 no. 2, Feb 2013, pp. 82–90, DOI 10.1145/2408776.2408795（<https://people.eecs.berkeley.edu/~ksen/papers/cacm13.pdf>）老老实实列出 symbolic execution 至今没解决的四个问题：

1. **Path explosion** —— branch 数指数爆炸。state merging / function summarization / 路径剪枝是补丁不是解药。
2. **Constraint solving 复杂度** —— SMT 在 nonlinear / floating point / 宽位 bitwise 上常 timeout。
3. **Memory modeling** —— symbolic pointer / symbolic index 要么爆炸要么失精。
4. **Environment modeling** —— libc / syscall / network 没法完美建模。

对 agent 产品的含义：**这四堵墙的存在意味着 agent 不可能"全靠 symbolic execution 找所有 bug"**。Agent 的活是当 orchestrator——选哪条 path 给 solver、选哪段内存做 symbolic、选哪个 syscall 真跑哪个建模——而不是替代 KLEE。

---

## 6. Property-Based Testing——把 spec 变成 oracle

### 6.1 QuickCheck 1999

**Claessen, K. & Hughes, J. "QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs,"** *ICFP 2000*, DOI 10.1145/351240.351266（<https://www.cis.upenn.edu/~bcpierce/courses/552-2008/resources/icfp-quickcheck.pdf>）。

PBT 范式：**用户写 property（"对所有满足条件的输入，输出应满足这个性质"），框架随机 sample input 检查 property，找到反例时自动 shrink 到最小化**。Shrink 算法（Gill 提出，QuickCheck 实现）让反例不再是 5000 字节的随机串，而是 minimal failing input。

Hughes 后来把它商业化成 Quviq QuickCheck (Erlang)，给 Ericsson Megaco/H.248 找 bug（Arts, Hughes, Johansson, Wiger "Testing Telecoms Software with Quviq QuickCheck," *Erlang Workshop 2006*）。

### 6.2 Hypothesis 把 PBT 带到 Python 主流

**MacIver, D.R. & Hatfield-Dodds, Z. "Hypothesis: A new approach to property-based testing,"** *JOSS* 4(43):1891, 2019, DOI 10.21105/joss.01891（<https://joss.theoj.org/papers/10.21105/joss.01891>）；主页 <https://hypothesis.readthedocs.io>。

Hypothesis 两个工程创新：

1. **Strategy model** —— 把 generator 从 type 解耦（QuickCheck 的 typeclass 模型要求每个 type 一个 Arbitrary 实例；Hypothesis 让多个 strategy 共存）。
2. **byte-stream shrinking** —— 内部把所有 random 决策编码成 byte stream，shrink 就是 minimize byte stream，自动 generic，不需要 per-type 实现。

模仿者：jqwik (JVM, <https://jqwik.net>)、fast-check (TS/JS, <https://fast-check.dev>)、proptest (Rust, <https://github.com/proptest-rs/proptest>) ——都采用 Hypothesis-style strategy model，**不是** QuickCheck 的 typeclass approach。

### 6.3 Stateful PBT 与 LTL PBT

**Hughes, J., Norell, U., Smallbone, N., Arts, T. "Find more bugs with QuickCheck!"** *AST 2016*, DOI 10.1145/2896921.2896928（<https://smallbone.se/papers/more-bugs.pdf>）。解决"找到一个 bug 后所有后续反例都是同一个 bug 的变种"的问题，方法是自动 adapt generator distribution 以 skip 已找到 bug。

**O'Connor, L. & Wickström, O. "Quickstrom: Property-based Acceptance Testing with LTL Specifications,"** *PLDI 2022*, DOI 10.1145/3519939.3523728（<https://arxiv.org/abs/2203.11532>）。把 PBT 抬到 web UI —— property 用 LTL 写，runtime 随机 generate user interaction 序列，对 trace 检查 LTL。在 TodoMVC benchmark 上**超过 1/3 的实现里找到 bug**。

---

## 7. Search-Based Test Generation——把测试当搜索问题

### 7.1 Korat 与 Randoop——两个极端

**Boyapati, C., Khurshid, S., Marinov, D. "Korat: Automated Testing Based on Java Predicates,"** *ISSTA 2002*, DOI 10.1145/566172.566191（MIT CSAIL PDF: <https://projects.csail.mit.edu/mulsaw/papers/Korat-ISSTA02.pdf>）—— **bounded-exhaustive**：用 Java `repOk()` 谓词描述合法对象空间，枚举所有满足谓词的非同构对象到某 size bound。SIGSOFT Impact Paper 2012。

**Pacheco, C., Lahiri, S.K., Ernst, M.D., Ball, T. "Feedback-Directed Random Test Generation,"** *ICSE 2007*, DOI 10.1109/ICSE.2007.37（<https://homes.cs.washington.edu/~mernst/pubs/feedback-testgen-icse2007-abstract.html>）—— **Randoop**：随机 generate 方法调用序列，每个 prefix 执行后看 outcome（contract violation? equals-redundant? exception?）决定 extend 还是 discard。780 KLOC 14 个 Java library 上 ship。

### 7.2 EvoSuite——用 GA 演化整个 test suite

**Fraser, G. & Arcuri, A. "EvoSuite: Automatic Test Suite Generation for Object-Oriented Software,"** *ESEC/FSE 2011*, DOI 10.1145/2025113.2025179（<https://www.st.cs.uni-saarland.de/publications/files/fraser-fse-2011.pdf>）。

EvoSuite 与 Randoop 的区别：**演化整个 suite 而不是单个 test**，多目标 fitness function (branch + mutation + exception 覆盖)。SBST Tool Competition 2017/2018/2020/2021 都拿冠军。

**Tillmann, N. & de Halleux, J. "Pex—White Box Test Generation for .NET,"** *TAP 2008* (Microsoft Research) 是 .NET 上的 KLEE-flavored 等价物——Z3 + dynamic symbolic execution + parameterized unit test。后来集成进 Visual Studio Enterprise 作为 **IntelliTest**，是研究 test generator 最罕见的产品化案例之一。

### 7.3 真 bug 的检验——Shamshiri 2015 反转

**Shamshiri, S., Just, R., Rojas, J.M., Fraser, G., McMinn, P., Arcuri, A. "Do Automatically Generated Unit Tests Find Real Faults? An Empirical Study of Effectiveness and Challenges,"** *ASE 2015* (SIGSOFT Distinguished Paper, <https://homes.cs.washington.edu/~rjust/publ/unit_test_generation_effectiveness_ase_2015.pdf>)。

在 Defects4J 357 个真实 bug 上跑 EvoSuite、Randoop、Agitar。结果：**三个工具加起来 detect 55.7% 的真 bug，但任何单一工具单 suite 只 detect 19.9%**。原因——implicit oracle（生成的 assertion 只是"输出值等于这个数"，捕捉不了用户期望）、brittle assertion、环境依赖。这是 search-based / random 测试生成对真 bug 的 ceiling。

**Fraser, G. & Arcuri, A. "1600 Faults in 100 Projects: Automatically Finding Faults While Achieving High Coverage with EvoSuite,"** *EMSE* 20(3):611–639, 2015（<https://eprints.whiterose.ac.uk/86826/>）是 EvoSuite 在 SF100 corpus 上的 scale validation —— *"detected twice as many failures … as a traditional random testing approach"*，但同时 expose **oracle problem** —— 大量"failure"是 unsatisfied implicit precondition 而非 bug。

---

## 8. Bug 定位——SBFL 的兴起和 2017 反转

### 8.1 Tarantula

**Jones, J.A., Harrold, M.J., Stasko, J. "Visualization of Test Information to Assist Fault Localization,"** *ICSE 2002*, DOI 10.1145/581339.581397。Tarantula 公式：

> *suspiciousness(s) = (failed(s) / total_failed) / (failed(s) / total_failed + passed(s) / total_passed)*

每个 statement 的"嫌疑度"是该 statement 在 failing test 里执行频率与在 passing test 里执行频率的归一化比。把 coverage 矩阵直接变成 ranking。ICSE 2002 Most Influential Paper。

### 8.2 Ochiai

**Abreu, R., Zoeteweij, P., van Gemund, A.J.C. "An Evaluation of Similarity Coefficients for Software Fault Localization,"** *PRDC 2006*, DOI 10.1109/PRDC.2006.18；2007 在 TAIC PART 跟进。

> *Ochiai(s) = failed(s) / sqrt(total_failed × (failed(s) + passed(s)))*

借鉴分子生物学的 Ochiai 相似度。在 Siemens benchmark 上**比 Tarantula 平均 +5%、特定情况下 +30%**。Ochiai 后来是 SBFL 论文的 baseline。

**Wong, W.E., Debroy, V., Choi, B. "A Family of Code Coverage-Based Heuristics for Effective Fault Localization,"** *JSS* 83(2), Feb 2010, pp. 188–208 给出 **D\*** 家族；**Papadakis, M. & Le Traon, Y. "Metallaxis-FL: Mutation-Based Fault Localization,"** *STVR* 25(5–7), 2015 用 mutant 当 spectrum。

### 8.3 Statistical Debugging——Liblit

**Liblit, B., Aiken, A., Zheng, A.X., Jordan, M.I. "Bug Isolation via Remote Program Sampling,"** *PLDI 2003*, DOI 10.1145/780822.781148（<https://pages.cs.wisc.edu/~liblit/pldi-2003/>）—— **Cooperative Bug Isolation (CBI)**：在 deployed program 里 sample predicate (branch direction, return value, function call site)，从百万用户 run 聚合，logistic regression 找最 predict failure 的 predicate。

**Liblit, B., Naik, M., Zheng, A.X., Aiken, A., Jordan, M.I. "Scalable Statistical Bug Isolation,"** *PLDI 2005*, DOI 10.1145/1065010.1065014 处理多 bug 干扰：迭代去掉 top predicate 解释的 run，找下一个 bug。

**Liu, C., Yan, X., Fei, L., Han, J., Midkiff, S.P. "SOBER: Statistical Model-based Bug Localization,"** *ESEC/FSE 2005* —— model 整个 evaluation distribution 而不是 binary 出现，*"在 Siemens 130 个 bug 里 locate 出 68 个 (前一最优 52)"*。

### 8.4 Delta Debugging——Zeller

**Zeller, A. "Yesterday, my program worked. Today, it does not. Why?"** *ESEC/FSE 1999*, DOI 10.1145/318774.318946（<https://www.st.cs.uni-saarland.de/publications/details/zeller-esec-1999/>）—— **delta debugging**：把 commit set / input 当 binary search 空间，每次去掉一半看 failure 是否消失。1999 的 demo 把 GDB 178000 行的 changeset 缩到单个 failure-inducing change。

**Zeller, A. & Hildebrandt, R. "Simplifying and Isolating Failure-Inducing Input,"** *IEEE TSE* 28(2), Feb 2002, pp. 183–200, DOI 10.1109/32.988498 —— **ddmin** 算法：O(n²)，输出 1-minimal failing input（去掉任一元素 failure 消失）。Mozilla case study 把 896 行 HTML 缩到一个 `<SELECT>` tag。

ddmin 是现代每一个 test case reducer / bug bisect tool 的算法母本。

### 8.5 2017 的反转——Pearson et al.

**Pearson, S., Campos, J., Just, R., Fraser, G., Abreu, R., Ernst, M.D., Pang, D., Keller, B. "Evaluating and Improving Fault Localization,"** *ICSE 2017*, DOI 10.1109/ICSE.2017.62（<https://homes.cs.washington.edu/~mernst/pubs/fault-localization-icse2017-abstract.html>）。

在 3242 个人工注入 fault 上 reproduce 了 10 个已发表 SBFL 主张，然后在 323 个真 bug 上同样跑：

> *"Every previous result was refuted or was statistically and practically insignificant. Our experiments show that artificial faults are not useful for predicting which fault localization techniques perform best on real faults."*

这一篇是 SBFL 评估方法论的分水岭。2017 之前的 SBFL paper 大量基于 mutant / Siemens benchmark；2017 之后要 publish SBFL paper 必须用真 bug benchmark。

**Wong, W.E., Gao, R., Li, Y., Abreu, R., Wotawa, F. "A Survey on Software Fault Localization,"** *IEEE TSE* 42(8), Aug 2016, pp. 707–740, DOI 10.1109/TSE.2016.2521368 —— 覆盖 ~400 篇 FL 论文的标准 survey。

---

## 9. Automated Program Repair——从找到 bug 到自动修

### 9.1 GenProg——2009 的第一发

**Weimer, W., Nguyen, T., Le Goues, C., Forrest, S. "Automatically Finding Patches Using Genetic Programming,"** *ICSE 2009*, DOI 10.1109/ICSE.2009.5070536（<https://www.clairelegoues.com/assets/papers/weimer09icse.pdf>）—— 把 program AST 当 GA 种群，mutate (delete / copy / swap) + crossover，fitness = 通过 positive test 数 − failing negative test 数。找到通过全 test 的 variant 就 delta-debug 到最小化 patch。

ICSE 2009 Best Paper + ACM SIGEVO HUMIES 2009。

**Le Goues, C., Dewey-Vogt, M., Forrest, S., Weimer, W. "A Systematic Study of Automated Program Repair: Fixing 55 out of 105 Bugs for $8 Each,"** *ICSE 2012* —— **GenProg 在 105 个真实 C bug 上修了 55 个，每 bug 平均 $8 云计算时间**。APR 第一次被算到"per-bug 经济成本"。

### 9.2 SemFix / PAR / Prophet——三条改进路线

**Nguyen, H.D.T., Qi, D., Roychoudhury, A., Chandra, S. "SemFix: Program Repair via Semantic Analysis,"** *ICSE 2013*, DOI 10.1109/ICSE.2013.6606623 (Most Influential Paper) —— **semantics-based repair**：用 Tarantula 定位，把 buggy 表达式替换成自由 symbol，KLEE symbolic execution 从 test suite 推 symbol constraint，synthesize 满足 constraint 的最小表达式。平均 3.8 分钟修一个 bug。

**Kim, D., Nam, J., Song, J., Kim, S. "Automatic Patch Generation Learned from Human-Written Patches,"** *ICSE 2013*, DOI 10.1109/ICSE.2013.6606626 (SIGSOFT Distinguished Paper) —— **PAR**：人工总结 10 个 fix pattern (null check insertion, parameter replacement 等) 作为 mutation 字母表。回应了 GenProg 的"生成 patch 没意义"批评。

**Long, F. & Rinard, M. "Automatic Patch Generation by Learning Correct Code,"** *POPL 2016*, DOI 10.1145/2837614.2837617（<https://groups.csail.mit.edu/pac/patchgen/>）—— **Prophet**：训练 log-linear model 学 commit history 上"好 patch"的分布，candidate patch 按 model probability 排序。69 个真实 bug 修了 15 个，比前 SOTA (SPR 修 11 个) 强。

**Mechtaev, S., Yi, J., Roychoudhury, A. "Angelix: Scalable Multiline Program Patch Synthesis via Symbolic Analysis,"** *ICSE 2016* —— 解决 SemFix 单行限制，引入 "angelic forest" 让 solver 对多个 suspicious location 同时推理。

### 9.3 Overfitting 危机——2015 的双重打击

**Smith, E.K., Barr, E.T., Le Goues, C., Brun, Y. "Is the Cure Worse Than the Disease? Overfitting in Automated Program Repair,"** *ESEC/FSE 2015*, DOI 10.1145/2786805.2786825 —— **APR 系统 ship 的 patch 在 held-out test 上不通过，是典型 ML overfitting**。Patch quality *"proportional to the coverage of the test suite used during repair"*。SIGSOFT Distinguished Paper + Test-of-Time。

**Qi, Z., Long, F., Achour, S., Rinard, M. "An Analysis of Patch Plausibility and Correctness for Generate-and-Validate Patch Generation Systems,"** *ISSTA 2015*, DOI 10.1145/2771783.2771791 —— 重新审 GenProg/RSRepair/AE 的 reported patch，**发现绝大多数实际通过测试的 patch 是"删除有问题的 branch"，等价于砍掉功能让 failing test 不再 fail**。

两篇加起来是 APR 的 reproducibility 大整顿。2015 之后 APR paper 必须报 held-out test result，不准只报"通过驱动 test"。

### 9.4 Neural APR

**Gupta, R., Pal, S., Kanade, A., Shevade, S. "DeepFix: Fixing Common C Language Errors by Deep Learning,"** *AAAI 2017*, DOI 10.1609/aaai.v31i1.10742 —— seq2seq + attention 直接学 buggy → fixed，在 6971 个学生 C 程序上 fully fix 27%。

**Tufano, M., Watson, C., Bavota, G., Di Penta, M., White, M., Poshyvanyk, D. "An Empirical Study on Learning Bug-Fixing Patches in the Wild via Neural Machine Translation,"** *ACM TOSEM* 2019, DOI 10.1145/3340544（<https://arxiv.org/abs/1812.08693>）—— 把 NMT 抬到 GitHub mining 来的 real-world Java bug fix，9%–50% 与真实 commit 完全一致。

**Lutellier, T., Pham, H.V., Pang, L., Li, Y., Wei, M., Tan, L. "CoCoNuT: Combining Context-Aware Neural Translation Models using Ensemble for Program Repair,"** *ISSTA 2020*, DOI 10.1145/3395363.3397369 —— 双 encoder（buggy line + 上下文）+ 多 model ensemble，是 LLM 时代之前的 neural APR 终态。

### 9.5 Defects4J——基准的胜利

**Just, R., Jalali, D., Ernst, M.D. "Defects4J: A Database of Existing Faults to Enable Controlled Testing Studies for Java Programs,"** *ISSTA 2014*, DOI 10.1145/2610384.2628055（<https://homes.cs.washington.edu/~mernst/pubs/bug-database-issta2014-abstract.html>）—— 357 个真实 Java bug，每个带 buggy version、fixed version、developer patch、reproducing test。**2014 之后 APR / SBFL 论文不用 Defects4J 必须解释为什么**。

**Monperrus, M. "Automatic Software Repair: A Bibliography,"** *ACM Computing Surveys* 51(1), Article 17, Jan 2018, DOI 10.1145/3105906（<https://arxiv.org/abs/1807.00515>）—— pre-LLM APR 的标准 survey。

---

## 10. LLM 时代 (2021–2026)

### 10.1 Codex / HumanEval / MBPP / AlphaCode

**Chen, M. et al. (OpenAI) "Evaluating Large Language Models Trained on Code,"** arXiv:2107.03374, 2021-07（<https://arxiv.org/abs/2107.03374>）—— Codex paper，introduce HumanEval（164 题 Python，hand-written + unit test）和 pass@k metric。最大 Codex model **HumanEval pass@1 28.8%，pass@100 70.2%**。GPT-3 baseline pass@1 是 0%。

**Austin, J. et al. (Google) "Program Synthesis with Large Language Models,"** arXiv:2108.07732, 2021-08 —— MBPP (974 Python tasks)。最大 137B model **MBPP few-shot pass 59.6%**。这两个 benchmark 主导 LLM 代码评估三年。

**Li, Y. et al. (DeepMind) "Competition-Level Code Generation with AlphaCode,"** *Science* 378(6624), 2022-12, DOI 10.1126/science.abq1158 (arXiv:2203.07814) —— 在 Codeforces 上 cluster + filter 百万 sample 到 10 个 submission。**Codeforces top 54.3%**，接近人类中位。

### 10.2 SWE-bench 与 agentic coding

**Jimenez, C.E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., Narasimhan, K. "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?"** *ICLR 2024*, arXiv:2310.06770 —— **2294 个真实 GitHub issue**，12 个流行 Python 仓库 (django, sympy, scikit-learn…)。agent 拿到 repo snapshot + issue description，输出 patch，跑项目隐藏 test。**Claude 2 (paper 时 best model) 只 resolve 1.96%**。

SWE-bench 把 LLM 评估从"算法题"切到"软件工程任务"，定义了"agentic coding"这个产品类别。

**Yang, J., Jimenez, C.E., Wettig, A., Lieret, K., Yao, S., Narasimhan, K., Press, O. "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering,"** *NeurIPS 2024*, arXiv:2405.15793 —— 核心 thesis：**agent harness 比 model 重要**。给 LLM 配一个限制性的 ACI (file editor + shell + search)，不换模型，SWE-bench pass 从 <2% 涨到 12.5%。

OpenAI 2024-08-13 发布 **SWE-bench Verified**：93 个职业工程师 hand-curate 500 个 issue，剔除 ambiguous 和 hidden-test-flawed 的 task。**GPT-4o 16% → Verified 33.2%**，证明原 benchmark 系统性低估 model 能力。Verified 成为之后 18 个月事实标准。

### 10.3 LLM4Test 与 LLM4APR

**Schäfer, M., Nadi, S., Eghbali, A., Tip, F. "An Empirical Evaluation of Using Large Language Models for Automated Unit Test Generation,"** *IEEE TSE* 2024, DOI 10.1109/TSE.2023.3334955（arXiv:2302.06527）—— **TestPilot**：GPT-3.5-turbo 用 function signature + 邻近 signature + example test prompt，生 JS unit test，跑真 test harness。1684 个 API function × 25 npm package 上，**median statement coverage 70.2%、branch coverage 52.8%**，比 SBST baseline (51.3%/25.6%) 显著强；92.8% generated test 与 existing test 相似度极低（不是 memorization）。

**Lemieux, C., Inala, J.P., Lahiri, S.K., Sen, S. "CodaMOSA: Escaping Coverage Plateaus in Test Generation with Pre-trained Large Language Models,"** *ICSE 2023*, DOI 10.1109/ICSE48619.2023.00085 —— **neuro-symbolic 模板**：SBST 跑到 coverage plateau 时，让 Codex 给 under-covered 函数 seed example test，喂回 GA loop。486 个 Python benchmark 上，**比 SBST-only 在 173 个 benchmark 上提升 coverage、只在 10 个上降**。

### 10.4 Claude Code 与 Anthropic 代码模型

Anthropic *"Claude 3.5 Sonnet,"* 2024-06-21（<https://www.anthropic.com/news/claude-3-5-sonnet>）—— 第一个以 coding 为主营销点的 Claude，内部 agentic coding eval **64%（前代 Opus 38%）**。

Anthropic *"Claude 3.7 Sonnet and Claude Code,"* 2025-02-24（<https://www.anthropic.com/news/claude-3-7-sonnet>）—— **Claude Code 作为 limited research preview 推出**：terminal-resident agent，能 search/read code、edit files、write/run test、commit/push GitHub。Claude 3.7 Sonnet on SWE-bench Verified **63.7% basic / 70.3% high-compute**。

Anthropic *"Introducing Claude 4,"* 2025-05-22（<https://www.anthropic.com/news/claude-4>）—— Claude Code 进入 GA；**Claude Opus 4 on Verified 72.5% / Terminal-bench 43.2%**。Claude Sonnet 4.5 (2025-09) 推 **77.2% / 82.0% high-compute**。

### 10.5 2024-03 的 Devin 风波

Cognition Labs 2024-03-12（<https://cognition.ai/blog/introducing-devin>）自称"第一个 AI 软件工程师"，**SWE-bench resolve 13.86%**（彼时公开 SOTA 1.96%，提升 7×）。引发一波 agent 投资和方法学反弹。

**Kapoor, S., Stroebl, B., Narayanan, A. "AI leaderboards are no longer useful. It's time to switch to Pareto curves,"** AI Snake Oil (现 <https://www.normaltech.ai/p/ai-leaderboards-are-no-longer-useful>) 2024-04-30 —— **leaderboard 报数不归一化 cost 是误导**：*"agent architectures for HumanEval do not outperform our simpler baselines despite costing more."* 该文核心针对的是 HumanEval-Pareto 而非 Devin/SWE-bench 直接，但行业对 leaderboard 报数的怀疑情绪从此回不去。

### 10.6 2026-02：SWE-bench Verified 也退役

OpenAI 2026-02 *"Why we no longer evaluate SWE-bench Verified"*（URL: <https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/>，正文 fetcher 拿不到，内容来自 OpenAIDevs X post + 二手覆盖）—— 核心发现：**Verified 的 failed test case 里 59.4% 本身有缺陷**；所有 frontier model (GPT-5.2, Claude Opus 4.5, Gemini 3 Flash) **都能 verbatim 复现 gold patch 和原 problem 描述** —— 明确的 training data contamination 证据。

OpenAI 不再报 Verified，推荐 **SWE-bench Pro**（Scale AI / Deng et al. arXiv:2509.16941, 2025-09，<https://arxiv.org/abs/2509.16941>）—— 1865 个 long-horizon 任务跨 41 个仓库（含 commercial proprietary），"may require hours to days for a professional software engineer to complete"。

二手 leaderboard 报 Claude Opus 4.5 在 Verified 上 ~80.9%、在 Pro 上 ~45.9% —— **35 个百分点的 gap 是当前 LLM4SE 评估方法论争议的核心数据**。

### 10.7 LLM4SE 整体 survey

**Hou, X., Zhao, Y., Liu, Y. et al. "Large Language Models for Software Engineering: A Systematic Literature Review,"** *ACM TOSEM* 2024, DOI 10.1145/3695988（<https://arxiv.org/abs/2308.10620>）—— **395 篇论文 2017-01 到 2024-01**。

**Fan, A. et al. "Large Language Models for Software Engineering: Survey and Open Problems,"** *ICSE-FoSE 2023*, arXiv:2310.03533 —— position paper，**核心命题：hallucination 是核心障碍，hybrid (LLM + SBST / symbolic execution / type checker feedback) 是必经之路**。

**Wang, J., Huang, Y., Chen, C., Liu, Z., Wang, S., Wang, Q. "Software Testing with Large Language Models: Survey, Landscape, and Vision,"** *IEEE TSE* 2024, arXiv:2307.07221 —— 102 个 testing-with-LLM 研究。

---

## 11. 这一代的整体形状

把 1990–2026 三十六年压成几个变化轴：

| 维度 | 1990s | 2000s–2010s | 2020s |
|---|---|---|---|
| 自动找 bug 的算法 | random fuzz / structural coverage | coverage-guided fuzz / concolic / mutation | LLM + traditional 混合 |
| 自动定位 bug | print / gdb | SBFL / 统计 / delta debugging | LLM 直接 explain + hybrid SBFL |
| 自动修 bug | (人) | GenProg → SemFix → Prophet | Neural APR → LLM APR → agentic |
| 评估基准 | Siemens 130 fault | Defects4J 357 fault | SWE-bench / Verified / Pro |
| 评估争议 | "coverage 没用" (2014) | "SBFL 在真 bug 上失败" (2017) | "Verified contamination" (2026) |

可以看出一个反复出现的 pattern：**每一代有效的 bug-finding 技术，在大约 5–8 年后会被一篇 "in real conditions it doesn't work" 的 paper 推翻** —— Inozemtseva 2014 推翻 coverage、Smith 2015 推翻 APR、Pearson 2017 推翻 SBFL、OpenAI 2026 推翻 Verified。这是健康学科该有的 self-correction，但也意味着：**不要在产品营销里给一个 metric 押 5 年的注**。

第二个 pattern：**真正 ship 的 bug-finding 技术不是单一算法，是混合栈** —— Driller (AFL + KLEE)、CodaMOSA (SBST + Codex)、Google OSS-Fuzz (4 个引擎 + 100K VM)、Claude Code (LLM + grep/sed/git CLI)。Agent 产品的设计取向不是"打造单一 SOTA 算法"，而是"orchestrator over verified building blocks"。

---

## 📚 还该读什么

1. **Klees, Ruef, Cooper, Wei, Hicks "Evaluating Fuzz Testing," CCS 2018** (<https://arxiv.org/abs/1808.09700>) —— 所有 fuzz / test gen 实证方法学的 ground truth。读完知道为什么"我们的 fuzzer 找到比 AFL 多 20% 的 bug" 几乎肯定是统计偏误。
2. **Cadar & Sen "Symbolic Execution for Software Testing: Three Decades Later," CACM 2013** (<https://people.eecs.berkeley.edu/~ksen/papers/cacm13.pdf>) —— symbolic execution 至今的诚实总结，把 path explosion / constraint solver / memory / environment 四面墙讲透。
3. **Monperrus "Automatic Software Repair: A Bibliography," ACM CSUR 2018** (<https://arxiv.org/abs/1807.00515>) —— pre-LLM APR 的全谱地图。
4. **Hou et al. "Large Language Models for Software Engineering: A Systematic Literature Review," ACM TOSEM 2024** (<https://arxiv.org/abs/2308.10620>) —— LLM4SE 整体地形图。395 篇论文。
5. **Yang et al. "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering," NeurIPS 2024** (<https://arxiv.org/abs/2405.15793>) —— "agent harness 比 model 重要" 的最强经验证据，对设计 agent product 直接相关。

## ❓ 我还没搞清楚的 3 个问题

1. **2026-02 OpenAI 撤 SWE-bench Verified 之后，行业接下来在什么 benchmark 上对齐？** SWE-bench Pro 是 Scale AI 的，frontier lab 之间会接受第三方策划的 ground truth 吗？还是各家会回退到 internal eval？这关系到 agent 产品该把哪个数字写在 marketing material 上。
2. **CodaMOSA-style 的 SBST + LLM 混合，在 2026 的 LLM 能力下还有价值吗？** 当 LLM 单独就能跑出比 EvoSuite 高的 coverage，hybrid 还是 strict superior 还是退化成了 LLM-only？没看到对照实验。
3. **OpenAI 报告说 frontier model 能 verbatim 复现 SWE-bench problem —— 这是因为 training data 包含 SWE-bench 原始仓库的 commit history (大概率)，还是因为更深的 leak (例如评估服务的 prompt log)？** 这两者的产品 implications 完全不同：前者意味着所有"从 GitHub 训"的 model 都污染了一部分 OSS benchmark；后者是 evaluation infrastructure 的 trust issue。

## 💡 对产品的具体启发

1. **承认 benchmark 失真，不押 single metric。** Inozemtseva 2014 / Smith 2015 / Pearson 2017 / OpenAI 2026 同一个 pattern：当前的"客观度量"几乎一定在 5 年内被推翻。产品不要在"我们在 X benchmark 上 SOTA"上下重注 —— 而是给用户复现 benchmark 之外的真实 case study。
2. **混合栈 > 单一算法。** Driller (AFL + KLEE)、CodaMOSA (SBST + LLM)、OSS-Fuzz (4 个引擎)、Claude Code (LLM + CLI) —— 所有 ship 出去的 bug-finder 都是 hybrid。Agent 产品的差异化不在"我们发明了一个新算法"，在"我们把这套 building blocks orchestrate 得好"。
3. **学 Driller 的 hybrid 模板和 SWE-agent 的 ACI 思想：agent 的 leverage 在 interface，不在算力。** SWE-agent 用同个 GPT-4 把 SWE-bench 从 <2% 拉到 12.5% 是改 ACI 不是改 model。产品该花最多时间设计 agent 与 tool / repo / fuzzer / solver / linter 之间的接口，而不是炼模型。
4. **真 bug 比合成 bug 重要 10 倍。** Pearson 2017 在 SBFL 上证明了，Shamshiri 2015 在测试生成上证明了。Agent 产品的迭代 loop 必须围绕真 bug benchmark (Defects4J / BugSwarm / 用户自己的 commit history)，不是 mutation-generated fault 或 synthetic prompt。
5. **拥抱"找的 bug 是哪一类、找不到哪一类"的显式表态。** Beizer pesticide paradox 在 LLM agent 上重现：纯 LLM 抓 typo / off-by-one / null check 漏强，抓 race condition / 系统级 concurrency / data corruption 弱。产品 marketing 与其说"我们抓所有 bug"，不如说"我们这套 agent 在 X 类 bug 上 Y% recall，Z 类 bug 我们不抓 —— 配合下游 Q 工具"。这种 honest scoping 是 Context-Driven School（doc 1 §3.3）落到 agent 上的版本。

---

**文档边界**

这份只到 LLM4SE / agentic coding。Formal methods (Hoare / model checking / TLA+ / Coq) 留给 doc 3。CI/CD / SRE / observability / chaos engineering / feature flag 留给 doc 5。

说「继续」进入 doc 3 *形式方法与类型系统*。
