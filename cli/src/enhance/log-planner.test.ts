/**
 * Tests for Phase 10 Module A — log-planner.
 *
 * Covers:
 *  - Next.js detection via package.json
 *  - Express detection via package.json
 *  - existing-pino re-use (no installDeps)
 *  - silent-catch site detection
 *  - console-log site detection
 *  - db-call site detection
 *  - http-boundary detection (Next.js + Express)
 *  - cap (MAX_SITES = 200) respected
 *  - empty project returns empty plan + default pino logger
 *  - bootstrap-file detection (existing → null; missing → 'src/logger.ts')
 *  - middlewareFile is null for non-Next.js frameworks
 *  - planner emits enhance.log.planner.start + complete events
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { planLogInjection } from './log-planner.js';
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
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-logplanner-'));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
}

function makeLogger(cwd: string): TrackLogger {
  return createTrackLogger('enhance', { logRoot: path.join(cwd, '.zerou', 'logs') });
}

describe('log-planner / detection', () => {
  it('detects Next.js via package.json deps', async () => {
    const cwd = await tmpdir();
    await writeFile(
      cwd,
      'package.json',
      JSON.stringify({ name: 'demo', dependencies: { next: '^15.0.0', react: '^18.0.0' } }),
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    expect(plan.framework).toBe('next.js');
    expect(plan.loggerLib).toBe('pino');
    expect(plan.installDeps).toEqual(['pino', 'pino-http']);
    expect(plan.middlewareFile).toBe('middleware.ts');
  });

  it('detects Express via package.json deps', async () => {
    const cwd = await tmpdir();
    await writeFile(
      cwd,
      'package.json',
      JSON.stringify({ name: 'demo', dependencies: { express: '^4.0.0' } }),
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    expect(plan.framework).toBe('express');
    expect(plan.middlewareFile).toBeNull();
  });

  it('reuses existing pino (no installDeps) and reports existing-pino', async () => {
    const cwd = await tmpdir();
    await writeFile(
      cwd,
      'package.json',
      JSON.stringify({
        name: 'demo',
        dependencies: { express: '^4.0.0', pino: '^9.0.0' },
      }),
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    expect(plan.loggerLib).toBe('existing-pino');
    expect(plan.installDeps).toEqual([]);
  });

  it('empty project (no package.json) returns empty plan with default pino', async () => {
    const cwd = await tmpdir();
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    expect(plan.framework).toBe('unknown');
    expect(plan.loggerLib).toBe('pino');
    expect(plan.installDeps).toEqual(['pino', 'pino-http']);
    expect(plan.sites).toEqual([]);
    expect(plan.bootstrapFile).toBe('src/logger.ts');
    expect(plan.middlewareFile).toBeNull();
  });

  it('detects existing bootstrap file → bootstrapFile = null', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(cwd, 'src/logger.ts', 'export const logger = console;');
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    expect(plan.bootstrapFile).toBeNull();
  });
});

describe('log-planner / site detection', () => {
  it('finds silent-catch sites', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/db.ts',
      `export async function bad() {
  try {
    await doSomething();
  } catch (e) {}
  try {
    return await other();
  } catch (err) { return null; }
}
`,
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    const catches = plan.sites.filter((s) => s.kind === 'silent-catch');
    expect(catches.length).toBe(2);
    expect(catches[0]!.file).toBe('src/db.ts');
    expect(catches[0]!.line).toBeGreaterThan(0);
  });

  it('finds console.log / console.error sites', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/util.ts',
      `export function run() {
  console.log('start');
  console.error('boom');
  console.warn('warn');
}
`,
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    const consoles = plan.sites.filter((s) => s.kind === 'console-log');
    expect(consoles.length).toBe(3);
  });

  it('finds db-call sites without nearby logger', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/users.ts',
      `export async function getUsers() {
  const rows = await db.users.findMany();
  return rows;
}
`,
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    const dbs = plan.sites.filter((s) => s.kind === 'db-call');
    expect(dbs.length).toBeGreaterThanOrEqual(1);
  });

  it('skips db-call sites that already log nearby', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(
      cwd,
      'src/users.ts',
      `export async function getUsers() {
  logger.info('fetching users');
  const rows = await db.users.findMany();
  return rows;
}
`,
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    const dbs = plan.sites.filter((s) => s.kind === 'db-call');
    expect(dbs.length).toBe(0);
  });

  it('detects Next.js http-boundary in app/.../route.ts', async () => {
    const cwd = await tmpdir();
    await writeFile(
      cwd,
      'package.json',
      JSON.stringify({ name: 'demo', dependencies: { next: '^15.0.0' } }),
    );
    await writeFile(
      cwd,
      'app/api/login/route.ts',
      `export async function POST(req: Request) {
  return new Response('ok');
}
`,
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'next.js',
      logger: makeLogger(cwd),
    });
    const http = plan.sites.filter((s) => s.kind === 'http-boundary');
    expect(http.length).toBe(1);
    expect(http[0]!.file).toBe('app/api/login/route.ts');
  });

  it('detects Express http-boundary via app.post()', async () => {
    const cwd = await tmpdir();
    await writeFile(
      cwd,
      'package.json',
      JSON.stringify({ name: 'demo', dependencies: { express: '^4.0.0' } }),
    );
    await writeFile(
      cwd,
      'src/server.ts',
      `app.post('/login', (req, res) => res.send('ok'));
app.get('/health', (req, res) => res.send('ok'));
`,
    );
    const plan = await planLogInjection({
      cwd,
      framework: 'express',
      logger: makeLogger(cwd),
    });
    const http = plan.sites.filter((s) => s.kind === 'http-boundary');
    expect(http.length).toBe(2);
  });

  it('respects MAX_SITES cap (200)', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    // Generate 300 console.log calls.
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) lines.push(`console.log('msg-${i}');`);
    await writeFile(cwd, 'src/spam.ts', `export function spam() {\n${lines.join('\n')}\n}\n`);
    const plan = await planLogInjection({
      cwd,
      framework: 'unknown',
      logger: makeLogger(cwd),
    });
    expect(plan.sites.length).toBe(200);
  });
});

describe('log-planner / observability', () => {
  it('emits enhance.log.planner.start and .complete', async () => {
    const cwd = await tmpdir();
    await writeFile(cwd, 'package.json', JSON.stringify({ name: 'demo' }));
    await writeFile(cwd, 'src/a.ts', 'console.log("hi");\n');
    const { entries } = await captureLogsFor(
      { track: 'enhance', eventPattern: /^enhance\.log\.planner\./ },
      async () => {
        const logger = makeLogger(cwd);
        await planLogInjection({ cwd, framework: 'unknown', logger });
      },
    );
    expect(entries.some((e) => e.event === 'enhance.log.planner.start')).toBe(true);
    expect(entries.some((e) => e.event === 'enhance.log.planner.complete')).toBe(true);
  });
});
