/**
 * Tests for `zerou audit`. See docs/details/15-hardener-cli-tests.md.
 *
 * Uses os.tmpdir() everywhere (dispatch-note #7). In-process mode via runAudit.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAudit } from './audit.js';
import {
  tmpRepo,
  dirtyRepo,
  writeConfig,
  validConfigData,
  singleEngineConfigData,
  mockPreset,
  readLogsUnder,
} from './__fixtures__/helpers.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from './log-types.js';
import type { LoadedPreset, VerdictedFinding, RunPresetOptions, PresetManifest } from './stubs.js';

function buildArgv(args: string[]): string[] {
  return ['node', 'zerou', 'audit', ...args];
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runWith(
  args: string[],
  deps: Parameters<typeof runAudit>[0]['deps'] = {},
): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runAudit({
    argv: buildArgv(args),
    deps: {
      stdoutWrite: (s) => {
        stdout += s;
      },
      stderrWrite: (s) => {
        stderr += s;
      },
      ...deps,
    },
  });
  return { exitCode, stdout, stderr };
}

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

describe('B-1-1 — auto-init on non-git fixture', () => {
  it('creates .git, emits cli.repo.auto-init, exits 0', async () => {
    const repo = await tmpRepo({ git: false });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'noop', pattern: '___never___' });
    const { exitCode } = await runWith(
      [repo.cwd, '--config', cfg, '--preset', preset.manifest.id],
      {
        listPresets: async () => [preset],
        loadPreset: async (id) => {
          if (id === preset.manifest.id) return preset;
          throw new Error('not found');
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(repo.cwd, '.git'))).toBe(true);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    expect(cliEntries.some((e) => e.event === 'cli.repo.auto-init')).toBe(true);
    await repo.cleanup();
  });
});

describe('B-1-2 — existing git fixture', () => {
  it('logs cli.repo.existing-git with head sha', async () => {
    const repo = await tmpRepo({ git: true });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'noop', pattern: '___never___' });
    const { exitCode } = await runWith(
      [repo.cwd, '--config', cfg, '--preset', preset.manifest.id],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(0);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    const existingGit = cliEntries.find((e) => e.event === 'cli.repo.existing-git');
    expect(existingGit).toBeDefined();
    expect(typeof existingGit!.head).toBe('string');
    expect((existingGit!.head as string).length).toBeGreaterThan(0);
    expect(cliEntries.some((e) => e.event === 'cli.repo.auto-init')).toBe(false);
    await repo.cleanup();
  });
});

describe('B-1-3 — dirty + --apply refuses', () => {
  it('exits 3, logs cli.repo.dirty, makes no apply attempts', async () => {
    const repo = await dirtyRepo();
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'noop', pattern: '___never___' });
    const { exitCode, stderr } = await runWith(
      [repo.cwd, '--config', cfg, '--apply', '--preset', preset.manifest.id],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(3);
    expect(stderr).toMatch(/allow-dirty/);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    expect(cliEntries.some((e) => e.event === 'cli.repo.dirty')).toBe(true);
    expect(cliEntries.some((e) => e.event === 'cli.apply.template')).toBe(false);
    await repo.cleanup();
  });
});

describe('B-1-4 — dirty + --apply --allow-dirty proceeds', () => {
  it('does not emit cli.repo.dirty, applies template fix', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'env.ts': 'const K = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'fixer', pattern: 'SECRET_TOKEN', fix: 'template' });
    // Critic configured: every finding becomes 'confirmed'
    const customRunPreset = async (
      manifest: PresetManifest,
      ctx: RunPresetOptions,
    ): Promise<VerdictedFinding[]> => {
      const { defaultRunPreset } = await import('./stubs.js');
      return defaultRunPreset(manifest, ctx);
    };
    // Add a dirty file
    fs.writeFileSync(path.join(repo.cwd, 'extra.ts'), '// dirty\n');
    const { exitCode } = await runWith(
      [
        repo.cwd,
        '--config',
        cfg,
        '--apply',
        '--allow-dirty',
        '--preset',
        preset.manifest.id,
      ],
      {
        loadPreset: async () => preset,
        runPreset: customRunPreset,
      },
    );
    expect(exitCode).toBe(0);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    expect(cliEntries.some((e) => e.event === 'cli.repo.dirty')).toBe(false);
    expect(cliEntries.some((e) => e.event === 'cli.apply.template')).toBe(true);
    // File should be modified
    const after = fs.readFileSync(path.join(repo.cwd, 'env.ts'), 'utf8');
    expect(after).not.toMatch(/SECRET_TOKEN/);
    await repo.cleanup();
  });
});

describe('B-2-1 — missing path', () => {
  it('exits 3 with cli.path.missing', async () => {
    const missing = path.join(os.tmpdir(), 'nope-' + Math.random().toString(36).slice(2));
    const tmp = await tmpRepo();
    const cfg = writeConfig(tmp.cwd, validConfigData);
    const { exitCode, stderr } = await runWith([missing, '--config', cfg]);
    expect(exitCode).toBe(3);
    expect(stderr.length).toBeGreaterThan(0);
    // log file lives wherever fallback lives (cwd .zerou/logs). Just check stderr.
    await tmp.cleanup();
  });

  it('exits 3 when path is a regular file', async () => {
    const tmp = await tmpRepo();
    const cfg = writeConfig(tmp.cwd, validConfigData);
    const file = path.join(tmp.cwd, 'a.ts');
    const { exitCode } = await runWith([file, '--config', cfg]);
    expect(exitCode).toBe(3);
    await tmp.cleanup();
  });
});

describe('B-2-2 — requested preset id missing', () => {
  it('exits 3 with cli.preset.requested-missing', async () => {
    const repo = await tmpRepo();
    const cfg = writeConfig(repo.cwd, validConfigData);
    const { exitCode } = await runWith(
      [repo.cwd, '--config', cfg, '--preset', 'does-not-exist'],
      {
        loadPreset: async (id) => {
          throw new Error('not found: ' + id);
        },
      },
    );
    expect(exitCode).toBe(3);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    expect(
      cliEntries.some(
        (e) => e.event === 'cli.preset.requested-missing' && e.requestedId === 'does-not-exist',
      ),
    ).toBe(true);
    await repo.cleanup();
  });
});

describe('B-3-1 — shadow warning', () => {
  it('emits cli.preset.shadow-warn when preset shadowed', async () => {
    const repo = await tmpRepo();
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({
      id: 'X',
      pattern: '___never___',
      source: 'plugin',
      shadowedBy: ['project'],
    });
    const { exitCode, stdout } = await runWith(
      [repo.cwd, '--config', cfg, '--preset', 'X', '--no-color'],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/warn: preset X overridden by plugin/);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    const sw = cliEntries.find((e) => e.event === 'cli.preset.shadow-warn');
    expect(sw).toBeDefined();
    expect(sw!.presetId).toBe('X');
    expect(sw!.winningSource).toBe('plugin');
    await repo.cleanup();
  });
});

describe('B-4-2 — single-engine config nudge', () => {
  it('logs critic.policy-selected crossFamily=false + summary nudge present', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "SECRET_TOKEN"; const B = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, singleEngineConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'SECRET_TOKEN', fix: 'none' });
    const { exitCode, stdout } = await runWith(
      [repo.cwd, '--config', cfg, '--preset', 'p', '--no-color'],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(0);
    // Summary
    const summaryMatch = stdout.match(/Of (\d+) findings: \d+ confirmed \/ \d+ false-positive \/ \d+ needs-context \/ (\d+) critic-unavailable/);
    expect(summaryMatch).not.toBeNull();
    expect(parseInt(summaryMatch![2]!)).toBeGreaterThan(0);
    expect(stdout).toMatch(/configure a second engine \(different family from anthropic\) to verdict the remaining \d+\./);
    // critic.policy-selected
    const logs = readLogsUnder(repo.cwd);
    const criticEntries = [...logs.entries()].find(([k]) => k.startsWith('critic/'))?.[1] ?? [];
    const pol = criticEntries.find((e) => e.event === 'critic.policy-selected');
    expect(pol).toBeDefined();
    expect(pol!.crossFamily).toBe(false);
    expect(pol!.reason).toBe('no-critic-configured');
    await repo.cleanup();
  });
});

describe('B-5-1 — --fail-on p1 with confirmed P1 exits 2', () => {
  it('exits 2 when there is a confirmed P1 finding', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'SECRET_TOKEN', severity: 'P1', fix: 'none' });
    const { exitCode } = await runWith(
      [repo.cwd, '--config', cfg, '--fail-on', 'p1', '--preset', 'p', '--no-color'],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(2);
    await repo.cleanup();
  });
});

describe('B-5-2 — --fail-on p1 with only P2/P3 confirmed exits 0', () => {
  it('exits 0 with confirmed P2 only', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'SECRET_TOKEN', severity: 'P2', fix: 'none' });
    const { exitCode } = await runWith(
      [repo.cwd, '--config', cfg, '--fail-on', 'p1', '--preset', 'p', '--no-color'],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(0);
    await repo.cleanup();
  });
});

describe('B-5-2 micro — critic-unavailable P1 does not cross fail-on p1', () => {
  it('exits 0 when P1 finding is critic-unavailable', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, singleEngineConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'SECRET_TOKEN', severity: 'P1', fix: 'none' });
    const { exitCode } = await runWith(
      [repo.cwd, '--config', cfg, '--fail-on', 'p1', '--preset', 'p', '--no-color'],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(0);
    await repo.cleanup();
  });
});

describe('B-5-3 — --fail-on none always exits 0', () => {
  it('exits 0 with any confirmed finding when fail-on=none', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'SECRET_TOKEN', severity: 'P1', fix: 'none' });
    const { exitCode } = await runWith(
      [repo.cwd, '--config', cfg, '--fail-on', 'none', '--preset', 'p', '--no-color'],
      {
        loadPreset: async () => preset,
      },
    );
    expect(exitCode).toBe(0);
    await repo.cleanup();
  });
});

describe('B-6-1 — --key value redacted in process.argv', () => {
  it('redacts --key value and emits stderr note', async () => {
    const repo = await tmpRepo();
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'noop', pattern: '___never___' });
    const argv = buildArgv([
      repo.cwd,
      '--config',
      cfg,
      '--key',
      'openai=sk-secret-redact-me',
      '--preset',
      'noop',
      '--no-color',
    ]);
    let stderr = '';
    let stdout = '';
    const code = await runAudit({
      argv,
      deps: {
        stdoutWrite: (s) => {
          stdout += s;
        },
        stderrWrite: (s) => {
          stderr += s;
        },
        loadPreset: async () => preset,
      },
    });
    void stdout;
    expect(code).toBe(0);
    // argv was mutated in-place
    const idx = argv.findIndex((a) => a === '--key');
    expect(idx).toBeGreaterThan(-1);
    expect(argv[idx + 1]).toBe('openai=[REDACTED]');
    expect(argv.join(' ')).not.toContain('sk-secret-redact-me');
    expect(stderr).toMatch(/note: --key value redacted from process listing/);
    expect(stderr).toMatch(/ZEROU_OPENAI_KEY/);
    await repo.cleanup();
  });
});

describe('B-9-1 — no log file contains literal --key value', () => {
  it('zero occurrences of sk-secret-test across all logs', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'SECRET_TOKEN', fix: 'none' });
    const argv = buildArgv([
      repo.cwd,
      '--config',
      cfg,
      '--key',
      'openai=sk-secret-test',
      '--preset',
      'p',
      '--no-color',
    ]);
    let stdout = '';
    let stderr = '';
    const code = await runAudit({
      argv,
      deps: {
        stdoutWrite: (s) => {
          stdout += s;
        },
        stderrWrite: (s) => {
          stderr += s;
        },
        loadPreset: async () => preset,
      },
    });
    void code;
    expect(stdout).not.toContain('sk-secret-test');
    expect(stderr).not.toContain('sk-secret-test');
    const logsRoot = path.join(repo.cwd, '.zerou', 'logs');
    if (fs.existsSync(logsRoot)) {
      const walk = (p: string): string[] => {
        const out: string[] = [];
        for (const e of fs.readdirSync(p)) {
          const abs = path.join(p, e);
          if (fs.statSync(abs).isDirectory()) out.push(...walk(abs));
          else if (abs.endsWith('.jsonl')) out.push(abs);
        }
        return out;
      };
      const files = walk(logsRoot);
      for (const f of files) {
        const content = fs.readFileSync(f, 'utf8');
        expect(content).not.toContain('sk-secret-test');
      }
    }
    await repo.cleanup();
  });
});

describe('B-10-3 — invalid config file', () => {
  it('exits 3 with cli.config.invalid', async () => {
    const repo = await tmpRepo();
    const cfgPath = path.join(repo.cwd, 'bad-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ totally: 'broken' }));
    if (process.platform !== 'win32') fs.chmodSync(cfgPath, 0o600);
    const { exitCode } = await runWith([repo.cwd, '--config', cfgPath]);
    expect(exitCode).toBe(3);
    const logs = readLogsUnder(repo.cwd);
    const cliEntries = [...logs.entries()].find(([k]) => k.startsWith('cli/'))?.[1] ?? [];
    const invalid = cliEntries.find((e) => e.event === 'cli.config.invalid');
    expect(invalid).toBeDefined();
    expect(invalid!.errorCode).toBe('A-E-3');
    await repo.cleanup();
  });
});

describe('B-10-6 — fail-on computed BEFORE apply', () => {
  it('confirmed P1 + apply with all skipped still exits 2', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "SECRET_TOKEN";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({
      id: 'p',
      pattern: 'SECRET_TOKEN',
      severity: 'P1',
      fix: 'llm-only',
    });
    const { exitCode } = await runWith(
      [
        repo.cwd,
        '--config',
        cfg,
        '--apply',
        '--fail-on',
        'p1',
        '--preset',
        'p',
        '--no-color',
      ],
      {
        loadPreset: async () => preset,
        // proposeFix returns null → skipped
        proposeFix: async () => null,
      },
    );
    expect(exitCode).toBe(2);
    await repo.cleanup();
  });
});
