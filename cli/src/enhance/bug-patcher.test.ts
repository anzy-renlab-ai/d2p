/**
 * Tests for enhance/bug-patcher.
 *
 * Strategy:
 *  - Mock the LLM via the `callLLM` seam (PatchLlmFn).
 *  - Mock tsc via the `runTscFn` seam so we never spawn a real subprocess.
 *  - Use `captureLogsFor` to assert structured log emission.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { patchBugs, parseUnifiedDiff, applyHunks } from './bug-patcher.js';
import type { TscRunner } from './bug-patcher.js';
import type { AuditFinding, PatchLlmFn } from './types.js';
import type { EngineConfig } from '../stubs.js';
import {
  createTrackLogger,
  captureLogsFor,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});
afterEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const fakeCfg: EngineConfig = {
  kind: 'openai-compat',
  modelId: 'fake-model',
  releaseDate: '2026-01-01',
  baseUrl: 'https://example.com/v1',
  apiKey: 'unused',
};

function withTempDir(): { cwd: string; cleanup: () => void } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-patcher-'));
  return {
    cwd,
    cleanup: () => {
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function writeFile(cwd: string, rel: string, content: string): string {
  const abs = path.join(cwd, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

function makeFinding(o: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: 'f-1',
    file: 'src/handler.ts',
    line: 3,
    severity: 'P2',
    category: 'db-injection',
    message: 'unsafe user input concatenated into URL',
    expectedBehavior: 'wrap user input with encodeURIComponent',
    actualBehavior: 'raw user input passed through',
    ...o,
  };
}

const tscOk: TscRunner = () => ({ ok: true });
const tscFail: TscRunner = () => ({ ok: false, firstError: "error TS2304: cannot find name 'foo'" });

function mockLlm(raw: string): PatchLlmFn {
  return async () => ({ ok: true, rawText: raw });
}

function silentLogger() {
  return createTrackLogger('agent', { silent: true });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseUnifiedDiff', () => {
  it('parses a minimal valid diff', () => {
    const diff = [
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,2 +1,2 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
    ].join('\n');
    const r = parseUnifiedDiff(diff);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.targetPath).toBe('src/x.ts');
      expect(r.hunks).toHaveLength(1);
      expect(r.hunks[0]!.oldStart).toBe(1);
    }
  });

  it('rejects missing headers', () => {
    const r = parseUnifiedDiff('@@ -1,1 +1,1 @@\n a');
    expect(r.ok).toBe(false);
  });

  it('rejects bad hunk counts', () => {
    const diff = [
      '--- a/x',
      '+++ b/x',
      '@@ -1,5 +1,5 @@',
      ' line',
    ].join('\n');
    const r = parseUnifiedDiff(diff);
    expect(r.ok).toBe(false);
  });
});

describe('applyHunks', () => {
  it('replaces a single line', () => {
    const original = 'a\nb\nc\n';
    const parsed = parseUnifiedDiff(
      [
        '--- a/x',
        '+++ b/x',
        '@@ -2,1 +2,1 @@',
        '-b',
        '+B',
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = applyHunks(original, parsed.hunks);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content.split('\n')).toEqual(['a', 'B', 'c', '']);
  });

  it('fails on context mismatch', () => {
    const original = 'a\nb\nc\n';
    const parsed = parseUnifiedDiff(
      [
        '--- a/x',
        '+++ b/x',
        '@@ -2,1 +2,1 @@',
        '-WRONG',
        '+B',
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = applyHunks(original, parsed.hunks);
    expect(r.ok).toBe(false);
  });
});

describe('patchBugs — skips', () => {
  it('skips P3 findings', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      const f = makeFinding({ severity: 'P3' });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(''),
        runTscFn: tscOk,
      });
      expect(res).toHaveLength(1);
      expect(res[0]!.status).toBe('skipped');
      expect(res[0]!.reason).toMatch(/p3/);
    } finally {
      cleanup();
    }
  });

  it('skips secrets-leak category (refuse to auto-patch)', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      const f = makeFinding({ category: 'secrets-leak' });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(''),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('skipped');
      expect(res[0]!.reason).toMatch(/secrets/);
    } finally {
      cleanup();
    }
  });

  it('skips unknown category as not-mechanical-v1', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      const f = makeFinding({
        category: 'mystery-bug',
        expectedBehavior: 'do something nice',
      });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(''),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('skipped');
      expect(res[0]!.reason).toMatch(/not-mechanical/);
    } finally {
      cleanup();
    }
  });

  it('returns empty array on empty findings', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      const res = await patchBugs({
        cwd,
        findings: [],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(''),
        runTscFn: tscOk,
      });
      expect(res).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('all-P3 findings → every result is skipped', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      const findings: AuditFinding[] = [
        makeFinding({ id: 'a', severity: 'P3' }),
        makeFinding({ id: 'b', severity: 'P3' }),
        makeFinding({ id: 'c', severity: 'P3' }),
      ];
      const res = await patchBugs({
        cwd,
        findings,
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(''),
        runTscFn: tscOk,
      });
      expect(res.every((r) => r.status === 'skipped')).toBe(true);
      expect(res).toHaveLength(3);
    } finally {
      cleanup();
    }
  });
});

describe('patchBugs — happy path + safety rails', () => {
  it('applies a valid diff when tsc passes', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      const original = [
        'export function handler(req: any) {',
        '  const id = req.query.id;',
        '  return `/x?id=${id}`;',
        '}',
      ].join('\n');
      const abs = writeFile(cwd, 'src/handler.ts', original);

      const diff = [
        '--- a/src/handler.ts',
        '+++ b/src/handler.ts',
        '@@ -3,1 +3,1 @@',
        '-  return `/x?id=${id}`;',
        '+  return `/x?id=${encodeURIComponent(id)}`;',
      ].join('\n');

      const f = makeFinding({ line: 3 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(diff),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('applied');
      const after = fs.readFileSync(abs, 'utf8');
      expect(after).toContain('encodeURIComponent(id)');
    } finally {
      cleanup();
    }
  });

  it('rolls back when tsc fails', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      const original = [
        'export function handler(req: any) {',
        '  const id = req.query.id;',
        '  return `/x?id=${id}`;',
        '}',
      ].join('\n');
      const abs = writeFile(cwd, 'src/handler.ts', original);

      const diff = [
        '--- a/src/handler.ts',
        '+++ b/src/handler.ts',
        '@@ -3,1 +3,1 @@',
        '-  return `/x?id=${id}`;',
        '+  return `/x?id=${encodeURIComponent(id)}`;',
      ].join('\n');

      const f = makeFinding({ line: 3 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(diff),
        runTscFn: tscFail,
      });
      expect(res[0]!.status).toBe('failed');
      expect(res[0]!.reason).toMatch(/tsc-failed/);
      // file restored
      const after = fs.readFileSync(abs, 'utf8');
      expect(after).toBe(original);
    } finally {
      cleanup();
    }
  });

  it('rejects malformed LLM output', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'const x = 1;\nconst y = 2;\nconst z = 3;\n');
      const f = makeFinding({ line: 2 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm('here is some prose, not a diff at all'),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('failed');
      expect(res[0]!.reason).toMatch(/malformed/);
    } finally {
      cleanup();
    }
  });

  it('rejects a diff targeting a different file', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'a\nb\nc\n');
      const diff = [
        '--- a/src/OTHER.ts',
        '+++ b/src/OTHER.ts',
        '@@ -1,1 +1,1 @@',
        '-a',
        '+A',
      ].join('\n');
      const f = makeFinding({ line: 1 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(diff),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('failed');
      expect(res[0]!.reason).toMatch(/cross-file/);
    } finally {
      cleanup();
    }
  });

  it('rejects oversize diffs (>4000 chars)', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'a\nb\nc\n');
      // build a diff larger than 4000 chars (still valid-looking header)
      const filler = 'x'.repeat(5000);
      const diff = [
        '--- a/src/handler.ts',
        '+++ b/src/handler.ts',
        '@@ -1,1 +1,1 @@',
        '-a',
        '+' + filler,
      ].join('\n');
      const f = makeFinding({ line: 1 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(diff),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('failed');
      expect(res[0]!.reason).toMatch(/oversize/);
    } finally {
      cleanup();
    }
  });

  it('LLM throws → finding fails but batch continues', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'a\nb\nc\n');
      const original2 = 'x = 1;\nx = 2;\n';
      const abs2 = writeFile(cwd, 'src/other.ts', original2);

      const goodDiff = [
        '--- a/src/other.ts',
        '+++ b/src/other.ts',
        '@@ -2,1 +2,1 @@',
        '-x = 2;',
        '+x = 42;',
      ].join('\n');

      let callCount = 0;
      const llm: PatchLlmFn = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('upstream network kaput');
        }
        return { ok: true, rawText: goodDiff };
      };

      const findings: AuditFinding[] = [
        makeFinding({ id: 'first', file: 'src/handler.ts', line: 2 }),
        makeFinding({ id: 'second', file: 'src/other.ts', line: 2 }),
      ];
      const res = await patchBugs({
        cwd,
        findings,
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: llm,
        runTscFn: tscOk,
      });
      expect(res).toHaveLength(2);
      expect(res[0]!.status).toBe('failed');
      expect(res[0]!.reason).toMatch(/llm-error/);
      expect(res[1]!.status).toBe('applied');
      expect(fs.readFileSync(abs2, 'utf8')).toContain('x = 42;');
    } finally {
      cleanup();
    }
  });

  it('idempotent: second run on already-patched file → skipped with already-patched', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      // already contains encodeURIComponent — should be idempotently skipped
      const already = [
        'export function handler(req: any) {',
        '  const id = req.query.id;',
        '  return `/x?id=${encodeURIComponent(id)}`;',
        '}',
      ].join('\n');
      writeFile(cwd, 'src/handler.ts', already);
      const f = makeFinding({ line: 3 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(''), // would normally throw on parse — but should not be called
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('skipped');
      expect(res[0]!.reason).toBe('already-patched');
    } finally {
      cleanup();
    }
  });

  it('emits enhance.bug.patcher.* log events', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'a\nb\nc\n');
      const f = makeFinding({ line: 2 });
      const goodDiff = [
        '--- a/src/handler.ts',
        '+++ b/src/handler.ts',
        '@@ -2,1 +2,1 @@',
        '-b',
        '+B',
      ].join('\n');

      const { entries } = await captureLogsFor(
        { track: 'agent', eventPattern: /^enhance\.bug\.patcher\./ },
        async () => {
          const logger = createTrackLogger('agent', { silent: true, minLevel: 'debug' });
          return patchBugs({
            cwd,
            findings: [f],
            criticConfig: fakeCfg,
            criticApiKey: 'k',
            logger,
            callLLM: mockLlm(goodDiff),
            runTscFn: tscOk,
          });
        },
      );
      const events = entries.map((e) => e.event);
      expect(events).toContain('enhance.bug.patcher.start');
      expect(events).toContain('enhance.bug.patcher.finding.start');
      expect(events).toContain('enhance.bug.patcher.finding.llm-call');
      expect(events).toContain('enhance.bug.patcher.finding.diff-parsed');
      expect(events).toContain('enhance.bug.patcher.finding.applied');
      expect(events).toContain('enhance.bug.patcher.complete');
    } finally {
      cleanup();
    }
  });

  it('callLLM seam is invoked with the right shape', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'a\nb\nc\n');
      const seenArgs: Array<Parameters<PatchLlmFn>[0]> = [];
      const llm: PatchLlmFn = async (args) => {
        seenArgs.push(args);
        return {
          ok: true,
          rawText: [
            '--- a/src/handler.ts',
            '+++ b/src/handler.ts',
            '@@ -2,1 +2,1 @@',
            '-b',
            '+B',
          ].join('\n'),
        };
      };
      const f = makeFinding({ line: 2 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'sekret',
        logger: silentLogger(),
        callLLM: llm,
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('applied');
      expect(seenArgs).toHaveLength(1);
      expect(seenArgs[0]!.cfg.modelId).toBe('fake-model');
      expect(seenArgs[0]!.apiKey).toBe('sekret');
      expect(seenArgs[0]!.systemPrompt.length).toBeGreaterThan(0);
      expect(seenArgs[0]!.userPrompt).toContain('src/handler.ts');
    } finally {
      cleanup();
    }
  });

  it('strips <think> blocks and markdown fences before parsing', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'a\nb\nc\n');
      const wrapped = [
        '<think>let me consider the bug</think>',
        '```diff',
        '--- a/src/handler.ts',
        '+++ b/src/handler.ts',
        '@@ -2,1 +2,1 @@',
        '-b',
        '+B',
        '```',
      ].join('\n');
      const f = makeFinding({ line: 2 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: fakeCfg,
        criticApiKey: 'k',
        logger: silentLogger(),
        callLLM: mockLlm(wrapped),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('applied');
    } finally {
      cleanup();
    }
  });

  it('no critic config → finding fails with no-critic-llm', async () => {
    const { cwd, cleanup } = withTempDir();
    try {
      writeFile(cwd, 'src/handler.ts', 'a\nb\nc\n');
      const f = makeFinding({ line: 2 });
      const res = await patchBugs({
        cwd,
        findings: [f],
        criticConfig: null,
        criticApiKey: null,
        logger: silentLogger(),
        runTscFn: tscOk,
      });
      expect(res[0]!.status).toBe('failed');
      expect(res[0]!.reason).toMatch(/no-critic-llm/);
    } finally {
      cleanup();
    }
  });
});
