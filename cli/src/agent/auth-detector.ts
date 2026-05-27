/**
 * Auth-shape detector (Phase 11.3).
 *
 * Heuristic pre-scan for a project's authentication framework. Used by
 *  - test-case-generator (so spec.given knows whether to mention "authenticated user")
 *  - test-spec-runner   (so the judge's prompt knows the auth gate is one helper call away)
 *  - test-emitter       (so emitted vitest files mock the RIGHT module path)
 *
 * 100% regex / fs based — no TypeScript compiler API, no new npm deps.
 *
 * Strategy:
 *   1. Read package.json — find auth-related dependencies.
 *   2. Walk source files (reusing the same dir convention as test-case-generator).
 *   3. Look for files exporting common auth-helper functions
 *      (getServerUser / getServerSession / auth / withAuth / etc.).
 *   4. Resolve a stable import path (`@/...` if tsconfig paths declare it,
 *      otherwise a relative path).
 *
 * Returns `{ kind: 'none' }` when nothing matches — never throws.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TrackLogger } from '../log-types.js';
import { logBranch, logCatch } from '../log/branch.js';

export type AuthKind = 'supabase-ssr' | 'nextauth' | 'none';

export interface AuthShape {
  kind: AuthKind;
  /** Source file the auth helper is exported from (POSIX, relative to cwd). */
  helperFile?: string;
  /**
   * Import specifier callers can plug into `import {…} from '<helperImport>'`.
   * Prefers TS path aliases (e.g. `@/lib/auth/server`) when tsconfig declares them.
   */
  helperImport?: string;
  /** Name of the canonical auth helper function detected. */
  helperFunctionName?: string;
  /** Shape of the auth result the helper returns. */
  userType?: string;
}

export interface DetectAuthOpts {
  cwd: string;
  logger: TrackLogger;
  /** Test seam: cap the number of source files scanned. Default 200. */
  maxFiles?: number;
}

const TARGET_DIRS = ['lib', 'src', 'app', 'pages', 'server', 'utils', 'helpers'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.zerou',
  '.worktrees',
  '__tests__',
  'tests',
  'test',
  'coverage',
]);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Module specifiers that signal which framework is in use. */
const SUPABASE_IMPORT_RE = /from\s+['"]@supabase\/(?:ssr|auth-helpers[a-z0-9-]*)['"]/;
const NEXTAUTH_IMPORT_RE = /from\s+['"](?:next-auth|@auth\/[a-z0-9-]+)['"]/;

/** Helper function name patterns we look for (ordered by canonicalness). */
const SUPABASE_HELPER_NAMES = [
  'getServerUser',
  'getUser',
  'getCurrentUser',
  'getSupabaseUser',
];
const NEXTAUTH_HELPER_NAMES = [
  'getServerSession',
  'auth',
  'getSession',
  'getCurrentUser',
];

/** Detect the project's auth shape. */
export async function detectAuthShape(opts: DetectAuthOpts): Promise<AuthShape> {
  const { cwd, logger, maxFiles = 200 } = opts;

  type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  let pkg: Pkg | null = null;
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
    pkg = JSON.parse(raw) as Pkg;
  } catch (e) {
    logCatch(logger, 'agent.auth-detect.package-json', e, { cwd });
    logBranch(logger, 'agent.auth-detect.decision', {
      decision: 'none',
      reasoning: 'no package.json or unreadable',
    });
    return { kind: 'none' };
  }

  const deps: Record<string, string> = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };

  const hasSupabase = Object.keys(deps).some(
    (d) => d === '@supabase/ssr' || d.startsWith('@supabase/auth-helpers') || d === '@supabase/supabase-js',
  );
  const hasNextAuth = Object.keys(deps).some(
    (d) => d === 'next-auth' || d.startsWith('@auth/'),
  );

  if (!hasSupabase && !hasNextAuth) {
    logBranch(logger, 'agent.auth-detect.decision', {
      decision: 'none',
      reasoning: 'no supabase/nextauth dep in package.json',
    });
    return { kind: 'none' };
  }

  // Walk source files looking for an auth helper.
  const files = walkSources(cwd, maxFiles);
  const tsconfigPaths = readTsconfigPaths(cwd);

  // Prefer supabase-ssr when both libs are present (most common in modern Next.js apps).
  if (hasSupabase) {
    const match = findHelper(files, SUPABASE_IMPORT_RE, SUPABASE_HELPER_NAMES);
    if (match) {
      const shape: AuthShape = {
        kind: 'supabase-ssr',
        helperFile: match.relFile,
        helperImport: resolveImportSpecifier(match.relFile, tsconfigPaths),
        helperFunctionName: match.fnName,
        userType: 'User | null',
      };
      logBranch(logger, 'agent.auth-detect.decision', {
        decision: 'supabase-ssr',
        reasoning: `found ${match.fnName} in ${match.relFile}`,
        ...shape,
      });
      return shape;
    }
    logBranch(logger, 'agent.auth-detect.decision', {
      decision: 'supabase-ssr-no-helper',
      reasoning: 'supabase dep present but no helper file detected; degraded to none',
    });
  }

  if (hasNextAuth) {
    const match = findHelper(files, NEXTAUTH_IMPORT_RE, NEXTAUTH_HELPER_NAMES);
    if (match) {
      const shape: AuthShape = {
        kind: 'nextauth',
        helperFile: match.relFile,
        helperImport: resolveImportSpecifier(match.relFile, tsconfigPaths),
        helperFunctionName: match.fnName,
        userType: 'Session | null',
      };
      logBranch(logger, 'agent.auth-detect.decision', {
        decision: 'nextauth',
        reasoning: `found ${match.fnName} in ${match.relFile}`,
        ...shape,
      });
      return shape;
    }
    logBranch(logger, 'agent.auth-detect.decision', {
      decision: 'nextauth-no-helper',
      reasoning: 'next-auth dep present but no helper file detected; degraded to none',
    });
  }

  return { kind: 'none' };
}

interface ScannedFile {
  rel: string;
  abs: string;
  content: string;
}

function walkSources(cwd: string, maxFiles: number): ScannedFile[] {
  const out: ScannedFile[] = [];
  const roots: string[] = [];
  for (const d of TARGET_DIRS) {
    const p = path.join(cwd, d);
    try {
      if (fs.statSync(p).isDirectory()) roots.push(p);
    } catch {
      // ignore missing
    }
  }
  roots.push(cwd);

  const seen = new Set<string>();
  const queue: string[] = [...roots];

  while (queue.length > 0 && out.length < maxFiles) {
    const dir = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith('.')) continue;
        queue.push(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        if (/\.(test|spec)\.[mc]?[tj]sx?$/.test(ent.name)) continue;
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (content.length > 200_000) continue;
        const rel = path.relative(cwd, full).split(path.sep).join('/');
        out.push({ rel, abs: full, content });
      }
    }
  }
  return out;
}

interface HelperMatch {
  relFile: string;
  fnName: string;
}

function findHelper(
  files: ScannedFile[],
  importRe: RegExp,
  helperNames: string[],
): HelperMatch | null {
  // Score files: must import auth library + must export one of helperNames.
  // Prefer files literally named 'auth' / 'server' / 'session' — they tend to
  // be the canonical helper file.
  const candidates: Array<{ file: ScannedFile; fnName: string; score: number }> = [];
  for (const f of files) {
    if (!importRe.test(f.content)) continue;
    for (const fn of helperNames) {
      // export async function getServerUser() {...} OR
      // export function getServerUser() {...} OR
      // export const getServerUser = ...
      const declRe = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const)\\s+${escapeRegExp(fn)}\\b`,
      );
      if (declRe.test(f.content)) {
        let score = 0;
        const base = path.basename(f.rel).toLowerCase();
        if (/auth/.test(f.rel.toLowerCase())) score += 10;
        if (/server/.test(base)) score += 5;
        if (/session/.test(base)) score += 3;
        // Prefer canonical names earlier in the list.
        score += helperNames.length - helperNames.indexOf(fn);
        candidates.push({ file: f, fnName: fn, score });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { relFile: candidates[0]!.file.rel, fnName: candidates[0]!.fnName };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface TsconfigPathsInfo {
  baseUrl: string;          // POSIX, relative to cwd
  paths: Record<string, string[]>;
}

function readTsconfigPaths(cwd: string): TsconfigPathsInfo | null {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const p = path.join(cwd, name);
    try {
      const raw = fs.readFileSync(p, 'utf8');
      // tsconfig allows comments + trailing commas — strip them naively.
      const stripped = raw
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,(\s*[}\]])/g, '$1');
      const cfg = JSON.parse(stripped) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const co = cfg.compilerOptions ?? {};
      if (co.paths) {
        return {
          baseUrl: (co.baseUrl ?? '.').split(path.sep).join('/'),
          paths: co.paths,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function resolveImportSpecifier(
  relFile: string,
  tsPaths: TsconfigPathsInfo | null,
): string {
  // Strip extension to mirror how TS resolves imports.
  const noExt = relFile.replace(/\.[mc]?[tj]sx?$/, '');
  if (tsPaths) {
    // Walk through every alias and check if any maps to a prefix that includes noExt.
    for (const [alias, targets] of Object.entries(tsPaths.paths)) {
      // We only handle `@/*` style suffix-wildcard aliases for now.
      if (!alias.endsWith('/*')) continue;
      const aliasPrefix = alias.slice(0, -2); // '@'
      for (const target of targets) {
        if (!target.endsWith('/*')) continue;
        // target is e.g. './src/*' or './*' or 'src/*'
        let targetPrefix = target.slice(0, -2);                  // './', './src/', 'src/'
        targetPrefix = targetPrefix.replace(/^\.\/?/, '');       // '', 'src/', 'src/'
        targetPrefix = targetPrefix.replace(/\/$/, '');          // '', 'src',  'src'
        const baseAdjusted = (tsPaths.baseUrl === '.' || tsPaths.baseUrl === '')
          ? targetPrefix
          : `${tsPaths.baseUrl.replace(/^\.\/?/, '').replace(/\/$/, '')}/${targetPrefix}`
              .replace(/\/+/g, '/')
              .replace(/^\//, '')
              .replace(/\/$/, '');
        const head = baseAdjusted;
        if (head === '') {
          // Alias maps directly to the project root.
          return `${aliasPrefix}/${noExt}`;
        }
        if (noExt === head) {
          return `${aliasPrefix}`;
        }
        if (noExt.startsWith(head + '/')) {
          return `${aliasPrefix}/${noExt.slice(head.length + 1)}`;
        }
      }
    }
  }
  // Fallback: project-root-relative path with a leading `./`.
  return './' + noExt;
}
