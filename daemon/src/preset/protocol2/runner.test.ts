import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPreset } from './runner.js';
import { captureLogsFor } from '../../log/test-helpers.js';
import { createTrackLogger } from '../../log/track-logger.js';
import type { PresetManifest } from './types.js';

let root: string;

function silentLogger() {
  return createTrackLogger('preset', { silent: true, minLevel: 'debug' });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'zerou-p2-runner-'));
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function writeFile(repoRel: string, content: string): string {
  const abs = path.join(root, repoRel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

function staticGrepManifest(opts: {
  id?: string;
  pattern: string;
  ruleId?: string;
  severity?: 'P1' | 'P2' | 'P3';
}): PresetManifest {
  return {
    id: opts.id ?? 'test-preset',
    version: 2,
    name: 'test',
    rules: [
      {
        ruleId: opts.ruleId ?? 'rule-1',
        label: `match ${opts.pattern}`,
        severity: opts.severity ?? 'P2',
        mechanism: 'static-grep',
        source: 'fixture',
        detection: { pattern: opts.pattern },
      },
    ],
    body: '',
  };
}

describe('runPreset — B-4 execution & error isolation', () => {
  // T-4-1-1 (B-4-1)
  it('emits start+success for every rule in a 3-rule deterministic preset', async () => {
    writeFile('src/a.ts', 'line1\nTODO: x\nline3\n');
    writeFile('README.md', '');

    const manifest: PresetManifest = {
      id: 'multi',
      version: 2,
      name: 'multi',
      rules: [
        {
          ruleId: 'grep-1',
          label: 'find TODO',
          severity: 'P3',
          mechanism: 'static-grep',
          source: 'fixture',
          detection: { pattern: 'TODO' },
        },
        {
          ruleId: 'grep-2',
          label: 'find ZZZ',
          severity: 'P3',
          mechanism: 'static-grep',
          source: 'fixture',
          detection: { pattern: 'ZZZ_NEVER_FOUND' },
        },
        {
          ruleId: 'file-1',
          label: 'README exists',
          severity: 'P3',
          mechanism: 'file-exists',
          source: 'fixture',
          detection: { paths: ['README.md'], expect: 'present' },
        },
      ],
      body: '',
    };

    const { result: findings, entries } = await captureLogsFor(
      { track: 'preset' },
      async () => runPreset(manifest, { cwd: root, repoSha: null }, { logger: silentLogger() }),
    );

    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings) {
      expect(f.id).toMatch(/^multi\.[0-9a-f]{8}$/);
      expect(f.version).toBe('1.0');
    }
    const starts = entries.filter((e) => e.event === 'preset.run.rule.start');
    const successes = entries.filter((e) => e.event === 'preset.run.rule.success');
    expect(starts.length).toBe(3);
    expect(successes.length).toBe(3);
    expect(entries.filter((e) => e.event === 'preset.run.start').length).toBe(1);
    expect(entries.filter((e) => e.event === 'preset.run.success').length).toBe(1);
    expect(entries.filter((e) => e.event === 'preset.run.rule.failure').length).toBe(0);
    expect(entries.filter((e) => e.event === 'preset.run.rule.timeout').length).toBe(0);
  });

  // T-4-2-1 (B-4-2): per-finding event invariant
  it('emits one preset.run.rule.finding event per produced finding with matching id+severity', async () => {
    writeFile('src/a.ts', 'foo\nTODO line 2\nbar\nbaz\nTODO line 5\n');

    const manifest = staticGrepManifest({
      pattern: 'TODO',
      severity: 'P2',
      id: 'p',
      ruleId: 'r',
    });

    const { result: findings, entries } = await captureLogsFor(
      { track: 'preset' },
      async () => runPreset(manifest, { cwd: root, repoSha: null }, { logger: silentLogger() }),
    );

    expect(findings.length).toBe(2);
    const findingEvents = entries.filter((e) => e.event === 'preset.run.rule.finding');
    expect(findingEvents.length).toBe(2);
    const eventIds = findingEvents.map((e) => e.findingId).sort();
    const findingIds = findings.map((f) => f.id).sort();
    expect(eventIds).toEqual(findingIds);
    for (const e of findingEvents) expect(e.severity).toBe('P2');
  });

  // T-4-2-2 zero findings yields zero finding events
  it('emits no finding event when a rule matches nothing', async () => {
    writeFile('src/a.ts', 'nothing interesting\n');
    const manifest = staticGrepManifest({ pattern: 'XXX_NO_MATCH' });

    const { result: findings, entries } = await captureLogsFor(
      { track: 'preset' },
      async () => runPreset(manifest, { cwd: root, repoSha: null }, { logger: silentLogger() }),
    );

    expect(findings.length).toBe(0);
    expect(entries.filter((e) => e.event === 'preset.run.rule.finding').length).toBe(0);
    const success = entries.find((e) => e.event === 'preset.run.rule.success');
    expect(success!.findingsCount).toBe(0);
  });
});

describe('runPreset — B-7 evidence + empty-rule', () => {
  // T-B-7-1: evidence ≤ 2048 bytes preserved verbatim
  it('preserves evidence verbatim when content ≤ 2048 bytes', async () => {
    const evidence = 'TODO: hello world';
    writeFile('src/a.ts', evidence + '\n');
    const manifest = staticGrepManifest({ pattern: 'TODO' });
    const findings = await runPreset(
      manifest,
      { cwd: root, repoSha: null },
      { logger: silentLogger() },
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.evidence).toBe(evidence);
    expect(findings[0]!.evidence.endsWith('...')).toBe(false);
  });

  // T-B-7-2: evidence > 2048 bytes truncated to 2048 with trailing ...
  it('truncates evidence over 2048 bytes to exactly 2048 with trailing ...', async () => {
    const long = 'TODO' + 'a'.repeat(2050);
    writeFile('src/a.ts', long + '\n');
    const manifest = staticGrepManifest({ pattern: 'TODO' });
    const findings = await runPreset(
      manifest,
      { cwd: root, repoSha: null },
      { logger: silentLogger() },
    );
    expect(findings.length).toBe(1);
    expect(Buffer.byteLength(findings[0]!.evidence, 'utf8')).toBe(2048);
    expect(findings[0]!.evidence.endsWith('...')).toBe(true);
  });

  // T-B-7-3: empty rules manifest returns [] without throwing
  it('returns [] for a manifest with zero rules and emits start+success only', async () => {
    const manifest: PresetManifest = {
      id: 'empty',
      version: 2,
      name: 'empty',
      rules: [],
      body: '',
    };
    const { result: findings, entries } = await captureLogsFor(
      { track: 'preset' },
      async () => runPreset(manifest, { cwd: root, repoSha: null }, { logger: silentLogger() }),
    );
    expect(findings).toEqual([]);
    const start = entries.find((e) => e.event === 'preset.run.start');
    expect(start!.rulesCount).toBe(0);
    const success = entries.find((e) => e.event === 'preset.run.success');
    expect(success!.findingsCount).toBe(0);
    expect(entries.filter((e) => e.event.startsWith('preset.run.rule.')).length).toBe(0);
  });
});

describe('runPreset — file-exists mechanism', () => {
  it('emits a Finding when a required file is absent', async () => {
    const manifest: PresetManifest = {
      id: 'fe',
      version: 2,
      name: 'fe',
      rules: [
        {
          ruleId: 'has-readme',
          label: 'README must exist',
          severity: 'P2',
          mechanism: 'file-exists',
          source: 'fixture',
          detection: { paths: ['README.md'], expect: 'present' },
        },
      ],
      body: '',
    };
    const findings = await runPreset(
      manifest,
      { cwd: root, repoSha: null },
      { logger: silentLogger() },
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.file).toBe('README.md');
    expect(findings[0]!.line).toBe(0);
    expect(findings[0]!.severity).toBe('P2');
  });

  it('emits no Finding when expected-present path exists', async () => {
    writeFile('README.md', '# hi\n');
    const manifest: PresetManifest = {
      id: 'fe',
      version: 2,
      name: 'fe',
      rules: [
        {
          ruleId: 'has-readme',
          label: 'README must exist',
          severity: 'P2',
          mechanism: 'file-exists',
          source: 'fixture',
          detection: { paths: ['README.md'], expect: 'present' },
        },
      ],
      body: '',
    };
    const findings = await runPreset(
      manifest,
      { cwd: root, repoSha: null },
      { logger: silentLogger() },
    );
    expect(findings.length).toBe(0);
  });
});

describe('runPreset — PRESET-E-7 missing critic policy', () => {
  // T-4-3-1 / T-4-3-2 (B-4-3)
  it('throws PresetMissingCriticPolicyError with partialFindings when llm-judgment rule encountered without criticPolicy', async () => {
    writeFile('src/a.ts', 'TODO: one\nTODO: two\n');
    const manifest: PresetManifest = {
      id: 'mix',
      version: 2,
      name: 'mix',
      rules: [
        {
          ruleId: 'grep-1',
          label: 'find TODO',
          severity: 'P3',
          mechanism: 'static-grep',
          source: 'fixture',
          detection: { pattern: 'TODO' },
        },
        {
          ruleId: 'llm-1',
          label: 'llm rule',
          severity: 'P2',
          mechanism: 'llm-judgment',
          source: 'fixture',
          detection: { prompt: 'judge {{file}}' },
          llmPolicy: { criticEnforce: true },
        },
      ],
      body: '',
    };

    let caught: unknown;
    try {
      await runPreset(manifest, { cwd: root, repoSha: null }, { logger: silentLogger() });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect((caught as Error).message).toMatch(/^PRESET-E-7/);
    expect((caught as { partialFindings: unknown[] }).partialFindings).toBeInstanceOf(Array);
    expect((caught as { partialFindings: unknown[] }).partialFindings.length).toBe(2);
  });
});
