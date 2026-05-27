/**
 * useReviewStream — React hook that subscribes to ZeroU's /api/stream SSE
 * endpoint and exposes the live event feed for UI panels.
 *
 * Phase 14 — pairs with Worker A's server (/api/stream) and Worker B's
 * page integration. This file owns the connection lifecycle, reconnect
 * backoff, and Last-Event-ID resume; it does NOT render anything.
 *
 * See `./sseClient.ts` for the underlying EventSource wrapper and the
 * Last-Event-ID query-param strategy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BranchTraceEvent, LogEvent } from '../types-zerou.js';
import { createSSEClient, type SSEHandle } from './sseClient.js';

// ── Public API ────────────────────────────────────────────────────────────

export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'error'
  | 'disabled';

export interface UseReviewStreamOpts {
  /** Endpoint URL. Default '/api/stream'. */
  url?: string;
  /** Set false to disable (preview mode / no daemon). Default true. */
  enabled?: boolean;
  /** Reconnect backoff multiplier: delay = baseBackoffMs * 2^attempt + jitter.
   *  Capped at 32s before jitter. Default 500. */
  baseBackoffMs?: number;
  /** Cap on retry attempts before giving up. Default 6 (last delay = 32s). */
  maxRetries?: number;
  /** Max events to keep in memory per array. Default 5000 (older trimmed). */
  maxEvents?: number;
  /** Test seam — inject a custom EventSource factory. */
  factory?: (url: string, init?: { lastEventId?: string | number }) => SSEHandle;
}

export interface UseReviewStreamResult {
  status: StreamStatus;
  connected: boolean;
  /** Incremental — appends as `branch-trace.append` arrives. */
  events: BranchTraceEvent[];
  /** Separate stream for non-branch `log.append` events. */
  logEvents: LogEvent[];
  /** Latest event/heartbeat timestamp seen, or null before first contact. */
  lastEventTs: string | null;
  /** Total events received across both arrays (and survived a trim). */
  totalReceived: number;
  /** How many reconnect attempts have fired without a successful read since
   *  the last clean stream open. Reset on heartbeat / fresh event. */
  retryCount: number;
  /** Set to true when the server emitted a `bundle.refresh` since the
   *  consumer last cleared it. Consumers read this and call
   *  `clearBundleStale` after refetching the bundle. */
  bundleStale: boolean;
  /** Manually clear the bundleStale flag after acting on it. */
  clearBundleStale(): void;
  /** Reconnect manually after error. Resets retryCount and re-attempts. */
  reconnect(): void;
  /** Stop subscribing. Status → 'idle'. */
  disconnect(): void;
}

// ── Implementation ────────────────────────────────────────────────────────

const DEFAULTS = {
  url: '/api/stream',
  enabled: true,
  baseBackoffMs: 500,
  maxRetries: 6,
  maxEvents: 5000,
} as const;

// Capped at 32s before jitter. We reach the cap at attempt = 6 with
// baseBackoffMs=500 (500 * 64 = 32_000). Beyond that we plateau.
const BACKOFF_CAP_MS = 32_000;

function computeBackoff(baseMs: number, attempt: number): number {
  const raw = baseMs * 2 ** attempt;
  const capped = Math.min(raw, BACKOFF_CAP_MS);
  // ±25% jitter — keeps clients from synchronising after a daemon restart.
  const jitter = capped * (Math.random() * 0.5 - 0.25);
  return Math.max(0, Math.round(capped + jitter));
}

export function useReviewStream(opts: UseReviewStreamOpts = {}): UseReviewStreamResult {
  const {
    url = DEFAULTS.url,
    enabled = DEFAULTS.enabled,
    baseBackoffMs = DEFAULTS.baseBackoffMs,
    maxRetries = DEFAULTS.maxRetries,
    maxEvents = DEFAULTS.maxEvents,
    factory,
  } = opts;

  const [status, setStatus] = useState<StreamStatus>(enabled ? 'idle' : 'disabled');
  const [events, setEvents] = useState<BranchTraceEvent[]>([]);
  const [logEvents, setLogEvents] = useState<LogEvent[]>([]);
  const [lastEventTs, setLastEventTs] = useState<string | null>(null);
  const [totalReceived, setTotalReceived] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [bundleStale, setBundleStale] = useState(false);

  // Refs hold non-render state so we don't trigger reconnect on every set.
  const handleRef = useRef<SSEHandle | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const closedRef = useRef(false);
  // React 18 strict mode runs effects twice in dev — generation lets the
  // first cleanup invalidate any work the first run scheduled.
  const generationRef = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeHandle = useCallback(() => {
    if (handleRef.current) {
      try {
        handleRef.current.close();
      } catch {
        /* swallow — close should never throw, but defend the cleanup path */
      }
      handleRef.current = null;
    }
  }, []);

  const connect = useCallback(
    (gen: number) => {
      if (gen !== generationRef.current) return; // stale closure from prior mount
      if (closedRef.current) return;
      clearRetryTimer();
      closeHandle();
      setStatus((s) => (s === 'reconnecting' ? 'reconnecting' : 'connecting'));

      const make = factory ?? createSSEClient;
      let handle: SSEHandle;
      try {
        handle = make(
          url,
          lastSeqRef.current !== null ? { lastEventId: lastSeqRef.current } : undefined,
        );
      } catch (err) {
        // Either non-loopback URL or no EventSource — both terminal.
        // eslint-disable-next-line no-console
        console.warn('[useReviewStream] connect failed:', err);
        setStatus('error');
        return;
      }
      handleRef.current = handle;

      // The browser doesn't fire a synchronous 'open' for EventSource until
      // the response headers come back; we transition to 'streaming' on the
      // first event OR heartbeat. Until then status stays 'connecting'.
      const markStreaming = () => {
        if (gen !== generationRef.current) return;
        setStatus('streaming');
        retryCountRef.current = 0;
        setRetryCount(0);
      };

      handle.addEventListener('branch-trace.append', (evt) => {
        if (gen !== generationRef.current) return;
        let parsed: BranchTraceEvent | null = null;
        try {
          parsed = JSON.parse(evt.data) as BranchTraceEvent;
        } catch {
          return; // malformed line — skip silently
        }
        if (!parsed || typeof parsed.seq !== 'number') return;
        lastSeqRef.current = parsed.seq;
        markStreaming();
        setLastEventTs(parsed.ts);
        setTotalReceived((n) => n + 1);
        setEvents((prev) => {
          const next = prev.length >= maxEvents ? prev.slice(prev.length - maxEvents + 1) : prev.slice();
          next.push(parsed!);
          return next;
        });
      });

      handle.addEventListener('log.append', (evt) => {
        if (gen !== generationRef.current) return;
        let parsed: LogEvent | null = null;
        try {
          parsed = JSON.parse(evt.data) as LogEvent;
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== 'object') return;
        if (typeof parsed.seq === 'number') lastSeqRef.current = parsed.seq;
        markStreaming();
        if (typeof parsed.ts === 'string') setLastEventTs(parsed.ts);
        setTotalReceived((n) => n + 1);
        setLogEvents((prev) => {
          const next = prev.length >= maxEvents ? prev.slice(prev.length - maxEvents + 1) : prev.slice();
          next.push(parsed!);
          return next;
        });
      });

      handle.addEventListener('bundle.refresh', () => {
        if (gen !== generationRef.current) return;
        markStreaming();
        setBundleStale(true);
      });

      handle.addEventListener('heartbeat', (evt) => {
        if (gen !== generationRef.current) return;
        markStreaming();
        try {
          const data = JSON.parse(evt.data) as { ts?: string };
          if (data?.ts) setLastEventTs(data.ts);
        } catch {
          /* heartbeat with no payload is fine */
        }
      });

      // Default 'message' channel — server isn't using it, but the spec
      // requires we register so unnamed events don't tear the stream down.
      handle.addEventListener('message', () => {
        if (gen !== generationRef.current) return;
        markStreaming();
      });

      handle.onerror = () => {
        if (gen !== generationRef.current) return;
        if (closedRef.current) return;
        closeHandle();
        const attempt = retryCountRef.current;
        if (attempt >= maxRetries) {
          setStatus('error');
          return;
        }
        const delay = computeBackoff(baseBackoffMs, attempt);
        retryCountRef.current = attempt + 1;
        setRetryCount(attempt + 1);
        setStatus('reconnecting');
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          connect(gen);
        }, delay);
      };
    },
    [url, factory, baseBackoffMs, maxRetries, maxEvents, clearRetryTimer, closeHandle],
  );

  const disconnect = useCallback(() => {
    closedRef.current = true;
    // Bump generation so any already-attached listener closures bail on
    // their gen-check. The platform EventSource normally stops firing once
    // close() is called, but our test fake (and any pathological proxy)
    // might still deliver an in-flight event — defence-in-depth.
    generationRef.current += 1;
    clearRetryTimer();
    closeHandle();
    setStatus(enabled ? 'idle' : 'disabled');
  }, [clearRetryTimer, closeHandle, enabled]);

  const reconnect = useCallback(() => {
    closedRef.current = false;
    retryCountRef.current = 0;
    setRetryCount(0);
    generationRef.current += 1;
    connect(generationRef.current);
  }, [connect]);

  const clearBundleStale = useCallback(() => setBundleStale(false), []);

  // Drive the connection from enabled + url. Each time those change we bump
  // generation so any in-flight retry timer becomes a no-op.
  useEffect(() => {
    if (!enabled) {
      setStatus('disabled');
      closedRef.current = true;
      clearRetryTimer();
      closeHandle();
      return undefined;
    }
    closedRef.current = false;
    generationRef.current += 1;
    const myGen = generationRef.current;
    retryCountRef.current = 0;
    setRetryCount(0);
    connect(myGen);
    return () => {
      // Strict-mode-safe cleanup. We bump generation so the in-flight
      // connect callback (and any setTimeout it scheduled) becomes a stale
      // closure and bails on the gen-check above.
      generationRef.current += 1;
      closedRef.current = true;
      clearRetryTimer();
      closeHandle();
    };
  }, [enabled, url, connect, clearRetryTimer, closeHandle]);

  return {
    status,
    connected: status === 'streaming',
    events,
    logEvents,
    lastEventTs,
    totalReceived,
    retryCount,
    bundleStale,
    clearBundleStale,
    reconnect,
    disconnect,
  };
}
