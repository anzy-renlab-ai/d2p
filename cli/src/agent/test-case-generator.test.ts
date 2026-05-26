/**
 * Tests for the Test Case Generator (Phase 5 / Track E).
 *
 * Covers:
 *  - target extraction: Express, Next.js App Router, Next.js Pages Router,
 *    plain functions in handler dirs
 *  - LLM path happy / malformed response / no-key fallback
 *  - empty cwd → []
 *  - per-target fallback when LLM call fails
 *  - log events emitted under `agent.test-gen.*`
 *
 * All filesystem state lives under os.tmpdir().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  generateTestCases,
  extractAllTargets,
  type TestGenLlmFn,
} from './test-case-generator.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type LogEntry,
  type TrackLogger,
} from '../log-types.js';
import type { EngineConfig } from '../stubs.js';
import type { ProjectProfile } from './types.js';
import { readLogsUnder } from '../__fixtures__/helpers.js';

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-testgen-'));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
}

function makeLogger(cwd: string): TrackLogger {
  return createTrackLogger('agent', { logRoot: path.join(cwd, '.zerou', 'logs') });
}

function readAgentLog(cwd: string): LogEntry[] {
  const all = readLogsUnder(cwd);
  const entries: LogEntry[] = [];
  for (const [key, v] of all) {
    if (key.startsWith('agent/')) entries.push(...v);
  }
  return entries;
}

const baseProfile: ProjectProfile = {
  framework: 'next.js',
  backend: null,
  language: ['typescript'],
  hasGit: false,
  hasTests: false,
  hasEnvFile: false,
  packageMgr: null,
  evidence: {},
};

const fakeCriticConfig: EngineConfig = {
  kind: 'openai-compat',
  modelId: 'fake-model',
  releaseDate: '2026-01-01',
  baseUrl: 'http://invalid.local',
};

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

// ── Target extraction ───────────────────────────────────────────────────────

describe('extractAllTargets — Express style', () => {
  it('extracts app.post route from src/server.ts', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'src/server.ts',
        [
          `import express from 'express';`,
          `const app = express();`,
          `app.post('/api/login', async (req, res) => {`,
          `  const { email } = req.body;`,
          `  if (!email) return res.status(400).json({error:'email required'});`,
          `  res.json({ok:true});`,
          `});`,
        ].join('\n'),
      );
      const targets = extractAllTargets(cwd);
      expect(targets.length).toBeGreaterThanOrEqual(1);
      const ep = targets.find((t) => t.name === 'POST /api/login');
      expect(ep).toBeTruthy();
      expect(ep?.type).toBe('endpoint');
      expect(ep?.file).toBe('src/server.ts');
      expect(ep?.line).toBeGreaterThan(0);
      expect(ep?.signaturePreview).toContain('/api/login');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('extracts multiple router verbs from src/routes/users.ts', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'src/routes/users.ts',
        [
          `const router = makeRouter();`,
          `router.get('/users', list);`,
          `router.post('/users', create);`,
          `router.delete('/users/:id', remove);`,
          `export default router;`,
        ].join('\n'),
      );
      const targets = extractAllTargets(cwd);
      const names = targets.map((t) => t.name).sort();
      expect(names).toContain('GET /users');
      expect(names).toContain('POST /users');
      expect(names).toContain('DELETE /users/:id');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('extractAllTargets — Next.js App Router', () => {
  it('extracts GET+POST from app/api/login/route.ts', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/api/login/route.ts',
        [
          `export async function POST(req: Request) {`,
          `  const { email } = await req.json();`,
          `  if (!email) return Response.json({error:'email'}, { status: 400 });`,
          `  return Response.json({token:'x'});`,
          `}`,
          `export async function GET() {`,
          `  return Response.json({ok:true});`,
          `}`,
        ].join('\n'),
      );
      const targets = extractAllTargets(cwd);
      const names = targets.map((t) => t.name).sort();
      expect(names).toContain('POST /api/login');
      expect(names).toContain('GET /api/login');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('drops route groups like (auth) from path', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/(auth)/login/route.ts',
        `export async function POST() { return Response.json({}); }`,
      );
      const targets = extractAllTargets(cwd);
      const ep = targets.find((t) => t.type === 'endpoint');
      expect(ep?.name).toBe('POST /login');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('extractAllTargets — Next.js Pages Router', () => {
  it('extracts default export from pages/api/login.ts as ANY endpoint', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'pages/api/login.ts',
        [
          `export default async function handler(req, res) {`,
          `  res.status(200).json({ ok: true });`,
          `}`,
        ].join('\n'),
      );
      const targets = extractAllTargets(cwd);
      const ep = targets.find((t) => t.name === 'ANY /api/login');
      expect(ep).toBeTruthy();
      expect(ep?.type).toBe('endpoint');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('extractAllTargets — regular function', () => {
  it('extracts exported function in src/handlers/login.ts', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'src/handlers/login.ts',
        [
          `export async function handleLogin(req, res) {`,
          `  return res.json({});`,
          `}`,
          `export function hashPassword(pwd: string): string {`,
          `  return pwd;`,
          `}`,
        ].join('\n'),
      );
      const targets = extractAllTargets(cwd);
      const fns = targets.filter((t) => t.type === 'function').map((t) => t.name).sort();
      expect(fns).toContain('fn:handleLogin');
      expect(fns).toContain('fn:hashPassword');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('does NOT extract functions from src/lib (not a handler dir)', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'src/lib/utils.ts',
        `export function formatDate(d: Date): string { return d.toISOString(); }`,
      );
      const targets = extractAllTargets(cwd);
      const fns = targets.filter((t) => t.type === 'function');
      expect(fns).toHaveLength(0);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('extractAllTargets — HTTP-verb function in handler dir', () => {
  it('infers endpoint route for export async function POST under src/api/login.ts', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'src/api/login.ts',
        [
          `export async function POST(req) {`,
          `  const { email } = await req.json();`,
          `  if (!email) return Response.json({error:'email required'}, { status: 400 });`,
          `  return Response.json({token:'jwt'});`,
          `}`,
        ].join('\n'),
      );
      const targets = extractAllTargets(cwd);
      const ep = targets.find((t) => t.type === 'endpoint');
      expect(ep).toBeTruthy();
      expect(ep?.name).toBe('POST /api/login');
      expect(ep?.file).toBe('src/api/login.ts');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('does NOT double-count when file is canonical Next.js app/.../route.ts', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/api/health/route.ts',
        [
          `export async function GET() {`,
          `  return Response.json({ok:true});`,
          `}`,
        ].join('\n'),
      );
      const targets = extractAllTargets(cwd);
      const endpoints = targets.filter((t) => t.type === 'endpoint');
      // Should be exactly one — NEXT_APP_RE catches it; HTTP-verb function
      // branch must NOT add a duplicate.
      expect(endpoints.length).toBe(1);
      expect(endpoints[0]?.name).toBe('GET /api/health');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('extractAllTargets — robustness', () => {
  it('returns [] for empty cwd', async () => {
    const cwd = await tmpdir();
    try {
      const targets = extractAllTargets(cwd);
      expect(targets).toEqual([]);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('skips node_modules and dist', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'node_modules/foo/index.ts',
        `app.post('/should-not-be-extracted', x);`,
      );
      await writeFile(
        cwd,
        'dist/built.ts',
        `app.post('/also-skip', x);`,
      );
      await writeFile(
        cwd,
        'src/server.ts',
        `app.post('/api/real', x);`,
      );
      const targets = extractAllTargets(cwd);
      const names = targets.map((t) => t.name);
      expect(names).toContain('POST /api/real');
      expect(names.find((n) => n.includes('should-not-be-extracted'))).toBeUndefined();
      expect(names.find((n) => n.includes('also-skip'))).toBeUndefined();
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ── generateTestCases — fallback path ───────────────────────────────────────

describe('generateTestCases — no LLM (deterministic fallback)', () => {
  it('emits one happy-path spec per target when no critic key', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/api/login/route.ts',
        `export async function POST() { return Response.json({}); }`,
      );

      const logger = makeLogger(cwd);
      const specs = await generateTestCases({
        cwd,
        profile: baseProfile,
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();

      expect(specs.length).toBe(1);
      const s = specs[0]!;
      expect(s.category).toBe('happy-path');
      expect(s.id).toBe('post-api-login-1');
      expect(s.scope.type).toBe('endpoint');
      expect(s.scope.target).toBe('POST /api/login');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.test-gen.start');
      expect(events).toContain('agent.test-gen.targets-extracted');
      expect(events).toContain('agent.test-gen.target.fallback');
      expect(events).toContain('agent.test-gen.complete');
      const fallback = log.find((e) => e.event === 'agent.test-gen.target.fallback');
      expect(fallback?.reason).toBe('no-llm-key');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns [] and emits zero-target log when cwd has no targets', async () => {
    const cwd = await tmpdir();
    try {
      const logger = makeLogger(cwd);
      const specs = await generateTestCases({
        cwd,
        profile: baseProfile,
        logger,
        criticConfig: null,
        criticApiKey: null,
      });
      await logger.flush();
      expect(specs).toEqual([]);

      const log = readAgentLog(cwd);
      const extracted = log.find((e) => e.event === 'agent.test-gen.targets-extracted');
      expect(extracted?.count).toBe(0);
      const complete = log.find((e) => e.event === 'agent.test-gen.complete');
      expect(complete?.totalSpecs).toBe(0);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ── generateTestCases — LLM path ────────────────────────────────────────────

describe('generateTestCases — LLM path', () => {
  it('uses LLM specs when call succeeds', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/api/login/route.ts',
        `export async function POST() { return Response.json({}); }`,
      );

      const llmCall: TestGenLlmFn = async () => ({
        ok: true,
        raw: '{}',
        parsed: [
          {
            name: 'missing email returns 400',
            category: 'edge-case',
            given: 'request body has no email field',
            when: 'POST /api/login is called',
            then: 'response status is 400',
            reasoning: 'API contract requires email',
          },
          {
            name: 'plaintext password comparison',
            category: 'security',
            given: 'a valid user record',
            when: 'login compares passwords',
            then: 'should use bcrypt, not raw equality',
            reasoning: 'avoid timing attack and plaintext storage',
          },
        ],
      });

      const logger = makeLogger(cwd);
      const specs = await generateTestCases({
        cwd,
        profile: baseProfile,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      expect(specs.length).toBe(2);
      expect(specs[0]!.category).toBe('edge-case');
      expect(specs[1]!.category).toBe('security');
      expect(specs[0]!.id).toBe('post-api-login-1');
      expect(specs[1]!.id).toBe('post-api-login-2');

      const log = readAgentLog(cwd);
      const events = log.map((e) => e.event);
      expect(events).toContain('agent.test-gen.target.llm-call.start');
      expect(events).toContain('agent.test-gen.target.llm-call.success');
      expect(events).not.toContain('agent.test-gen.target.fallback');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('falls back to deterministic spec when LLM call fails', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/api/login/route.ts',
        `export async function POST() { return Response.json({}); }`,
      );

      const llmCall: TestGenLlmFn = async () => ({
        ok: false,
        error: 'network down',
        raw: '',
      });

      const logger = makeLogger(cwd);
      const specs = await generateTestCases({
        cwd,
        profile: baseProfile,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      expect(specs.length).toBe(1);
      expect(specs[0]!.category).toBe('happy-path');

      const log = readAgentLog(cwd);
      const fail = log.find((e) => e.event === 'agent.test-gen.target.llm-call.failure');
      expect(fail?.reason).toBe('network down');
      const fb = log.find((e) => e.event === 'agent.test-gen.target.fallback');
      expect(fb?.reason).toBe('llm-call-failed');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('falls back when LLM returns malformed specs (all rejected)', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/api/login/route.ts',
        `export async function POST() { return Response.json({}); }`,
      );

      const llmCall: TestGenLlmFn = async () => ({
        ok: true,
        raw: '{}',
        parsed: [
          { name: '', category: 'happy-path' },           // missing fields
          { foo: 'bar' },                                  // entirely wrong shape
          { name: 'x', category: 'wrong-cat', given: 'a', when: 'b', then: 'c' },
        ],
      });

      const logger = makeLogger(cwd);
      const specs = await generateTestCases({
        cwd,
        profile: baseProfile,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      // All LLM specs rejected → exactly one fallback happy-path spec.
      expect(specs.length).toBe(1);
      expect(specs[0]!.category).toBe('happy-path');

      const log = readAgentLog(cwd);
      const fb = log.find((e) => e.event === 'agent.test-gen.target.fallback');
      expect(fb?.reason).toBe('llm-output-invalid');
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('respects maxCasesPerTarget when LLM returns more', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'app/api/x/route.ts',
        `export async function GET() { return Response.json({}); }`,
      );

      const llmCall: TestGenLlmFn = async () => ({
        ok: true,
        raw: '{}',
        parsed: Array.from({ length: 10 }, (_, i) => ({
          name: `case ${i}`,
          category: 'happy-path',
          given: 'a',
          when: 'b',
          then: 'c',
          reasoning: 'r',
        })),
      });

      const logger = makeLogger(cwd);
      const specs = await generateTestCases({
        cwd,
        profile: baseProfile,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
        maxCasesPerTarget: 3,
      });
      await logger.flush();

      expect(specs.length).toBe(3);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('handles multiple targets, one LLM call per target', async () => {
    const cwd = await tmpdir();
    try {
      await writeFile(
        cwd,
        'src/routes/users.ts',
        [
          `app.get('/users', list);`,
          `app.post('/users', create);`,
        ].join('\n'),
      );

      let calls = 0;
      const llmCall: TestGenLlmFn = async () => {
        calls++;
        return {
          ok: true,
          raw: '{}',
          parsed: [
            {
              name: 'happy path call',
              category: 'happy-path',
              given: 'valid',
              when: 'invoked',
              then: 'ok',
              reasoning: 'baseline',
            },
          ],
        };
      };

      const logger = makeLogger(cwd);
      const specs = await generateTestCases({
        cwd,
        profile: baseProfile,
        logger,
        criticConfig: fakeCriticConfig,
        criticApiKey: 'k',
        llmCall,
      });
      await logger.flush();

      expect(calls).toBe(2);
      expect(specs.length).toBe(2);
      const ids = specs.map((s) => s.id).sort();
      expect(ids).toEqual(['get-users-1', 'post-users-1']);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
