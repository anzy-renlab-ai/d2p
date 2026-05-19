// REST + SSE client for the d2p daemon. Vite proxies /api/* to :5174 in dev.

import type {
  CurrentSessionRes,
  DetectorOutput,
  DoctorResponse,
  Gap,
  HealthResponse,
  LoopState,
  ProjectListItem,
  SessionListItem,
  SseEnvelope,
  VisionRoundRes,
} from './types.js';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }
    // Surface the daemon's `detail` field in the error message so banners show
    // the actual upstream cause (e.g. "HTTP 401: invalid api key") instead of
    // a generic "502 /api/detector/run". Falls back to status+url when the
    // daemon didn't include detail.
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : '';
    const title =
      parsed && typeof parsed === 'object' && 'title' in parsed
        ? String((parsed as { title: unknown }).title)
        : `${res.status} ${url}`;
    const msg = detail ? `${title} — ${detail}` : title;
    const err = new Error(msg) as Error & { detail?: unknown; status?: number };
    err.detail = parsed;
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => jsonFetch<HealthResponse>('/api/health'),
  doctor: () => jsonFetch<DoctorResponse>('/api/doctor'),

  startSession: (demoPath: string) =>
    jsonFetch<{ sessionId: number; status: string; isResume: boolean }>('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({ demoPath }),
    }),
  currentSession: () => jsonFetch<CurrentSessionRes>('/api/session/current'),
  endSession: () =>
    jsonFetch<{ sessionId: number; status: string; summaryMdPath?: string | null }>(
      '/api/session/end',
      { method: 'POST', body: JSON.stringify({}) },
    ),

  runDetector: () =>
    jsonFetch<DetectorOutput>('/api/detector/run', { method: 'POST', body: JSON.stringify({}) }),

  listPresets: () => jsonFetch<{ types: string[] }>('/api/preset/list'),
  choosePreset: (type: string) =>
    jsonFetch<{ type: string; presetMd: string }>('/api/preset/choose', {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  currentPreset: () =>
    jsonFetch<{
      type: string | null;
      presetMd: string | null;
      overrides: unknown;
      statusLatest: { item: string; status: 'done' | 'partial' | 'missing'; note: string | null }[];
    }>('/api/preset/current'),
  savePresetOverride: (overrides: unknown) =>
    jsonFetch<{ ok: true }>('/api/preset/override', {
      method: 'POST',
      body: JSON.stringify({ overrides }),
    }),

  visionRound: () => jsonFetch<VisionRoundRes>('/api/vision/round'),
  answerVision: (answers: { questionId: string; question?: string; answer: string }[]) =>
    jsonFetch<VisionRoundRes>('/api/vision/answer', {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
  finalizeVision: () =>
    jsonFetch<VisionRoundRes>('/api/vision/finalize', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  startLoop: () =>
    jsonFetch<{ status: string; alreadyRunning?: boolean }>('/api/loop/start', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  pauseLoop: () =>
    jsonFetch<{ status: string }>('/api/loop/pause', { method: 'POST', body: JSON.stringify({}) }),
  resumeLoop: () =>
    jsonFetch<{ status: string }>('/api/loop/resume', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  loopState: () => jsonFetch<LoopState>('/api/loop/state'),

  listGaps: (filter?: { status?: string[] }) => {
    const qs = filter?.status?.length
      ? '?' + filter.status.map((s) => `status=${encodeURIComponent(s)}`).join('&')
      : '';
    return jsonFetch<{ gaps: Gap[] }>(`/api/gaps/${qs}`);
  },
  skipGap: (id: number) =>
    jsonFetch<{ id: number; status: string }>(`/api/gaps/${id}/skip`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  recentEvents: (limit = 200) =>
    jsonFetch<{ events: SseEnvelope[]; hasMore: boolean }>(`/api/log/events?limit=${limit}`),

  listInputs: () =>
    jsonFetch<{ inputs: { name: string; size: number; modifiedAt: number }[] }>('/api/inputs'),
  saveInput: (name: string, body: string) =>
    jsonFetch<{ ok: true; path: string }>('/api/inputs', {
      method: 'POST',
      body: JSON.stringify({ name, body }),
    }),

  deployTargets: () =>
    jsonFetch<{
      targets: {
        id: string;
        name: string;
        confidence: number;
        evidence: string[];
        recommendedCommand: string;
        docsUrl: string;
      }[];
    }>('/api/deploy/targets'),

  listProjects: () => jsonFetch<{ projects: ProjectListItem[] }>('/api/projects'),
  listSessionsByProject: (id: number) =>
    jsonFetch<{ sessions: SessionListItem[] }>(`/api/projects/${id}/sessions`),
};

/**
 * Subscribe to live log events with auto-reconnect (exponential backoff).
 * Returns a disconnect function.
 */
/** Open the run-scoped cc multi-turn SSE stream. Receives snapshots of
 *  cc_turn_events + scratchpad + cc-session for the given runId. Reconnects
 *  on transient drops the same way as openLogStream. */
export interface CcStreamSnapshot {
  runId: string;
  newEvents: {
    id: number;
    turnIdx: number;
    source: string;
    payload: unknown;
    ts: number;
  }[];
  scratchpad: { turn: number; ts: number; text: string }[];
  ccSessionId: string | null;
  lastTurnIdx: number;
}

export function openCcStream(
  runId: string,
  onSnapshot: (s: CcStreamSnapshot) => void,
  onConnectChange?: (connected: boolean) => void,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retryMs = 1000;

  function connect(): void {
    if (closed) return;
    es = new EventSource(`/api/cc-stream/${encodeURIComponent(runId)}`);
    es.addEventListener('open', () => {
      retryMs = 1000;
      onConnectChange?.(true);
    });
    es.addEventListener('cc-stream', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as CcStreamSnapshot;
        onSnapshot(data);
      } catch {
        /* malformed */
      }
    });
    es.addEventListener('error', () => {
      onConnectChange?.(false);
      es?.close();
      if (closed) return;
      setTimeout(() => {
        if (closed) return;
        retryMs = Math.min(retryMs * 2, 15_000);
        connect();
      }, retryMs);
    });
  }

  connect();
  return () => {
    closed = true;
    es?.close();
  };
}

export function openLogStream(
  onEvent: (e: SseEnvelope) => void,
  onConnectChange?: (connected: boolean) => void,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retryMs = 1000;

  function connect(): void {
    if (closed) return;
    es = new EventSource('/api/log/stream');

    es.addEventListener('open', () => {
      retryMs = 1000;
      onConnectChange?.(true);
    });

    es.addEventListener('log', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as SseEnvelope;
        onEvent(data);
      } catch {
        // ignore malformed
      }
    });

    es.addEventListener('error', () => {
      onConnectChange?.(false);
      es?.close();
      if (closed) return;
      setTimeout(() => {
        if (closed) return;
        retryMs = Math.min(retryMs * 2, 15_000);
        connect();
      }, retryMs);
    });
  }

  connect();
  return () => {
    closed = true;
    es?.close();
  };
}
