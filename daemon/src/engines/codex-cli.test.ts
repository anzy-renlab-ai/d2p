import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodexCliEngine, __setRunnerForTests } from './codex-cli.js';
import type { SpawnResult, SpawnOpts } from '../subproc/spawn.js';

interface CapturedCall {
  opts: SpawnOpts;
}

function makeResult(over: Partial<SpawnResult>): SpawnResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    durationMs: 1,
    timedOut: false,
    spawnError: null,
    ...over,
  };
}

let captured: CapturedCall[] = [];
let nextResult: SpawnResult = makeResult({});

function installRunner(): void {
  __setRunnerForTests(async (opts) => {
    captured.push({ opts });
    return nextResult;
  });
}

beforeEach(() => {
  captured = [];
  nextResult = makeResult({});
  installRunner();
});

afterEach(() => {
  __setRunnerForTests(null);
});

describe('CodexCliEngine', () => {
  it('happy path: parses JSON stdout + emits usage', async () => {
    nextResult = makeResult({ stdout: '{"verdict":"PASS"}\n' });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({ role: 'alignment', model: 'sonnet', prompt: 'check this' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.json).toEqual({ verdict: 'PASS' });
      expect(r.usage.inputTokens).toBe(0);
      expect(r.usage.outputTokens).toBe(0);
    }
    expect(captured).toHaveLength(1);
    const args = captured[0]!.opts.args;
    expect(args[0]).toBe('exec');
    expect(args).toContain('--model');
    // prompt is the last positional argv element
    expect(args[args.length - 1]).toBe('check this');
  });

  it('non-zero exit surfaces NON_ZERO_EXIT with stderr snippet', async () => {
    nextResult = makeResult({ exitCode: 2, stderr: 'boom: schema mismatch' });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({ role: 'differ', model: 'sonnet', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NON_ZERO_EXIT');
      expect(r.message).toMatch(/exit 2/);
      expect(r.message).toMatch(/boom/);
    }
  });

  it('stderr with auth hint flags it in the error message', async () => {
    // Use stderr that triggers looksLikeAuthError regex (matches
    // `auth(entication)?\s+(failed|required|error)`) but does NOT itself
    // contain the asserted hint substrings — so the test genuinely verifies
    // hint injection fires.
    nextResult = makeResult({
      exitCode: 1,
      stderr: 'authentication failed',
    });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({ role: 'detector', model: 'haiku', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NON_ZERO_EXIT');
      // Hint injection path: looksLikeAuthError → ' (auth check failed; run `codex login`)'
      expect(r.message).toMatch(/auth check failed/);
      expect(r.message).toMatch(/codex login/);
    }
  });

  it('non-auth stderr does NOT inject hint (negative path)', async () => {
    nextResult = makeResult({
      exitCode: 1,
      stderr: 'segfault at 0xdeadbeef',
    });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({ role: 'detector', model: 'haiku', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toMatch(/auth check failed/);
    }
  });

  it('timeout surfaces TIMEOUT code', async () => {
    nextResult = makeResult({ timedOut: true, exitCode: null, stdout: 'partial' });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({
      role: 'behavioral',
      model: 'sonnet',
      prompt: 'p',
      timeoutMs: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('TIMEOUT');
      expect(r.message).toMatch(/timed out after 10ms/);
    }
  });

  it('non-JSON stdout surfaces NON_JSON', async () => {
    nextResult = makeResult({ stdout: 'just a chatty model talking, no json here' });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({ role: 'vision', model: 'sonnet', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NON_JSON');
    }
  });

  it('model routing: maps d2p tier through config.models', async () => {
    nextResult = makeResult({ stdout: '{"k":1}' });
    const eng = new CodexCliEngine({
      kind: 'codex-cli',
      models: { haiku: 'codex-tiny', sonnet: 'codex-mid', opus: 'codex-big' },
    });
    await eng.call({ role: 'detector', model: 'haiku', prompt: 'p' });
    await eng.call({ role: 'differ', model: 'sonnet', prompt: 'p' });
    await eng.call({ role: 'implementer', model: 'opus', prompt: 'p' });
    expect(captured).toHaveLength(3);
    // --model is followed by the resolved id
    const modelOf = (c: CapturedCall): string | undefined => {
      const i = c.opts.args.indexOf('--model');
      return i >= 0 ? c.opts.args[i + 1] : undefined;
    };
    expect(modelOf(captured[0]!)).toBe('codex-tiny');
    expect(modelOf(captured[1]!)).toBe('codex-mid');
    expect(modelOf(captured[2]!)).toBe('codex-big');
  });

  it('ENOENT spawnError surfaces CLAUDE_NOT_FOUND (binary missing)', async () => {
    nextResult = makeResult({ spawnError: 'spawn codex ENOENT', exitCode: null });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({ role: 'detector', model: 'haiku', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('CLAUDE_NOT_FOUND');
      expect(r.message).toMatch(/ENOENT/);
    }
  });

  it('schemaCheck failure surfaces SCHEMA code', async () => {
    nextResult = makeResult({ stdout: '{"unexpected":true}' });
    const eng = new CodexCliEngine({ kind: 'codex-cli' });
    const r = await eng.call({
      role: 'alignment',
      model: 'sonnet',
      prompt: 'p',
      schemaCheck: (j): j is { verdict: string } =>
        typeof j === 'object' && j !== null && 'verdict' in j,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SCHEMA');
  });
});
