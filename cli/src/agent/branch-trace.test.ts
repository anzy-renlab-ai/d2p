/**
 * Tests for branch-manifest.jsonl writer (Phase 13.1).
 *
 * The promise this artifact makes: `jq -r '.branch_id' | sort -u | wc -l`
 * is the coverage numerator. These tests pin the schema, the ordering, the
 * hash chain, and the OTel field naming so that promise stays intact.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildBranchTraceEvents,
  formatBranchEvent,
  makeBranchId,
  writeBranchManifest,
  type BranchTraceEvent,
} from './branch-trace.js';
import type {
  BranchCoverageReport,
  BranchNode,
  FunctionCoverage,
} from './branch-coverage-types.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function node(part: Partial<BranchNode> & Pick<BranchNode, 'id' | 'kind' | 'lineStart' | 'lineEnd'>): BranchNode {
  return {
    label: part.label ?? part.id,
    ast: { present: true },
    specMatches: [],
    judgeEvidence: [],
    runtimeCoverage: { linesTotal: 0, linesCovered: 0, branchHit: null },
    verdict: 'unknown',
    ...part,
    children: part.children ?? [],
  } as BranchNode;
}

function fn(part: Partial<FunctionCoverage> & Pick<FunctionCoverage, 'file' | 'name' | 'line' | 'root'>): FunctionCoverage {
  return {
    id: `${part.file}:${part.name}@${part.line}`,
    branchCount: 1,
    coveredCount: 0,
    selfDeceivingCount: 0,
    untestedCount: 0,
    associatedSpecs: [],
    ...part,
  };
}

function report(part: Partial<BranchCoverageReport> & Pick<BranchCoverageReport, 'functions'>): BranchCoverageReport {
  return {
    generatedAt: '2026-05-27T10:27:07.126Z',
    cwd: 'D:/lll/demo',
    summary: {
      functionsAnalyzed: part.functions.length,
      branchesTotal: 0,
      branchesCovered: 0,
      selfDeceivingTotal: 0,
      untestedTotal: 0,
      functionsWithSelfDeception: 0,
    },
    availability: { ast: true, spec: false, judge: false, runtime: false },
    ...part,
  };
}

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-trace-'));
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('writeBranchManifest', () => {
  it('1. empty report → empty file (0 lines)', async () => {
    const dir = await tmpdir();
    const r = report({ functions: [] });
    const out = writeBranchManifest(dir, r);
    expect(out).toBe(path.join(dir, '.zerou', 'branch-manifest.jsonl'));
    expect(fs.readFileSync(out, 'utf8')).toBe('');
  });

  it('2. one function with one entry branch → one line; seq=1; prev_hash=64 zeros', async () => {
    const dir = await tmpdir();
    const root = node({ id: 'entry', kind: 'entry', lineStart: 5, lineEnd: 5, label: 'doThing' });
    const r = report({
      functions: [fn({ file: 'src/a.ts', name: 'doThing', line: 5, root })],
    });
    const out = writeBranchManifest(dir, r);
    const text = fs.readFileSync(out, 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    const ev = JSON.parse(lines[0]!) as BranchTraceEvent;
    expect(ev.seq).toBe(1);
    expect(ev.prev_hash).toBe('0'.repeat(64));
    expect(ev.branch_kind).toBe('entry');
  });

  it('3. two branches → seq 1,2 and line 2 prev_hash chains line 1 hash', async () => {
    const dir = await tmpdir();
    const child = node({ id: 'if-9-true-1', kind: 'if-true', lineStart: 10, lineEnd: 12 });
    const root = node({ id: 'entry', kind: 'entry', lineStart: 8, lineEnd: 8, children: [child] });
    const r = report({
      functions: [fn({ file: 'src/a.ts', name: 'foo', line: 8, root })],
    });
    const out = writeBranchManifest(dir, r);
    const lines = fs.readFileSync(out, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    const e1 = JSON.parse(lines[0]!) as BranchTraceEvent;
    const e2 = JSON.parse(lines[1]!) as BranchTraceEvent;
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e2.prev_hash).toBe(e1.hash);
  });

  it('4. branch_id format covers if-true / if-false / switch-case / try-body / catch', () => {
    const fnFix = fn({
      file: 'src/h.ts',
      name: 'handler',
      line: 1,
      root: node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 }),
    });
    expect(makeBranchId(fnFix, node({ id: 'if-9-true-1', kind: 'if-true', lineStart: 10, lineEnd: 12 }))).toBe(
      'src/h.ts:handler@1:if-true-line10-true#1',
    );
    expect(makeBranchId(fnFix, node({ id: 'if-9-false-2', kind: 'if-false', lineStart: 13, lineEnd: 15 }))).toBe(
      'src/h.ts:handler@1:if-false-line13-false#2',
    );
    expect(makeBranchId(fnFix, node({ id: 'switch-20-case-0-3', kind: 'switch-case', lineStart: 21, lineEnd: 23 }))).toBe(
      'src/h.ts:handler@1:switch-case-line21-case-0#3',
    );
    expect(makeBranchId(fnFix, node({ id: 'try-30-body-4', kind: 'try-body', lineStart: 31, lineEnd: 33 }))).toBe(
      'src/h.ts:handler@1:try-body-line31-body#4',
    );
    expect(makeBranchId(fnFix, node({ id: 'try-30-catch-5', kind: 'catch', lineStart: 34, lineEnd: 36 }))).toBe(
      'src/h.ts:handler@1:catch-line34-catch#5',
    );
  });

  it('5. signals object reflects BranchNode evidence presence', () => {
    const root = node({
      id: 'entry',
      kind: 'entry',
      lineStart: 1,
      lineEnd: 1,
      specMatches: [{ specId: 's1', specName: 'spec one', matchedTokens: ['401'] }],
      judgeEvidence: [{ specId: 's1', status: 'pass', snippet: 'res.status(401)' }],
      runtimeCoverage: { linesTotal: 1, linesCovered: 1, branchHit: true },
      verdict: 'covered',
    });
    const ev = formatBranchEvent({
      node: root,
      fn: fn({ file: 's.ts', name: 'f', line: 1, root }),
      trace_id: 'TRACE',
      span_id: 'SPAN',
      ts: '2026-01-01T00:00:00.000Z',
      seq: 1,
      prev_hash: '0'.repeat(64),
    });
    expect(ev.signals).toEqual({ ast: true, spec: true, judge: true, run: true });
  });

  it('5b. signals.run is null when no runtime data, false when 0 hits, true when ≥1 hit', () => {
    const noData = node({
      id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1,
      runtimeCoverage: { linesTotal: 0, linesCovered: 0, branchHit: null },
    });
    const zeroHits = node({
      id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1,
      runtimeCoverage: { linesTotal: 3, linesCovered: 0, branchHit: false },
    });
    const someHits = node({
      id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1,
      runtimeCoverage: { linesTotal: 3, linesCovered: 2, branchHit: null },
    });
    const mkEv = (n: BranchNode): BranchTraceEvent => formatBranchEvent({
      node: n,
      fn: fn({ file: 's.ts', name: 'f', line: 1, root: n }),
      trace_id: 'T', span_id: 'S', ts: 'x', seq: 1, prev_hash: '0'.repeat(64),
    });
    expect(mkEv(noData).signals.run).toBeNull();
    expect(mkEv(zeroHits).signals.run).toBe(false);
    expect(mkEv(someHits).signals.run).toBe(true);
  });

  it('6. verdict copied verbatim from BranchNode', () => {
    for (const v of ['covered', 'judge-only', 'spec-only', 'run-only', 'untested', 'unknown'] as const) {
      const root = node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1, verdict: v });
      const ev = formatBranchEvent({
        node: root, fn: fn({ file: 's.ts', name: 'f', line: 1, root }),
        trace_id: 'T', span_id: 'S', ts: 'x', seq: 1, prev_hash: '0'.repeat(64),
      });
      expect(ev.verdict).toBe(v);
    }
  });

  it('7. stable ordering: same input produces byte-identical file twice', async () => {
    const a = await tmpdir();
    const b = await tmpdir();
    const mk = (): BranchCoverageReport => report({
      functions: [
        fn({ file: 'src/b.ts', name: 'bar', line: 3, root: node({ id: 'entry', kind: 'entry', lineStart: 3, lineEnd: 3 }) }),
        fn({ file: 'src/a.ts', name: 'foo', line: 7, root: node({ id: 'entry', kind: 'entry', lineStart: 7, lineEnd: 7 }) }),
      ],
    });
    writeBranchManifest(a, mk());
    writeBranchManifest(b, mk());
    const ta = fs.readFileSync(path.join(a, '.zerou', 'branch-manifest.jsonl'), 'utf8');
    const tb = fs.readFileSync(path.join(b, '.zerou', 'branch-manifest.jsonl'), 'utf8');
    expect(ta).toBe(tb);
    // Files should appear in alphabetical order: src/a.ts before src/b.ts
    const first = JSON.parse(ta.split('\n')[0]!) as BranchTraceEvent;
    expect(first['code.file.path']).toBe('src/a.ts');
  });

  it('8. hash chain integrity: hash equals sha256 of event minus hash field', async () => {
    const dir = await tmpdir();
    const r = report({
      functions: [
        fn({
          file: 'src/x.ts', name: 'baz', line: 2,
          root: node({
            id: 'entry', kind: 'entry', lineStart: 2, lineEnd: 2,
            children: [
              node({ id: 'if-5-true-1', kind: 'if-true', lineStart: 5, lineEnd: 8 }),
              node({ id: 'if-5-false-2', kind: 'if-false', lineStart: 9, lineEnd: 11 }),
            ],
          }),
        }),
      ],
    });
    const out = writeBranchManifest(dir, r);
    const lines = fs.readFileSync(out, 'utf8').trim().split('\n');
    let prev = '0'.repeat(64);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const { hash, ...rest } = parsed;
      const expected = sha256Hex(JSON.stringify(rest));
      expect(hash).toBe(expected);
      expect(rest.prev_hash).toBe(prev);
      prev = hash as string;
    }
  });

  it('9. JSONL format: every line parses as JSON, no surrounding brackets', async () => {
    const dir = await tmpdir();
    const r = report({
      functions: [
        fn({ file: 's.ts', name: 'f', line: 1, root: node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 }) }),
      ],
    });
    const out = writeBranchManifest(dir, r);
    const text = fs.readFileSync(out, 'utf8');
    expect(text.startsWith('[')).toBe(false);
    expect(text.startsWith('{')).toBe(true);
    expect(text.endsWith(']')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    for (const line of text.split('\n').filter((l) => l.length > 0)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('10. OTel field names use dotted naming exactly', () => {
    const root = node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 });
    const ev = formatBranchEvent({
      node: root,
      fn: fn({ file: 's.ts', name: 'myFn', line: 1, root }),
      trace_id: 'T', span_id: 'S', ts: 'x', seq: 1, prev_hash: '0'.repeat(64),
    });
    expect(ev['code.function']).toBe('myFn');
    expect(ev['code.file.path']).toBe('s.ts');
    expect(ev['code.line.number']).toBe(1);
    // Ensure non-dotted camelCase aliases are NOT present
    const raw = JSON.parse(JSON.stringify(ev)) as Record<string, unknown>;
    expect(raw.codeFunction).toBeUndefined();
    expect(raw.codeFilePath).toBeUndefined();
  });

  it('11. evidence.spec_ids truncated to ≤5 (deduped)', () => {
    const specMatches = Array.from({ length: 8 }, (_, i) => ({
      specId: `spec-${i}`, specName: `s${i}`, matchedTokens: ['x'],
    }));
    const root = node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1, specMatches });
    const ev = formatBranchEvent({
      node: root, fn: fn({ file: 's.ts', name: 'f', line: 1, root }),
      trace_id: 'T', span_id: 'S', ts: 'x', seq: 1, prev_hash: '0'.repeat(64),
    });
    expect(ev.evidence.spec_ids.length).toBe(5);
    expect(ev.evidence.spec_ids[0]).toBe('spec-0');
    expect(ev.evidence.spec_ids[4]).toBe('spec-4');
  });

  it('12. evidence.judge_specs truncated to ≤3 with snippet_preview ≤80 chars', () => {
    const longSnippet = 'a'.repeat(200);
    const judgeEvidence = Array.from({ length: 5 }, (_, i) => ({
      specId: `s-${i}`, status: 'pass' as const, snippet: longSnippet,
    }));
    const root = node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1, judgeEvidence });
    const ev = formatBranchEvent({
      node: root, fn: fn({ file: 's.ts', name: 'f', line: 1, root }),
      trace_id: 'T', span_id: 'S', ts: 'x', seq: 1, prev_hash: '0'.repeat(64),
    });
    expect(ev.evidence.judge_specs).toBeDefined();
    expect(ev.evidence.judge_specs!.length).toBe(3);
    for (const j of ev.evidence.judge_specs!) {
      expect(j.snippet_preview.length).toBeLessThanOrEqual(80);
    }
  });

  it('13. run-twice idempotency: file content byte-identical', async () => {
    const dir = await tmpdir();
    const r = report({
      functions: [
        fn({
          file: 's.ts', name: 'f', line: 1,
          root: node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 }),
        }),
      ],
    });
    const p1 = writeBranchManifest(dir, r);
    const t1 = fs.readFileSync(p1, 'utf8');
    const p2 = writeBranchManifest(dir, r);
    const t2 = fs.readFileSync(p2, 'utf8');
    expect(p1).toBe(p2);
    expect(t1).toBe(t2);
  });

  it('14. returns absolute path under <cwd>/.zerou/', async () => {
    const dir = await tmpdir();
    const r = report({ functions: [] });
    const out = writeBranchManifest(dir, r);
    expect(path.isAbsolute(out)).toBe(true);
    expect(out).toBe(path.join(dir, '.zerou', 'branch-manifest.jsonl'));
  });

  it('15. archived copy is written when runTs is supplied', async () => {
    const dir = await tmpdir();
    const r = report({
      functions: [
        fn({ file: 's.ts', name: 'f', line: 1,
          root: node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 }) }),
      ],
    });
    writeBranchManifest(dir, r, '20260527-103000');
    const archived = path.join(dir, '.zerou', 'runs', '20260527-103000', 'branch-manifest.jsonl');
    expect(fs.existsSync(archived)).toBe(true);
    const stable = fs.readFileSync(path.join(dir, '.zerou', 'branch-manifest.jsonl'), 'utf8');
    expect(fs.readFileSync(archived, 'utf8')).toBe(stable);
  });

  it('16. branch_id count matches branchesTotal denominator (the core promise)', () => {
    // Build a report with exactly 5 branches: 1 entry + 2 if arms + 2 try arms
    const ifTrue = node({ id: 'if-5-true-1', kind: 'if-true', lineStart: 6, lineEnd: 8 });
    const ifFalse = node({ id: 'if-5-false-2', kind: 'if-false', lineStart: 9, lineEnd: 11 });
    const tryBody = node({ id: 'try-12-body-3', kind: 'try-body', lineStart: 13, lineEnd: 15 });
    const catchArm = node({ id: 'try-12-catch-4', kind: 'catch', lineStart: 16, lineEnd: 18 });
    const root = node({
      id: 'entry', kind: 'entry', lineStart: 2, lineEnd: 2,
      children: [ifTrue, ifFalse, tryBody, catchArm],
    });
    const r = report({
      functions: [fn({ file: 'src/a.ts', name: 'f', line: 2, root, branchCount: 5 })],
      summary: {
        functionsAnalyzed: 1, branchesTotal: 5, branchesCovered: 0,
        selfDeceivingTotal: 0, untestedTotal: 0, functionsWithSelfDeception: 0,
      },
    });
    const events = buildBranchTraceEvents(r);
    expect(events.length).toBe(5);
    const ids = new Set(events.map((e) => e.branch_id));
    expect(ids.size).toBe(5);
  });
});
