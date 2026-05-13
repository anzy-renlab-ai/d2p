import type { LLMEngine } from './types.js';
import type { EngineConfig } from '../config/types.js';
import { ClaudeCliEngine } from './claude-cli.js';
import { OpenAICompatEngine } from './openai-compat.js';
import { AnthropicApiEngine } from './anthropic-api.js';

export function buildEngine(cfg: EngineConfig): LLMEngine {
  switch (cfg.kind) {
    case 'claude-cli':
      return new ClaudeCliEngine(cfg);
    case 'openai-compat':
      return new OpenAICompatEngine(cfg);
    case 'anthropic-api':
      return new AnthropicApiEngine(cfg);
  }
}
