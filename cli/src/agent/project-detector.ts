/**
 * Project Detector (Phase 4 / Track A).
 *
 * Reads a small set of high-signal files (README, package.json, common
 * framework configs) and infers a `ProjectProfile`. When a critic LLM is
 * available, asks the model to assemble the profile. Otherwise falls back
 * to deterministic file/dep heuristics.
 *
 * Every decision branch emits a log event under `agent.project-detection.*`
 * (event taxonomy per `docs/plans/2026-05-26-phase-4-agent-orchestrator.md`
 * §"Decision-Branch Log Taxonomy").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TrackLogger } from '../log-types.js';
import type { EngineConfig } from '../stubs.js';
import type { ProjectProfile } from './types.js';

export interface DetectorOptions {
  cwd: string;
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  /** Test seam: override the LLM call used for inference. */
  llmCall?: LlmInferFn;
  /** Per-call timeout for the LLM. */
  timeoutMs?: number;
}

/** Files we will read (and pass to LLM / inspect heuristically). */
const SIGNAL_FILES: ReadonlyArray<{
  name: string;
  /** How much of the file to keep when sending to the LLM. */
  maxBytes: number;
}> = [
  { name: 'README.md', maxBytes: 1000 },
  { name: 'README', maxBytes: 1000 },
  { name: 'package.json', maxBytes: 4000 },
  { name: 'next.config.js', maxBytes: 500 },
  { name: 'next.config.mjs', maxBytes: 500 },
  { name: 'next.config.ts', maxBytes: 500 },
  { name: 'vite.config.js', maxBytes: 500 },
  { name: 'vite.config.ts', maxBytes: 500 },
  { name: 'vite.config.mjs', maxBytes: 500 },
  { name: 'vercel.json', maxBytes: 500 },
  { name: 'Dockerfile', maxBytes: 1000 },
  { name: 'pyproject.toml', maxBytes: 1000 },
  { name: 'Cargo.toml', maxBytes: 800 },
  { name: 'go.mod', maxBytes: 500 },
  { name: 'pnpm-lock.yaml', maxBytes: 100 },
  { name: 'yarn.lock', maxBytes: 100 },
  { name: 'package-lock.json', maxBytes: 100 },
  { name: '.env.example', maxBytes: 200 },
  { name: '.env', maxBytes: 200 },
];

/** Directory probes (presence-only, no content read sent to LLM). */
const SIGNAL_DIRS: ReadonlyArray<string> = ['supabase', '.git', 'tests', 'test', '__tests__'];

interface RawSignals {
  files: Record<string, string>;  // name -> content slice
  dirs: Record<string, boolean>;  // name -> exists
}

function safeRead(p: string, maxBytes: number): string | null {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return null;
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, stat.size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function safeDirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function collectSignals(cwd: string): RawSignals {
  const files: Record<string, string> = {};
  for (const spec of SIGNAL_FILES) {
    const abs = path.join(cwd, spec.name);
    const content = safeRead(abs, spec.maxBytes);
    if (content !== null) files[spec.name] = content;
  }
  const dirs: Record<string, boolean> = {};
  for (const name of SIGNAL_DIRS) {
    dirs[name] = safeDirExists(path.join(cwd, name));
  }
  return { files, dirs };
}

// ── Heuristic inference (deterministic fallback) ────────────────────────────

function deriveHeuristic(signals: RawSignals): ProjectProfile {
  const evidence: Record<string, string> = {};
  const language = new Set<string>();
  let framework = 'unknown';
  let backend: string | null = null;
  let packageMgr: ProjectProfile['packageMgr'] = null;
  let hasTests = false;
  let hasEnvFile = false;

  const pkgRaw = signals.files['package.json'];
  let pkg: Record<string, unknown> | null = null;
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      evidence['package.json'] = 'parsed';
      language.add('javascript');
    } catch {
      evidence['package.json'] = 'present-but-invalid-json';
    }
  }

  const deps: Record<string, string> = {
    ...((pkg?.['dependencies'] as Record<string, string> | undefined) ?? {}),
    ...((pkg?.['devDependencies'] as Record<string, string> | undefined) ?? {}),
  };

  if ('typescript' in deps || signals.files['next.config.ts'] || signals.files['vite.config.ts']) {
    language.add('typescript');
  }

  // Framework
  if ('next' in deps || signals.files['next.config.js'] || signals.files['next.config.mjs'] || signals.files['next.config.ts']) {
    framework = 'next.js';
    evidence['framework'] = "deps has 'next' or next.config.*";
  } else if (signals.files['vite.config.ts'] || signals.files['vite.config.js'] || signals.files['vite.config.mjs'] || 'vite' in deps) {
    framework = 'vite';
    evidence['framework'] = "vite.config.* or 'vite' in deps";
  } else if ('express' in deps) {
    framework = 'express';
    evidence['framework'] = "'express' in deps";
  } else if ('fastify' in deps) {
    framework = 'fastify';
    evidence['framework'] = "'fastify' in deps";
  } else if (signals.files['pyproject.toml']) {
    framework = 'python';
    language.add('python');
    evidence['framework'] = 'pyproject.toml present';
  } else if (signals.files['Cargo.toml']) {
    framework = 'rust';
    language.add('rust');
    evidence['framework'] = 'Cargo.toml present';
  } else if (signals.files['go.mod']) {
    framework = 'go';
    language.add('go');
    evidence['framework'] = 'go.mod present';
  }

  // Backend
  if ('@supabase/supabase-js' in deps || signals.dirs['supabase']) {
    backend = 'supabase';
    evidence['backend'] = "supabase deps or supabase/ dir";
  } else if ('firebase' in deps || 'firebase-admin' in deps) {
    backend = 'firebase';
    evidence['backend'] = "firebase deps";
  } else if ('express' in deps || 'fastify' in deps || 'koa' in deps) {
    backend = 'custom-express';
    evidence['backend'] = 'express/fastify/koa in deps';
  }

  // Package manager
  if (signals.files['pnpm-lock.yaml']) {
    packageMgr = 'pnpm';
  } else if (signals.files['yarn.lock']) {
    packageMgr = 'yarn';
  } else if (signals.files['package-lock.json']) {
    packageMgr = 'npm';
  }
  if (packageMgr) evidence['packageMgr'] = `${packageMgr}-lock present`;

  // Tests
  const scripts = (pkg?.['scripts'] as Record<string, string> | undefined) ?? {};
  if (scripts.test || signals.dirs['tests'] || signals.dirs['test'] || signals.dirs['__tests__']) {
    hasTests = true;
    evidence['hasTests'] = scripts.test ? 'package.json scripts.test' : 'tests dir present';
  }

  // Env files
  if (signals.files['.env.example'] || signals.files['.env']) {
    hasEnvFile = true;
    evidence['hasEnvFile'] = signals.files['.env.example'] ? '.env.example' : '.env';
  }

  // Dockerfile evidence
  if (signals.files['Dockerfile']) {
    evidence['dockerfile'] = 'present';
  }

  // Vercel
  if (signals.files['vercel.json']) {
    evidence['vercel'] = 'vercel.json present';
  }

  const hasGit = signals.dirs['.git'] === true;

  return {
    framework,
    backend,
    language: language.size > 0 ? Array.from(language) : ['unknown'],
    hasGit,
    hasTests,
    hasEnvFile,
    packageMgr,
    evidence,
  };
}

// ── LLM inference path ──────────────────────────────────────────────────────

const PROFILE_SYSTEM_PROMPT =
  'You are inferring a project profile from a small set of files. Output JSON ONLY — no markdown fence, no preamble, no commentary. Match the schema exactly.';

const PROFILE_SCHEMA_DOC = `{
  "framework": string,        // e.g. "next.js", "vite", "express", "fastify", "python", "rust", "go", "unknown"
  "backend": string|null,     // e.g. "supabase", "firebase", "custom-express", null
  "language": string[],       // e.g. ["typescript", "sql"]
  "hasTests": boolean,
  "hasEnvFile": boolean,
  "packageMgr": "npm"|"pnpm"|"yarn"|null,
  "evidence": { [key: string]: string }  // short string explaining each field
}`;

function buildProfilePrompt(signals: RawSignals): string {
  const lines: string[] = ['Files present in repository root:'];
  for (const [name, content] of Object.entries(signals.files)) {
    lines.push(`\n--- ${name} ---`);
    lines.push(content.slice(0, 1500));
  }
  lines.push('\nDirectories present:');
  for (const [name, exists] of Object.entries(signals.dirs)) {
    if (exists) lines.push(`- ${name}/`);
  }
  lines.push('');
  lines.push('Return strict JSON matching this schema:');
  lines.push(PROFILE_SCHEMA_DOC);
  return lines.join('\n');
}

/** Result of one LLM call attempt. */
type LlmInferResult =
  | { ok: true; raw: string; parsed: Partial<ProjectProfile> }
  | { ok: false; error: string; raw: string };

/** Test seam — pluggable LLM call. */
export type LlmInferFn = (params: {
  cfg: EngineConfig;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}) => Promise<LlmInferResult>;

/** Default LLM call: OpenAI-Chat-Completions-compat (mirrors critic-client). */
export const defaultLlmInfer: LlmInferFn = async (params) => {
  if (!params.cfg.baseUrl) {
    return { ok: false, error: 'no baseUrl on engine config', raw: '' };
  }
  const url = params.cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.cfg.modelId,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? String(e), raw: '' };
  }
  const rawText = await res.text();
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, raw: rawText };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'envelope not JSON', raw: rawText };
  }
  const content = (envelope as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: false, error: 'missing choices[0].message.content', raw: rawText };
  }
  let cleaned = content;
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (!cleaned.startsWith('{')) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) cleaned = m[0];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: 'inner content not JSON', raw: content };
  }
  return { ok: true, raw: rawText, parsed: parsed as Partial<ProjectProfile> };
};

function normalizeProfile(
  inferred: Partial<ProjectProfile>,
  heuristic: ProjectProfile,
): ProjectProfile {
  // Trust LLM strings but always fold heuristic's hasGit (only filesystem can answer)
  // and merge evidence.
  const evidence: Record<string, string> = { ...heuristic.evidence };
  if (inferred.evidence && typeof inferred.evidence === 'object') {
    for (const [k, v] of Object.entries(inferred.evidence)) {
      if (typeof v === 'string') evidence[`llm.${k}`] = v;
    }
  }
  const language = Array.isArray(inferred.language)
    ? inferred.language.filter((x): x is string => typeof x === 'string')
    : heuristic.language;
  const packageMgr: ProjectProfile['packageMgr'] =
    inferred.packageMgr === 'npm' ||
    inferred.packageMgr === 'pnpm' ||
    inferred.packageMgr === 'yarn'
      ? inferred.packageMgr
      : heuristic.packageMgr;
  return {
    framework: typeof inferred.framework === 'string' && inferred.framework.length > 0
      ? inferred.framework
      : heuristic.framework,
    backend:
      typeof inferred.backend === 'string'
        ? inferred.backend
        : inferred.backend === null
          ? null
          : heuristic.backend,
    language: language.length > 0 ? language : heuristic.language,
    hasGit: heuristic.hasGit, // filesystem truth, not LLM
    hasTests:
      typeof inferred.hasTests === 'boolean' ? inferred.hasTests : heuristic.hasTests,
    hasEnvFile:
      typeof inferred.hasEnvFile === 'boolean' ? inferred.hasEnvFile : heuristic.hasEnvFile,
    packageMgr,
    evidence,
  };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Reads README, package.json, deps list, lightweight file structure.
 * Asks critic LLM to infer project profile. Falls back to deterministic
 * heuristics if no LLM available or LLM fails.
 *
 * Emits:
 * - agent.project-detection.start
 * - agent.project-detection.files-read
 * - agent.project-detection.llm-call.start (if LLM available)
 * - agent.project-detection.llm-call.success/failure
 * - agent.project-detection.heuristic-fallback (if no LLM or LLM failed)
 * - agent.project-detection.complete
 */
export async function detectProject(opts: DetectorOptions): Promise<ProjectProfile> {
  const { cwd, logger } = opts;
  const log = logger.child('project-detection');

  log.log('info', 'agent.project-detection.start', { cwd });

  const signals = collectSignals(cwd);
  const fileNames = Object.keys(signals.files);
  const dirNames = Object.entries(signals.dirs)
    .filter(([, v]) => v)
    .map(([k]) => k);
  log.log('info', 'agent.project-detection.files-read', {
    count: fileNames.length,
    names: fileNames.slice(0, 20),
    dirs: dirNames,
  });

  const heuristic = deriveHeuristic(signals);

  // Decision 1: do we have a critic key + config?
  if (opts.criticConfig && opts.criticApiKey) {
    log.log('info', 'agent.project-detection.llm-call.start', {
      decision: 'use-llm',
      reasoning: 'critic config + api key both present',
      modelId: opts.criticConfig.modelId,
    });
    const llmFn = opts.llmCall ?? defaultLlmInfer;
    const userPrompt = buildProfilePrompt(signals);
    let result: LlmInferResult;
    try {
      result = await llmFn({
        cfg: opts.criticConfig,
        apiKey: opts.criticApiKey,
        systemPrompt: PROFILE_SYSTEM_PROMPT,
        userPrompt,
        timeoutMs: opts.timeoutMs ?? 30_000,
      });
    } catch (e) {
      result = { ok: false, error: (e as Error).message ?? String(e), raw: '' };
    }
    if (result.ok) {
      const profile = normalizeProfile(result.parsed, heuristic);
      log.log('info', 'agent.project-detection.llm-call.success', {
        decision: 'llm-result-accepted',
        framework: profile.framework,
        backend: profile.backend,
      });
      log.log('info', 'agent.project-detection.complete', { profile });
      return profile;
    }
    log.log('warn', 'agent.project-detection.llm-call.failure', {
      decision: 'fall-back-to-heuristic',
      reasoning: result.error,
    });
    log.log('info', 'agent.project-detection.heuristic-fallback', {
      decision: 'use-heuristic',
      reasoning: `llm-call failed: ${result.error}`,
    });
    log.log('info', 'agent.project-detection.complete', { profile: heuristic });
    return heuristic;
  }

  // No critic key → deterministic path.
  log.log('info', 'agent.project-detection.heuristic-fallback', {
    decision: 'use-heuristic',
    reasoning: opts.criticConfig
      ? 'critic config present but no api key'
      : 'no critic config configured',
  });
  log.log('info', 'agent.project-detection.complete', { profile: heuristic });
  return heuristic;
}
