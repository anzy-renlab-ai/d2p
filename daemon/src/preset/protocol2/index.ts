/**
 * Protocol-2 Preset Framework — barrel export.
 *
 * Surface authority: docs/details/13-protocol-2-public-surface.md
 */

export { PRESET_PROTOCOL_VERSION } from './types.js';
export type {
  Severity,
  PresetMechanism,
  LookupSource,
  Finding,
  PresetRule,
  PresetManifest,
  LoadedPreset,
  FixDeclaration,
  LlmRulePolicy,
  StaticGrepDetection,
  FileExistsDetection,
  TestExecutionDetection,
  CrossFileCohesionDetection,
  LlmJudgmentDetection,
} from './types.js';

export { PresetError, PresetMissingCriticPolicyError } from './errors.js';
export type { PresetErrorCode } from './errors.js';

export { buildFindingId } from './finding-id.js';
export type { BuildFindingIdInput, BuildFindingIdResult } from './finding-id.js';

export { loadPreset, listPresets } from './loader.js';
export type { LoadOptions } from './loader.js';

export { runPreset } from './runner.js';
export type { RunContext, RunOptions, CriticPolicy } from './runner.js';
