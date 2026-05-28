/**
 * Phase 12 — ReviewBundle builder tests.
 *
 * Coverage map:
 *   1. Empty .zerou → sentinel bundle
 *   2. audit-report only → audit populated, modules empty
 *   3. enhance-report.md + test-results.json → modules + findings populated
 *   4. branch-coverage.json present → branchCoverage populated
 *   5. P1/P2/P3 severity mapping from TestCaseCategory
 *   6. Module attribution heuristics (src/logger.ts → logging etc.)
 *   7. Verify parsing from markdown table
 *   8. 0-files module summary → 'skipped' status
 *   9. writeReviewBundle creates stable + archived paths
 *  10. JSON round-trip preserves semantic equality
 *  11. Cross-platform path normalization (backslash → forward slash)
 *  12. Missing test-results.json → no test-fail findings, static rows preserved
 *  13. Worktree missing → files empty + warning emitted
 *  14. Latest run auto-detected from runs/<ts>/ directory
 *  15. parseDuration round-trips '2m 5s' / '45s'
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildReviewBundle,
  writeReviewBundle,
  __internals,
} from './review-data.js';
import type { ReviewBundle } from './review-data-types.js';

// ── Tmp fixture helpers ─────────────────────────────────────────────────────

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'review-data-test-'));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function writeFile(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
}

const SAMPLE_REPORT_MD = `# ZeroU Enhance Report

**Project**: demo
**Branch**: zerou-enhance-20260527-182708
**Worktree**: D:\\tmp\\worktree
**Generated**: 2026-05-27T10:27:08.998Z
**Duration**: 5m 45s
**Verify**: PASS

---

## Summary

- Log injection: 119 sites planned across 5 files changed
- Bugs auto-patched: 0 of 4 findings (skipped 2, failed 2)
- Health endpoint: added \`app/health/route.ts\`
- Sentry SDK: added (deps: @sentry/nextjs@^8.50.0)
- .env.example: 1 vars added (7 already declared)

## Files Changed (3)

- [\`src/logger.ts\`](#srcloggerts) — +61, -0 (new)

## How to review

stuff here.

## 1. Module A/B — Log injection

**Logger lib**: pino
**Bootstrap created**: src/logger.ts
**Middleware created**: ➖ existing / not needed

| File | Sites changed | Site kinds |
|---|---|---|
| \`src/logger.ts\` | 0 | - |
| \`lib/db/client.ts\` | 1 | console-log |
| \`lib/db/seed.ts\` | 4 | console-log |

## 2. Module C — Bug fix patches

| Finding | File:line | Severity | Status | Reason |
|---|---|---|---|---|
| login-1 | app/api/login.ts:10 | P1 | failed | no-critic-llm |
| signup-2 | app/api/signup.ts:20 | P1 | skipped | not-mechanical-auth-test-fail |
| static-1 | lib/db.ts:5 | P2 | applied | patched-ok |
| edge-3 | app/api/edge.ts:30 | P2 | skipped | env-dependent-skip-v1 |

## 3. Module D — Health endpoint

Added health endpoint: \`app/health/route.ts\`

## 4. Module E — Sentry SDK

**Dependencies added**: @sentry/nextjs@^8.50.0
**Files created**:
- \`sentry.server.config.ts\`
- \`sentry.client.config.ts\`
**Bootstrap patched**: \`/tmp/worktree/package.json\`

## 5. Module F — .env.example

**Added**: \`SENTRY_DSN\`
**Already declared**: \`DATABASE_URL\`, \`NEXT_PUBLIC_API\`

## 6. Changes (full diff inline)

stuff here

## 7. Module G — Verification

| Step | Status | Duration | Notes |
|---|---|---|---|
| install | ✅ | 4m 12s | - |
| tsc | ✅ | 43s | - |
| test | ✅ | 46s | - |
| build | ➖ | 0s | skipped: skipBuild=true |

## Logs
`;

const SAMPLE_AUDIT_MD = `# Audit Report

## Summary

- **Duration**: 13m 51s
- **Categories scanned**: 3
- **Findings**: 0 total (0 confirmed, 0 false-positive, 0 needs-context)
- **Tests**: 70 total (15 passed, 38 failed, 3 skipped)

## Table of Contents
`;

const SAMPLE_TEST_RESULTS = [
  {
    spec: {
      id: 'login-1',
      name: 'Login rejects empty password',
      category: 'auth',
      scope: { type: 'endpoint', target: 'POST /api/login', file: 'app/api/login.ts', line: 10 },
      given: 'no password',
      when: 'POST /api/login',
      then: 'returns 400',
      reasoning: '',
    },
    status: 'fail',
    verdictReason: 'handler hashes undefined password',
    evidence: {
      file: 'app/api/login.ts',
      line: 10,
      snippet: 'const hash = await bcrypt.hash(password)',
      expectedBehavior: '400',
      actualBehavior: '500',
    },
    criticFamily: 'anthropic',
    durationMs: 100,
  },
  {
    spec: {
      id: 'signup-2',
      name: 'Signup escapes XSS',
      category: 'security',
      scope: { type: 'endpoint', target: 'POST /api/signup', file: 'app/api/signup.ts', line: 20 },
      given: 'html in name',
      when: 'POST /api/signup',
      then: 'escapes',
      reasoning: '',
    },
    status: 'fail',
    verdictReason: 'no escaping',
    evidence: {},
    criticFamily: null,
    durationMs: 50,
  },
  {
    spec: {
      id: 'happy-1',
      name: 'Index returns 200',
      category: 'happy-path',
      scope: { type: 'endpoint', target: 'GET /', file: 'app/page.tsx', line: 1 },
      given: '',
      when: '',
      then: '',
      reasoning: '',
    },
    status: 'pass',
    verdictReason: '',
    evidence: {},
    criticFamily: null,
    durationMs: 10,
  },
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe('buildReviewBundle', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });

  afterEach(() => {
    rmTmp(tmp);
  });

  it('1. returns sentinel-shaped bundle when .zerou is empty', async () => {
    // No .zerou directory at all.
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.version).toBe(1);
    expect(b.modules).toEqual([]);
    expect(b.files).toEqual([]);
    expect(b.findings).toEqual([]);
    expect(b.audit).toBeNull();
    expect(b.branchCoverage).toBeNull();
    expect(b.verify.steps).toEqual([]);
    expect(b.verify.ok).toBe(false);
    expect(b.project.name).toBe(path.basename(tmp));
  });

  it('2. populates audit but leaves modules empty when only audit-report.md exists', async () => {
    writeFile(path.join(tmp, '.zerou', 'audit-report.md'), SAMPLE_AUDIT_MD);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.audit).not.toBeNull();
    expect(b.audit?.testCases.total).toBe(70);
    expect(b.audit?.testCases.pass).toBe(15);
    expect(b.audit?.testCases.fail).toBe(38);
    expect(b.audit?.testCases.skipped).toBe(3);
    expect(b.audit?.hardeningFindings).toBe(0);
    expect(b.audit?.durationMs).toBe((13 * 60 + 51) * 1000);
    expect(b.modules).toEqual([]);
  });

  it('3. populates modules + findings when enhance-report + test-results present', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    writeFile(
      path.join(tmp, '.zerou', 'test-results.json'),
      JSON.stringify(SAMPLE_TEST_RESULTS),
    );
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.modules.length).toBe(6);
    const ids = b.modules.map((m) => m.id);
    expect(ids).toEqual(['logging', 'bug-patch', 'health', 'sentry', 'env', 'verify']);
    // Two failing test cases became findings.
    const testFails = b.findings.filter((f) => f.source === 'test-fail');
    expect(testFails.length).toBe(2);
    const ids2 = testFails.map((f) => f.id).sort();
    expect(ids2).toEqual(['login-1', 'signup-2']);
    // login-1 cross-refs to patcher row with status='failed'.
    const login = testFails.find((f) => f.id === 'login-1')!;
    expect(login.status).toBe('failed');
    expect(login.reason).toBe('no-critic-llm');
    expect(login.severity).toBe('P1');
    // happy-path 'pass' result skipped.
    expect(b.findings.find((f) => f.id === 'happy-1')).toBeUndefined();
  });

  it('4. populates branchCoverage when branch-coverage.json exists', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const sample = {
      generatedAt: '2026-05-27T00:00:00.000Z',
      cwd: tmp,
      functions: [],
      summary: {
        functionsAnalyzed: 0,
        branchesTotal: 0,
        branchesCovered: 0,
        selfDeceivingTotal: 0,
        untestedTotal: 0,
        functionsWithSelfDeception: 0,
      },
      availability: { ast: true, spec: false, judge: false, runtime: false },
    };
    writeFile(
      path.join(tmp, '.zerou', 'branch-coverage.json'),
      JSON.stringify(sample),
    );
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.branchCoverage).not.toBeNull();
    expect(b.branchCoverage?.availability.ast).toBe(true);
  });

  it('5. severity mapping: security/auth → P1, validation/error-handling → P2, edge/happy → P3', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const results = [
      {
        spec: {
          id: 's-1', name: 'sec', category: 'security',
          scope: { type: 'endpoint', target: '', file: 'a.ts', line: 1 },
          given: '', when: '', then: '', reasoning: '',
        },
        status: 'fail', verdictReason: '', evidence: {}, criticFamily: null, durationMs: 1,
      },
      {
        spec: {
          id: 's-2', name: 'val', category: 'validation',
          scope: { type: 'endpoint', target: '', file: 'a.ts', line: 2 },
          given: '', when: '', then: '', reasoning: '',
        },
        status: 'fail', verdictReason: '', evidence: {}, criticFamily: null, durationMs: 1,
      },
      {
        spec: {
          id: 's-3', name: 'edge', category: 'edge-case',
          scope: { type: 'endpoint', target: '', file: 'a.ts', line: 3 },
          given: '', when: '', then: '', reasoning: '',
        },
        status: 'fail', verdictReason: '', evidence: {}, criticFamily: null, durationMs: 1,
      },
    ];
    writeFile(path.join(tmp, '.zerou', 'test-results.json'), JSON.stringify(results));
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    const sev = Object.fromEntries(b.findings.map((f) => [f.id, f.severity]));
    expect(sev['s-1']).toBe('P1');
    expect(sev['s-2']).toBe('P2');
    expect(sev['s-3']).toBe('P3');
  });

  it('6. module attribution: src/logger.ts → logging; sentry.server.config.ts → sentry', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const fakeFetcher = async () => [
      { file: 'src/logger.ts', status: 'added' as const, additions: 30, deletions: 0, unifiedDiff: '+ logger\n' },
      { file: 'sentry.server.config.ts', status: 'added' as const, additions: 5, deletions: 0, unifiedDiff: '+ x\n' },
      { file: 'app/health/route.ts', status: 'added' as const, additions: 10, deletions: 0, unifiedDiff: '+ health\n' },
      { file: '.env.example', status: 'modified' as const, additions: 1, deletions: 0, unifiedDiff: '+ SENTRY_DSN\n' },
      { file: 'lib/db/seed.ts', status: 'modified' as const, additions: 4, deletions: 4, unifiedDiff: '+import { logger } from "../../src/logger"\n' },
      { file: 'random.txt', status: 'modified' as const, additions: 1, deletions: 0, unifiedDiff: '+ misc\n' },
    ];
    const b = await buildReviewBundle(tmp, { diffFetcher: fakeFetcher });
    const byPath = Object.fromEntries(b.files.map((f) => [f.path, f.modules]));
    expect(byPath['src/logger.ts']).toEqual(['logging']);
    expect(byPath['sentry.server.config.ts']).toEqual(['sentry']);
    expect(byPath['app/health/route.ts']).toEqual(['health']);
    expect(byPath['.env.example']).toEqual(['env']);
    expect(byPath['lib/db/seed.ts']).toEqual(['logging']); // detected from import line
    expect(byPath['random.txt']).toEqual([]);
  });

  it('7. parses verify steps correctly from markdown table', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.verify.steps).toEqual([
      { name: 'install', status: 'pass', durationMs: (4 * 60 + 12) * 1000 },
      { name: 'tsc', status: 'pass', durationMs: 43 * 1000 },
      { name: 'test', status: 'pass', durationMs: 46 * 1000 },
      { name: 'build', status: 'skipped', durationMs: 0 },
    ]);
    expect(b.verify.ok).toBe(true);
  });

  it('8. module summary status: 0 files touched → "skipped"', async () => {
    const skinnyMd = `# x
**Branch**: zerou-enhance-20260527-100000
**Worktree**: ${tmp.replace(/\\/g, '/')}/.worktrees/zerou-enhance-20260527-100000
**Duration**: 0s

## 1. Module A/B — Log injection

_Module did not run._

## 2. Module C — Bug fix patches

_No findings to patch._

## 3. Module D — Health endpoint

Skipped: framework-unsupported

## 4. Module E — Sentry SDK

Already tracked — no changes made.

## 5. Module F — .env.example

No env vars detected in source.

## 7. Module G — Verification

_Module did not run._
`;
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), skinnyMd);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.modules.find((m) => m.id === 'logging')?.status).toBe('skipped');
    expect(b.modules.find((m) => m.id === 'bug-patch')?.status).toBe('skipped');
    expect(b.modules.find((m) => m.id === 'health')?.status).toBe('skipped');
    expect(b.modules.find((m) => m.id === 'sentry')?.status).toBe('skipped');
    expect(b.modules.find((m) => m.id === 'env')?.status).toBe('skipped');
    expect(b.modules.find((m) => m.id === 'verify')?.status).toBe('skipped');
    for (const m of b.modules) {
      expect(m.filesTouched).toBe(0);
    }
  });

  it('9. writeReviewBundle creates stable + archived paths', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    const stable = writeReviewBundle(tmp, b, '20260527-182708');
    expect(fs.existsSync(stable)).toBe(true);
    expect(stable.endsWith(path.normalize('.zerou/review-bundle.json'))).toBe(true);
    const archived = path.join(tmp, '.zerou', 'runs', '20260527-182708', 'review-bundle.json');
    expect(fs.existsSync(archived)).toBe(true);
    const a = JSON.parse(fs.readFileSync(stable, 'utf8'));
    const c = JSON.parse(fs.readFileSync(archived, 'utf8'));
    expect(a.project.runTs).toBe(c.project.runTs);
  });

  it('10. JSON round-trip preserves semantic equality', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    writeFile(
      path.join(tmp, '.zerou', 'test-results.json'),
      JSON.stringify(SAMPLE_TEST_RESULTS),
    );
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    const reparsed: ReviewBundle = JSON.parse(JSON.stringify(b));
    expect(reparsed.version).toBe(b.version);
    expect(reparsed.modules).toEqual(b.modules);
    expect(reparsed.findings).toEqual(b.findings);
    expect(reparsed.verify).toEqual(b.verify);
    expect(reparsed.project).toEqual(b.project);
  });

  it('11. cross-platform: backslash paths in diffs → forward-slash in bundle', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const fakeFetcher = async () => [
      {
        file: 'src\\nested\\logger.ts',
        oldFile: 'src\\old.ts',
        status: 'renamed' as const,
        additions: 1,
        deletions: 1,
        unifiedDiff: '',
      },
    ];
    const b = await buildReviewBundle(tmp, { diffFetcher: fakeFetcher });
    expect(b.files[0]!.path).toBe('src/nested/logger.ts');
    expect(b.files[0]!.oldPath).toBe('src/old.ts');
  });

  it('12. missing test-results.json → no test-fail findings, static rows preserved', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    // No test-results.json → all findings come from the patcher table.
    expect(b.findings.every((f) => f.source === 'static')).toBe(true);
    // Patcher table had 4 rows.
    expect(b.findings.length).toBe(4);
    const applied = b.findings.find((f) => f.id === 'static-1');
    expect(applied?.status).toBe('patched');
    expect(applied?.severity).toBe('P2');
  });

  it('13. missing worktree → files empty + warning emitted', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    // SAMPLE_REPORT_MD points worktree at D:\tmp\worktree which doesn't exist.
    const warnings: string[] = [];
    const b = await buildReviewBundle(tmp, {
      onWarn: (e) => warnings.push(e),
    });
    expect(b.files).toEqual([]);
    expect(warnings.some((w) => w.includes('worktree-missing'))).toBe(true);
  });

  it('14. latest run auto-detected when multiple runs/ subdirs exist', async () => {
    // Two runs; the latest one's report should be picked up.
    const older = '20260527-100000';
    const newer = '20260527-200000';
    writeFile(
      path.join(tmp, '.zerou', 'runs', older, 'enhance-report.md'),
      '# old\n**Branch**: zerou-enhance-' + older + '\n**Worktree**: /nope\n**Duration**: 1s\n',
    );
    writeFile(
      path.join(tmp, '.zerou', 'runs', newer, 'enhance-report.md'),
      '# new\n**Branch**: zerou-enhance-' + newer + '\n**Worktree**: /nope\n**Duration**: 9s\n',
    );
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.project.runTs).toBe(newer);
    expect(b.project.branch).toBe('zerou-enhance-' + newer);
  });

  it('15. parseDuration round-trips', () => {
    expect(__internals.parseDuration('45s')).toBe(45_000);
    expect(__internals.parseDuration('2m 5s')).toBe(125_000);
    expect(__internals.parseDuration('0s')).toBe(0);
    expect(__internals.parseDuration('bogus')).toBe(0);
  });

  // Phase 14D — branch manifest + trace merge semantics.
  it('17. branchTraceEvents merges manifest (denominator) with stream (numerator)', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    // Manifest: 3 branches, all untested.
    const manifestLines = [
      JSON.stringify({
        ts: '2026-05-28T00:00:00.000Z',
        trace_id: 'T',
        event: 'branch.evidence',
        branch_id: 'a.ts:f@1:if-true-line5-true#1',
        branch_kind: 'if-true',
        branch_label: 'auth check',
        line_start: 5,
        line_end: 7,
        'code.function': 'f',
        'code.file.path': 'a.ts',
        'code.line.number': 1,
        signals: { ast: true, spec: false, judge: false, run: null },
        verdict: 'untested',
        evidence: { spec_ids: [] },
        seq: 1,
      }),
      JSON.stringify({
        ts: '2026-05-28T00:00:00.000Z',
        trace_id: 'T',
        event: 'branch.evidence',
        branch_id: 'a.ts:f@1:if-false-line5-false#2',
        branch_kind: 'if-false',
        branch_label: 'else',
        line_start: 8,
        line_end: 10,
        'code.function': 'f',
        'code.file.path': 'a.ts',
        'code.line.number': 1,
        signals: { ast: true, spec: false, judge: false, run: null },
        verdict: 'untested',
        evidence: { spec_ids: [] },
        seq: 2,
      }),
      JSON.stringify({
        ts: '2026-05-28T00:00:00.000Z',
        trace_id: 'T',
        event: 'branch.evidence',
        branch_id: 'a.ts:f@1:if-true-line20-true#3',
        branch_kind: 'if-true',
        branch_label: 'inner',
        line_start: 20,
        line_end: 22,
        'code.function': 'f',
        'code.file.path': 'a.ts',
        'code.line.number': 1,
        signals: { ast: true, spec: false, judge: false, run: null },
        verdict: 'untested',
        evidence: { spec_ids: [] },
        seq: 3,
      }),
    ].join('\n') + '\n';
    writeFile(path.join(tmp, '.zerou', 'branch-manifest.jsonl'), manifestLines);
    // Stream: only branch 1 has live state.
    const streamLines = [
      JSON.stringify({
        ts: '2026-05-28T00:01:00.000Z',
        trace_id: 'T',
        event: 'branch.evidence',
        branch_id: 'a.ts:f@1:if-true-line5-true#1',
        branch_kind: 'if-true',
        branch_label: 'auth check',
        line_start: 5,
        line_end: 7,
        'code.function': 'f',
        'code.file.path': 'a.ts',
        'code.line.number': 1,
        signals: { ast: true, spec: true, judge: true, run: null },
        verdict: 'covered',
        state: 'covered',
        evidence: { spec_ids: ['s-1'] },
        seq: 1,
      }),
    ].join('\n') + '\n';
    writeFile(path.join(tmp, '.zerou', 'branch-trace.jsonl'), streamLines);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.branchTraceEvents).toBeDefined();
    // 3 unique branches.
    expect(b.branchTraceEvents!.length).toBe(3);
    // The branch with live state has state='covered' AND verdict='covered'.
    const covered = b.branchTraceEvents!.find(
      (e) => e.branch_id === 'a.ts:f@1:if-true-line5-true#1',
    );
    expect(covered!.state).toBe('covered');
    expect(covered!.verdict).toBe('covered');
    // Untouched branches still show verdict='untested' and no state.
    const untouched = b.branchTraceEvents!.find(
      (e) => e.branch_id === 'a.ts:f@1:if-false-line5-false#2',
    );
    expect(untouched!.verdict).toBe('untested');
    expect(untouched!.state).toBeUndefined();
  });

  it('18. branchTraceEvents falls back to single file (pre-14D layout)', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    // Only the legacy branch-trace.jsonl (no manifest).
    const legacyLines = [
      JSON.stringify({
        ts: '2026-05-27T00:00:00.000Z',
        trace_id: 'T',
        event: 'branch.evidence',
        branch_id: 'a.ts:f@1:legacy#1',
        branch_kind: 'if-true',
        branch_label: 'legacy',
        line_start: 5,
        line_end: 5,
        'code.function': 'f',
        'code.file.path': 'a.ts',
        'code.line.number': 1,
        signals: { ast: true, spec: false, judge: false, run: null },
        verdict: 'untested',
        evidence: { spec_ids: [] },
        seq: 1,
      }),
    ].join('\n') + '\n';
    writeFile(path.join(tmp, '.zerou', 'branch-trace.jsonl'), legacyLines);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    expect(b.branchTraceEvents).toBeDefined();
    expect(b.branchTraceEvents!.length).toBe(1);
    expect(b.branchTraceEvents![0]!.branch_id).toBe('a.ts:f@1:legacy#1');
  });

  it('16. patcher status maps to finding status correctly', async () => {
    writeFile(path.join(tmp, '.zerou', 'enhance-report.md'), SAMPLE_REPORT_MD);
    const b = await buildReviewBundle(tmp, { diffFetcher: async () => [] });
    // From SAMPLE_REPORT_MD patcher table.
    const byId = Object.fromEntries(b.findings.map((f) => [f.id, f.status]));
    expect(byId['login-1']).toBe('failed');
    expect(byId['signup-2']).toBe('skipped');
    expect(byId['static-1']).toBe('patched');
    expect(byId['edge-3']).toBe('skipped');
  });
});
