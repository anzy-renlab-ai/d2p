/**
 * Protocol-2 Preset Framework — loader.
 *
 * Surface: docs/details/13-protocol-2-public-surface.md
 *   - 3-layer lookup chain (plugin > project > builtin)
 *   - frontmatter validation (PRESET-E-2..6)
 *   - shadow detection
 *   - emits preset.load.* events
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { createTrackLogger, type TrackLogger } from '../../log/track-logger.js';
import {
  PresetError,
  type PresetErrorCode,
} from './errors.js';
import type {
  LoadedPreset,
  LookupSource,
  PresetManifest,
  PresetMechanism,
  PresetRule,
} from './types.js';

// ── ID schema ────────────────────────────────────────────────────────────────

const PRESET_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;

// ── Zod schemas for frontmatter validation (strict, no unknown keys) ─────────

const ALL_MECHANISMS: readonly PresetMechanism[] = [
  'static-grep',
  'file-exists',
  'test-execution',
  'cross-file-cohesion',
  'llm-judgment',
];

const SeveritySchema = z.enum(['P1', 'P2', 'P3']);
const MechanismSchema = z.enum(ALL_MECHANISMS as unknown as [PresetMechanism, ...PresetMechanism[]]);

const FixDeclarationSchema = z
  .object({
    kind: z.enum(['template', 'llm-only']),
    command: z.string().optional(),
    verifyCommand: z.string().optional(),
  })
  .strict();

const LlmRulePolicySchema = z
  .object({
    criticEnforce: z.boolean(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

// ruleId is a slug (unique within preset) — surface does not pin a regex; accept
// any non-empty kebab-style slug. Validation is "unique within preset" + "non-empty".
const RULE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

const RuleSchema = z
  .object({
    ruleId: z.string().regex(RULE_ID_RE, 'ruleId must match /^[a-z][a-z0-9-]{0,63}$/'),
    label: z.string().min(1),
    severity: SeveritySchema,
    mechanism: MechanismSchema,
    source: z.string().min(1),
    rationale: z.string().optional(),
    detection: z.record(z.unknown()),
    fix: FixDeclarationSchema.optional(),
    llmPolicy: LlmRulePolicySchema.optional(),
  })
  .strict();

const ManifestSchema = z
  .object({
    id: z.string().regex(PRESET_ID_RE),
    version: z.number().int().positive(),
    name: z.string().min(1),
    appliesTo: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
    rules: z.array(RuleSchema),
  })
  .strict();

// ── LoadOptions ─────────────────────────────────────────────────────────────

export interface LoadOptions {
  cwd?: string;
  logger?: TrackLogger;
  pluginDirs?: string[];
  projectDir?: string;
  builtinDir?: string;
}

interface Candidate {
  source: LookupSource;
  presetId: string;
  path: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function envPluginDirs(): string[] {
  const raw = process.env.ZEROU_PRESET_PLUGIN_DIRS;
  if (!raw) return [];
  // Per surface: colon/semicolon-separated
  return raw
    .split(/[:;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function envBuiltinDir(): string | undefined {
  return process.env.ZEROU_PRESET_BUILTIN_DIR || undefined;
}

async function tryStat(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listDir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}

// Recursively count preset.md files under a plugin package dir. PRESET-E-5
// fires when more than one is found.
async function countPresetMdRecursive(dir: string): Promise<{ count: number; rootPath: string | null }> {
  let count = 0;
  let rootPath: string | null = null;
  const root = path.join(dir, 'preset.md');
  if (await tryStat(root)) {
    count++;
    rootPath = root;
  }
  // Walk subdirs to look for nested preset.md files.
  async function walk(cur: string): Promise<void> {
    const entries = await listDir(cur);
    for (const name of entries) {
      const abs = path.join(cur, name);
      let isDir = false;
      try {
        const st = await stat(abs);
        isDir = st.isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (name === 'node_modules' || name === '.git') continue;
        // Check for preset.md inside this nested dir
        const nested = path.join(abs, 'preset.md');
        if (await tryStat(nested)) count++;
        await walk(abs);
      }
    }
  }
  await walk(dir);
  return { count, rootPath };
}

async function scanPluginDir(pluginDir: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const entries = await listDir(pluginDir);
  for (const name of entries) {
    if (!name.startsWith('@zerou-preset-')) continue;
    const pkgDir = path.join(pluginDir, name);
    const st = await stat(pkgDir).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const { count, rootPath } = await countPresetMdRecursive(pkgDir);
    if (count > 1) {
      throw new PresetError(
        'PRESET-E-5',
        `plugin package "${name}" contains more than one preset.md (count=${count})`,
      );
    }
    if (count === 1 && rootPath) {
      // Need to read it to know its id.
      const raw = await readFile(rootPath, 'utf8').catch(() => null);
      if (!raw) continue;
      const parsed = matter(raw);
      const id = (parsed.data as Record<string, unknown>)?.id;
      if (typeof id === 'string' && PRESET_ID_RE.test(id)) {
        candidates.push({ source: 'plugin', presetId: id, path: rootPath });
      }
    }
  }
  return candidates;
}

async function scanProjectDir(projectDir: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const entries = await listDir(projectDir);
  for (const name of entries.sort()) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    if (!PRESET_ID_RE.test(id)) continue;
    out.push({ source: 'project', presetId: id, path: path.join(projectDir, name) });
  }
  return out;
}

async function scanBuiltinDir(builtinDir: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const entries = await listDir(builtinDir);
  for (const name of entries.sort()) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    if (!PRESET_ID_RE.test(id)) continue;
    out.push({ source: 'builtin', presetId: id, path: path.join(builtinDir, name) });
  }
  return out;
}

interface ScanResult {
  candidates: Candidate[]; // all candidates across layers
  layersScanned: string[];
}

async function scanAllLayers(opts: LoadOptions): Promise<ScanResult> {
  const cwd = opts.cwd ?? process.cwd();
  const layersScanned: string[] = [];
  const out: Candidate[] = [];

  // 1) Plugin layer: <cwd>/node_modules + ZEROU_PRESET_PLUGIN_DIRS + opts.pluginDirs
  const pluginDirs = [
    path.join(cwd, 'node_modules'),
    ...envPluginDirs(),
    ...(opts.pluginDirs ?? []),
  ];
  layersScanned.push('plugin');
  for (const d of pluginDirs) {
    if (await tryStat(d)) {
      const cs = await scanPluginDir(d);
      out.push(...cs);
    }
  }

  // 2) Project layer
  const projectDir = opts.projectDir ?? path.join(cwd, '.zerou', 'presets');
  layersScanned.push('project');
  if (await tryStat(projectDir)) {
    out.push(...(await scanProjectDir(projectDir)));
  }

  // 3) Builtin layer
  const builtinDir = opts.builtinDir ?? envBuiltinDir();
  layersScanned.push('builtin');
  if (builtinDir && (await tryStat(builtinDir))) {
    out.push(...(await scanBuiltinDir(builtinDir)));
  }

  return { candidates: out, layersScanned };
}

// ── Frontmatter parsing & validation ────────────────────────────────────────

function parseManifestFrontmatter(
  raw: string,
  filePath: string,
): { manifest: PresetManifest } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    throw new PresetError(
      'PRESET-E-2',
      `failed to parse frontmatter at ${filePath}: ${(err as Error).message}`,
    );
  }

  const data = parsed.data as Record<string, unknown>;
  const body = parsed.content;

  // Strict schema parse — unknown keys reject as PRESET-E-2
  const result = ManifestSchema.safeParse(data);
  if (!result.success) {
    throw new PresetError(
      'PRESET-E-2',
      `manifest schema failure at ${filePath}: ${result.error.message}`,
    );
  }

  const m = result.data as PresetManifest;

  // PRESET-E-3: rules array must be non-empty + ruleIds unique
  if (!m.rules || m.rules.length === 0) {
    throw new PresetError('PRESET-E-3', `manifest at ${filePath} has zero rules`);
  }
  const seen = new Set<string>();
  for (const r of m.rules) {
    if (seen.has(r.ruleId)) {
      throw new PresetError(
        'PRESET-E-3',
        `manifest at ${filePath} has duplicate ruleId "${r.ruleId}"`,
      );
    }
    seen.add(r.ruleId);
  }

  // PRESET-E-4: llm-judgment requires llmPolicy
  for (const r of m.rules) {
    if (r.mechanism === 'llm-judgment' && !r.llmPolicy) {
      throw new PresetError(
        'PRESET-E-4',
        `rule "${r.ruleId}" has mechanism llm-judgment but no llmPolicy`,
      );
    }
  }

  // PRESET-E-6: static-grep regex must compile at load
  for (const r of m.rules) {
    if (r.mechanism === 'static-grep') {
      const det = r.detection as Record<string, unknown>;
      const pattern = det.pattern;
      const flags = det.flags;
      if (typeof pattern !== 'string') {
        throw new PresetError(
          'PRESET-E-2',
          `static-grep rule "${r.ruleId}" missing detection.pattern (string required)`,
        );
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, typeof flags === 'string' ? flags : undefined);
      } catch (err) {
        throw new PresetError(
          'PRESET-E-6',
          `rule "${r.ruleId}" has invalid regex pattern: ${(err as Error).message}`,
        );
      }
    }
  }

  const manifest: PresetManifest = { ...m, body } as PresetManifest;
  return { manifest };
}

// ── Public API: loadPreset ─────────────────────────────────────────────────

export async function loadPreset(id: string, opts: LoadOptions = {}): Promise<LoadedPreset> {
  // Use a logger that inherits trace via parentTrace if caller supplied one
  const logger =
    opts.logger ??
    createTrackLogger('preset', {
      parentTrace: undefined,
      silent: process.env.ZEROU_LOG_NULL === '1',
    });

  // For test convenience: if caller supplied a logger, route preset events
  // through a fresh 'preset' track logger that inherits the caller's trace.
  const presetLogger =
    opts.logger && opts.logger.track !== 'preset'
      ? createTrackLogger('preset', { parentTrace: opts.logger.trace, silent: true })
      : logger;

  const requestedFrom = `loadPreset(${id})`;
  presetLogger.log('info', 'preset.load.start', { presetId: id, requestedFrom });

  // Validate id BEFORE searching layers — PRESET-E-2 per surface
  if (!PRESET_ID_RE.test(id)) {
    const err = new PresetError(
      'PRESET-E-2',
      `id "${id}" does not match /^[a-z][a-z0-9-]{1,63}$/`,
    );
    presetLogger.log('error', 'preset.load.failure', {
      presetId: id,
      errorCode: err.code,
      error: err.message,
    });
    throw err;
  }

  let scan: ScanResult;
  try {
    scan = await scanAllLayers(opts);
  } catch (err) {
    const code: PresetErrorCode =
      err instanceof PresetError ? err.code : 'PRESET-E-1';
    presetLogger.log('error', 'preset.load.failure', {
      presetId: id,
      errorCode: code,
      error: (err as Error).message,
    });
    throw err;
  }

  const matches = scan.candidates.filter((c) => c.presetId === id);
  if (matches.length === 0) {
    const err = new PresetError('PRESET-E-1', `preset "${id}" not found in any layer`);
    presetLogger.log('error', 'preset.load.failure', {
      presetId: id,
      errorCode: err.code,
      error: err.message,
    });
    throw err;
  }

  // Priority: plugin > project > builtin
  const priorityOrder: LookupSource[] = ['plugin', 'project', 'builtin'];
  const ranked = matches.slice().sort(
    (a, b) => priorityOrder.indexOf(a.source) - priorityOrder.indexOf(b.source),
  );
  const winner = ranked[0]!;
  const shadowedBy = ranked.slice(1).map((c) => c.source);

  if (shadowedBy.length > 0) {
    presetLogger.log('info', 'preset.load.shadowed', {
      presetId: id,
      winningSource: winner.source,
      shadowedSources: shadowedBy.slice().sort(),
    });
  }

  presetLogger.log('info', 'preset.load.resolved', {
    presetId: id,
    source: winner.source,
    path: winner.path,
  });

  let manifest: PresetManifest;
  try {
    const raw = await readFile(winner.path, 'utf8');
    const parsed = parseManifestFrontmatter(raw, winner.path);
    manifest = parsed.manifest;
  } catch (err) {
    const code: PresetErrorCode =
      err instanceof PresetError ? err.code : 'PRESET-E-2';
    presetLogger.log('error', 'preset.load.failure', {
      presetId: id,
      errorCode: code,
      error: (err as Error).message,
    });
    throw err;
  }

  presetLogger.log('info', 'preset.load.success', {
    presetId: id,
    version: manifest.version,
    rulesCount: manifest.rules.length,
  });

  return {
    manifest,
    source: winner.source,
    resolvedPath: winner.path,
    shadowedBy,
  };
}

// ── Public API: listPresets ─────────────────────────────────────────────────

export async function listPresets(opts: LoadOptions = {}): Promise<LoadedPreset[]> {
  const presetLogger =
    opts.logger && opts.logger.track !== 'preset'
      ? createTrackLogger('preset', { parentTrace: opts.logger.trace, silent: true })
      : opts.logger ??
        createTrackLogger('preset', {
          silent: process.env.ZEROU_LOG_NULL === '1',
        });

  const scan = await scanAllLayers(opts);
  presetLogger.log('info', 'preset.list.start', { layersScanned: scan.layersScanned });

  // Group candidates by id
  const byId = new Map<string, Candidate[]>();
  for (const c of scan.candidates) {
    const arr = byId.get(c.presetId) ?? [];
    arr.push(c);
    byId.set(c.presetId, arr);
  }

  const priorityOrder: LookupSource[] = ['plugin', 'project', 'builtin'];
  const results: LoadedPreset[] = [];

  // Iterate ids in sorted order for stable output (matches surface "alphabetical by id within one layer")
  const ids = Array.from(byId.keys()).sort();

  for (const id of ids) {
    const matches = byId.get(id)!;
    const ranked = matches.slice().sort(
      (a, b) => priorityOrder.indexOf(a.source) - priorityOrder.indexOf(b.source),
    );
    const winner = ranked[0]!;
    const shadowedBy = ranked.slice(1).map((c) => c.source);

    presetLogger.log('info', 'preset.load.start', { presetId: id, requestedFrom: 'listPresets' });

    if (shadowedBy.length > 0) {
      presetLogger.log('info', 'preset.load.shadowed', {
        presetId: id,
        winningSource: winner.source,
        shadowedSources: shadowedBy.slice().sort(),
      });
    }

    presetLogger.log('info', 'preset.load.resolved', {
      presetId: id,
      source: winner.source,
      path: winner.path,
    });

    try {
      const raw = await readFile(winner.path, 'utf8');
      const parsed = parseManifestFrontmatter(raw, winner.path);
      presetLogger.log('info', 'preset.load.success', {
        presetId: id,
        version: parsed.manifest.version,
        rulesCount: parsed.manifest.rules.length,
      });
      results.push({
        manifest: parsed.manifest,
        source: winner.source,
        resolvedPath: winner.path,
        shadowedBy,
      });
    } catch (err) {
      const code: PresetErrorCode =
        err instanceof PresetError ? err.code : 'PRESET-E-2';
      presetLogger.log('error', 'preset.load.failure', {
        presetId: id,
        errorCode: code,
        error: (err as Error).message,
      });
      // listPresets is lenient: skip invalid preset, continue
    }
  }

  presetLogger.log('info', 'preset.list.success', { count: results.length });
  return results;
}
