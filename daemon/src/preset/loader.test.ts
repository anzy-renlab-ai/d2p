import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  listAvailablePresets,
  readPreset,
  readOverrides,
  applyOverridesToStatus,
} from './loader.js';

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
