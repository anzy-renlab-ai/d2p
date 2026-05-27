/**
 * Module D — health-gen.
 *
 * Adds a `/health` HTTP endpoint to a project if one does not exist.
 *
 * Authority: `docs/plans/2026-05-27-phase-10-enhance.md` Module D.
 *
 * Behaviour:
 *   1. Detect existing health endpoint via filesystem scan / route grep.
 *      If found → return `{ added: null, reason: 'already-exists' }`.
 *   2. Generate a framework-appropriate route file when supported
 *      (Next.js App Router → `app/health/route.ts`;
 *       Express          → `src/routes/health.ts` + `.zerou-todo.md`).
 *   3. Unsupported frameworks → return `{ added: null, reason: 'framework-unsupported' }`.
 *
 * Logging prefix: `enhance.health.*`.
 *
 * All returned paths are POSIX-relative to `opts.cwd`.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkOpts, HealthGenResult } from './types.js';
import { logBranch } from '../log/branch.js';

const NEXT_HEALTH_CANDIDATES = [
  'app/health/route.ts',
  'app/health/route.js',
  'app/health/route.mjs',
  'app/healthz/route.ts',
  'app/healthz/route.js',
  'app/healthz/route.mjs',
  'app/api/health/route.ts',
  'app/api/health/route.js',
  'app/api/health/route.mjs',
  'app/api/healthz/route.ts',
  'app/api/healthz/route.js',
  'app/api/healthz/route.mjs',
];

// Source roots scanned for express-style route definitions.
const ROUTE_SCAN_DIRS = ['src', 'app', 'server', 'routes', 'lib', 'api'];

// Match e.g. router.get('/health'   |  app.get("/healthz"
const EXPRESS_ROUTE_RE =
  /\b(?:app|router|route)\s*\.\s*(?:get|post|put|all|use)\s*\(\s*['"`]\/(health(?:z)?)\b/;

const NEXT_HEALTH_TEMPLATE = `export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = {
    db: 'unknown',
    version: process.env.npm_package_version ?? 'unknown',
    uptime: process.uptime(),
  };
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks,
  });
}
`;

const EXPRESS_HEALTH_TEMPLATE = `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
`;

const EXPRESS_TODO_TEMPLATE = `# ZeroU enhance — health endpoint TODO

ZeroU created \`src/routes/health.ts\` exposing \`healthRouter\`.

You still need to wire it into the Express bootstrap:

\`\`\`ts
import { healthRouter } from './routes/health.js';
// ...
app.use(healthRouter);
\`\`\`

Delete this file once wired up.
`;

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

async function findExistingNextHealth(cwd: string): Promise<string | null> {
  for (const rel of NEXT_HEALTH_CANDIDATES) {
    const abs = path.join(cwd, rel);
    if (await exists(abs)) return rel;
  }
  return null;
}

async function walkSourceFiles(cwd: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ROUTE_SCAN_DIRS) {
    const abs = path.join(cwd, dir);
    if (!(await exists(abs))) continue;
    await walkInto(abs, out, cwd, 0);
  }
  return out;
}

async function walkInto(
  abs: string,
  acc: string[],
  cwd: string,
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
    if (ent.name.startsWith('.')) continue;
    const sub = path.join(abs, ent.name);
    if (ent.isDirectory()) {
      await walkInto(sub, acc, cwd, depth + 1);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(ent.name)) continue;
    acc.push(sub);
  }
}

async function findExistingExpressRoute(
  cwd: string,
): Promise<string | null> {
  const files = await walkSourceFiles(cwd);
  for (const abs of files) {
    let text: string;
    try {
      text = await fsp.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    if (EXPRESS_ROUTE_RE.test(text)) {
      return toPosix(path.relative(cwd, abs));
    }
    // Generic file-path hint (e.g. server/health.ts that exports a handler
    // but doesn't match the express grep). Treat any file whose basename
    // is `health` or `healthz` as already-present.
    const base = path.basename(abs).replace(/\.[^.]+$/, '');
    if (base === 'health' || base === 'healthz') {
      return toPosix(path.relative(cwd, abs));
    }
  }
  return null;
}

async function writeFileEnsuringDir(abs: string, body: string): Promise<void> {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf8');
}

export async function addHealthEndpoint(
  opts: FrameworkOpts,
): Promise<HealthGenResult> {
  const { cwd, framework, logger } = opts;

  // 1. Detect existing endpoint. For Next.js we look at canonical paths; for
  //    Express we additionally grep source files for a /health route.
  if (framework === 'next.js') {
    const found = await findExistingNextHealth(cwd);
    if (found) {
      logBranch(logger, 'enhance.health.detect.next', {
        decision: 'already-exists',
        reasoning: 'next.js app-router health route found',
        file: found,
      });
      return { added: null, reason: 'already-exists' };
    }
  } else if (framework === 'express') {
    const found = await findExistingExpressRoute(cwd);
    if (found) {
      logBranch(logger, 'enhance.health.detect.express', {
        decision: 'already-exists',
        reasoning: 'express /health route definition found',
        file: found,
      });
      return { added: null, reason: 'already-exists' };
    }
  } else {
    logBranch(logger, 'enhance.health.detect.unsupported', {
      decision: 'framework-unsupported',
      reasoning: `framework=${framework}; not in supported list`,
    });
    return { added: null, reason: 'framework-unsupported' };
  }

  // 2. Generate.
  if (framework === 'next.js') {
    const rel = 'app/health/route.ts';
    const abs = path.join(cwd, rel);
    await writeFileEnsuringDir(abs, NEXT_HEALTH_TEMPLATE);
    logBranch(
      logger,
      'enhance.health.write.next',
      {
        decision: 'wrote-next-route',
        reasoning: 'no existing health route detected',
        file: rel,
      },
      { level: 'info' },
    );
    return { added: rel };
  }

  // framework === 'express'
  const rel = 'src/routes/health.ts';
  const abs = path.join(cwd, rel);
  await writeFileEnsuringDir(abs, EXPRESS_HEALTH_TEMPLATE);
  const todoRel = '.zerou-todo.md';
  const todoAbs = path.join(cwd, todoRel);
  await fsp.writeFile(todoAbs, EXPRESS_TODO_TEMPLATE, 'utf8');
  logBranch(
    logger,
    'enhance.health.write.express',
    {
      decision: 'wrote-express-router',
      reasoning: 'no existing health route detected; user must wire via app.use(healthRouter)',
      file: rel,
    },
    { level: 'info' },
  );
  return { added: rel };
}
