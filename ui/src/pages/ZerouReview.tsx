import { useEffect, useState } from 'react';
import type { ReviewBundle } from '../types-zerou.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';
import { useReviewStream } from '../hooks/useReviewStream.js';
import { ZerouStageScan } from '../components/ZerouStageScan.js';
import { ZerouStageTest } from '../components/ZerouStageTest.js';
import { ZerouStageFix } from '../components/ZerouStageFix.js';
import { ZerouStageVerify } from '../components/ZerouStageVerify.js';
import { ZerouStageTrace } from '../components/ZerouStageTrace.js';

export type ReviewSource =
  | { kind: 'latest' }
  | { kind: 'preview' }
  | { kind: 'runTs'; runTs: string };

/** Parse `?review=<latest|preview|runTs>` from window.location. */
export function readReviewParam(): ReviewSource | null {
  if (typeof window === 'undefined') return null;
  const sp = new URLSearchParams(window.location.search);
  const v = sp.get('review');
  if (!v) return null;
  if (v === 'preview') return { kind: 'preview' };
  if (v === 'latest') return { kind: 'latest' };
  return { kind: 'runTs', runTs: v };
}

interface FetchState {
  status: 'loading' | 'ready' | 'error';
  bundle: ReviewBundle | null;
  error?: string;
}

function fetchUrlForSource(src: ReviewSource): string | null {
  if (src.kind === 'preview') return null;
  if (src.kind === 'latest') return '/api/review-data.json';
  return `/api/runs/${encodeURIComponent(src.runTs)}/review-data.json`;
}

/** Resolves bundle from one of three places:
 *   1. window.__ZEROU_DATA__ (server-injected on standalone HTML)
 *   2. /api/review-data.json (or /api/runs/<runTs>/review-data.json)
 *   3. mock bundle (preview mode only)
 */
function useReviewBundle(src: ReviewSource): FetchState {
  const [state, setState] = useState<FetchState>(() => {
    if (src.kind === 'preview') {
      return { status: 'ready', bundle: mockZerouBundle };
    }
    const w = typeof window !== 'undefined'
      ? (window as unknown as { __ZEROU_DATA__?: ReviewBundle })
      : {};
    if (w.__ZEROU_DATA__) {
      return { status: 'ready', bundle: w.__ZEROU_DATA__ };
    }
    return { status: 'loading', bundle: null };
  });

  useEffect(() => {
    if (state.status === 'ready') return;
    const url = fetchUrlForSource(src);
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ReviewBundle;
      })
      .then((b) => { if (!cancelled) setState({ status: 'ready', bundle: b }); })
      .catch((e) => { if (!cancelled) setState({ status: 'error', bundle: null, error: String(e?.message ?? e) }); });
    return () => { cancelled = true; };
  }, [src, state.status]);

  return state;
}

export function ZerouReview({ source }: { source: ReviewSource }) {
  const { status, bundle, error } = useReviewBundle(source);

  // Worker C's stream hook — disabled in preview mode (no daemon).
  const isPreview = source.kind === 'preview';
  const stream = useReviewStream({ enabled: !isPreview });

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-paper text-ink flex items-center justify-center">
        <div className="text-sm text-muted font-mono">Loading review bundle…</div>
      </div>
    );
  }
  if (status === 'error' || !bundle) {
    return (
      <div className="min-h-screen bg-paper text-ink flex items-center justify-center">
        <div className="card p-6 max-w-md text-sm">
          <div className="text-rust mb-2 font-medium">Failed to load review bundle</div>
          <div className="text-xs text-muted font-mono">{error ?? 'unknown error'}</div>
          <div className="text-xs text-muted/70 mt-3 font-mono">
            Try <code className="font-mono">?review=preview</code> for the offline demo.
          </div>
        </div>
      </div>
    );
  }

  const mergeCmd = `git merge --no-ff ${bundle.project.branch}`;
  const dropCmd = `git worktree remove ${bundle.project.worktreePath} && git branch -D ${bundle.project.branch}`;

  // Pipeline summary — count stages by status. In static mode every stage
  // collapses to done/fail; in live mode worker C's hook can set 'running'.
  const allStagesPassed =
    bundle.modules.length > 0 &&
    !bundle.modules.some((m) => m.status === 'failed') &&
    bundle.verify.ok &&
    (bundle.audit?.testCases.total ?? 0) > 0;

  return (
    <div className="min-h-screen bg-paper text-ink" data-testid="zerou-review">
      {/* Sticky pipeline header */}
      <header className="border-b border-warmline bg-cream px-6 py-3 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <a
              href="/"
              className="text-xs text-muted hover:text-ink transition-colors flex-shrink-0"
            >
              ← ZeroU
            </a>
            <span className="w-px h-4 bg-warmline" />
            <span className="text-sm font-medium text-ink font-sans">
              ZeroU · <span className="font-mono">{bundle.project.name}</span>
            </span>
            <span className="text-muted/40 hidden sm:inline">·</span>
            <span className="text-xs text-muted font-mono hidden sm:inline">
              {formatDuration(bundle.durationMs)}
            </span>
            <span className="text-muted/40 hidden md:inline">·</span>
            <span
              className={`text-xs font-mono hidden md:inline ${allStagesPassed ? 'text-forest' : 'text-coral'}`}
              data-testid="zerou-review-stage-summary"
            >
              {allStagesPassed ? '✅ all 5 stages passed' : '◐ pipeline in progress'}
            </span>
            {stream.connected && (
              <>
                <span className="text-muted/40 hidden md:inline">·</span>
                <span
                  className="text-[11px] font-mono text-forest flex items-center gap-1.5"
                  data-testid="zerou-review-live-badge"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-forest anim-breathe-dot" aria-hidden="true" />
                  live
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs text-muted hover:text-coral transition-colors font-sans"
            data-testid="zerou-refresh"
          >
            ⟳ refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {/* Project identity strip */}
        <section className="bg-cream border border-warmline rounded-lg px-5 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs font-mono text-muted">
          <span>
            <span className="text-[10px] uppercase tracking-widest text-muted/70 mr-2">cwd</span>
            <span className="text-ink break-all">{bundle.project.cwd}</span>
          </span>
          <span>
            <span className="text-[10px] uppercase tracking-widest text-muted/70 mr-2">branch</span>
            <span className="text-ink break-all">{bundle.project.branch}</span>
          </span>
          <span>
            <span className="text-[10px] uppercase tracking-widest text-muted/70 mr-2">run</span>
            <span className="text-ink">{bundle.project.runTs}</span>
          </span>
          <span className="ml-auto text-muted/60">{new Date(bundle.generatedAt).toLocaleString()}</span>
        </section>

        {/* 5-stage pipeline */}
        <ZerouStageScan bundle={bundle} />
        <ZerouStageTest bundle={bundle} />
        <ZerouStageFix bundle={bundle} />
        <ZerouStageVerify bundle={bundle} />
        <ZerouStageTrace
          bundle={bundle}
          liveEvents={stream.events}
          liveConnected={stream.connected}
        />

        {/* Footer — merge / drop commands */}
        <footer className="bg-cream border border-warmline rounded-lg p-4 mt-6">
          <div className="text-[10px] uppercase tracking-widest text-muted/70 font-medium mb-2">
            Next step
          </div>
          <div className="grid gap-2">
            <CommandRow label="Merge to main" cmd={mergeCmd} testId="zerou-cmd-merge" />
            <CommandRow label="Drop this run" cmd={dropCmd} testId="zerou-cmd-drop" tone="muted" />
          </div>
          <div className="mt-3 pt-3 border-t border-warmline/60 text-[11px] text-muted font-mono flex flex-wrap gap-4">
            <a
              href={`/api/runs/${encodeURIComponent(bundle.project.runTs)}/`}
              className="text-coral hover:text-coralhover transition-colors"
              data-testid="zerou-cmd-open-archive"
            >
              ↗ open run archive
            </a>
            <span className="ml-auto text-muted/60">
              {bundle.files.length} files · {bundle.findings.length} findings ·{' '}
              {bundle.branchCoverage?.summary.branchesTotal ?? 0} branches
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

function CommandRow({
  label,
  cmd,
  testId,
  tone = 'primary',
}: {
  label: string;
  cmd: string;
  testId: string;
  tone?: 'primary' | 'muted';
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // jsdom / no clipboard — fall back silently
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="flex items-center gap-3 bg-paper border border-warmline rounded-md px-3 py-2">
      <span className={`text-[10px] uppercase tracking-wider font-medium flex-shrink-0 w-24 ${tone === 'muted' ? 'text-muted' : 'text-coral'}`}>
        {label}
      </span>
      <code className="flex-1 font-mono text-xs text-ink break-all min-w-0">{cmd}</code>
      <button
        type="button"
        onClick={onCopy}
        className="text-xs text-muted hover:text-coral transition-colors px-2 py-1 rounded hover:bg-cream flex-shrink-0"
        data-testid={testId}
      >
        {copied ? 'copied ✓' : 'copy'}
      </button>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, '0')}s`;
}
