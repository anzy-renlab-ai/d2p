// Public Anthropic pricing snapshot. Update annually.
// Detail: docs/details/05-subprocess.md.

import type { ClaudeModel, TokenUsage } from '../types.js';

export const PRICING_PER_MTOK: Record<ClaudeModel, { input: number; output: number }> = {
  haiku: { input: 0.8, output: 4.0 },
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
};

export function estimateUsd(model: ClaudeModel, usage: TokenUsage): number {
  const p = PRICING_PER_MTOK[model];
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}
