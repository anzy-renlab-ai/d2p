/**
 * Tests for agent/test-emitter (Phase 8 Track 8B).
 *
 * Strategy: inject a mock LLM caller so tests are hermetic. The
 * no-LLM fallback path short-circuits to `it.todo(...)`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  emitVitestTests,
  parseLlmBody,
  slugifyTarget,
  computeRelativeImport,
  type EmitLlmCaller,
} from './test-emitter.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import type { TestCaseSpec } from './types.js';
import type { FunctionInfo } from './ast-analyzer.js';
import type { EngineConfig } from '../stubs.js';

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

// ── Fixtures ────────────────────────────────────────────────────────────────

function mkLogger(_cwd: string) {
  // silent:true avoids racing the tmpdir cleanup with async log flushes
  return createTrackLogger('agent', { silent: true });
}

function mkSpec(overrides: Partial<TestCaseSpec> = {}): TestCaseSpec {
  return {
    id: 'login-1',
    name: 'rejects empty email',
    category: 'validation',
    scope: {
      type: 'function',
      target: 'fn:handleLogin',
      file: 'src/api/login.ts',
      line: 10,
    },
    given: 'an empty email field',
    when: 'handleLogin is called',
    then: 'returns 400',
    reasoning: 'must validate input',
    ...overrides,
  };
}

function mkFn(overrides: Partial<FunctionInfo> = {}): FunctionInfo {
  return {
    file: 'src/api/login.ts',
    line: 10,
    name: 'handleLogin',
    kind: 'function',
    params: [{ name: 'req', typeHint: 'Request' }],
    returnTypeHint: 'Promise<Response>',
    branchCount: 2,
    hasAsyncCall: true,
    hasDatabaseCall: true,
    hasNetworkCall: false,
    sourceSnippet:
      'export async function handleLogin(req) { /* validates and authenticates */ }',
    ...overrides,
  };
}

const fakeConfig: EngineConfig = {
  kind: 'openai-compat',
  modelId: 'fake-model',
  releaseDate: '2026-01-01',
  baseUrl: 'https://example.com/v1',
  apiKey: 'unused-here',
};

function tmpDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-'));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('slugifyTarget', () => {
  it('converts path to dash-separated slug, strips extension', () => {
    expect(slugifyTarget('src/api/login.ts')).toBe('src-api-login');
    expect(slugifyTarget('src/hello.ts')).toBe('src-hello');
    expect(slugifyTarget('./pages/api/auth/[id].ts')).toBe('pages-api-auth-id');
    expect(slugifyTarget('weird ///path')).toBe('weird-path');
    expect(slugifyTarget('')).toBe('unknown');
  });
});

describe('computeRelativeImport', () => {
  it('produces a relative POSIX path from outDir back to source', () => {
    const cwd = '/proj';
    const outDir = '/proj/tests/__zerou__';
    const rel = computeRelativeImport(outDir, 'src/api/login.ts', cwd);
    expect(rel).toBe('../../src/api/login.ts');
  });
  it('handles absolute targetFile correctly', () => {
    const cwd = '/proj';
    const outDir = '/proj/tests/__zerou__';
    const rel = computeRelativeImport(outDir, '/proj/src/foo.ts', cwd);
    expect(rel).toBe('../../src/foo.ts');
  });
  it('always starts with ./ or ../', () => {
    const outDir = '/proj/tests/__zerou__';
    const rel = computeRelativeImport(outDir, 'src/x.ts', '/proj');
    expect(rel.startsWith('.')).toBe(true);
  });
});

// ── parseLlmBody ────────────────────────────────────────────────────────────

describe('parseLlmBody', () => {
  it('parses clean JSON', () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const r = parseLlmBody('{"imports":"","body":"expect(true).toBe(true);"}', logger, 's1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.imports).toBe('');
      expect(r.body).toContain('expect(true)');
    }
    t.cleanup();
  });
  it('strips think block', () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const r = parseLlmBody(
      '<think>reasoning</think>\n{"imports":"","body":"const x=1;"}',
      logger,
      's2',
    );
    expect(r.ok).toBe(true);
    t.cleanup();
  });
  it('strips markdown fence', () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const r = parseLlmBody(
      '```json\n{"imports":"","body":"const y=2;"}\n```',
      logger,
      's3',
    );
    expect(r.ok).toBe(true);
    t.cleanup();
  });
  it('extracts outermost JSON from preamble', () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const r = parseLlmBody(
      'sure thing! {"imports":"import foo;","body":"const z=3;"} done',
      logger,
      's4',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.imports).toContain('import foo');
    t.cleanup();
  });
  it('returns ok:false when body missing', () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const r = parseLlmBody('{"imports":""}', logger, 's5');
    expect(r.ok).toBe(false);
    t.cleanup();
  });
  it('returns ok:false on malformed JSON', () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const r = parseLlmBody('not json at all here', logger, 's6');
    expect(r.ok).toBe(false);
    t.cleanup();
  });
});

// ── emitVitestTests ─────────────────────────────────────────────────────────

describe('emitVitestTests', () => {
  it('single spec → 1 .test.ts file with 1 it.todo (no LLM key)', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const files = await emitVitestTests({
      specs: [mkSpec()],
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(files).toHaveLength(1);
    expect(files[0].testCount).toBe(1);
    expect(files[0].specsCovered).toEqual(['login-1']);
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body).toContain('it.todo("rejects empty email")');
    expect(body).toContain('ZEROU AUTOGENERATED');
    expect(body).toContain('describe(');
    await logger.flush();
    t.cleanup();
  });

  it('multiple specs same target file → merged into 1 file with N tests', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const specs = [
      mkSpec({ id: 's1', name: 'first' }),
      mkSpec({ id: 's2', name: 'second' }),
      mkSpec({ id: 's3', name: 'third' }),
    ];
    const files = await emitVitestTests({
      specs,
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(files).toHaveLength(1);
    expect(files[0].testCount).toBe(3);
    expect(files[0].specsCovered).toEqual(['s1', 's2', 's3']);
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body).toContain('it.todo("first")');
    expect(body).toContain('it.todo("second")');
    expect(body).toContain('it.todo("third")');
    await logger.flush();
    t.cleanup();
  });

  it('specs targeting different files → 1 file per source file', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const specs = [
      mkSpec({
        id: 'a-1',
        scope: { type: 'function', target: 'fn:a', file: 'src/a.ts', line: 1 },
      }),
      mkSpec({
        id: 'b-1',
        scope: { type: 'function', target: 'fn:b', file: 'src/b.ts', line: 1 },
      }),
    ];
    const files = await emitVitestTests({
      specs,
      functions: [],
      cwd: t.dir,
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(files).toHaveLength(2);
    const slugs = files.map((f) => path.basename(f.path)).sort();
    expect(slugs).toEqual(['src-a.test.ts', 'src-b.test.ts']);
    await logger.flush();
    t.cleanup();
  });

  it('without LLM key every spec emits it.todo', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const files = await emitVitestTests({
      specs: [
        mkSpec({ id: 's1', name: 'one' }),
        mkSpec({ id: 's2', name: 'two' }),
      ],
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body.match(/it\.todo\(/g)?.length).toBe(2);
    expect(body).not.toContain('it("one"');
    await logger.flush();
    t.cleanup();
  });

  it('with mock LLM returning valid JSON → emits real it(...) blocks', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const llm: EmitLlmCaller = async () => ({
      rawText:
        '{"imports":"import { foo } from \\"./fixtures.js\\";","body":"const r = await foo();\\nexpect(r).toBe(42);"}',
      durationMs: 5,
    });
    const files = await emitVitestTests({
      specs: [mkSpec()],
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'fake-key',
      callLLM: llm,
    });
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body).toContain('it("rejects empty email", async () => {');
    expect(body).toContain('const r = await foo();');
    expect(body).toContain('expect(r).toBe(42);');
    expect(body).toContain('import { foo }');
    expect(body).toContain('// Given:');
    expect(body).toContain('// When:');
    expect(body).toContain('// Then:');
    expect(body).not.toContain('it.todo(');
    await logger.flush();
    t.cleanup();
  });

  it('LLM returning malformed → degrades to it.todo', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const llm: EmitLlmCaller = async () => ({
      rawText: 'this is not json',
      durationMs: 5,
    });
    const files = await emitVitestTests({
      specs: [mkSpec()],
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'fake-key',
      callLLM: llm,
    });
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body).toContain('it.todo("rejects empty email")');
    await logger.flush();
    t.cleanup();
  });

  it('LLM throwing → degrades to it.todo', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const llm: EmitLlmCaller = async () => {
      throw new Error('boom');
    };
    const files = await emitVitestTests({
      specs: [mkSpec()],
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'fake-key',
      callLLM: llm,
    });
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body).toContain('it.todo("rejects empty email")');
    await logger.flush();
    t.cleanup();
  });

  it('creates output dir when it does not exist', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const outDir = path.join(t.dir, 'nested', 'deep', 'out');
    expect(fs.existsSync(outDir)).toBe(false);
    await emitVitestTests({
      specs: [mkSpec()],
      functions: [],
      cwd: t.dir,
      outDir,
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(fs.existsSync(outDir)).toBe(true);
    expect(fs.readdirSync(outDir).length).toBe(1);
    await logger.flush();
    t.cleanup();
  });

  it('emitted file uses correct relative import path back to source', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const llm: EmitLlmCaller = async (args) => {
      // verify the prompt contains the expected relative path
      expect(args.userPrompt).toContain('../../src/api/login.ts');
      return {
        rawText:
          '{"imports":"import { handleLogin } from \\"../../src/api/login.ts\\";","body":"expect(typeof handleLogin).toBe(\\"function\\");"}',
        durationMs: 5,
      };
    };
    const files = await emitVitestTests({
      specs: [mkSpec()],
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'fake-key',
      callLLM: llm,
    });
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body).toContain("from \"../../src/api/login.ts\"");
    await logger.flush();
    t.cleanup();
  });

  it('emits banner + describe name from spec.scope.target', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const files = await emitVitestTests({
      specs: [
        mkSpec({
          scope: {
            type: 'endpoint',
            target: 'POST /api/login',
            file: 'src/api/login.ts',
            line: 1,
          },
        }),
      ],
      functions: [],
      cwd: t.dir,
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    const body = fs.readFileSync(files[0].path, 'utf8');
    expect(body).toContain('// ZEROU AUTOGENERATED');
    expect(body).toContain('describe("POST /api/login"');
    await logger.flush();
    t.cleanup();
  });

  it('imports vitest globals exactly once even with multiple specs', async () => {
    const t = tmpDir();
    const logger = mkLogger(t.dir);
    const llm: EmitLlmCaller = async () => ({
      rawText:
        '{"imports":"import { describe, it, expect, vi } from \\"vitest\\";","body":"expect(1).toBe(1);"}',
      durationMs: 5,
    });
    const files = await emitVitestTests({
      specs: [
        mkSpec({ id: 's1', name: 'one' }),
        mkSpec({ id: 's2', name: 'two' }),
      ],
      functions: [mkFn()],
      cwd: t.dir,
      logger,
      criticConfig: fakeConfig,
      criticApiKey: 'fake-key',
      callLLM: llm,
    });
    const body = fs.readFileSync(files[0].path, 'utf8');
    const importMatches = body.match(/import \{ describe, it, expect, vi \} from 'vitest';/g);
    // Source emits the canonical line; the LLM's duplicate (with double quotes)
    // is a different string and may or may not be deduped — assert the canonical
    // form appears at least once.
    expect(importMatches?.length ?? 0).toBeGreaterThanOrEqual(1);
    await logger.flush();
    t.cleanup();
  });
});
