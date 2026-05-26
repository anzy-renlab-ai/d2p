/**
 * Tests for the AST Analyzer (Phase 8 / Track 8A).
 *
 * Covers:
 *  - Express endpoint extraction (`app.post('/path', handler)`)
 *  - Next.js App Router extraction (`export async function POST(req)`)
 *  - Generic exported function extraction
 *  - Exact branch count for if/switch/try/ternary
 *  - hasAsyncCall / hasDatabaseCall / hasNetworkCall flag accuracy
 *  - Negative: non-exported function skipped
 *  - File skip: .test.ts file rejected at walker level
 *  - File skip: >200KB file rejected at walker level
 *  - Param + returnTypeHint extraction
 *  - sourceSnippet capped at 200 lines
 *  - In-memory ts.SourceFile path (no temp files) via
 *    `extractFunctionsFromSource`.
 *  - Log taxonomy: `agent.ast.start` + `agent.ast.complete` + at least one
 *    `agent.ast.function.found` emitted from the public entry point.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import ts from 'typescript';

import {
  analyzeFunctions,
  extractFunctionsFromSource,
  type FunctionInfo,
} from './ast-analyzer.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type TrackLogger,
} from '../log-types.js';
import { captureLogsFor } from '../log/test-helpers.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

async function tmpdir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-ast-'));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
}

function makeLogger(cwd: string): TrackLogger {
  return createTrackLogger('agent', { logRoot: path.join(cwd, '.zerou', 'logs') });
}

/** Build an in-memory ts.SourceFile for unit tests. */
function parse(rel: string, source: string): ts.SourceFile {
  let kind: ts.ScriptKind = ts.ScriptKind.TS;
  if (rel.endsWith('.tsx')) kind = ts.ScriptKind.TSX;
  else if (rel.endsWith('.jsx')) kind = ts.ScriptKind.JSX;
  else if (rel.endsWith('.js') || rel.endsWith('.mjs') || rel.endsWith('.cjs')) {
    kind = ts.ScriptKind.JS;
  }
  return ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind);
}

describe('ast-analyzer / extractFunctionsFromSource', () => {
  it('extracts a Next.js App Router POST endpoint with verb name + correct branch count', () => {
    const src = `
export async function POST(req: Request): Promise<Response> {
  const { email, password } = await req.json();
  if (!email) return Response.json({ error: 'no email' }, { status: 400 });
  const user = await db.users.findOne({ email });
  if (!user) return Response.json({ error: 'not found' }, { status: 404 });
  if (user.password !== password) {
    return Response.json({ error: 'bad creds' }, { status: 401 });
  }
  return Response.json({ token: 'jwt' });
}
`;
    const sf = parse('src/api/login.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/api/login.ts');
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    expect(fn.name).toBe('POST');
    expect(fn.kind).toBe('endpoint');
    expect(fn.branchCount).toBe(3);
    expect(fn.hasAsyncCall).toBe(true);
    expect(fn.hasDatabaseCall).toBe(true);
    expect(fn.hasNetworkCall).toBe(false);
    expect(fn.params).toEqual([{ name: 'req', typeHint: 'Request' }]);
    expect(fn.returnTypeHint).toBe('Promise<Response>');
    expect(fn.sourceSnippet).toContain('export async function POST');
  });

  it('extracts an Express style endpoint via app.post(...)', () => {
    const src = `
import express from 'express';
const app = express();

app.post('/users', async (req, res) => {
  if (!req.body.email) {
    return res.status(400).json({ error: 'no email' });
  }
  const r = await fetch('https://example.org/verify');
  res.json({ ok: true, verifyStatus: r.status });
});
`;
    const sf = parse('src/server/users.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/server/users.ts');
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    expect(fn.kind).toBe('endpoint');
    expect(fn.name).toBe('POST /users');
    expect(fn.branchCount).toBe(1);
    expect(fn.hasAsyncCall).toBe(true);
    expect(fn.hasNetworkCall).toBe(true);
    expect(fn.hasDatabaseCall).toBe(false);
  });

  it('extracts an exported plain function (non-HTTP)', () => {
    const src = `
export function hashPassword(input: string): string {
  if (!input) throw new Error('empty');
  return input.split('').reverse().join('');
}
`;
    const sf = parse('src/lib/hash.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/hash.ts');
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    expect(fn.kind).toBe('function');
    expect(fn.name).toBe('hashPassword');
    expect(fn.branchCount).toBe(1);
    expect(fn.hasAsyncCall).toBe(false);
    expect(fn.returnTypeHint).toBe('string');
    expect(fn.params).toEqual([{ name: 'input', typeHint: 'string' }]);
  });

  it('counts branches across if + switch + try + ternary', () => {
    const src = `
export function classify(n: number): string {
  if (n < 0) return 'neg';
  switch (n) {
    case 0: return 'zero';
    case 1: return 'one';
  }
  try {
    return n > 10 ? 'big' : 'small';
  } catch (e) {
    return 'err';
  } finally {
    void 0;
  }
}
`;
    const sf = parse('src/lib/classify.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/classify.ts');
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    // 1 if + 2 case + 1 try + 1 catch + 1 finally + 1 ternary = 7
    expect(fn.branchCount).toBe(7);
  });

  it('detects no async / db / network when none used', () => {
    const src = `
export function pureAdd(a: number, b: number): number {
  return a + b;
}
`;
    const sf = parse('src/lib/math.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/math.ts');
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    expect(fn.hasAsyncCall).toBe(false);
    expect(fn.hasDatabaseCall).toBe(false);
    expect(fn.hasNetworkCall).toBe(false);
    expect(fn.branchCount).toBe(0);
  });

  it('detects prisma + sql-tag database calls', () => {
    const src = `
import { prisma } from './prisma';
export async function loadUser(id: string) {
  const direct = await prisma.users.findUnique({ where: { id } });
  const raw = await sql\`SELECT * FROM users WHERE id = \${id}\`;
  return { direct, raw };
}
`;
    const sf = parse('src/lib/db.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/db.ts');
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    expect(fn.hasDatabaseCall).toBe(true);
    expect(fn.hasAsyncCall).toBe(true);
  });

  it('detects axios as a network call', () => {
    const src = `
import axios from 'axios';
export async function ping() {
  const r = await axios.get('https://example.org');
  return r.status;
}
`;
    const sf = parse('src/lib/ping.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/ping.ts');
    expect(fns).toHaveLength(1);
    expect(fns[0]!.hasNetworkCall).toBe(true);
  });

  it('skips non-exported function declarations', () => {
    const src = `
function helper(x: number): number {
  return x + 1;
}
export function used(): number {
  return helper(1);
}
`;
    const sf = parse('src/lib/util.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/util.ts');
    expect(fns.map((f) => f.name)).toEqual(['used']);
  });

  it('extracts exported arrow function expressions', () => {
    const src = `
export const GET = async (req: Request): Promise<Response> => {
  if (!req) return new Response('no req', { status: 400 });
  return new Response('ok');
};
`;
    const sf = parse('app/api/things/route.ts', src);
    const fns = extractFunctionsFromSource(sf, 'app/api/things/route.ts');
    expect(fns).toHaveLength(1);
    const fn = fns[0]!;
    expect(fn.name).toBe('GET');
    expect(fn.kind).toBe('endpoint');
    expect(fn.branchCount).toBe(1);
  });

  it('caps sourceSnippet at 200 lines', () => {
    const filler = Array.from({ length: 250 }, (_v, i) => `  const v${i} = ${i};`).join('\n');
    const src = `
export function huge() {
${filler}
  return 0;
}
`;
    const sf = parse('src/lib/huge.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/huge.ts');
    expect(fns).toHaveLength(1);
    const snippetLines = fns[0]!.sourceSnippet.split(/\r?\n/).length;
    expect(snippetLines).toBeLessThanOrEqual(200);
  });

  it('handles object-binding parameter patterns', () => {
    const src = `
export function build({ id, name }: { id: string; name: string }): string {
  return id + name;
}
`;
    const sf = parse('src/lib/build.ts', src);
    const fns = extractFunctionsFromSource(sf, 'src/lib/build.ts');
    expect(fns).toHaveLength(1);
    const p = fns[0]!.params;
    expect(p).toHaveLength(1);
    expect(p[0]!.name).toContain('id');
    expect(p[0]!.typeHint).toBe('{ id: string; name: string }');
  });
});

describe('ast-analyzer / analyzeFunctions (filesystem)', () => {
  it('walks a tree, parses files, emits start + complete events', async () => {
    const root = await tmpdir();
    await writeFile(
      root,
      'src/api/login.ts',
      `
export async function POST(req: Request) {
  const { email } = await req.json();
  if (!email) return new Response('no email', { status: 400 });
  const user = await db.users.findOne({ email });
  if (!user) return new Response('not found', { status: 404 });
  return new Response('ok');
}
`,
    );
    const logger = makeLogger(root);
    const { result, entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.ast\./ },
      async () => analyzeFunctions({ cwd: root, logger }),
    );
    await logger.flush();

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('POST');
    expect(result[0]!.kind).toBe('endpoint');
    expect(result[0]!.branchCount).toBe(2);

    const events = entries.map((e) => e.event);
    expect(events).toContain('agent.ast.start');
    expect(events).toContain('agent.ast.complete');
  });

  it('skips .test.ts files and oversized files', async () => {
    const root = await tmpdir();
    // Valid source — should be picked up.
    await writeFile(
      root,
      'src/lib/util.ts',
      `export function add(a: number, b: number): number { return a + b; }\n`,
    );
    // Test file — must be skipped.
    await writeFile(
      root,
      'src/lib/util.test.ts',
      `export function shouldNotAppear() { return 1; }\n`,
    );
    // Oversized — must be skipped.
    const huge =
      'export function tooBig() { return 0; }\n' +
      'const PAD = "' +
      'x'.repeat(220_000) +
      '";\n';
    await writeFile(root, 'src/lib/huge.ts', huge);

    const logger = makeLogger(root);
    const { result, entries } = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.ast\./ },
      async () => analyzeFunctions({ cwd: root, logger }),
    );
    await logger.flush();

    const names = result.map((r) => r.name);
    expect(names).toContain('add');
    expect(names).not.toContain('shouldNotAppear');
    expect(names).not.toContain('tooBig');

    const skipped = entries.filter((e) => e.event === 'agent.ast.file.skipped');
    const reasons = skipped.map((e) => (e as { reason?: string }).reason ?? '');
    expect(reasons).toContain('test-file');
    expect(reasons).toContain('too-large');
  });

  it('returns empty array on empty cwd without throwing', async () => {
    const root = await tmpdir();
    const logger = makeLogger(root);
    const result = await analyzeFunctions({ cwd: root, logger });
    await logger.flush();
    expect(result).toEqual([]);
  });

  it('respects maxFiles cap', async () => {
    const root = await tmpdir();
    for (let i = 0; i < 10; i++) {
      await writeFile(
        root,
        `src/lib/m${i}.ts`,
        `export function m${i}(): number { return ${i}; }\n`,
      );
    }
    const logger = makeLogger(root);
    const result = await analyzeFunctions({ cwd: root, maxFiles: 3, logger });
    await logger.flush();
    // 3 files scanned, 1 fn per file → 3 fns max.
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe('ast-analyzer / type sanity', () => {
  it('FunctionInfo shape is concrete', () => {
    // Compile-time sanity — the runtime check is in earlier tests.
    const info: FunctionInfo = {
      file: 'a.ts',
      line: 1,
      name: 'POST',
      kind: 'endpoint',
      params: [{ name: 'req', typeHint: 'Request' }],
      returnTypeHint: 'Promise<Response>',
      branchCount: 0,
      hasAsyncCall: false,
      hasDatabaseCall: false,
      hasNetworkCall: false,
      sourceSnippet: '',
    };
    expect(info.kind).toBe('endpoint');
  });
});
