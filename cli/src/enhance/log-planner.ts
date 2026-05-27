/**
 * Phase 10 — Module A: log-planner.
 *
 * Walks a user demo project and produces an `InjectionPlan` describing:
 *   - which logger lib to standardise on (re-use existing pino/winston/bunyan
 *     or default to pino)
 *   - which npm deps need to land (none if existing logger)
 *   - which bootstrap / middleware files we'll create
 *   - which source-file `LogSite` candidates the executor should rewrite
 *
 * Planner is READ-ONLY — never touches disk. The executor (Module B) consumes
 * the plan and applies the changes inside a worktree.
 *
 * Decision-branch log taxonomy: `enhance.log.planner.*`
 *   - enhance.log.planner.start
 *   - enhance.log.planner.framework-detected
 *   - enhance.log.planner.logger-detected
 *   - enhance.log.planner.bootstrap-decision
 *   - enhance.log.planner.middleware-decision
 *   - enhance.log.planner.scan-start
 *   - enhance.log.planner.site-found
 *   - enhance.log.planner.cap-reached
 *   - enhance.log.planner.complete
 *
 * Authority:
 *   `docs/plans/2026-05-27-phase-10-enhance.md` §"Architecture" / §"模块契约"
 *   `cli/src/enhance/types.ts` (shared types)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  Framework,
  InjectionPlan,
  LogSite,
  LogSiteKind,
  LoggerLib,
  PlannerOpts,
} from './types.js';
import { logBranch, logCatch } from '../log/branch.js';

// ── Tunables ────────────────────────────────────────────────────────────────

const MAX_SITES = 200;
const MAX_FILE_BYTES = 200_000;

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const TARGET_DIRS = [
  'src',
  'app',
  'pages',
  'api',
  'routes',
  'router',
  'routers',
  'handlers',
  'controllers',
  'lib',
  'server',
];

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

const TEST_FILE_RE = /\.(test|spec)\.[mc]?[tj]sx?$/;

// ── Helpers ─────────────────────────────────────────────────────────────────

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function readPackageJson(cwd: string): PackageJson | null {
  const pj = path.join(cwd, 'package.json');
  try {
    const text = fs.readFileSync(pj, 'utf8');
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

function detectFramework(pkg: PackageJson | null): Framework {
  if (!pkg) return 'unknown';
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps.next) return 'next.js';
  if (Object.keys(deps).some((k) => k.startsWith('@nestjs/'))) return 'nest.js';
  if (deps.fastify) return 'fastify';
  if (deps.express) return 'express';
  if (deps.koa) return 'koa';
  return 'unknown';
}

function detectExistingLogger(pkg: PackageJson | null): LoggerLib {
  if (!pkg) return 'pino';
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps.pino) return 'existing-pino';
  if (deps.winston) return 'existing-winston';
  if (deps.bunyan) return 'existing-bunyan';
  return 'pino';
}

function installDepsFor(lib: LoggerLib): string[] {
  // Already-installed loggers → nothing to install.
  if (lib.startsWith('existing-')) return [];
  // Default pino path: standard pair.
  if (lib === 'pino') return ['pino', 'pino-http'];
  if (lib === 'winston') return ['winston'];
  if (lib === 'bunyan') return ['bunyan'];
  return [];
}

/**
 * Search project for an existing logger bootstrap file. If found, return its
 * POSIX-relative path; otherwise return a sensible default location.
 */
function detectBootstrapFile(cwd: string): { path: string; existed: boolean } {
  const candidates = [
    'src/logger.ts',
    'src/logger.js',
    'src/logger.mjs',
    'lib/logger.ts',
    'lib/logger.js',
    'app/logger.ts',
    'logger.ts',
    'logger.js',
  ];
  for (const rel of candidates) {
    const abs = path.join(cwd, rel);
    try {
      if (fs.statSync(abs).isFile()) return { path: toPosix(rel), existed: true };
    } catch {
      // missing — try next
    }
  }
  return { path: 'src/logger.ts', existed: false };
}

/**
 * For Next.js: project-root `middleware.ts` (or .js). For other frameworks
 * we return null in v1 — inline middleware is the executor's job there.
 */
function detectMiddlewareFile(
  cwd: string,
  framework: Framework,
): { path: string | null; existed: boolean } {
  if (framework !== 'next.js') return { path: null, existed: false };
  const candidates = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js'];
  for (const rel of candidates) {
    const abs = path.join(cwd, rel);
    try {
      if (fs.statSync(abs).isFile()) return { path: toPosix(rel), existed: true };
    } catch {
      // continue
    }
  }
  return { path: 'middleware.ts', existed: false };
}

// ── Source walking ──────────────────────────────────────────────────────────

interface ScannedFile {
  rel: string;
  abs: string;
  content: string;
}

function walkSources(cwd: string, maxFiles: number, log: ReturnType<typeof loggerChild>): ScannedFile[] {
  const out: ScannedFile[] = [];
  const roots: string[] = [];
  for (const d of TARGET_DIRS) {
    const p = path.join(cwd, d);
    try {
      if (fs.statSync(p).isDirectory()) roots.push(p);
    } catch {
      // missing dir
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
    } catch (e) {
      logCatch(log, 'enhance.log.planner.dir-read.error', e, { dir });
      continue;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith('.')) continue;
        queue.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      if (TEST_FILE_RE.test(ent.name)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch (e) {
        logCatch(log, 'enhance.log.planner.file-stat.error', e, { file: ent.name });
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      let content: string;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch (e) {
        logCatch(log, 'enhance.log.planner.file-read.error', e, { file: ent.name });
        continue;
      }
      out.push({ rel: toPosix(path.relative(cwd, full)), abs: full, content });
    }
  }
  return out;
}

// ── Site detection ──────────────────────────────────────────────────────────

// Match `catch (e) {}` / `catch (e) { return null; }` style silent catches.
// Tolerates whitespace + newlines inside the body, but not nested statements.
const SILENT_CATCH_RE =
  /catch\s*\([^)]*\)\s*\{\s*(?:\}|return\s+(?:null|undefined|void\s+0)\s*;?\s*\})/g;

const CONSOLE_LOG_RE = /console\s*\.\s*(log|info|warn|error|debug)\s*\(/g;

const DB_CALL_RE =
  /\b(?:db|prisma|supabase|knex|sql|mongoose|drizzle)(?:\s*\.\s*[A-Za-z_$][\w$]*)+\s*\(/g;

const EXTERNAL_FETCH_RE =
  /(?:\bfetch\s*\(|\baxios\s*\.\s*(?:get|post|put|delete|patch|head|options)\s*\()/g;

const NEXT_HTTP_HANDLER_RE =
  /export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/g;

const EXPRESS_ROUTE_RE =
  /\b(?:app|router|api|server)\w*\s*\.\s*(get|post|put|delete|patch|use|all)\s*\(/g;

interface IndexedFile {
  rel: string;
  content: string;
  /** byte offset → 1-based line number lookup. */
  lineStarts: number[];
}

function indexLines(content: string): number[] {
  const out: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) out.push(i + 1);
  }
  return out;
}

function lineOf(starts: number[], offset: number): number {
  // binary search for largest start <= offset
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function endLineOfMatch(starts: number[], offset: number, matchText: string): number {
  return lineOf(starts, offset + matchText.length - 1);
}

function previewAt(content: string, offset: number, limit = 120): string {
  // Take up to `limit` chars from offset, collapsing newlines for readability.
  const slice = content.slice(offset, offset + limit);
  return slice.replace(/\r?\n/g, ' ⏎ ').trim();
}

/**
 * Determine whether a `logger.` call appears within ±3 lines of `line`.
 * Used to avoid double-tagging sites that already have logging.
 */
function hasNearbyLogger(content: string, starts: number[], line: number, radius = 3): boolean {
  const startLine = Math.max(1, line - radius);
  const endLine = Math.min(starts.length, line + radius);
  const beg = starts[startLine - 1] ?? 0;
  const end = endLine < starts.length ? starts[endLine] ?? content.length : content.length;
  const window = content.slice(beg, end);
  return /\blogger\s*\.\s*(?:info|debug|warn|error|trace|child|log)\s*\(/.test(window);
}

function looksNextJsRouteFile(rel: string): boolean {
  // app/.../route.ts OR app/.../route.tsx etc.
  return /(?:^|\/)app\/.*\/route\.[mc]?[tj]sx?$/.test(rel);
}

function isExpressLikeFile(rel: string, content: string, framework: Framework): boolean {
  if (framework === 'express' || framework === 'fastify' || framework === 'koa') return true;
  return /\b(?:app|router)\s*\.\s*(?:get|post|put|delete|patch|use)\s*\(/.test(content);
}

function detectSitesInFile(
  file: IndexedFile,
  framework: Framework,
  log: ReturnType<typeof loggerChild>,
  budgetRemaining: number,
): LogSite[] {
  const sites: LogSite[] = [];
  let remaining = budgetRemaining;

  const push = (site: LogSite): boolean => {
    if (remaining <= 0) return false;
    sites.push(site);
    remaining -= 1;
    logBranch(log, 'enhance.log.planner.site-found', {
      decision: 'include',
      reasoning: site.kind,
      file: site.file,
      line: site.line,
      kind: site.kind,
    });
    return remaining > 0;
  };

  // 1. silent catches
  SILENT_CATCH_RE.lastIndex = 0;
  for (let m = SILENT_CATCH_RE.exec(file.content); m; m = SILENT_CATCH_RE.exec(file.content)) {
    if (remaining <= 0) break;
    const off = m.index;
    const line = lineOf(file.lineStarts, off);
    if (!push({
      file: file.rel,
      line,
      endLine: endLineOfMatch(file.lineStarts, off, m[0]),
      kind: 'silent-catch',
      preview: previewAt(file.content, off),
    })) break;
  }

  // 2. console.log
  CONSOLE_LOG_RE.lastIndex = 0;
  for (let m = CONSOLE_LOG_RE.exec(file.content); m; m = CONSOLE_LOG_RE.exec(file.content)) {
    if (remaining <= 0) break;
    const off = m.index;
    const line = lineOf(file.lineStarts, off);
    if (!push({
      file: file.rel,
      line,
      endLine: line,
      kind: 'console-log',
      preview: previewAt(file.content, off),
    })) break;
  }

  // 3. http-boundary — Next.js App Router exports
  if (framework === 'next.js' && looksNextJsRouteFile(file.rel)) {
    NEXT_HTTP_HANDLER_RE.lastIndex = 0;
    for (
      let m = NEXT_HTTP_HANDLER_RE.exec(file.content);
      m;
      m = NEXT_HTTP_HANDLER_RE.exec(file.content)
    ) {
      if (remaining <= 0) break;
      const off = m.index;
      const line = lineOf(file.lineStarts, off);
      if (!push({
        file: file.rel,
        line,
        endLine: line,
        kind: 'http-boundary',
        preview: previewAt(file.content, off),
      })) break;
    }
  } else if (isExpressLikeFile(file.rel, file.content, framework)) {
    EXPRESS_ROUTE_RE.lastIndex = 0;
    for (
      let m = EXPRESS_ROUTE_RE.exec(file.content);
      m;
      m = EXPRESS_ROUTE_RE.exec(file.content)
    ) {
      if (remaining <= 0) break;
      const off = m.index;
      const line = lineOf(file.lineStarts, off);
      if (!push({
        file: file.rel,
        line,
        endLine: line,
        kind: 'http-boundary',
        preview: previewAt(file.content, off),
      })) break;
    }
  }

  // 4. db-call — only count when no nearby logger call
  DB_CALL_RE.lastIndex = 0;
  for (let m = DB_CALL_RE.exec(file.content); m; m = DB_CALL_RE.exec(file.content)) {
    if (remaining <= 0) break;
    const off = m.index;
    const line = lineOf(file.lineStarts, off);
    if (hasNearbyLogger(file.content, file.lineStarts, line)) continue;
    if (!push({
      file: file.rel,
      line,
      endLine: line,
      kind: 'db-call',
      preview: previewAt(file.content, off),
    })) break;
  }

  // 5. external-fetch — only when no nearby logger
  EXTERNAL_FETCH_RE.lastIndex = 0;
  for (
    let m = EXTERNAL_FETCH_RE.exec(file.content);
    m;
    m = EXTERNAL_FETCH_RE.exec(file.content)
  ) {
    if (remaining <= 0) break;
    const off = m.index;
    const line = lineOf(file.lineStarts, off);
    if (hasNearbyLogger(file.content, file.lineStarts, line)) continue;
    if (!push({
      file: file.rel,
      line,
      endLine: line,
      kind: 'external-fetch',
      preview: previewAt(file.content, off),
    })) break;
  }

  return sites;
}

// ── Logger helpers ──────────────────────────────────────────────────────────

import type { TrackLogger } from '../log-types.js';

function loggerChild(logger: TrackLogger): TrackLogger {
  return logger.child('enhance').child('log').child('planner');
}
// (function alias exported so internal helpers can take its return type)

// ── Public entry point ──────────────────────────────────────────────────────

export async function planLogInjection(opts: PlannerOpts): Promise<InjectionPlan> {
  const { cwd, logger } = opts;
  const log = loggerChild(logger);
  const startedAt = Date.now();

  log.log('info', 'enhance.log.planner.start', { cwd, framework: opts.framework });

  const pkg = readPackageJson(cwd);
  // Caller may pass `unknown`; we still re-derive from pkg in case caller did
  // not detect. Caller's framework wins if non-unknown.
  const detectedFw = detectFramework(pkg);
  const framework: Framework =
    opts.framework && opts.framework !== 'unknown' ? opts.framework : detectedFw;
  logBranch(log, 'enhance.log.planner.framework-detected', {
    decision: 'detected',
    reasoning: pkg ? 'from package.json deps' : 'no package.json — defaulting to unknown',
    framework,
  });

  const loggerLib = detectExistingLogger(pkg);
  logBranch(log, 'enhance.log.planner.logger-detected', {
    decision: 'detected',
    reasoning: loggerLib.startsWith('existing-')
      ? 'logger already in deps'
      : 'no logger detected — defaulting to pino',
    loggerLib,
  });

  const installDeps = installDepsFor(loggerLib);

  // Bootstrap file: if a logger file already exists in the project, reuse it
  // and emit `bootstrapFile = null` so the executor doesn't overwrite it.
  const bs = detectBootstrapFile(cwd);
  const bootstrapFile: string | null = bs.existed ? null : bs.path;
  logBranch(log, 'enhance.log.planner.bootstrap-decision', {
    decision: bs.existed ? 'reuse' : 'create',
    reasoning: bs.existed ? 'logger file detected' : 'no existing logger bootstrap',
    path: bs.path,
  });

  const mw = detectMiddlewareFile(cwd, framework);
  const middlewareFile: string | null =
    framework === 'next.js' ? (mw.existed ? null : mw.path) : null;
  logBranch(log, 'enhance.log.planner.middleware-decision', {
    decision: middlewareFile ? 'create' : 'skip',
    reasoning:
      framework === 'next.js'
        ? mw.existed
          ? 'middleware.ts already exists'
          : 'creating new middleware.ts'
        : 'framework does not use Next.js middleware in v1',
    framework,
  });

  // Walk source files & detect sites.
  log.log('info', 'enhance.log.planner.scan-start', { cwd });
  const files = walkSources(cwd, 2000, log);

  const sites: LogSite[] = [];
  for (const f of files) {
    if (sites.length >= MAX_SITES) {
      logBranch(log, 'enhance.log.planner.cap-reached', {
        decision: 'stop',
        reasoning: `MAX_SITES=${MAX_SITES} reached`,
        scanned: files.indexOf(f),
      });
      break;
    }
    const indexed: IndexedFile = {
      rel: f.rel,
      content: f.content,
      lineStarts: indexLines(f.content),
    };
    const found = detectSitesInFile(indexed, framework, log, MAX_SITES - sites.length);
    for (const s of found) {
      if (sites.length >= MAX_SITES) break;
      sites.push(s);
    }
  }

  const plan: InjectionPlan = {
    loggerLib,
    framework,
    installDeps,
    bootstrapFile,
    middlewareFile,
    sites,
  };

  log.log('info', 'enhance.log.planner.complete', {
    durationMs: Date.now() - startedAt,
    sitesTotal: sites.length,
    sitesByKind: countByKind(sites),
    installDeps,
    bootstrapFile,
    middlewareFile,
    framework,
    loggerLib,
  });

  return plan;
}

function countByKind(sites: LogSite[]): Record<LogSiteKind, number> {
  const init: Record<LogSiteKind, number> = {
    'http-boundary': 0,
    'silent-catch': 0,
    'console-log': 0,
    'db-call': 0,
    'external-fetch': 0,
    'error-rethrow': 0,
    'unhandled-promise': 0,
  };
  for (const s of sites) init[s.kind] += 1;
  return init;
}
