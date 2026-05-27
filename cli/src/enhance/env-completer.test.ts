/**
 * Tests for Module F — env-completer.
 *
 * Covers (≥6):
 *  1. Greps `process.env.X` references correctly across nested files
 *  2. Appends missing vars to existing .env.example
 *  3. Creates .env.example when missing with header + missing vars
 *  4. Reports unused-but-declared without removing them
 *  5. Handles `process.env["NAME"]` bracket syntax
 *  6. Adds DATABASE_URL when prisma/drizzle dep detected
 *  7. No-op when .env.example already covers everything
 *  8. Ignores built-in vars like NODE_ENV / PATH
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TrackLogger, LogLevel } from '../log-types.js';
import { completeEnvExample } from './env-completer.js';

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
  return fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-env-'));
}

async function rmrf(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
}

async function writeFile(
  cwd: string,
  rel: string,
  body: string,
): Promise<void> {
  const abs = path.join(cwd, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf8');
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkTmp();
});
afterEach(async () => {
  await rmrf(tmp);
});

describe('completeEnvExample — scanning', () => {
  it('greps process.env.X references across nested src/ files', async () => {
    await writeFile(
      tmp,
      'src/server.ts',
      `const a = process.env.STRIPE_SECRET_KEY;\nconst b = process.env.DATABASE_URL;\n`,
    );
    await writeFile(
      tmp,
      'src/lib/mailer.ts',
      `const c = process.env.SENDGRID_API_KEY;\n`,
    );
    await writeFile(
      tmp,
      'app/config.js',
      `module.exports = { tok: process.env.GITHUB_TOKEN };\n`,
    );
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added.sort()).toEqual(
      [
        'DATABASE_URL',
        'GITHUB_TOKEN',
        'SENDGRID_API_KEY',
        'STRIPE_SECRET_KEY',
      ].sort(),
    );
    const body = await fsp.readFile(path.join(tmp, '.env.example'), 'utf8');
    expect(body).toMatch(/STRIPE_SECRET_KEY=/);
    expect(body).toMatch(/DATABASE_URL=/);
    expect(body).toMatch(/SENDGRID_API_KEY=/);
    expect(body).toMatch(/GITHUB_TOKEN=/);
    expect(body).toMatch(/^# Added by ZeroU enhance/m);
  });

  it('handles process.env["NAME"] and process.env[\'NAME\'] bracket syntax', async () => {
    await writeFile(
      tmp,
      'src/index.ts',
      `const x = process.env["WEBHOOK_SECRET"];\nconst y = process.env['REDIS_URL'];\n`,
    );
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added.sort()).toEqual(['REDIS_URL', 'WEBHOOK_SECRET']);
  });

  it('ignores built-in vars like NODE_ENV and PATH', async () => {
    await writeFile(
      tmp,
      'src/index.ts',
      `if (process.env.NODE_ENV === 'production') {} const p = process.env.PATH;\n`,
    );
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added).toEqual([]);
    // Should not even create .env.example since nothing to write.
    expect(fs.existsSync(path.join(tmp, '.env.example'))).toBe(false);
  });
});

describe('completeEnvExample — .env.example interaction', () => {
  it('appends missing vars to existing .env.example preserving prior content', async () => {
    await writeFile(
      tmp,
      '.env.example',
      `# Pre-existing\nFOO_KEY=\nBAR_KEY=\n`,
    );
    await writeFile(
      tmp,
      'src/index.ts',
      `process.env.FOO_KEY; process.env.NEW_KEY; process.env.ANOTHER_KEY;`,
    );
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added.sort()).toEqual(['ANOTHER_KEY', 'NEW_KEY']);
    expect(res.existed).toEqual(['FOO_KEY']);
    expect(res.unusedRemoved).toEqual(['BAR_KEY']);
    const body = await fsp.readFile(path.join(tmp, '.env.example'), 'utf8');
    expect(body).toMatch(/# Pre-existing/);
    expect(body).toMatch(/FOO_KEY=/);
    expect(body).toMatch(/BAR_KEY=/); // unchanged, NOT removed
    expect(body).toMatch(/NEW_KEY=/);
    expect(body).toMatch(/ANOTHER_KEY=/);
    expect(body).toMatch(/# Added by ZeroU enhance/);
  });

  it('creates .env.example when missing with generated header', async () => {
    await writeFile(
      tmp,
      'src/index.ts',
      `process.env.JUST_ONE_KEY;`,
    );
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added).toEqual(['JUST_ONE_KEY']);
    const body = await fsp.readFile(path.join(tmp, '.env.example'), 'utf8');
    expect(body).toMatch(/generated by ZeroU enhance/);
    expect(body).toMatch(/JUST_ONE_KEY=/);
  });

  it('reports unusedRemoved without removing them from .env.example', async () => {
    await writeFile(
      tmp,
      '.env.example',
      `UNUSED_A=\nUNUSED_B=\nUSED_KEY=\n`,
    );
    await writeFile(
      tmp,
      'src/index.ts',
      `process.env.USED_KEY;`,
    );
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added).toEqual([]);
    expect(res.existed).toEqual(['USED_KEY']);
    expect(res.unusedRemoved.sort()).toEqual(['UNUSED_A', 'UNUSED_B']);
    // File still contains the unused vars.
    const body = await fsp.readFile(path.join(tmp, '.env.example'), 'utf8');
    expect(body).toMatch(/UNUSED_A=/);
    expect(body).toMatch(/UNUSED_B=/);
  });

  it('no-op + no rewrite when .env.example already covers everything', async () => {
    await writeFile(
      tmp,
      '.env.example',
      `MY_KEY=\n`,
    );
    await writeFile(tmp, 'src/x.ts', `process.env.MY_KEY;`);
    const beforeStat = await fsp.stat(path.join(tmp, '.env.example'));
    const { logger, entries } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added).toEqual([]);
    expect(res.existed).toEqual(['MY_KEY']);
    // file size unchanged (no append).
    const afterStat = await fsp.stat(path.join(tmp, '.env.example'));
    expect(afterStat.size).toBe(beforeStat.size);
    expect(entries.some((e) => e.event === 'enhance.env.write.skip')).toBe(true);
  });
});

describe('completeEnvExample — framework extras', () => {
  it('adds DATABASE_URL when prisma is in package.json', async () => {
    await writeFile(
      tmp,
      'package.json',
      JSON.stringify({
        name: 'demo',
        dependencies: { '@prisma/client': '^5.0.0' },
      }),
    );
    await writeFile(tmp, 'src/x.ts', `// no process.env references here`);
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added).toContain('DATABASE_URL');
  });

  it('adds DATABASE_URL when drizzle-orm is in package.json', async () => {
    await writeFile(
      tmp,
      'package.json',
      JSON.stringify({
        name: 'demo',
        devDependencies: { 'drizzle-orm': '^0.30.0' },
      }),
    );
    await writeFile(tmp, 'src/x.ts', `process.env.SOMETHING_ELSE;`);
    const { logger } = makeLogger();
    const res = await completeEnvExample({ cwd: tmp, logger });
    expect(res.added.sort()).toEqual(['DATABASE_URL', 'SOMETHING_ELSE']);
  });
});
