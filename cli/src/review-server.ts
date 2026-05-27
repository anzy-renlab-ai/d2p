/**
 * Phase 12 — minimal local HTTP server for `zerou review --serve`.
 *
 * Serves the built React review UI (from `ui/dist/`) and a small read-only
 * JSON API that surfaces the enhance run's review bundle. Designed to be
 * **local-only**: binds to 127.0.0.1, never 0.0.0.0; no write endpoints;
 * no CORS (same-origin). Zero npm deps — pure node `http` + `fs` + `path`.
 *
 * Routes:
 *   GET /                                    -> ui/dist/index.html (redirects
 *                                               '/' to '/?review=latest' to
 *                                               nudge the UI into review mode)
 *   GET /assets/*                            -> ui/dist/assets/*
 *   GET /api/health                          -> { ok, version }
 *   GET /api/review-data.json                -> .zerou/review-bundle.json
 *   GET /api/runs                            -> { runs: [{ ts, generatedAt }] }
 *   GET /api/runs/<ts>/review-data.json      -> archived bundle
 *   *                                        -> 404
 *
 * Security rails:
 *   - 127.0.0.1 only (configurable host, but the public API caller should
 *     keep the default; binding to 0.0.0.0 means anyone on LAN reads your
 *     codebase diffs)
 *   - Path traversal: every static path is resolved + re-checked to be
 *     strictly inside uiDistDir
 *   - 50 MB file cap (bundle should never exceed this; lock as defense in
 *     depth)
 *   - Read-only: no POST/PUT/DELETE handlers
 *
 * Authority: phase-12 worker-C task brief (2026-05-27).
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { TrackLogger } from './log-types.js';

export interface ReviewServerOpts {
  /** User project root; we read `<cwd>/.zerou/*` from here. */
  cwd: string;
  /** Absolute path to the built `ui/dist` directory. */
  uiDistDir: string;
  /** Listen port; 0 = ephemeral. Default 7777. */
  port?: number;
  /** Listen host; default 127.0.0.1. Never set to 0.0.0.0 in prod. */
  host?: string;
  logger: TrackLogger;
}

export interface ReviewServerHandle {
  url: string;
  port: number;
  host: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 7777;
const DEFAULT_HOST = '127.0.0.1';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SERVER_VERSION = '0.1';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFor(p: string): string {
  return MIME_TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Verify that `candidate` (after `path.resolve`) lives strictly inside
 * `root`. Defends against `/../etc/passwd`, percent-encoded variants, etc.
 */
export function isInside(root: string, candidate: string): boolean {
  const rResolved = path.resolve(root);
  const cResolved = path.resolve(candidate);
  // Add separator so `/foo/bar` is not considered inside `/foo/ba`.
  const rWithSep = rResolved.endsWith(path.sep) ? rResolved : rResolved + path.sep;
  return cResolved === rResolved || cResolved.startsWith(rWithSep);
}

/** Decode the URL pathname robustly; reject if it decodes to something funky. */
function safeDecodePath(rawPath: string): string | null {
  try {
    const decoded = decodeURIComponent(rawPath);
    // Defense in depth: explicit traversal markers after decode = reject.
    if (decoded.includes('\0')) return null;
    return decoded;
  } catch {
    return null;
  }
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(json);
}

function send404(res: http.ServerResponse, reason = 'not found'): void {
  sendJson(res, 404, { error: reason });
}

function send405(res: http.ServerResponse): void {
  res.writeHead(405, {
    'Content-Type': 'text/plain; charset=utf-8',
    Allow: 'GET, HEAD',
  });
  res.end('method not allowed');
}

async function sendFile(
  res: http.ServerResponse,
  absPath: string,
  contentType?: string,
): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(absPath);
  } catch {
    send404(res, 'file not found');
    return;
  }
  if (!stat.isFile()) {
    send404(res, 'not a file');
    return;
  }
  if (stat.size > MAX_FILE_BYTES) {
    res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('file too large');
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentType ?? mimeFor(absPath),
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const stream = fs.createReadStream(absPath);
  stream.on('error', () => {
    // Headers already sent — abort the connection.
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  });
  stream.pipe(res);
  await new Promise<void>((resolve) => {
    stream.once('end', resolve);
    stream.once('error', () => resolve());
    res.once('close', () => resolve());
  });
}

/** Read the stable / latest review bundle for a project. */
async function readStableBundle(cwd: string): Promise<string | null> {
  const stable = path.join(cwd, '.zerou', 'review-bundle.json');
  try {
    const data = await fsp.readFile(stable, 'utf8');
    return data;
  } catch {
    return null;
  }
}

async function readArchivedBundle(
  cwd: string,
  ts: string,
): Promise<string | null> {
  // ts is user-supplied — restrict to safe charset to block traversal.
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(ts)) return null;
  const archived = path.join(cwd, '.zerou', 'runs', ts, 'review-bundle.json');
  // Defense in depth: still check it's inside .zerou/runs/.
  const runsRoot = path.join(cwd, '.zerou', 'runs');
  if (!isInside(runsRoot, archived)) return null;
  try {
    return await fsp.readFile(archived, 'utf8');
  } catch {
    return null;
  }
}

async function listRuns(
  cwd: string,
): Promise<Array<{ ts: string; generatedAt: string | null }>> {
  const runsDir = path.join(cwd, '.zerou', 'runs');
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ ts: string; generatedAt: string | null }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(e.name)) continue;
    const bundlePath = path.join(runsDir, e.name, 'review-bundle.json');
    let generatedAt: string | null = null;
    try {
      const raw = await fsp.readFile(bundlePath, 'utf8');
      const parsed = JSON.parse(raw) as { generatedAt?: unknown };
      if (typeof parsed.generatedAt === 'string') {
        generatedAt = parsed.generatedAt;
      }
    } catch {
      // Run dir without a bundle (e.g. mid-write) → still list but no ts info.
      // Skip such dirs to keep the API output tidy.
      continue;
    }
    out.push({ ts: e.name, generatedAt });
  }
  // Most recent first (timestamps are lexicographic-sortable).
  out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return out;
}

function rewriteIndexHtml(html: string): string {
  // The built UI has absolute /assets/... references. We serve them at the
  // same path, so no rewrite needed. We *do* nudge the URL to ?review=latest
  // on the client via a tiny inline script — but only if no query string is
  // already present. To keep this server bytewise faithful to the build, we
  // leave the HTML unchanged. The redirect happens at the HTTP layer.
  return html;
}

interface RouteContext {
  cwd: string;
  uiDistDir: string;
  logger: TrackLogger;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    send405(res);
    return;
  }

  // Defensive: require a URL (Node always provides one for incoming requests,
  // but TS sees `string | undefined`).
  const rawUrl = req.url ?? '/';
  // Parse pathname WITHOUT relying on `URL` host resolution (req.headers.host
  // can be attacker-controlled; for routing we only need pathname).
  let pathname: string;
  let search: string;
  const qIdx = rawUrl.indexOf('?');
  if (qIdx >= 0) {
    pathname = rawUrl.slice(0, qIdx);
    search = rawUrl.slice(qIdx);
  } else {
    pathname = rawUrl;
    search = '';
  }
  const decoded = safeDecodePath(pathname);
  if (decoded === null) {
    send404(res, 'bad path');
    return;
  }
  pathname = decoded;

  ctx.logger.log('debug', 'review-server.request', {
    method,
    pathname,
    hasQuery: search.length > 0,
  });

  // ---- API routes -------------------------------------------------------
  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, version: SERVER_VERSION });
    return;
  }

  if (pathname === '/api/review-data.json') {
    const data = await readStableBundle(ctx.cwd);
    if (data === null) {
      sendJson(res, 404, {
        error:
          'no review bundle. run `zerou audit` then `zerou enhance` first',
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
    return;
  }

  if (pathname === '/api/runs') {
    const runs = await listRuns(ctx.cwd);
    sendJson(res, 200, { runs });
    return;
  }

  // /api/runs/<ts>/review-data.json
  const archivedMatch = /^\/api\/runs\/([^/]+)\/review-data\.json$/.exec(
    pathname,
  );
  if (archivedMatch) {
    const ts = archivedMatch[1] ?? '';
    const data = await readArchivedBundle(ctx.cwd, ts);
    if (data === null) {
      sendJson(res, 404, { error: `archived run not found: ${ts}` });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
    return;
  }

  // ---- Static UI routes -------------------------------------------------
  if (pathname === '/' || pathname === '/index.html') {
    // If no query was supplied, redirect to ?review=latest so the UI lands
    // in review mode immediately. Browsers will follow the 302.
    if (search === '') {
      res.writeHead(302, { Location: '/?review=latest' });
      res.end();
      return;
    }
    const indexPath = path.join(ctx.uiDistDir, 'index.html');
    if (!isInside(ctx.uiDistDir, indexPath)) {
      send404(res);
      return;
    }
    try {
      const html = await fsp.readFile(indexPath, 'utf8');
      const body = rewriteIndexHtml(html);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      sendJson(res, 500, {
        error:
          'ui/dist/index.html missing. run `pnpm -C ui build` then retry.',
      });
    }
    return;
  }

  // Anything else under /assets, /favicon.ico, etc. → static from uiDistDir.
  // Strip leading slash, then resolve under uiDistDir.
  const rel = pathname.replace(/^\/+/, '');
  if (!rel) {
    send404(res);
    return;
  }
  // Reject absolute-looking / null / control characters before path.join.
  if (/[\0\r\n]/.test(rel) || path.isAbsolute(rel)) {
    send404(res, 'bad path');
    return;
  }
  const candidate = path.join(ctx.uiDistDir, rel);
  if (!isInside(ctx.uiDistDir, candidate)) {
    send404(res, 'path traversal blocked');
    return;
  }
  await sendFile(res, candidate);
}

/**
 * Resolve the on-disk location of the built UI bundle (`ui/dist/`).
 *
 * When the CLI is run from the workspace checkout, source paths look like:
 *   D:/lll/d2p/cli/dist/review-server.js
 *   D:/lll/d2p/ui/dist/index.html
 * → walk up from cli/dist, then look at ../ui/dist.
 *
 * When installed via npm, the package layout might be flattened. Probe a
 * few likely sibling locations and pick the first one that exists.
 */
export async function locateUiDist(startDir: string): Promise<string | null> {
  // Candidate list, ordered by likelihood.
  const fromCwd = path.resolve(startDir);
  const candidates: string[] = [
    // Post-build relocation: cli/dist/ui (if a future build script copies).
    path.join(fromCwd, 'ui'),
    path.join(fromCwd, 'dist', 'ui'),
    // Dev workspace: cli/dist/ → ../../ui/dist
    path.resolve(fromCwd, '..', 'ui', 'dist'),
    path.resolve(fromCwd, '..', '..', 'ui', 'dist'),
    path.resolve(fromCwd, '..', '..', '..', 'ui', 'dist'),
  ];
  for (const c of candidates) {
    try {
      const idx = path.join(c, 'index.html');
      const stat = await fsp.stat(idx);
      if (stat.isFile()) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function startReviewServer(
  opts: ReviewServerOpts,
): Promise<ReviewServerHandle> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const ctx: RouteContext = {
    cwd: path.resolve(opts.cwd),
    uiDistDir: path.resolve(opts.uiDistDir),
    logger: opts.logger,
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, ctx).catch((err) => {
      opts.logger.log('error', 'review-server.handler-error', {
        message: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal error' });
      } else {
        try {
          res.destroy();
        } catch {
          /* ignore */
        }
      }
    });
  });

  // Disable Nagle for snappier first-byte; cap idle keep-alive low (this is
  // a localhost server, no need for long-lived connections).
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const addr = server.address() as AddressInfo;
  const actualPort = addr.port;
  const url = `http://${host}:${actualPort}`;

  opts.logger.log('info', 'review-server.listening', {
    host,
    port: actualPort,
    url,
    cwd: ctx.cwd,
    uiDistDir: ctx.uiDistDir,
  });

  return {
    url,
    port: actualPort,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        // Stop accepting new connections, then force-close sockets so we
        // don't hang in tests waiting on keep-alive timeouts.
        server.closeAllConnections?.();
        server.close(() => {
          opts.logger.log('info', 'review-server.closed', { port: actualPort });
          resolve();
        });
      }),
  };
}
