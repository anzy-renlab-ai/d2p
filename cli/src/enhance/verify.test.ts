/**
 * Tests for enhance/verify.ts (Module G).
 *
 * Strategy: we never spawn real npm/npx — we inject a fake SpawnRunner via
 * the test seam (`opts.spawnRunner`) and let it return scripted results for
 * each step. Real spawn is exercised by integration tests in the lead's
 * dogfood phase, not here.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { verifyEnhancedCode, __internals, type SpawnRunner } from './verify.js';
import {
  createTrackLogger,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
  type TrackLogger,
} from '../log-types.js';

let scratchDirs: string[] = [];
let logger: TrackLogger;

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  scratchDirs = [];
  logger = createTrackLogger('cli', { silent: true });
});

afterEach(async () => {
  for (const d of scratchDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

async function mkScratch(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerou-verify-'));
  scratchDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return dir;
}

/**
 * Build a runner that records every spawn call AND returns scripted exit
 * codes per command. The map key is the first arg of `args` OR the command
 * itself, whichever distinguishes the step. The default exit code is 0.
 */
function makeRunner(opts: {
  scripts?: Record<string, { exitCode: number; stdout?: string; stderr?: string; timedOut?: boolean }>;
} = {}): { runner: SpawnRunner; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: SpawnRunner = async ({ command, args }) => {
    calls.push({ command, args });
    // Match by either command or args[0]; tests pick whichever is unique.
    const key = args[0] ?? command;
    const script = opts.scripts?.[key] ?? opts.scripts?.[command];
    if (script) {
      return {
        exitCode: script.timedOut ? null : script.exitCode,
        signal: null,
        stdout: script.stdout ?? '',
        stderr: script.stderr ?? '',
        timedOut: script.timedOut ?? false,
      };
    }
    return {
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    };
  };
  return { runner, calls };
}

describe('verifyEnhancedCode — happy path: all four steps detected and run', () => {
  it('runs install + tsc + test + build when all are present', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'vitest run', build: 'tsc -p .' },
      }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true } }),
    });
    const { runner, calls } = makeRunner();
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    expect(result.ok).toBe(true);
    const names = result.steps.map((s) => s.name);
    expect(names).toEqual(['install', 'tsc', 'test', 'build']);
    expect(result.steps.every((s) => s.status === 'pass')).toBe(true);
    // First call is npm install
    expect(calls[0]?.command).toBe('npm');
    expect(calls[0]?.args[0]).toBe('install');
    // tsc invoked via npx
    const tsc = calls.find((c) => c.args.includes('tsc'));
    expect(tsc).toBeDefined();
    // test via npm test
    const test = calls.find((c) => c.args[0] === 'test');
    expect(test?.command).toBe('npm');
    // build via npm run build
    const build = calls.find((c) => c.args[0] === 'run' && c.args[1] === 'build');
    expect(build?.command).toBe('npm');
  });
});

describe('verifyEnhancedCode — tsconfig missing', () => {
  it('marks tsc as skipped when no tsconfig.json present', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'vitest', build: 'tsup' },
      }),
    });
    const { runner, calls } = makeRunner();
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    const tsc = result.steps.find((s) => s.name === 'tsc');
    expect(tsc?.status).toBe('skipped');
    expect(tsc?.stdout).toMatch(/no-tsconfig/);
    // tsc should NOT have been spawned
    expect(calls.some((c) => c.args.includes('tsc'))).toBe(false);
    // But install + test + build should have run
    expect(calls.some((c) => c.args[0] === 'install')).toBe(true);
    expect(calls.some((c) => c.args[0] === 'test')).toBe(true);
    expect(calls.some((c) => c.args[0] === 'run' && c.args[1] === 'build')).toBe(true);
    expect(result.ok).toBe(true);
  });
});

describe('verifyEnhancedCode — no test script', () => {
  it('marks test as skipped when package.json has no test script', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { build: 'tsup' },
      }),
      'tsconfig.json': '{}',
    });
    const { runner, calls } = makeRunner();
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    const test = result.steps.find((s) => s.name === 'test');
    expect(test?.status).toBe('skipped');
    expect(test?.stdout).toMatch(/no-test-script/);
    expect(calls.some((c) => c.args[0] === 'test')).toBe(false);
    // build still ran
    expect(calls.some((c) => c.args[0] === 'run' && c.args[1] === 'build')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('marks build as skipped when no build script', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'vitest' },
      }),
      'tsconfig.json': '{}',
    });
    const { runner, calls } = makeRunner();
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    const build = result.steps.find((s) => s.name === 'build');
    expect(build?.status).toBe('skipped');
    expect(build?.stdout).toMatch(/no-build-script/);
    expect(calls.some((c) => c.args[0] === 'run' && c.args[1] === 'build')).toBe(false);
  });

  it('respects skipBuild=true even when build script exists', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { build: 'tsup' },
      }),
    });
    const { runner, calls } = makeRunner();
    const result = await verifyEnhancedCode({
      cwd,
      logger,
      spawnRunner: runner,
      skipBuild: true,
    });
    const build = result.steps.find((s) => s.name === 'build');
    expect(build?.status).toBe('skipped');
    expect(build?.stdout).toMatch(/skipBuild=true/);
    expect(calls.some((c) => c.args[0] === 'run' && c.args[1] === 'build')).toBe(false);
  });
});

describe('verifyEnhancedCode — package manager detection', () => {
  it('uses npm by default', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({ name: 'd' }),
    });
    const { runner, calls } = makeRunner();
    await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    expect(calls[0]?.command).toBe('npm');
  });

  it('uses bun when bun.lockb is present', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({ name: 'd' }),
      'bun.lockb': 'binary',
    });
    const { runner, calls } = makeRunner();
    await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    expect(calls[0]?.command).toBe('bun');
    expect(calls[0]?.args[0]).toBe('install');
  });

  it('uses pnpm when pnpm-lock.yaml is present', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({ name: 'd' }),
      'pnpm-lock.yaml': 'lockfileVersion: 6\n',
    });
    const { runner, calls } = makeRunner();
    await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    expect(calls[0]?.command).toBe('pnpm');
  });

  it('skips install if node_modules/.package-lock.json is newer than package.json', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({ name: 'd' }),
    });
    // Create node_modules/.package-lock.json with a newer mtime.
    await fs.mkdir(path.join(cwd, 'node_modules'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, 'node_modules', '.package-lock.json'),
      '{}',
      'utf8',
    );
    // Bump its mtime well into the future.
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(
      path.join(cwd, 'node_modules', '.package-lock.json'),
      future,
      future,
    );
    const { runner, calls } = makeRunner();
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    const install = result.steps.find((s) => s.name === 'install');
    expect(install?.status).toBe('skipped');
    expect(install?.stdout).toMatch(/node_modules-fresh/);
    expect(calls.some((c) => c.args[0] === 'install')).toBe(false);
  });
});

describe('verifyEnhancedCode — step failure halts later steps', () => {
  it('marks tsc/test/build as skipped when install fails', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'vitest', build: 'tsup' },
      }),
      'tsconfig.json': '{}',
    });
    const { runner, calls } = makeRunner({
      scripts: {
        install: { exitCode: 1, stderr: 'EACCES on /tmp/x\n' },
      },
    });
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    const install = result.steps.find((s) => s.name === 'install');
    const tsc = result.steps.find((s) => s.name === 'tsc');
    const test = result.steps.find((s) => s.name === 'test');
    const build = result.steps.find((s) => s.name === 'build');
    expect(install?.status).toBe('fail');
    expect(tsc?.status).toBe('skipped');
    expect(test?.status).toBe('skipped');
    expect(build?.status).toBe('skipped');
    expect(tsc?.stdout).toMatch(/prior-step-failed/);
    // No tsc/test/build spawns happened
    expect(calls.some((c) => c.args.includes('tsc'))).toBe(false);
    expect(calls.some((c) => c.args[0] === 'test')).toBe(false);
    expect(calls.some((c) => c.args[0] === 'run' && c.args[1] === 'build')).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('marks test/build as skipped when tsc fails', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'vitest', build: 'tsup' },
      }),
      'tsconfig.json': '{}',
    });
    const { runner } = makeRunner({
      scripts: {
        tsc: { exitCode: 2, stderr: 'TS1109: Expression expected.\n' },
      },
    });
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    expect(result.steps.find((s) => s.name === 'install')?.status).toBe('pass');
    expect(result.steps.find((s) => s.name === 'tsc')?.status).toBe('fail');
    expect(result.steps.find((s) => s.name === 'test')?.status).toBe('skipped');
    expect(result.steps.find((s) => s.name === 'build')?.status).toBe('skipped');
    expect(result.ok).toBe(false);
  });
});

describe('verifyEnhancedCode — timeout treated as fail', () => {
  it('records timeout signal as failed step with timeout note in stderr', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'sleep 999' },
      }),
      'tsconfig.json': '{}',
    });
    const { runner } = makeRunner({
      scripts: {
        test: { exitCode: 0, timedOut: true, stdout: 'still running...' },
      },
    });
    const result = await verifyEnhancedCode({ cwd, logger, spawnRunner: runner });
    const test = result.steps.find((s) => s.name === 'test');
    expect(test?.status).toBe('fail');
    expect(test?.stderr).toMatch(/timed out/i);
    expect(test?.exitCode).toBeNull();
    expect(result.ok).toBe(false);
  });
});

describe('verifyEnhancedCode — override scripts honored', () => {
  it('uses opts.testScript override instead of package.json scripts.test', async () => {
    const cwd = await mkScratch({
      'package.json': JSON.stringify({
        name: 'demo',
        scripts: { test: 'vitest' },
      }),
    });
    const { runner, calls } = makeRunner();
    await verifyEnhancedCode({
      cwd,
      logger,
      spawnRunner: runner,
      testScript: 'pnpm vitest --bail',
    });
    const test = calls.find((c) => c.command === 'pnpm');
    expect(test).toBeDefined();
    expect(test?.args).toEqual(['vitest', '--bail']);
  });
});

describe('verifyEnhancedCode — output capping', () => {
  it('caps stdout/stderr at STREAM_CAP_CHARS with truncation marker', () => {
    const huge = 'x'.repeat(__internals.STREAM_CAP_CHARS + 1000);
    const capped = __internals.capStream(huge);
    expect(capped.length).toBeLessThan(huge.length);
    expect(capped).toMatch(/\[truncated\]/);
    // Boundary case: short string returns unchanged
    const small = 'short';
    expect(__internals.capStream(small)).toBe(small);
  });
});
