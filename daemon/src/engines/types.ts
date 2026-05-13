// Engine abstraction: hides whether we call `claude` CLI, an OpenAI-compatible
// HTTP API, or the Anthropic Messages API. The interface mirrors what
// callClaude used to return — agents don't care what's under the hood.

import type { ClaudeCallResult, ClaudeModel, ClaudeRole } from '../types.js';

export interface EngineCallOpts<T> {
  role: ClaudeRole;
  model: ClaudeModel;
  prompt: string;
  /** Only used by claude-cli (sets the spawn cwd so implementer agents land
   *  in the worktree). HTTP engines ignore. */
  cwd?: string;
  timeoutMs?: number;
  schemaCheck?: (json: unknown) => json is T;
}

export interface LLMEngine {
  /** Human-readable id for logs / doctor / cost records. */
  readonly id: string;
  /** Run one prompt and return parsed JSON (or a structured error). */
  call<T = unknown>(opts: EngineCallOpts<T>): Promise<ClaudeCallResult<T>>;
  /** Optional health probe; daemon's /api/doctor uses this. */
  probe?(): Promise<{ ok: boolean; detail?: string }>;
}
