/**
 * Mock ReviewBundle for offline preview.
 *
 * Modeled on meme-weather (Next.js app, 38 endpoint findings, 72 branch
 * functions, 15 self-deceiving, 225 untested). Not the verbatim run output;
 * shaped to exercise every UI path (P1/P2/P3 findings; patched/unpatched/
 * skipped/failed statuses; added/modified file rows; verify pass + a
 * skipped step; branch coverage with self-deceiving + judge-only + untested
 * verdicts).
 */
import type { ReviewBundle, ReviewFinding, ReviewFile, BranchNode, BranchTraceEvent } from '../types-zerou.js';

// ---------------------------------------------------------------------------
// Findings — 38 total, grouped by severity. Each row keys off an API route.
// ---------------------------------------------------------------------------

const ROUTES_P1 = [
  '/api/memes/[id]',
  '/api/memes/[id]/bet',
  '/api/me/profile',
  '/api/memes/[id]/resolve',
  '/api/users/[id]/follow',
  '/api/memes/[id]/comments',
  '/api/me/credits',
  '/api/me/wallet/withdraw',
  '/api/auth/signin',
  '/api/auth/signup',
];

const ROUTES_P2 = [
  '/api/radar/nominate',
  '/api/radar/feed',
  '/api/memes',
  '/api/leaderboard',
  '/api/feed/personal',
  '/api/notifications',
  '/api/notifications/[id]/read',
  '/api/users/[id]/profile',
  '/api/users/search',
  '/api/me/preferences',
  '/api/me/notifications',
  '/api/uploads/avatar',
  '/api/uploads/meme',
  '/api/comments/[id]',
  '/api/comments/[id]/like',
  '/api/feed/trending',
  '/api/admin/flags',
  '/api/admin/users',
];

const ROUTES_P3 = [
  '/api/health',
  '/api/version',
  '/api/og/[id]',
  '/api/og/leaderboard',
  '/api/sitemap',
  '/api/feed/explore',
  '/api/me/sessions',
  '/api/admin/feature-flags',
  '/api/admin/audit',
  '/api/_debug/echo',
];

function mkFinding(
  i: number,
  endpoint: string,
  severity: ReviewFinding['severity'],
  status: ReviewFinding['status']
): ReviewFinding {
  const baseMsg =
    severity === 'P1'
      ? 'unhandled rejection on DB lookup — no try/catch, 500s leak Prisma stack trace'
      : severity === 'P2'
      ? 'missing input validation on request body — request crashes route on malformed JSON'
      : 'console.log left in production path';
  const expected =
    severity === 'P1'
      ? 'wrap DB call, return 500 with stable shape, log via pino'
      : severity === 'P2'
      ? 'zod-parse body, return 400 with field errors'
      : 'remove or guard behind NODE_ENV !== "production"';
  const actual =
    severity === 'P1'
      ? 'await prisma.X.findUnique throws → handler crashes with full stack'
      : severity === 'P2'
      ? 'JSON.parse on body string, no schema check'
      : 'console.log(`[debug] X`, payload)';
  return {
    id: `f-${i}`,
    source: severity === 'P3' ? 'static' : (i % 3 === 0 ? 'test-fail' : 'static'),
    severity,
    category: severity === 'P3' ? 'cleanup' : severity === 'P2' ? 'validation' : 'error-handling',
    file: `app${endpoint.replace(/\[(\w+)\]/g, '[$1]')}/route.ts`,
    line: 18 + (i % 30),
    message: `${endpoint} — ${baseMsg}`,
    expectedBehavior: expected,
    actualBehavior: actual,
    snippet:
      severity === 'P1'
        ? `const meme = await prisma.meme.findUnique({ where: { id } })\nreturn NextResponse.json(meme)`
        : severity === 'P2'
        ? `const body = JSON.parse(await req.text())\nreturn handler(body)`
        : `console.log('[og] rendering', id)`,
    status,
    reason:
      status === 'skipped'
        ? 'low-confidence patch site — implementer asked human'
        : status === 'failed'
        ? 'patch attempted but tsc regressed; reverted'
        : undefined,
  };
}

const findings: ReviewFinding[] = [
  // P1 — 10 routes, all unpatched (loud demo: hardener can't auto-fix these)
  ...ROUTES_P1.map((r, i) => mkFinding(i, r, 'P1', 'unpatched')),
  // P2 — 18 routes, mix of patched(8) / unpatched(7) / skipped(2) / failed(1)
  ...ROUTES_P2.map((r, i) => {
    const status: ReviewFinding['status'] =
      i < 8 ? 'patched' : i < 15 ? 'unpatched' : i < 17 ? 'skipped' : 'failed';
    return mkFinding(10 + i, r, 'P2', status);
  }),
  // P3 — 10 cleanup, all patched (cheap easy wins)
  ...ROUTES_P3.map((r, i) => mkFinding(28 + i, r, 'P3', 'patched')),
];

// ---------------------------------------------------------------------------
// Files — 12 entries (logger setup, middleware, health route, sentry wiring,
// env example, then 5 patched route files). Diffs are minimal but realistic.
// ---------------------------------------------------------------------------

const files: ReviewFile[] = [
  {
    path: 'src/logger.ts',
    status: 'added',
    additions: 42,
    deletions: 0,
    modules: ['logging'],
    unifiedDiff:
      `+import pino from 'pino';\n` +
      `+\n` +
      `+export const logger = pino({\n` +
      `+  level: process.env.LOG_LEVEL ?? 'info',\n` +
      `+  transport: process.env.NODE_ENV === 'development'\n` +
      `+    ? { target: 'pino-pretty' }\n` +
      `+    : undefined,\n` +
      `+  base: { service: 'meme-weather' },\n` +
      `+  redact: ['req.headers.authorization', 'req.headers.cookie'],\n` +
      `+});\n`,
  },
  {
    path: 'middleware.ts',
    status: 'modified',
    additions: 18,
    deletions: 2,
    modules: ['logging'],
    unifiedDiff:
      ` import { NextResponse } from 'next/server';\n` +
      `+import { logger } from './src/logger';\n` +
      ` \n` +
      ` export function middleware(req) {\n` +
      `+  const start = Date.now();\n` +
      `+  const reqId = crypto.randomUUID();\n` +
      `+  logger.info({ reqId, path: req.nextUrl.pathname }, 'request.start');\n` +
      `   return NextResponse.next();\n` +
      ` }\n`,
  },
  {
    path: 'app/api/health/route.ts',
    status: 'added',
    additions: 31,
    deletions: 0,
    modules: ['health'],
    unifiedDiff:
      `+import { NextResponse } from 'next/server';\n` +
      `+import { prisma } from '@/lib/prisma';\n` +
      `+\n` +
      `+export async function GET() {\n` +
      `+  const checks = { db: 'unknown', uptime: process.uptime() };\n` +
      `+  try {\n` +
      `+    await prisma.$queryRaw\`SELECT 1\`;\n` +
      `+    checks.db = 'ok';\n` +
      `+  } catch { checks.db = 'fail'; }\n` +
      `+  const ok = checks.db === 'ok';\n` +
      `+  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });\n` +
      `+}\n`,
  },
  {
    path: 'src/sentry.client.config.ts',
    status: 'added',
    additions: 22,
    deletions: 0,
    modules: ['sentry'],
    unifiedDiff:
      `+import * as Sentry from '@sentry/nextjs';\n` +
      `+Sentry.init({\n` +
      `+  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,\n` +
      `+  tracesSampleRate: 0.1,\n` +
      `+  environment: process.env.NODE_ENV,\n` +
      `+});\n`,
  },
  {
    path: 'src/sentry.server.config.ts',
    status: 'added',
    additions: 19,
    deletions: 0,
    modules: ['sentry'],
    unifiedDiff:
      `+import * as Sentry from '@sentry/nextjs';\n` +
      `+Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });\n`,
  },
  {
    path: 'src/sentry.edge.config.ts',
    status: 'added',
    additions: 12,
    deletions: 0,
    modules: ['sentry'],
    unifiedDiff: `+import * as Sentry from '@sentry/nextjs';\n+Sentry.init({ dsn: process.env.SENTRY_DSN });\n`,
  },
  {
    path: 'next.config.mjs',
    status: 'modified',
    additions: 8,
    deletions: 1,
    modules: ['sentry'],
    unifiedDiff:
      `-export default config;\n` +
      `+import { withSentryConfig } from '@sentry/nextjs';\n` +
      `+export default withSentryConfig(config, { silent: true });\n`,
  },
  {
    path: '.env.example',
    status: 'modified',
    additions: 6,
    deletions: 0,
    modules: ['env'],
    unifiedDiff:
      `+LOG_LEVEL=info\n` +
      `+SENTRY_DSN=\n` +
      `+NEXT_PUBLIC_SENTRY_DSN=\n`,
  },
  {
    path: 'app/api/radar/nominate/route.ts',
    status: 'modified',
    additions: 24,
    deletions: 3,
    modules: ['bug-patch'],
    unifiedDiff:
      `+import { z } from 'zod';\n` +
      `+const Body = z.object({ memeId: z.string().min(1), reason: z.string().max(280) });\n` +
      `-const body = JSON.parse(await req.text());\n` +
      `+const parsed = Body.safeParse(await req.json());\n` +
      `+if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });\n`,
  },
  {
    path: 'app/api/leaderboard/route.ts',
    status: 'modified',
    additions: 18,
    deletions: 2,
    modules: ['bug-patch'],
    unifiedDiff:
      `+try {\n` +
      `   const rows = await prisma.score.findMany({ orderBy: { score: 'desc' }, take: 50 });\n` +
      `+  return NextResponse.json({ rows });\n` +
      `+} catch (e) { logger.error({ err: e }, 'leaderboard.fail'); return NextResponse.json({ error: 'internal' }, { status: 500 }); }\n`,
  },
  {
    path: 'app/api/og/[id]/route.ts',
    status: 'modified',
    additions: 4,
    deletions: 2,
    modules: ['bug-patch'],
    unifiedDiff:
      `-console.log('[og] rendering', id);\n` +
      `+if (process.env.NODE_ENV !== 'production') logger.debug({ id }, 'og.render');\n`,
  },
  {
    path: 'app/api/sitemap/route.ts',
    status: 'modified',
    additions: 5,
    deletions: 1,
    modules: ['bug-patch'],
    unifiedDiff:
      `-console.log('[sitemap] regenerating')\n` +
      `+logger.info('sitemap.regen')\n`,
  },
];

// ---------------------------------------------------------------------------
// Branch coverage — synthesize 72 functions; ~15 with self-deceiving spec
// matches; the rest mix of covered / spec-only / untested. We only fill
// detailed trees for the first 8; the rest are summary stubs.
// ---------------------------------------------------------------------------

function leaf(id: string, label: string, verdict: BranchNode['verdict']): BranchNode {
  return {
    id,
    label,
    lineStart: 10,
    lineEnd: 14,
    kind: 'block',
    children: [],
    ast: { present: true },
    specMatches: verdict === 'spec-only' || verdict === 'covered'
      ? [{ specId: 's-1', specName: 'happy path returns 200', matchedTokens: ['returns', '200'] }]
      : [],
    judgeEvidence: verdict === 'covered'
      ? [{ specId: 's-1', status: 'pass', snippet: 'expect(res.status).toBe(200)' }]
      : verdict === 'judge-only'
      ? [{ specId: 's-2', status: 'pass', snippet: 'asserts body.ok === true' }]
      : [],
    runtimeCoverage:
      verdict === 'covered' || verdict === 'run-only'
        ? { linesTotal: 5, linesCovered: 5, branchHit: true }
        : { linesTotal: 5, linesCovered: 0, branchHit: false },
    verdict,
  };
}

function mkFunctionBranches(seed: number) {
  // every function: try/catch root with 2 happy + 1 error children
  const happy = leaf(`n-${seed}-happy`, 'if (valid)', seed % 5 === 0 ? 'spec-only' : 'covered');
  const errorPath = leaf(`n-${seed}-err`, 'catch (e)', seed % 3 === 0 ? 'spec-only' : 'untested');
  const fallback = leaf(`n-${seed}-fb`, 'return 500', seed % 7 === 0 ? 'judge-only' : 'untested');
  return {
    root: {
      id: `n-${seed}-root`,
      label: 'try { … } catch { … }',
      lineStart: 12,
      lineEnd: 60,
      kind: 'try',
      children: [happy, errorPath, fallback],
      ast: { present: true },
      specMatches: [],
      judgeEvidence: [],
      runtimeCoverage: { linesTotal: 48, linesCovered: 18, branchHit: null },
      verdict: 'unknown',
    } satisfies BranchNode,
    selfDeceivingCount: seed % 5 === 0 ? 1 : 0,  // spec-only → self-deceiving
    untestedCount: (seed % 3 === 0 ? 0 : 1) + (seed % 7 === 0 ? 0 : 1),
    coveredCount: seed % 5 === 0 ? 0 : 1,
  };
}

const functions = Array.from({ length: 72 }).map((_, i) => {
  const fn = mkFunctionBranches(i);
  const routePool = [...ROUTES_P1, ...ROUTES_P2, ...ROUTES_P3];
  const endpoint = routePool[i % routePool.length] ?? '/api/unknown';
  return {
    id: `fn-${i}`,
    file: `app${endpoint}/route.ts`,
    name: `${endpoint.split('/').pop()?.replace(/\W/g, '') || 'handler'}_${i}`,
    line: 12,
    branchCount: 3,
    coveredCount: fn.coveredCount,
    selfDeceivingCount: fn.selfDeceivingCount,
    untestedCount: fn.untestedCount,
    root: fn.root,
    associatedSpecs: i % 4 === 0
      ? [{ specId: `s-${i}`, specName: 'returns 200 on happy path', status: 'pass', category: 'integration' }]
      : [],
  };
});

const selfDeceivingTotal = functions.reduce((s, f) => s + f.selfDeceivingCount, 0);
const untestedTotal = functions.reduce((s, f) => s + f.untestedCount, 0);
const branchesCovered = functions.reduce((s, f) => s + f.coveredCount, 0);

// ---------------------------------------------------------------------------
// Branch-trace.jsonl — one event per branch leaf (covered/judge-only/untested).
// Mirrors what cli/src/agent/branch-trace.ts produces. Hash chain is fake but
// shape-faithful: each event has prev_hash + hash + seq. trace_id is constant
// per run. Timestamps tick in monotonic ~3ms increments so the stream view
// shows realistic ordering.
// ---------------------------------------------------------------------------

const TRACE_ID = '8VY9G2PXCKM4F1B7QH3J0NTRS';
const RUN_START_TS = Date.parse('2026-05-27T16:13:42.117Z');

function fakeHash(seed: string): string {
  // 64-char hex — not a real sha256, but stable per-seed for visual proof.
  let h = 5381;
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    h = (h * 33) ^ seed.charCodeAt((i * 7) % seed.length || 0) ^ (h >>> 5);
    out.push(((h >>> 0) % 0xffffffff).toString(16).padStart(8, '0'));
  }
  return out.join('').slice(0, 64);
}

function collectLeavesForEvents(node: BranchNode, out: BranchNode[]): void {
  // We emit events for ALL non-root branch nodes (leaves) — entry + branches.
  if (node.children.length === 0) {
    out.push(node);
    return;
  }
  for (const c of node.children) collectLeavesForEvents(c, out);
}

// Phase 14.5 — synthetic state/category distribution for preview mode.
//
// Backend doesn't emit `state` or `category` yet, but the heat-strip + tree
// state machine UI needs all 5 states to be visible in preview so reviewers
// can see what each one looks like without booting a daemon. Distribute:
//   - 60% covered     (verdict-derived; we leave these alone)
//   - 5%  evaluating  (state=evaluating)
//   - 5%  retrying    (state=retrying + retry counter)
//   - 15% mechanical-red (category=mechanical OR catch-block heuristic)
//   - 15% business-red   (category=business via auth keyword label)
//
// Selection uses seq parity so the mix is deterministic across reloads.
function syntheticStateFor(seq: number): {
  state?: BranchTraceEvent['state'];
  category?: BranchTraceEvent['category'];
  retry?: BranchTraceEvent['retry'];
} {
  // 20-buckets distribution: 12 covered, 1 evaluating, 1 retrying, 3 mech, 3 biz
  const bucket = seq % 20;
  if (bucket === 0) return { state: 'evaluating' };
  if (bucket === 1) return { state: 'retrying', retry: { attempt: 2, max: 3 } };
  if (bucket === 2 || bucket === 3 || bucket === 4) return { category: 'mechanical' };
  if (bucket === 5 || bucket === 6 || bucket === 7) return { category: 'business' };
  return {};
}

function buildMockBranchTraceEvents(): BranchTraceEvent[] {
  const events: BranchTraceEvent[] = [];
  let seq = 1;
  let prevHash = '0'.repeat(64);
  let tickMs = 0;

  for (const fn of functions) {
    const leaves: BranchNode[] = [];
    collectLeavesForEvents(fn.root, leaves);
    for (const node of leaves) {
      const ts = new Date(RUN_START_TS + tickMs).toISOString();
      tickMs += 3 + (seq % 5);

      const hasSpec = node.specMatches.length > 0;
      const hasJudge = node.judgeEvidence.length > 0;
      const hasRunData = node.runtimeCoverage.linesTotal > 0;
      const hasRun: boolean | null = hasRunData
        ? node.runtimeCoverage.linesCovered > 0 || node.runtimeCoverage.branchHit === true
        : null;

      const branchId = `${fn.file}:${fn.name}@${fn.line}:${node.kind}-line${node.lineStart}-${
        node.kind === 'catch' ? 'catch' : node.kind.includes('false') ? 'false' : 'true'
      }#${seq % 7}`;

      const hash = fakeHash(`${prevHash}${branchId}${seq}`);
      // Phase 14.5 — overlay synthetic state/category for preview demo.
      // For business-red bucket, also nudge the branch_label so the
      // heuristic (in lib/branchState.ts) picks 'business-red' even when
      // backend hasn't set `category` (covers the realistic case where the
      // backend stays silent).
      const synth = syntheticStateFor(seq);
      const labelForBucket = synth.category === 'business'
        ? `if (req.user?.role === 'admin')`
        : synth.category === 'mechanical' && node.kind !== 'catch'
        ? `missing encodeURIComponent on path`
        : node.label;
      const event: BranchTraceEvent = {
        ts,
        trace_id: TRACE_ID,
        span_id: fakeHash(`${TRACE_ID}${branchId}`).slice(0, 16).toUpperCase(),
        event: 'branch.evidence',
        branch_id: branchId,
        branch_kind: node.kind,
        branch_label: labelForBucket,
        line_start: node.lineStart,
        line_end: node.lineEnd,
        'code.function': fn.name,
        'code.file.path': fn.file,
        'code.line.number': fn.line,
        signals: { ast: true, spec: hasSpec, judge: hasJudge, run: hasRun },
        verdict: node.verdict,
        evidence: {
          spec_ids: node.specMatches.map((m) => m.specId).slice(0, 5),
          ...(hasJudge && {
            judge_specs: node.judgeEvidence.slice(0, 3).map((j) => ({
              spec_id: j.specId,
              status: j.status,
              snippet_preview: j.snippet.slice(0, 80),
            })),
          }),
          ...(hasRunData && { runtime_hits: node.runtimeCoverage.linesCovered }),
        },
        seq,
        prev_hash: prevHash,
        hash,
        ...(synth.state ? { state: synth.state } : {}),
        ...(synth.category ? { category: synth.category } : {}),
        ...(synth.retry ? { retry: synth.retry } : {}),
      };
      events.push(event);
      prevHash = hash;
      seq += 1;
    }
  }
  return events;
}

const branchTraceEvents = buildMockBranchTraceEvents();

// ---------------------------------------------------------------------------
// Bundle root
// ---------------------------------------------------------------------------

export const mockZerouBundle: ReviewBundle = {
  version: 1,
  project: {
    name: 'meme-weather',
    cwd: 'D:\\lll\\meme-weather-zerou-test',
    branch: 'zerou-enhance-20260527-160917',
    worktreePath: 'D:\\lll\\meme-weather-zerou-test.worktrees\\zerou-enhance-20260527-160917',
    runTs: '20260527-160917',
  },
  generatedAt: '2026-05-27T16:13:42.117Z',
  durationMs: 242_000,
  modules: [
    { id: 'logging', label: 'Logging', status: 'ok', summary: 'pino + request middleware', filesTouched: 2 },
    { id: 'bug-patch', label: 'Bug patches', status: 'partial', summary: '8 of 38 findings auto-patched', filesTouched: 4 },
    { id: 'health', label: 'Health', status: 'ok', summary: '/api/health with DB ping', filesTouched: 1 },
    { id: 'sentry', label: 'Sentry', status: 'ok', summary: 'client + server + edge wiring', filesTouched: 4 },
    { id: 'env', label: 'Env', status: 'ok', summary: '+3 vars in .env.example', filesTouched: 1 },
    { id: 'verify', label: 'Verify', status: 'ok', summary: 'install + tsc + build green', filesTouched: 0 },
  ],
  files,
  findings,
  branchCoverage: {
    generatedAt: '2026-05-27T16:13:40.001Z',
    cwd: 'D:\\lll\\meme-weather-zerou-test',
    functions,
    summary: {
      functionsAnalyzed: 72,
      branchesTotal: 72 * 3,
      branchesCovered,
      selfDeceivingTotal,
      untestedTotal,
      functionsWithSelfDeception: functions.filter((f) => f.selfDeceivingCount > 0).length,
    },
    availability: { ast: true, spec: true, judge: true, runtime: false },
  },
  verify: {
    ok: true,
    steps: [
      { name: 'install', status: 'pass', durationMs: 38_400 },
      { name: 'tsc', status: 'pass', durationMs: 21_900 },
      { name: 'test', status: 'skipped', durationMs: 0 },
      { name: 'build', status: 'pass', durationMs: 88_200 },
    ],
  },
  audit: {
    durationMs: 14_300,
    hardeningFindings: 38,
    testCases: { total: 66, pass: 33, fail: 33, inconclusive: 0, skipped: 0 },
  },
  branchTraceEvents,
};
