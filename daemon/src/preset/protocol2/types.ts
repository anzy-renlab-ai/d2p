/**
 * Protocol-2 Preset Framework — public core types.
 *
 * Surface authority: docs/details/13-protocol-2-public-surface.md
 *
 * Every type in §"Core types" of the surface lives here. Mechanism-specific
 * detection-config shapes live alongside (StaticGrepDetection, etc.).
 */

export const PRESET_PROTOCOL_VERSION = '1.0' as const;

export type Severity = 'P1' | 'P2' | 'P3';

export type PresetMechanism =
  | 'static-grep'
  | 'file-exists'
  | 'test-execution'
  | 'cross-file-cohesion'
  | 'llm-judgment';

export type LookupSource = 'plugin' | 'project' | 'builtin';

export interface Finding {
  id: string;
  presetId: string;
  ruleId: string;
  severity: Severity;
  file: string;
  line: number;
  evidence: string;
  matched_content_normalized: string;
  message: string;
  remediationHint: string | null;
  fixAvailable: 'template' | 'llm-only' | null;
  version: '1.0';
}

export interface FixDeclaration {
  kind: 'template' | 'llm-only';
  command?: string;
  verifyCommand?: string;
}

export interface LlmRulePolicy {
  criticEnforce: boolean;
  maxTokens?: number;
}

export interface PresetRule {
  ruleId: string;
  label: string;
  severity: Severity;
  mechanism: PresetMechanism;
  source: string;
  rationale?: string;
  detection: Record<string, unknown>;
  fix?: FixDeclaration;
  llmPolicy?: LlmRulePolicy;
}

export interface PresetManifest {
  id: string;
  version: number;
  name: string;
  appliesTo?: string[];
  dependsOn?: string[];
  rules: PresetRule[];
  body: string;
}

export interface LoadedPreset {
  manifest: PresetManifest;
  source: LookupSource;
  resolvedPath: string;
  shadowedBy: LookupSource[];
}

// ── Per-mechanism detection schemas (surface §"Per-mechanism detection") ────

export interface StaticGrepDetection {
  pattern: string;
  flags?: string;
  filePattern?: string;
  timeoutMs?: number;
}

export interface FileExistsDetection {
  paths: string[];
  expect: 'present' | 'absent';
  timeoutMs?: number;
}

export interface TestExecutionDetection {
  command: string;
  args?: string[];
  failOn: 'exitCode' | 'stderrPattern';
  stderrPattern?: string;
  timeoutMs?: number;
}

export interface CrossFileCohesionDetection {
  analyzer: 'env-vs-env-example' | 'package-json-vs-lock';
  config?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface LlmJudgmentDetection {
  prompt: string;
  filePattern?: string;
}
