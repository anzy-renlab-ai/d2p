/**
 * Config file resolution + key precedence for `zerou audit`.
 *
 * Surface: docs/details/15-hardener-cli-public-surface.md §"Config file".
 *
 * Precedence (Q8):  --key flag  >  ZEROU_<PROVIDER>_KEY env  >  config.keys[provider]
 *
 * Legacy fallback (B-10-1): ~/.zerou/config.json absent + ~/.d2p/config.json
 * present → read legacy, emit cli.config.legacy-d2p-path-used.
 *
 * Permissions (Unix only): config file MUST be mode 0600 / 0400. Otherwise
 * emit cli.config.unsafe-perms and exit 3 (A-E-4). `--insecure-config` bypasses.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import type { TrackLogger } from './log-types.js';
import type { EngineConfig, EngineKind } from './stubs.js';

const EngineKindSchema = z.enum([
  'anthropic-api',
  'openai-compat',
  'claude-cli',
  'codex-cli',
  'gemini-cli',
]);

const EngineConfigSchema = z.object({
  kind: EngineKindSchema,
  modelId: z.string().min(1),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  baseUrl: z.string().optional(),
  modelOverrides: z.record(z.unknown()).optional(),
});

export const ConfigSchema = z.object({
  worker: EngineConfigSchema,
  criticPool: z.array(EngineConfigSchema).optional(),
  keys: z.record(z.string()).optional(),
  failOn: z.enum(['p1', 'p2', 'p3', 'none']).optional(),
  costCap: z.number().optional(),
});

export type ZerouConfig = z.infer<typeof ConfigSchema>;

export interface ResolvedConfig {
  worker: EngineConfig;
  criticPool: EngineConfig[];
  failOn: 'p1' | 'p2' | 'p3' | 'none';
  costCap: number;
  /** Path that was actually read. */
  source: string;
  /** Whether legacy `~/.d2p/` fallback was used. */
  legacyUsed: boolean;
}

export class ConfigError extends Error {
  readonly errorCode: 'A-E-3' | 'A-E-4';
  readonly issues?: string;
  readonly mode?: string;
  constructor(
    errorCode: 'A-E-3' | 'A-E-4',
    message: string,
    extras: { issues?: string; mode?: string } = {},
  ) {
    super(message);
    this.errorCode = errorCode;
    this.issues = extras.issues;
    this.mode = extras.mode;
  }
}

export interface LoadConfigOptions {
  configPath?: string;
  insecureConfig?: boolean;
  homeDir?: string;          // test override
  logger: TrackLogger;
}

/**
 * Loads config from --config / ~/.zerou/ / ~/.d2p/ (legacy fallback).
 * Throws ConfigError on validation / perms failure.
 * Returns a parsed config with no key fields (keys handled separately, see
 * `resolveKeyForProvider`).
 */
export function loadConfig(opts: LoadConfigOptions): {
  cfg: ZerouConfig;
  source: string;
  legacyUsed: boolean;
  rawText: string;
} {
  const home = opts.homeDir ?? os.homedir();
  const explicit = opts.configPath;
  let source: string;
  let legacyUsed = false;
  if (explicit) {
    source = path.resolve(explicit);
  } else {
    const zerouPath = path.join(home, '.zerou', 'config.json');
    const legacyPath = path.join(home, '.d2p', 'config.json');
    if (fs.existsSync(zerouPath)) {
      source = zerouPath;
    } else if (fs.existsSync(legacyPath)) {
      source = legacyPath;
      legacyUsed = true;
    } else {
      // Neither exists: this is NOT a config error — caller may proceed
      // without any config (e.g. when worker is built solely from env).
      // Return empty config sentinel.
      throw new ConfigError(
        'A-E-3',
        `no config found at ${zerouPath} or ${legacyPath}`,
        { issues: 'missing-file' },
      );
    }
  }

  // Permission check (Unix only, skipped on win32).
  if (process.platform !== 'win32' && !opts.insecureConfig) {
    let mode: number;
    try {
      mode = fs.statSync(source).mode & 0o777;
    } catch {
      mode = 0;
    }
    // Allowed: 0600 / 0400. Anything broader is unsafe.
    const allowed = mode === 0o600 || mode === 0o400;
    if (!allowed) {
      const modeStr = mode.toString(8).padStart(4, '0');
      opts.logger.log('error', 'cli.config.unsafe-perms', {
        path: source,
        mode: modeStr,
      });
      throw new ConfigError(
        'A-E-4',
        `~/.zerou/config.json has unsafe permissions (${modeStr}). chmod 600 the file, or pass --insecure-config to override.`,
        { mode: modeStr },
      );
    }
  } else if (process.platform === 'win32' && !opts.insecureConfig) {
    opts.logger.log('debug', 'cli.config.windows-permission-check-skipped', {});
  }

  let raw: string;
  try {
    raw = fs.readFileSync(source, 'utf8');
  } catch (e) {
    throw new ConfigError('A-E-3', `cannot read config: ${(e as Error).message}`, {
      issues: 'read-failed',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError('A-E-3', `config is not valid JSON: ${(e as Error).message}`, {
      issues: 'json-parse-failed',
    });
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError('A-E-3', `config validation failed`, {
      issues: JSON.stringify(result.error.issues),
    });
  }
  if (legacyUsed) {
    opts.logger.log('info', 'cli.config.legacy-d2p-path-used', {
      fallbackPath: source,
    });
  }
  return { cfg: result.data, source, legacyUsed, rawText: raw };
}

/**
 * Per-key precedence: --key flag > ZEROU_<PROVIDER>_KEY env > config.keys[provider]
 */
export function resolveKeyForProvider(
  provider: string,
  cliKeys: Map<string, string>,
  envProvider: NodeJS.ProcessEnv,
  cfgKeys: Record<string, string> | undefined,
): string | null {
  const flag = cliKeys.get(provider);
  if (flag) return flag;
  const envName = `ZEROU_${provider.toUpperCase().replace(/-/g, '_')}_KEY`;
  if (envProvider[envName]) return envProvider[envName]!;
  if (cfgKeys && cfgKeys[provider]) return cfgKeys[provider]!;
  return null;
}

/** Pick the provider name (used in ZEROU_<PROVIDER>_KEY lookup) for an engine kind. */
export function providerForKind(kind: EngineKind): string {
  switch (kind) {
    case 'anthropic-api':
    case 'claude-cli':
      return 'anthropic';
    case 'openai-compat':
      return 'openai-compat';
    case 'codex-cli':
      return 'openai';
    case 'gemini-cli':
      return 'google';
  }
}
