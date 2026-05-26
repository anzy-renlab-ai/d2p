/**
 * Tests for EvidenceBundle JSON: B-7-1/2/3 + B-10-4/5.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runAudit } from './audit.js';
import {
  tmpRepo,
  writeConfig,
  validConfigData,
  singleEngineConfigData,
  mockPreset,
} from './__fixtures__/helpers.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from './log-types.js';

function buildArgv(args: string[]): string[] {
  return ['node', 'zerou', 'audit', ...args];
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

describe('B-7-1 — bundle counts match stdout', () => {
  it('--out writes parseable JSON whose counts match stdout summary line', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'src/a.ts': 'const A = "MARK_A"; const B = "MARK_B";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'MARK_[AB]', fix: 'none' });
    const out = path.join(repo.cwd, 'bundle.json');
    let stdout = '';
    const code = await runAudit({
      argv: buildArgv([repo.cwd, '--config', cfg, '--preset', 'p', '--out', out, '--no-color']),
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: (s) => {
          stdout += s;
        },
        stderrWrite: () => undefined,
      },
    });
    expect(code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    const bundle = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(bundle.version).toBe('1.0');
    const m = stdout.match(/Of (\d+) findings: (\d+) confirmed \/ (\d+) false-positive \/ (\d+) needs-context \/ (\d+) critic-unavailable/);
    expect(m).not.toBeNull();
    const total = parseInt(m![1]!);
    const confirmed = parseInt(m![2]!);
    const fp = parseInt(m![3]!);
    const nc = parseInt(m![4]!);
    const cu = parseInt(m![5]!);
    expect(bundle.findings.length).toBe(total);
    expect(bundle.summary.counts.confirmed).toBe(confirmed);
    expect(bundle.summary.counts.falsePositive).toBe(fp);
    expect(bundle.summary.counts.needsContext).toBe(nc);
    expect(bundle.summary.counts.criticUnavailable).toBe(cu);
    await repo.cleanup();
  });
});

describe('B-7-2 — engine config in bundle is full modelId', () => {
  it('bundle.audit.engineConfig.worker.modelId is the full id, not the family', async () => {
    const repo = await tmpRepo();
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: '___never___' });
    const out = path.join(repo.cwd, 'bundle.json');
    await runAudit({
      argv: buildArgv([repo.cwd, '--config', cfg, '--preset', 'p', '--out', out]),
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    const b = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(b.audit.engineConfig.worker.modelId).toBe(validConfigData.worker.modelId);
    expect(b.audit.engineConfig.worker.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof b.audit.engineConfig.worker.family).toBe('string');
    await repo.cleanup();
  });

  it('bundle.audit.engineConfig.critic === null when single-engine', async () => {
    const repo = await tmpRepo();
    const cfg = writeConfig(repo.cwd, singleEngineConfigData);
    const preset = mockPreset({ id: 'p', pattern: '___never___' });
    const out = path.join(repo.cwd, 'bundle.json');
    await runAudit({
      argv: buildArgv([repo.cwd, '--config', cfg, '--preset', 'p', '--out', out]),
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    const b = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(b.audit.engineConfig.critic).toBeNull();
    await repo.cleanup();
  });
});

describe('B-7-3 — inputFiles enumerated', () => {
  it('inputFiles has one entry per file actually read', async () => {
    const repo = await tmpRepo({
      git: true,
      files: {
        'a.ts': 'const X = "MARK";\n',
        'b.ts': 'const Y = "MARK";\n',
        'c.txt': 'const Z = "MARK";\n', // wrong extension
      },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'MARK', fix: 'none' });
    const out = path.join(repo.cwd, 'bundle.json');
    await runAudit({
      argv: buildArgv([repo.cwd, '--config', cfg, '--preset', 'p', '--out', out]),
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    const b = JSON.parse(fs.readFileSync(out, 'utf8'));
    const paths = b.inputFiles.map((f: any) => f.path).sort();
    expect(paths).toEqual(['a.ts', 'b.ts']);
    for (const f of b.inputFiles) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    await repo.cleanup();
  });
});

describe('B-10-5 — byPreset semantics', () => {
  it('byPreset sums equal top-level counts per slot', async () => {
    const repo = await tmpRepo({
      git: true,
      files: {
        'a.ts': 'const A = "ALPHA"; const B = "BETA";\n',
      },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const presetA = mockPreset({ id: 'alpha', pattern: 'ALPHA', fix: 'none' });
    const presetB = mockPreset({ id: 'beta', pattern: 'BETA', fix: 'none' });
    const out = path.join(repo.cwd, 'bundle.json');
    await runAudit({
      argv: buildArgv([
        repo.cwd,
        '--config',
        cfg,
        '--preset',
        'alpha',
        '--preset',
        'beta',
        '--out',
        out,
      ]),
      deps: {
        loadPreset: async (id) => {
          if (id === 'alpha') return presetA;
          if (id === 'beta') return presetB;
          throw new Error('not found');
        },
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    const b = JSON.parse(fs.readFileSync(out, 'utf8'));
    // byPreset entries match preset ids
    expect(Object.keys(b.summary.byPreset).sort()).toEqual(['alpha', 'beta']);
    // Per-preset sums equal top-level counts
    const expected = b.summary.counts;
    const totals = { confirmed: 0, falsePositive: 0, needsContext: 0, criticUnavailable: 0 };
    for (const v of Object.values<any>(b.summary.byPreset)) {
      totals.confirmed += v.confirmed;
      totals.falsePositive += v.falsePositive;
      totals.needsContext += v.needsContext;
      totals.criticUnavailable += v.criticUnavailable;
    }
    expect(totals).toEqual(expected);
    await repo.cleanup();
  });
});

describe('B-10-4 — skip-no-proposal counter', () => {
  it('confirmed finding with proposeFix returning null increments skipNoProposal', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'a.ts': 'const A = "MARK";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({
      id: 'p',
      pattern: 'MARK',
      fix: 'llm-only',
    });
    const out = path.join(repo.cwd, 'bundle.json');
    await runAudit({
      argv: buildArgv([
        repo.cwd,
        '--config',
        cfg,
        '--apply',
        '--allow-dirty',
        '--preset',
        'p',
        '--out',
        out,
      ]),
      deps: {
        loadPreset: async () => preset,
        proposeFix: async () => null,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    const b = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(b.apply).toBeDefined();
    expect(b.apply.skipNoProposal).toBeGreaterThan(0);
    await repo.cleanup();
  });
});

describe('trace_id parity', () => {
  it('bundle.trace_id matches the cli logger trace', async () => {
    const repo = await tmpRepo({
      git: true,
      files: { 'a.ts': 'const A = "MARK";\n' },
    });
    const cfg = writeConfig(repo.cwd, validConfigData);
    const preset = mockPreset({ id: 'p', pattern: 'MARK', fix: 'none' });
    const out = path.join(repo.cwd, 'bundle.json');
    await runAudit({
      argv: buildArgv([repo.cwd, '--config', cfg, '--preset', 'p', '--out', out]),
      deps: {
        loadPreset: async () => preset,
        stdoutWrite: () => undefined,
        stderrWrite: () => undefined,
      },
    });
    const b = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(typeof b.trace_id).toBe('string');
    expect(b.trace_id.length).toBe(26);
    // Read a cli log file: its <trace>.jsonl should match
    const logsRoot = path.join(repo.cwd, '.zerou', 'logs', 'cli');
    expect(fs.existsSync(logsRoot)).toBe(true);
    const dates = fs.readdirSync(logsRoot);
    expect(dates.length).toBeGreaterThan(0);
    const date = dates[0]!;
    const files = fs.readdirSync(path.join(logsRoot, date));
    const cliTrace = files[0]!.replace('.jsonl', '');
    expect(b.trace_id).toBe(cliTrace);
    await repo.cleanup();
  });
});

