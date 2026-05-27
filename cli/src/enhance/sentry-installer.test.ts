/**
 * Tests for Module E — sentry-installer.
 *
 * Covers (≥6):
 *  1. Tracker already present (@sentry/node) → no-op
 *  2. Tracker already present (@datadog) → no-op
 *  3. Next.js → creates 3+ config files + instrumentation + patches package.json
 *  4. Express → creates src/sentry.ts + .zerou-todo.md + patches package.json
 *  5. Dependency spec is well-formed (`@sentry/node@^8.50.0` format)
 *  6. Missing package.json → safe no-op
 *  7. Unsupported framework → dep added but no scaffold files
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TrackLogger, LogLevel } from '../log-types.js';
import { installSentry } from './sentry-installer.js';

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
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-sentry-'));
}

async function rmrf(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
}

async function writePkg(
  cwd: string,
  pkg: Record<string, unknown>,
): Promise<void> {
  await fsp.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify(pkg, null, 2),
    'utf8',
  );
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkTmp();
});
afterEach(async () => {
  await rmrf(tmp);
});

describe('installSentry — tracker already present', () => {
  it('is a no-op when @sentry/node is already a dep', async () => {
    await writePkg(tmp, {
      name: 'demo',
      dependencies: { '@sentry/node': '^7.0.0' },
    });
    const { logger, entries } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.added).toEqual([]);
    expect(res.dependencies).toEqual([]);
    expect(res.bootstrapPatched).toBeNull();
    expect(
      entries.some((e) => e.event === 'enhance.sentry.detect.tracker-present'),
    ).toBe(true);
    // package.json unchanged.
    const after = JSON.parse(
      await fsp.readFile(path.join(tmp, 'package.json'), 'utf8'),
    );
    expect(after.dependencies['@sentry/node']).toBe('^7.0.0');
    expect(after.devDependencies).toBeUndefined();
  });

  it('is a no-op when @datadog/* is already a devDep', async () => {
    await writePkg(tmp, {
      name: 'demo',
      devDependencies: { '@datadog/browser-logs': '^5.0.0' },
    });
    const { logger } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'next.js',
      logger,
    });
    expect(res.added).toEqual([]);
    expect(res.dependencies).toEqual([]);
  });

  it('is a no-op when bugsnag is already a dep', async () => {
    await writePkg(tmp, {
      name: 'demo',
      dependencies: { '@bugsnag/js': '^7.0.0' },
    });
    const { logger } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.added).toEqual([]);
  });
});

describe('installSentry — Next.js', () => {
  it('creates 4 config files and patches package.json devDeps', async () => {
    await writePkg(tmp, { name: 'demo', dependencies: { next: '^14.0.0' } });
    const { logger, entries } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'next.js',
      logger,
    });
    expect(res.added.length).toBeGreaterThanOrEqual(3);
    expect(res.added).toContain('sentry.server.config.ts');
    expect(res.added).toContain('sentry.client.config.ts');
    expect(res.added).toContain('sentry.edge.config.ts');
    expect(res.added).toContain('instrumentation.ts');
    expect(res.dependencies).toEqual(['@sentry/nextjs@^8.50.0']);
    expect(res.bootstrapPatched).toMatch(/package\.json$/);
    // Each scaffold file actually exists and references Sentry.init.
    for (const rel of [
      'sentry.server.config.ts',
      'sentry.client.config.ts',
      'sentry.edge.config.ts',
    ]) {
      const body = await fsp.readFile(path.join(tmp, rel), 'utf8');
      expect(body).toMatch(/@sentry\/nextjs/);
      expect(body).toMatch(/Sentry\.init/);
      expect(body).toMatch(/process\.env\.(?:NEXT_PUBLIC_)?SENTRY_DSN/);
    }
    // package.json patched.
    const after = JSON.parse(
      await fsp.readFile(path.join(tmp, 'package.json'), 'utf8'),
    );
    expect(after.devDependencies['@sentry/nextjs']).toBe('^8.50.0');
    expect(
      entries.some((e) => e.event === 'enhance.sentry.write.next'),
    ).toBe(true);
  });
});

describe('installSentry — Express', () => {
  it('creates src/sentry.ts + .zerou-todo.md and patches package.json', async () => {
    await writePkg(tmp, {
      name: 'demo',
      dependencies: { express: '^4.0.0' },
    });
    const { logger, entries } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.added).toContain('src/sentry.ts');
    expect(res.added).toContain('.zerou-todo.md');
    expect(res.dependencies).toEqual(['@sentry/node@^8.50.0']);
    const body = await fsp.readFile(path.join(tmp, 'src/sentry.ts'), 'utf8');
    expect(body).toMatch(/export function initSentry/);
    expect(body).toMatch(/@sentry\/node/);
    expect(body).toMatch(/tracesSampleRate/);
    const todo = await fsp.readFile(path.join(tmp, '.zerou-todo.md'), 'utf8');
    expect(todo).toMatch(/initSentry\(\)/);
    expect(todo).toMatch(/before any other middleware/i);
    const after = JSON.parse(
      await fsp.readFile(path.join(tmp, 'package.json'), 'utf8'),
    );
    expect(after.devDependencies['@sentry/node']).toBe('^8.50.0');
    expect(
      entries.some((e) => e.event === 'enhance.sentry.write.express'),
    ).toBe(true);
  });

  it('dependency spec is well-formed (name + version separated)', async () => {
    await writePkg(tmp, { name: 'demo' });
    const { logger } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.dependencies).toHaveLength(1);
    const spec = res.dependencies[0]!;
    expect(spec).toMatch(/^@sentry\/(?:node|nextjs)@\^?\d+\.\d+\.\d+$/);
  });
});

describe('installSentry — edge cases', () => {
  it('safe no-op when package.json missing', async () => {
    const { logger } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'express',
      logger,
    });
    expect(res.added).toEqual([]);
    expect(res.dependencies).toEqual([]);
    expect(res.bootstrapPatched).toBeNull();
  });

  it('unsupported framework still patches dep but creates no files', async () => {
    await writePkg(tmp, { name: 'demo' });
    const { logger } = makeLogger();
    const res = await installSentry({
      cwd: tmp,
      framework: 'fastify',
      logger,
    });
    expect(res.added).toEqual([]);
    expect(res.dependencies).toEqual(['@sentry/node@^8.50.0']);
    expect(res.bootstrapPatched).toMatch(/package\.json$/);
    const after = JSON.parse(
      await fsp.readFile(path.join(tmp, 'package.json'), 'utf8'),
    );
    expect(after.devDependencies['@sentry/node']).toBe('^8.50.0');
  });
});
