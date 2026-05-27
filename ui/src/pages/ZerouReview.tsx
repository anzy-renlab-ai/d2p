import { useEffect, useState } from 'react';
import type { ReviewBundle } from '../types-zerou.js';
import { mockZerouBundle } from '../mock/zerouBundle.js';
import { ZerouHeroBar } from '../components/ZerouHeroBar.js';
import { ZerouModuleCards } from '../components/ZerouModuleCards.js';
import { ZerouFindingsList } from '../components/ZerouFindingsList.js';
import { ZerouFilesList } from '../components/ZerouFilesList.js';
import { ZerouBranchTree } from '../components/ZerouBranchTree.js';
import { ZerouVerifyStrip } from '../components/ZerouVerifyStrip.js';

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
          <div className="text-xs text-muted/70 mt-3 font-serif italic">
            Try <code className="font-mono">?review=preview</code> for the offline demo.
          </div>
        </div>
      </div>
    );
  }

  const mergeCmd = `git merge --no-ff ${bundle.project.branch}`;
  const dropCmd = `git worktree remove ${bundle.project.worktreePath} && git branch -D ${bundle.project.branch}`;

  return (
    <div className="min-h-screen bg-paper text-ink" data-testid="zerou-review">
      {/* Top bar */}
      <header className="border-b border-warmline bg-cream px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-xs text-muted hover:text-ink transition-colors"
          >
            ← d2p
          </a>
          <span className="w-px h-4 bg-warmline" />
          <span className="text-sm font-medium text-ink">
            ZeroU review · <span className="font-mono">{bundle.project.name}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-xs text-muted hover:text-coral transition-colors font-sans"
          data-testid="zerou-refresh"
        >
          ⟳ refresh
        </button>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <ZerouHeroBar bundle={bundle} />
        <ZerouModuleCards modules={bundle.modules} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ZerouFilesList files={bundle.files} />
          <ZerouFindingsList findings={bundle.findings} />
        </div>

        <ZerouBranchTree report={bundle.branchCoverage} />
        <ZerouVerifyStrip verify={bundle.verify} />

        {/* Footer — merge / drop commands */}
        <footer className="bg-cream border border-warmline rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted/70 font-medium mb-2">
            Next step
          </div>
          <div className="grid gap-2">
            <CommandRow label="Merge to main" cmd={mergeCmd} testId="zerou-cmd-merge" />
            <CommandRow label="Drop this run" cmd={dropCmd} testId="zerou-cmd-drop" tone="muted" />
          </div>
          {bundle.audit && (
            <div className="mt-4 pt-3 border-t border-warmline/60 text-[11px] text-muted font-mono flex flex-wrap gap-4">
              <span>audit · {bundle.audit.testCases.total} cases</span>
              <span className="text-forest">{bundle.audit.testCases.pass} pass</span>
              {bundle.audit.testCases.fail > 0 && (
                <span className="text-rust">{bundle.audit.testCases.fail} fail</span>
              )}
              {bundle.audit.testCases.inconclusive > 0 && (
                <span className="text-coral">{bundle.audit.testCases.inconclusive} inconclusive</span>
              )}
              {bundle.audit.testCases.skipped > 0 && (
                <span className="text-muted/70">{bundle.audit.testCases.skipped} skipped</span>
              )}
              <span className="ml-auto">{(bundle.audit.durationMs / 1000).toFixed(1)}s</span>
            </div>
          )}
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
