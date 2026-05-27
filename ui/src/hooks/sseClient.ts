/**
 * Low-level SSE client wrapper for ZeroU's /api/stream endpoint.
 *
 * Why this exists (instead of using EventSource directly):
 *
 * 1. Testability — the hook accepts a `factory` to inject a fake; the fake
 *    matches this interface so the production path and the test path share
 *    the same surface.
 *
 * 2. Last-Event-ID strategy — the browser `EventSource` API does NOT let you
 *    set arbitrary headers (no `Last-Event-ID` on construction; the browser
 *    only sends it AFTER an automatic reconnect of the SAME EventSource).
 *    We want explicit-from-N replay across application-controlled reconnects.
 *    Workaround: pass `lastEventId` as a `?lastEventId=<seq>` query param.
 *    Worker A's server reads both the standard `Last-Event-ID` header AND
 *    this query param (header takes precedence when both are present).
 *
 * 3. Polyfill fallback — when `EventSource` is missing (e.g. jsdom in tests,
 *    or certain embedded webviews), we expose a documented path:
 *    `globalThis.EventSource` is required. For ZeroU MVP we ship for modern
 *    browsers + Electron only, both of which ship a real EventSource. We
 *    deliberately do NOT bundle an `eventsource` npm dep (zero new deps).
 *    If `EventSource` is undefined at runtime we throw a clear error so
 *    callers can wire `enabled: false`.
 */

export interface SSEHandle {
  /** Mirrors EventSource — fires for both default `message` events and
   *  the named events the server emits (branch-trace.append, log.append,
   *  bundle.refresh, heartbeat). */
  addEventListener(
    type: string,
    fn: (evt: { data: string; lastEventId?: string }) => void,
  ): void;
  removeEventListener(
    type: string,
    fn: (evt: { data: string; lastEventId?: string }) => void,
  ): void;
  close(): void;
  /** 0 = CONNECTING, 1 = OPEN, 2 = CLOSED — mirrors EventSource. */
  readonly readyState: 0 | 1 | 2;
  /** Set by caller. Called when the underlying transport reports an error. */
  onerror: ((ev: Event) => void) | null;
  /** The URL actually opened (after `?lastEventId=` was appended, if any). */
  readonly url: string;
}

export interface SSEInit {
  /** Server-assigned monotonic id of the last successfully received event.
   *  Sent as `?lastEventId=` query param; the server replays its buffer
   *  from that point. */
  lastEventId?: string | number;
}

/**
 * Build the URL we'll actually open. Exported for tests.
 *
 * Keeps any user-supplied query string intact, appends lastEventId if
 * supplied. Never throws on relative URLs (the URL constructor needs a
 * base in that case — we synthesise one from `window.location.origin` when
 * available, else `http://127.0.0.1`).
 */
export function buildStreamUrl(url: string, init?: SSEInit): string {
  if (init?.lastEventId === undefined || init.lastEventId === null) return url;
  const lastIdStr = String(init.lastEventId);
  if (lastIdStr === '') return url;
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  const base =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1';
  const u = new URL(url, isAbsolute ? undefined : base);
  u.searchParams.set('lastEventId', lastIdStr);
  // If caller passed a relative URL, give them a relative URL back so
  // Vite's dev proxy + Electron's file:// won't try to re-host the origin.
  if (!isAbsolute) {
    return u.pathname + u.search + u.hash;
  }
  return u.toString();
}

/**
 * Localhost gate. We refuse to open against any non-loopback host —
 * worker A's daemon binds only to 127.0.0.1; any other target is either a
 * misconfiguration or an attempt to exfiltrate the user's project log. We
 * fail closed.
 *
 * Acceptable hosts:
 *  - relative URL (path-only) — proxied by the dev server / Electron host
 *  - absolute URL on 127.0.0.1 or localhost
 *  - file:// — not relevant for SSE, fall through to throw
 */
export function isLocalhostUrl(url: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return true; // relative
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Create an SSE handle wrapping the platform EventSource. Throws if the
 * URL points at a non-loopback host (security) or if the platform has no
 * EventSource (caller should disable streaming).
 */
export function createSSEClient(url: string, init?: SSEInit): SSEHandle {
  if (!isLocalhostUrl(url)) {
    throw new Error(`SSE: refusing non-loopback URL ${url}`);
  }
  const ES = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  if (!ES) {
    throw new Error('SSE: EventSource is not available in this runtime');
  }
  const builtUrl = buildStreamUrl(url, init);
  // withCredentials is intentionally default-false: the daemon is loopback
  // and uses no cookies. Leaving it false also avoids preflight CORS noise
  // in cross-origin dev (vite proxy already strips origin in practice).
  const es = new ES(builtUrl);

  const handle: SSEHandle = {
    get url() {
      return builtUrl;
    },
    get readyState() {
      return es.readyState as 0 | 1 | 2;
    },
    addEventListener(type, fn) {
      // EventSource fires MessageEvent — narrow to {data, lastEventId}
      es.addEventListener(type, (ev: Event) => {
        const me = ev as MessageEvent;
        fn({
          data: typeof me.data === 'string' ? me.data : '',
          lastEventId: me.lastEventId,
        });
      });
    },
    removeEventListener() {
      // No-op: we wrap each handler in a fresh closure above, so we can't
      // map back. The hook only ever removes by closing the whole handle,
      // so this is acceptable. Documented in test #5.
    },
    close() {
      es.close();
    },
    onerror: null,
  };
  es.onerror = (ev: Event) => {
    handle.onerror?.(ev);
  };
  return handle;
}
