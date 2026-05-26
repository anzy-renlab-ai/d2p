/**
 * AST Analyzer (Phase 8 / Track 8A).
 *
 * Walks a project's source tree, parses every supported file with the
 * official TypeScript compiler API, and emits structured `FunctionInfo`
 * records describing each exported function / HTTP route handler.
 *
 * Compared to the regex-based heuristic in `test-case-generator.ts`, the
 * AST walk:
 *   - correctly handles `export const POST = async (req) => { ... }`
 *   - counts real branches (if/switch/try/ternary) reachable inside the
 *     function body, not lines that happen to read like one
 *   - returns full source snippets (capped at 200 lines) suitable for
 *     downstream LLM prompts
 *   - detects async/network/db usage via call-expression names
 *
 * Surface authority:
 *   `docs/plans/2026-05-26-phase-8-real-tests-progressive-report.md`
 *   §"agent/ast-analyzer.ts (Track 8A)".
 *
 * Decision-branch log taxonomy:
 *   `agent.ast.*`
 *     - agent.ast.start
 *     - agent.ast.file.scanned
 *     - agent.ast.file.skipped
 *     - agent.ast.function.found
 *     - agent.ast.complete
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

import type { TrackLogger } from '../log-types.js';
import { logBranch, logCatch } from '../log/branch.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface FunctionInfo {
  /** Relative POSIX path from cwd. */
  file: string;
  /** 1-based line of the function declaration / arrow assignment. */
  line: number;
  /** 'POST' / 'GET' for HTTP verb handlers, otherwise the declared identifier. */
  name: string;
  /** Whether the function is an HTTP route handler. */
  kind: 'endpoint' | 'function';
  params: Array<{ name: string; typeHint: string | null }>;
  returnTypeHint: string | null;
  /** if + switch-case + try-arm + ternary count inside the body. */
  branchCount: number;
  hasAsyncCall: boolean;
  hasDatabaseCall: boolean;
  hasNetworkCall: boolean;
  /** Full function declaration text, capped to 200 lines. */
  sourceSnippet: string;
}

export interface AnalyzeOptions {
  cwd: string;
  maxFiles?: number;
  logger: TrackLogger;
}

// ── Source-file walking (mirrors test-case-generator scan rules) ───────────

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

const MAX_FILE_BYTES = 200_000;
const MAX_SNIPPET_LINES = 200;

interface ScannedFile {
  rel: string;
  abs: string;
  content: string;
}

function walkSources(cwd: string, maxFiles: number, logger: TrackLogger): ScannedFile[] {
  const log = logger.child('ast');
  const out: ScannedFile[] = [];

  // BFS through configured target dirs first; also visit cwd itself shallow.
  const roots: string[] = [];
  for (const d of TARGET_DIRS) {
    const p = path.join(cwd, d);
    try {
      if (fs.statSync(p).isDirectory()) {
        roots.push(p);
        logBranch(log, 'agent.ast.root-decision', {
          decision: 'include',
          reasoning: 'configured TARGET_DIR exists',
          dir: d,
        });
      }
    } catch {
      // missing dir — silent, decision recorded only as omission
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
      logCatch(log, 'agent.ast.dir-read.error', e, { dir });
      continue;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) {
          logBranch(log, 'agent.ast.dir-decision', {
            decision: 'skip',
            reasoning: 'directory in SKIP_DIRS',
            dir: ent.name,
          });
          continue;
        }
        if (ent.name.startsWith('.')) {
          logBranch(log, 'agent.ast.dir-decision', {
            decision: 'skip',
            reasoning: 'dot-prefixed directory',
            dir: ent.name,
          });
          continue;
        }
        queue.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const rel = path.relative(cwd, full).split(path.sep).join('/');
      const ext = path.extname(ent.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      if (/\.(test|spec)\.[mc]?[tj]sx?$/.test(ent.name)) {
        log.log('info', 'agent.ast.file.skipped', { file: rel, reason: 'test-file' });
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch (e) {
        logCatch(log, 'agent.ast.file-stat.error', e, { file: rel });
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        log.log('info', 'agent.ast.file.skipped', {
          file: rel,
          reason: 'too-large',
          bytes: stat.size,
        });
        continue;
      }
      let content: string;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch (e) {
        logCatch(log, 'agent.ast.file-read.error', e, { file: rel });
        continue;
      }
      // Defensive double-check: content length too (some FS report size 0 for symlinks etc.)
      if (content.length > MAX_FILE_BYTES) {
        log.log('info', 'agent.ast.file.skipped', {
          file: rel,
          reason: 'too-large',
          bytes: content.length,
        });
        continue;
      }
      out.push({ rel, abs: full, content });
    }
  }
  return out;
}

// ── AST helpers ─────────────────────────────────────────────────────────────

const HTTP_VERBS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'HEAD',
]);

const EXPRESS_HOSTS: ReadonlySet<string> = new Set([
  'app',
  'router',
  'route',
  'api',
  'server',
]);

const EXPRESS_VERBS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'options',
  'head',
  'all',
  'use',
]);

const DB_HINT_RE = /(^|\.)(prisma|db|knex|sequelize|sql|supabase|pg|mongoose|drizzle|firestore)$/i;
const DB_METHOD_HINT_RE = /^(query|execute|run|raw|prepare|findOne|findMany|findFirst|findUnique|insert|update|delete|select|upsert|create|save|aggregate)$/;
const NETWORK_HINT_RE = /^(fetch|axios|got|undici|http|https|superagent|request|ky)$/i;

function pickScriptKind(rel: string): ts.ScriptKind {
  if (rel.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (rel.endsWith('.ts') || rel.endsWith('.mts') || rel.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  if (rel.endsWith('.jsx')) return ts.ScriptKind.JSX;
  // .js / .mjs / .cjs
  return ts.ScriptKind.JS;
}

function isExported(node: ts.Node): boolean {
  // ts.canHaveModifiers is the API path; getModifiers respects the new factory.
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  if (!mods) return false;
  for (const m of mods) {
    if (m.kind === ts.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}

function lineOfNode(sf: ts.SourceFile, node: ts.Node): number {
  // 0-based → +1
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function snippetOfNode(sf: ts.SourceFile, node: ts.Node): string {
  const raw = sf.text.slice(node.getStart(sf), node.getEnd());
  const lines = raw.split(/\r?\n/);
  if (lines.length <= MAX_SNIPPET_LINES) return raw;
  return lines.slice(0, MAX_SNIPPET_LINES).join('\n');
}

function paramListOf(
  params: readonly ts.ParameterDeclaration[],
  sf: ts.SourceFile,
): Array<{ name: string; typeHint: string | null }> {
  return params.map((p) => {
    let name = '';
    if (ts.isIdentifier(p.name)) {
      name = p.name.text;
    } else {
      // Pattern (ObjectBinding / ArrayBinding) — keep the raw source.
      name = sf.text.slice(p.name.getStart(sf), p.name.getEnd());
    }
    let typeHint: string | null = null;
    if (p.type) {
      typeHint = sf.text.slice(p.type.getStart(sf), p.type.getEnd()).trim();
    }
    return { name, typeHint };
  });
}

function returnTypeOf(
  sig: ts.SignatureDeclaration | ts.FunctionLikeDeclaration,
  sf: ts.SourceFile,
): string | null {
  const t = (sig as { type?: ts.TypeNode }).type;
  if (!t) return null;
  return sf.text.slice(t.getStart(sf), t.getEnd()).trim();
}

interface BodyStats {
  branchCount: number;
  hasAsyncCall: boolean;
  hasDatabaseCall: boolean;
  hasNetworkCall: boolean;
}

/** Walk a function body and tally branches + call kinds. */
function analyzeBody(body: ts.Node | undefined): BodyStats {
  const stats: BodyStats = {
    branchCount: 0,
    hasAsyncCall: false,
    hasDatabaseCall: false,
    hasNetworkCall: false,
  };
  if (!body) return stats;

  const visit = (node: ts.Node): void => {
    // Don't descend into nested function declarations — those would be
    // captured as their own FunctionInfo and we don't want their branches
    // inflating the parent's count.
    if (
      node !== body &&
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }

    if (ts.isIfStatement(node)) stats.branchCount += 1;
    else if (ts.isCaseClause(node)) stats.branchCount += 1;
    else if (ts.isTryStatement(node)) {
      // try always contributes 1; catch arm and finally each contribute 1 if present.
      stats.branchCount += 1;
      if (node.catchClause) stats.branchCount += 1;
      if (node.finallyBlock) stats.branchCount += 1;
    } else if (ts.isConditionalExpression(node)) stats.branchCount += 1;

    if (ts.isAwaitExpression(node)) stats.hasAsyncCall = true;

    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let head: string | null = null;
      let tail: string | null = null;
      if (ts.isIdentifier(expr)) {
        head = expr.text;
        tail = expr.text;
      } else if (ts.isPropertyAccessExpression(expr)) {
        // walk chain back to leftmost identifier
        let cur: ts.Expression = expr;
        while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
        if (ts.isIdentifier(cur)) head = cur.text;
        // tail = the rightmost property name
        tail = expr.name.text;
      }
      if (head) {
        if (NETWORK_HINT_RE.test(head)) stats.hasNetworkCall = true;
        if (DB_HINT_RE.test(head)) stats.hasDatabaseCall = true;
      }
      if (tail) {
        if (NETWORK_HINT_RE.test(tail)) stats.hasNetworkCall = true;
        if (DB_HINT_RE.test(tail)) stats.hasDatabaseCall = true;
        if (DB_METHOD_HINT_RE.test(tail) && head && DB_HINT_RE.test(head)) {
          // already captured
        }
      }
      // Special-case: `sql` template tag — sql\`SELECT ...\` parses to a
      // TaggedTemplateExpression, handled below. Also catch `fetch(...)`.
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag;
      if (ts.isIdentifier(tag) && /^sql$/i.test(tag.text)) {
        stats.hasDatabaseCall = true;
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);
  return stats;
}

// ── Endpoint route inference (file-path-based) ─────────────────────────────

function deriveNextRouteFromPath(rel: string): string | null {
  const parts = rel.split('/');
  const appIdx = parts.indexOf('app');
  const pagesIdx = parts.indexOf('pages');
  const baseIdx = appIdx !== -1 ? appIdx : pagesIdx;
  if (baseIdx === -1) return null;
  const baseSeg = parts[baseIdx];
  const rest = parts.slice(baseIdx + 1);
  if (rest.length === 0) return null;
  if (baseSeg === 'app') {
    const last = rest[rest.length - 1];
    if (!last || !/^route\.[mc]?[tj]sx?$/.test(last)) return null;
    const segs = rest.slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
    return '/' + segs.join('/');
  }
  if (baseSeg === 'pages') {
    const last = rest[rest.length - 1];
    if (!last) return null;
    const noExt = last.replace(/\.[mc]?[tj]sx?$/, '');
    const segs = [...rest.slice(0, -1), noExt];
    return '/' + segs.join('/');
  }
  return null;
}

function inferRouteFromHandlerPath(rel: string): string {
  const parts = rel.split('/');
  if (parts[0] === 'src') parts.shift();
  if (parts.length === 0) return '/';
  const last = parts[parts.length - 1] ?? '';
  const noExt = last.replace(/\.[mc]?[tj]sx?$/, '');
  if (noExt === 'index') parts.pop();
  else parts[parts.length - 1] = noExt;
  return '/' + parts.join('/');
}

// ── Per-file AST walk ───────────────────────────────────────────────────────

/**
 * Extract FunctionInfo records from a single parsed source file.
 *
 * Exported for unit testing — accepts an in-memory `ts.SourceFile` so tests
 * don't need temp dirs.
 */
export function extractFunctionsFromSource(
  sf: ts.SourceFile,
  rel: string,
  logger: TrackLogger | null = null,
): FunctionInfo[] {
  const log = logger ? logger.child('ast') : null;
  const out: FunctionInfo[] = [];
  const nextRoute = deriveNextRouteFromPath(rel);

  const pushInfo = (info: FunctionInfo): void => {
    out.push(info);
    if (log) {
      log.log('debug', 'agent.ast.function.found', {
        file: info.file,
        line: info.line,
        name: info.name,
        kind: info.kind,
        branchCount: info.branchCount,
      });
    }
  };

  const handleFunctionLike = (
    node:
      | ts.FunctionDeclaration
      | ts.FunctionExpression
      | ts.ArrowFunction
      | ts.MethodDeclaration,
    declaredName: string,
    exported: boolean,
  ): FunctionInfo | null => {
    // Determine kind.
    let kind: 'endpoint' | 'function' = 'function';
    let displayName = declaredName;

    if (HTTP_VERBS.has(declaredName) && exported) {
      kind = 'endpoint';
      // Endpoint name stays as the verb (POST/GET/...) per plan spec.
      displayName = declaredName;
    } else if (!exported) {
      // Non-exported FunctionDeclaration: per spec we skip these.
      logBranch(log, 'agent.ast.export-decision', {
        decision: 'skip',
        reasoning: 'function not exported',
        name: declaredName || '<anonymous>',
      });
      return null;
    }

    const stats = analyzeBody(node.body);
    const params = paramListOf(node.parameters, sf);
    const returnTypeHint = returnTypeOf(node, sf);

    return {
      file: rel,
      line: lineOfNode(sf, node),
      name: displayName,
      kind,
      params,
      returnTypeHint,
      branchCount: stats.branchCount,
      hasAsyncCall: stats.hasAsyncCall,
      hasDatabaseCall: stats.hasDatabaseCall,
      hasNetworkCall: stats.hasNetworkCall,
      sourceSnippet: snippetOfNode(sf, node),
    };
  };

  const handleExpressCall = (call: ts.CallExpression): FunctionInfo | null => {
    const expr = call.expression;
    if (!ts.isPropertyAccessExpression(expr)) return null;
    // verb name
    const verb = expr.name.text.toLowerCase();
    if (!EXPRESS_VERBS.has(verb)) return null;
    // host: leftmost identifier (app, router, etc.) — accept any identifier
    // ending in something Express-shaped (e.g. 'apiRouter').
    let cur: ts.Expression = expr.expression;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (!ts.isIdentifier(cur)) return null;
    const hostName = cur.text;
    const hostLower = hostName.toLowerCase();
    let hostMatch = EXPRESS_HOSTS.has(hostLower);
    if (!hostMatch) {
      for (const h of EXPRESS_HOSTS) {
        if (hostLower.startsWith(h)) {
          hostMatch = true;
          break;
        }
      }
    }
    if (!hostMatch) return null;

    // Find route arg (first string literal) for the display name.
    const args = call.arguments;
    if (args.length === 0) return null;
    const first = args[0];
    let route: string | null = null;
    if (first && ts.isStringLiteral(first)) route = first.text;
    else if (first && ts.isNoSubstitutionTemplateLiteral(first)) route = first.text;
    // Callback is typically the last argument.
    const callback = args[args.length - 1];
    if (!callback) return null;
    if (
      !ts.isArrowFunction(callback) &&
      !ts.isFunctionExpression(callback)
    ) {
      return null;
    }

    const stats = analyzeBody(callback.body);
    const params = paramListOf(callback.parameters, sf);
    const returnTypeHint = returnTypeOf(callback, sf);

    const displayName = route
      ? `${verb.toUpperCase()} ${route}`
      : `${verb.toUpperCase()} <dynamic>`;

    return {
      file: rel,
      line: lineOfNode(sf, call),
      name: displayName,
      kind: 'endpoint',
      params,
      returnTypeHint,
      branchCount: stats.branchCount,
      hasAsyncCall: stats.hasAsyncCall,
      hasDatabaseCall: stats.hasDatabaseCall,
      hasNetworkCall: stats.hasNetworkCall,
      sourceSnippet: snippetOfNode(sf, call),
    };
  };

  // Top-level walk: only process statements at the source file root, plus
  // recurse into ExpressionStatements (so we catch top-level `app.get(...)`)
  // and let nested function declarations be handled inline via export
  // detection. We do NOT walk into function bodies looking for more exported
  // functions — the public surface lives at the file's top scope.
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name ? node.name.text : '';
      if (!name) return;
      const info = handleFunctionLike(node, name, isExported(node));
      if (info) pushInfo(info);
      return;
    }

    if (ts.isVariableStatement(node)) {
      const exported = isExported(node);
      // We still emit for non-exported HTTP-verb consts? Per spec only exported.
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const declName = decl.name.text;
        if (!decl.initializer) continue;
        if (
          ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer)
        ) {
          if (!exported) {
            logBranch(log, 'agent.ast.export-decision', {
              decision: 'skip',
              reasoning: 'arrow/expression assignment not exported',
              name: declName,
            });
            continue;
          }
          const info = handleFunctionLike(decl.initializer, declName, true);
          if (info) pushInfo(info);
        }
      }
      return;
    }

    if (ts.isExportAssignment(node)) {
      // export default <expr> — pick up arrow / function expr
      const e = node.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
        const info = handleFunctionLike(e, 'default', true);
        if (info) pushInfo(info);
      }
      return;
    }

    if (ts.isExpressionStatement(node)) {
      const expr = node.expression;
      if (ts.isCallExpression(expr)) {
        const info = handleExpressCall(expr);
        if (info) pushInfo(info);
      }
      // also handle chained .get().post() — descend chain
      return;
    }
  };

  sf.statements.forEach(walk);

  // Endpoint-name override for HTTP-verb exports living outside Next.js
  // canonical layout: per plan spec, kind='endpoint' name=VERB. We don't
  // rewrite the name here (verb is already the name), but we surface the
  // inferred route for downstream consumers via... actually the
  // FunctionInfo schema does not carry route. We leave route inference to
  // the test-emitter which receives `file` and `name=VERB`.
  // (No-op block kept for clarity / future evolution.)
  void nextRoute;

  return out;
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Analyze functions in a project tree.
 *
 * Pipeline:
 *   1. Walk source files (same filter as test-case-generator).
 *   2. For each file: ts.createSourceFile + extractFunctionsFromSource.
 *   3. Collect FunctionInfo[] and emit per-stage events.
 *
 * Errors at any stage are logged and the offending file is skipped — the
 * overall analyzer never throws.
 */
export async function analyzeFunctions(opts: AnalyzeOptions): Promise<FunctionInfo[]> {
  const { cwd, logger } = opts;
  const maxFiles = opts.maxFiles ?? 200;
  const log = logger.child('ast');
  const startedAt = Date.now();

  log.log('info', 'agent.ast.start', { cwd, maxFiles });

  let files: ScannedFile[];
  try {
    files = walkSources(cwd, maxFiles, logger);
  } catch (e) {
    logCatch(log, 'agent.ast.walk.error', e);
    log.log('info', 'agent.ast.complete', {
      totalFunctions: 0,
      totalFiles: 0,
      durationMs: Date.now() - startedAt,
    });
    return [];
  }

  const out: FunctionInfo[] = [];
  for (const f of files) {
    const fileStartedAt = Date.now();
    let sf: ts.SourceFile;
    try {
      sf = ts.createSourceFile(
        f.rel,
        f.content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        pickScriptKind(f.rel),
      );
    } catch (e) {
      logCatch(log, 'agent.ast.parse.error', e, { file: f.rel });
      log.log('debug', 'agent.ast.file.skipped', { file: f.rel, reason: 'parse-error' });
      continue;
    }

    let perFile: FunctionInfo[];
    try {
      perFile = extractFunctionsFromSource(sf, f.rel, logger);
    } catch (e) {
      logCatch(log, 'agent.ast.extract.error', e, { file: f.rel });
      log.log('debug', 'agent.ast.file.skipped', { file: f.rel, reason: 'extract-error' });
      continue;
    }
    out.push(...perFile);
    log.log('debug', 'agent.ast.file.scanned', {
      file: f.rel,
      functions: perFile.length,
      durationMs: Date.now() - fileStartedAt,
    });
  }

  const durationMs = Date.now() - startedAt;
  log.log('info', 'agent.ast.complete', {
    totalFunctions: out.length,
    totalFiles: files.length,
    durationMs,
  });
  return out;
}
