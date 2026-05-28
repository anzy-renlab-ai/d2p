/**
 * Test Case Generator (Phase 5 / Track E).
 *
 * Reads source files in a demo project, extracts endpoints + functions via
 * heuristics, then asks an LLM (or falls back to deterministic specs) to
 * generate test specs (happy path, edge cases, security, error handling).
 *
 * Surface authority:
 *   `docs/plans/2026-05-26-phase-5-test-case-agent.md`
 *   §"agent/test-case-generator.ts".
 *
 * Decision-branch log taxonomy:
 *   `agent.test-gen.*` per phase-5 plan §"Decision-Branch Log Taxonomy".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TrackLogger } from '../log-types.js';
import type { EngineConfig } from '../stubs.js';
import { logBranch, logCatch } from '../log/branch.js';
import type {
  ProjectProfile,
  TestCaseSpec,
  TestCaseCategory,
  TestCaseScope,
} from './types.js';
import { fetchLlm } from './llm-fetch.js';
import { runConcurrent } from './concurrency.js';
import type { AuthShape } from './auth-detector.js';
import { shouldScanDir, shouldScanFile } from './scope-filter.js';

const DEFAULT_CONCURRENCY = 5;

// ── Public types ────────────────────────────────────────────────────────────

export interface TestGenOptions {
  cwd: string;
  profile: ProjectProfile;
  logger: TrackLogger;
  criticConfig: EngineConfig | null;
  criticApiKey: string | null;
  /** Max test cases per endpoint/function (default 5). */
  maxCasesPerTarget?: number;
  /** Test seam: override the LLM call used for spec generation. */
  llmCall?: TestGenLlmFn;
  /** Per-call timeout for the LLM. Default 30s. */
  timeoutMs?: number;
  /** Test seam: override target extraction (rarely needed). */
  extractTargetsFn?: (cwd: string) => ExtractedTarget[];
  /** Max number of source files to scan (default 100). */
  maxFiles?: number;
  /**
   * Max concurrent in-flight per-target LLM calls. Default 5 (Phase 11.1).
   * Tests should pass `concurrency: 1` for deterministic ordering.
   */
  concurrency?: number;
  /** Optional AbortSignal to short-circuit pending targets. */
  signal?: AbortSignal;
  /**
   * Phase 11.3: project auth shape. When set, the spec-generation prompt
   * mentions the auth helper so specs use the correct given posture
   * ("authenticated user" / "anonymous request") instead of writing
   * happy-path specs that ignore the 401 wall.
   */
  authShape?: AuthShape;
}

/** A program point that warrants test specs. */
export interface ExtractedTarget {
  /** Stable id, prefix used for spec ids. e.g. 'post-api-login' / 'fn-hashPassword'. */
  id: string;
  /** Source file path, relative to cwd. */
  file: string;
  /** 1-based line number where target was found. */
  line: number;
  /** What kind of target this is. */
  type: 'endpoint' | 'function';
  /**
   * Human-readable target descriptor used in TestCaseScope.target.
   * - endpoint: 'POST /api/login'
   * - function: 'fn:hashPassword'
   */
  name: string;
  /** First ~120 chars of the matched source line(s). */
  signaturePreview: string;
  /** ±N line context snippet (with line numbers) used for LLM prompt. */
  contextSnippet: string;
}

export type TestGenLlmCallResult =
  | { ok: true; raw: string; parsed: unknown[] }
  | { ok: false; error: string; raw: string };

export type TestGenLlmFn = (params: {
  cfg: EngineConfig;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}) => Promise<TestGenLlmCallResult>;

// ── Source-file scanning ────────────────────────────────────────────────────

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

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Phase-17 note: dir/file gating now flows through `scope-filter.ts`. This
 * walker is for AST target extraction (not finding-emitting), so we always
 * use scope='app' here — third-party / vendored / minified code can't host
 * "the user's handlers" by definition.
 *
 * We additionally skip `__tests__`, `tests`, `test/` and existing
 * `.test.ts` / `.spec.ts` files because the generator should not emit
 * specs for test files. Those are kept local since scope-filter is a
 * scope concept, not a "skip test files" concept.
 */
const EXTRA_TEST_DIR_SKIP = new Set(['__tests__', 'tests', 'test']);

interface ScannedFile {
  rel: string;            // relative to cwd, posix-style for stable ids
  abs: string;
  content: string;
}

function walkSources(cwd: string, maxFiles: number): ScannedFile[] {
  const out: ScannedFile[] = [];
  // BFS through configured target dirs first, then root .ts/.js files.
  const roots: string[] = [];
  for (const d of TARGET_DIRS) {
    const p = path.join(cwd, d);
    try {
      if (fs.statSync(p).isDirectory()) roots.push(p);
    } catch {
      // ignore missing
    }
  }
  // Also scan cwd itself shallow.
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
        if (!shouldScanDir(ent.name, 'app')) continue;
        if (EXTRA_TEST_DIR_SKIP.has(ent.name)) continue;
        if (ent.name.startsWith('.')) continue;
        queue.push(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        // Skip .test.ts / .spec.ts
        if (/\.(test|spec)\.[mc]?[tj]sx?$/.test(ent.name)) continue;
        const rel = path.relative(cwd, full).split(path.sep).join('/');
        const fileDecision = shouldScanFile({ scope: 'app', cwd, relPath: rel });
        if (!fileDecision.scan) continue;
        let content: string;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        // Skip very large files (>200KB)
        if (content.length > 200_000) continue;
        out.push({ rel, abs: full, content });
      }
    }
  }
  return out;
}

// ── Pattern extraction ──────────────────────────────────────────────────────

/** Express/Koa-style: `app.get('/path', ...)` or `router.post(...)`. */
const EXPRESS_RE =
  /\b(?:app|router|app[A-Z]\w*|router[A-Z]\w*)\s*\.\s*(get|post|put|delete|patch|all)\s*\(\s*(['"`])([^'"`]+)\2/g;

/** Next.js App Router: `export async function GET(...)` etc. in `route.ts`. */
const NEXT_APP_RE =
  /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(/g;

/** Generic exported function. */
const FUNCTION_RE =
  /export\s+(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g;

/** Next.js Pages API default export (function form). */
const NEXT_PAGES_DEFAULT_RE =
  /export\s+default\s+(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)?\s*\(/g;

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function snippetAround(content: string, lineNum: number, before = 5, after = 30): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, lineNum - 1 - before);
  const end = Math.min(lines.length, lineNum - 1 + after + 1);
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    out.push(`${String(i + 1).padStart(4, ' ')}  ${lines[i]}`);
  }
  return out.join('\n');
}

function previewLine(content: string, lineNum: number): string {
  const lines = content.split(/\r?\n/);
  return (lines[lineNum - 1] ?? '').trim().slice(0, 120);
}

/** Slugify a path or name into a kebab-case id fragment. */
function slug(raw: string): string {
  return raw
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'root';
}

function isInTargetDir(rel: string): boolean {
  // Allow anything under the configured TARGET_DIRS, OR directly at cwd root.
  const head = rel.split('/')[0] ?? '';
  if (TARGET_DIRS.includes(head)) return true;
  // Root-level files (no dir prefix) — only allow for explicit endpoint patterns.
  // For functions in random root files we generally want to skip, but allow
  // small projects with all code at root.
  return !rel.includes('/');
}

/**
 * Targets allowed for FUNCTION_RE extraction. We tighten this to known handler
 * dirs to avoid pulling every utility export as a "target". Files under
 * handlers/, controllers/, api/, routes/, router/, routers/ get function specs.
 */
const FUNCTION_TARGET_DIRS = new Set([
  'handlers',
  'controllers',
  'api',
  'routes',
  'router',
  'routers',
]);

function isFunctionExtractEligible(rel: string): boolean {
  const parts = rel.split('/');
  for (const part of parts) {
    if (FUNCTION_TARGET_DIRS.has(part)) return true;
  }
  return false;
}

/**
 * Derive the route path from a Next.js App Router file path.
 *   app/api/login/route.ts        → /api/login
 *   app/api/[id]/route.ts          → /api/[id]
 *   app/(group)/users/route.ts     → /users     (group folders dropped)
 *   pages/api/login.ts             → /api/login
 *   pages/api/users/[id].ts        → /api/users/[id]
 */
function deriveRouteFromPath(rel: string): string | null {
  const parts = rel.split('/');
  const baseIdx = parts.indexOf('app') !== -1 ? parts.indexOf('app') : parts.indexOf('pages');
  if (baseIdx === -1) return null;
  const baseSeg = parts[baseIdx];
  const rest = parts.slice(baseIdx + 1);
  if (rest.length === 0) return null;

  // App router: must end in route.{ts,js,...}
  if (baseSeg === 'app') {
    const last = rest[rest.length - 1];
    if (!last || !/^route\.[mc]?[tj]sx?$/.test(last)) return null;
    const segs = rest.slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
    return '/' + segs.join('/');
  }
  // Pages router: drop the extension from the last segment.
  if (baseSeg === 'pages') {
    const last = rest[rest.length - 1];
    if (!last) return null;
    const noExt = last.replace(/\.[mc]?[tj]sx?$/, '');
    const segs = [...rest.slice(0, -1), noExt];
    return '/' + segs.join('/');
  }
  return null;
}

/**
 * Infer an endpoint route path from a handler file path. Used when an
 * HTTP-verb-named exported function (e.g. `export async function POST`) is
 * found in a function-eligible dir but NOT in the canonical Next.js
 * `app/.../route.ts` layout. Examples:
 *   src/api/login.ts          → /api/login
 *   src/api/users/[id].ts      → /api/users/[id]
 *   routes/health.ts           → /routes/health
 *   handlers/login.ts          → /handlers/login
 *   src/api/users/index.ts     → /api/users
 */
function inferRouteFromHandlerPath(rel: string): string {
  const parts = rel.split('/');
  // Strip the leading 'src' wrapper if present.
  if (parts[0] === 'src') parts.shift();
  if (parts.length === 0) return '/';
  const last = parts[parts.length - 1] ?? '';
  const baseNoExt = last.replace(/\.[mc]?[tj]sx?$/, '');
  if (baseNoExt === 'index') {
    parts.pop();
  } else {
    parts[parts.length - 1] = baseNoExt;
  }
  return '/' + parts.join('/');
}

export function extractTargetsFromFile(file: ScannedFile): ExtractedTarget[] {
  const out: ExtractedTarget[] = [];
  const seenIds = new Set<string>();

  const addUnique = (t: ExtractedTarget): void => {
    let id = t.id;
    let counter = 1;
    while (seenIds.has(id)) {
      counter++;
      id = `${t.id}-${counter}`;
    }
    seenIds.add(id);
    out.push({ ...t, id });
  };

  // ── Express / Koa style routes ─────────────────────────────────────────
  EXPRESS_RE.lastIndex = 0;
  for (;;) {
    const m = EXPRESS_RE.exec(file.content);
    if (!m) break;
    const verbRaw = m[1];
    const route = m[3];
    if (!verbRaw || !route) continue;
    const verb = verbRaw.toUpperCase();
    const line = lineOf(file.content, m.index);
    const id = `${verb.toLowerCase()}-${slug(route)}`;
    addUnique({
      id,
      file: file.rel,
      line,
      type: 'endpoint',
      name: `${verb} ${route}`,
      signaturePreview: previewLine(file.content, line),
      contextSnippet: snippetAround(file.content, line),
    });
  }

  // ── Next.js App Router endpoints ────────────────────────────────────────
  const appRoute = deriveRouteFromPath(file.rel);
  if (appRoute !== null) {
    NEXT_APP_RE.lastIndex = 0;
    for (;;) {
      const m = NEXT_APP_RE.exec(file.content);
      if (!m) break;
      const verbRaw = m[1];
      if (!verbRaw) continue;
      const verb = verbRaw.toUpperCase();
      const line = lineOf(file.content, m.index);
      const id = `${verb.toLowerCase()}-${slug(appRoute)}`;
      addUnique({
        id,
        file: file.rel,
        line,
        type: 'endpoint',
        name: `${verb} ${appRoute}`,
        signaturePreview: previewLine(file.content, line),
        contextSnippet: snippetAround(file.content, line),
      });
    }

    // Pages router default export → single endpoint, verb inferred as ANY.
    if (file.rel.split('/')[0] === 'pages') {
      NEXT_PAGES_DEFAULT_RE.lastIndex = 0;
      const m = NEXT_PAGES_DEFAULT_RE.exec(file.content);
      if (m) {
        const line = lineOf(file.content, m.index);
        const id = `any-${slug(appRoute)}`;
        addUnique({
          id,
          file: file.rel,
          line,
          type: 'endpoint',
          name: `ANY ${appRoute}`,
          signaturePreview: previewLine(file.content, line),
          contextSnippet: snippetAround(file.content, line),
        });
      }
    }
  }

  // ── Plain exported functions (handlers/controllers/api/routes only) ────
  if (isFunctionExtractEligible(file.rel)) {
    FUNCTION_RE.lastIndex = 0;
    for (;;) {
      const m = FUNCTION_RE.exec(file.content);
      if (!m) break;
      const fnName = m[1];
      if (!fnName) continue;
      const line = lineOf(file.content, m.index);
      // HTTP-method-named exports: if NEXT_APP_RE already produced a route
      // entry for this file (appRoute !== null) we skip — already captured.
      // Otherwise infer route from file path (drop ext + trailing /index) so
      // generic Next.js-style handlers placed in api/, routes/, handlers/
      // outside the canonical app/.../route.ts layout still get caught.
      if (/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)$/.test(fnName)) {
        if (appRoute !== null) continue;
        const inferredRoute = inferRouteFromHandlerPath(file.rel);
        const verb = fnName.toUpperCase();
        const id = `${verb.toLowerCase()}-${slug(inferredRoute)}`;
        addUnique({
          id,
          file: file.rel,
          line,
          type: 'endpoint',
          name: `${verb} ${inferredRoute}`,
          signaturePreview: previewLine(file.content, line),
          contextSnippet: snippetAround(file.content, line),
        });
        continue;
      }
      const id = `fn-${slug(fnName)}`;
      addUnique({
        id,
        file: file.rel,
        line,
        type: 'function',
        name: `fn:${fnName}`,
        signaturePreview: previewLine(file.content, line),
        contextSnippet: snippetAround(file.content, line),
      });
    }
  }

  return out;
}

export function extractAllTargets(cwd: string, maxFiles = 100): ExtractedTarget[] {
  const files = walkSources(cwd, maxFiles);
  const all: ExtractedTarget[] = [];
  const seenGlobal = new Set<string>();
  for (const f of files) {
    if (!isInTargetDir(f.rel) && !isFunctionExtractEligible(f.rel)) {
      // Still allow next.js routes which live in app/ or pages/ (already in TARGET_DIRS).
      // Skip random root files for functions, but endpoint extraction can match anywhere
      // in TARGET_DIRS — and TARGET_DIRS is checked above.
      continue;
    }
    const per = extractTargetsFromFile(f);
    for (const t of per) {
      // Global de-duplication across files based on id.
      let id = t.id;
      let counter = 1;
      while (seenGlobal.has(id)) {
        counter++;
        id = `${t.id}-${counter}`;
      }
      seenGlobal.add(id);
      all.push({ ...t, id });
    }
  }
  return all;
}

// ── LLM spec generation ─────────────────────────────────────────────────────

// Phase 9 Lite-2 — adversarial generator (red-team).
//
// Goal: prevent the generator from confirming what the code already does (the
// "self-consistency" failure mode where a helpful generator writes specs that
// the same model is happy to mark pass).
//
// Mindset shift: instead of "write tests that exercise this code", we say
// "imagine this code is shipping to production and FIND every way it breaks.
// For each failure mode you find, write a spec that exposes it."
//
// We force coverage of named attack-surface categories so the model can't
// produce 5 happy-path variants and call it done.
const SPEC_SYSTEM_PROMPT =
  'You are a RED-TEAM auditor reviewing code that is about to ship to production. ' +
  'Your job is NOT to confirm the code works — assume it has bugs and find them. ' +
  'For every failure mode you identify, write one test spec that would expose it. ' +
  'Bias toward attacks, edge inputs, race conditions, missing validation, and ' +
  'unhandled errors. Treat the source as written by an inexperienced developer; ' +
  'do not give it the benefit of the doubt. ' +
  'Output JSON ONLY — no markdown fence, no preamble, no commentary. ' +
  'Return a JSON array of test spec objects matching the schema exactly. ' +
  'Be specific and concrete. Prefer "User logs in with SQL-injected email and gains admin access" over "Test login fails".';

const SPEC_SCHEMA_DOC = `[
  {
    "name": string,          // human-readable, 5-10 words
    "category": "happy-path" | "edge-case" | "security" | "error-handling" | "auth" | "validation",
    "given": string,         // preconditions
    "when": string,          // the action being tested
    "then": string,          // expected outcome
    "reasoning": string      // why this matters (1-2 sentences)
  }
]`;

function buildSpecPrompt(target: ExtractedTarget, maxCases: number, authShape?: AuthShape): string {
  const authBlock: string[] = [];
  if (authShape && authShape.kind !== 'none') {
    const fnName = authShape.helperFunctionName ?? 'auth helper';
    authBlock.push(
      ``,
      `AUTH CONTEXT: this project uses ${authShape.kind} (${fnName}` +
        (authShape.helperImport ? ` from ${authShape.helperImport}` : '') + `).`,
      `Protected endpoints return 401 BEFORE business logic when unauthenticated.`,
      `When writing specs, choose the right user state in \`given\`:`,
      ` - happy path / business logic → \`given\` MUST mention "authenticated user with ..." (test will mock auth)`,
      ` - auth boundary → \`given\` says "anonymous request" or "unauthorized role"`,
      ` - Anonymous calls to protected endpoints → \`then\` MUST be "returns 401" not the business outcome.`,
      ` - IDOR / cross-tenant → \`given\` MUST mention "authenticated user A" + "data owned by user B".`,
    );
  }
  return [
    `Target under attack:`,
    `- File: ${target.file}:${target.line}`,
    `- Type: ${target.type}`,
    `- Target: ${target.name}`,
    `- Signature: ${target.signaturePreview}`,
    ``,
    `Source code (with line numbers, ±30 lines context):`,
    `\`\`\``,
    target.contextSnippet,
    `\`\`\``,
    ``,
    `Walk through the following attack-surface checklist. For EACH applicable item,`,
    `write one spec that would fail if the bug is present:`,
    ``,
    `  1. Input boundary — empty / oversized / wrong type / unicode / null bytes`,
    `  2. Validation gaps — malformed email / SQL-meta chars / path traversal / XSS`,
    `  3. Auth bypass — missing session check / privilege escalation / IDOR`,
    `  4. Data exposure — secrets in response / PII leak / verbose errors`,
    `  5. Storage hygiene — plaintext password / unhashed token / unencrypted PII`,
    `  6. Error handling — unhandled rejection / leaked stack trace / wrong status code`,
    `  7. Concurrency — double-spend / TOCTOU / race in counter / duplicate writes`,
    `  8. Resource — unbounded loop / unclosed handle / missing timeout`,
    `  9. Trust boundary — unvalidated external input flows into sink (db/exec/eval)`,
    ` 10. Happy path — at least ONE positive test that the intended flow succeeds`,
    ``,
    `Skip items that genuinely don't apply (e.g., storage hygiene for a stateless`,
    `pure function). DO NOT skip an item just because the code "looks fine" — the`,
    `code is presumed buggy until proven otherwise.`,
    ``,
    `Cap at ${maxCases} specs total. Pick the ${maxCases} highest-severity attack`,
    `surfaces for this target. Each spec MUST describe a concrete, executable`,
    `scenario — not a generic "validates input correctly".`,
    ``,
    ...authBlock,
    ``,
    `Return strict JSON array matching this schema:`,
    SPEC_SCHEMA_DOC,
  ].join('\n');
}

/** Default LLM call — OpenAI-Chat-Completions compatible, returns parsed array. */
export const defaultTestGenLlm: TestGenLlmFn = async (params) => {
  if (!params.cfg.baseUrl) {
    return { ok: false, error: 'no baseUrl on engine config', raw: '' };
  }
  const url = params.cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const out = await fetchLlm({
    url,
    apiKey: params.apiKey,
    model: params.cfg.modelId,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    timeoutMs: params.timeoutMs,
    branchPrefix: 'agent.test-gen.llm-fetch',
  });
  if (!out.ok) {
    return { ok: false, error: out.error, raw: '' };
  }
  const content = out.rawText;
  let cleaned = content;
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  // If still not array-shaped, find the outermost [...] block
  if (!cleaned.startsWith('[')) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) cleaned = m[0];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: 'inner content not JSON', raw: content };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'parsed content not an array', raw: content };
  }
  return { ok: true, raw: content, parsed };
};

const VALID_CATEGORIES: ReadonlySet<TestCaseCategory> = new Set<TestCaseCategory>([
  'happy-path',
  'edge-case',
  'security',
  'error-handling',
  'auth',
  'validation',
]);

function normalizeSpec(
  raw: unknown,
  target: ExtractedTarget,
  index: number,
): TestCaseSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name.trim() : '';
  const cat = typeof rec.category === 'string' ? rec.category : '';
  const given = typeof rec.given === 'string' ? rec.given : '';
  const when = typeof rec.when === 'string' ? rec.when : '';
  const then = typeof rec.then === 'string' ? rec.then : '';
  const reasoning = typeof rec.reasoning === 'string' ? rec.reasoning : '';
  if (!name || !VALID_CATEGORIES.has(cat as TestCaseCategory)) return null;
  if (!given || !when || !then) return null;
  const scope: TestCaseScope = {
    type: target.type,
    target: target.name,
    file: target.file,
    line: target.line,
  };
  return {
    id: `${target.id}-${index + 1}`,
    name: name.slice(0, 120),
    category: cat as TestCaseCategory,
    scope,
    given: given.slice(0, 500),
    when: when.slice(0, 500),
    then: then.slice(0, 500),
    reasoning: reasoning.slice(0, 500),
  };
}

/** Deterministic fallback spec — one happy-path per target when LLM unavailable. */
function fallbackSpec(target: ExtractedTarget): TestCaseSpec {
  const scope: TestCaseScope = {
    type: target.type,
    target: target.name,
    file: target.file,
    line: target.line,
  };
  return {
    id: `${target.id}-1`,
    name: `${target.name} basic invocation`,
    category: 'happy-path',
    scope,
    given: 'a valid request shaped per the signature',
    when: `the target ${target.name} is invoked`,
    then: 'it returns a successful response without throwing',
    reasoning:
      'Fallback happy-path spec generated without LLM. Replaces a fuller LLM-generated suite when no critic engine is configured.',
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Generate test specs for all extracted targets in a project.
 *
 * Pipeline:
 *   1. Extract targets via heuristics (Express/Koa, Next.js App+Pages router,
 *      exported functions under handler dirs).
 *   2. For each target, call LLM (default OpenAI-compat) to produce up to
 *      `maxCasesPerTarget` specs.
 *   3. If no LLM is configured OR LLM call fails OR no specs validate, emit
 *      a single deterministic happy-path fallback for that target.
 *
 * Emits:
 *   - agent.test-gen.start { profile }
 *   - agent.test-gen.targets-extracted { count, names }
 *   - agent.test-gen.target.start { targetId, name }
 *   - agent.test-gen.target.llm-call.start { targetId, modelId }
 *   - agent.test-gen.target.llm-call.success { targetId, genCount }
 *   - agent.test-gen.target.llm-call.failure { targetId, reason }
 *   - agent.test-gen.target.fallback { targetId, reason }
 *   - agent.test-gen.target.complete { targetId, specCount }
 *   - agent.test-gen.complete { totalSpecs, targetCount }
 */
export async function generateTestCases(opts: TestGenOptions): Promise<TestCaseSpec[]> {
  const { cwd, profile, logger } = opts;
  const log = logger.child('test-gen');
  const maxCases = opts.maxCasesPerTarget ?? 5;
  const maxFiles = opts.maxFiles ?? 100;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  log.log('info', 'agent.test-gen.start', {
    profile: {
      framework: profile.framework,
      backend: profile.backend,
      language: profile.language,
    },
    maxCasesPerTarget: maxCases,
  });

  // Step 1 — extract targets.
  let targets: ExtractedTarget[];
  try {
    targets = (opts.extractTargetsFn ?? ((c) => extractAllTargets(c, maxFiles)))(cwd);
  } catch (e) {
    logCatch(log, 'agent.test-gen.extraction-decision', e, {
      decision: 'extraction-failed',
      reasoning: 'unexpected error walking source tree',
    });
    log.log('info', 'agent.test-gen.complete', { totalSpecs: 0, targetCount: 0 });
    return [];
  }

  log.log('info', 'agent.test-gen.targets-extracted', {
    count: targets.length,
    names: targets.slice(0, 30).map((t) => t.name),
  });

  if (targets.length === 0) {
    logBranch(log, 'agent.test-gen.targets-decision', {
      decision: 'no-targets',
      reasoning: 'no endpoint/function patterns matched in scanned files',
    });
    log.log('info', 'agent.test-gen.complete', { totalSpecs: 0, targetCount: 0 });
    return [];
  }

  // Step 2 — for each target, generate specs (parallel, bounded by concurrency).
  const llmFn = opts.llmCall ?? defaultTestGenLlm;
  const haveLlm = Boolean(opts.criticConfig && opts.criticApiKey);
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  const targetTask = (target: ExtractedTarget): (() => Promise<TestCaseSpec[]>) =>
    async () => {
      log.log('info', 'agent.test-gen.target.start', {
        targetId: target.id,
        name: target.name,
        file: target.file,
        line: target.line,
        type: target.type,
      });

      let perTargetSpecs: TestCaseSpec[] = [];

      if (haveLlm) {
        log.log('info', 'agent.test-gen.target.llm-call.start', {
          targetId: target.id,
          modelId: opts.criticConfig!.modelId,
        });
        let result: TestGenLlmCallResult;
        try {
          result = await llmFn({
            cfg: opts.criticConfig!,
            apiKey: opts.criticApiKey!,
            systemPrompt: SPEC_SYSTEM_PROMPT,
            userPrompt: buildSpecPrompt(target, maxCases, opts.authShape),
            timeoutMs,
          });
        } catch (e) {
          result = { ok: false, error: (e as Error).message ?? String(e), raw: '' };
        }

        if (result.ok) {
          const limited = result.parsed.slice(0, maxCases);
          for (let i = 0; i < limited.length; i++) {
            const spec = normalizeSpec(limited[i], target, i);
            if (spec) perTargetSpecs.push(spec);
          }
          log.log('info', 'agent.test-gen.target.llm-call.success', {
            targetId: target.id,
            rawCount: result.parsed.length,
            genCount: perTargetSpecs.length,
          });
          if (perTargetSpecs.length === 0) {
            // LLM ok but nothing validated — fall back.
            logBranch(log, 'agent.test-gen.target.validation-decision', {
              decision: 'all-rejected',
              reasoning:
                'LLM returned array but no items matched required schema; fall back to deterministic spec',
              targetId: target.id,
            });
            perTargetSpecs = [fallbackSpec(target)];
            log.log('info', 'agent.test-gen.target.fallback', {
              targetId: target.id,
              reason: 'llm-output-invalid',
            });
          }
        } else {
          log.log('warn', 'agent.test-gen.target.llm-call.failure', {
            targetId: target.id,
            reason: result.error,
          });
          perTargetSpecs = [fallbackSpec(target)];
          log.log('info', 'agent.test-gen.target.fallback', {
            targetId: target.id,
            reason: 'llm-call-failed',
          });
        }
      } else {
        // No LLM configured — deterministic fallback.
        perTargetSpecs = [fallbackSpec(target)];
        log.log('info', 'agent.test-gen.target.fallback', {
          targetId: target.id,
          reason: 'no-llm-key',
        });
      }

      log.log('info', 'agent.test-gen.target.complete', {
        targetId: target.id,
        specCount: perTargetSpecs.length,
      });
      return perTargetSpecs;
    };

  const tasks = targets.map((t) => targetTask(t));
  const settled = await runConcurrent(tasks, {
    maxInFlight: concurrency,
    logger: log,
    branchPrefix: 'agent.test-gen.batch',
    signal: opts.signal,
  });

  const out: TestCaseSpec[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]!;
    if (r.ok && r.value) {
      out.push(...r.value);
    } else {
      // Aborted; emit deterministic fallback so target isn't lost silently.
      const target = targets[i]!;
      out.push(fallbackSpec(target));
      log.log('warn', 'agent.test-gen.target.fallback', {
        targetId: target.id,
        reason: 'aborted',
      });
    }
  }

  log.log('info', 'agent.test-gen.complete', {
    totalSpecs: out.length,
    targetCount: targets.length,
    concurrency,
  });
  return out;
}
