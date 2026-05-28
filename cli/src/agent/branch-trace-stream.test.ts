/**
 * Tests for BranchTraceStream (Phase 14C).
 *
 * The stream owes its consumers three invariants:
 *   1. Hash chain remains unbroken (incl. across re-open).
 *   2. seq is monotonic per file (incl. across re-open).
 *   3. Live `state` field is faithful to the BranchNode + verdict.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  BranchTraceStream,
  deriveStateFromVerdict,
  findMatchingBranch,
  indexBranchesByLine,
  type BranchTraceStreamEvent,
} from './branch-trace-stream.js';
import type {
  BranchCoverageReport,
  BranchNode,
  FunctionCoverage,
} from './branch-coverage-types.js';
import { createTrackLogger } from '../log-types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

function silentLogger() {
  return createTrackLogger('agent', { silent: true });
}

function node(
  part: Partial<BranchNode> &
    Pick<BranchNode, 'id' | 'kind' | 'lineStart' | 'lineEnd'>,
): BranchNode {
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

function fn(
  part: Partial<FunctionCoverage> &
    Pick<FunctionCoverage, 'file' | 'name' | 'line' | 'root'>,
): FunctionCoverage {
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

function report(
  part: Partial<BranchCoverageReport> &
    Pick<BranchCoverageReport, 'functions'>,
): BranchCoverageReport {
  return {
    generatedAt: '2026-05-28T00:00:00.000Z',
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
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-stream-'));
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const baseInput = {
  branch_id: 'src/a.ts:f@1:entry-line1-entry#0',
  branch_kind: 'entry',
  branch_label: 'f',
  line_start: 1,
  line_end: 1,
  'code.function': 'f',
  'code.file.path': 'src/a.ts',
  'code.line.number': 1,
} as const;

// ── 1. open() fresh ─────────────────────────────────────────────────────────

describe('BranchTraceStream — basics', () => {
  it('1. open() on fresh dir creates .zerou/ and starts seq=0 / prev_hash=ZERO', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    expect(fs.existsSync(path.join(cwd, '.zerou'))).toBe(true);
    // First append should be seq=1, prev_hash=64 zeros.
    const ev = await s.append({ ...baseInput });
    expect(ev.seq).toBe(1);
    expect(ev.prev_hash).toBe('0'.repeat(64));
    await s.close();
  });

  it('2. open() on existing file resumes seq + prev_hash from tail', async () => {
    const cwd = await tmpdir();
    // First session.
    const s1 = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s1.open();
    const a = await s1.append({ ...baseInput });
    const b = await s1.append({
      ...baseInput,
      branch_id: 'src/a.ts:f@1:if-true-line5-true#1',
    });
    expect(b.seq).toBe(2);
    expect(b.prev_hash).toBe(a.hash);
    await s1.close();

    // Reopen.
    const s2 = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s2.open();
    const c = await s2.append({
      ...baseInput,
      branch_id: 'src/a.ts:f@1:if-false-line6-false#2',
    });
    expect(c.seq).toBe(3);
    expect(c.prev_hash).toBe(b.hash);
    await s2.close();
  });

  it('3. append() emits well-formed event with monotonic seq + hash chain', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    const events: BranchTraceStreamEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(
        await s.append({
          ...baseInput,
          branch_id: `src/a.ts:f@1:b${i}#${i}`,
        }),
      );
    }
    await s.close();
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.prev_hash).toBe(events[i - 1]!.hash);
    }
  });

  it('4. emitTransition(evaluating) produces event with state="evaluating"', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    const root = node({
      id: 'entry',
      kind: 'entry',
      lineStart: 1,
      lineEnd: 1,
      label: 'f',
    });
    const f = fn({ file: 'src/a.ts', name: 'f', line: 1, root });
    const ev = await s.emitTransition(f, root, 'evaluating', { spec_id: 's-1' });
    expect(ev.state).toBe('evaluating');
    expect(ev.spec_id).toBe('s-1');
    expect(ev.verdict).toBe('pending');
    expect(ev.category).toBeUndefined();
    await s.close();
  });

  it('5. emitTransition with retry={attempt:2,max:3} sets retry field', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    const root = node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 });
    const f = fn({ file: 'src/a.ts', name: 'f', line: 1, root });
    const ev = await s.emitTransition(f, root, 'retrying', {
      retry: { attempt: 2, max: 3 },
    });
    expect(ev.state).toBe('retrying');
    expect(ev.retry).toEqual({ attempt: 2, max: 3 });
    await s.close();
  });

  it('6. close() prevents future appends', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    await s.append({ ...baseInput });
    await s.close();
    await expect(s.append({ ...baseInput })).rejects.toThrow(/closed/);
  });

  it('7. indexBranchesByLine groups nodes per file with stable order', () => {
    const r = report({
      functions: [
        fn({
          file: 'src/a.ts',
          name: 'foo',
          line: 1,
          root: node({
            id: 'entry',
            kind: 'entry',
            lineStart: 1,
            lineEnd: 50,
            children: [
              node({ id: 'if-5-true-1', kind: 'if-true', lineStart: 5, lineEnd: 10 }),
              node({ id: 'if-5-false-2', kind: 'if-false', lineStart: 11, lineEnd: 15 }),
            ],
          }),
        }),
        fn({
          file: 'src/b.ts',
          name: 'bar',
          line: 2,
          root: node({ id: 'entry', kind: 'entry', lineStart: 2, lineEnd: 4 }),
        }),
      ],
    });
    const idx = indexBranchesByLine(r);
    expect(idx.size).toBe(2);
    expect(idx.get('src/a.ts')!.length).toBe(3);
    expect(idx.get('src/b.ts')!.length).toBe(1);
    // Entry node has widest range; sort puts widest LAST when lineStart ties
    // are NOT involved. Here entry start=1, if-true start=5 — entry comes first.
    expect(idx.get('src/a.ts')![0]!.node.kind).toBe('entry');
  });

  it('8. findMatchingBranch returns narrowest containing node', () => {
    const inner = node({ id: 'if-5-true-1', kind: 'if-true', lineStart: 5, lineEnd: 10 });
    const r = report({
      functions: [
        fn({
          file: 'src/a.ts',
          name: 'foo',
          line: 1,
          root: node({
            id: 'entry',
            kind: 'entry',
            lineStart: 1,
            lineEnd: 50,
            children: [inner],
          }),
        }),
      ],
    });
    const idx = indexBranchesByLine(r);
    const hit = findMatchingBranch(idx, 'src/a.ts', 7);
    expect(hit).not.toBeNull();
    expect(hit!.node.kind).toBe('if-true');
  });

  it('9. findMatchingBranch returns null when no node contains the line', () => {
    const r = report({
      functions: [
        fn({
          file: 'src/a.ts',
          name: 'foo',
          line: 1,
          root: node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 5 }),
        }),
      ],
    });
    const idx = indexBranchesByLine(r);
    expect(findMatchingBranch(idx, 'src/a.ts', 99)).toBeNull();
    expect(findMatchingBranch(idx, 'src/missing.ts', 1)).toBeNull();
  });

  it('10. deriveStateFromVerdict maps pass / fail / inconclusive', () => {
    expect(deriveStateFromVerdict('pass', undefined, null)).toBe('covered');
    expect(deriveStateFromVerdict('inconclusive', undefined, null)).toBeNull();
    expect(deriveStateFromVerdict('skipped', undefined, null)).toBeNull();
    // fail + auth label → business-red
    expect(
      deriveStateFromVerdict('fail', undefined, {
        node: { kind: 'if-true', label: 'missing auth check' },
      }),
    ).toBe('business-red');
    // fail + catch arm → mechanical-red
    expect(
      deriveStateFromVerdict('fail', undefined, {
        node: { kind: 'catch', label: 'db error' },
      }),
    ).toBe('mechanical-red');
    // fail + sanitize hint → mechanical-red
    expect(
      deriveStateFromVerdict('fail', undefined, {
        node: { kind: 'if-true', label: 'encodeURIComponent missing' },
      }),
    ).toBe('mechanical-red');
    // fail + nothing → default business-red (conservative)
    expect(
      deriveStateFromVerdict('fail', undefined, {
        node: { kind: 'if-true', label: 'something else' },
      }),
    ).toBe('business-red');
  });

  it('11. multiple appends produce a verifiable hash chain on disk', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    for (let i = 0; i < 4; i++) {
      await s.append({ ...baseInput, branch_id: `src/a.ts:f@1:b${i}#${i}` });
    }
    await s.close();
    const text = fs.readFileSync(s.path, 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
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

  it('12. parallel append() calls serialize via internal queue', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        s.append({ ...baseInput, branch_id: `b${i}` }),
      ),
    );
    // seq must be 1..5 in some order (assignment order matches call order
    // through the queue).
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    // Hash chain on disk must still be valid.
    const text = fs.readFileSync(s.path, 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    let prev = '0'.repeat(64);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const { hash, ...rest } = parsed;
      expect(hash).toBe(sha256Hex(JSON.stringify(rest)));
      expect(rest.prev_hash).toBe(prev);
      prev = hash as string;
    }
    await s.close();
  });

  it('13. cross-platform paths: backslashes normalized to POSIX in code.file.path', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    const ev = await s.append({
      ...baseInput,
      'code.file.path': 'src\\nested\\a.ts',
      branch_id: 'src/nested/a.ts:f@1:entry-line1-entry#0',
    });
    expect(ev['code.file.path']).toBe('src/nested/a.ts');
    await s.close();
  });

  it('14. emitTransition(covered) sets verdict=covered and no category', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    const root = node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 });
    const f = fn({ file: 'src/a.ts', name: 'f', line: 1, root });
    const ev = await s.emitTransition(f, root, 'covered');
    expect(ev.verdict).toBe('covered');
    expect(ev.state).toBe('covered');
    expect(ev.category).toBeUndefined();
    await s.close();
  });

  it('15. emitTransition(mechanical-red) carries category=mechanical', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({ cwd, logger: silentLogger() });
    await s.open();
    const root = node({ id: 'entry', kind: 'entry', lineStart: 1, lineEnd: 1 });
    const f = fn({ file: 'src/a.ts', name: 'f', line: 1, root });
    const ev = await s.emitTransition(f, root, 'mechanical-red');
    expect(ev.state).toBe('mechanical-red');
    expect(ev.category).toBe('mechanical');
    await s.close();
  });

  it('16. archive mirror written when runTs supplied', async () => {
    const cwd = await tmpdir();
    const s = new BranchTraceStream({
      cwd,
      runTs: '20260528-000000',
      logger: silentLogger(),
    });
    await s.open();
    await s.append({ ...baseInput });
    await s.close();
    const archived = path.join(
      cwd,
      '.zerou',
      'runs',
      '20260528-000000',
      'branch-trace.jsonl',
    );
    expect(fs.existsSync(archived)).toBe(true);
    expect(fs.readFileSync(archived, 'utf8')).toBe(
      fs.readFileSync(s.path, 'utf8'),
    );
  });
});
