// Rich canned store state for design previews. Lets a designer iterate on
// every page in every variant without spinning up daemon + real LLM.

import type {
  Demo,
  DetectorOutput,
  Gap,
  HealthResponse,
  LoopState,
  PresetStatusItem,
  Session,
  SessionStatus,
  SseEnvelope,
  VisionRoundRes,
  CostTotals,
} from '../types.js';

const NOW = Date.now();
const m = (mins: number) => NOW - mins * 60_000;

export const mockHealth: HealthResponse = {
  ok: true,
  daemonVersion: '0.1.0',
  promptsVersion: 1,
  claudeCli: { found: true, version: '2.1.81 (Claude Code)' },
  gitCli: { found: true, version: 'git version 2.51.2.windows.1' },
  dbPath: 'C:\\Users\\jushi\\.d2p\\state.db',
  uptimeMs: 1_234_000,
};

export const mockDemo: Demo = {
  id: 1,
  path: 'D:\\demos\\notes-saas',
  firstSeenAt: m(180),
  lastSessionAt: m(45),
  inferredType: 'saas-web',
};

export const mockSession = (status: SessionStatus = 'LOOPING'): Session => ({
  id: 7,
  demoId: 1,
  startedAt: m(45),
  endedAt: status === 'DONE' || status === 'ENDED' ? m(2) : null,
  status,
  visionMdPath: 'D:\\demos\\notes-saas\\.d2p\\vision.md',
  presetType: 'saas-web',
  mode: 'local-merge',
  githubRepo: null,
  baseBranch: 'main',
});

/** Rich mock preset item — adds mechanism + source + appliesTo on top of the
 *  daemon's current {item,status,note} shape. F2's daemon work will eventually
 *  promote these fields into the real DTO; for now they live alongside as
 *  designer-driven mock state. */
export type MockMechanism =
  | 'static-grep'
  | 'file-exists'
  | 'test-execution'
  | 'cross-file-cohesion'
  | 'llm-judgment';

export interface MockPresetItem {
  id: string;
  label: string;
  severity: 'P1' | 'P2' | 'P3';
  mechanism: MockMechanism;
  source: string;          // e.g. "OWASP-A02:2025", "12F-VII", "WCAG-1.4.3"
  appliesTo: string[];     // W A C L S M D ML
  status: 'done' | 'partial' | 'missing';
  note: string | null;
}

/** 32-item curated checklist drawn from 12-Factor, OWASP Top 10:2025, Google
 *  SRE Launch, WCAG 2.2 AA, OpenSSF Scorecard, and per-target conformance
 *  gates. Source: docs/plans/2026-05-13-track-c-features.md F2 table. */
export const mockPresetItemsRich: MockPresetItem[] = [
  { id: 'build-typecheck',          label: 'Typecheck / compile passes clean',         severity: 'P1', mechanism: 'test-execution',      source: 'base',          appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: 'tsc --noEmit · 0 errors' },
  { id: 'build-reproducible',       label: 'Build command exits 0 on clean checkout',  severity: 'P1', mechanism: 'test-execution',      source: '12F-V',         appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: null },
  { id: 'test-runner-present',      label: 'Test runner configured + ≥1 test file',    severity: 'P1', mechanism: 'file-exists',         source: 'base',          appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: 'vitest' },
  { id: 'test-happy-path-passes',   label: 'npm test exits 0',                          severity: 'P1', mechanism: 'test-execution',      source: 'base',          appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: '12 / 12 passing' },
  { id: 'test-edge-cases',          label: '≥1 negative test per public function',     severity: 'P2', mechanism: 'llm-judgment',        source: 'base',          appliesTo: ['L','A','C','ML'],                 status: 'partial', note: 'login flow only' },
  { id: 'readme-quickstart',        label: 'README has fenced install + run block',    severity: 'P1', mechanism: 'static-grep',         source: 'base',          appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: null },
  { id: 'license-file',             label: 'LICENSE present + SPDX-recognized',        severity: 'P1', mechanism: 'file-exists',         source: 'OpenSSF',       appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: 'MIT' },
  { id: 'env-example',              label: '.env.example covers every env var read',   severity: 'P1', mechanism: 'cross-file-cohesion', source: '12F-III',       appliesTo: ['W','A'],                          status: 'done',    note: '6 vars documented' },
  { id: 'no-hardcoded-secrets',     label: 'No hardcoded API keys / passwords',        severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025',appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: null },
  { id: 'lockfile-present',         label: 'Dependency lockfile committed',            severity: 'P1', mechanism: 'file-exists',         source: 'OpenSSF',       appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: 'package-lock.json' },
  { id: 'deps-no-high-vuln',        label: 'npm audit / pip-audit · 0 high',           severity: 'P1', mechanism: 'test-execution',      source: 'OWASP-A03:2025',appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: '0 high · 2 moderate' },
  { id: 'port-from-env',            label: 'Server reads PORT from env',               severity: 'P1', mechanism: 'static-grep',         source: '12F-VII',       appliesTo: ['W','A'],                          status: 'done',    note: null },
  { id: 'sigterm-handler',          label: 'Graceful shutdown on SIGTERM',             severity: 'P2', mechanism: 'static-grep',         source: '12F-IX',        appliesTo: ['W','A','D'],                      status: 'missing', note: null },
  { id: 'stdout-logging',           label: 'Logs go to stdout (not files)',            severity: 'P2', mechanism: 'static-grep',         source: '12F-XI',        appliesTo: ['W','A','C'],                      status: 'partial', note: '1 file handler in src/audit.ts' },
  { id: 'health-endpoint',          label: 'GET /health returns 200',                  severity: 'P1', mechanism: 'static-grep',         source: 'SRE',           appliesTo: ['W','A'],                          status: 'missing', note: null },
  { id: 'structured-logs',          label: 'Logs parseable JSON / carry request id',   severity: 'P2', mechanism: 'cross-file-cohesion', source: 'SRE',           appliesTo: ['W','A'],                          status: 'missing', note: 'observability gap' },
  { id: 'error-handler-present',    label: 'Top-level error handler / boundary',       severity: 'P2', mechanism: 'llm-judgment',        source: 'OWASP-A10:2025',appliesTo: ['W','A','D'],                      status: 'missing', note: null },
  { id: 'auth-on-mutating-routes',  label: 'Non-GET routes covered by auth',           severity: 'P1', mechanism: 'llm-judgment',        source: 'OWASP-A01:2025',appliesTo: ['W','A'],                          status: 'done',    note: 'middleware audited' },
  { id: 'password-hash-strong',     label: 'bcrypt / argon2 / scrypt only',            severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A04:2025',appliesTo: ['W','A'],                          status: 'done',    note: 'argon2' },
  { id: 'https-only-prod',          label: 'No http:// in prod config · cookies Secure',severity:'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025',appliesTo: ['W','A'],                          status: 'done',    note: null },
  { id: 'rate-limit-public',        label: 'Public routes wrapped in rate-limit',      severity: 'P2', mechanism: 'static-grep',         source: 'base',          appliesTo: ['W','A'],                          status: 'partial', note: 'auth routes only' },
  { id: 'sql-parameterized',        label: 'No string-concat into SQL execute',        severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A05:2025',appliesTo: ['W','A','ML'],                     status: 'done',    note: null },
  { id: 'cors-not-wildcard',        label: 'No Origin:* with credentials',             severity: 'P1', mechanism: 'static-grep',         source: 'OWASP-A02:2025',appliesTo: ['W','A'],                          status: 'done',    note: null },
  { id: 'a11y-axe-clean',           label: 'axe-core · 0 serious violations',          severity: 'P1', mechanism: 'test-execution',      source: 'WebAIM',        appliesTo: ['W','S'],                          status: 'missing', note: 'not yet run' },
  { id: 'viewport-meta',            label: '<meta viewport> present',                  severity: 'P2', mechanism: 'static-grep',         source: 'base',          appliesTo: ['W','S','M'],                      status: 'done',    note: null },
  { id: 'error-boundary',           label: 'Root-level error boundary component',      severity: 'P2', mechanism: 'static-grep',         source: 'base',          appliesTo: ['W','S'],                          status: 'missing', note: null },
  { id: 'ci-pipeline',              label: 'CI runs test + build on PR',               severity: 'P2', mechanism: 'file-exists',         source: 'OpenSSF',       appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'missing', note: null },
  { id: 'ci-token-perms',           label: 'workflows set permissions explicitly',     severity: 'P2', mechanism: 'static-grep',         source: 'OpenSSF',       appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'missing', note: null },
  { id: 'deploy-config',            label: 'Target deploy config valid',               severity: 'P1', mechanism: 'file-exists',         source: 'Vercel/Fly',    appliesTo: ['W','A','L'],                      status: 'missing', note: 'vercel.json needed' },
  { id: 'package-publishable',      label: 'npm pack / python -m build succeeds',      severity: 'P1', mechanism: 'test-execution',      source: 'npm/PyPI',      appliesTo: ['L'],                              status: 'missing', note: 'lib track only' },
  { id: 'binary-not-committed',     label: 'No *.exe / *.dll outside dist/',           severity: 'P3', mechanism: 'static-grep',         source: 'OpenSSF',       appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'done',    note: null },
  { id: 'vision-verdict',           label: 'Product matches user vision',              severity: 'P1', mechanism: 'llm-judgment',        source: 'd2p-native',    appliesTo: ['W','A','C','L','S','M','D','ML'], status: 'partial', note: 'logging gap noted' },
];

export const mockPresetStatus: PresetStatusItem[] = [
  { item: 'has-typecheck-script', status: 'done', note: 'tsc --noEmit passes' },
  { item: 'has-build-script', status: 'done', note: null },
  { item: 'has-test-runner', status: 'done', note: 'vitest configured' },
  { item: 'tests-cover-happy-path', status: 'done', note: '12/12 pass' },
  { item: 'tests-cover-edge-cases', status: 'partial', note: 'login flow only' },
  { item: 'has-readme', status: 'done', note: null },
  { item: 'readme-has-quickstart', status: 'done', note: null },
  { item: 'has-license', status: 'done', note: 'MIT' },
  { item: 'env-example-present', status: 'done', note: null },
  { item: 'no-hardcoded-secrets', status: 'done', note: null },
  { item: 'auth-flow-implemented', status: 'done', note: null },
  { item: 'rate-limiting', status: 'partial', note: 'middleware stub' },
  { item: 'observability-logging', status: 'missing', note: null },
  { item: 'deploy-config', status: 'missing', note: null },
  { item: 'ci-pipeline', status: 'missing', note: null },
  { item: 'error-boundaries', status: 'missing', note: null },
  { item: 'a11y-baseline', status: 'missing', note: null },
  { item: 'mobile-responsive', status: 'partial', note: 'workspace breaks <768px' },
];

export const mockCostTotals: CostTotals = {
  inputTokens: 487_352,
  outputTokens: 124_891,
  estimatedUsd: 1.27,
};

/** F4 — per-role spend attribution. Each row is one (role × engine) bucket
 *  rolled up across all gap attempts in this session. Cache hit % is the share
 *  of input tokens served from the provider's prompt cache. */
export interface MockCostBucket {
  role: 'detector' | 'vision' | 'differ' | 'implementer' | 'static-gate'
      | 'alignment' | 'behavioral' | 'adversarial' | 'done-check';
  engine: string;     // human label e.g. "claude-cli"
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usd: number;
}

export const mockCostBuckets: MockCostBucket[] = [
  { role: 'detector',    engine: 'claude-cli',  model: 'haiku',  inputTokens: 12_400,  outputTokens: 1_100,  cacheReadTokens: 0,        usd: 0.02 },
  { role: 'vision',      engine: 'claude-cli',  model: 'haiku',  inputTokens: 28_900,  outputTokens: 6_300,  cacheReadTokens: 11_200,   usd: 0.05 },
  { role: 'differ',      engine: 'claude-cli',  model: 'sonnet', inputTokens: 156_800, outputTokens: 18_200, cacheReadTokens: 102_300,  usd: 0.42 },
  { role: 'implementer', engine: 'claude-cli',  model: 'sonnet', inputTokens: 198_400, outputTokens: 84_700, cacheReadTokens: 142_900,  usd: 0.61 },
  { role: 'static-gate', engine: 'local',       model: '—',      inputTokens: 0,       outputTokens: 0,      cacheReadTokens: 0,        usd: 0.00 },
  { role: 'alignment',   engine: 'minimax',     model: 'M2',     inputTokens: 38_400,  outputTokens: 4_200,  cacheReadTokens: 26_100,   usd: 0.06 },
  { role: 'behavioral',  engine: 'minimax',     model: 'M2',     inputTokens: 41_300,  outputTokens: 8_600,  cacheReadTokens: 18_700,   usd: 0.09 },
  { role: 'adversarial', engine: 'minimax',     model: 'M2',     inputTokens: 8_900,   outputTokens: 1_400,  cacheReadTokens: 3_200,    usd: 0.02 },
  { role: 'done-check',  engine: 'minimax',     model: 'M2',     inputTokens: 2_300,   outputTokens: 400,    cacheReadTokens: 0,        usd: 0.00 },
];

export function mockCacheHitPct(buckets: MockCostBucket[] = mockCostBuckets): number {
  const cached = buckets.reduce((s, b) => s + b.cacheReadTokens, 0);
  const total = buckets.reduce((s, b) => s + b.inputTokens, 0);
  return total === 0 ? 0 : Math.round((cached / total) * 100);
}

export const mockGaps: Gap[] = [
  {
    id: 101,
    sessionId: 7,
    slug: 'add-observability-logging',
    title: 'Add structured logging for request lifecycle',
    body: 'Every API request should emit a JSON log with request_id, route, status, duration_ms.',
    category: 'observability',
    severity: 'P1',
    source: 'preset',
    suggestedApproach: 'Use pino with a request-id middleware.',
    expectedFilesChanged: ['src/middleware/logger.ts', 'src/server.ts'],
    status: 'IN_PROGRESS',
    dynamicK: 3,
    parentGapId: null,
    createdAt: m(40),
    finishedAt: null,
  },
  {
    id: 102,
    sessionId: 7,
    slug: 'deploy-config-vercel',
    title: 'Add Vercel deploy config + GitHub Action',
    body: 'vision wants one-click deploy. Add vercel.json + .github/workflows/deploy.yml.',
    category: 'deploy',
    severity: 'P1',
    source: 'vision',
    suggestedApproach: '',
    expectedFilesChanged: ['vercel.json', '.github/workflows/deploy.yml'],
    status: 'PENDING',
    dynamicK: null,
    parentGapId: null,
    createdAt: m(38),
    finishedAt: null,
  },
  {
    id: 103,
    sessionId: 7,
    slug: 'rate-limit-auth-endpoints',
    title: 'Per-IP rate limiting on /auth/*',
    body: 'Prevent credential-stuffing: 5 attempts/min/IP, exponential backoff after.',
    category: 'security',
    severity: 'P2',
    source: 'both',
    suggestedApproach: '',
    expectedFilesChanged: ['src/middleware/rate-limit.ts', 'src/routes/auth.ts'],
    status: 'PENDING',
    dynamicK: null,
    parentGapId: null,
    createdAt: m(35),
    finishedAt: null,
  },
  {
    id: 104,
    sessionId: 7,
    slug: 'error-boundary-react',
    title: 'React error boundary at root',
    body: 'A thrown component error should not blank the page. Show a friendly fallback.',
    category: 'reliability',
    severity: 'P2',
    source: 'preset',
    suggestedApproach: '',
    expectedFilesChanged: ['ui/src/ErrorBoundary.tsx', 'ui/src/main.tsx'],
    status: 'PENDING',
    dynamicK: null,
    parentGapId: null,
    createdAt: m(33),
    finishedAt: null,
  },
  {
    id: 105,
    sessionId: 7,
    slug: 'mobile-workspace-responsive',
    title: 'Workspace layout works on mobile',
    body: '3-column grid collapses to tabs under 768px.',
    category: 'ux',
    severity: 'P2',
    source: 'preset',
    suggestedApproach: '',
    expectedFilesChanged: ['ui/src/pages/Workspace.tsx'],
    status: 'NEED_HUMAN',
    dynamicK: 4,
    parentGapId: null,
    createdAt: m(28),
    finishedAt: null,
  },
  {
    id: 106,
    sessionId: 7,
    slug: 'add-license-mit',
    title: 'Add MIT LICENSE file',
    body: 'No license file at repo root. MIT per vision.',
    category: 'docs',
    severity: 'P3',
    source: 'preset',
    suggestedApproach: '',
    expectedFilesChanged: ['LICENSE'],
    status: 'DONE',
    dynamicK: 2,
    parentGapId: null,
    createdAt: m(25),
    finishedAt: m(22),
  },
  {
    id: 107,
    sessionId: 7,
    slug: 'env-example-template',
    title: '.env.example with documented vars',
    body: 'Every var read via process.env should appear in .env.example with a comment.',
    category: 'docs',
    severity: 'P3',
    source: 'preset',
    suggestedApproach: '',
    expectedFilesChanged: ['.env.example', 'README.md'],
    status: 'DONE',
    dynamicK: 2,
    parentGapId: null,
    createdAt: m(20),
    finishedAt: m(15),
  },
  {
    id: 108,
    sessionId: 7,
    slug: 'split-auth-into-tokens-sessions',
    title: 'Split auth gap into token + session sub-tasks',
    body: 'Original auth gap was too big; reviewer asked for split.',
    category: 'security',
    severity: 'P1',
    source: 'preset',
    suggestedApproach: '',
    expectedFilesChanged: [],
    status: 'SPLIT_DONE',
    dynamicK: null,
    parentGapId: null,
    createdAt: m(12),
    finishedAt: m(10),
  },
];

const kinds = [
  ['SESSION_STARTED', { demoPath: 'D:\\demos\\notes-saas' }],
  ['AGENT_START', { role: 'detector', model: 'haiku', thought: 'scanning repo for type signals' }],
  ['TYPE_DETECTED', { type: 'saas-web', confidence: 0.94 }],
  ['PRESET_CHOSEN', { type: 'saas-web' }],
  ['AGENT_START', { role: 'vision', model: 'haiku', thought: 'eliciting product vision r1' }],
  ['VISION_QUESTION_ASKED', { roundIndex: 1 }],
  ['VISION_ANSWERED', { roundIndex: 1 }],
  ['VISION_FINALIZED', {}],
  ['LOOP_STARTED', {}],
  ['AGENT_START', { role: 'differ', model: 'sonnet', thought: 'comparing demo vs preset+vision' }],
  ['DIFF_PRODUCED', { inserted: 11 }],
  ['GAP_PICKED', { slug: 'add-license-mit' }],
  ['WORKTREE_CREATED', { path: '.d2p-worktrees/fix-add-license-mit-1' }],
  ['AGENT_START', { role: 'implementer', model: 'haiku', thought: 'writing LICENSE file' }],
  ['FIX_COMMITTED', { commitSha: 'a1b2c3d4e5' }],
  ['STATIC_GATE_PASSED', { slug: 'add-license-mit' }],
  ['ALIGNMENT_RESULT', { score: 0.97 }],
  ['REVIEW_VERDICT', { verdict: 'APPROVE', reasonCode: 'MEETS_GAP' }],
  ['MERGED', { mergeSha: 'a1b2c3d4e5' }],
  ['GAP_DONE', { slug: 'add-license-mit' }],
  ['GAP_PICKED', { slug: 'env-example-template' }],
  ['WORKTREE_CREATED', { path: '.d2p-worktrees/fix-env-example-template-1' }],
  ['AGENT_START', { role: 'implementer', model: 'haiku' }],
  ['FIX_COMMITTED', { commitSha: 'b2c3d4e5f6' }],
  ['STATIC_GATE_PASSED', { slug: 'env-example-template' }],
  ['ALIGNMENT_RESULT', { score: 0.91 }],
  ['REVIEW_VERDICT', { verdict: 'APPROVE', reasonCode: 'MEETS_GAP' }],
  ['MERGED', { mergeSha: 'b2c3d4e5f6' }],
  ['GAP_DONE', { slug: 'env-example-template' }],
  ['GAP_PICKED', { slug: 'add-observability-logging' }],
  ['WORKTREE_CREATED', { path: '.d2p-worktrees/fix-add-observability-logging-1' }],
  ['AGENT_START', { role: 'implementer', model: 'sonnet', thought: 'wiring pino + request-id middleware' }],
] as const;

export const mockEvents: SseEnvelope[] = kinds.map(([kind, payload], i) => ({
  id: i + 1,
  ts: m(45 - i * 1.3),
  kind: kind as string,
  level: 'info',
  payload: payload as Record<string, unknown>,
}));

export const mockLoopState: LoopState = {
  isRunning: true,
  pauseRequested: false,
  sessionId: 7,
};

export const mockDetector: DetectorOutput = {
  type: 'saas-web',
  confidence: 0.94,
  evidence: [
    'package.json declares vite + react',
    'src/pages/ + src/api/ split typical of SaaS app',
    'Drizzle ORM schemas in src/db/',
    'Auth middleware in src/middleware/auth.ts',
  ],
  presetCandidates: ['saas-web', 'api-service'],
  inferredCheckCommands: {
    build: 'npm run build',
    test: 'npm test',
    typecheck: 'npm run typecheck',
  },
};

export const mockVisionRound: VisionRoundRes = {
  done: true,
  roundIndex: 3,
  visionMd:
    '# Vision — notes-saas\n\n' +
    'A minimal note-taking SaaS for solo creators.\n\n' +
    '## Done means\n' +
    '- Sign up + sign in with magic link\n' +
    '- CRUD notes with markdown rendering\n' +
    '- Full-text search\n' +
    '- One-click Vercel deploy\n' +
    '- Free tier: 100 notes; paid: unlimited\n\n' +
    '## Not in scope (yet)\n' +
    '- Mobile app\n' +
    '- Real-time collab\n' +
    '- Plugins / integrations\n',
  visionMdPath: 'D:\\demos\\notes-saas\\.d2p\\vision.md',
};

/** Compose a complete store state for a given target page/status. */
export function mockStoreFor(opts: {
  status?: SessionStatus;
  empty?: boolean;
  paused?: boolean;
} = {}): Record<string, unknown> {
  const status: SessionStatus = opts.status ?? 'LOOPING';
  if (opts.empty) {
    return {
      health: mockHealth,
      session: null,
      demo: null,
      presetStatus: [],
      costTotals: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      gaps: [],
      events: [],
      loopState: null,
      detector: null,
      visionRound: null,
      sseConnected: true,
      showSettings: false,
    };
  }
  const session = mockSession(status);
  return {
    health: mockHealth,
    session,
    demo: mockDemo,
    presetStatus: mockPresetStatus,
    costTotals: mockCostTotals,
    gaps: mockGaps,
    events: mockEvents,
    loopState: opts.paused
      ? { ...mockLoopState, pauseRequested: true, isRunning: true }
      : mockLoopState,
    detector: mockDetector,
    visionRound: mockVisionRound,
    sseConnected: true,
    showSettings: false,
    summaryMdPath: status === 'DONE' || status === 'ENDED' ? 'D:\\demos\\notes-saas\\.d2p\\summary.md' : null,
  };
}
