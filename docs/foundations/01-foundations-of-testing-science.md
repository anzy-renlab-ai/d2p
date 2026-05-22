# 01 — 测试科学的奠基

> 给一个想从零设计 AI agent 时代 bug 发现 + 修复产品的工程师。
> 这份文档解释这门学科为什么存在、它最硬的几个观点是谁说的、原文在哪。
> 后续 5 份的逻辑钩子都在这里。

---

## 0. 这份文档不要回答什么

它不告诉你「应该怎么写测试」。
它告诉你 1947–1988 这四十年间，软件测试是怎么从「工人在 panel 里拍苍蝇」变成一门有数学定义、有公理体系、有产业标准的学科的——以及在这条线索的尽头，工业界为什么仍然在为「测了等于没测」吵架。

后面 doc 2 才进入「现代 bug 发现技术」。这一份只盘地基。

---

## 1. 词的起源——"bug" 不是 1947 年发明的

软件圈最流传的故事——1947 年 9 月 9 日下午 3 点 45 分，Grace Hopper 团队从 Harvard Mark II 的 Relay #70 取下一只飞蛾，贴进 logbook，写下 *"First actual case of bug being found"*——是真的，但解释错了。

那只蛾子和 logbook 现存于 Smithsonian National Museum of American History，馆藏号 `nmah_334663`（canonical URL: <https://americanhistory.si.edu/collections/object/nmah_334663>，从特定网络访问可能被 CDN 拦截但 URL pattern 标准）。logbook 的关键词是 *"first actual case"*——说明 "bug" 这个词当时已经是行业黑话。Hopper 没有发明它，她把它从工程车间带到了软件。

真正的源头是 Thomas Edison。1878 年 11 月 13 日他写给 Tivadar Puskás 的信里说：

> *"This thing gives out and then that. 'Bug'—as such little faults and difficulties are called—show themselves, and months of anxious watching, study, and labor are requisite before commercial success—or failure—is certainly reached."*
>
> ——Edison to Puskás, 1878-11-13. 复刻于 IEEE Spectrum: <https://spectrum.ieee.org/did-you-know-edison-coined-the-term-bug>

也就是说，**1947 年那只蛾子是个隐喻成真，不是隐喻诞生**。1878–1947 之间，"bug" 是工程师对自家造物「不肯按预期工作」的拟人化称呼，本身就带着「它是个调皮的小东西，跟我无关」的甩锅腔。

正是这一点让 Dijkstra 1988 年在 EWD 1036 直接拍桌：

> *"We could, for instance, begin with cleaning up our language by no longer calling a bug a bug but by calling it an error. ... The animistic metaphor of the bug that maliciously sneaked in while the programmer was not looking is intellectually dishonest as it disguises that the error is the programmer's own creation."*
>
> ——EWD 1036 "On the cruelty of really teaching computing science" 1988. <https://www.cs.utexas.edu/~EWD/transcriptions/EWD10xx/EWD1036.html>

把这条线索压进产业标准，是 IEEE 和 ISTQB 后来的工作。**IEEE Std 1044-2009 "Standard Classification for Software Anomalies"**（<https://standards.ieee.org/ieee/1044/4607/>）给出一条因果链：

> *error*（一个程序员的错误动作） → *fault*（这个错误在代码里的具体形态） → *failure*（程序运行时偏离了预期）

defect 是 fault 的超集——fault 是「会在执行中浮现」的那部分 defect。ISTQB Glossary（<https://istqb-glossary.page/> ）则把 `defect = fault = bug` 三者列为同义词，error 仍然单列。两份标准对 *error* / *failure* 定义一致，对 *defect / fault / bug* 切法略不同但同源。

**为什么这条术语线索对 agent 产品重要**：你的产品对外说自己抓什么？抓 "bug" 等于继承了 Edison 的拟人甩锅腔，用户会期待你像捕虫器一样神奇。改说 "抓 programmer mistake"（Dijkstra 的版本），用户期待变成「帮我看我哪儿写错了」——后者更准确也更可达成。

---

## 2. 1969 罗马：Dijkstra 那句被引烂了的话

1969 年 10 月，NATO 在罗马办了第二届 Software Engineering Conference。Dijkstra 提交了一篇短文 "Structured programming"，里面写道（NATO Software Engineering Techniques 报告，Brussels 1970 年 4 月出版，p. 16）：

> *"Testing shows the presence, not the absence of bugs."*

第二年他把这句话扩成 **EWD249 "Notes on Structured Programming"** 第 3 节 "On the reliability of mechanisms" 末尾的推论（<https://www.cs.utexas.edu/~EWD/transcriptions/EWD02xx/EWD249/EWD249.html>）：

> *"Program testing can be used to show the presence of bugs, but never to show their absence!"*

这句话被引用了 50 年，但绝大多数人没读上下文。Dijkstra 的真正命题不是「测试没用」，而是**认识论非对称**：通过测试 = 一个反例没出现 = 还有任意多个潜在反例没出现；反过来，**找不到 bug 不构成「没有 bug」的证据**。所以 "testing as falsification" 是合法方法论，"testing as verification" 是逻辑错误。

这条命题催生了两条互相敌对的工程传统：

1. **形式验证派**——Hoare logic、weakest precondition、type system、SMT solver、model checking。既然 testing 不能 verify，那就用数学证明。这条线索是 doc 3。
2. **概率退而求其次派**——Hamlet 1987 之后的 statistical / random testing 路线。承认 testing 不能 verify，但试着给出 reliability 的概率下界。这条线索贯穿 doc 2。

Agent 时代值得反复回到的一点：**Dijkstra 没有过时**。任何宣称「跑了 1 万个测试都过了，所以代码 OK」的 AI agent，都是在被这句话直接打脸。

---

## 3. 四本书与四个人——把 "测试" 造成一门职业

### 3.1 Glenford J. Myers，*The Art of Software Testing* (Wiley, 1979)

ISBN 0-471-04328-1。Internet Archive 完整扫描：<https://archive.org/details/artofsoftwaretes00myer>。第二版 2004 与 Sandler / Badgett 合作；第三版 2011，Wiley Online Books DOI 10.1002/9781119202486。

Myers 给了软件测试两个被引用了 45 年的定义：

> *"Testing is the process of executing a program with the intent of finding errors."*
> *"A successful test case is one that detects an as-yet undiscovered error."*

这是对 Dijkstra 的回答。Dijkstra 说 testing 不能 verify，Myers 说**那就把目标改成 falsify**——一个测试用例不是为了「证明对」存在的，是为了「找新错」存在的。目标转换看似小，落到工程上极大：它把测试人员的心理状态从「守门员」变成「猎手」。Myers 整本书都是这个猎手手册——equivalence partitioning、boundary value analysis、cause-effect graphing、decision table、error guessing——后来的 ISTQB 课本基本是这套技法的扩写。

Myers 真正的贡献不在技法层（那些技法 IBM 内部早有），是把**测试设计当成一门有方法论的事**，并且公开命名了一个反直觉的事实：**写出能让程序失败的输入，比写出让它通过的输入难得多**。

### 3.2 Boris Beizer，*Software Testing Techniques* (Van Nostrand Reinhold, 1983 / 1990)

第二版 1990 年 ISBN 0-442-20672-0。Beizer 给出了软件测试领域两条最常被引用的「定律」（textarcana 整理：<https://gist.github.com/textarcana/1298405>）：

> **Pesticide Paradox**: *"Every method you use to prevent or find bugs leaves a residue of subtler bugs against which those methods are ineffectual."*
>
> **Complexity Barrier**: *"Software complexity (and therefore that of bugs) grows to the limits of our ability to manage that complexity."*

杀虫剂悖论是这一份文档里最值得抄下来的一句话。它说：**你用什么方法去防 / 查 bug，剩下的就是这个方法查不出来的那种 bug**。一个测试套件过了一万遍都不出新错，不代表代码没 bug，只代表这个套件已经被驯化、磨平、失效了。

落到 AI agent 产品：**单一引擎 / 单一 oracle / 单一覆盖准则的 agent，必然会形成自己的杀虫剂残留**。要么显式轮换 fault model，要么用第二个 engine cross-check，要么明确告诉用户「我们这个 agent 抓的是 X 类 bug，剩下的不归我们」。

Beizer 同时是 control-flow / data-flow 结构测试的工业化推手，他的书把第 4 节里 Weyuker / Rapps 的形式定义翻译成可操作的工程技法。

### 3.3 Cem Kaner，*Testing Computer Software* (TAB 1988 / Wiley 1993) + *Lessons Learned in Software Testing* (Wiley 2002)

*Lessons Learned* ISBN 0-471-08112-4。这本书与 Kaner / Bach / Pettichord 一起开创的 **Context-Driven School of Testing** 是软件测试领域对 ISO / IEEE / ISTQB 标准化浪潮最系统的反抗。他们的七条原则（<https://www.context-driven-testing.com/>）verbatim 摆这儿：

> 1. *The value of any practice depends on its context.*
> 2. *There are good practices in context, but there are no best practices.*
> 3. *People, working together, are the most important part of any project's context.*
> 4. *Projects unfold over time in ways that are often not predictable.*
> 5. *The product is a solution. If the problem isn't solved, the product doesn't work.*
> 6. *Good software testing is a challenging intellectual process.*
> 7. *Only through judgment and skill, exercised cooperatively throughout the entire project, are we able to do the right things at the right times to effectively test our products.*

对 agent 产品最辣的一条是 #5：**bug 是 mission-dependent 的**。一个返回 500 的接口在生产环境是灾难，在 staging 是预期；一段 O(n²) 排序在 10 项列表里是没事，在 10M 项列表里是 incident。**「什么算 bug」不在代码里，在产品规格 + 用户场景里**。一个不知道用户在干什么的 agent，无法做出有意义的 bug 判定。

Kaner 同时把 **exploratory testing** 从「黑客凭直觉乱戳」正名成一门可教学、可衡量的纪律。Doc 4 会再回来。

### 3.4 那个被遗漏的人——Edsger Dijkstra 本身

把 Dijkstra 当成第四个奠基者不算过分。除了 EWD 1036 关于「称呼 error 不称呼 bug」的诤言，他对「testing 没法 verify」的命题三十年没退让，反复在 EWD 系列里重申。他是 testing 学科外面的批判者，但他界定了这门学科能合法宣称什么、不能合法宣称什么。

---

## 4. 测试理论的数学化（1975–1988）

这一组论文回答一个问题：「**写到什么程度才算测够了？**」答案越严肃越坏，是这一组论文给后世留下的精神状态。

### 4.1 Goodenough & Gerhart 1975——第一次把「测够了」形式化

Goodenough, J.B. & Gerhart, S.L., "Toward a Theory of Test Data Selection," *IEEE Transactions on Software Engineering*, vol. SE-1 no. 2, June 1975, pp. 156–173, DOI 10.1109/TSE.1975.6312836（ETH Zürich 开源 PDF: <https://archiv.infsec.ethz.ch/intranet_secured/Y/w/GG75.pdf>）。

他们给出 test data selection criterion C 的两个性质（p. 494，verbatim）：

> **RELIABLE(C)**: For all T₁, T₂ ⊆ D, if T₁ and T₂ are both COMPLETE with respect to C, then T₁ is SUCCESSFUL iff T₂ is SUCCESSFUL.
>
> **VALID(C)**: For all d ∈ D, if ¬OK(d), there exists T ⊆ D such that T is COMPLETE w.r.t. C and T is not SUCCESSFUL.

读法：**reliable** = 两个都满足 criterion C 的 test set，要么一起 pass 要么一起 fail；**valid** = 存在 bug 时，至少有一个满足 criterion C 的 test set 会 fail。他们的 **Fundamental Theorem of Testing**：reliable + valid + complete + successful → 程序正确。

这条定理对工程师有意义吗？没有——**因为验证 reliable 和 valid 这两个前提，本身和证明程序正确一样难**。这篇论文的真正贡献是把「测试理论」做成一个可以被攻击、被批评、被改进的形式系统——它给出了下一代论文要打的靶子。

### 4.2 Howden 1976——把希望粉碎掉

Howden, W.E., "Reliability of the Path Analysis Testing Strategy," *IEEE TSE* vol. SE-2 no. 3, Sept 1976, pp. 208–215, DOI 10.1109/TSE.1976.233816（Howden 自己 UCSD 主页：<https://cseweb.ucsd.edu/~howden/MyPapers/Reliability%20of%20the%20Path%20Analysis.pdf>）。

Howden 的 Theorem 2 verbatim：

> *"There exists no computable procedure H which, given an arbitrary program P and function F can be used to generate a nonempty finite test set T ⊆ D such that: P(x) = F(x) for all x ∈ T ⇒ P(x) = F(x) for all x ∈ D."*

翻译：**没有任何可计算过程能生成 reliable test set**。证明里直接用到「两个程序是否等价」是不可判定的。

这条结果把 Goodenough-Gerhart 1975 的 reliable + valid 路线打成了哲学讨论。Howden 接着论证：path analysis（覆盖每条 control-flow 路径）这种当时学界看好的策略，只对极受限的程序类是 reliable 的。

测试学科的核心痛点从此公开化：**严格意义上的「测够」是不可达的工程目标**。后续四十年所有 coverage criterion / mutation testing / property-based testing 都是这个不可达目标的工程妥协。

### 4.3 Hamlet 1987——给出「测试到底买到了什么」的概率下界

Hamlet, R.G., "Probable Correctness Theory," *Information Processing Letters* vol. 25 no. 1, April 1987, pp. 17–25, DOI 10.1016/0020-0190(87)90088-3。Hamlet 自己的后续 survey "Random Testing"（<https://web.cecs.pdx.edu/~hamlet/random.pdf>）发挥同一套理论。

形式结果：对常数 failure rate θ 的程序，N 次独立 uniform 测试全 pass 的概率是 `(1−θ)^N`；要在置信度 `1−e` 下保证 MTTF > 1/θ，需要 `N = log(1−e) / log(1−θ)` 次测试。

worked example：3000 次 pass 只能在 95% 置信度下保证 MTTF > 1000 次执行。

这是测试学科的「残忍数字」。如果一个 AI agent 跑了 3000 个测试都过了，它能说什么？它能说**在 95% 置信度下，这段代码每 1000 次执行不会更频繁地崩**——这远远低于绝大多数产品对 "tested" 的隐含期待。

### 4.4 Weyuker 1986 / 1988——adequacy criterion 的 11 条公理

Weyuker, E.J., "Axiomatizing Software Test Data Adequacy," *IEEE TSE* vol. SE-12 no. 12, Dec 1986, pp. 1128–1138, DOI 10.1109/TSE.1986.6312965。1988 年扩到 11 条："The Evaluation of Program-Based Software Test Data Adequacy Criteria," *CACM* vol. 31 no. 6, June 1988, pp. 668–675, DOI 10.1145/62959.62963。

11 公理（Perry & Kaiser 1990 完整复述：<https://users.ece.utexas.edu/~perry/work/papers/joop.pdf>）：

1. **Applicability** — 每个程序都存在 adequate test set
2. **Non-Exhaustive Applicability** — adequate ≠ exhaustive
3. **Monotonicity** — T adequate, T ⊆ T' → T' adequate
4. **Inadequate Empty Set** — 空集对任何程序都不 adequate
5. **Antiextensionality** — 等价程序可能需要不同 test
6. **General Multiple Change** — 同形状程序可能需要不同 test
7. **Antidecomposition** — 整体充分 ≠ 部件充分
8. **Anticomposition** — 部件充分 ≠ 整体充分
9. **Renaming** — 重命名后 adequacy 不变
10. **Complexity** — 对任意 n，存在程序需要 size-n 但不能 size-(n−1) test set
11. **Statement Coverage** — adequate set 必须覆盖每条可执行语句

最戳人的是 7 和 8：**unit test 全过 ≠ system 对；system test 过 ≠ 每个 unit 对**。这条形式结果直接是 integration testing 存在合法性的数学依据，也是 agent 时代任何「我跑了所有单元测试都过了」声明背后的反例机器。

### 4.5 Rapps-Weyuker 1985 / Frankl-Weyuker 1988——data-flow 与 subsume hierarchy

Rapps, S. & Weyuker, E.J., "Selecting Software Test Data Using Data Flow Information," *IEEE TSE* vol. SE-11 no. 4, April 1985, pp. 367–375, DOI 10.1109/TSE.1985.232128。

把 control-flow coverage（statement、branch、path）扩展到 data-flow 维度：对每个变量的 (definition, use) 配对，至少跑一条 def-clear 的执行路径。命名了一族 criteria：all-defs、all-p-uses、all-c-uses、all-uses、all-du-paths。

Frankl-Weyuker 1988（"An Applicable Family of Data Flow Testing Criteria," *IEEE TSE* vol. 14 no. 10, Oct 1988, pp. 1483–1498, DOI 10.1109/32.6170）证明了著名的 **subsume hierarchy**：

> all-paths ⊃ all-du-paths ⊃ all-uses ⊃ {all-c-uses/some-p-uses, all-p-uses/some-c-uses} ⊃ all-defs / all-p-uses ⊃ all-edges (branch) ⊃ all-nodes (statement)

读这条偏序图带一个 caveat（Frankl-Weyuker 1998 自己也强调过）：**subsume ≠ 找 bug 强**。A 比 B subsume 严格，A 找 bug 不一定比 B 多。这是第 7 节实证回合的伏笔。

---

## 5. 覆盖率谱系——从 1963 到航空安全

### 5.1 Statement coverage 起源

Miller, J.C. & Maloney, C.J., "Systematic Mistake Analysis of Digital Computer Programs," *CACM* vol. 6 no. 2, Feb 1963, pp. 58–63, DOI 10.1145/366246.366248。

美国陆军 Chemical Corps 的 Miller 与 Maloney 是第一批在期刊上系统化提出「每条 instruction 至少执行一次」作为 test 完整性指标的。**现代 `gcov` / `Istanbul` / `coverage.py` 的祖父**。

### 5.2 Branch / decision coverage

没有单篇「发明」branch coverage 的论文。它在 1970s 工业测试工具（RXVP、TCAT、Logiscope）里成型，Myers 1979 把它写进教科书作为 statement coverage 的上一级。

### 5.3 MC/DC

Chilenski, J.J. & Miller, S.P., "Applicability of Modified Condition / Decision Coverage to Software Testing," *Software Engineering Journal* vol. 9 no. 5, Sept 1994, pp. 193–200, DOI 10.1049/sej.1994.0025。

公开 tutorial: Hayhurst et al., "A Practical Tutorial on Modified Condition / Decision Coverage," NASA/TM-2001-210876, May 2001（<https://ntrs.nasa.gov/api/citations/20010057789/downloads/20010057789.pdf>）。

要点：**branch coverage 不够细**。`if (a && b && c)` 是一个 branch、三个 condition。MC/DC 要求对每个 condition 找出一对 test，其中**只翻这个 condition** 就能翻转 decision 的结果。N 个 condition 至少要 N+1 个 test（远小于 2^N 的全条件 coverage）。

这是 FAA 给 DO-178B DAL A（致命级软件）的现实妥协——既不接受 branch coverage 的弱，又付不起全 condition coverage 的钱。

### 5.4 RTCA DO-178B (1992) / DO-178C (2011)

RTCA 出版（只卖不送），FAA AC 20-115D 是承认 DO-178C 的 advisory circular（<https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_20-115D.pdf>）。

| DAL | Failure 级别 | 结构覆盖要求 |
|---|---|---|
| A | Catastrophic | MC/DC + decision + statement |
| B | Hazardous | decision + statement |
| C | Major | statement |
| D | Minor | 仅 requirements-based test |
| E | No safety effect | 不在 DO-178C 范围 |

**这是世界上唯一在合同 / 法律层面要求 coverage 的领域**。其他所有行业都是自愿。任何 agent 想进入安全关键领域，「我们达到 MC/DC」是入场券，「我们达到 80% line coverage」是笑话。

### 5.5 Data-flow coverage 的工业死亡

Rapps-Weyuker 1985 的 all-uses / all-du-paths 在学界活了 40 年。**主流 coverage 工具至今没有一个真正实现它**——`gcov`、`JaCoCo`、`Istanbul`、`coverage.py` 全部止步于 line / branch。原因是工程的：跨函数 data-flow 分析贵，而且有大量 infeasible def-use pair（路径上的 predicate 让某些组合不可达），违反 Weyuker 1986 的 Applicability axiom。Frankl-Weyuker 1988 就是为修这个补丁，但补丁也没说服工具厂商。

**对 agent 产品的意义**：如果想给「更深」的 coverage 找空间，data-flow 是一个被验证的局部最优——技术上正确、学界正名、工业没人做。问题是值不值得做——第 7 节实证表明 mutation testing 的信号比 data-flow 还强。

---

## 6. Mutation Testing——另一条道路

### 6.1 DeMillo-Lipton-Sayward 1978——把问题翻过来

DeMillo, R.A., Lipton, R.J. & Sayward, F.G., "Hints on Test Data Selection: Help for the Practicing Programmer," *IEEE Computer* vol. 11 no. 4, April 1978, pp. 34–41, DOI 10.1109/C-M.1978.218136。

他们提出：**与其问「测试有没有覆盖到这段代码」，不如问「如果我把这段代码偷偷改一点点，测试会发现吗」**。把 `+` 改成 `−`、`<` 改成 `<=`、变量替换——这些「小改动」产生的程序变体叫 **mutant**。测试 kill 一个 mutant = 测试发现了原始程序和 mutant 的行为差异。kill rate 就是测试质量。

整篇论文建立在两条假设上。

### 6.2 Competent Programmer Hypothesis

> *"Programmers create programs that are close to being correct."*

人不会写出任意荒谬的程序，他们写出**近乎正确**的程序。所以错误的搜索空间被限制在「几乎正确的程序 + 小扰动」周围，而不是「所有可能的程序」。Mutation testing 把 mutation 限制为「程序员真会写错的那种小改动」——这是 syntactic mutation 操作符（AOR, ROR, COR, LCR 等）的合法性来源。

### 6.3 Coupling Effect Hypothesis

> *Tests that detect simple faults will also detect complex faults.*

简单错误的复合 = 复杂错误，所以杀死所有「一处改」mutant 的 test，大概率也能杀死「两处改」乃至更复杂的 mutant。Offutt 1992 经验验证："Investigations of the Software Testing Coupling Effect," *ACM TOSEM* vol. 1 no. 1, Jan 1992, pp. 5–20, DOI 10.1145/125489.125473——杀掉 >99% first-order mutant 的 test set，几乎杀光所有 second-order mutant。

### 6.4 Equivalent Mutants 问题

Budd, T.A. & Angluin, D., "Two notions of correctness and their relation to testing," *Acta Informatica* vol. 18 no. 1, Nov 1982, pp. 31–45, DOI 10.1007/BF00625279。

不是所有 mutant 都能被任何 test 杀死——有些 mutant 和原始程序行为完全一致（语义等价），它们活着不是因为 test 弱，是因为它们不死。判定 mutant 是否 equivalent 等价于程序等价问题，**不可判定**。这就是 mutation testing 在工业界三十年没普及的核心障碍。

Schuler & Zeller 2013（*STVR* vol. 23 no. 5, pp. 353–374, <https://www.st.cs.uni-saarland.de/publications/details/schuler-stvrbis-2013/>）人工分类发现：**所有存活的 mutant 里 ~45% 是等价的**。他们的 coverage-change heuristic 把 non-equivalent mutant 的识别精度做到 75%，召回 56%。

### 6.5 Mutant 算不算 real bug 的代理？两次实证

Andrews, J.H., Briand, L.C. & Labiche, Y., "Is Mutation an Appropriate Tool for Testing Experiments?" *ICSE 2005*, pp. 402–411, DOI 10.1145/1062455.1062530。

结论：**生成的 mutant 行为像 real fault；人工 seed 的 fault 行为不像**。这是 mutation testing 作为研究方法学的合法性。

Just, R., Jalali, D., Inozemtseva, L., Ernst, M.D., Holmes, R. & Fraser, G., "Are Mutants a Valid Substitute for Real Faults in Software Testing?" *FSE 2014*, pp. 654–665, DOI 10.1145/2635868.2635929（<https://homes.cs.washington.edu/~mernst/pubs/mutation-effectiveness-fse2014-abstract.html>）。

Defects4J 上 357 个真实 bug、5 个 Java 项目、321 KLOC：**mutation kill rate 与 real-bug detection 显著正相关，并且在 control for code coverage 之后仍然显著**。这是 mutation 战胜 coverage 的关键结果——单看 coverage 没有信号，加上 mutation 有信号。

### 6.6 工业化

| 工具 | 语言 | 主页 |
|---|---|---|
| **PIT** | JVM | <https://pitest.org> |
| **Stryker** | JS / TS / C# / Scala | <https://stryker-mutator.io> |
| **mutmut** | Python | <https://github.com/boxed/mutmut> |

### 6.7 Google 把它跑成了生产系统

Petrović, G. & Ivanković, M., "State of Mutation Testing at Google," *ICSE-SEIP 2018*, DOI 10.1145/3183519.3183521（<https://research.google/pubs/state-of-mutation-testing-at-google/>）。

关键工程取舍：

- **只 mutate diff**——不整个 codebase 跑，只针对 code review 里改动的行。
- **arid line suppression**——log 语句、equals / hashCode 样板等「无聊行」屏蔽掉，避免噪声。
- **嵌入 code review tool**——surviving mutant 直接以 review comment 形式呈现在 reviewer 面前，不是发送 PDF 报告。

数字：**6000 名 Google 工程师参与，覆盖 ~30% 的所有 code change，触达 14000+ author**。

**对 agent 产品的启发是赤裸的**：mutation testing 在工业能跑起来的唯一姿势是 (1) 只动 diff、(2) 嵌入开发者已经看的工具、(3) 屏蔽样板行。这三条全是 UX 决定，不是算法决定。

---

## 7. 覆盖率到底有没有用？三次实证回合

### 7.1 Hutchins, Foster, Goradia, Ostrand 1994——Siemens benchmark 诞生

*ICSE 1994*, pp. 191–200，开源 PDF: <https://selab.netlab.uky.edu/homepage/p191-hutchins.pdf>。

7 个 C 程序，130 个人手种入的 fault——这套 Siemens benchmark 是后面 20 年学界 test effectiveness 研究的标准底版。结论：**all-edges 和 all-DUs 互补**，谁也不主导谁；coverage >90% 的 suite 比同 size 的随机 suite 找 bug 显著更多。

### 7.2 Inozemtseva & Holmes 2014——ICSE Most Influential Paper

*ICSE 2014*, pp. 435–445, DOI 10.1145/2568225.2568271。在 5 个大 Java 项目（POI、Closure、HSQLDB、JFreeChart、Joda Time）上随机生成 31000 个 test suite subset，量 coverage 与 mutation kill rate 的关系。开源 PDF: <https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf>。

> *"Coverage, while useful for identifying under-tested parts of a program, should not be used as a quality target because it is not a good indicator of test suite effectiveness."*

**控制了 suite size 之后，coverage 与 effectiveness 的相关性从强变成 low-to-moderate**。suite size 本身是更好的预测变量。这篇 2024 拿了 ICSE Most Influential Paper（N+10）奖。

### 7.3 Kochhar, Thung & Lo 2015——用真 bug 重做一遍

*SANER 2015*, pp. 560–564, DOI 10.1109/SANER.2015.7081877。Apache HttpClient 67 个真实 bug + Mozilla Rhino 92 个真实 bug。

结论方向与 Inozemtseva 一致：**statement / branch / MC/DC coverage 都与 real-bug kill 显著相关，但强度 low-to-moderate**。Coverage 是 floor，不是 ceiling。

---

## 8. 三个被引用了几十年的案例

### 8.1 Therac-25 (1985–1987)

Leveson, N.G. & Turner, C.S., "An Investigation of the Therac-25 Accidents," *IEEE Computer* vol. 26 no. 7, July 1993, pp. 18–41, DOI 10.1109/MC.1993.274940（Leveson 自己 MIT 主页：<http://sunnyday.mit.edu/papers/therac.pdf>）。

6 例放疗机大剂量误照，至少 3 人死亡。两个软件缺陷：state machine 的 race condition（操作员输入比定时器快时 magnet 没归位）和 `Class3` 字节计数器 overflow。**真正的根因不是软件 bug，是组织层的失败**——Therac-20 的硬件 interlock 在 Therac-25 上被砍掉，软件接管了安全责任，但没有独立的 safety analysis、没有 fault tree、操作员的崩溃报告被 AECL 压下去。

> *"Most accidents are not the result of unknown scientific principles but rather of a failure to apply well-known, standard engineering practices."*
>
> ——Leveson & Turner 1993, conclusion

### 8.2 Ariane 5 Flight 501 (1996)

Lions, J.L. et al., *ARIANE 5 Flight 501 Failure — Report by the Inquiry Board*, Paris, 1996-07-19（开源 PDF: <https://agimcami.wordpress.com/wp-content/uploads/2013/05/ariane-5-flight-501-failure.pdf>；ESA 官方页：<https://www.esa.int/Newsroom/Press_Releases/Ariane_501_-_Presentation_of_Inquiry_Board_report>）。

发射后 39 秒解体。技术根因（report p. 13）：horizontal velocity 变量从 64-bit float 转 16-bit signed integer 时溢出。代码是从 Ariane 4 复用的——在 Ariane 4 的飞行剖面下这个值不会超过 32767，但 Ariane 5 跑得更快。两个冗余的 inertial reference system 一前一后挂了（5 ms 之内），主控把诊断 bit pattern 当成飞行数据，nozzle 打到底，气动撕碎了火箭。

> *"It is evident that the limitations of the SRI software were not fully analysed in the reviews, and it was not realised that the test coverage was inadequate to expose such limitations."* (p. 12)

**这个 bug 在 Ariane 4 的 test coverage 里是隐形的，在 Ariane 5 的 flight envelope 里是 catastrophic**。这是 Beizer pesticide paradox 的最贵注脚。

### 8.3 Mars Climate Orbiter (1999)

Stephenson et al., *Mars Climate Orbiter Mishap Investigation Board Phase I Report*, NASA, 1999-11-10（NASA 开源 PDF: <https://llis.nasa.gov/llis_lib/pdf/1009464main1_0641-mr.pdf>）。

地面软件 `SM_FORCES` 的 thrust impulse 数据以 pound-force-seconds 输出，JPL 的 navigation pipeline 按 Newton-seconds 消费。差 4.45 倍，9 个月 cruise 累积下来近火轨道掉了 169 km，进入大气解体。

> *"The MCO MIB has determined that the root cause for the loss of the MCO spacecraft was the failure to use metric units in the coding of a ground software file, 'Small Forces,' used in trajectory models."* (p. 16)

**单位错配是 interface contract 类 bug 的典范**——类型系统抓不到（两边都是 double）、unit test 抓不到（两边都对自己内部一致）、coverage 抓不到（每行都跑过）、mutation 抓不到（修改算子不动量纲）。它是 specification-level bug。

---

## 9. 这条线索的形状

把 1947–2018 七十年的关键节点摆一遍：

| 年 | 事件 |
|---|---|
| 1878 | Edison 信中 "bug" 一词工程黑话 |
| 1947 | Hopper Mark II moth（现存 Smithsonian） |
| 1963 | Miller-Maloney statement coverage 期刊化 |
| 1969 | Dijkstra NATO "testing shows presence not absence" |
| 1975 | Goodenough-Gerhart reliability / validity 形式化 |
| 1976 | Howden 不可判定性结果 |
| 1978 | DeMillo-Lipton-Sayward mutation testing |
| 1979 | Myers *Art of Software Testing* |
| 1982 | Budd-Angluin equivalent mutant 不可判定 |
| 1983 | Beizer *Software Testing Techniques* 1st ed |
| 1985 | Rapps-Weyuker data-flow coverage 家族 |
| 1986 | Weyuker 11 axioms |
| 1987 | Hamlet probable correctness |
| 1988 | Frankl-Weyuker subsume hierarchy / Kaner *Testing Computer Software* / Dijkstra EWD 1036 |
| 1990 | Beizer 2nd ed 公开 pesticide paradox |
| 1992 | Offutt coupling effect 实证 / DO-178B 发布 |
| 1993 | Leveson-Turner Therac-25 报告 |
| 1994 | Chilenski-Miller MC/DC / Hutchins Siemens benchmark |
| 1996 | Ariane 5 / Lions report |
| 1999 | Mars Climate Orbiter |
| 2001 | Hayhurst NASA MC/DC tutorial |
| 2002 | Kaner-Bach-Pettichord *Lessons Learned* |
| 2005 | Andrews-Briand-Labiche mutant ~ real fault |
| 2009 | IEEE 1044-2009 anomaly classification |
| 2011 | DO-178C |
| 2013 | Schuler-Zeller equivalent mutant heuristics |
| 2014 | Inozemtseva-Holmes coverage ⊥ effectiveness / Just et al. mutation kill rate predicts real bugs |
| 2015 | Kochhar 真 bug 重做 |
| 2018 | Petrović-Ivanković Google diff-based mutation |

读这张时间轴的直观感受：**1969–1988 这二十年解决了「测试是什么」的哲学问题，1985–2018 这三十年解决的是「怎么把测试做得不可笑」的工程问题**。1969 那条 Dijkstra 命题至今没被推翻。

---

## 📚 还该读什么

1. **Kaner, Bach & Pettichord, *Lessons Learned in Software Testing* (Wiley 2001).** 293 条 lesson，覆盖 testing project / testing group / bug advocacy / managing test。比这份文档引的「七原则」系统得多。
2. **Bertrand Meyer, *Object-Oriented Software Construction*, 2nd ed (Prentice Hall 1997).** Design by Contract / pre-postcondition 的工程化展开，doc 3 形式方法的入口。
3. **Knuth, D.E., "The Errors of TeX," *Software—Practice and Experience* vol. 19 no. 7, July 1989, pp. 607–685, DOI 10.1002/spe.4380190702.** Knuth 把 TeX 开发十年里自己的 850+ bug 分成 15 类（A=algorithmic, B=blunder, C=cleanup, D=data-structure debacle, E=efficiency, F=forgotten function, G=generalization, I=interactive, L=language, M=mismatch, P=portability, Q=quality of output, R=robustness, S=surprises, T=typo），是 root-cause taxonomy 的祖师爷。Wiley DOI 是 canonical citation；PDF 开放镜像不稳定。
4. **Hamlet, R.G., "Random Testing"**（chapter in *Encyclopedia of Software Engineering*, Wiley 1994，<https://web.cecs.pdx.edu/~hamlet/random.pdf>）。Hamlet 1987 的 self-contained survey 版本，比 IPL 短文好读得多。
5. **Andreas Zeller, *Why Programs Fail: A Guide to Systematic Debugging*, 2nd ed (Morgan Kaufmann 2009).** Delta debugging 论文系列的教科书化，是 doc 2「bug 发现技术前沿」的桥梁读物。

## ❓ 我还没搞清楚的 3 个问题

1. **DO-178C 的 MC/DC 在 LLM-generated test suite 上算什么样的 evidence？** FAA AC 20-115D 假设 test 是人写的或工具按规则生成的。生成式 AI 跑出来满足 MC/DC 的 test 是否被认证机构接受是开放问题——目前没看到 FAA / EASA / 中国民航局正式立场。
2. **Inozemtseva 2014 用 mutation 作为 ground truth、Just 2014 用 mutation kill rate 当 metric——两篇是不是循环论证？** Just 等人在 §6.5 已经反驳过（control for coverage），但他们 control 的方法是否充分把 mutation 和 coverage 的内在相关性完全摘出来，看完论文还有疑问。
3. **Context-Driven School（Kaner / Bach）vs ISTQB 标准化派的争论，2015 年之后基本沉默——是 ISTQB 赢了、Context-Driven 赢了、还是两派都不再关心 testing 这个学科？** 这关系到 agent 产品该把自己定位成 "standardized QA tool" 还是 "context-driven testing partner"，没有合适的数据回答。

## 💡 对产品的具体启发

1. **不要承诺「找所有 bug」。** Dijkstra 1969、Howden 1976、Hamlet 1987 三个独立结果同时说 testing 不能 verify、不能 reliable、概率上界很弱。任何 agent 宣称的「全面 bug 检测」在这三篇论文面前是营销话术。**对外的 claim 应该是「find a class of bugs we can characterize, miss a class we can't」——把 Beizer pesticide paradox 的 residual 显式化**。
2. **不要用 line coverage 当 KPI。** Inozemtseva 2014（ICSE Most Influential）和 Kochhar 2015 已经把这条钉死。**Mutation kill rate 是更强的信号**，Just 2014 + Google 2018 验证过。如果 agent 给用户一个 "test suite quality" 数字，那个数字应该是 mutation-based，不是 coverage-based。
3. **学 Google 的 diff-only + UI-embedded 模式。** Petrović-Ivanković 2018 的工业经验说：mutation testing 在工业唯一能跑起来的姿势是 (a) 只动 diff、(b) 嵌入开发者已经看的 review 工具、(c) 屏蔽样板行。这三条不是算法选择，是 UX 选择——agent 产品要在第一天就把这三条做对。
4. **把「什么算 bug」做成可声明的输入。** Kaner Context-Driven 原则 #5 "the product is a solution; if the problem isn't solved, the product doesn't work"——bug 是 mission-dependent 的。agent 不能拿一套固定 oracle 跑所有项目。**先问用户「我们要解决什么」，再判什么算 bug**。
5. **把术语 "bug" 换成 "mistake" 或 "error"。** Edison 的 "bug" 传统是 anthropomorphic 甩锅；Dijkstra EWD 1036 主张称呼 error 让程序员承担责任。对一个帮程序员找问题的 AI agent，**用 "error" 框定问题让用户期待「我哪里写错了」，比 "bug" 期待「哪只虫子偷溜进来了」更准确、更可达成**。

---

**文档边界（不要混淆）**

这份只讲到 mutation testing 的工业化和 Defects4J 时代。Symbolic execution、concolic、fuzzing、property-based testing、AI-augmented testing 全部留给 doc 2。Formal methods（Hoare logic / dependent types / model checking）留给 doc 3。CI/CD / SRE / observability / chaos engineering 留给 doc 5。

说「继续」进入 doc 2 *Bug 发现研究前沿（1990s–now）*。
