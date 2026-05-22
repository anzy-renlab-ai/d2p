// Persistent user config at ~/.d2p/config.json — loaded at daemon start +
// re-read on each session start. The default config keeps the existing
// `claude-cli` behavior so nothing breaks for users who haven't touched
// settings.

import type { ClaudeModel } from '../types.js';

export type EngineKind =
  | 'claude-cli'
  | 'openai-compat'
  | 'anthropic-api'
  | 'codex-cli'
  | 'gemini-cli';

export interface ClaudeCliEngineConfig {
  kind: 'claude-cli';
  /** Path to the `claude` binary; defaults to PATH lookup. */
  bin?: string;
}

/** OpenAI Codex CLI subprocess engine. The CLI handles auth (login flow or
 *  OPENAI_API_KEY) — d2p doesn't hold the key. */
export interface CodexCliEngineConfig {
  kind: 'codex-cli';
  /** Path to the `codex` binary; defaults to PATH lookup (or D2P_CODEX_BIN). */
  bin?: string;
  /** Override per-tier model ids. Omit any tier to fall back to defaults
   *  defined in engines/codex-cli.ts. */
  models?: Partial<Record<ClaudeModel, string>>;
}

/** Google Gemini CLI subprocess engine. The CLI handles auth (login flow or
 *  GEMINI_API_KEY) — d2p doesn't hold the key. */
export interface GeminiCliEngineConfig {
  kind: 'gemini-cli';
  /** Path to the `gemini` binary; defaults to PATH lookup (or D2P_GEMINI_BIN). */
  bin?: string;
  /** Override per-tier model ids. Omit any tier to fall back to defaults
   *  defined in engines/gemini-cli.ts. */
  models?: Partial<Record<ClaudeModel, string>>;
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
  | AnthropicApiEngineConfig
  | CodexCliEngineConfig
  | GeminiCliEngineConfig;

export interface GitHubConfig {
  /** PAT with `repo` scope (or fine-grained equivalent). */
  token: string;
  /** Default base branch for PRs. */
  baseBranch: string;
  /** Author name + email used for commits in GitHub PR mode. */
  authorName?: string;
  authorEmail?: string;
}

/** F6 — per-session cost budget. softUsd warns + (optionally) degrades the
 *  model tier; hardUsd aborts in-flight work. Users on token-plans (MiniMax,
 *  DeepSeek, …) leave d2p running for hours; the budget is what makes that
 *  comfortable — like Replit Agent 3's effort-based billing but visible. */
export interface CostBudget {
  /** Soft threshold in USD — when crossed, react per `onSoftBreach`. */
  softUsd: number;
  /** Hard ceiling in USD — when crossed, refuse new calls + emit BUDGET_HIT. */
  hardUsd: number;
  /** What to do on soft breach. `downgrade` flips the next call's requested
   *  tier (sonnet → haiku); `pause` requests a loop pause. */
  onSoftBreach: 'downgrade' | 'pause';
}

/** Loop-level auto-stop conditions, layered on top of CostBudget. */
export interface LoopCaps {
  /** Pause when wall-clock since LOOP_STARTED exceeds this. Default 2h. */
  wallClockHours?: number;
  /** Pause when N gaps in a row escalate to NEED_HUMAN with no MERGED in
   *  between. Default 5. */
  maxConsecutiveEscalates?: number;
  /** Override the catastrophic safety net iteration cap. Default 500. */
  maxIterations?: number;
}

export interface AppConfig {
  /** The worker — runs detector, vision, differ, implementer, repo-summary. */
  engine: EngineConfig;
  /** Optional second engine used by reviewer roles (alignment, behavioral,
   *  adversarial, done-check). If unset OR same family as `engine`, ZeroU
   *  proceeds in degraded mode and surfaces a "cross-family OFF" warning in
   *  the UI. See engines/router.ts for the policy. */
  criticEngine?: EngineConfig;
  /** Optional F6 budget cap. Omit to opt out (unbounded). */
  costBudget?: CostBudget;
  /** Optional loop auto-stop conditions (wall-clock / consecutive escalate). */
  loopCaps?: LoopCaps;
  github?: GitHubConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  engine: { kind: 'claude-cli' },
};
