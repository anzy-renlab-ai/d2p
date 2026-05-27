/**
 * Phase 10.5 — Production-grade logging templates.
 *
 * The strings exported from this file are emitted verbatim into the user's
 * project by `log-executor.ts`. They are *not* executed inside d2p itself —
 * d2p never `require`s `pino` at runtime. Treat them as code-generator
 * payloads.
 *
 * Design goals (see `docs/reviews/2026-05-27-auto-instrument-prior-art.md`
 * §5 "What makes a system 'production-grade' for logs" and
 * `docs/reviews/2026-05-27-log-injection-critique.md`):
 *
 *  1. **Pino** with sane defaults (JSON, level from env, pretty in dev).
 *  2. **AsyncLocalStorage correlation context** — entry-edge middleware
 *     populates it, every `getLogger()` call inside the request lifetime
 *     inherits `{ correlationId }` automatically.
 *  3. **Redaction** at the logger config layer for common secret shapes.
 *  4. **`pino.stdSerializers`** for `req`/`res`/`err` so users can write
 *     `logger.info({ err: e }, 'failed')` and get a clean serialized stack
 *     instead of a circular blow-up.
 *  5. **Child-logger pattern** (`childLogger`) for per-component bindings,
 *     plus `getLogger()` which merges correlation context + bindings.
 *  6. **Edge-runtime shim** — pino can't load on Next.js Edge (no worker
 *     threads, no fs). The shim mirrors the same public surface using
 *     `console` + structured JSON so user code is portable across runtimes.
 *
 * All four templates export the *same* public surface:
 *
 *     export const logger
 *     export function getLogger(bindings?: Record<string, unknown>)
 *     export function childLogger(bindings: Record<string, unknown>)
 *     export const correlationStore  // noop for Edge
 *
 * User code that does `logger.info(...)` or `getLogger().info(...)` works
 * identically no matter which template the executor picked.
 */

// ── BOOTSTRAP_TEMPLATE (Node.js / non-Edge) ─────────────────────────────────

export const BOOTSTRAP_TEMPLATE = `import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Correlation context. Populated by the entry-edge middleware (HTTP, queue,
 * scheduler) and read by getLogger() so every log line in the request
 * lifetime carries the same correlationId without manual threading.
 */
export const correlationStore = new AsyncLocalStorage<{ correlationId: string }>();

/**
 * Root logger. Configure prod sinks via pino.transport — example:
 *
 *   const transport = pino.transport({
 *     target: 'pino/file',
 *     options: { destination: '/var/log/app.log' },
 *   });
 *   export const logger = pino({ ... }, transport);
 *
 * In dev we use pino-pretty for human-readable output; in prod we write
 * raw JSON to stdout (Twelve-Factor factor XI: "treat logs as event streams").
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.apiKey',
      '*.secret',
      '*.creditCard',
    ],
    censor: '[REDACTED]',
    remove: false,
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});

/**
 * Returns a child logger bound to the current correlation context, optionally
 * merged with extra bindings. Use this inside request handlers, jobs, etc.
 */
export function getLogger(bindings?: Record<string, unknown>) {
  const ctx = correlationStore.getStore();
  return logger.child({ ...(ctx ?? {}), ...(bindings ?? {}) });
}

/** Per-component child logger (no correlation context auto-merge). */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
`;

// ── MIDDLEWARE_TEMPLATE_NEXT (Next.js 13.5+) ────────────────────────────────

export const MIDDLEWARE_TEMPLATE_NEXT = `import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { logger, correlationStore, getLogger } from './src/logger';

/**
 * Next.js middleware. Establishes the AsyncLocalStorage correlation context
 * for the request so any getLogger() call downstream inherits correlationId.
 *
 * NOTE: when deploying to Next.js Edge runtime, replace './src/logger' with
 * the Edge bootstrap module — pino does not load in the Edge runtime.
 */
export function middleware(req: NextRequest) {
  const correlationId =
    req.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const start = Date.now();

  return correlationStore.run({ correlationId }, () => {
    const log = getLogger({ path: req.nextUrl.pathname });
    log.info({ method: req.method }, 'request.start');

    const res = NextResponse.next();
    res.headers.set('x-correlation-id', correlationId);

    log.info(
      { status: res.status, durationMs: Date.now() - start },
      'request.end',
    );
    return res;
  });
}
`;

// ── MIDDLEWARE_TEMPLATE_EXPRESS ─────────────────────────────────────────────

export const MIDDLEWARE_TEMPLATE_EXPRESS = `import type { Request, Response, NextFunction } from 'express';
import { correlationStore, getLogger } from './src/logger';

/**
 * Express logging middleware. Wraps next() inside an AsyncLocalStorage
 * context so any getLogger() call inside the handler chain inherits the
 * correlationId. Logs request.start at entry and request.end on response
 * finish with duration + status.
 */
export function loggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId =
    (req.headers['x-correlation-id'] as string | undefined) ??
    crypto.randomUUID();
  const start = Date.now();
  res.setHeader('x-correlation-id', correlationId);

  correlationStore.run({ correlationId }, () => {
    const log = getLogger({ path: req.path });
    log.info({ method: req.method }, 'request.start');

    res.on('finish', () => {
      log.info(
        { status: res.statusCode, durationMs: Date.now() - start },
        'request.end',
      );
    });

    next();
  });
}
`;

// ── EDGE_BOOTSTRAP_TEMPLATE (Next.js Edge runtime) ──────────────────────────

/**
 * Next.js Edge runtime constraints we accommodate:
 *
 *  - No `node:async_hooks` → no AsyncLocalStorage. We export a noop
 *    `correlationStore` with the same `.run(ctx, fn)` / `.getStore()` shape
 *    so middleware code is portable.
 *  - No worker_threads / no fs → pino cannot load. We use a console-based
 *    shim that emits a JSON line per call (matches Twelve-Factor stdout
 *    discipline; the Edge runtime forwards console output to the platform's
 *    log pipeline).
 *  - No dynamic `require` → all imports must be static. The shim has zero
 *    runtime imports.
 *
 * Public surface is identical to the Node bootstrap so user code is
 * portable: `logger.info(...)`, `getLogger().info(...)`, `childLogger(...)`.
 */
export const EDGE_BOOTSTRAP_TEMPLATE = `// Next.js Edge runtime logger shim.
// pino cannot load on Edge (no worker_threads, no fs) — we emit structured
// JSON via console which the platform forwards to its log pipeline.

type Bindings = Record<string, unknown>;

interface ShimLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (bindings: Bindings) => ShimLogger;
}

function emit(level: string, bindings: Bindings, args: unknown[]): void {
  const [first, second] = args;
  const obj: Record<string, unknown> = { level, time: Date.now(), ...bindings };
  if (typeof first === 'object' && first !== null) {
    Object.assign(obj, first);
    if (typeof second === 'string') obj.msg = second;
  } else if (typeof first === 'string') {
    obj.msg = first;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(obj));
}

function createLogger(bindings: Bindings): ShimLogger {
  return {
    info: (...args) => emit('info', bindings, args),
    warn: (...args) => emit('warn', bindings, args),
    error: (...args) => emit('error', bindings, args),
    debug: (...args) => emit('debug', bindings, args),
    child: (extra: Bindings) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({});

/**
 * Noop AsyncLocalStorage shim — Edge runtime has no node:async_hooks.
 * The .run() form still invokes the callback so middleware code is portable.
 */
export const correlationStore = {
  run<T>(_ctx: { correlationId: string }, fn: () => T): T {
    return fn();
  },
  getStore(): { correlationId: string } | undefined {
    return undefined;
  },
};

export function getLogger(bindings?: Bindings): ShimLogger {
  const ctx = correlationStore.getStore();
  return logger.child({ ...(ctx ?? {}), ...(bindings ?? {}) });
}

export function childLogger(bindings: Bindings): ShimLogger {
  return logger.child(bindings);
}
`;
