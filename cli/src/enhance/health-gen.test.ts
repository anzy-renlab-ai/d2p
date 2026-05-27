/**
 * Tests for Module D — health-gen.
 *
 * Covers (≥6):
 *  1. Next.js app dir → creates app/health/route.ts
 *  2. Already-exists detection (variant: app/health/route.ts)
 *  3. Already-exists detection (variant: app/healthz/route.js)
 *  4. Already-exists detection (variant: app/api/health/route.ts)
 *  5. Express → writes src/routes/health.ts + .zerou-todo.md
 *  6. Express existing /health route detected via grep → already-exists
 *  7. Unsupported framework returns framework-unsupported with added=null
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TrackLogger, LogLevel } from '../log-types.js';
import { addHealthEndpoint } from './health-gen.js';

interface Captured {
  level: LogLevel;
  event: string;
  data: Record<string, unknown> | undefined;
}

function makeLogger(): { logger: TrackLogger; entries: Captured[] } {
  const entries: Captured[] = [];
  const logger: TrackLogger = {
    track: 'test',
    trace: 'TEST',
    log: (level, event, data) => {
      entries.push({ level, event, data });
    },
    child(_scope: string) {
      return this;
    },
    flush: async () => {},
  };
  return { logger, entries };
}

async function mkTmp(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-health-gen-'));
}

async function rmrf(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkTmp();
});
afterEach(async () => {
  await rmrf(tmp);
});

describe('addHealthEndpoint — Next.js', () => {
  it('creates app/health/route.ts when no existing endpoint', async () => {
    const { logger, entries } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'next.js',
      logger,
    });
    expect(res.added).toBe('app/health/route.ts');
    expect(res.reason).toBeUndefined();
    const body = await fsp.readFile(path.join(tmp, 'app/health/route.ts'), 'utf8');
    expect(body).toMatch(/export async function GET/);
    expect(body).toMatch(/status: 'ok'/);
    expect(body).toMatch(/process\.uptime\(\)/);
    expect(entries.some((e) => e.event === 'enhance.health.write.next')).toBe(true);
  });

  it('detects existing app/health/route.ts and skips', async () => {
    await fsp.mkdir(path.join(tmp, 'app/health'), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, 'app/health/route.ts'),
      'export async function GET(){return Response.json({})}',
      'utf8',
    );
    const { logger } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'next.js',
      logger,
    });
    expect(res.added).toBeNull();
    expect(res.reason).toBe('already-exists');
    // File contents unchanged.
    const body = await fsp.readFile(path.join(tmp, 'app/health/route.ts'), 'utf8');
    expect(body).not.toMatch(/process\.env\.npm_package_version/);
  });

  it('detects existing app/healthz/route.js and skips', async () => {
    await fsp.mkdir(path.join(tmp, 'app/healthz'), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, 'app/healthz/route.js'),
      'export async function GET(){}',
      'utf8',
    );
    const { logger } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'next.js',
      logger,
    });
    expect(res.added).toBeNull();
    expect(res.reason).toBe('already-exists');
  });

  it('detects existing app/api/health/route.ts and skips', async () => {
    await fsp.mkdir(path.join(tmp, 'app/api/health'), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, 'app/api/health/route.ts'),
      'export const GET = () => Response.json({status:"ok"})',
      'utf8',
    );
    const { logger } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'next.js',
      logger,
    });
    expect(res.added).toBeNull();
    expect(res.reason).toBe('already-exists');
  });
});

describe('addHealthEndpoint — Express', () => {
  it('creates src/routes/health.ts plus .zerou-todo.md', async () => {
    const { logger, entries } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.added).toBe('src/routes/health.ts');
    const body = await fsp.readFile(
      path.join(tmp, 'src/routes/health.ts'),
      'utf8',
    );
    expect(body).toMatch(/healthRouter\.get\('\/health'/);
    expect(body).toMatch(/import \{ Router \} from 'express'/);
    const todo = await fsp.readFile(path.join(tmp, '.zerou-todo.md'), 'utf8');
    expect(todo).toMatch(/app\.use\(healthRouter\)/);
    expect(entries.some((e) => e.event === 'enhance.health.write.express')).toBe(true);
  });

  it('detects existing express /health route definition and skips', async () => {
    await fsp.mkdir(path.join(tmp, 'src'), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, 'src/server.ts'),
      `import express from 'express';\nconst app = express();\napp.get('/health', (_req,res) => res.send('ok'));\n`,
      'utf8',
    );
    const { logger } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.added).toBeNull();
    expect(res.reason).toBe('already-exists');
    // No file written.
    expect(fs.existsSync(path.join(tmp, 'src/routes/health.ts'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.zerou-todo.md'))).toBe(false);
  });

  it('detects existing /healthz via router.get and skips', async () => {
    await fsp.mkdir(path.join(tmp, 'src/routes'), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, 'src/routes/health-check.ts'),
      `import { Router } from 'express';\nconst router = Router();\nrouter.get('/healthz', (_req,res)=>res.json({ok:true}));\nexport default router;\n`,
      'utf8',
    );
    const { logger } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.added).toBeNull();
    expect(res.reason).toBe('already-exists');
  });
});

describe('addHealthEndpoint — unsupported', () => {
  it('returns framework-unsupported for fastify/koa/etc', async () => {
    const { logger, entries } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'fastify',
      logger,
    });
    expect(res.added).toBeNull();
    expect(res.reason).toBe('framework-unsupported');
    expect(
      entries.some((e) => e.event === 'enhance.health.detect.unsupported'),
    ).toBe(true);
  });

  it('returns framework-unsupported for unknown framework', async () => {
    const { logger } = makeLogger();
    const res = await addHealthEndpoint({
      cwd: tmp,
      framework: 'unknown',
      logger,
    });
    expect(res.added).toBeNull();
    expect(res.reason).toBe('framework-unsupported');
  });
});
