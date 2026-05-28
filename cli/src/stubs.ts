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
  /** API key for the critic engine; resolved via Q8 precedence by the caller. */
  criticApiKey?: string | null;
}

export interface RunPresetOptions {
  cwd: string;
  logger: any;
  criticPolicy: CriticPolicy;
  worker: EngineConfig;
  // file reads tracked here
  readFiles?: Set<string>;
  /** Log root for spawned track loggers (e.g. critic). Defaults to process.cwd if omitted. */
  logRoot?: string;
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
        id: 'stripe-live-key',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: 'sk_live_[A-Za-z0-9]{16,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
        message: 'Hard-coded Stripe live secret key — production charge authority',
        fix: {
          kind: 'template',
          find: 'sk_live_[A-Za-z0-9]{16,}',
          replace: 'process.env.STRIPE_SECRET_KEY!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'stripe-test-key',
        severity: 'P2',
        mechanism: 'static-grep',
        pattern: 'sk_test_[A-Za-z0-9]{16,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
        message: 'Hard-coded Stripe test key — should be in env, not source',
        fix: {
          kind: 'template',
          find: 'sk_test_[A-Za-z0-9]{16,}',
          replace: 'process.env.STRIPE_TEST_KEY!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'openai-key',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: 'sk-[A-Za-z0-9]{20,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
        message: 'Hard-coded OpenAI API key detected',
        fix: {
          kind: 'template',
          find: 'sk-[A-Za-z0-9]{20,}',
          replace: 'process.env.OPENAI_API_KEY!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'anthropic-key',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: 'sk-ant-[A-Za-z0-9_-]{20,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
        message: 'Hard-coded Anthropic API key detected',
        fix: {
          kind: 'template',
          find: 'sk-ant-[A-Za-z0-9_-]{20,}',
          replace: 'process.env.ANTHROPIC_API_KEY!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'aws-access-key',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: 'AKIA[0-9A-Z]{16}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs,py,go,java,rb}',
        message: 'Hard-coded AWS Access Key ID — grants full account access',
        fix: {
          kind: 'template',
          find: 'AKIA[0-9A-Z]{16}',
          replace: 'process.env.AWS_ACCESS_KEY_ID!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'jwt-token',
        severity: 'P2',
        mechanism: 'static-grep',
        pattern: 'eyJhbGciOi[A-Za-z0-9_-]{10,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
        message: 'Hard-coded JWT token — usually long-lived auth artifact',
        fix: {
          kind: 'template',
          find: 'eyJhbGciOi[A-Za-z0-9_-]{10,}',
          replace: 'process.env.AUTH_TOKEN!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'github-pat',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: 'gh[ps]_[A-Za-z0-9]{36,}',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs,py,go,rb,sh,yml,yaml}',
        message: 'Hard-coded GitHub Personal Access Token detected',
        fix: {
          kind: 'template',
          find: 'gh[ps]_[A-Za-z0-9]{36,}',
          replace: 'process.env.GITHUB_TOKEN!',
          verifyCommand: 'true',
        },
      },
      {
        id: 'private-key',
        severity: 'P1',
        mechanism: 'static-grep',
        pattern: '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----',
        filePattern: '**/*.{ts,js,tsx,jsx,mjs,cjs,py,go,rb,env,pem,key}',
        message: 'Hard-coded private key block detected in source',
        fix: {
          kind: 'template',
          find: '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\\s\\S]*-----END (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----',
          replace: '// REMOVED: load key from secure storage at runtime',
          verifyCommand: 'true',
        },
      },
    ],
    body: 'Vibe-coded apps frequently embed credentials directly in source. Move all secrets to environment variables, rotate compromised keys, and add the env-var name (not value) to `.env.example`. Re-run `zerou audit` to confirm zero findings remain.',
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

// ── Builtin runPreset: static-grep + real cross-engine critic ──────────────

/**
 * Default `runPreset` implementation:
 *  1. Scans files matching `filePattern` for the rule's regex.
 *  2. Emits a raw finding per regex match.
 *  3. If `criticPolicy.crossFamily` + `criticApiKey` + an `openai-compat`
 *     critic config are all present, actually CALLS the critic engine per
 *     finding (e.g. MiniMax, DeepSeek, Moonshot, OpenRouter — anything
 *     speaking OpenAI's /chat/completions wire format) and uses its
 *     returned verdict.
 *  4. Falls back to `critic-unavailable` when no critic call could be made
 *     OR when the critic call failed (per Protocol-1 P1-E-2 / P1-E-3).
 *
 * Concurrency is currently 1 (serial). Future: respect criticPolicy
 * concurrency once Protocol-1's reviewBatch is wired in.
 */
import * as nodeFs from 'node:fs';
import { callOpenAICompatCritic } from './critic-client.js';
import { createTrackLogger } from './log-types.js';
import { logBranch, logCatch } from './log/branch.js';
import {
  shouldScanDir,
  shouldScanFile,
  looksLikeLibraryFile,
  type ScopeMode,
} from './agent/scope-filter.js';

/**
 * Process-level scope mode. Set by audit.ts during CLI startup; defaults to
 * 'app' so test invocations and library consumers get the safe default.
 *
 * We use a module-level var rather than threading scope through every
 * `runPreset` / `collectFilesSync` callsite — RunPresetOptions is a public
 * surface and adding a field there would force every test to provide it.
 */
let SCOPE_MODE: ScopeMode = 'app';
let EXPLAIN_SKIPPED = false;
const SKIP_TALLY: Map<string, number> = new Map();

/** Set the scope mode for static-grep file walking. Called by audit.ts. */
export function setScopeMode(mode: ScopeMode): void {
  SCOPE_MODE = mode;
}

/** Enable `--explain-skipped` accounting. Called by audit.ts. */
export function setExplainSkipped(on: boolean): void {
  EXPLAIN_SKIPPED = on;
  if (on) SKIP_TALLY.clear();
}

/** Read+reset the skip tally (audit.ts prints this at end of run). */
export function readSkipTally(): { mode: ScopeMode; tally: Record<string, number> } {
  const obj: Record<string, number> = {};
  for (const [k, v] of SKIP_TALLY) obj[k] = v;
  SKIP_TALLY.clear();
  return { mode: SCOPE_MODE, tally: obj };
}

function recordSkip(reason: string): void {
  if (!EXPLAIN_SKIPPED) return;
  SKIP_TALLY.set(reason, (SKIP_TALLY.get(reason) ?? 0) + 1);
}

export async function defaultRunPreset(
  manifest: PresetManifest,
  ctx: RunPresetOptions,
): Promise<VerdictedFinding[]> {
  const rawFindings: Omit<VerdictedFinding, 'verdict'>[] = [];
  const presetLogger = ctx.logger;

  for (const rule of manifest.rules) {
    if (rule.mechanism !== 'static-grep') {
      logBranch(presetLogger, 'preset.rule.mechanism-decision', {
        decision: 'skip',
        reasoning: 'v1 only supports static-grep',
        ruleId: rule.id,
        actualMechanism: rule.mechanism ?? 'undefined',
      });
      continue;
    }
    if (!rule.pattern) {
      logBranch(presetLogger, 'preset.rule.pattern-decision', {
        decision: 'skip',
        reasoning: 'rule has static-grep mechanism but no pattern',
        ruleId: rule.id,
      });
      continue;
    }
    // Phase 19 line-precision (line-precision-multiline-and-sink-anchor):
    //
    // Patterns historically were applied line-by-line, which silently dropped
    // multi-line regexes (e.g. `Promise.all([\s\S]*?)\.catch` or lookbehinds
    // spanning constructor blocks). We now detect "multi-line-ish" patterns
    // and run them with the /m+/g flags against the full file; single-line
    // patterns keep their per-line loop (cheaper, simpler).
    //
    // We also report `col` (1-based column where the match starts on its
    // line) and re-anchor the reported line to the LAST SINK token inside
    // the match (call/exec/query/eval/innerHTML/etc.) when the match spans
    // several lines. This makes a `try { ... ${user} ... }` match report
    // the line of the `${user}` interpolation rather than the wrapping
    // `try` keyword — closing the "right file wrong line" gap that drove
    // Multi-SWE strict scores down. See `docs/plans/2026-05-28-phase-19-
    // line-precision.md` for the ±20-line bench impact.
    const isMultiline = patternIsMultiline(rule.pattern);
    const re = compileRulePattern(rule.pattern, isMultiline);
    logBranch(presetLogger, 'preset.rule.mechanism-decision', {
      decision: 'scan',
      ruleId: rule.id,
      pattern: rule.pattern,
      filePattern: rule.filePattern ?? '*',
      multiline: isMultiline,
    });
    const files = collectFilesSync(ctx.cwd, rule.filePattern, ctx.readFiles);
    logBranch(presetLogger, 'preset.file.collect-decision', {
      decision: 'collected',
      ruleId: rule.id,
      fileCount: files.length,
      filePattern: rule.filePattern ?? '*',
    });
    for (const f of files) {
      let content: string;
      try {
        content = nodeFs.readFileSync(f.absolute, 'utf8');
      } catch (err) {
        logCatch(presetLogger, 'preset.file.read-decision', err, {
          ruleId: rule.id,
          file: f.relPosix,
        });
        continue;
      }
      ctx.readFiles?.add(f.relPosix);
      const scanMatches = isMultiline
        ? scanMultilinePattern(content, re)
        : scanLinePattern(content, re);
      for (const sm of scanMatches) {
        logBranch(presetLogger, 'preset.regex.match-decision', {
          decision: 'matched',
          ruleId: rule.id,
          file: f.relPosix,
          line: sm.line,
          col: sm.col,
          evidenceLen: sm.evidence.length,
          anchor: sm.anchor,
        });
        rawFindings.push({
          id: `${manifest.id}.${rule.id}.${f.relPosix}:${sm.line}`,
          presetId: manifest.id,
          ruleId: rule.id,
          severity: rule.severity,
          file: f.relPosix,
          line: sm.line,
          col: sm.col,
          evidence: sm.evidence,
          message: rule.message ?? 'rule matched',
        });
      }
      logBranch(presetLogger, 'preset.file.scan-decision', {
        decision: scanMatches.length > 0 ? 'matches-found' : 'no-matches',
        ruleId: rule.id,
        file: f.relPosix,
        matchCount: scanMatches.length,
      });
    }
  }

  // Decide critic call path
  const critic = ctx.criticPolicy.criticConfig;
  const criticKey = ctx.criticPolicy.criticApiKey ?? null;
  const canCallCritic =
    ctx.criticPolicy.crossFamily &&
    critic !== null &&
    critic.kind === 'openai-compat' &&
    typeof critic.baseUrl === 'string' &&
    critic.baseUrl.length > 0 &&
    typeof criticKey === 'string' &&
    criticKey.length > 0;
  logBranch(
    presetLogger,
    'preset.critic.dispatch-decision',
    {
      decision: canCallCritic ? 'real-call' : 'no-call',
      crossFamily: ctx.criticPolicy.crossFamily,
      criticKind: critic?.kind ?? null,
      criticHasBaseUrl: !!(critic && critic.baseUrl),
      criticHasKey: !!criticKey,
      rawFindingsCount: rawFindings.length,
    },
    { level: 'info' },
  );

  const criticFamily = critic ? engineFamily(critic) : undefined;

  // Build a fresh critic-track logger inheriting trace from caller's logger
  // AND the audit's logRoot (so events land alongside the rest of the audit).
  const parentTrace = ctx.logger?.trace ?? undefined;
  const criticLogger = createTrackLogger('critic', {
    parentTrace,
    ...(ctx.logRoot ? { logRoot: ctx.logRoot } : {}),
  });

  if (!canCallCritic) {
    // No real critic call possible. Two paths:
    //  (a) crossFamily AND a critic is configured (just not openai-compat or key
    //      missing) → mark confirmed via legacy "trust-the-policy" fallback so
    //      CLI-subprocess engines (claude-cli/codex-cli/gemini-cli) keep
    //      working until Phase-4 wires them to MinimalCriticEngineSurface.
    //  (b) Otherwise → critic-unavailable.
    const legacyConfirm = ctx.criticPolicy.crossFamily && critic !== null;
    logBranch(
      presetLogger,
      'preset.critic.fallback-decision',
      {
        decision: legacyConfirm ? 'legacy-confirm' : 'critic-unavailable',
        reasoning: legacyConfirm
          ? 'crossFamily + critic configured but no openai-compat or key — legacy trust'
          : 'no crossFamily / no critic / no key',
        crossFamily: ctx.criticPolicy.crossFamily,
        criticConfigured: !!critic,
      },
      { level: 'info' },
    );
    criticLogger.log('info', 'critic.review.skipped', {
      reason: legacyConfirm
        ? 'no-openai-compat-or-key — using legacy crossFamily=confirmed fallback'
        : ctx.criticPolicy.reason ?? 'no-critic-config',
      crossFamily: ctx.criticPolicy.crossFamily,
      criticConfigured: !!critic,
      criticKind: critic?.kind ?? null,
      criticHasKey: !!criticKey,
    });
    await criticLogger.flush();
    return rawFindings.map((rf) => ({
      ...rf,
      verdict: legacyConfirm ? ('confirmed' as const) : ('critic-unavailable' as const),
      verdictReason: legacyConfirm
        ? 'cross-family policy (legacy fallback; no real call)'
        : 'no critic call (missing crossFamily / config / key)',
      criticFamily,
    }));
  }

  // Real critic calls (serial). Future: respect criticPolicy.concurrency.
  const verdicted: VerdictedFinding[] = [];
  for (const rf of rawFindings) {
    criticLogger.log('info', 'critic.review.start', {
      findingId: rf.id,
      presetId: rf.presetId,
      ruleId: rf.ruleId,
      crossFamily: true,
    });
    const result = await callOpenAICompatCritic({
      baseUrl: critic!.baseUrl!,
      apiKey: criticKey!,
      modelId: critic!.modelId,
      finding: {
        file: rf.file,
        line: rf.line,
        evidence: rf.evidence,
        message: rf.message,
        ruleId: rf.ruleId,
      },
      logger: criticLogger,
    });
    if (result.ok) {
      logBranch(
        criticLogger,
        'critic.review.verdict-decision',
        {
          decision: result.verdict,
          findingId: rf.id,
          criticFamily: criticFamily ?? null,
          durationMs: result.durationMs,
        },
        { level: 'info' },
      );
      verdicted.push({
        ...rf,
        verdict: result.verdict,
        verdictReason: result.reasoning,
        criticFamily,
      });
      criticLogger.log('info', 'critic.review.success', {
        findingId: rf.id,
        verdict: result.verdict,
        criticFamily: criticFamily ?? null,
        durationMs: result.durationMs,
      });
    } else {
      logBranch(
        criticLogger,
        'critic.review.verdict-decision',
        {
          decision: 'critic-unavailable',
          reasoning: result.errorCode,
          findingId: rf.id,
        },
        { level: 'info' },
      );
      verdicted.push({
        ...rf,
        verdict: 'critic-unavailable',
        verdictReason: result.error,
        criticFamily,
      });
      criticLogger.log('error', 'critic.invocation-failure', {
        findingId: rf.id,
        errorCode: result.errorCode,
        error: result.error.slice(0, 200),
        durationMs: result.durationMs,
      });
    }
  }
  await criticLogger.flush();
  return verdicted;
}

// ── Static-grep pattern engine (Phase 19 line-precision) ────────────────────

/**
 * A regex match resolved to a 1-based (line, col) and a sink-anchored
 * reported line. `anchor` records how we picked the reported line so we
 * can debug strict-vs-loose gaps from logs.
 */
interface ScanMatch {
  /** 1-based line of the reported finding (sink-anchored when multi-line). */
  line: number;
  /** 1-based column on that line. */
  col: number;
  /** The matched substring (truncated to 240 chars for log/finding hygiene). */
  evidence: string;
  /** How the line was picked: 'start' | 'sink' | 'end'. */
  anchor: 'start' | 'sink' | 'end';
}

/**
 * Heuristic — does this regex source contain constructs that need the full
 * file as input (rather than per-line)? We treat the pattern as multi-line
 * if it explicitly references `\n`, uses `[\s\S]`, contains lookbehind
 * assertions (which often span constructor blocks), or already has an `m`
 * flag declared via inline `(?m)` (which we promote into a real flag).
 */
function patternIsMultiline(pattern: string): boolean {
  if (pattern.includes('\\n')) return true;
  if (pattern.includes('[\\s\\S]')) return true;
  if (pattern.includes('[\\S\\s]')) return true;
  // Lookbehind that searches backwards more than a few chars usually wants the
  // full file context (e.g. `(?<!try\s*\{[\s\S]{0,500})`).
  if (/\(\?<[!=][^)]{20,}\)/.test(pattern)) return true;
  return false;
}

function compileRulePattern(pattern: string, multiline: boolean): RegExp {
  // Best-effort regex compile. If the rule ships an invalid pattern we
  // return a never-matching regex so the audit keeps making progress
  // instead of crashing — the rule simply contributes zero findings.
  try {
    return multiline ? new RegExp(pattern, 'gm') : new RegExp(pattern);
  } catch {
    return /$.^/;
  }
}

/**
 * Sink tokens — when a multi-line match contains one of these, we anchor
 * the reported line to the LAST occurrence inside the match. This is the
 * "what line does the bug actually execute on" heuristic.
 *
 * We keep the set deliberately small; a noisy sink list would re-introduce
 * the precision wobble we're fixing. The list focuses on call-shaped
 * tokens because the patterns that get multi-line are almost always
 * "dangerous call wrapped in a control-flow construct".
 */
const SINK_TOKENS = [
  'innerHTML',
  'outerHTML',
  'dangerouslySetInnerHTML',
  'eval(',
  'execSync(',
  'spawnSync(',
  'exec(',
  'spawn(',
  '.query(',
  '.raw(',
  '.execute(',
  'JSON.parse(',
  'res.send(',
  'res.write(',
  'response.send(',
  'fetch(',
  'axios(',
  'axios.get(',
  'axios.post(',
  'http.get(',
  'http.request(',
  'require(',
  'new Function(',
  'setTimeout(',
  'setInterval(',
  'document.write(',
  'window.open(',
  'res.cookie(',
  'response.cookie(',
] as const;

function lineColAt(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, col: offset - lastNl };
}

/**
 * Multi-line scan: run the regex globally, then resolve each match's
 * reported line to the sink line if present, else the match-end line.
 * The match-start line is also tracked for debug.
 */
export function scanMultilinePattern(text: string, re: RegExp): ScanMatch[] {
  const out: ScanMatch[] = [];
  let m: RegExpExecArray | null;
  let safety = 10_000;
  // Defensive — caller already attached 'g'; if not, fall back to single match.
  if (!re.flags.includes('g')) {
    m = re.exec(text);
    if (m) {
      const sm = resolveMatchAnchor(text, m.index, m[0]);
      if (sm) out.push(sm);
    }
    return out;
  }
  while ((m = re.exec(text)) !== null && safety-- > 0) {
    const matchText = m[0];
    if (matchText.length === 0) {
      // Zero-width match — advance to prevent infinite loop.
      re.lastIndex++;
      continue;
    }
    const sm = resolveMatchAnchor(text, m.index, matchText);
    if (sm) out.push(sm);
  }
  return out;
}

function resolveMatchAnchor(
  text: string,
  matchStart: number,
  matchText: string,
): ScanMatch | null {
  const matchEnd = matchStart + matchText.length;
  // Find the last sink token inside the match. If we have one, anchor to it.
  let sinkOffset = -1;
  for (const tok of SINK_TOKENS) {
    const idx = matchText.lastIndexOf(tok);
    if (idx > sinkOffset) sinkOffset = idx;
  }
  let anchorOffset: number;
  let anchor: ScanMatch['anchor'];
  if (sinkOffset >= 0) {
    anchorOffset = matchStart + sinkOffset;
    anchor = 'sink';
  } else if (matchText.includes('\n')) {
    // Multi-line match with no sink — anchor to the last non-empty line
    // (usually the closing line of the construct).
    const trailingNl = matchText.lastIndexOf('\n');
    anchorOffset = matchStart + Math.max(trailingNl + 1, 0);
    anchor = 'end';
  } else {
    anchorOffset = matchStart;
    anchor = 'start';
  }
  const pos = lineColAt(text, anchorOffset);
  return {
    line: pos.line,
    col: pos.col,
    evidence: matchText.length > 240 ? matchText.slice(0, 237) + '...' : matchText,
    anchor,
  };
}

/**
 * Single-line scan: legacy behaviour preserved (one match per line, line
 * index + match.index for col). We still compute col so all findings
 * carry it uniformly.
 */
export function scanLinePattern(text: string, re: RegExp): ScanMatch[] {
  const out: ScanMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = re.exec(line);
    if (!m) continue;
    out.push({
      line: i + 1,
      col: (m.index ?? 0) + 1,
      evidence: m[0],
      anchor: 'start',
    });
  }
  return out;
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
    // Best-effort: directory unreadable (permission / vanished). Bail silently;
    // walk() has no logger handle — caller emits aggregate decisions via
    // preset.file.collect-decision after collection.
    return;
  }
  for (const ent of entries) {
    const name = ent.name;
    const abs = path.join(dir, name);
    if (ent.isDirectory()) {
      if (!shouldScanDir(name, SCOPE_MODE)) {
        recordSkip(SCOPE_MODE === 'all' || name === 'node_modules' || name === '.git'
          ? `dir:${name}`
          : 'third-party');
        continue;
      }
      walk(root, abs, extSet, out);
    } else if (ent.isFile()) {
      if (extSet.size > 0) {
        const ext = path.extname(name);
        if (!extSet.has(ext)) continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const fileDecision = shouldScanFile({
        scope: SCOPE_MODE,
        cwd: root,
        relPath: rel,
      });
      if (!fileDecision.scan) {
        recordSkip(fileDecision.reason ?? 'unknown');
        continue;
      }
      // Soft heuristic — only in 'app' scope and only if we're about to read.
      // Read the file once here so we don't double-read in the regex scan;
      // however we don't have a cheap content cache, so be conservative:
      // only call looksLikeLibraryFile when file extension suggests source.
      if (SCOPE_MODE === 'app') {
        // Cheap content sniff — read up to 8KB head to decide.
        // We bail on read failure (file vanished, perms) — let the main scan
        // path handle that case.
        let head: string | null = null;
        try {
          const fd = nodeFs.openSync(abs, 'r');
          try {
            const buf = Buffer.alloc(8192);
            const n = nodeFs.readSync(fd, buf, 0, 8192, 0);
            head = buf.slice(0, n).toString('utf8');
          } finally {
            nodeFs.closeSync(fd);
          }
        } catch {
          head = null;
        }
        if (head !== null && looksLikeLibraryFile(head, rel)) {
          recordSkip('library-internal');
          continue;
        }
      }
      out.push({ absolute: abs, relPosix: rel });
    }
  }
}
