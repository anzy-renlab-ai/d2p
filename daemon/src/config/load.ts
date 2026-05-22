import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import type { AppConfig, EngineConfig, GitHubConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { ALL_PROJECT_TYPES } from '../types.js';

void ALL_PROJECT_TYPES;

const ModelMap = z.object({
  haiku: z.string().min(1),
  sonnet: z.string().min(1),
  opus: z.string().min(1),
});

const ClaudeCliSchema = z.object({
  kind: z.literal('claude-cli'),
  bin: z.string().optional(),
});

const OpenAICompatSchema = z.object({
  kind: z.literal('openai-compat'),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  models: ModelMap,
  extraHeaders: z.record(z.string()).optional(),
});

const AnthropicApiSchema = z.object({
  kind: z.literal('anthropic-api'),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
  models: ModelMap,
});

const PartialModelMap = z.object({
  haiku: z.string().min(1).optional(),
  sonnet: z.string().min(1).optional(),
  opus: z.string().min(1).optional(),
});

const CodexCliSchema = z.object({
  kind: z.literal('codex-cli'),
  bin: z.string().optional(),
  models: PartialModelMap.optional(),
});

const GeminiCliSchema = z.object({
  kind: z.literal('gemini-cli'),
  bin: z.string().optional(),
  models: PartialModelMap.optional(),
});

const EngineSchema = z.discriminatedUnion('kind', [
  ClaudeCliSchema,
  OpenAICompatSchema,
  AnthropicApiSchema,
  CodexCliSchema,
  GeminiCliSchema,
]);

const GitHubSchema = z.object({
  token: z.string().min(1),
  baseBranch: z.string().min(1).default('main'),
  authorName: z.string().optional(),
  authorEmail: z.string().optional(),
});

const CostBudgetSchema = z.object({
  softUsd: z.number().positive(),
  hardUsd: z.number().positive(),
  onSoftBreach: z.enum(['downgrade', 'pause']).default('downgrade'),
}).refine((b) => b.hardUsd >= b.softUsd, { message: 'hardUsd must be >= softUsd' });

const LoopCapsSchema = z.object({
  wallClockHours: z.number().positive().optional(),
  maxConsecutiveEscalates: z.number().int().positive().optional(),
  maxIterations: z.number().int().positive().optional(),
});

export const AppConfigSchema = z.object({
  engine: EngineSchema,
  /** F1: optional second engine used by reviewer roles (cross-family critic). */
  criticEngine: EngineSchema.optional(),
  /** F6: optional cost budget cap. */
  costBudget: CostBudgetSchema.optional(),
  /** Loop auto-stop conditions (wall-clock / escalate streak / iterations). */
  loopCaps: LoopCapsSchema.optional(),
  github: GitHubSchema.optional(),
});

export function defaultConfigPath(): string {
  return process.env.D2P_CONFIG_PATH ?? path.join(os.homedir(), '.d2p', 'config.json');
}

/** Read + validate config; falls back to DEFAULT_CONFIG when file missing. */
export async function loadConfig(file: string = defaultConfigPath()): Promise<AppConfig> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const result = AppConfigSchema.safeParse(parsed);
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.warn(
        `[d2p config] invalid config at ${file}: ${result.error.message}. Falling back to defaults.`,
      );
      return DEFAULT_CONFIG;
    }
    return result.data as AppConfig;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return DEFAULT_CONFIG;
    // eslint-disable-next-line no-console
    console.warn(`[d2p config] read failed: ${err.message}. Falling back to defaults.`);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(cfg: AppConfig, file: string = defaultConfigPath()): Promise<void> {
  // Validate before writing — fail loud if caller passed garbage.
  AppConfigSchema.parse(cfg);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cfg, null, 2), 'utf8');
}

/** Redact secret-bearing fields for safe UI display. */
export function redactForView(cfg: AppConfig): AppConfig {
  const cloned: AppConfig = JSON.parse(JSON.stringify(cfg));
  if (cloned.engine.kind === 'openai-compat' || cloned.engine.kind === 'anthropic-api') {
    cloned.engine.apiKey = maskSecret(cloned.engine.apiKey);
  }
  if (cloned.criticEngine && (cloned.criticEngine.kind === 'openai-compat' || cloned.criticEngine.kind === 'anthropic-api')) {
    cloned.criticEngine.apiKey = maskSecret(cloned.criticEngine.apiKey);
  }
  if (cloned.github) cloned.github.token = maskSecret(cloned.github.token);
  return cloned;
}

function maskSecret(v: string): string {
  if (v.length <= 8) return '****';
  return v.slice(0, 4) + '…' + v.slice(-4);
}

export function describeEngine(cfg: EngineConfig): string {
  switch (cfg.kind) {
    case 'claude-cli':
      return `claude-cli (${cfg.bin ?? 'PATH:claude'})`;
    case 'openai-compat':
      return `openai-compat @ ${cfg.baseUrl}`;
    case 'anthropic-api':
      return `anthropic-api @ ${cfg.baseUrl ?? 'https://api.anthropic.com'}`;
    case 'codex-cli':
      return `codex-cli (${cfg.bin ?? 'PATH:codex'})`;
    case 'gemini-cli':
      return `gemini-cli (${cfg.bin ?? 'PATH:gemini'})`;
  }
}

export function describeGitHub(cfg: GitHubConfig | undefined): string {
  if (!cfg) return '(not configured)';
  return `base=${cfg.baseBranch}, token=${maskSecret(cfg.token)}`;
}
