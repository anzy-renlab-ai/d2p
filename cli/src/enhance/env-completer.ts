/**
 * Module F — env-completer.
 *
 * Synchronises `.env.example` with the env vars actually referenced in source.
 *
 * Authority: `docs/plans/2026-05-27-phase-10-enhance.md` Module F.
 *
 * Behaviour:
 *   1. Walk source files under TARGET_DIRS (src/, app/, pages/, lib/, server/)
 *      and grep `process.env.NAME` references.
 *   2. Add framework-standard vars when a corresponding dep is detected
 *      (Prisma/Drizzle → DATABASE_URL).
 *   3. Parse `.env.example` (if it exists) into the declared set.
 *   4. Compute diff:
 *        - missing       = used \ declared    → APPENDED with comment block
 *        - unusedRemoved = declared \ used    → REPORTED only (never removed)
 *   5. Create `.env.example` if it doesn't exist and missing is non-empty.
 *
 * Logging prefix: `enhance.env.*`.
 *
 * All paths returned are POSIX-relative to `opts.cwd`.
 */
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import path from 'node:path';
import type { TrackLogger } from '../log-types.js';
import type { EnvCompleteResult } from './types.js';
import { logBranch } from '../log/branch.js';

const TARGET_DIRS = ['src', 'app', 'pages', 'lib', 'server'];

// `process.env.NAME` or `process.env["NAME"]` / `process.env['NAME']`.
const PROCESS_ENV_RE =
  /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g;

const DECL_LINE_RE = /^([A-Z_][A-Z0-9_]*)\s*=/;

// Built-in/auto-injected vars that should NOT be reported either as missing
// (callers can't set them in .env) or as unused.
const IGNORE_VARS = new Set<string>([
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NEXT_RUNTIME',
  'NEXT_PHASE',
  'npm_package_version',
  'npm_package_name',
  'PORT', // often set by host
  'HOME',
  'PATH',
  'PWD',
  'CI',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
]);

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function walkInto(
  abs: string,
  acc: string[],
  depth: number,
): Promise<void> {
  if (depth > 8) return;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    if (ent.name === 'dist' || ent.name === 'build' || ent.name === '.next') continue;
    if (ent.name.startsWith('.')) continue;
    const sub = path.join(abs, ent.name);
    if (ent.isDirectory()) {
      await walkInto(sub, acc, depth + 1);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(ent.name)) continue;
    acc.push(sub);
  }
}

async function collectSourceFiles(cwd: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of TARGET_DIRS) {
    const abs = path.join(cwd, dir);
    if (!(await exists(abs))) continue;
    await walkInto(abs, out, 0);
  }
  return out;
}

async function collectUsedVars(cwd: string): Promise<Set<string>> {
  const files = await collectSourceFiles(cwd);
  const used = new Set<string>();
  for (const abs of files) {
    let text: string;
    try {
      text = await fsp.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    // Re-instantiate iterator each loop because /g state is per-RegExp.
    const re = new RegExp(PROCESS_ENV_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      if (IGNORE_VARS.has(name)) continue;
      used.add(name);
    }
  }
  return used;
}

async function detectFrameworkExtras(cwd: string): Promise<string[]> {
  const extras: string[] = [];
  let pkg: Record<string, unknown> | null = null;
  try {
    const raw = await fsp.readFile(path.join(cwd, 'package.json'), 'utf8');
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return extras;
  }
  const allDeps: Record<string, string> = {};
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const v = pkg[k];
    if (v && typeof v === 'object') {
      Object.assign(allDeps, v as Record<string, string>);
    }
  }
  if (
    '@prisma/client' in allDeps ||
    'prisma' in allDeps ||
    'drizzle-orm' in allDeps ||
    'drizzle-kit' in allDeps
  ) {
    extras.push('DATABASE_URL');
  }
  return extras;
}

interface ParsedEnvExample {
  declared: Set<string>;
  raw: string;
  exists: boolean;
}

async function readEnvExample(cwd: string): Promise<ParsedEnvExample> {
  const abs = path.join(cwd, '.env.example');
  let raw: string;
  try {
    raw = await fsp.readFile(abs, 'utf8');
  } catch {
    return { declared: new Set(), raw: '', exists: false };
  }
  const declared = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    // Skip comments.
    const trimmed = line.replace(/^\s+/, '');
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const m = DECL_LINE_RE.exec(trimmed);
    if (m && m[1]) declared.add(m[1]);
  }
  return { declared, raw, exists: true };
}

function buildAppendBlock(missing: string[]): string {
  const lines: string[] = [
    '',
    '# Added by ZeroU enhance — verify these values before deploying',
  ];
  for (const k of missing) {
    lines.push(`${k}=`);
  }
  lines.push(''); // trailing newline
  return lines.join('\n');
}

export async function completeEnvExample(opts: {
  cwd: string;
  logger: TrackLogger;
}): Promise<EnvCompleteResult> {
  const { cwd, logger } = opts;

  const usedSet = await collectUsedVars(cwd);
  const extras = await detectFrameworkExtras(cwd);
  for (const e of extras) usedSet.add(e);

  const used = Array.from(usedSet).sort();
  const parsed = await readEnvExample(cwd);

  const missing = used.filter((v) => !parsed.declared.has(v));
  const existed = used.filter((v) => parsed.declared.has(v));
  const unusedRemoved = Array.from(parsed.declared)
    .filter((v) => !usedSet.has(v) && !IGNORE_VARS.has(v))
    .sort();

  logBranch(logger, 'enhance.env.scan.summary', {
    decision: 'scanned',
    reasoning: `found ${used.length} used vars, ${parsed.declared.size} declared`,
    count: used.length,
    missingCount: missing.length,
    unusedCount: unusedRemoved.length,
  });

  if (missing.length === 0) {
    logBranch(logger, 'enhance.env.write.skip', {
      decision: 'no-changes',
      reasoning: '.env.example already covers all used vars',
      count: 0,
    });
    return { added: [], existed, unusedRemoved };
  }

  const abs = path.join(cwd, '.env.example');
  if (parsed.exists) {
    // Append (ensuring trailing newline before block).
    let body = parsed.raw;
    if (body.length > 0 && !body.endsWith('\n')) body += '\n';
    body += buildAppendBlock(missing);
    await fsp.writeFile(abs, body, 'utf8');
    logBranch(
      logger,
      'enhance.env.write.append',
      {
        decision: 'appended',
        reasoning: `${missing.length} missing vars appended to .env.example`,
        count: missing.length,
        file: toPosix(path.relative(cwd, abs)),
      },
      { level: 'info' },
    );
  } else {
    // Create with header.
    const header =
      '# .env.example — generated by ZeroU enhance\n' +
      '# Copy to .env and fill in real values before deploying.\n';
    const body = header + buildAppendBlock(missing);
    await fsp.writeFile(abs, body, 'utf8');
    logBranch(
      logger,
      'enhance.env.write.create',
      {
        decision: 'created',
        reasoning: `created .env.example with ${missing.length} vars`,
        count: missing.length,
        file: toPosix(path.relative(cwd, abs)),
      },
      { level: 'info' },
    );
  }

  return { added: missing, existed, unusedRemoved };
}
