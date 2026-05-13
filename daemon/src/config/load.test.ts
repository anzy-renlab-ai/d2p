import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveConfig, redactForView, AppConfigSchema } from './load.js';
import { DEFAULT_CONFIG } from './types.js';

async function tmpFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'd2p-cfg-'));
  return path.join(dir, 'config.json');
}

describe('loadConfig', () => {
  it('returns DEFAULT_CONFIG when file missing', async () => {
    const file = await tmpFile();
    const cfg = await loadConfig(file);
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('falls back to defaults on invalid JSON', async () => {
    const file = await tmpFile();
    await writeFile(file, '{not json');
    const cfg = await loadConfig(file);
    expect(cfg.engine.kind).toBe('claude-cli');
    await rm(path.dirname(file), { recursive: true, force: true });
  });

  it('round-trips openai-compat config', async () => {
    const file = await tmpFile();
    const cfg = {
      engine: {
        kind: 'openai-compat' as const,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test-key',
        models: {
          haiku: 'anthropic/claude-3-5-haiku',
          sonnet: 'anthropic/claude-sonnet-4-5',
          opus: 'anthropic/claude-opus-4-1',
        },
      },
    };
    await saveConfig(cfg, file);
    const loaded = await loadConfig(file);
    expect(loaded.engine.kind).toBe('openai-compat');
    if (loaded.engine.kind === 'openai-compat') {
      expect(loaded.engine.baseUrl).toBe('https://openrouter.ai/api/v1');
      expect(loaded.engine.apiKey).toBe('sk-test-key');
      expect(loaded.engine.models.sonnet).toBe('anthropic/claude-sonnet-4-5');
    }
    await rm(path.dirname(file), { recursive: true, force: true });
  });

  it('AppConfigSchema rejects engine missing models', () => {
    const bad = {
      engine: {
        kind: 'openai-compat',
        baseUrl: 'https://x.example/v1',
        apiKey: 'k',
        // missing models
      },
    };
    expect(AppConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe('redactForView', () => {
  it('masks api keys + github token', () => {
    const cfg = {
      engine: {
        kind: 'anthropic-api' as const,
        apiKey: 'sk-ant-abcdefghij',
        models: { haiku: 'h', sonnet: 's', opus: 'o' },
      },
      github: {
        token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        baseBranch: 'main',
      },
    };
    const r = redactForView(cfg);
    if (r.engine.kind === 'anthropic-api') {
      expect(r.engine.apiKey).not.toBe(cfg.engine.apiKey);
      expect(r.engine.apiKey.length).toBeLessThan(cfg.engine.apiKey.length);
    }
    if (r.github) {
      expect(r.github.token).not.toBe(cfg.github.token);
    }
  });
});
