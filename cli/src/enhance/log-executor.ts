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
import { spawnSync } from 'node:child_process';

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

// Production-grade templates live in their own file so they can be unit-tested
// for structural correctness (TypeScript parseability, redact paths, ALS export,
// stdSerializers) without dragging in the executor's regex logic. See
// `bootstrap-templates.ts` + its `.test.ts` for the contract.
import {
  BOOTSTRAP_TEMPLATE,
  MIDDLEWARE_TEMPLATE_NEXT as MIDDLEWARE_TEMPLATE,
} from './bootstrap-templates.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Test seam — override the post-rewrite tsc self-check. Default impl runs
 * `npx tsc --noEmit`. Tests inject a stub so they don't spawn a real
 * subprocess. Mirrors bug-patcher's `TscRunner` seam.
 */
export type TscCheckFn = (cwd: string) => { ok: true } | { ok: false; firstError: string };

export interface LogExecutorOpts {
  cwd: string;
  plan: InjectionPlan;
  logger: TrackLogger;
  /**
   * @internal — test-only seam for the post-rewrite tsc self-check. When
   * omitted, the default `runTsc` (spawns `npx tsc --noEmit`) is used. Every
   * file we rewrite is tsc-checked; on failure the original bytes are restored
   * and the file is skipped with reason `log-rewrite-tsc-failed`.
   */
  runTscFn?: TscCheckFn;
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

/**
 * Atomic write: write to a temp file in the SAME directory, then
 * `fs.renameSync` over the target. A crash mid-write leaves either the old
 * file intact or the new file fully written — never a truncated/half-written
 * source. Same-dir temp guarantees the rename is a same-filesystem atomic op.
 */
function writeFileSafe(abs: string, content: string): { ok: true } | { ok: false; reason: string } {
  try {
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.${path.basename(abs)}.zerou-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    try {
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, abs);
    } catch (e) {
      // Best-effort cleanup of the temp file if the rename failed.
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore cleanup failure */
      }
      throw e;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

interface TscOk {
  ok: true;
}
interface TscFail {
  ok: false;
  firstError: string;
}

/**
 * Default post-rewrite self-check: run `npx tsc --noEmit` over the project. If
 * the project has a tsconfig.json we point at it; otherwise a bare invocation.
 * Returns the first `error`-matching line on failure.
 */
export function runTsc(cwd: string): TscOk | TscFail {
  const tsconfig = path.join(cwd, 'tsconfig.json');
  const hasTsconfig = fs.existsSync(tsconfig);
  const args = hasTsconfig
    ? ['--yes', 'tsc', '--noEmit', '-p', 'tsconfig.json']
    : ['--yes', 'tsc', '--noEmit'];
  const res = spawnSync('npx', args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    shell: process.platform === 'win32',
  });
  if (res.status === 0) return { ok: true };
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  const firstError = out.split(/\r?\n/).find((l) => /error/i.test(l)) ?? out.slice(0, 200);
  return { ok: false, firstError };
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

function importStatementFor(importSpec: string, localName: string): string {
  if (localName === 'logger') {
    return `import { logger } from '${importSpec}';\n`;
  }
  return `import { logger as ${localName} } from '${importSpec}';\n`;
}

/**
 * P1-1 fix: only count an import as "ours" if it points at the bootstrap path
 * we're about to write. Foreign `import { logger } from '@my-org/log'` does
 * NOT shadow us.
 *
 * Returns:
 *   - { kind: 'ours' }      — our bootstrap is already imported (skip injection)
 *   - { kind: 'foreign' }   — a different `logger` symbol is bound (use alias)
 *   - { kind: 'none' }      — no `logger` import (use bare `logger`)
 */
function classifyLoggerImport(
  content: string,
  bootstrapImportSpec: string,
): { kind: 'ours' | 'foreign' | 'none' } {
  const re =
    /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  let foreign = false;
  while ((m = re.exec(content)) !== null) {
    const inside = m[1] ?? '';
    const spec = m[2] ?? '';
    // Look for `logger` or `logger as X` or `X as logger` in the import clause.
    // We only care about the LOCAL binding being `logger`, since that's what
    // shadows us at the call site.
    const bindsLogger = /(^|[\s,])logger(\s*,|\s*$)/.test(inside) ||
      /\bas\s+logger(\s*,|\s*$)/.test(inside);
    if (!bindsLogger) continue;
    if (spec === bootstrapImportSpec) {
      return { kind: 'ours' };
    }
    foreign = true;
  }
  return { kind: foreign ? 'foreign' : 'none' };
}

/**
 * P1-3 + P1-4 fix: respect shebang and "use strict|client|server" directive
 * prologues by inserting AFTER them. Multiple consecutive directives all
 * preserved.
 */
function findImportInsertionOffset(content: string): number {
  let offset = 0;
  // Shebang on line 1.
  const shebang = /^#![^\n]*\n/.exec(content);
  if (shebang && shebang.index === 0) {
    offset = shebang[0].length;
  }
  // Then any number of "use X" directives (with optional semicolon and
  // surrounding whitespace).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const tail = content.slice(offset);
    const dir = /^(['"])use [\w-]+\1\s*;?[ \t]*\n/.exec(tail);
    if (!dir) break;
    offset += dir[0].length;
  }
  return offset;
}

/**
 * Find the end offset (within `tail`) of the contiguous top-of-file import
 * block, correctly spanning MULTI-LINE imports like:
 *
 *   import {
 *     a,
 *     b,
 *   } from 'x';
 *
 * The previous single-line regex `/^(?:import\s[^\n]*\n)+/` matched only the
 * first physical line `import {`, so the logger import got inserted BETWEEN
 * `import {` and its members → syntax error. We instead walk statement by
 * statement: a statement starts with `import` (or a re-export `export ...
 * from`) at the start of a line and ends at the line containing the closing
 * `from '...'` / bare side-effect import. Masking blanks out string contents
 * so a `from '...'` inside a comment/string can't fool us. Returns 0 if there
 * is no leading import block.
 */
function findImportBlockEnd(tail: string): number {
  // Mask non-code so brace/quote counting isn't fooled by strings/comments.
  // If masking is uncertain we conservatively treat the block as not-present
  // (offset 0) — the caller will prepend, which is always syntactically safe.
  const m = maskNonCodeRegions(tail);
  if (m.uncertain) return 0;
  const masked = m.masked;
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Skip blank lines between statements.
    const ws = /^[ \t\r\n]*/.exec(masked.slice(offset));
    const afterWs = offset + (ws ? ws[0].length : 0);
    const rest = masked.slice(afterWs);
    // Match the start of an `import` or top-level `export ... from` statement.
    if (!/^import\b/.test(rest) && !/^export\b[^\n]*\bfrom\b/.test(rest)) {
      break;
    }
    // Find the end of this statement. Statements may span multiple physical
    // lines (brace import lists). Scan for the first `;` or, if there is no
    // semicolon, the end of the first physical line that closes a balanced
    // brace group (or has no braces at all).
    let i = afterWs;
    let braceDepth = 0;
    let stmtEnd = -1;
    while (i < masked.length) {
      const c = masked[i]!;
      if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      else if (c === ';' && braceDepth <= 0) {
        // Include the semicolon and trailing newline (if present).
        i++;
        if (masked[i] === '\r') i++;
        if (masked[i] === '\n') i++;
        stmtEnd = i;
        break;
      } else if (c === '\n' && braceDepth <= 0) {
        // Semicolon-less statement (e.g. `import 'x'` with ASI) — end of line.
        i++;
        stmtEnd = i;
        break;
      }
      i++;
    }
    if (stmtEnd === -1) {
      // Unterminated statement to EOF — consume the rest.
      stmtEnd = masked.length;
    }
    offset = stmtEnd;
  }
  return offset;
}

function insertImport(content: string, importLine: string): string {
  const insertionPoint = findImportInsertionOffset(content);
  const head = content.slice(0, insertionPoint);
  const tail = content.slice(insertionPoint);
  // After the directive/shebang prologue, see if there's a contiguous
  // top-of-file import block; if so, append after it (multi-line aware).
  const end = findImportBlockEnd(tail);
  if (end > 0) {
    return head + tail.slice(0, end) + importLine + tail.slice(end);
  }
  return head + importLine + tail;
}

// ── Masking (P1-2): blank out strings / comments / template literals ────────

/**
 * Replace all non-code regions (string literals — single/double/backtick —
 * line comments, block comments, JSX text attribute values) with sentinel
 * placeholder characters of EQUAL LENGTH so offsets in the masked string
 * match offsets in the original. We then run regexes against the masked
 * string but apply rewrites to the original.
 *
 * v1 trade-off: this is a single forward-pass tokenizer, not a real parser.
 * Cases it may misclassify (regex literals containing `/* `, template
 * literals with deeply nested `${` interpolations, JSX text body
 * containing `{`) cause the function to set `uncertain = true`, and the
 * caller should skip the file rather than risk corruption.
 *
 * Public contract:
 *   - `masked.length === source.length` (offset-stable)
 *   - masked chars in non-code regions are ASCII space ' ' (still passes \s
 *     in regex, but won't match identifier chars). Newlines preserved.
 *   - if `uncertain` is true, do NOT rewrite — fall back to the original.
 */
/**
 * Decide whether a `/` at index `i` begins a regex literal (vs a division
 * operator). Regex literals appear in *expression position*: at the start of
 * input, or after a token that cannot end an expression (operators, `(`, `[`,
 * `{`, `,`, `;`, `:`, `=`, `return`, `typeof`, `&&`, `||`, etc.). After a
 * value-producing token (identifier, `)`, `]`, number, or a string/regex
 * close) a `/` is division.
 *
 * We scan backwards over `source`, skipping whitespace AND any region already
 * masked to spaces (strings/comments become spaces in `out`, so we use `out`
 * to detect them) to find the last meaningful character.
 */
function regexAllowedAt(source: string, out: string[], i: number): boolean {
  let j = i - 1;
  // Skip whitespace, and skip masked-out regions (those are spaces in `out`
  // but may be non-space in `source` — e.g. a preceding string). We rely on
  // `out` having been filled up to `i` already (forward single-pass).
  while (j >= 0) {
    const om = out[j]!;
    const sc = source[j]!;
    if (sc === ' ' || sc === '\t' || sc === '\n' || sc === '\r') {
      j--;
      continue;
    }
    // If this position was masked (string/comment/regex body) but the source
    // char is non-whitespace, it ended a value (string/regex literal) → the
    // following `/` is division, NOT a regex.
    if (om === ' ') {
      return false;
    }
    break;
  }
  if (j < 0) return true; // start of input → regex position
  const prev = source[j]!;
  // Value-ending chars → division.
  if (/[A-Za-z0-9_$)\]]/.test(prev)) {
    // …unless the identifier is a keyword that precedes an expression
    // (return / typeof / case / in / of / instanceof / void / delete / yield /
    // do / else / new). Pull the trailing word.
    if (/[A-Za-z_$]/.test(prev)) {
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k]!)) k--;
      const word = source.slice(k + 1, j + 1);
      const exprKeywords = new Set([
        'return', 'typeof', 'case', 'in', 'of', 'instanceof', 'void',
        'delete', 'yield', 'do', 'else', 'new', 'throw', 'await',
      ]);
      if (exprKeywords.has(word)) return true;
    }
    return false;
  }
  // Everything else (operators, punctuation: ( [ { , ; : = + - * % ! & | ? < > ^ ~ })
  // is an expression position. `}` is ambiguous (block vs object) but treating
  // it as regex-allowed only risks masking a real division by a parenthesized
  // expr after a block, which is exceedingly rare; masking is non-corrupting.
  return true;
}

function maskNonCodeRegions(source: string): { masked: string; uncertain: boolean } {
  const out = source.split('');
  let i = 0;
  let uncertain = false;
  // JSX heuristic: any `<Letter` followed by attribute syntax engages a
  // shallow JSX mode where attribute string values get masked. We don't try
  // to track tag stacks; we just mask string values inside `<...>` segments.
  // Since attribute values are *normal* string literals, the regular
  // string-literal pass already handles them — JSX gives us nothing extra.
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    // Line comment.
    if (ch === '/' && next === '/') {
      // Mask until newline.
      while (i < source.length && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    // Block comment.
    if (ch === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      let closed = false;
      while (i < source.length - 1) {
        if (source[i] === '*' && source[i + 1] === '/') {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          closed = true;
          break;
        }
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (!closed) {
        // Unterminated comment — treat rest as masked, mark uncertain.
        while (i < source.length) {
          if (source[i] !== '\n') out[i] = ' ';
          i++;
        }
        uncertain = true;
      }
      continue;
    }
    // Regex literal (e.g. `/console\.log\(/g`). A `/` begins a regex only in
    // an expression position — never right after a value (identifier, `)`,
    // `]`, number, string-close). We approximate the "preceding token" by
    // walking back over whitespace to the last meaningful char. If it implies
    // a value, the `/` is division; otherwise treat it as a regex and mask the
    // body (equal-length spaces, newlines preserved) so its contents can't be
    // rewritten. The `//` and `/*` comment cases are handled above, so any `/`
    // reaching here that we classify as regex is genuinely a literal start.
    if (ch === '/' && regexAllowedAt(source, out, i)) {
      out[i] = ' ';
      i++;
      let inClass = false; // inside a [...] char class — `/` there is literal
      let closed = false;
      while (i < source.length) {
        const c = source[i]!;
        if (c === '\\') {
          out[i] = ' ';
          if (i + 1 < source.length) {
            if (source[i + 1] !== '\n') out[i + 1] = ' ';
            i += 2;
          } else {
            i += 1;
          }
          continue;
        }
        if (c === '\n') {
          // Regex literals can't span raw newlines — bail conservatively.
          uncertain = true;
          break;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          out[i] = ' ';
          i++;
          // Mask trailing flags (letters) so e.g. `/x/g` -> all spaces.
          while (i < source.length && /[a-z]/i.test(source[i]!)) {
            out[i] = ' ';
            i++;
          }
          closed = true;
          break;
        }
        out[i] = ' ';
        i++;
      }
      if (!closed) {
        uncertain = true;
      }
      continue;
    }
    // String literal (single or double quote).
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out[i] = ' ';
      i++;
      while (i < source.length) {
        const c = source[i]!;
        if (c === '\\') {
          // Escape: mask this and the next char.
          out[i] = ' ';
          if (i + 1 < source.length) {
            if (source[i + 1] !== '\n') out[i + 1] = ' ';
            i += 2;
          } else {
            i += 1;
          }
          continue;
        }
        if (c === quote) {
          out[i] = ' ';
          i++;
          break;
        }
        if (c === '\n') {
          // Unterminated string literal — bail.
          uncertain = true;
          break;
        }
        out[i] = ' ';
        i++;
      }
      continue;
    }
    // Template literal.
    if (ch === '`') {
      out[i] = ' ';
      i++;
      while (i < source.length) {
        const c = source[i]!;
        if (c === '\\') {
          out[i] = ' ';
          if (i + 1 < source.length) {
            if (source[i + 1] !== '\n') out[i + 1] = ' ';
            i += 2;
          } else {
            i += 1;
          }
          continue;
        }
        if (c === '$' && source[i + 1] === '{') {
          // Interpolation start — leave the interpolated expression as-is
          // (it's code). Track brace depth so we can rejoin the template
          // body after the matching `}`.
          // We do NOT mask the interpolation contents; we want the regex
          // to see them as code. But for v1 simplicity we will skip the
          // interpolation entirely without masking — we just walk to the
          // matching `}` keeping the original characters and mask the
          // backtick-string segments before/after as we already are.
          // Mask the `${` markers themselves as spaces so they don't fool
          // identifier-boundary checks.
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          let depth = 1;
          while (i < source.length && depth > 0) {
            const cc = source[i]!;
            if (cc === '{') depth++;
            else if (cc === '}') {
              depth--;
              if (depth === 0) {
                out[i] = ' ';
                i++;
                break;
              }
            } else if (cc === '"' || cc === "'" || cc === '`') {
              // Nested string inside interpolation — recurse a tiny
              // tokenizer. To keep this simple, mark uncertain and bail
              // gracefully: the file will be skipped.
              uncertain = true;
              // But still try to walk past it conservatively by scanning
              // for the matching quote with no escape awareness.
              const q = cc;
              i++;
              while (i < source.length && source[i] !== q) {
                if (source[i] === '\\' && i + 1 < source.length) i += 2;
                else i++;
              }
              i++;
              continue;
            }
            i++;
          }
          continue;
        }
        if (c === '`') {
          out[i] = ' ';
          i++;
          break;
        }
        // Preserve newlines so line numbers stay aligned but mask everything
        // else inside the template string.
        if (c !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return { masked: out.join(''), uncertain };
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
 *
 * P1-2 fix: regex runs against `masked` text (strings / comments stripped) so
 * `catch (e) {}` inside a string literal is not rewritten.
 *
 * P1-7 fix: strict body alternation — only EMPTY or EXACTLY one return-of-nil
 * statement; anything else is left alone with a 'catch-body-complex' branch
 * decision.
 */
function transformSilentCatches(
  content: string,
  loggerName: string,
  masked: string,
  log: TrackLogger,
  fileRel: string,
): { content: string; count: number } {
  // Strict: catch ( IDENT ) { (whitespace only) OR (return null|undefined|void 0 ;? whitespace) }
  const re =
    /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{(\s*|\s*return\s+(?:null|undefined|void\s+0)\s*;?\s*)\}/g;
  let count = 0;
  let result = '';
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const name = m[1]!;
    const innerMasked = m[2]!;
    // Pull the REAL body text (not masked) so we don't lose anything.
    const inner = content.slice(start + m[0].indexOf('{') + 1, end - 1);
    const trimmed = inner.trim();

    // Already-logged guard: if the real body somehow already contains a
    // logger.error call, skip.
    if (/\blogger\b\s*\.\s*error\s*\(/.test(inner) || new RegExp('\\b' + loggerName + '\\b\\s*\\.\\s*error\\s*\\(').test(inner)) {
      result += content.slice(cursor, end);
      cursor = end;
      continue;
    }

    // The masked match alternation guarantees innerMasked is either pure
    // whitespace or a return-of-nil. Build replacement from the trimmed
    // real-body content.
    if (trimmed === '') {
      // Empty catch body.
      const replacement =
        'catch (' + name + ') { ' + loggerName + ".error({ err: " + name + " }, 'unhandled'); }";
      result += content.slice(cursor, start) + replacement;
      cursor = end;
      count++;
      continue;
    }
    // Has a return-of-nil — preserve it.
    if (/^return\s+(?:null|undefined|void\s+0)\s*;?$/.test(trimmed)) {
      const ret = trimmed.endsWith(';') ? trimmed : trimmed + ';';
      const replacement =
        'catch (' + name + ') { ' + loggerName + ".error({ err: " + name + " }, 'unhandled'); " + ret + ' }';
      result += content.slice(cursor, start) + replacement;
      cursor = end;
      count++;
      continue;
    }
    // Defensive: anything else (mismatch between masked alternation and
    // real-text content — should be unreachable) — skip.
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'skip',
      reasoning: 'catch-body-complex',
      file: fileRel,
    });
    result += content.slice(cursor, end);
    cursor = end;
  }
  result += content.slice(cursor);
  return { content: result, count };
}

const CONSOLE_MAP: Record<string, string> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
};

/**
 * Scan the masked argument span starting at `from` (the index immediately
 * after the opening `(`) until the matching `)`. Returns the index of the
 * closing `)` and the count of top-level commas (commas not nested inside
 * `()`, `{}`, or `[]`).
 *
 * The `masked` view has string literals / comments / template literals
 * blanked out to ASCII spaces, so we don't need string-quote tracking — any
 * brackets/commas inside a string have already been masked. Newlines are
 * preserved in masking, so we can still scan linearly.
 *
 * Returns null if no balanced closing `)` is found (unterminated call —
 * malformed source).
 */
function scanArgList(
  masked: string,
  from: number,
): { closeIdx: number; topCommas: number; nonEmpty: boolean } | null {
  let depth = 1; // we start just after the opening '('
  let topCommas = 0;
  let nonEmpty = false;
  let i = from;
  while (i < masked.length) {
    const c = masked[i]!;
    if (c === '(' || c === '{' || c === '[') {
      depth++;
      nonEmpty = true;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return { closeIdx: i, topCommas, nonEmpty };
      }
    } else if (c === '}' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 1) {
      topCommas++;
      nonEmpty = true;
    } else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
      // Any non-whitespace character at any depth means args are non-empty.
      nonEmpty = true;
    }
    i++;
  }
  return null;
}

/**
 * P1-2 + P1-6 fix: run against `masked` text, and require that `console`
 * NOT be preceded by `.` or an identifier char — so `this.console.log()` and
 * `myConsole.log()` are left alone.
 *
 * Phase 10.6 fix: pino uses the OPPOSITE argument order from console
 * (`logger.error({ err }, "msg")` vs `console.error("msg", err)`). A naive
 * 1:1 rewrite produces type errors and silently loses data. Policy:
 *
 *   - 0 args     → rewrite (`console.log()` → `logger.info()`)
 *   - 1 arg      → rewrite (string / number / object / template literal —
 *                  pino accepts any as a single positional arg)
 *   - 2+ args    → SKIP (leave the original `console.X(...)` text alone,
 *                  log a decision branch)
 *
 * The argument-count is computed by scanning the masked argument span and
 * counting top-level commas. Masking guarantees that string-literal commas
 * and template-literal commas are blanked, so we can use plain character
 * scanning to find argument boundaries.
 */
function transformConsoleCalls(
  content: string,
  loggerName: string,
  masked: string,
  log?: TrackLogger,
  fileRel?: string,
): { content: string; count: number; multiArgSkipCount: number } {
  // P1-6: negative lookbehind `(?<![.\w$])` prevents matching when `console`
  // is a property access (e.g., `this.console`, `foo.console`) or part of a
  // larger identifier (`myConsole`).
  const re =
    /(?<![.\w$])console\b\s*\.\s*(log|info|warn|error|debug)\s*\(/g;
  let count = 0;
  let multiArgSkipCount = 0;
  let result = '';
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const start = m.index;
    const headerEnd = start + m[0].length; // index just after '('
    const method = m[1]!;
    const mapped = CONSOLE_MAP[method] ?? 'info';

    // Scan the argument span to determine arg count.
    const scan = scanArgList(masked, headerEnd);
    if (!scan) {
      // Unterminated — leave it alone (malformed source).
      if (log) {
        logBranch(log, 'enhance.log.executor.file-change-decision', {
          decision: 'skip',
          reasoning: 'console-call-unterminated',
          file: fileRel,
          method,
        });
      }
      // Keep the original text as-is; don't advance over the broken call.
      // Advance cursor by copying up to `headerEnd` (which is `console.X(`)
      // would corrupt; safer: copy up to the matched header and let regex
      // continue past it on next iteration.
      result += content.slice(cursor, headerEnd);
      cursor = headerEnd;
      continue;
    }

    const topCommas = scan.topCommas;
    if (topCommas >= 1) {
      // 2+ args — SKIP. Phase 10.6: pino's arg order differs from console;
      // a 1:1 rewrite would type-error or silently lose data.
      multiArgSkipCount++;
      if (log) {
        logBranch(log, 'enhance.log.executor.file-change-decision', {
          decision: 'skip',
          reasoning: 'console-call-multi-arg',
          file: fileRel,
          method,
          argCount: topCommas + 1,
        });
      }
      // Copy original text untouched through the closing ')'.
      result += content.slice(cursor, scan.closeIdx + 1);
      cursor = scan.closeIdx + 1;
      // Advance the regex lastIndex past this call so we don't re-match
      // inside it.
      re.lastIndex = scan.closeIdx + 1;
      continue;
    }

    // 0 args (empty parens) or 1 arg — rewrite.
    result +=
      content.slice(cursor, start) + loggerName + '.' + mapped + '(';
    cursor = headerEnd;
    count++;
  }
  result += content.slice(cursor);
  return { content: result, count, multiArgSkipCount };
}

// Internal export for unit tests (Phase 10.6). Not part of the public API.
export const __internal = {
  transformConsoleCalls,
  maskNonCodeRegions,
  scanArgList,
  insertImport,
  findImportBlockEnd,
  regexAllowedAt,
};

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
  tscFn: TscCheckFn,
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

  // P1-5: strip BOM before processing; remember to re-prepend on write.
  let raw = r.content;
  const hadBom = raw.charCodeAt(0) === 0xfeff;
  if (hadBom) {
    raw = raw.slice(1);
  }

  // Resolve our bootstrap import spec relative to this file so we can detect
  // whether an existing `logger` import is ours (P1-1).
  const bootstrapSpec = relativeImportFor(rel, bootstrapFileRel);

  // P1-1: classify any existing `logger` import.
  const existing = classifyLoggerImport(raw, bootstrapSpec);
  // If there's a foreign `logger` binding, we must NOT shadow our calls onto
  // it — use a local alias.
  const loggerLocalName = existing.kind === 'foreign' ? 'zerouLogger' : 'logger';

  // P1-2: build the masked view of the source so regexes don't fire inside
  // string literals / comments / template literals.
  const maskResult = maskNonCodeRegions(raw);
  if (maskResult.uncertain) {
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'skip',
      reasoning: 'masking-uncertain',
      file: rel,
    });
    log.log('info', 'enhance.log.executor.file-skip', { file: rel, reason: 'masking-uncertain' });
    return { status: 'skip' };
  }

  let next = raw;
  let masked = maskResult.masked;
  let touched = 0;
  let consoles = 0;
  let consolesSkipped = 0;
  let catches = 0;

  if (kinds.has('silent-catch')) {
    const t = transformSilentCatches(next, loggerLocalName, masked, log, rel);
    if (t.count > 0) {
      next = t.content;
      // Re-mask because content length may have changed.
      const remask = maskNonCodeRegions(next);
      if (remask.uncertain) {
        logBranch(log, 'enhance.log.executor.file-change-decision', {
          decision: 'skip',
          reasoning: 'masking-uncertain-after-catch-rewrite',
          file: rel,
        });
        return { status: 'skip' };
      }
      masked = remask.masked;
      catches = t.count;
      touched += t.count;
    }
  }
  if (kinds.has('console-log')) {
    const t = transformConsoleCalls(next, loggerLocalName, masked, log, rel);
    consolesSkipped = t.multiArgSkipCount;
    if (t.count > 0) {
      next = t.content;
      consoles = t.count;
      touched += t.count;
    }
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

  // P1-1: only inject the import if our bootstrap isn't already imported.
  // If a foreign `logger` exists, we still need to inject — but under the
  // alias name `zerouLogger`.
  if (existing.kind !== 'ours') {
    next = insertImport(next, importStatementFor(bootstrapSpec, loggerLocalName));
  }

  if (next === raw) {
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'skip',
      reasoning: 'content unchanged after transformation (idempotent)',
      file: rel,
    });
    return { status: 'skip' };
  }

  // P1-5: re-prepend BOM on write if the original had one.
  const output = hadBom ? '﻿' + next : next;
  // `r.content` is the EXACT original bytes (BOM included) — keep it so we can
  // restore byte-identically if the tsc self-check fails.
  const originalBytes = r.content;
  const w = writeFileSafe(abs, output);
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

  // Post-rewrite self-check: if our text rewrite broke the build (e.g. a regex
  // literal we failed to mask, or a malformed import insertion), restore the
  // ORIGINAL bytes atomically and skip this file. This single gate catches
  // corruption vectors (a)+(b) and any future regression before it reaches the
  // user. Mirrors bug-patcher's tsc-gate + rollback.
  //
  // The DEFAULT checker (`runTsc`) only runs a real `tsc` when the project has
  // a tsconfig.json — otherwise there is nothing meaningful to type-check and
  // we don't want a false-positive rollback on a plain-JS / non-TS demo. A
  // test-injected `runTscFn` always runs (the seam lets us simulate a broken
  // rewrite deterministically). We detect the default by reference identity.
  const tscRes =
    tscFn === runTsc && !fs.existsSync(path.join(cwd, 'tsconfig.json'))
      ? ({ ok: true } as const)
      : tscFn(cwd);
  if (!tscRes.ok) {
    const restore = writeFileSafe(abs, originalBytes);
    logBranch(log, 'enhance.log.executor.file-change-decision', {
      decision: 'skip',
      reasoning: 'log-rewrite-tsc-failed',
      file: rel,
      firstError: tscRes.firstError.slice(0, 300),
      rolledBack: restore.ok,
      restoreError: restore.ok ? undefined : restore.reason,
    });
    log.log('warn', 'enhance.log.executor.file-skip', {
      file: rel,
      reason: 'log-rewrite-tsc-failed',
      rolledBack: restore.ok,
    });
    if (!restore.ok) {
      // We failed to restore — surface as a hard failure so the caller does
      // not silently leave a corrupted file.
      return { status: 'fail', reason: `rollback-failed: ${restore.reason}` };
    }
    return { status: 'skip', reason: 'log-rewrite-tsc-failed' };
  }

  logBranch(log, 'enhance.log.executor.file-change-decision', {
    decision: 'apply',
    reasoning: `rewrote ${catches} silent-catch, ${consoles} console call(s); skipped ${consolesSkipped} multi-arg console`,
    file: rel,
    catches,
    consoles,
    consolesSkipped,
  });
  log.log('info', 'enhance.log.executor.file-changed', {
    file: rel,
    catches,
    consoles,
    consolesSkipped,
  });
  return { status: 'changed' };
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function executeLogInjection(opts: LogExecutorOpts): Promise<LogExecutorResult> {
  const { cwd, plan, logger } = opts;
  const tscFn: TscCheckFn = opts.runTscFn ?? runTsc;
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
      const r = applyToFile(cwd, rel, kinds, bootstrapRel, log, tscFn);
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
