/**
 * Protocol-2 Preset Framework — error classes.
 *
 * Surface authority: docs/details/13-protocol-2-public-surface.md §"Error codes"
 * + §"Error class exports".
 */

import type { Finding } from './types.js';

export type PresetErrorCode =
  | 'PRESET-E-1'
  | 'PRESET-E-2'
  | 'PRESET-E-3'
  | 'PRESET-E-4'
  | 'PRESET-E-5'
  | 'PRESET-E-6'
  | 'PRESET-E-7'
  | 'PRESET-E-8';

export class PresetError extends Error {
  readonly code: PresetErrorCode;
  constructor(code: PresetErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PresetError';
    this.code = code;
  }
}

export class PresetMissingCriticPolicyError extends PresetError {
  readonly partialFindings: Finding[];
  constructor(message: string, partialFindings: Finding[]) {
    super('PRESET-E-7', message);
    this.name = 'PresetMissingCriticPolicyError';
    this.partialFindings = partialFindings;
  }
}
