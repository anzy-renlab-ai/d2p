// Persistent user config at ~/.d2p/config.json — loaded at daemon start +
// re-read on each session start. The default config keeps the existing
// `claude-cli` behavior so nothing breaks for users who haven't touched
// settings.

import type { ClaudeModel } from '../types.js';

export type EngineKind = 'claude-cli' | 'openai-compat' | 'anthropic-api';

export interface ClaudeCliEngineConfig {
  kind: 'claude-cli';
  /** Path to the `claude` binary; defaults to PATH lookup. */
  bin?: string;
}

export interface OpenAICompatEngineConfig {
  kind: 'openai-compat';
  /** e.g. "https://api.openai.com/v1", "https://openrouter.ai/api/v1",
   *  "https://api.deepseek.com/v1", "https://open.bigmodel.cn/api/paas/v4". */
  baseUrl: string;
  /** API key sent as Bearer. */
  apiKey: string;
  /** Map d2p model tier → provider-specific model id. */
  models: Record<ClaudeModel, string>;
  /** Extra headers (e.g. OpenRouter `HTTP-Referer` / `X-Title`). */
  extraHeaders?: Record<string, string>;
}

export interface AnthropicApiEngineConfig {
  kind: 'anthropic-api';
  baseUrl?: string; // defaults to https://api.anthropic.com
  apiKey: string;
  models: Record<ClaudeModel, string>;
}

export type EngineConfig =
  | ClaudeCliEngineConfig
  | OpenAICompatEngineConfig
  | AnthropicApiEngineConfig;

export interface GitHubConfig {
  /** PAT with `repo` scope (or fine-grained equivalent). */
  token: string;
  /** Default base branch for PRs. */
  baseBranch: string;
  /** Author name + email used for commits in GitHub PR mode. */
  authorName?: string;
  authorEmail?: string;
}

export interface AppConfig {
  engine: EngineConfig;
  github?: GitHubConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  engine: { kind: 'claude-cli' },
};
