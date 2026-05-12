import type { ClaudeRole } from '../types.js';
import { TEMPLATES, REQUIRED_PLACEHOLDERS, FORBIDDEN_SUBSTRINGS } from './templates.js';

export class MissingPlaceholderError extends Error {
  constructor(role: ClaudeRole, key: string) {
    super(`missing placeholder ${JSON.stringify(key)} for role ${role}`);
    this.name = 'MissingPlaceholderError';
  }
}

export class PromptInjectionError extends Error {
  constructor(key: string, marker: string) {
    super(`prompt injection: placeholder ${JSON.stringify(key)} contains forbidden marker ${marker}`);
    this.name = 'PromptInjectionError';
  }
}

/**
 * Render a prompt template by substituting `{{key}}` placeholders.
 *
 * Throws if any required placeholder is missing, or if any provided value
 * contains a forbidden end-marker that would let user input close a prompt
 * section early (injection).
 */
export function renderPrompt(role: ClaudeRole, inputs: Record<string, string>): string {
  const required = REQUIRED_PLACEHOLDERS[role];
  for (const key of required) {
    if (!(key in inputs)) throw new MissingPlaceholderError(role, key);
    const value = inputs[key] ?? '';
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      if (value.includes(forbidden)) {
        throw new PromptInjectionError(key, forbidden);
      }
    }
  }
  let out = TEMPLATES[role];
  for (const [k, v] of Object.entries(inputs)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}
