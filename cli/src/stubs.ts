/**
 * Cross-track stubs for Track A.
 *
 * These types/functions mirror the public surfaces of:
 * - Track P2 (`daemon/src/preset/*`) — `loadPreset`, `listPresets`, `runPreset`
 * - Track P1 (`daemon/src/protocol/cross-engine-reviewer/*`) — `reviewBatch`,
 *   `engineFamily`, `selectCriticPolicy`
 *
 * Lead will replace these with real imports during integration. Tests in this
 * package inject mocks via vitest module mock or by passing the optional
 * `deps` parameter to `runAudit`.
 */
import path from 'node:path';

// ── Engine config (Protocol-1 / Q8) ──────────────────────────────────────────

export type EngineKind =
  | 'anthropic-api'
  | 'openai-compat'
  | 'claude-cli'
  | 'codex-cli'
  | 'gemini-cli';

export interface EngineConfig {
  kind: EngineKind;
  modelId: string;
  releaseDate: string;
  baseUrl?: string;
  apiKey?: string;
  modelOverrides?: Record<string, unknown>;
}

export function engineFamily(cfg: EngineConfig): string {
  switch (cfg.kind) {
    case 'anthropic-api':
    case 'claude-cli':
      return 'anthropic';
    case 'openai-compat': {
      if (cfg.baseUrl) {
        try {
          return new URL(cfg.baseUrl).hostname;
        } catch {
          return 'openai-compat';
        }
      }
      return 'openai';
    }
    case 'codex-cli':
      return 'openai';
    case 'gemini-cli':
      return 'google';
    default:
      return 'unknown';
  }
}

// ── Preset types (Protocol-2) ────────────────────────────────────────────────

export interface PresetRule {
  id: string;
  severity: 'P1' | 'P2' | 'P3';
  mechanism?: 'static-grep' | 'llm-judgment';
  message?: string;
  // Static-grep extras
  pattern?: string;
  filePattern?: string;
  // Fix declaration
  fix?: {
    kind: 'template' | 'llm-only';
    command?: string;          // template: shell command, or codemod descriptor
    template?: string;         // template: regex replace `{find: ..., replace: ...}`
    find?: string;
    replace?: string;
    verifyCommand?: string;    // per dispatch-note #12
  };
}

export interface PresetManifest {
  id: string;
  version?: number;
  appliesTo?: string[];
  rules: PresetRule[];
  body: string;
}

export interface LoadedPreset {
  manifest: PresetManifest;
  source: 'plugin' | 'project' | 'builtin';
  resolvedPath: string;
  shadowedBy: ('plugin' | 'project' | 'builtin')[];
}

export interface Finding {
  id: string;
  presetId: string;
  ruleId: string;
  severity: 'P1' | 'P2' | 'P3';
  file: string;       // repo-relative POSIX
  line: number;
  col?: number;
  evidence: string;
  message: string;
}

export interface VerdictedFinding extends Finding {
  verdict: 'confirmed' | 'false-positive' | 'needs-context' | 'critic-unavailable';
  verdictReason?: string;
  criticFamily?: string;
}

export interface FixProposal {
  patch?: string;       // unified diff
  verified: boolean;
  reasoning?: string;
  // template-fix path:
  templateApplied?: boolean;
}

export interface CriticPolicy {
  crossFamily: boolean;
  reason?: string;
  workerFamily: string;
  criticConfig: EngineConfig | null;
}

export interface RunPresetOptions {
  cwd: string;
  logger: any;
  criticPolicy: CriticPolicy;
  worker: EngineConfig;
  // file reads tracked here
  readFiles?: Set<string>;
}

export interface PresetDeps {
  loadPreset(id: string, opts?: LoadPresetOptions): Promise<LoadedPreset>;
  listPresets(opts?: LoadPresetOptions): Promise<LoadedPreset[]>;
  runPreset(
    manifest: PresetManifest,
    ctx: RunPresetOptions,
  ): Promise<VerdictedFinding[]>;
  proposeFix(
    finding: VerdictedFinding,
    preset: LoadedPreset,
    ctx: { cwd: string; worker: EngineConfig; logger: any },
  ): Promise<FixProposal | null>;
}

export interface LoadPresetOptions {
  cwd: string;
  pluginDirs?: string[];
  builtinDir?: string;
  projectDir?: string;
}

// Track P2 stubs — throw on real-call so tests must inject deps explicitly.

export async function loadPreset(_id: string, _opts?: LoadPresetOptions): Promise<LoadedPreset> {
  throw new Error('STUB: Track P2 loadPreset not yet integrated; inject via deps');
}

export async function listPresets(_opts?: LoadPresetOptions): Promise<LoadedPreset[]> {
  throw new Error('STUB: Track P2 listPresets not yet integrated; inject via deps');
}

export async function runPreset(
  _manifest: PresetManifest,
  _ctx: RunPresetOptions,
): Promise<VerdictedFinding[]> {
  throw new Error('STUB: Track P2 runPreset not yet integrated; inject via deps');
}

export async function proposeFix(
  _finding: VerdictedFinding,
  _preset: LoadedPreset,
  _ctx: { cwd: string; worker: EngineConfig; logger: any },
): Promise<FixProposal | null> {
  throw new Error('STUB: Track P1 proposeFix not yet integrated; inject via deps');
}

// ── Default minimal preset built-in for dogfood ──────────────────────────────

/**
 * A bare-minimum static-grep preset compiled into the CLI so that dogfood works
 * before Track P2 ships. Mirrors what Track P2's built-in registry will host.
 * This is intentionally narrow scope: enough to find a hard-coded LLM key in
 * source files.
 */
export const HARDCODED_KEY_PRESET: LoadedPreset = {
  manifest: {
    id: 'no-hardcoded-llm-keys',
    version: 1,
    appliesTo: ['cli-tool', 'saas-web'],
    rules: [
      {
        id: 'stripe-key',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: 'sk_(live|test)_[A-Za-z0-9]{6,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
        message: 'Hard-coded Stripe key detected',
        fix: {
          kind: 'template',
          find: 'sk_(live|test)_[A-Za-z0-9]{6,}',
          replace: 'process.env.STRIPE_KEY!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'openai-key',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: 'sk-[A-Za-z0-9]{20,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
        message: 'Hard-coded OpenAI key detected',
        fix: {
          kind: 'template',
          find: 'sk-[A-Za-z0-9]{20,}',
          replace: 'process.env.OPENAI_KEY!',
          verifyCommand: 'true',
        },
      },
    ],
    body: 'Move secrets to environment variables. Never commit real keys.',
  },
  source: 'builtin',
  resolvedPath: '<built-in>',
  shadowedBy: [],
};

// ── Cross-engine reviewer policy (Track P1 stub) ────────────────────────────

export function selectCriticPolicy(
  worker: EngineConfig,
  criticPool: EngineConfig[],
): CriticPolicy {
  const workerFamily = engineFamily(worker);
  if (criticPool.length === 0) {
    return {
      crossFamily: false,
      reason: 'no-critic-configured',
      workerFamily,
      criticConfig: null,
    };
  }
  const crossFamilyCritic = criticPool.find(
    (c) => engineFamily(c) !== workerFamily,
  );
  if (crossFamilyCritic) {
    return {
      crossFamily: true,
      workerFamily,
      criticConfig: crossFamilyCritic,
    };
  }
  return {
    crossFamily: false,
    reason: 'same-family-only',
    workerFamily,
    criticConfig: null,
  };
}

// ── Builtin runPreset: static-grep implementation for dogfood / stub ────────

/**
 * Default `runPreset` implementation: scans files matching `filePattern`,
 * runs the rule's regex, emits a Finding per match. No LLM verdict — every
 * finding is marked `critic-unavailable` unless `criticPolicy.crossFamily`,
 * in which case findings are marked `confirmed` (this is a placeholder until
 * Track P1's real critic ships).
 */
import * as nodeFs from 'node:fs';

export async function defaultRunPreset(
  manifest: PresetManifest,
  ctx: RunPresetOptions,
): Promise<VerdictedFinding[]> {
  const findings: VerdictedFinding[] = [];

  for (const rule of manifest.rules) {
    if (rule.mechanism !== 'static-grep') continue;
    if (!rule.pattern) continue;
    const files = collectFilesSync(ctx.cwd, rule.filePattern, ctx.readFiles);
    const re = new RegExp(rule.pattern);
    for (const f of files) {
      let content: string;
      try {
        content = nodeFs.readFileSync(f.absolute, 'utf8');
      } catch {
        continue;
      }
      ctx.readFiles?.add(f.relPosix);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]!);
        if (m) {
          const id = `${manifest.id}.${rule.id}.${f.relPosix}:${i + 1}`;
          const verdict = ctx.criticPolicy.crossFamily
            ? 'confirmed'
            : 'critic-unavailable';
          findings.push({
            id,
            presetId: manifest.id,
            ruleId: rule.id,
            severity: rule.severity,
            file: f.relPosix,
            line: i + 1,
            evidence: m[0],
            message: rule.message ?? 'rule matched',
            verdict,
            criticFamily: ctx.criticPolicy.criticConfig
              ? engineFamily(ctx.criticPolicy.criticConfig)
              : undefined,
          });
        }
      }
    }
  }
  return findings;
}

interface FoundFile {
  absolute: string;
  relPosix: string;
}

function collectFilesSync(
  root: string,
  filePattern: string | undefined,
  _readFiles?: Set<string>,
): FoundFile[] {
  // Build extension allow-list from the simple {ts,js,...} suffix in surface.
  const extSet = new Set<string>();
  if (filePattern) {
    const m = /\{([^}]+)\}$/.exec(filePattern);
    if (m) {
      m[1]!.split(',').forEach((e) => extSet.add('.' + e.trim()));
    } else {
      const m2 = /\*\.(\w+)$/.exec(filePattern);
      if (m2) extSet.add('.' + m2[1]!);
    }
  }
  const out: FoundFile[] = [];
  walk(root, root, extSet, out);
  return out;
}

function walk(root: string, dir: string, extSet: Set<string>, out: FoundFile[]): void {
  let entries: nodeFs.Dirent[];
  try {
    entries = nodeFs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const name = ent.name;
    if (name === '.git' || name === 'node_modules' || name === '.zerou') continue;
    const abs = path.join(dir, name);
    if (ent.isDirectory()) {
      walk(root, abs, extSet, out);
    } else if (ent.isFile()) {
      if (extSet.size > 0) {
        const ext = path.extname(name);
        if (!extSet.has(ext)) continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join('/');
      out.push({ absolute: abs, relPosix: rel });
    }
  }
}
