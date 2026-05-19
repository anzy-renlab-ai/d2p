// Lightweight i18n — no react-i18next / no runtime deps. The dict lives here
// (one source of truth), the hook lives in useLocale.ts, and `t(key)` returns
// the string for the active locale, falling back to the key itself if a key
// is unknown so missing translations are visible (not silently empty).

export type Locale = 'zh' | 'en';

export const LOCALES: { id: Locale; label: string; native: string }[] = [
  { id: 'zh', label: 'Chinese', native: '中文' },
  { id: 'en', label: 'English', native: 'English' },
];

export const DEFAULT_LOCALE: Locale = 'zh';

const STORAGE_KEY = 'd2p.locale';

export function loadInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const raw = window.localStorage?.getItem(STORAGE_KEY);
  if (raw === 'en' || raw === 'zh') return raw;
  const browser = (typeof navigator !== 'undefined' && navigator.language) || '';
  if (/^en/i.test(browser)) return 'en';
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore quota / private mode */
  }
}

// Dict is an object keyed by string id. Add keys here when you i18n-ize a
// new component. Missing en falls back to zh; missing both falls back to key.
type Dict = Record<string, { zh: string; en: string }>;

export const dict: Dict = {
  // ── App-wide ────────────────────────────────────────────────────────
  'app.title':            { zh: 'ZeroU',                                  en: 'ZeroU' },
  'app.tagline':          { zh: '把每个 demo 推到 product。',              en: 'Push every demo to product.' },
  'app.tagline.long':     { zh: '你给一个本地 demo + 一句愿景，ZeroU 派 Claude 自动迭代，4 层 reviewer 把关，preset 与 vision 双绿才停手。', en: 'Give ZeroU a local demo + one sentence of vision. It dispatches Claude to iterate, a 4-stage reviewer gates each fix, and stops only when the preset checklist and vision are both green.' },
  'app.daemonDown':       { zh: '连不上 daemon（{detail}）。先在终端跑 d2p start 或 npm run dev。', en: "Can't reach daemon ({detail}). Run `d2p start` or `npm run dev` in your terminal first." },
  'app.cliMissing':       { zh: '没找到 claude CLI。装 Claude Code 并 claude login，或在设置里换成 OpenAI-compat / Anthropic-API。', en: "claude CLI not found. Install Claude Code and run `claude login`, or pick OpenAI-compat / Anthropic-API in Settings." },

  // ── ProjectsHome ────────────────────────────────────────────────────
  'home.summary.projects':  { zh: '个项目',         en: 'projects' },
  'home.summary.running':   { zh: '在跑',           en: 'running' },
  'home.summary.cost':      { zh: '累计花费',       en: 'spent so far' },
  'home.filter.all':        { zh: '全部',           en: 'All' },
  'home.filter.active':     { zh: '活跃',           en: 'Active' },
  'home.filter.done':       { zh: '已完工',         en: 'Done' },
  'home.empty':             { zh: '这个分类下没有项目', en: 'No projects in this filter' },
  'home.tryDemo':           { zh: '试看 multi-turn 演示 →', en: 'Try multi-turn demo →' },
  'home.newProject':        { zh: '+ 新建项目',     en: '+ New project' },
  'home.addProjectHint':    { zh: '给个文件夹路径，ZeroU 接手', en: 'Point to a folder, ZeroU takes over' },
  'home.modal.title':       { zh: '新建项目',       en: 'New project' },
  'home.modal.desc':        { zh: '给个本地文件夹路径，ZeroU 自动 init git、识别项目类型、问你 vision，然后接手。', en: 'Give a local folder path. ZeroU will init git, infer project type, ask you for the vision, then take over.' },
  'home.modal.label':       { zh: 'Demo 文件夹（绝对路径）', en: 'Demo folder (absolute path)' },
  'home.modal.placeholder': { zh: 'D:\\demos\\my-saas',  en: '/Users/me/demos/my-saas' },
  'home.modal.start':       { zh: '开始 →',         en: 'Start →' },
  'home.modal.busy':        { zh: '新建 session 中…', en: 'Starting session…' },
  'home.modal.cancel':      { zh: '取消',           en: 'Cancel' },
  'home.modal.emptyPath':   { zh: '请填一个绝对路径', en: 'Please enter an absolute path' },

  // Card chips
  'card.status.looping':    { zh: '正在跑',         en: 'Running' },
  'card.status.paused':     { zh: '已暂停',         en: 'Paused' },
  'card.status.done':       { zh: '已完工',         en: 'Done' },
  'card.status.setup':      { zh: '配置中',         en: 'Setup' },
  'card.status.idle':       { zh: '空闲',           en: 'Idle' },
  'card.status.error':      { zh: '需介入',         en: 'Needs attention' },
  'card.verdict.yes':       { zh: 'vision ✓',       en: 'vision ✓' },
  'card.verdict.partial':   { zh: 'vision 部分',    en: 'vision partial' },
  'card.verdict.no':        { zh: 'vision ✗',       en: 'vision ✗' },
  'card.verdict.pending':   { zh: 'vision 未定',    en: 'vision pending' },
  'card.checklist':         { zh: '验收清单',       en: 'Checklist' },
  'card.agentRunning':      { zh: 'agent 在跑',     en: 'agent running' },
  'card.latest':            { zh: '最新：',         en: 'Latest:' },

  // ── Workspace ───────────────────────────────────────────────────────
  'workspace.backToProjects': { zh: '← 项目列表',     en: '← Projects' },
  'workspace.pause':          { zh: 'Pause ⏸',       en: 'Pause ⏸' },
  'workspace.pausing':        { zh: 'Pausing…',      en: 'Pausing…' },
  'workspace.resume':         { zh: 'Resume ▶',     en: 'Resume ▶' },
  'workspace.settings':       { zh: '⚙ 设置 / 切引擎', en: '⚙ Settings / engine' },
  'workspace.endSession':     { zh: '结束会话',       en: 'End session' },
  'workspace.demoBanner':     { zh: '演示模式 · multi-turn 是 mock 数据驱动 · 真任务跑起来形态一样 · 点「退出演示」回去', en: 'Demo mode · multi-turn driven by mock data · real runs look the same · click "Exit demo" to return' },
  'workspace.exitDemo':       { zh: '退出演示',       en: 'Exit demo' },
  'workspace.tryMultiTurn':   { zh: '试看 multi-turn 主视面 →', en: 'Try multi-turn fullscreen →' },
  'workspace.backToQueue':    { zh: '返回自治视图 →',   en: 'Back to autonomous view →' },

  // ── Settings ────────────────────────────────────────────────────────
  'settings.title':           { zh: '设置',           en: 'Settings' },
  'settings.close':           { zh: '关闭',           en: 'Close' },
  'settings.section.language':{ zh: '语言 / Language', en: 'Language / 语言' },
  'settings.section.engine':  { zh: 'LLM 引擎',       en: 'LLM engine' },
  'settings.section.github':  { zh: 'GitHub 集成',    en: 'GitHub integration' },
  'settings.languageHint':    { zh: '切换 UI 语言，立即生效，本地保存', en: 'Switch UI language — takes effect immediately, saved locally' },
  'settings.save':            { zh: '保存',           en: 'Save' },
  'settings.saved':           { zh: '已保存',         en: 'Saved' },
  'settings.engineKind':      { zh: '引擎类型',       en: 'Engine kind' },
  'settings.cliBin':          { zh: 'claude 可执行路径（留空走 PATH）', en: 'claude binary path (empty → PATH)' },
  'settings.apiKey':          { zh: 'API Key',        en: 'API Key' },
  'settings.baseUrl':         { zh: 'Base URL',       en: 'Base URL' },
  'settings.models':          { zh: '模型映射',       en: 'Model mapping' },
  'settings.extraHeaders':    { zh: '额外 HTTP Headers (JSON)', en: 'Extra HTTP headers (JSON)' },
  'settings.githubToken':     { zh: 'GitHub token (repo scope)', en: 'GitHub token (repo scope)' },
  'settings.githubBase':      { zh: '默认 base branch', en: 'Default base branch' },

  // ── StatusStrip ─────────────────────────────────────────────────────
  'strip.checklist':        { zh: '验收清单',     en: 'Checklist' },
  'strip.checklistHint':    { zh: '点开查看完整验收清单', en: 'Click to view full checklist' },
  'strip.todo':             { zh: '待办',         en: 'To-do' },
  'strip.todo.inProgress':  { zh: '处理中',       en: 'in progress' },
  'strip.todo.waiting':     { zh: '等',           en: 'waiting' },
  'strip.todo.complex':     { zh: '复杂',         en: 'complex' },
  'strip.cost':             { zh: '花费',         en: 'Spent' },
  'strip.cost.tokens':      { zh: 'tokens',       en: 'tokens' },
  'strip.log':              { zh: '日志',         en: 'Log' },
  'strip.log.detail':       { zh: '详细事件',     en: 'Activity' },
  'strip.online':           { zh: '在线',         en: 'online' },
  'strip.offline':          { zh: '离线',         en: 'offline' },
  'strip.milestone':        { zh: 'milestone',    en: 'milestone' },
  'strip.drawer.gaps':      { zh: '待办清单 (gaps)', en: 'To-do list (gaps)' },
  'strip.drawer.preset':    { zh: '验收清单',     en: 'Checklist' },
  'strip.drawer.log':       { zh: '详细事件日志', en: 'Event log' },
  'strip.drawer.close':     { zh: '收起 ✕',       en: 'Close ✕' },
  'strip.drawer.session':   { zh: 'session #{id}', en: 'session #{id}' },
  'strip.drawer.noSession': { zh: 'no session',   en: 'no session' },

  // ── GapList ─────────────────────────────────────────────────────────
  'gap.list.title':         { zh: '待办清单',     en: 'To-do' },
  'gap.list.tooltip':       { zh: 'ZeroU 找出来的产品级缺口清单（缺什么 / 没做什么）', en: 'ZeroU has identified these product-level gaps (what is missing / not done)' },
  'gap.empty':              { zh: '还没找出来要补什么，等 ZeroU 扫一下项目…', en: 'ZeroU has not found any gaps yet — let it scan the project…' },
  'gap.status.pending':     { zh: '待处理',       en: 'Pending' },
  'gap.status.inProgress':  { zh: '处理中',       en: 'In progress' },
  'gap.status.done':        { zh: '完成',         en: 'Done' },
  'gap.status.skipped':     { zh: '跳过',         en: 'Skipped' },
  'gap.status.needHuman':   { zh: '需人工',       en: 'Needs human' },
  'gap.status.splitDone':   { zh: '已拆分',       en: 'Split' },
  'gap.skip':               { zh: '跳过',         en: 'Skip' },
  'gap.detail.slug':        { zh: 'slug:',        en: 'slug:' },
  'gap.detail.category':    { zh: '分类:',        en: 'Category:' },
  'gap.detail.source':      { zh: '来源:',        en: 'Source:' },
  'gap.detail.expected':    { zh: '预计改:',      en: 'Expected files:' },

  // ── Workspace ───────────────────────────────────────────────────────
  'workspace.pausingInline': { zh: '(pausing — 当前 attempt 跑完后停)', en: '(pausing — will stop after current attempt)' },
  'workspace.demoBack':      { zh: '返回项目列表', en: 'Back to projects' },
  'workspace.editChecklist': { zh: '调整验收清单', en: 'Adjust checklist' },

  // ── SessionsBoard ───────────────────────────────────────────────────
  'agents.title':           { zh: 'Agents',       en: 'Agents' },
  'agents.count':           { zh: '个',           en: '' },
  'agents.idle':            { zh: '没在跑活',     en: 'no active task' },
  'agents.calls':           { zh: '次调用',       en: 'calls' },
  'agents.currentTurn':     { zh: '当前 {n} turn', en: 'current {n} turn(s)' },
  'agents.status.working':  { zh: '工作中',       en: 'Working' },
  'agents.status.idle':     { zh: '空闲',         en: 'Idle' },
  'agents.status.blocked':  { zh: '阻塞',         en: 'Blocked' },
  'agents.status.stale':    { zh: '陈旧',         en: 'Stale' },
  'agents.status.done':     { zh: '完成',         en: 'Done' },
  'agents.role.differ':       { zh: '差异分析',   en: 'Differ' },
  'agents.role.implementer':  { zh: '实施者',     en: 'Implementer' },
  'agents.role.alignment':    { zh: '对题审',     en: 'Alignment' },
  'agents.role.behavioral':   { zh: '行为审',     en: 'Behavioral' },
  'agents.role.adversarial':  { zh: '对抗审',     en: 'Adversarial' },
  'agents.role.done-check':   { zh: '终评',       en: 'Done check' },
  'agents.role.repo-summary': { zh: '仓库摘要',   en: 'Repo summary' },
  'agents.timeline.calls':  { zh: '次调用',       en: 'calls' },
  'agents.timeline.empty':  { zh: '没有历史调用', en: 'No history' },
  'agents.timeline.input':  { zh: '输入',         en: 'Input' },
  'agents.timeline.output': { zh: '输出',         en: 'Output' },
  'agents.timeline.tools':  { zh: '用了什么',     en: 'Tools used' },
  'agents.timeline.commit': { zh: 'commit',       en: 'commit' },
  'agents.timeline.checkpoint': { zh: 'checkpoint', en: 'checkpoint' },
  'time.secAgo':            { zh: '{n}s 前',      en: '{n}s ago' },
  'time.minAgo':            { zh: '{n} 分前',     en: '{n}m ago' },
  'time.hourAgo':            { zh: '{n} 小时前',  en: '{n}h ago' },
  'time.dayAgo':            { zh: '{n} 天前',     en: '{n}d ago' },
  'time.today':             { zh: '今天',         en: 'today' },
  'time.yesterday':         { zh: '昨天',         en: 'yesterday' },

  // ── CommitsTimeline ─────────────────────────────────────────────────
  'commits.title':          { zh: 'Commits + Rewind', en: 'Commits + Rewind' },
  'commits.count':          { zh: '次合并',       en: 'merges' },
  'commits.files':          { zh: '文件',         en: 'files' },
  'commits.verdict.pass':   { zh: '通过',         en: 'pass' },
  'commits.verdict.fail':   { zh: '未过',         en: 'fail' },
  'commits.verdict.partial': { zh: '部分',         en: 'partial' },
  'commits.review.alignment': { zh: '对题',       en: 'alignment' },
  'commits.review.behavioral': { zh: '行为',      en: 'behavioral' },
  'commits.review.adversarial': { zh: '对抗',     en: 'adversarial' },
  'commits.rewind':         { zh: '↶ 回滚到此前', en: '↶ Rewind to before' },
  'commits.rewindTip':      { zh: '把代码库回退到这个 commit 之前', en: 'Revert the repo to before this commit' },
  'commits.viewDiff':       { zh: '看 diff',      en: 'View diff' },
  'commits.collapse':       { zh: '收起',         en: 'Collapse' },
  'commits.diffPreview':    { zh: '演示模式 · 真版本会在这里渲染 diff 详情', en: 'Demo mode · the real version renders the diff here' },
  'commits.rewindConfirm':  { zh: '回滚到此次 commit 之前？', en: 'Rewind to before this commit?' },
  'commits.rewindDesc':     { zh: '这会把 main 分支回退到 {sha} 之前的状态（gap：{title}）。之后这个 commit 之后的所有 fix 都会丢失，但能从 checkpoint 重新跑。', en: 'This will revert main to before {sha} (gap: {title}). All fixes after this commit will be lost, but you can replay from the checkpoint.' },
  'commits.rewindDemoNote': { zh: '演示模式 · 实际不会改 git 历史', en: 'Demo mode · git history is not actually changed' },
  'commits.rewindCancel':   { zh: '取消',         en: 'Cancel' },
  'commits.rewindOK':       { zh: '确认 rewind',  en: 'Confirm rewind' },

  // ── MultiTurnPanel ──────────────────────────────────────────────────
  'mt.headline.done':       { zh: 'ZeroU 修完了',   en: "ZeroU has finished" },
  'mt.verdict.done':        { zh: '已合并到 main · 看一眼改了啥', en: 'Merged to main · take a look at the changes' },
  'mt.headline.finalizing': { zh: 'ZeroU 说写完了', en: 'ZeroU reports complete' },
  'mt.verdict.finalizing':  { zh: 'reviewer 正在帮你验证 · 一般 1-2 分钟出结果', en: 'reviewer is verifying · 1-2 min typically' },
  'mt.headline.paused':     { zh: 'ZeroU 暂停了',   en: 'ZeroU paused' },
  'mt.verdict.paused':      { zh: '点「继续」让它接着跑，或点「中止」放弃这次修复', en: 'Click "Continue" to resume, or "Abort" to drop this fix' },
  'mt.headline.running':    { zh: 'ZeroU 正在帮你修', en: 'ZeroU is fixing this for you' },
  'mt.verdict.green':       { zh: '进展正常，不用管', en: 'Progressing normally — no action needed' },
  'mt.verdict.yellow':      { zh: '跑得有点久了，可以再等等，也可以暂停看看进度', en: 'Taking a while — you can wait or pause to peek' },
  'mt.headline.red':        { zh: 'ZeroU 卡住了',   en: 'ZeroU is stuck' },
  'mt.verdict.red':         { zh: '快到上限了，建议暂停看看；继续可能浪费 token', en: 'Near the cap — suggest pausing; continuing may waste tokens' },
  'mt.phase.idle':          { zh: '待命',         en: 'Idle' },
  'mt.phase.running':       { zh: '进行中',       en: 'Running' },
  'mt.phase.paused':        { zh: '暂停',         en: 'Paused' },
  'mt.phase.finalizing':    { zh: '收尾',         en: 'Finalizing' },
  'mt.phase.done':          { zh: '完成',         en: 'Done' },
  'mt.task':                { zh: '任务：',       en: 'Task:' },
  'mt.said':                { zh: 'ZeroU 说',     en: 'ZeroU says' },
  'mt.elapsed':             { zh: '第 {turn} 轮 · 已跑 {elapsed}', en: 'Turn {turn} · {elapsed} elapsed' },
  'mt.cap':                 { zh: '上限 {cap}',   en: 'Cap {cap}' },
  'mt.pause':               { zh: '暂停',         en: 'Pause' },
  'mt.abort':               { zh: '中止',         en: 'Abort' },
  'mt.continue':            { zh: '继续',         en: 'Continue' },
  'mt.viewChanges':         { zh: '看改动',       en: 'View changes' },
  'mt.expandDetails':       { zh: '展开细节 ▾',   en: 'Show details ▾' },
  'mt.collapseDetails':     { zh: '收起细节 ▴',   en: 'Hide details ▴' },
  'mt.turns':               { zh: '轮次',         en: 'Turns' },
  'mt.tokens':              { zh: 'token (in / out)', en: 'Tokens (in / out)' },
  'mt.estCost':             { zh: '估算花费',     en: 'Est. cost' },
  'mt.session.resume':      { zh: '续接 session', en: 'Resumed session' },
  'mt.session.new':         { zh: '新 session',   en: 'New session' },
  'mt.notes':               { zh: 'ZeroU 自己记的笔记 · {n} 条', en: 'ZeroU notes · {n}' },
  'mt.timeline.title':      { zh: '自治过程 · {n} 轮', en: 'Autonomous run · {n} turns' },
  'mt.timeline.empty':      { zh: 'ZeroU 还没开始干活…', en: 'ZeroU has not started yet…' },
  'mt.step.running':        { zh: '进行中',       en: 'Running' },
  'mt.step.done':           { zh: '完成',         en: 'Done' },
  'mt.step.pending':        { zh: '待开始',       en: 'Pending' },
  'mt.duration.h':          { zh: '{h} 小时 {m} 分', en: '{h}h {m}m' },
  'mt.duration.m':          { zh: '{m} 分钟',     en: '{m} min' },
  'mt.duration.s':          { zh: '{s} 秒',       en: '{s}s' },

  // ── PresetChecklistView ─────────────────────────────────────────────
  'preset.header.completion': { zh: '产品级清单完成度', en: 'Product-level checklist completion' },
  'preset.header.source':     { zh: '来源：12-Factor · OWASP Top 10 · OpenSSF · WCAG · SRE', en: 'Source: 12-Factor · OWASP Top 10 · OpenSSF · WCAG · SRE' },
  'preset.status.missing':    { zh: '缺失',       en: 'Missing' },
  'preset.status.partial':    { zh: '部分',       en: 'Partial' },
  'preset.status.done':       { zh: '完成',       en: 'Done' },
  'preset.group.expand':      { zh: '展开 ▾',     en: 'Expand ▾' },
  'preset.group.collapse':    { zh: '收起 ▴',     en: 'Collapse ▴' },
  'preset.group.items':       { zh: '项',         en: 'items' },
  'preset.mech.test':         { zh: '跑测试',     en: 'Run tests' },
  'preset.mech.file':         { zh: '查文件',     en: 'Check file' },
  'preset.mech.grep':         { zh: '扫文本',     en: 'Scan text' },
  'preset.mech.cohesion':     { zh: '跨文件一致', en: 'Cross-file' },
  'preset.mech.llm':          { zh: 'LLM 判断',   en: 'LLM judge' },

  // ── Risk / Review ───────────────────────────────────────────────────
  'risk.low':                 { zh: '低风险',     en: 'Low risk' },
  'risk.mid':                 { zh: '中风险',     en: 'Medium risk' },
  'risk.high':                { zh: '高风险 · 建议看一眼', en: 'High risk · please review' },
  'risk.level':               { zh: '风险等级: {label}', en: 'Risk: {label}' },
  'risk.reasons':             { zh: '风险原因',   en: 'Reasons' },
  'risk.reviewHunks':         { zh: '{n} 处建议人工确认', en: '{n} hunk(s) need review' },
  'review.hint.title':        { zh: '建议你看一眼这 {n} 处', en: '{n} hunks suggested for your review' },
  'review.hint.jump':         { zh: '跳转',       en: 'Jump' },

  // ── CorePaths ───────────────────────────────────────────────────────
  'corepaths.alert.title':    { zh: '动了 {n} 处核心代码 · 需要你确认', en: '{n} core path(s) touched · please confirm' },
  'corepaths.alert.matched':  { zh: '匹配规则',   en: 'Matched glob' },
  'corepaths.alert.preview':  { zh: 'diff 预览',  en: 'Diff preview' },
  'corepaths.alert.reject':   { zh: '否决（不 merge）', en: 'Reject (do not merge)' },
  'corepaths.alert.allow':    { zh: '允许 merge', en: 'Allow merge' },
  'corepaths.config.title':   { zh: '核心路径配置 · .d2p/core-paths.yaml', en: 'Core paths · .d2p/core-paths.yaml' },
  'corepaths.config.source.user':     { zh: '用户固定 ⚓', en: 'User-pinned ⚓' },
  'corepaths.config.source.inferred': { zh: 'AI 推断 ✻', en: 'AI inferred ✻' },
  'corepaths.config.add':     { zh: '添加 glob',  en: 'Add glob' },
  'corepaths.config.remove':  { zh: '移除',       en: 'Remove' },
  'corepaths.config.reinfer': { zh: '重新让 AI 推断', en: 'Re-run AI inference' },

  // ── Milestones ──────────────────────────────────────────────────────
  'milestones.title':         { zh: 'Milestone 进度', en: 'Milestone progress' },
  'milestones.status.pending':    { zh: '待开始', en: 'Pending' },
  'milestones.status.inProgress': { zh: '进行中', en: 'In progress' },
  'milestones.status.done':       { zh: '完成',   en: 'Done' },
  'milestones.detail.vision': { zh: '来自 vision',    en: 'From vision' },
  'milestones.detail.items':  { zh: '关联清单',       en: 'Linked checklist items' },
  'milestones.detail.activeGap': { zh: '当前 gap',    en: 'Active gap' },

  // ── SessionResumeBanner ─────────────────────────────────────────────
  'resume.message':           { zh: '上次你在 gap「{slug}」中断 {n} 小时前，要继续吗？', en: 'You paused on gap "{slug}" {n}h ago — resume?' },
  'resume.continue':          { zh: '继续',       en: 'Resume' },
  'resume.discard':           { zh: '放弃这个 gap', en: 'Discard this gap' },
  'resume.later':             { zh: '稍后',       en: 'Later' },

  // ── MockupPhase ─────────────────────────────────────────────────────
  'mockup.drafting.title':    { zh: 'ZeroU 正在为你画产品成品的样子…', en: "ZeroU is drafting what your product looks like…" },
  'mockup.drafting.progress': { zh: '已经画好 {done} / {total} 页', en: '{done} / {total} pages drafted' },
  'mockup.review.approve':    { zh: '✓ 这就是我想要的', en: '✓ This is what I want' },
  'mockup.review.revise':     { zh: '✎ 我想改一下', en: '✎ I want changes' },
  'mockup.review.skip':       { zh: '→ 跳过这步', en: '→ Skip this step' },
  'mockup.revising.title':    { zh: '正在按你的建议重画…', en: 'Redrafting per your feedback…' },
  'mockup.approved.title':    { zh: '✓ 已对齐预期', en: '✓ Expectations aligned' },
  'mockup.approved.desc':     { zh: 'differ 正在按这个目标找 gap…', en: 'differ is finding gaps against this target…' },

  // ── CommitDiffDrawer ────────────────────────────────────────────────
  'diff.title':               { zh: 'commit 详情',    en: 'Commit details' },
  'diff.files':               { zh: '文件',           en: 'Files' },
  'diff.binaryFile':          { zh: '二进制文件已变更', en: 'Binary file changed' },
  'diff.empty':               { zh: '此 commit 无 diff', en: 'No diff in this commit' },
  'diff.status.modified':     { zh: 'M',              en: 'M' },
  'diff.status.added':        { zh: 'A',              en: 'A' },
  'diff.status.deleted':      { zh: 'D',              en: 'D' },
  'diff.status.renamed':      { zh: 'R',              en: 'R' },
};

/** Translate `key` into `locale`. Falls back to zh, then to the key itself
 *  so missing translations are visible during development. */
export function translate(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = dict[key];
  let s: string;
  if (!entry) {
    s = key;
  } else {
    // Use ?? not || so an intentionally-empty translation (e.g. en: '' to
    // omit a Chinese measure word) is preserved instead of falling back.
    s = entry[locale] ?? entry.zh ?? key;
  }
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  }
  return s;
}
