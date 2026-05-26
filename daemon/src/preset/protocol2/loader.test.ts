import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPreset, listPresets } from './loader.js';
import { captureLogsFor } from '../../log/test-helpers.js';
import { createTrackLogger } from '../../log/track-logger.js';
import {
  mkPreset,
  MIN_PRESET,
  UNKNOWN_KEY_PRESET,
  MISSING_NAME_PRESET,
  BAD_VERSION_PRESET,
  ZERO_RULES_PRESET,
  DUP_RULE_ID_PRESET,
  LLM_NO_POLICY_PRESET,
  BAD_REGEX_PRESET,
  PRESET_NAMED,
  PRESET_WITH_LLM_RULE,
} from './__fixtures__/fixtures.js';

let root: string;

function silentLogger() {
  // minLevel: 'debug' so observer captures debug-level events too (B-3-2).
  return createTrackLogger('preset', { silent: true, minLevel: 'debug' });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'zerou-p2-loader-'));
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe('loadPreset — B-1 happy/sad path', () => {
  // T-1-1-1 (B-1-1)
  it('resolves a builtin-only preset and returns a LoadedPreset', async () => {
    const filePath = mkPreset(root, 'builtin', 'cli-tool', MIN_PRESET({ id: 'cli-tool' }));
    const { result, entries } = await captureLogsFor({ track: 'preset' }, async () => {
      return loadPreset('cli-tool', {
        cwd: root,
        builtinDir: path.join(root, '__builtin__'),
        logger: silentLogger(),
      });
    });
    expect(result.source).toBe('builtin');
    expect(result.manifest.id).toBe('cli-tool');
    expect(result.manifest.version).toBe(2);
    expect(result.manifest.rules.length).toBe(1);
    expect(result.resolvedPath).toBe(filePath);
    expect(result.shadowedBy).toEqual([]);

    const eventNames = entries.map((e) => e.event);
    expect(eventNames).toContain('preset.load.start');
    expect(eventNames).toContain('preset.load.resolved');
    expect(eventNames).toContain('preset.load.success');
    expect(eventNames).not.toContain('preset.load.shadowed');
    expect(eventNames).not.toContain('preset.load.failure');
    // Order: start → resolved → success
    expect(eventNames.indexOf('preset.load.start')).toBeLessThan(eventNames.indexOf('preset.load.resolved'));
    expect(eventNames.indexOf('preset.load.resolved')).toBeLessThan(eventNames.indexOf('preset.load.success'));
  });

  // T-1-2-1 (B-1-2)
  it('rejects PRESET-E-1 when id is unknown', async () => {
    const { entries } = await captureLogsFor({ track: 'preset' }, async () => {
      await expect(
        loadPreset('does-not-exist', {
          cwd: root,
          builtinDir: path.join(root, '__builtin__'),
          logger: silentLogger(),
        }),
      ).rejects.toThrow(/^PRESET-E-1/);
      return null;
    });
    const failure = entries.find((e) => e.event === 'preset.load.failure');
    expect(failure).toBeTruthy();
    expect(failure!.errorCode).toBe('PRESET-E-1');
  });

  // T-1-2-2 (B-1-2 case-mismatch invalid id)
  it('rejects PRESET-E-2 when input id is invalid (uppercase)', async () => {
    mkPreset(root, 'project', 'cli-tool', MIN_PRESET({ id: 'cli-tool' }));
    await expect(
      loadPreset('CLI-TOOL', {
        cwd: root,
        builtinDir: path.join(root, '__builtin__'),
        projectDir: path.join(root, '.zerou', 'presets'),
        logger: silentLogger(),
      }),
    ).rejects.toThrow(/^PRESET-E-2/);
  });
});

describe('loadPreset — B-2 three-layer lookup + shadow', () => {
  // T-2-1-1 (B-2-1)
  it('listPresets returns a single entry with plugin winning when shadowed at all three layers', async () => {
    mkPreset(root, 'plugin', 'cli-tool', PRESET_NAMED('plugin-version', 'cli-tool'));
    mkPreset(root, 'project', 'cli-tool', PRESET_NAMED('project-version', 'cli-tool'));
    mkPreset(root, 'builtin', 'cli-tool', PRESET_NAMED('builtin-version', 'cli-tool'));

    const { result, entries } = await captureLogsFor({ track: 'preset' }, async () =>
      listPresets({
        cwd: root,
        builtinDir: path.join(root, '__builtin__'),
        projectDir: path.join(root, '.zerou', 'presets'),
        logger: silentLogger(),
      }),
    );

    const match = result.find((p) => p.manifest.id === 'cli-tool');
    expect(match).toBeTruthy();
    expect(match!.source).toBe('plugin');
    expect(match!.shadowedBy.slice().sort()).toEqual(['builtin', 'project']);

    const shadowed = entries.find((e) => e.event === 'preset.load.shadowed');
    expect(shadowed).toBeTruthy();
    expect(shadowed!.winningSource).toBe('plugin');
    expect((shadowed!.shadowedSources as string[]).slice().sort()).toEqual(['builtin', 'project']);
  });

  // T-2-2-1 (B-2-2)
  it('loadPreset returns plugin manifest when all three layers carry the same id', async () => {
    mkPreset(root, 'plugin', 'cli-tool', PRESET_NAMED('plugin-version', 'cli-tool'));
    mkPreset(root, 'project', 'cli-tool', PRESET_NAMED('project-version', 'cli-tool'));
    mkPreset(root, 'builtin', 'cli-tool', PRESET_NAMED('builtin-version', 'cli-tool'));

    const result = await loadPreset('cli-tool', {
      cwd: root,
      builtinDir: path.join(root, '__builtin__'),
      projectDir: path.join(root, '.zerou', 'presets'),
      logger: silentLogger(),
    });
    expect(result.manifest.name).toBe('plugin-version');
    expect(result.source).toBe('plugin');
    expect(result.shadowedBy.slice().sort()).toEqual(['builtin', 'project']);
  });
});

describe('loadPreset — B-3 manifest validation', () => {
  function commonOpts() {
    return {
      cwd: root,
      builtinDir: path.join(root, '__builtin__'),
      logger: silentLogger(),
    };
  }

  it('PRESET-E-2 on unknown frontmatter key', async () => {
    mkPreset(root, 'builtin', 'cli-tool', UNKNOWN_KEY_PRESET());
    await expect(loadPreset('cli-tool', commonOpts())).rejects.toThrow(/^PRESET-E-2/);
  });

  it('PRESET-E-2 on missing required name', async () => {
    mkPreset(root, 'builtin', 'cli-tool', MISSING_NAME_PRESET());
    await expect(loadPreset('cli-tool', commonOpts())).rejects.toThrow(/^PRESET-E-2/);
  });

  it('PRESET-E-2 on version type mismatch', async () => {
    mkPreset(root, 'builtin', 'cli-tool', BAD_VERSION_PRESET());
    await expect(loadPreset('cli-tool', commonOpts())).rejects.toThrow(/^PRESET-E-2/);
  });

  it('PRESET-E-3 on zero rules', async () => {
    mkPreset(root, 'builtin', 'cli-tool', ZERO_RULES_PRESET());
    await expect(loadPreset('cli-tool', commonOpts())).rejects.toThrow(/^PRESET-E-3/);
  });

  it('PRESET-E-3 on duplicate ruleId', async () => {
    mkPreset(root, 'builtin', 'cli-tool', DUP_RULE_ID_PRESET());
    await expect(loadPreset('cli-tool', commonOpts())).rejects.toThrow(/^PRESET-E-3/);
  });

  it('PRESET-E-4 on llm-judgment rule missing llmPolicy', async () => {
    mkPreset(root, 'builtin', 'cli-tool', LLM_NO_POLICY_PRESET());
    await expect(loadPreset('cli-tool', commonOpts())).rejects.toThrow(/^PRESET-E-4/);
  });

  it('PRESET-E-6 on unterminated regex pattern', async () => {
    mkPreset(root, 'builtin', 'cli-tool', BAD_REGEX_PRESET());
    await expect(loadPreset('cli-tool', commonOpts())).rejects.toThrow(/^PRESET-E-6/);
  });

  it('accepts llm-judgment rule when llmPolicy is provided', async () => {
    mkPreset(
      root,
      'builtin',
      'cli-tool',
      PRESET_WITH_LLM_RULE({ id: 'cli-tool', criticEnforce: true, maxTokens: 256 }),
    );
    const result = await loadPreset('cli-tool', commonOpts());
    expect(result.manifest.rules[0]!.mechanism).toBe('llm-judgment');
    expect(result.manifest.rules[0]!.llmPolicy?.criticEnforce).toBe(true);
    expect(result.manifest.rules[0]!.llmPolicy?.maxTokens).toBe(256);
  });
});
