import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GeminiCliEngine, __setRunnerForTests } from './gemini-cli.js';
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

describe('GeminiCliEngine', () => {
  it('happy path: parses JSON stdout + emits usage', async () => {
    nextResult = makeResult({ stdout: '{"verdict":"PASS"}\n' });
    const eng = new GeminiCliEngine({ kind: 'gemini-cli' });
    const r = await eng.call({ role: 'alignment', model: 'sonnet', prompt: 'check' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.json).toEqual({ verdict: 'PASS' });
      expect(r.usage.inputTokens).toBe(0);
      expect(r.usage.outputTokens).toBe(0);
    }
    expect(captured).toHaveLength(1);
    const args = captured[0]!.opts.args;
    expect(args).toContain('-p');
    expect(args).toContain('--model');
    // -p is immediately followed by the prompt
    const pIdx = args.indexOf('-p');
    expect(args[pIdx + 1]).toBe('check');
  });

  it('non-zero exit surfaces NON_ZERO_EXIT with stderr snippet', async () => {
    nextResult = makeResult({ exitCode: 3, stderr: 'gemini: invalid argument' });
    const eng = new GeminiCliEngine({ kind: 'gemini-cli' });
    const r = await eng.call({ role: 'differ', model: 'sonnet', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NON_ZERO_EXIT');
      expect(r.message).toMatch(/exit 3/);
      expect(r.message).toMatch(/invalid argument/);
    }
  });

  it('stderr with auth hint flags it in the error message', async () => {
    nextResult = makeResult({
      exitCode: 1,
      stderr: 'Error: GEMINI_API_KEY not set; please authenticate.',
    });
    const eng = new GeminiCliEngine({ kind: 'gemini-cli' });
    const r = await eng.call({ role: 'detector', model: 'haiku', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NON_ZERO_EXIT');
      expect(r.message).toMatch(/GEMINI_API_KEY|gemini auth/);
    }
  });

  it('timeout surfaces TIMEOUT code', async () => {
    nextResult = makeResult({ timedOut: true, exitCode: null, stdout: 'partial' });
    const eng = new GeminiCliEngine({ kind: 'gemini-cli' });
    const r = await eng.call({
      role: 'behavioral',
      model: 'sonnet',
      prompt: 'p',
      timeoutMs: 25,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('TIMEOUT');
      expect(r.message).toMatch(/timed out after 25ms/);
    }
  });

  it('non-JSON stdout surfaces NON_JSON', async () => {
    nextResult = makeResult({ stdout: 'plain prose, no json' });
    const eng = new GeminiCliEngine({ kind: 'gemini-cli' });
    const r = await eng.call({ role: 'vision', model: 'sonnet', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NON_JSON');
    }
  });

  it('model routing: maps d2p tier through config.models', async () => {
    nextResult = makeResult({ stdout: '{"k":1}' });
    const eng = new GeminiCliEngine({
      kind: 'gemini-cli',
      models: { haiku: 'gem-flash', sonnet: 'gem-pro', opus: 'gem-ultra' },
    });
    await eng.call({ role: 'detector', model: 'haiku', prompt: 'p' });
    await eng.call({ role: 'differ', model: 'sonnet', prompt: 'p' });
    await eng.call({ role: 'implementer', model: 'opus', prompt: 'p' });
    expect(captured).toHaveLength(3);
    const modelOf = (c: CapturedCall): string | undefined => {
      const i = c.opts.args.indexOf('--model');
      return i >= 0 ? c.opts.args[i + 1] : undefined;
    };
    expect(modelOf(captured[0]!)).toBe('gem-flash');
    expect(modelOf(captured[1]!)).toBe('gem-pro');
    expect(modelOf(captured[2]!)).toBe('gem-ultra');
  });

  it('ENOENT spawnError surfaces CLAUDE_NOT_FOUND (binary missing)', async () => {
    nextResult = makeResult({ spawnError: 'spawn gemini ENOENT', exitCode: null });
    const eng = new GeminiCliEngine({ kind: 'gemini-cli' });
    const r = await eng.call({ role: 'detector', model: 'haiku', prompt: 'p' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('CLAUDE_NOT_FOUND');
      expect(r.message).toMatch(/ENOENT/);
    }
  });

  it('schemaCheck failure surfaces SCHEMA code', async () => {
    nextResult = makeResult({ stdout: '{"unexpected":true}' });
    const eng = new GeminiCliEngine({ kind: 'gemini-cli' });
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
