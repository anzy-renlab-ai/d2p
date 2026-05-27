/**
 * Module E — sentry-installer.
 *
 * Plans (but does NOT execute) installation of `@sentry/*` SDK + bootstrap
 * files when no error-tracker is currently present.
 *
 * Authority: `docs/plans/2026-05-27-phase-10-enhance.md` Module E.
 *
 * Behaviour:
 *   1. Read package.json. If any known tracker is already present
 *      (@sentry/*, @datadog/*, honeybadger, rollbar, bugsnag, @newrelic/*)
 *      → no-op, return empty result with bootstrapPatched=null.
 *   2. Otherwise plan + execute file scaffolding:
 *       - Next.js: sentry.{server,client,edge}.config.ts + instrumentation.ts
 *       - Express: src/sentry.ts + .zerou-todo.md wiring note
 *   3. Patch package.json devDependencies (add SDK entry, do NOT run npm install).
 *   4. Return SentryInstallResult.
 *
 * Logging prefix: `enhance.sentry.*`.
 *
 * POSIX paths in returned arrays.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkOpts, SentryInstallResult } from './types.js';
import { logBranch } from '../log/branch.js';

// Trackers that, if any one is present, suppress installation.
const TRACKER_DEP_PATTERNS: RegExp[] = [
  /^@sentry\//,
  /^@datadog\//,
  /^honeybadger\b/,
  /^@honeybadger-io\//,
  /^rollbar$/,
  /^bugsnag(?:-js)?$/,
  /^@bugsnag\//,
  /^@newrelic\//,
  /^newrelic$/,
];

const SENTRY_NODE_DEP = '@sentry/node@^8.50.0';
const SENTRY_NEXTJS_DEP = '@sentry/nextjs@^8.50.0';

const NEXT_SERVER_CONFIG = `import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
`;

const NEXT_CLIENT_CONFIG = `import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
`;

const NEXT_EDGE_CONFIG = `import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
`;

const NEXT_INSTRUMENTATION = `export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
`;

const EXPRESS_SENTRY = `import * as Sentry from '@sentry/node';

export function initSentry(): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
`;

const EXPRESS_TODO = `# ZeroU enhance — Sentry wiring TODO

ZeroU added \`src/sentry.ts\` exporting \`initSentry()\`. You need to wire it
at the very top of your Express bootstrap, BEFORE any other middleware:

\`\`\`ts
import { initSentry } from './sentry.js';
initSentry();

// ... then create app, mount middleware, etc.
\`\`\`

Also set \`SENTRY_DSN\` in your environment (see \`.env.example\`).

Delete this file once wired up.
`;

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

async function readPackageJson(
  cwd: string,
): Promise<{ raw: string; parsed: Record<string, unknown>; abs: string } | null> {
  const abs = path.join(cwd, 'package.json');
  let raw: string;
  try {
    raw = await fsp.readFile(abs, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { raw, parsed, abs };
  } catch {
    return null;
  }
}

function depKeys(pkg: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const v = pkg[k];
    if (v && typeof v === 'object') {
      out.push(...Object.keys(v as Record<string, unknown>));
    }
  }
  return out;
}

function findTracker(pkg: Record<string, unknown>): string | null {
  for (const dep of depKeys(pkg)) {
    for (const re of TRACKER_DEP_PATTERNS) {
      if (re.test(dep)) return dep;
    }
  }
  return null;
}

function splitDepSpec(spec: string): { name: string; version: string } {
  // `@sentry/node@^8.50.0` — find LAST '@' after position 1.
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec, version: '*' };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

function patchDevDependencies(
  pkg: Record<string, unknown>,
  depSpecs: string[],
): Record<string, unknown> {
  const dev = (pkg.devDependencies ?? {}) as Record<string, string>;
  const next: Record<string, string> = { ...dev };
  for (const spec of depSpecs) {
    const { name, version } = splitDepSpec(spec);
    next[name] = version;
  }
  // Sort keys for stable diffs.
  const sortedDev = Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { ...pkg, devDependencies: sortedDev };
}

async function writeFileEnsuringDir(abs: string, body: string): Promise<void> {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf8');
}

export async function installSentry(
  opts: FrameworkOpts,
): Promise<SentryInstallResult> {
  const { cwd, framework, logger } = opts;

  const pkgInfo = await readPackageJson(cwd);
  if (!pkgInfo) {
    logBranch(logger, 'enhance.sentry.read.missing-package-json', {
      decision: 'no-op',
      reasoning: 'package.json missing or unparseable',
      framework,
    });
    return { added: [], dependencies: [], bootstrapPatched: null };
  }

  const existingTracker = findTracker(pkgInfo.parsed);
  if (existingTracker) {
    logBranch(
      logger,
      'enhance.sentry.detect.tracker-present',
      {
        decision: 'tracker-already-present',
        reasoning: `package.json already declares "${existingTracker}"`,
        framework,
        created: [] as string[],
      },
      { level: 'info' },
    );
    return { added: [], dependencies: [], bootstrapPatched: null };
  }

  const created: string[] = [];
  let depSpec: string;

  if (framework === 'next.js') {
    depSpec = SENTRY_NEXTJS_DEP;
    const files: Array<{ rel: string; body: string }> = [
      { rel: 'sentry.server.config.ts', body: NEXT_SERVER_CONFIG },
      { rel: 'sentry.client.config.ts', body: NEXT_CLIENT_CONFIG },
      { rel: 'sentry.edge.config.ts', body: NEXT_EDGE_CONFIG },
      { rel: 'instrumentation.ts', body: NEXT_INSTRUMENTATION },
    ];
    for (const f of files) {
      const abs = path.join(cwd, f.rel);
      await writeFileEnsuringDir(abs, f.body);
      created.push(toPosix(f.rel));
    }
    logBranch(
      logger,
      'enhance.sentry.write.next',
      {
        decision: 'wrote-nextjs-configs',
        reasoning: 'no tracker present; scaffolding 4 nextjs files',
        framework,
        created: created.slice(),
      },
      { level: 'info' },
    );
  } else if (framework === 'express') {
    depSpec = SENTRY_NODE_DEP;
    const rel = 'src/sentry.ts';
    await writeFileEnsuringDir(path.join(cwd, rel), EXPRESS_SENTRY);
    created.push(rel);
    const todoRel = '.zerou-todo.md';
    await fsp.writeFile(path.join(cwd, todoRel), EXPRESS_TODO, 'utf8');
    created.push(todoRel);
    logBranch(
      logger,
      'enhance.sentry.write.express',
      {
        decision: 'wrote-express-bootstrap',
        reasoning: 'no tracker present; user must call initSentry() at bootstrap',
        framework,
        created: created.slice(),
      },
      { level: 'info' },
    );
  } else {
    // Other frameworks: still try node SDK as a best effort but no scaffolding.
    depSpec = SENTRY_NODE_DEP;
    logBranch(
      logger,
      'enhance.sentry.write.generic',
      {
        decision: 'dep-only',
        reasoning: `framework=${framework}; adding @sentry/node dep but no bootstrap scaffold`,
        framework,
        created: [] as string[],
      },
      { level: 'info' },
    );
  }

  // Patch package.json devDependencies.
  const patched = patchDevDependencies(pkgInfo.parsed, [depSpec]);
  await fsp.writeFile(
    pkgInfo.abs,
    JSON.stringify(patched, null, 2) + '\n',
    'utf8',
  );

  return {
    added: created,
    dependencies: [depSpec],
    bootstrapPatched: toPosix(pkgInfo.abs),
  };
}

// Silence unused-import in some toolchains.
void fs;
