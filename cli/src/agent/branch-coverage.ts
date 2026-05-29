/**
 * Branch coverage collector (Phase 11.5).
 *
 * Cross-references 4 independent signals per AST branch:
 *   1. AST     — does the branch exist? (static)
 *   2. SPEC    — did any generated spec.then mention this branch?
 *   3. JUDGE   — did the LLM-judge evidence.snippet quote a line inside?
 *   4. RUNTIME — did c8/istanbul show any line/branch in this range hit?
 *
 * Killer verdict: spec + judge claim coverage, but RUNTIME shows 0 hits →
 *   `judge-only` = self-deceiving test (LLM lied about what ran).
 *
 * Surface authority: `branch-coverage-types.ts` (the lead wrote those types
 * before dispatching this worker).
 *
 * Log taxonomy: `agent.branch-coverage.*`
 *   - .start
 *   - .ast-scan.complete
 *   - .signal.spec / .signal.judge / .signal.runtime
 *   - .branch.verdict (per branch — debug level)
 *   - .complete
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

import type { TrackLogger } from '../log-types.js';
import { logBranch, logCatch } from '../log/branch.js';
import type { TestCaseResult } from './types.js';
import { shouldScanDir, shouldScanFile } from './scope-filter.js';
import type {
  BranchCoverageReport,
  BranchNode,
  BranchVerdict,
  CollectorOpts,
  FunctionCoverage,
  JudgeEvidence,
  RuntimeCoverage,
  SpecMatch,
  AssociatedSpec,
} from './branch-coverage-types.js';

// ── File walking config (mirrors ast-analyzer) ─────────────────────────────

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const TARGET_DIRS = [
  'src', 'app', 'pages', 'api', 'routes', 'router', 'routers',
  'handlers', 'controllers', 'lib', 'server',
];

/**
 * Phase-17 note: directory / file gating uses `scope-filter.ts` (scope='app'
 * — this collector is for application-code branch coverage). We also skip
 * test directories since coverage of test code is not the product target.
 */
const EXTRA_TEST_DIR_SKIP = new Set(['__tests__', 'tests', 'test']);

const MAX_FILE_BYTES = 200_000;
const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_BRANCHES = 50;

// Tokens that are too generic to count as a spec-match.
const SPEC_STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'is', 'in', 'on', 'of', 'to', 'with',
  'for', 'by', 'as', 'at', 'be', 'are', 'this', 'that', 'it', 'has',
  'have', 'will', 'should', 'must', 'when', 'then', 'given', 'if',
  'else', 'not', 'no', 'do', 'does', 'did', 'than', 'but', 'so',
  'returns', 'return', 'response', 'request', 'req', 'res', 'data',
  'body', 'true', 'false', 'null', 'undefined', 'value',
  'function', 'endpoint', 'handler',
]);

// Verbs that are meaningful even when short — kept regardless of length.
const SPEC_KEEPVERBS = new Set([
  '401', '400', '403', '404', '405', '409', '413', '422', '429',
  '500', '502', '503',
  'throw', 'throws', 'thrown',
  'reject', 'rejected', 'rejects',
  'fail', 'fails', 'failed',
  'block', 'blocks', 'blocked',
  'deny', 'denied',
  'log', 'logs', 'logged',
]);

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Top-level collector. Pure function — no FS writes unless caller uses
 * writeBranchCoverage() helper separately.
 */
export async function collectBranchCoverage(
  opts: CollectorOpts,
): Promise<BranchCoverageReport> {
  const { cwd, logger } = opts;
  const log = logger.child('branch-coverage');
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBranchesPerFunction = opts.maxBranchesPerFunction ?? DEFAULT_MAX_BRANCHES;
  const startedAt = Date.now();

  log.log('info', 'agent.branch-coverage.start', { cwd });

  // ── Step 1: AST walk → BranchNode trees per function ───────────────────
  const astFns = walkAndExtractBranches(cwd, maxFiles, maxBranchesPerFunction, log);
  log.log('info', 'agent.branch-coverage.ast-scan.complete', {
    filesScanned: astFns.filesScanned,
    functionsFound: astFns.functions.length,
  });

  // ── Step 2: spec data ──────────────────────────────────────────────────
  const testResultsPath =
    opts.testResultsPath ?? path.join(cwd, '.zerou', 'test-results.json');
  const specResults = loadTestResults(testResultsPath, log);
  const specsByTarget = groupSpecsByTarget(specResults ?? []);
  log.log('info', 'agent.branch-coverage.signal.spec', {
    count: specResults?.length ?? 0,
    available: specResults !== null && specResults.length > 0,
  });

  // ── Step 3: runtime coverage data ─────────────────────────────────────
  const coveragePath =
    opts.coverageFinalPath ?? findCoverageFinalPath(cwd);
  const runtime = coveragePath ? loadIstanbulCoverage(coveragePath, log) : null;
  log.log('info', 'agent.branch-coverage.signal.runtime', {
    available: runtime !== null,
    path: coveragePath ?? null,
  });

  // ── Step 4: judge evidence signal availability ─────────────────────────
  const judgeAvailable = (specResults ?? []).some(
    (r) => r.evidence && typeof r.evidence.snippet === 'string' && r.evidence.snippet.length > 0,
  );
  log.log('info', 'agent.branch-coverage.signal.judge', {
    available: judgeAvailable,
    count: (specResults ?? []).filter((r) => r.evidence?.snippet).length,
  });

  // ── Step 5: cross-reference per function ───────────────────────────────
  const runtimeAvailable = runtime !== null;
  const fnReports: FunctionCoverage[] = astFns.functions.map((fn) => {
    return annotateFunction({
      fn,
      cwd,
      specsByTarget,
      runtime,
      runtimeAvailable,
      logger: log,
    });
  });

  // ── Step 6: aggregate ──────────────────────────────────────────────────
  const summary = aggregateSummary(fnReports);

  const availability = {
    ast: astFns.functions.length > 0,
    spec: specResults !== null && specResults.length > 0,
    judge: judgeAvailable,
    runtime: runtimeAvailable,
  };

  log.log('info', 'agent.branch-coverage.complete', {
    functions: summary.functionsAnalyzed,
    branches: summary.branchesTotal,
    selfDeceiving: summary.selfDeceivingTotal,
    untested: summary.untestedTotal,
    durationMs: Date.now() - startedAt,
  });

  return {
    generatedAt: new Date().toISOString(),
    cwd,
    functions: fnReports,
    summary,
    availability,
  };
}

/** Atomic write helper. Lead orchestrates from audit.ts. */
export function writeBranchCoverage(
  cwd: string,
  report: BranchCoverageReport,
): string {
  const outDir = path.join(cwd, '.zerou');
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, 'branch-coverage.json');
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  return target;
}

// ── Step 1 internals: AST walk + branch tree extraction ────────────────────

interface ExtractedFunction {
  file: string;        // POSIX relative
  name: string;
  line: number;
  /** the function's body line range, used as the entry node range. */
  bodyLineStart: number;
  bodyLineEnd: number;
  root: BranchNode;
  /** flattened branch list including root, used for cross-ref. */
  flat: BranchNode[];
  /** source text of file (kept to enable line-range lookups). */
  fileText: string;
}

interface WalkResult {
  functions: ExtractedFunction[];
  filesScanned: number;
}

function walkAndExtractBranches(
  cwd: string,
  maxFiles: number,
  maxBranches: number,
  logger: TrackLogger,
): WalkResult {
  const files = walkSourceFiles(cwd, maxFiles, logger);
  const fns: ExtractedFunction[] = [];

  for (const f of files) {
    let sf: ts.SourceFile;
    try {
      sf = ts.createSourceFile(
        f.rel,
        f.content,
        ts.ScriptTarget.Latest,
        true,
        pickScriptKind(f.rel),
      );
    } catch (e) {
      logCatch(logger, 'agent.branch-coverage.parse.error', e, { file: f.rel });
      continue;
    }

    const extracted = extractBranchesFromSource(sf, f.rel, f.content, maxBranches, logger);
    fns.push(...extracted);
  }

  return { functions: fns, filesScanned: files.length };
}

interface ScannedFile {
  rel: string;
  abs: string;
  content: string;
}

function walkSourceFiles(
  cwd: string,
  maxFiles: number,
  logger: TrackLogger,
): ScannedFile[] {
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
      logCatch(logger, 'agent.branch-coverage.dir-read.error', e, { dir });
      continue;
    }

    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!shouldScanDir(ent.name, 'app')) continue;
        if (EXTRA_TEST_DIR_SKIP.has(ent.name)) continue;
        if (ent.name.startsWith('.')) continue;
        queue.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      if (/\.(test|spec)\.[mc]?[tj]sx?$/.test(ent.name)) continue;

      const rel = path.relative(cwd, full).split(path.sep).join('/');
      const fileDecision = shouldScanFile({ scope: 'app', cwd, relPath: rel });
      if (!fileDecision.scan) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;

      let content: string;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch (e) {
        logCatch(logger, 'agent.branch-coverage.file-read.error', e, { file: full });
        continue;
      }
      if (content.length > MAX_FILE_BYTES) continue;
      out.push({ rel, abs: full, content });
    }
  }
  return out;
}

function pickScriptKind(rel: string): ts.ScriptKind {
  if (rel.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (rel.endsWith('.ts') || rel.endsWith('.mts') || rel.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  if (rel.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

const HTTP_VERBS: ReadonlySet<string> = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD',
]);

function isExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  if (!mods) return false;
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Extract per-function branch trees. Exported for testing. */
export function extractBranchesFromSource(
  sf: ts.SourceFile,
  rel: string,
  fileText: string,
  maxBranches: number,
  logger: TrackLogger | null = null,
): ExtractedFunction[] {
  const out: ExtractedFunction[] = [];

  const handleFunctionLike = (
    fnNode: ts.FunctionLikeDeclarationBase,
    declaredName: string,
    exported: boolean,
  ): void => {
    if (!exported) return;
    // Only consider HTTP verbs (endpoints) or arbitrarily-named exported fns.
    const decl = fnNode as unknown as ts.Node;
    const declLine = lineOf(sf, decl.getStart(sf));
    const body = (fnNode as { body?: ts.Node }).body;
    if (!body) return;
    const bodyStart = lineOf(sf, body.getStart(sf));
    const bodyEnd = lineOf(sf, body.getEnd());

    // Build branch tree.
    const counter = { n: 0 };
    const root: BranchNode = makeNode({
      id: 'entry',
      label: declaredName,
      lineStart: declLine,
      lineEnd: declLine,
      kind: 'entry',
    });

    const children = visitForBranches(body, sf, declaredName, counter, maxBranches);
    root.children = children;

    const flat = flattenTree(root);
    if (logger) {
      logger.log('debug', 'agent.branch-coverage.function.extracted', {
        file: rel,
        name: declaredName,
        branches: flat.length,
      });
    }

    out.push({
      file: rel,
      name: declaredName,
      line: declLine,
      bodyLineStart: bodyStart,
      bodyLineEnd: bodyEnd,
      root,
      flat,
      fileText,
    });
  };

  sf.statements.forEach((node) => {
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? '';
      if (!name) return;
      handleFunctionLike(node, name, isExported(node));
      return;
    }

    if (ts.isVariableStatement(node)) {
      if (!isExported(node)) return;
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const declName = decl.name.text;
        const init = decl.initializer;
        if (!init) continue;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          handleFunctionLike(init, declName, true);
        }
      }
      return;
    }

    if (ts.isExportAssignment(node)) {
      const e = node.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
        handleFunctionLike(e, 'default', true);
      }
    }
  });

  // Silence unused HTTP_VERBS warning (kept for future filtering).
  void HTTP_VERBS;

  return out;
}

function makeNode(args: {
  id: string;
  label: string;
  lineStart: number;
  lineEnd: number;
  kind: BranchNode['kind'];
}): BranchNode {
  return {
    id: args.id,
    label: args.label,
    lineStart: args.lineStart,
    lineEnd: args.lineEnd,
    kind: args.kind,
    children: [],
    ast: { present: true },
    specMatches: [],
    judgeEvidence: [],
    runtimeCoverage: { linesTotal: 0, linesCovered: 0, branchHit: null },
    verdict: 'unknown',
  };
}

/** Visit a body / sub-statement and return branch nodes that are direct children. */
function visitForBranches(
  node: ts.Node,
  sf: ts.SourceFile,
  fnName: string,
  counter: { n: number },
  maxBranches: number,
): BranchNode[] {
  const out: BranchNode[] = [];

  const visit = (n: ts.Node): void => {
    if (counter.n >= maxBranches) return;

    // Don't descend into nested function declarations — those are separate units.
    if (
      n !== node &&
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n))
    ) {
      return;
    }

    if (ts.isIfStatement(n)) {
      const condText = trimToLabel(textOf(sf, n.expression));
      const ifLine = lineOf(sf, n.getStart(sf));
      const thenStart = lineOf(sf, n.thenStatement.getStart(sf));
      const thenEnd = lineOf(sf, n.thenStatement.getEnd());
      const trueNode = makeNode({
        id: `if-${ifLine}-true-${++counter.n}`,
        label: `${condText} TRUE`,
        lineStart: thenStart,
        lineEnd: thenEnd,
        kind: 'if-true',
      });
      trueNode.children = visitForBranches(n.thenStatement, sf, fnName, counter, maxBranches);
      out.push(trueNode);

      if (n.elseStatement) {
        const elseStart = lineOf(sf, n.elseStatement.getStart(sf));
        const elseEnd = lineOf(sf, n.elseStatement.getEnd());
        const falseNode = makeNode({
          id: `if-${ifLine}-false-${++counter.n}`,
          label: `${condText} FALSE`,
          lineStart: elseStart,
          lineEnd: elseEnd,
          kind: 'if-false',
        });
        falseNode.children = visitForBranches(n.elseStatement, sf, fnName, counter, maxBranches);
        out.push(falseNode);
      }
      return;
    }

    if (ts.isSwitchStatement(n)) {
      const swLine = lineOf(sf, n.getStart(sf));
      n.caseBlock.clauses.forEach((c, idx) => {
        if (counter.n >= maxBranches) return;
        const cStart = lineOf(sf, c.getStart(sf));
        const cEnd = lineOf(sf, c.getEnd());
        if (ts.isCaseClause(c)) {
          const caseLabel = trimToLabel(textOf(sf, c.expression));
          const node = makeNode({
            id: `switch-${swLine}-case-${idx}-${++counter.n}`,
            label: `case ${caseLabel}`,
            lineStart: cStart,
            lineEnd: cEnd,
            kind: 'switch-case',
          });
          for (const st of c.statements) {
            node.children.push(...visitForBranches(st, sf, fnName, counter, maxBranches));
          }
          out.push(node);
        } else {
          // DefaultClause
          const node = makeNode({
            id: `switch-${swLine}-default-${++counter.n}`,
            label: 'default',
            lineStart: cStart,
            lineEnd: cEnd,
            kind: 'switch-default',
          });
          for (const st of c.statements) {
            node.children.push(...visitForBranches(st, sf, fnName, counter, maxBranches));
          }
          out.push(node);
        }
      });
      return;
    }

    if (ts.isTryStatement(n)) {
      const tryLine = lineOf(sf, n.getStart(sf));
      const tryStart = lineOf(sf, n.tryBlock.getStart(sf));
      const tryEnd = lineOf(sf, n.tryBlock.getEnd());
      const tryNode = makeNode({
        id: `try-${tryLine}-body-${++counter.n}`,
        label: 'try body',
        lineStart: tryStart,
        lineEnd: tryEnd,
        kind: 'try-body',
      });
      tryNode.children = visitForBranches(n.tryBlock, sf, fnName, counter, maxBranches);
      out.push(tryNode);

      if (n.catchClause) {
        const cStart = lineOf(sf, n.catchClause.getStart(sf));
        const cEnd = lineOf(sf, n.catchClause.getEnd());
        const varName = n.catchClause.variableDeclaration
          ? textOf(sf, n.catchClause.variableDeclaration)
          : 'err';
        const catchNode = makeNode({
          id: `try-${tryLine}-catch-${++counter.n}`,
          label: `catch ${trimToLabel(varName)}`,
          lineStart: cStart,
          lineEnd: cEnd,
          kind: 'catch',
        });
        catchNode.children = visitForBranches(n.catchClause.block, sf, fnName, counter, maxBranches);
        out.push(catchNode);
      }

      if (n.finallyBlock) {
        const fStart = lineOf(sf, n.finallyBlock.getStart(sf));
        const fEnd = lineOf(sf, n.finallyBlock.getEnd());
        const finNode = makeNode({
          id: `try-${tryLine}-finally-${++counter.n}`,
          label: 'finally',
          lineStart: fStart,
          lineEnd: fEnd,
          kind: 'finally',
        });
        finNode.children = visitForBranches(n.finallyBlock, sf, fnName, counter, maxBranches);
        out.push(finNode);
      }
      return;
    }

    if (ts.isConditionalExpression(n)) {
      const tLine = lineOf(sf, n.whenTrue.getStart(sf));
      const tEnd = lineOf(sf, n.whenTrue.getEnd());
      const fLine = lineOf(sf, n.whenFalse.getStart(sf));
      const fEnd = lineOf(sf, n.whenFalse.getEnd());
      const cond = trimToLabel(textOf(sf, n.condition));
      out.push(makeNode({
        id: `ternary-${tLine}-true-${++counter.n}`,
        label: `${cond} ? TRUE`,
        lineStart: tLine,
        lineEnd: tEnd,
        kind: 'ternary-true',
      }));
      out.push(makeNode({
        id: `ternary-${fLine}-false-${++counter.n}`,
        label: `${cond} ? FALSE`,
        lineStart: fLine,
        lineEnd: fEnd,
        kind: 'ternary-false',
      }));
      // still descend in case nested ifs/ternaries inside arms
      ts.forEachChild(n, visit);
      return;
    }

    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const isShortCircuit =
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken;
      // Only count when the RHS is "statement-like" (a call, throw expr, etc.)
      // Heuristic: RHS is a CallExpression or contains side effects.
      if (
        isShortCircuit &&
        (ts.isCallExpression(n.right) ||
          ts.isAwaitExpression(n.right) ||
          ts.isParenthesizedExpression(n.right))
      ) {
        const rStart = lineOf(sf, n.right.getStart(sf));
        const rEnd = lineOf(sf, n.right.getEnd());
        const lhs = trimToLabel(textOf(sf, n.left));
        out.push(makeNode({
          id: `short-${rStart}-${++counter.n}`,
          label: `${lhs} short-circuit`,
          lineStart: rStart,
          lineEnd: rEnd,
          kind: 'short-circuit',
        }));
      }
      ts.forEachChild(n, visit);
      return;
    }

    if (
      ts.isForStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n)
    ) {
      // Collapse loop body as a single node.
      const stmt = (n as ts.IterationStatement).statement;
      const bStart = lineOf(sf, stmt.getStart(sf));
      const bEnd = lineOf(sf, stmt.getEnd());
      const loopNode = makeNode({
        id: `loop-${bStart}-${++counter.n}`,
        label: 'loop body',
        lineStart: bStart,
        lineEnd: bEnd,
        kind: 'loop-body',
      });
      loopNode.children = visitForBranches(stmt, sf, fnName, counter, maxBranches);
      out.push(loopNode);
      return;
    }

    ts.forEachChild(n, visit);
  };

  // Visit children of `node` (not `node` itself, so the initial body block
  // doesn't get treated as a branch).
  ts.forEachChild(node, visit);
  return out;
}

function textOf(sf: ts.SourceFile, node: ts.Node): string {
  return sf.text.slice(node.getStart(sf), node.getEnd());
}

function trimToLabel(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}...` : collapsed;
}

function flattenTree(root: BranchNode): BranchNode[] {
  const out: BranchNode[] = [];
  const stack: BranchNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    for (const c of n.children) stack.push(c);
  }
  return out;
}

// ── Step 2 internals: spec data ───────────────────────────────────────────

/** Read test-results.json. Returns null if missing/malformed. */
export function loadTestResults(
  filePath: string,
  logger: TrackLogger | null = null,
): TestCaseResult[] | null {
  if (!fs.existsSync(filePath)) {
    logBranch(logger, 'agent.branch-coverage.test-results.read-decision', {
      decision: 'not-found',
      path: filePath,
    });
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    logCatch(logger, 'agent.branch-coverage.test-results.read.error', e, { path: filePath });
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    logCatch(logger, 'agent.branch-coverage.test-results.parse.error', e, { path: filePath });
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter((x): x is TestCaseResult => {
    if (!x || typeof x !== 'object') return false;
    const rec = x as Record<string, unknown>;
    const spec = rec.spec as Record<string, unknown> | undefined;
    if (!spec || typeof spec !== 'object') return false;
    if (typeof spec.id !== 'string') return false;
    if (typeof rec.status !== 'string') return false;
    if (!['pass', 'fail', 'inconclusive', 'skipped'].includes(rec.status as string)) return false;
    return true;
  });
}

/** Group specs by `spec.scope.target`. */
function groupSpecsByTarget(results: TestCaseResult[]): Map<string, TestCaseResult[]> {
  const m = new Map<string, TestCaseResult[]>();
  for (const r of results) {
    const target = r.spec.scope?.target;
    if (typeof target !== 'string') continue;
    let arr = m.get(target);
    if (!arr) {
      arr = [];
      m.set(target, arr);
    }
    arr.push(r);
  }
  return m;
}

// ── Step 3 internals: istanbul coverage-final.json ─────────────────────────

interface IstanbulFile {
  path: string;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
  branchMap?: Record<string, {
    loc?: { start: { line: number }; end: { line: number } };
    locations?: Array<{ start?: { line: number }; end?: { line: number } }>;
    line?: number;
  }>;
  b?: Record<string, number[]>;
}

interface RuntimeData {
  /** key: POSIX rel path (best-effort) AND absolute path → Set of hit lines. */
  hitLines: Map<string, Set<number>>;
  /** key: POSIX rel path → array of {line, hit:boolean}. */
  branchHits: Map<string, Array<{ line: number; hit: boolean }>>;
}

function findCoverageFinalPath(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'coverage', 'coverage-final.json'),
    path.join(cwd, '.zerou', 'coverage', 'coverage-final.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadIstanbulCoverage(
  filePath: string,
  logger: TrackLogger | null = null,
): RuntimeData | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    logCatch(logger, 'agent.branch-coverage.coverage.read.error', e, { path: filePath });
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    logCatch(logger, 'agent.branch-coverage.coverage.parse.error', e, { path: filePath });
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const hitLines = new Map<string, Set<number>>();
  const branchHits = new Map<string, Array<{ line: number; hit: boolean }>>();

  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const f = val as Partial<IstanbulFile>;
    const absPath = typeof f.path === 'string' ? f.path : key;
    const posixPath = absPath.split(path.sep).join('/');

    const set = new Set<number>();
    if (f.statementMap && f.s) {
      for (const [sid, hit] of Object.entries(f.s)) {
        if (typeof hit !== 'number' || hit <= 0) continue;
        const stmt = f.statementMap[sid];
        if (!stmt || !stmt.start) continue;
        const lStart = stmt.start.line;
        const lEnd = stmt.end?.line ?? lStart;
        for (let l = lStart; l <= lEnd; l++) set.add(l);
      }
    }
    hitLines.set(posixPath, set);
    // Also register under the original key for matching when istanbul uses
    // absolute paths but the AST walker emits relative ones — the caller does
    // a best-effort lookup that tries multiple suffixes.
    hitLines.set(key, set);

    const bHits: Array<{ line: number; hit: boolean }> = [];
    if (f.branchMap && f.b) {
      for (const [bid, hits] of Object.entries(f.b)) {
        const bm = f.branchMap[bid];
        if (!bm) continue;
        const locs = bm.locations ?? [];
        for (let armIdx = 0; armIdx < locs.length; armIdx++) {
          const loc = locs[armIdx];
          const line = loc?.start?.line ?? bm.loc?.start?.line ?? bm.line;
          if (typeof line !== 'number') continue;
          const armHit = (hits[armIdx] ?? 0) > 0;
          bHits.push({ line, hit: armHit });
        }
      }
    }
    branchHits.set(posixPath, bHits);
    branchHits.set(key, bHits);
  }

  return { hitLines, branchHits };
}

/** Find the hit-line set for a relative file path. Tries POSIX, suffix match. */
function lookupHitLines(
  runtime: RuntimeData,
  relFile: string,
): Set<number> | null {
  // Direct
  let hit = runtime.hitLines.get(relFile);
  if (hit) return hit;
  // POSIX normalized
  const norm = relFile.split(path.sep).join('/');
  hit = runtime.hitLines.get(norm);
  if (hit) return hit;
  // Suffix scan
  for (const [k, v] of runtime.hitLines) {
    const kNorm = k.split(path.sep).join('/');
    if (kNorm.endsWith(norm) || norm.endsWith(kNorm)) return v;
  }
  return null;
}

function lookupBranchHits(
  runtime: RuntimeData,
  relFile: string,
): Array<{ line: number; hit: boolean }> | null {
  let hit = runtime.branchHits.get(relFile);
  if (hit) return hit;
  const norm = relFile.split(path.sep).join('/');
  hit = runtime.branchHits.get(norm);
  if (hit) return hit;
  for (const [k, v] of runtime.branchHits) {
    const kNorm = k.split(path.sep).join('/');
    if (kNorm.endsWith(norm) || norm.endsWith(kNorm)) return v;
  }
  return null;
}

// ── Step 4 internals: cross-reference ─────────────────────────────────────

interface AnnotateOpts {
  fn: ExtractedFunction;
  cwd: string;
  specsByTarget: Map<string, TestCaseResult[]>;
  runtime: RuntimeData | null;
  runtimeAvailable: boolean;
  logger: TrackLogger;
}

function annotateFunction(opts: AnnotateOpts): FunctionCoverage {
  const { fn, specsByTarget, runtime, runtimeAvailable, logger } = opts;

  // Find specs that target this function.
  const candidates: TestCaseResult[] = [];
  for (const [target, results] of specsByTarget) {
    if (specTargetsFunction(target, fn)) {
      candidates.push(...results);
    }
  }

  const associatedSpecs: AssociatedSpec[] = candidates.map((r) => ({
    specId: r.spec.id,
    specName: r.spec.name,
    status: r.status,
    category: r.spec.category,
  }));

  const hitLineSet = runtime ? lookupHitLines(runtime, fn.file) : null;
  const branchHitList = runtime ? lookupBranchHits(runtime, fn.file) : null;

  // Walk every node in the flat list (including root) and annotate.
  for (const node of fn.flat) {
    annotateBranchNode({
      node,
      file: fn.file,
      fileText: fn.fileText,
      candidates,
      hitLineSet,
      branchHitList,
      runtimeAvailable,
      logger,
    });
  }

  let coveredCount = 0;
  let selfDeceivingCount = 0;
  let untestedCount = 0;
  for (const node of fn.flat) {
    // Skip the entry root — it's excluded from branchCount (the denominator),
    // so it must not contribute to the numerator either.
    if (node.kind === 'entry') continue;
    if (node.verdict === 'covered') coveredCount++;
    else if (node.verdict === 'judge-only') selfDeceivingCount++;
    else if (node.verdict === 'untested') untestedCount++;
  }

  // Exclude the per-function `entry` root: it is the function declaration node,
  // not a decision branch, and the numerator (branch-trace stream + the
  // verdict-counting loop in coverage.ts) excludes it. Counting it in the
  // denominator would add 1 uncoverable branch per function, capping coverage
  // below 100%. Keep this consistent with summary.branchesTotal and the
  // per-function UI math.
  const branchCount = fn.flat.filter((n) => n.kind !== 'entry').length;

  return {
    id: `${fn.file}:${fn.name}@${fn.line}`,
    file: fn.file,
    name: fn.name,
    line: fn.line,
    branchCount,
    coveredCount,
    selfDeceivingCount,
    untestedCount,
    root: fn.root,
    associatedSpecs,
  };
}

/** Heuristic: does spec.scope.target name this function? */
function specTargetsFunction(target: string, fn: ExtractedFunction): boolean {
  // 'fn:hashPassword' → match by name
  if (target.startsWith('fn:')) {
    return target.slice(3) === fn.name;
  }
  // 'POST /api/login' → derive route from file path; HTTP verb matches name.
  const httpMatch = target.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+(\S.*)$/);
  if (httpMatch) {
    const verb = httpMatch[1]!;
    if (verb !== fn.name) return false;
    // Derive route from file path: app/api/foo/route.ts → /api/foo
    const route = deriveRouteFromFile(fn.file);
    if (!route) return false;
    // Compare with bracket/[id] normalization.
    return normalizeRoute(route) === normalizeRoute(httpMatch[2]!);
  }
  // 'flow:signup' or freeform: best-effort substring of function name.
  return target.includes(fn.name);
}

function deriveRouteFromFile(rel: string): string | null {
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

function normalizeRoute(r: string): string {
  return r
    .replace(/\[([^\]]+)\]/g, ':$1')  // [id] → :id
    .replace(/\/$/, '')
    .toLowerCase();
}

interface AnnotateNodeOpts {
  node: BranchNode;
  file: string;
  fileText: string;
  candidates: TestCaseResult[];
  hitLineSet: Set<number> | null;
  branchHitList: Array<{ line: number; hit: boolean }> | null;
  runtimeAvailable: boolean;
  logger: TrackLogger;
}

function annotateBranchNode(opts: AnnotateNodeOpts): void {
  const { node, fileText, candidates, hitLineSet, branchHitList, runtimeAvailable, logger } = opts;

  // The text of this branch (label + source lines) used for token matching.
  const lines = fileText.split(/\r?\n/);
  const startIdx = Math.max(0, node.lineStart - 1);
  const endIdx = Math.min(lines.length, node.lineEnd);
  const codeText = lines.slice(startIdx, endIdx).join('\n');
  const branchHaystack = `${node.label}\n${codeText}`.toLowerCase();

  // ── SPEC matching ────────────────────────────────────────────────────
  for (const r of candidates) {
    const specText = `${r.spec.then ?? ''} ${r.spec.when ?? ''} ${r.spec.name ?? ''}`;
    const matched = matchSpecTokens(specText, branchHaystack);
    if (matched.length > 0) {
      const m: SpecMatch = {
        specId: r.spec.id,
        specName: r.spec.name,
        matchedTokens: matched,
      };
      node.specMatches.push(m);
    }
  }

  // ── JUDGE evidence ───────────────────────────────────────────────────
  for (const r of candidates) {
    const snippet = r.evidence?.snippet;
    if (!snippet) continue;
    const evLine = r.evidence?.line;
    let inside = false;
    if (typeof evLine === 'number') {
      if (evLine >= node.lineStart && evLine <= node.lineEnd) inside = true;
    } else {
      // Fallback: best-effort substring match within the branch's code text.
      if (codeText.length > 0 && codeText.includes(snippet.trim())) inside = true;
    }
    if (inside) {
      const ev: JudgeEvidence = {
        specId: r.spec.id,
        status: r.status,
        snippet,
      };
      node.judgeEvidence.push(ev);
    }
  }

  // ── RUNTIME coverage ─────────────────────────────────────────────────
  const linesTotal = Math.max(1, node.lineEnd - node.lineStart + 1);
  let linesCovered = 0;
  if (hitLineSet) {
    for (let l = node.lineStart; l <= node.lineEnd; l++) {
      if (hitLineSet.has(l)) linesCovered++;
    }
  }

  let branchHit: boolean | null = null;
  if (branchHitList) {
    const inRange = branchHitList.filter(
      (b) => b.line >= node.lineStart && b.line <= node.lineEnd,
    );
    if (inRange.length > 0) {
      branchHit = inRange.some((b) => b.hit);
    }
  }
  const rc: RuntimeCoverage = {
    linesTotal,
    linesCovered,
    branchHit,
  };
  node.runtimeCoverage = rc;

  // ── Verdict ──────────────────────────────────────────────────────────
  const hasSpec = node.specMatches.length > 0;
  // A branch counts as judge-covered only if a judge test PASSED for it.
  // Evidence is pushed regardless of status (incl. 'fail'), so a branch whose
  // judge test failed must NOT count as covered — fall through to the other
  // signals (spec-only / run-only / untested), which is the correct outcome:
  // a failed judge is not coverage.
  const hasJudge = node.judgeEvidence.some((e) => e.status === 'pass');
  // Prefer the accurate per-arm branchHit signal when the runtime provides it:
  // a true-arm hit must not mark the false-arm covered. Only fall back to
  // line-level coverage when branchHit is unknown (null) for this node.
  const hasRun = branchHit !== null ? branchHit : linesCovered > 0;

  let verdict: BranchVerdict;
  if (!runtimeAvailable) {
    // Runtime unavailable: downgrade.
    if (hasSpec && hasJudge) verdict = 'judge-only';
    else if (hasSpec) verdict = 'spec-only';
    else if (hasJudge) verdict = 'judge-only';
    else verdict = node.kind === 'entry' ? 'unknown' : 'untested';
    if (!hasSpec && !hasJudge && node.kind !== 'entry') verdict = 'untested';
    logBranch(logger, 'agent.branch-coverage.branch.verdict', {
      decision: verdict,
      reasoning: 'runtime-unavailable',
      branch: node.id,
      hasSpec,
      hasJudge,
    });
  } else {
    if (hasSpec && hasJudge && hasRun) verdict = 'covered';
    else if (hasSpec && hasJudge && !hasRun) verdict = 'judge-only';
    else if (hasSpec && !hasJudge && !hasRun) verdict = 'spec-only';
    else if (hasSpec && !hasJudge && hasRun) verdict = 'covered'; // spec + run > spec-only
    else if (!hasSpec && hasRun) verdict = 'run-only';
    else if (!hasSpec && hasJudge && !hasRun) verdict = 'judge-only';
    else verdict = 'untested';
    logBranch(logger, 'agent.branch-coverage.branch.verdict', {
      decision: verdict,
      branch: node.id,
      hasSpec, hasJudge, hasRun,
    });
  }
  node.verdict = verdict;
}

/** Tokenize a spec text and find tokens that appear in the branch haystack. */
export function matchSpecTokens(specText: string, branchHaystack: string): string[] {
  const tokens = tokenize(specText);
  const matched: string[] = [];
  for (const t of tokens) {
    if (branchHaystack.includes(t)) {
      if (!matched.includes(t)) matched.push(t);
    }
  }
  return matched;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  // Split on whitespace + punctuation (keep digits + alphabetic + underscore).
  const parts = text.toLowerCase().split(/[^a-z0-9_]+/);
  for (const p of parts) {
    if (!p) continue;
    if (SPEC_KEEPVERBS.has(p)) {
      out.push(p);
      continue;
    }
    if (SPEC_STOPWORDS.has(p)) continue;
    // Numeric (status codes etc.) — always interesting.
    if (/^\d+$/.test(p)) {
      out.push(p);
      continue;
    }
    if (p.length < 4) continue; // skip short non-numeric / non-verb tokens
    out.push(p);
  }
  return out;
}

// ── Step 5: aggregate ──────────────────────────────────────────────────────

function aggregateSummary(fns: FunctionCoverage[]): BranchCoverageReport['summary'] {
  let branchesTotal = 0;
  let branchesCovered = 0;
  let selfDeceivingTotal = 0;
  let untestedTotal = 0;
  let functionsWithSelfDeception = 0;
  for (const fn of fns) {
    branchesTotal += fn.branchCount;
    branchesCovered += fn.coveredCount;
    selfDeceivingTotal += fn.selfDeceivingCount;
    untestedTotal += fn.untestedCount;
    if (fn.selfDeceivingCount > 0) functionsWithSelfDeception++;
  }
  return {
    functionsAnalyzed: fns.length,
    branchesTotal,
    branchesCovered,
    selfDeceivingTotal,
    untestedTotal,
    functionsWithSelfDeception,
  };
}
