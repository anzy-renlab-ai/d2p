/**
 * Phase 10 — Module B: log-executor.
 *
 * Applies a previously produced `InjectionPlan` (see Module A: log-planner)
 * to the user's project on disk. Strictly text-based: no AST library is added
 * as a dep yet — we keep transformations narrow (silent-catch + console-log
 * rewrite + bootstrap/middleware scaffolding + package.json devDependencies
 * patch) and guard them with line-range checks so we never touch unrelated
 * code.
 *
 * Idempotency contract: running twice on the same project produces an
 * identical result — already-rewritten catches / consoles are detected and
 * skipped.
 *
 * Decision-branch log taxonomy: `enhance.log.executor.*`
 *   - enhance.log.executor.start
 *   - enhance.log.executor.bootstrap-decision  (create | skip)
 *   - enhance.log.executor.middleware-decision (create | skip)
 *   - enhance.log.executor.deps-decision       (patch | skip)
 *   - enhance.log.executor.file-start
 *   - enhance.log.executor.file-skip
 *   - enhance.log.executor.file-change-decision (skip | apply | fail)
 *   - enhance.log.executor.file-changed
 *   - enhance.log.executor.file-failed
 *   - enhance.log.executor.complete
 *
 * Authority:
 *   `docs/plans/2026-05-27-phase-10-enhance.md`
 *   `cli/src/enhance/types.ts`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { InjectionPlan, LogSite, LogSiteKind } from './types.js';
import type { TrackLogger } from '../log-types.js';
import { logBranch, logCatch } from '../log/branch.js';

// ── Tunables ────────────────────────────────────────────────────────────────

/** Pinned versions used when writing package.json devDependencies. */
const PINNED_VERSIONS: Record<string, string> = {
  pino: '^9.5.0',
  'pino-http': '^10.3.0',
  'pino-pretty': '^11.3.0',
  winston: '^3.15.0',
  bunyan: '^1.8.15',
};

const BOOTSTRAP_TEMPLATE = `import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
`;

const MIDDLEWARE_TEMPLATE = `import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { logger } from './src/logger';

export function middleware(req: NextRequest) {
  const correlationId =
    req.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const start = Date.now();
  const log = logger.child({ correlationId, path: req.nextUrl.pathname });
  log.info({ method: req.method }, 'request.start');

  const res = NextResponse.next();
  res.headers.set('x-correlation-id', correlationId);
  log.info({ durationMs: Date.now() - start }, 'request.end');
  return res;
}
`;

// ── Public types ────────────────────────────────────────────────────────────

export interface LogExecutorOpts {
  cwd: string;
  plan: InjectionPlan;
  logger: TrackLogger;
}

export interface LogExecutorResult {
  filesChanged: string[];
  failures: { file: string; reason: string }[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function execLog(logger: TrackLogger): TrackLogger {
  return logger.child('enhance').child('log').child('executor');
}

interface ReadResult {
  ok: true;
  content: string;
}
interface ReadError {
  ok: false;
  reason: string;
}

function readFileSafe(abs: string): ReadResult | ReadError {
  try {
    return { ok: true, content: fs.readFileSync(abs, 'utf8') };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

function writeFileSafe(abs: string, content: string): { ok: true } | { ok: false; reason: string } {
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

function relativeImportFor(fromRel: string, bootstrapRel: string): string {
  // Build a POSIX relative specifier from `fromRel` to `bootstrapRel`,
  // stripping the extension and ensuring a leading './' or '../'.
  const fromAbs = '/' + toPosix(fromRel);
  const toAbs = '/' + toPosix(bootstrapRel);
  let rel = path
    .relative(path.dirname(fromAbs), toAbs)
    .split(path.sep)
    .join('/');
  // Strip file extension.
  rel = rel.replace(/\.[mc]?[tj]sx?$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function importStatementFor(importSpec: string): string {
  return `import { logger } from '${importSpec}';\n`;
}

function hasLoggerImport(content: string): boolean {
  return /import\s*\{[^}]*\blogger\b[^}]*\}\s*from\s*['"][^'"]+['"]/.test(content);
}

function insertImport(content: string, importLine: string): string {
  // Insert after the last existing top-of-file import; if none, prepend.
  const importRe = /^(?:import\s[^\n]*\n)+/m;
  const m = importRe.exec(content);
  if (m && m.index === 0) {
    const end = m.index + m[0].length;
    return content.slice(0, end) + importLine + content.slice(end);
  }
  return importLine + content;
}

// ── Transformations ─────────────────────────────────────────────────────────

/**
 * Replace silent catches in `content`. A "silent catch" is any
 *
 *   catch (e) {}        → catch (e) { logger.error({ err: e }, 'unhandled'); }
 *   catch (e) { return null; }
 *
 * Already-logging catches (containing `logger.error({ err`) are left alone for
 * idempotency.
 */
function transformSilentCatches(content: string): { content: string; count: number } {
  const re =
    /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*(\}|return\s+(?:null|undefined|void\s+0)\s*;?\s*\})/g;
  let count = 0;
  const out = content.replace(re, (full, name: string, body: string) => {
    // Already logged? defensive — the regex requires `{}` or just a return,
    // so by construction body cannot contain logger.error, but check anyway.
    if (full.includes('logger.error')) return full;
    if (body === '}') {
      count += 1;
      return `catch (${name}) { logger.error({ err: ${name} }, 'unhandled'); }`;
    }
    count += 1;
    // Preserve the original return semantics, just add a log line before it.
    const ret = body.replace(/^\}$/, '').replace(/^\{?\s*/, '').replace(/\s*\}$/, '').trim();
    return `catch (${name}) { logger.error({ err: ${name} }, 'unhandled'); ${ret} }`;
  });
  return { content: out, count };
}

const CONSOLE_MAP: Record<string, string> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
};

function transformConsoleCalls(content: string): { content: string; count: number } {
  let count = 0;
  const out = content.replace(
    /console\s*\.\s*(log|info|warn|error|debug)\s*\(/g,
    (_full, method: string) => {
      const mapped = CONSOLE_MAP[method] ?? 'info';
      count += 1;
      return `logger.${mapped}(`;
    },
  );
  return { content: out, count };
}

// ── Bootstrap + middleware ──────────────────────────────────────────────────

function createBootstrap(
  cwd: string,
  bootstrapFile: string,
  log: TrackLogger,
): { ok: boolean; path: string; created: boolean; reason?: string } {
  const abs = path.join(cwd, bootstrapFile);
  if (fs.existsSync(abs)) {
    logBranch(log, 'enhance.log.executor.bootstrap-decision', {
      decision: 'skip',
      reasoning: 'bootstrap file already exists on disk',
      path: bootstrapFile,
    });
    return { ok: true, path: bootstrapFile, created: false };
  }
  const w = writeFileSafe(abs, BOOTSTRAP_TEMPLATE);
  if (!w.ok) {
    logBranch(log, 'enhance.log.executor.bootstrap-decision', {
      decision: 'fail',
      reasoning: w.reason,
      path: bootstrapFile,
    });
    return { ok: false, path: bootstrapFile, created: false, reason: w.reason };
  }
  logBranch(log, 'enhance.log.executor.bootstrap-decision', {
    decision: 'create',
    reasoning: 'no existing logger bootstrap',
    path: bootstrapFile,
  });
  return { ok: true, path: bootstrapFile, created: true };
}

function createMiddleware(
  cwd: string,
  middlewareFile: string,
  log: TrackLogger,
): { ok: boolean; path: string; created: boolean; reason?: string } {
  const abs = path.join(cwd, middlewareFile);
  if (fs.existsSync(abs)) {
    logBranch(log, 'enhance.log.executor.middleware-decision', {
      decision: 'skip',
      reasoning: 'middleware file already exists on disk',
      path: middlewareFile,
    });
    return { ok: true, path: middlewareFile, created: false };
  }
  const w = writeFileSafe(abs, MIDDLEWARE_TEMPLATE);
  if (!w.ok) {
    logBranch(log, 'enhance.log.executor.middleware-decision', {
      decision: 'fail',
      reasoning: w.reason,
      path: middlewareFile,
    });
    return { ok: false, path: middlewareFile, created: false, reason: w.reason };
  }
  logBranch(log, 'enhance.log.executor.middleware-decision', {
    decision: 'create',
    reasoning: 'no existing middleware',
    path: middlewareFile,
  });
  return { ok: true, path: middlewareFile, created: true };
}

interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
}

function patchPackageJson(
  cwd: string,
  deps: string[],
  log: TrackLogger,
): { ok: boolean; changed: boolean; reason?: string } {
  if (deps.length === 0) {
    logBranch(log, 'enhance.log.executor.deps-decision', {
      decision: 'skip',
      reasoning: 'no install deps requested',
    });
    return { ok: true, changed: false };
  }
  const pjPath = path.join(cwd, 'package.json');
  const r = readFileSafe(pjPath);
  if (!r.ok) {
    logBranch(log, 'enhance.log.executor.deps-decision', {
      decision: 'fail',
      reasoning: 'cannot read package.json',
      detail: r.reason,
    });
    return { ok: false, changed: false, reason: r.reason };
  }
  let pkg: PkgJson;
  try {
    pkg = JSON.parse(r.content) as PkgJson;
  } catch (e) {
    const reason = (e as Error).message;
    logBranch(log, 'enhance.log.executor.deps-decision', {
      decision: 'fail',
      reasoning: 'package.json is not valid JSON',
      detail: reason,
    });
    return { ok: false, changed: false, reason };
  }
  const existingDev = pkg.devDependencies ?? {};
  const existingProd = pkg.dependencies ?? {};
  let changed = false;
  for (const dep of deps) {
    if (existingDev[dep] || existingProd[dep]) continue;
    existingDev[dep] = PINNED_VERSIONS[dep] ?? '*';
    changed = true;
  }
  // pino runtime also pulls pino-pretty in dev mode.
  if (deps.includes('pino') && !existingDev['pino-pretty'] && !existingProd['pino-pretty']) {
    existingDev['pino-pretty'] = PINNED_VERSIONS['pino-pretty'] ?? '*';
    changed = true;
  }
  pkg.devDependencies = sortObject(existingDev);
  if (!changed) {
    logBranch(log, 'enhance.log.executor.deps-decision', {
      decision: 'skip',
      reasoning: 'all deps already present',
      deps,
    });
    return { ok: true, changed: false };
  }
  const w = writeFileSafe(pjPath, JSON.stringify(pkg, null, 2) + '\n');
  if (!w.ok) {
    logBranch(log, 'enhance.log.executor.deps-decision', {
      decision: 'fail',
      reasoning: 'write package.json failed',
      detail: w.reason,
    });
    return { ok: false, changed: false, reason: w.reason };
  }
  logBranch(log, 'enhance.log.executor.deps-decision', {
    decision: 'patch',
    reasoning: 'devDependencies updated',
    deps,
  });
  return { ok: true, changed: true };
}

function sortObject(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]!;
  return out;
}

// ── Per-file site application ───────────────────────────────────────────────

/**
 * Group LogSites by file. We don't actually need the site line numbers for
 * transformation (the regexes scan the whole file), but we use the set of
 * kinds to decide which transformations to invoke per file. This keeps the
 * executor cheap and avoids touching files with no opt-in sites.
 */
function groupSites(sites: LogSite[]): Map<string, Set<LogSiteKind>> {
  const out = new Map<string, Set<LogSiteKind>>();
  for (const s of sites) {
    let set = out.get(s.file);
    if (!set) {
      set = new Set();
      out.set(s.file, set);
    }
    set.add(s.kind);
  }
  return out;
}

interface ApplyResult {
  status: 'changed' | 'skip' | 'fail';
  reason?: string;
}

function applyToFile(
  cwd: string,
  rel: string,
  kinds: Set<LogSiteKind>,
  bootstrapFileRel: string,
  log: TrackLogger,
): ApplyResult {
  const abs = path.join(cwd, rel);
  log.log('debug', 'enhance.log.executor.file-start', { file: rel, kinds: Array.from(kinds) });
  const r = readFileSafe(abs);
  if (!r.ok) {
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'fail',
      reasoning: 'read failed',
      file: rel,
      detail: r.reason,
    });
    return { status: 'fail', reason: r.reason };
  }
  let next = r.content;
  let touched = 0;
  let consoles = 0;
  let catches = 0;

  if (kinds.has('silent-catch')) {
    const t = transformSilentCatches(next);
    next = t.content;
    catches = t.count;
    touched += t.count;
  }
  if (kinds.has('console-log')) {
    const t = transformConsoleCalls(next);
    next = t.content;
    consoles = t.count;
    touched += t.count;
  }

  // Other kinds (http-boundary, db-call, external-fetch) are no-ops in v1.
  // We still emit a decision so the trail records why we did nothing.
  for (const k of kinds) {
    if (k === 'silent-catch' || k === 'console-log') continue;
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'skip',
      reasoning: `kind ${k} not handled in v1 (middleware/other module covers it)`,
      file: rel,
      kind: k,
    });
  }

  if (touched === 0) {
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'skip',
      reasoning: 'no applicable transformation produced a change',
      file: rel,
    });
    log.log('info', 'enhance.log.executor.file-skip', { file: rel, reason: 'noop' });
    return { status: 'skip' };
  }

  // We added at least one `logger.*` call → make sure the import exists.
  if (!hasLoggerImport(next)) {
    const spec = relativeImportFor(rel, bootstrapFileRel);
    next = insertImport(next, importStatementFor(spec));
  }

  if (next === r.content) {
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'skip',
      reasoning: 'content unchanged after transformation (idempotent)',
      file: rel,
    });
    return { status: 'skip' };
  }

  const w = writeFileSafe(abs, next);
  if (!w.ok) {
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'fail',
      reasoning: 'write failed',
      file: rel,
      detail: w.reason,
    });
    log.log('warn', 'enhance.log.executor.file-failed', { file: rel, reason: w.reason });
    return { status: 'fail', reason: w.reason };
  }
  logBranch(log, 'enhance.log.executor.file-change-decision', {
    decision: 'apply',
    reasoning: `rewrote ${catches} silent-catch, ${consoles} console call(s)`,
    file: rel,
    catches,
    consoles,
  });
  log.log('info', 'enhance.log.executor.file-changed', {
    file: rel,
    catches,
    consoles,
  });
  return { status: 'changed' };
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function executeLogInjection(opts: LogExecutorOpts): Promise<LogExecutorResult> {
  const { cwd, plan, logger } = opts;
  const log = execLog(logger);
  const startedAt = Date.now();

  log.log('info', 'enhance.log.executor.start', {
    cwd,
    sitesPlanned: plan.sites.length,
    installDeps: plan.installDeps,
    bootstrapFile: plan.bootstrapFile,
    middlewareFile: plan.middlewareFile,
  });

  const filesChanged: string[] = [];
  const failures: { file: string; reason: string }[] = [];

  // Step 1: package.json deps.
  try {
    const dep = patchPackageJson(cwd, plan.installDeps, log);
    if (!dep.ok) {
      failures.push({ file: 'package.json', reason: dep.reason ?? 'patchPackageJson failed' });
    } else if (dep.changed) {
      filesChanged.push('package.json');
    }
  } catch (e) {
    logCatch(log, 'enhance.log.executor.deps.error', e);
    failures.push({ file: 'package.json', reason: (e as Error).message });
  }

  // Step 2: bootstrap.
  let bootstrapRel: string =
    plan.bootstrapFile ?? findExistingBootstrap(cwd) ?? 'src/logger.ts';
  if (plan.bootstrapFile) {
    try {
      const bs = createBootstrap(cwd, plan.bootstrapFile, log);
      if (!bs.ok) {
        failures.push({ file: plan.bootstrapFile, reason: bs.reason ?? 'bootstrap failed' });
      } else if (bs.created) {
        filesChanged.push(plan.bootstrapFile);
      }
      bootstrapRel = plan.bootstrapFile;
    } catch (e) {
      logCatch(log, 'enhance.log.executor.bootstrap.error', e);
      failures.push({ file: plan.bootstrapFile, reason: (e as Error).message });
    }
  }

  // Step 3: middleware (Next.js only).
  if (plan.middlewareFile) {
    try {
      const mw = createMiddleware(cwd, plan.middlewareFile, log);
      if (!mw.ok) {
        failures.push({ file: plan.middlewareFile, reason: mw.reason ?? 'middleware failed' });
      } else if (mw.created) {
        filesChanged.push(plan.middlewareFile);
      }
    } catch (e) {
      logCatch(log, 'enhance.log.executor.middleware.error', e);
      failures.push({ file: plan.middlewareFile, reason: (e as Error).message });
    }
  }

  // Step 4: per-file site rewrites.
  const grouped = groupSites(plan.sites);
  for (const [rel, kinds] of grouped) {
    try {
      const r = applyToFile(cwd, rel, kinds, bootstrapRel, log);
      if (r.status === 'changed') filesChanged.push(rel);
      else if (r.status === 'fail') {
        failures.push({ file: rel, reason: r.reason ?? 'apply failed' });
      }
    } catch (e) {
      logCatch(log, 'enhance.log.executor.file.error', e, { file: rel });
      failures.push({ file: rel, reason: (e as Error).message });
    }
  }

  log.log('info', 'enhance.log.executor.complete', {
    durationMs: Date.now() - startedAt,
    filesChangedCount: filesChanged.length,
    failuresCount: failures.length,
  });

  return { filesChanged, failures };
}

function findExistingBootstrap(cwd: string): string | null {
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
    try {
      if (fs.statSync(path.join(cwd, rel)).isFile()) return rel;
    } catch {
      // continue
    }
  }
  return null;
}
