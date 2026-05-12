export interface HealthResponse {
  ok: boolean;
  daemonVersion: string;
  promptsVersion: number;
  claudeCli: { found: boolean; version: string | null };
  gitCli: { found: boolean; version: string | null };
  dbPath: string;
  uptimeMs: number;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface DoctorResponse {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface SseEnvelope {
  id: number;
  ts: number;
  kind: string;
  level: 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
}

const BASE = '';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${url}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => jsonFetch<HealthResponse>('/api/health'),
  doctor: () => jsonFetch<DoctorResponse>('/api/doctor'),
  startSession: (demoPath: string) =>
    jsonFetch<{ sessionId: number; status: string; isResume: boolean }>('/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoPath }),
    }),
  currentSession: () => jsonFetch<unknown>('/api/session/current'),
  endSession: () =>
    jsonFetch<unknown>('/api/session/end', { method: 'POST', headers: { 'content-type': 'application/json' } }),
};

export function openLogStream(onEvent: (e: SseEnvelope) => void): () => void {
  const es = new EventSource('/api/log/stream');
  es.addEventListener('log', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent<string>).data) as SseEnvelope;
      onEvent(data);
    } catch {
      // ignore malformed
    }
  });
  return () => es.close();
}
