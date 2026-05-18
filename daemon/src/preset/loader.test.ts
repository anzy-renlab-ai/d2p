import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  listAvailablePresets,
  readPreset,
  readOverrides,
  applyOverridesToStatus,
  partitionByMechanism,
} from './loader.js';
import { PRESET_CORE_ITEMS, corePresetItemsForType, countItemsByMechanism } from './items-core.js';
import { ALL_PRESET_MECHANISMS } from '../types.js';

async function withPresetsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-presets-test-'));
  await writeFile(
    path.join(dir, 'cli-tool.md'),
    [
      '---',
      'type: cli-tool',
      'name: CLI Tool',
      'version: 1',
      '---',
      '',
      '# CLI Tool',
      '',
      '- [ ] cli-help: --help works',
      '- [ ] cli-version: --version works',
    ].join('\n'),
  );
  return dir;
}

describe('listAvailablePresets', () => {
  it('returns slugs (without .md)', async () => {
    const dir = await withPresetsDir();
    const types = await listAvailablePresets(dir);
    expect(types).toEqual(['cli-tool']);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] for non-existent dir', async () => {
    const types = await listAvailablePresets(path.join(os.tmpdir(), 'definitely-not-there-' + Date.now()));
    expect(types).toEqual([]);
  });
});

describe('readPreset', () => {
  it('parses frontmatter and body', async () => {
    const dir = await withPresetsDir();
    const p = await readPreset('cli-tool', dir);
    expect(p.frontmatter.type).toBe('cli-tool');
    expect(p.frontmatter.name).toBe('CLI Tool');
    expect(p.frontmatter.version).toBe(1);
    expect(p.body).toContain('cli-help');
    expect(p.raw).toContain('---');
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects invalid frontmatter', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-presets-bad-'));
    await writeFile(path.join(dir, 'bad.md'), '---\nno-type-field: true\n---\n');
    await expect(readPreset('bad', dir)).rejects.toThrow(/invalid preset frontmatter/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('readOverrides', () => {
  it('returns empty defaults when file missing', async () => {
    const demo = await mkdtemp(path.join(os.tmpdir(), 'd2p-demo-no-ov-'));
    const ov = await readOverrides(demo);
    expect(ov).toEqual({ add: [], remove: [], skip: [] });
    await rm(demo, { recursive: true, force: true });
  });

  it('parses a real overrides yaml', async () => {
    const demo = await mkdtemp(path.join(os.tmpdir(), 'd2p-demo-ov-'));
    await mkdir(path.join(demo, '.d2p'), { recursive: true });
    await writeFile(
      path.join(demo, '.d2p', 'preset-overrides.yaml'),
      [
        'add:',
        '  - slug: oauth-google',
        '    category: auth',
        '    description: support Google OAuth',
        '    severity: P2',
        'remove:',
        '  - cli-version',
        'skip:',
        '  - cli-help',
      ].join('\n'),
    );
    const ov = await readOverrides(demo);
    expect(ov.add).toHaveLength(1);
    expect(ov.add[0]?.slug).toBe('oauth-google');
    expect(ov.remove).toEqual(['cli-version']);
    expect(ov.skip).toEqual(['cli-help']);
    await rm(demo, { recursive: true, force: true });
  });

  it('returns empty defaults on malformed yaml', async () => {
    const demo = await mkdtemp(path.join(os.tmpdir(), 'd2p-demo-bad-ov-'));
    await mkdir(path.join(demo, '.d2p'), { recursive: true });
    await writeFile(path.join(demo, '.d2p', 'preset-overrides.yaml'), 'add:\n  - slug: !!! invalid');
    const ov = await readOverrides(demo);
    expect(ov).toEqual({ add: [], remove: [], skip: [] });
    await rm(demo, { recursive: true, force: true });
  });
});

describe('PRESET_CORE_ITEMS (32-item source-of-truth)', () => {
  it('has 32 items', () => {
    expect(PRESET_CORE_ITEMS).toHaveLength(32);
  });

  it('every item has all required fields', () => {
    for (const it of PRESET_CORE_ITEMS) {
      expect(it.id).toMatch(/^[a-z][a-z0-9-]{1,63}$/);
      expect(it.label.length).toBeGreaterThan(0);
      expect(['P1', 'P2', 'P3']).toContain(it.severity);
      expect(ALL_PRESET_MECHANISMS).toContain(it.mechanism);
      expect(it.source.length).toBeGreaterThan(0);
      expect(it.appliesTo.length).toBeGreaterThan(0);
      for (const letter of it.appliesTo) expect(letter).toMatch(/^[A-Z]{1,3}$/);
    }
  });

  it('every id is unique', () => {
    const ids = PRESET_CORE_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all 5 mechanism kinds', () => {
    const counts = countItemsByMechanism([...PRESET_CORE_ITEMS]);
    for (const m of ALL_PRESET_MECHANISMS) {
      expect(counts[m] ?? 0, `mechanism ${m} should have ≥1 item`).toBeGreaterThan(0);
    }
  });
});

describe('corePresetItemsForType', () => {
  it('saas-web includes web-only items + universal items', () => {
    const items = corePresetItemsForType('saas-web');
    expect(items.find((i) => i.id === 'auth-on-mutating-routes')).toBeDefined();
    expect(items.find((i) => i.id === 'license-file')).toBeDefined();
    expect(items.find((i) => i.id === 'package-publishable'), 'library-only').toBeUndefined();
  });

  it('library includes package-publishable + excludes web-only items', () => {
    const items = corePresetItemsForType('library');
    expect(items.find((i) => i.id === 'package-publishable')).toBeDefined();
    expect(items.find((i) => i.id === 'auth-on-mutating-routes'), 'web-only').toBeUndefined();
  });

  it('cli-tool excludes web/static items', () => {
    const items = corePresetItemsForType('cli-tool');
    expect(items.find((i) => i.id === 'a11y-axe-clean'), 'web/static only').toBeUndefined();
    expect(items.find((i) => i.id === 'viewport-meta'), 'web/static/mobile only').toBeUndefined();
    expect(items.find((i) => i.id === 'readme-quickstart')).toBeDefined();
  });

  it('unknown returns the full list', () => {
    expect(corePresetItemsForType('unknown')).toHaveLength(32);
  });
});

describe('partitionByMechanism', () => {
  it('splits cross-file-cohesion + llm-judgment to reviewer, rest to mechanical', () => {
    const items = corePresetItemsForType('saas-web');
    const { mechanical, reviewer } = partitionByMechanism(items);
    for (const it of mechanical) {
      expect(['static-grep', 'file-exists', 'test-execution']).toContain(it.mechanism);
    }
    for (const it of reviewer) {
      expect(['cross-file-cohesion', 'llm-judgment']).toContain(it.mechanism);
    }
    expect(mechanical.length + reviewer.length).toBe(items.length);
  });
});

describe('readPreset with auto-filled items', () => {
  it('falls back to corePresetItemsForType when frontmatter lacks items', async () => {
    const dir = await withPresetsDir();
    const p = await readPreset('cli-tool', dir);
    expect(p.frontmatter.items).toBeDefined();
    expect(p.frontmatter.items!.length).toBeGreaterThan(0);
    // cli-tool should NOT pick up web-only items
    expect(p.frontmatter.items!.find((i) => i.id === 'auth-on-mutating-routes')).toBeUndefined();
    expect(p.frontmatter.items!.find((i) => i.id === 'readme-quickstart')).toBeDefined();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('applyOverridesToStatus', () => {
  const items = [
    { item: 'cli-help', status: 'missing' as const, note: null },
    { item: 'cli-version', status: 'missing' as const, note: null },
  ];

  it('removes items in overrides.remove', () => {
    const out = applyOverridesToStatus(items, { add: [], remove: ['cli-help'], skip: [] });
    expect(out.map((i) => i.item)).toEqual(['cli-version']);
  });

  it('forces skipped items to done', () => {
    const out = applyOverridesToStatus(items, { add: [], remove: [], skip: ['cli-help'] });
    const cliHelp = out.find((i) => i.item === 'cli-help');
    expect(cliHelp?.status).toBe('done');
  });
});
