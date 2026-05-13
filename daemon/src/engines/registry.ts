// Process-wide singleton holding the current LLMEngine. Set once at daemon
// boot from AppConfig, may be hot-swapped by /api/config POST.

import type { LLMEngine } from './types.js';
import type { EngineConfig } from '../config/types.js';
import { buildEngine } from './factory.js';

let active: LLMEngine | null = null;
let activeConfig: EngineConfig | null = null;

export function setActiveEngine(cfg: EngineConfig): LLMEngine {
  active = buildEngine(cfg);
  activeConfig = cfg;
  return active;
}

export function getActiveEngine(): LLMEngine {
  if (!active) {
    // Default fallback so unit tests / daemon-not-bootstrapped paths still
    // produce a non-throwing engine.
    active = buildEngine({ kind: 'claude-cli' });
    activeConfig = { kind: 'claude-cli' };
  }
  return active;
}

export function currentEngineConfig(): EngineConfig | null {
  return activeConfig;
}
