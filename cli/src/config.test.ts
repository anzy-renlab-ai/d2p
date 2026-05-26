/**
 * Tests for config resolution: legacy fallback, perms, key precedence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadConfig,
  resolveKeyForProvider,
  ConfigError,
  providerForKind,
} from './config.js';
import { createTrackLogger, __resetMetaLoggersForTests, __resetLiveLoggersForTests, __resetRotationGateForTests } from './log-types.js';
import { validConfigData } from './__fixtures__/helpers.js';

let logRoot = '';
beforeEach(async () => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  logRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-cfg-test-'));
});
afterEach(async () => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
  if (logRoot) await fsp.rm(logRoot, { recursive: true, force: true }).catch(() => {});
});

function makeLogger() {
  return createTrackLogger('cli', { logRoot, silent: true });
}

describe('B-10-1 — legacy ~/.d2p/ fallback', () => {
  it('reads from ~/.d2p/config.json when ~/.zerou/ absent', async () => {
    const fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-fakehome-'));
    try {
      const legacyDir = path.join(fakeHome, '.d2p');
      fs.mkdirSync(legacyDir);
      const legacyPath = path.join(legacyDir, 'config.json');
      fs.writeFileSync(legacyPath, JSON.stringify(validConfigData));
      if (process.platform !== 'win32') fs.chmodSync(legacyPath, 0o600);
      const logger = makeLogger();
      const r = loadConfig({ homeDir: fakeHome, logger });
      expect(r.legacyUsed).toBe(true);
      expect(r.source).toBe(legacyPath);
    } finally {
      await fsp.rm(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('B-10-2 — ~/.zerou/ wins when both exist', () => {
  it('does not log legacy fallback when ~/.zerou/ present', async () => {
    const fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-fakehome-'));
    try {
      const zerouDir = path.join(fakeHome, '.zerou');
      const legacyDir = path.join(fakeHome, '.d2p');
      fs.mkdirSync(zerouDir);
      fs.mkdirSync(legacyDir);
      const zerouPath = path.join(zerouDir, 'config.json');
      fs.writeFileSync(zerouPath, JSON.stringify(validConfigData));
      fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify(validConfigData));
      if (process.platform !== 'win32') {
        fs.chmodSync(zerouPath, 0o600);
        fs.chmodSync(path.join(legacyDir, 'config.json'), 0o600);
      }
      const logger = makeLogger();
      const r = loadConfig({ homeDir: fakeHome, logger });
      expect(r.legacyUsed).toBe(false);
      expect(r.source).toBe(zerouPath);
    } finally {
      await fsp.rm(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('B-6-2 — unsafe perms on Unix', () => {
  if (process.platform === 'win32') {
    it.skip('Windows skips perm check', () => {});
    return;
  }
  it('rejects 0644 config file with A-E-4', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-perm-'));
    try {
      const cfgPath = path.join(dir, 'config.json');
      fs.writeFileSync(cfgPath, JSON.stringify(validConfigData));
      fs.chmodSync(cfgPath, 0o644);
      const logger = makeLogger();
      let caught: ConfigError | null = null;
      try {
        loadConfig({ configPath: cfgPath, logger });
      } catch (e) {
        caught = e as ConfigError;
      }
      expect(caught).not.toBeNull();
      expect(caught!.errorCode).toBe('A-E-4');
      expect(caught!.message).toMatch(/0644/);
      expect(caught!.message).toMatch(/--insecure-config/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('--insecure-config bypasses perm check', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-perm-bypass-'));
    try {
      const cfgPath = path.join(dir, 'config.json');
      fs.writeFileSync(cfgPath, JSON.stringify(validConfigData));
      fs.chmodSync(cfgPath, 0o644);
      const logger = makeLogger();
      const r = loadConfig({ configPath: cfgPath, insecureConfig: true, logger });
      expect(r.cfg.worker.modelId).toBe(validConfigData.worker.modelId);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('B-10-3 — invalid config triggers A-E-3', () => {
  it('throws ConfigError with errorCode=A-E-3 on schema mismatch', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zerou-invalid-'));
    try {
      const cfgPath = path.join(dir, 'config.json');
      fs.writeFileSync(cfgPath, JSON.stringify({ missing: 'worker' }));
      if (process.platform !== 'win32') fs.chmodSync(cfgPath, 0o600);
      const logger = makeLogger();
      let caught: ConfigError | null = null;
      try {
        loadConfig({ configPath: cfgPath, logger });
      } catch (e) {
        caught = e as ConfigError;
      }
      expect(caught).not.toBeNull();
      expect(caught!.errorCode).toBe('A-E-3');
      expect(typeof caught!.issues).toBe('string');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Q8 per-key precedence', () => {
  it('--key flag wins over env var which wins over config.keys', () => {
    const cfgKeys = { openai: 'cfg-value' };
    const env = { ZEROU_OPENAI_KEY: 'env-value' };
    const cli = new Map<string, string>([['openai', 'cli-value']]);
    expect(resolveKeyForProvider('openai', cli, env as any, cfgKeys)).toBe('cli-value');
    expect(resolveKeyForProvider('openai', new Map(), env as any, cfgKeys)).toBe('env-value');
    expect(resolveKeyForProvider('openai', new Map(), {} as any, cfgKeys)).toBe('cfg-value');
    expect(resolveKeyForProvider('openai', new Map(), {} as any, undefined)).toBeNull();
  });

  it('providerForKind maps engine kinds correctly', () => {
    expect(providerForKind('anthropic-api')).toBe('anthropic');
    expect(providerForKind('claude-cli')).toBe('anthropic');
    expect(providerForKind('openai-compat')).toBe('openai-compat');
    expect(providerForKind('codex-cli')).toBe('openai');
    expect(providerForKind('gemini-cli')).toBe('google');
  });

  it('uppercases provider with hyphens replaced for env var lookup', () => {
    const env = { ZEROU_OPENAI_COMPAT_KEY: 'compat-value' };
    expect(resolveKeyForProvider('openai-compat', new Map(), env as any, undefined)).toBe(
      'compat-value',
    );
  });
});
