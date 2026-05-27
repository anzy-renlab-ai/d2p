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
  /** SSE heartbeat interval in ms. Default 15000. Tests override for speed. */
  heartbeatMs?: number;
  /** fs.watch coalesce window in ms. Default 50. */
  watchDebounceMs?: number;
  /** Max concurrent SSE connections. Default 32. */
  maxSseConnections?: number;
  /** SSE replay ring buffer size. Default 1000. */
  sseRingSize?: number;
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
const SERVER_VERSION = '0.2';

// ── Live-streaming knobs (overridable per server instance for tests) ────────
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_WATCH_DEBOUNCE_MS = 50;
const DEFAULT_MAX_SSE_CONNECTIONS = 32;
const DEFAULT_SSE_RING_SIZE = 1000;

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
  stream: StreamHub;
}

// ── SSE streaming hub ────────────────────────────────────────────────────────
//
// One hub per server instance. Owns:
//   - the set of active SSE response objects
//   - a ring buffer of recent events (for Last-Event-ID replay)
//   - fs.watch handles on `<cwd>/.zerou/` (recursive on win32/darwin, manual
//     subtree on linux) plus per-file byte offsets so each watch fires we
//     only read the new tail.
//   - a heartbeat interval that emits `event: heartbeat` to every client.
//
// Lifecycle: created in startReviewServer (before listen), watchers attach
// lazily on first SSE connection so a server that never gets streaming
// traffic pays zero fs.watch cost. close() tears everything down.

type SseEventKind =
  | 'branch-trace.append'
  | 'log.append'
  | 'bundle.refresh'
  | 'heartbeat'
  | 'snapshot';

interface SseEvent {
  /** Monotonic per-hub sequence id, sent as `id:` on the wire. */
  seq: number;
  kind: SseEventKind;
  /** Pre-serialized payload (already JSON-encoded). */
  data: string;
}

interface SseClient {
  id: number;
  res: http.ServerResponse;
}

interface FileTail {
  /** Absolute path. */
  path: string;
  /** Last known byte offset; new content lives at [offset, EOF). */
  offset: number;
  /** Carry-over partial line from the previous read. */
  carry: string;
  /** Logical "kind" emitted for new lines from this file. */
  kind: 'branch-trace' | 'log';
  /** For log files: the track name (parent dir under .zerou/logs). */
  track?: string;
}

interface StreamHubOpts {
  cwd: string;
  logger: TrackLogger;
  heartbeatMs: number;
  watchDebounceMs: number;
  maxConnections: number;
  ringSize: number;
}

class StreamHub {
  private readonly opts: StreamHubOpts;
  private readonly clients = new Set<SseClient>();
  private readonly ring: SseEvent[] = [];
  private seqCounter = 0;
  private nextClientId = 1;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private watchers: fs.FSWatcher[] = [];
  private readonly tails = new Map<string, FileTail>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private dirty = new Set<string>();
  private started = false;
  private closed = false;

  constructor(opts: StreamHubOpts) {
    this.opts = opts;
  }

  /** Total connected clients (test seam). */
  connectionCount(): number {
    return this.clients.size;
  }

  /** Inspect the ring buffer (test seam). */
  ringSnapshot(): readonly SseEvent[] {
    return this.ring;
  }

  /**
   * Attach a new SSE client. Returns false + closes the response with 503
   * when the connection limit is exceeded.
   */
  addClient(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (this.closed) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('server closing');
      return false;
    }
    if (this.clients.size >= this.opts.maxConnections) {
      res.writeHead(503, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': '5',
      });
      res.end('sse connection limit reached');
      return false;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    // Lift the stream's high-water mark off the default: we send small JSON
    // chunks and want them flushed immediately. Disabling Nagle further cuts
    // first-byte latency on localhost.
    try {
      (req.socket as { setNoDelay?: (v: boolean) => void }).setNoDelay?.(true);
    } catch {
      /* socket may already be gone */
    }
    const id = this.nextClientId++;
    const client: SseClient = { id, res };
    this.clients.add(client);

    // First-time SSE traffic: spin up file watchers + heartbeat.
    if (!this.started) {
      this.start();
    }

    // Replay from Last-Event-ID, otherwise send an initial heartbeat so the
    // client knows the connection is live.
    const lastIdRaw = req.headers['last-event-id'];
    const lastIdStr = Array.isArray(lastIdRaw) ? lastIdRaw[0] : lastIdRaw;
    const lastId = typeof lastIdStr === 'string' ? parseInt(lastIdStr, 10) : NaN;
    if (Number.isFinite(lastId) && lastId >= 0) {
      const replay = this.ring.filter((e) => e.seq > lastId);
      for (const ev of replay) {
        this.writeOne(res, ev);
      }
      if (replay.length === 0) {
        this.writeOne(res, this.makeHeartbeat());
      }
    } else {
      this.writeOne(res, this.makeHeartbeat());
    }

    const cleanup = (): void => {
      this.clients.delete(client);
      // Drop watchers when the last client leaves — keeps idle servers cheap.
      if (this.clients.size === 0) {
        this.stop();
      }
    };
    res.on('close', cleanup);
    res.on('error', cleanup);
    return true;
  }

  /** Broadcast an event to every connected client + write to the ring. */
  publish(kind: SseEventKind, payload: unknown): void {
    if (this.closed) return;
    const seq = ++this.seqCounter;
    const ev: SseEvent = {
      seq,
      kind,
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    };
    this.ring.push(ev);
    while (this.ring.length > this.opts.ringSize) this.ring.shift();
    for (const c of this.clients) {
      this.writeOne(c.res, ev);
    }
  }

  /** Shut everything down. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    // End any lingering response objects so HTTP connections actually drain.
    for (const c of this.clients) {
      try {
        c.res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  // ── internal: watcher + heartbeat lifecycle ───────────────────────────────

  private start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.opts.logger.log('debug', 'review-server.stream.start', {
      cwd: this.opts.cwd,
    });
    // Seed tails so we only emit NEW content after the watcher attaches.
    this.seedTails();
    this.attachWatchers();
    this.heartbeatTimer = setInterval(() => {
      this.publish('heartbeat', { ts: new Date().toISOString() });
    }, this.opts.heartbeatMs);
    // Unref so the timer never blocks process exit (matters for CLI test
    // runners that rely on the event loop draining).
    this.heartbeatTimer.unref?.();
  }

  private stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
    this.tails.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dirty.clear();
  }

  private seedTails(): void {
    const zerouDir = path.join(this.opts.cwd, '.zerou');
    // branch-trace.jsonl — single canonical file at .zerou/
    const btPath = path.join(zerouDir, 'branch-trace.jsonl');
    this.registerTail(btPath, { kind: 'branch-trace' });
    // log files: .zerou/logs/<track>/<date>/<ulid>.jsonl. Seed each existing
    // file at its current size so the watcher only reports newly-appended
    // content from this point onward.
    const logsRoot = path.join(zerouDir, 'logs');
    try {
      const tracks = fs.readdirSync(logsRoot, { withFileTypes: true });
      for (const tEnt of tracks) {
        if (!tEnt.isDirectory()) continue;
        const trackDir = path.join(logsRoot, tEnt.name);
        const dateDirs = fs.readdirSync(trackDir, { withFileTypes: true });
        for (const dEnt of dateDirs) {
          if (!dEnt.isDirectory()) continue;
          const dateDir = path.join(trackDir, dEnt.name);
          const files = fs.readdirSync(dateDir);
          for (const f of files) {
            if (!f.endsWith('.jsonl')) continue;
            const full = path.join(dateDir, f);
            this.registerTail(full, { kind: 'log', track: tEnt.name });
          }
        }
      }
    } catch {
      /* logs dir may not exist yet — watcher picks files up later */
    }
  }

  private registerTail(
    p: string,
    meta: { kind: 'branch-trace' | 'log'; track?: string },
  ): void {
    if (this.tails.has(p)) return;
    let offset = 0;
    try {
      offset = fs.statSync(p).size;
    } catch {
      offset = 0;
    }
    this.tails.set(p, {
      path: p,
      offset,
      carry: '',
      kind: meta.kind,
      track: meta.track,
    });
  }

  private attachWatchers(): void {
    const zerouDir = path.join(this.opts.cwd, '.zerou');
    // fs.watch semantics:
    //   - Windows + macOS: recursive: true is supported natively, one watcher
    //     covers the entire subtree. Cheapest.
    //   - Linux: recursive is not implemented (Node throws ERR_FEATURE_UNAVAILABLE
    //     on some versions). We fall back to a polling scan triggered by the
    //     top-level non-recursive watcher.
    // Either way we register `change` listeners that just mark files dirty
    // and let the debounced flush re-read them.
    const onAny = (filename: string | Buffer | null): void => {
      if (!filename) return;
      const name = typeof filename === 'string' ? filename : filename.toString();
      // Normalise to absolute path. Node passes paths relative to the watched
      // dir (the `.zerou/` root in our case).
      const abs = path.join(zerouDir, name);
      this.markDirty(abs);
    };

    const tryRecursive = (): boolean => {
      try {
        const w = fs.watch(zerouDir, { recursive: true }, (_evt, filename) =>
          onAny(filename),
        );
        w.on('error', (err) => {
          this.opts.logger.log('warn', 'review-server.stream.watch-error', {
            message: err instanceof Error ? err.message : String(err),
          });
        });
        this.watchers.push(w);
        return true;
      } catch {
        return false;
      }
    };

    const platform = process.platform;
    if (platform === 'win32' || platform === 'darwin') {
      if (!tryRecursive()) this.attachManualWatchers(zerouDir, onAny);
    } else {
      // Linux: try recursive first (newer Node versions support it via
      // inotify+kqueue shims), then fall back to manual subtree.
      if (!tryRecursive()) this.attachManualWatchers(zerouDir, onAny);
    }
  }

  /**
   * Non-recursive fallback: watch `.zerou/` itself plus the current logs
   * date dir for each known track. Cheap enough for the common case where
   * only today's directory churns.
   */
  private attachManualWatchers(
    zerouDir: string,
    onAny: (filename: string | Buffer | null) => void,
  ): void {
    const watchDir = (dir: string): void => {
      try {
        const w = fs.watch(dir, (_evt, filename) => {
          if (!filename) return;
          const name =
            typeof filename === 'string'
              ? filename
              : (filename as Buffer).toString();
          // Rebase to absolute via the dir we just watched (NOT zerouDir, since
          // `filename` is relative to the watched directory).
          onAny(path.relative(zerouDir, path.join(dir, name)));
        });
        w.on('error', () => {
          /* swallow: a single missing subdir shouldn't crash the hub */
        });
        this.watchers.push(w);
      } catch {
        /* dir may not exist */
      }
    };
    watchDir(zerouDir);
    const logsRoot = path.join(zerouDir, 'logs');
    try {
      const tracks = fs.readdirSync(logsRoot, { withFileTypes: true });
      for (const tEnt of tracks) {
        if (!tEnt.isDirectory()) continue;
        const trackDir = path.join(logsRoot, tEnt.name);
        watchDir(trackDir);
        const dateDirs = fs.readdirSync(trackDir, { withFileTypes: true });
        for (const dEnt of dateDirs) {
          if (!dEnt.isDirectory()) continue;
          watchDir(path.join(trackDir, dEnt.name));
        }
      }
    } catch {
      /* logs may not exist yet */
    }
  }

  private markDirty(absPath: string): void {
    this.dirty.add(absPath);
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const paths = [...this.dirty];
      this.dirty.clear();
      void this.flushDirty(paths);
    }, this.opts.watchDebounceMs);
    this.debounceTimer.unref?.();
  }

  private async flushDirty(paths: string[]): Promise<void> {
    for (const p of paths) {
      // Was it the review bundle? Just fire a refresh event.
      if (p.endsWith('review-bundle.json')) {
        this.publish('bundle.refresh', {
          reason: 'review-bundle.json mtime changed',
          ts: new Date().toISOString(),
        });
        continue;
      }
      if (p.endsWith('branch-trace.jsonl')) {
        this.registerTail(p, { kind: 'branch-trace' });
        await this.emitFromTail(p);
        continue;
      }
      if (p.endsWith('.jsonl') && p.includes(`${path.sep}logs${path.sep}`)) {
        // Derive track from the segment two levels up (.zerou/logs/<track>/<date>/<file>).
        const parts = p.split(path.sep);
        const idx = parts.lastIndexOf('logs');
        const track = idx >= 0 ? parts[idx + 1] : undefined;
        this.registerTail(p, { kind: 'log', track });
        await this.emitFromTail(p);
        continue;
      }
      // Anything else under .zerou/ is ignored.
    }
  }

  private async emitFromTail(p: string): Promise<void> {
    const tail = this.tails.get(p);
    if (!tail) return;
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(p);
    } catch {
      return;
    }
    if (stat.size < tail.offset) {
      // File truncated/rotated — reset.
      tail.offset = 0;
      tail.carry = '';
    }
    if (stat.size === tail.offset) return;
    let chunk: Buffer;
    try {
      const fd = await fsp.open(p, 'r');
      try {
        const len = stat.size - tail.offset;
        const buf = Buffer.alloc(len);
        await fd.read(buf, 0, len, tail.offset);
        chunk = buf;
      } finally {
        await fd.close();
      }
    } catch {
      return;
    }
    tail.offset = stat.size;
    const combined = tail.carry + chunk.toString('utf8');
    const lines = combined.split('\n');
    tail.carry = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Skip malformed line — but don't poison the stream.
        continue;
      }
      if (tail.kind === 'branch-trace') {
        this.publish('branch-trace.append', parsed);
      } else {
        // Inject the track name so the UI can route the event without
        // re-parsing file paths.
        if (tail.track && typeof parsed.track !== 'string') {
          parsed.track = tail.track;
        }
        this.publish('log.append', parsed);
      }
    }
  }

  private writeOne(res: http.ServerResponse, ev: SseEvent): void {
    // SSE wire format: id + event + data, terminated by a blank line.
    const lines =
      `id: ${ev.seq}\n` +
      `event: ${ev.kind}\n` +
      `data: ${ev.data}\n\n`;
    try {
      res.write(lines);
    } catch {
      /* client gone; cleanup fires from 'close' */
    }
  }

  private makeHeartbeat(): SseEvent {
    const seq = ++this.seqCounter;
    const ev: SseEvent = {
      seq,
      kind: 'heartbeat',
      data: JSON.stringify({ ts: new Date().toISOString() }),
    };
    this.ring.push(ev);
    while (this.ring.length > this.opts.ringSize) this.ring.shift();
    return ev;
  }
}

// ── /api/branch-trace + /api/logs/tail helpers ───────────────────────────────

async function streamBranchTrace(
  res: http.ServerResponse,
  cwd: string,
  search: string,
): Promise<void> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const runTs = params.get('run');
  let filePath: string;
  if (runTs) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(runTs)) {
      sendJson(res, 404, { error: `bad run: ${runTs}` });
      return;
    }
    filePath = path.join(cwd, '.zerou', 'runs', runTs, 'branch-trace.jsonl');
    const runsRoot = path.join(cwd, '.zerou', 'runs');
    if (!isInside(runsRoot, filePath)) {
      sendJson(res, 404, { error: 'bad run' });
      return;
    }
  } else {
    filePath = path.join(cwd, '.zerou', 'branch-trace.jsonl');
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    sendJson(res, 404, { error: 'branch-trace.jsonl not found' });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'not a file' });
    return;
  }
  if (stat.size > MAX_FILE_BYTES) {
    res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('branch-trace.jsonl too large');
    return;
  }
  const sinceRaw = params.get('since');
  const since = sinceRaw === null ? 0 : Number.parseInt(sinceRaw, 10);
  if (sinceRaw !== null && (!Number.isFinite(since) || since < 0)) {
    sendJson(res, 400, { error: 'bad since' });
    return;
  }
  // Small files: just read + filter in memory. The 50 MB cap means worst-case
  // ~50 MB heap, which is fine for a localhost server.
  const text = await fsp.readFile(filePath, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (!sinceRaw) {
    res.end(text);
    return;
  }
  // Skip first N events. Each event is one JSONL line.
  const lines = text.split('\n');
  // Preserve trailing newline behaviour: emit lines [since..] joined by '\n'.
  const kept = lines.slice(since);
  res.end(kept.join('\n'));
}

interface LogTailLine {
  ts: number;
  parsed: Record<string, unknown>;
}

async function streamLogsTail(
  res: http.ServerResponse,
  cwd: string,
  search: string,
): Promise<void> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const wantTrack = params.get('track');
  const limitRaw = params.get('limit');
  let limit = 200;
  if (limitRaw !== null) {
    const n = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      sendJson(res, 400, { error: 'bad limit' });
      return;
    }
    limit = Math.min(n, 1000);
  }
  if (wantTrack !== null && !/^[A-Za-z0-9._-]{1,64}$/.test(wantTrack)) {
    sendJson(res, 400, { error: 'bad track' });
    return;
  }

  const logsRoot = path.join(cwd, '.zerou', 'logs');
  let trackEntries: fs.Dirent[];
  try {
    trackEntries = await fsp.readdir(logsRoot, { withFileTypes: true });
  } catch {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end('');
    return;
  }

  const collected: LogTailLine[] = [];
  for (const tEnt of trackEntries) {
    if (!tEnt.isDirectory()) continue;
    if (wantTrack && tEnt.name !== wantTrack) continue;
    // Defensive: same charset rule as everywhere else.
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(tEnt.name)) continue;
    const trackDir = path.join(logsRoot, tEnt.name);
    // Pick the latest date dir (lexicographic = chronological).
    let dateDirs: fs.Dirent[];
    try {
      dateDirs = await fsp.readdir(trackDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const dateNames = dateDirs
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort();
    if (dateNames.length === 0) continue;
    const latestDate = dateNames[dateNames.length - 1]!;
    const dateDir = path.join(trackDir, latestDate);
    let files: fs.Dirent[];
    try {
      files = await fsp.readdir(dateDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const jsonl = files
      .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))
      .map((f) => f.name)
      .sort();
    if (jsonl.length === 0) continue;
    const latestFile = path.join(dateDir, jsonl[jsonl.length - 1]!);
    let raw: string;
    try {
      raw = await fsp.readFile(latestFile, 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n').filter((l) => l.length > 0);
    // Take the last 200 (per spec — collected then capped at `limit` after merge)
    const slice = lines.slice(-200);
    for (const line of slice) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof parsed.track !== 'string') parsed.track = tEnt.name;
      const tsRaw = parsed.ts;
      let ts = 0;
      if (typeof tsRaw === 'number') ts = tsRaw;
      else if (typeof tsRaw === 'string') {
        const parsedTs = Date.parse(tsRaw);
        ts = Number.isFinite(parsedTs) ? parsedTs : 0;
      }
      collected.push({ ts, parsed });
    }
  }
  collected.sort((a, b) => a.ts - b.ts);
  const tail = collected.slice(-limit);
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(tail.map((l) => JSON.stringify(l.parsed)).join('\n'));
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

  if (pathname === '/api/stream') {
    // Long-lived SSE connection. Hub manages buffer + lifecycle.
    ctx.stream.addClient(req, res);
    return;
  }

  if (pathname === '/api/branch-trace') {
    await streamBranchTrace(res, ctx.cwd, search);
    return;
  }

  if (pathname === '/api/logs/tail') {
    await streamLogsTail(res, ctx.cwd, search);
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
  const stream = new StreamHub({
    cwd: path.resolve(opts.cwd),
    logger: opts.logger,
    heartbeatMs: opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    watchDebounceMs: opts.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
    maxConnections: opts.maxSseConnections ?? DEFAULT_MAX_SSE_CONNECTIONS,
    ringSize: opts.sseRingSize ?? DEFAULT_SSE_RING_SIZE,
  });
  const ctx: RouteContext = {
    cwd: path.resolve(opts.cwd),
    uiDistDir: path.resolve(opts.uiDistDir),
    logger: opts.logger,
    stream,
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
        // Tear down SSE clients + watchers first so close() can complete.
        stream.close();
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
