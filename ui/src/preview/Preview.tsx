import { useEffect } from 'react';
import { useStore } from '../store.js';
import { mockStoreFor } from '../mock/data.js';
import {
  mockMultiTurnIdle,
  mockMultiTurnRunning,
  mockMultiTurnFinalizing,
  mockMultiTurnDone,
  mockMultiTurnPaused,
  startMockMultiTurnStream,
} from '../mock/multiTurn.js';
import {
  mockupDrafting,
  mockupReview,
  mockupRevising,
  mockupApproved,
  type MockupPhaseState,
} from '../mock/mockupPhase.js';
import { PreviewIndex } from './PreviewIndex.js';
import { variants, type VariantTrack, type VariantPage } from './variants/index.js';
import { MultiTurnPanel } from '../components/MultiTurnPanel.js';
import { MockupPhasePanel } from '../components/MockupPhasePanel.js';
import { CommitDiffDrawer } from '../components/CommitDiffDrawer.js';
import { RiskBadge } from '../components/RiskBadge.js';
import { CorePathsAlert } from '../components/CorePathsAlert.js';
import { CorePathsConfigEditor } from '../components/CorePathsConfigEditor.js';
import { MilestonesPanel } from '../components/MilestonesPanel.js';
import { SessionResumeBanner } from '../components/SessionResumeBanner.js';
import { smallCommitDiff, mediumCommitDiff } from '../mock/diff.js';
import { mockRiskByCommitSha } from '../mock/risk.js';
import { sampleCorePathHits } from '../mock/corePaths.js';
import { ZerouReview } from '../pages/ZerouReview.js';

export type MultiTurnPreviewState = 'running' | 'paused' | 'finalizing' | 'done' | 'stream';
export type MockupPreviewState = 'drafting' | 'review' | 'revising' | 'approved';

export type GitProKey = 'diff' | 'risk' | 'core-paths-alert' | 'core-paths-config' | 'milestones' | 'resume';

export type PreviewParam =
  | { kind: 'variant'; track: VariantTrack; page: VariantPage }
  | { kind: 'multi-turn'; state: MultiTurnPreviewState }
  | { kind: 'mockup-phase'; state: MockupPreviewState }
  | { kind: 'git-pro'; key: GitProKey }
  | { kind: 'zerou-review' }
  | { kind: 'index' };

/** Parses ?preview=track/page, ?preview=index, ?preview=multi-turn[/state], ?preview=mockup-phase/<state>. */
export function readPreviewParam(): PreviewParam | null {
  if (typeof window === 'undefined') return null;
  const sp = new URLSearchParams(window.location.search);
  const v = sp.get('preview');
  if (!v) return null;
  if (v === 'index' || v === '1' || v === 'true') return { kind: 'index' };
  if (v === 'zerou-review' || v === 'zerou') return { kind: 'zerou-review' };
  const parts = v.split('/');
  const head = parts[0];
  if (head === 'git-pro') {
    const allowed: GitProKey[] = ['diff', 'risk', 'core-paths-alert', 'core-paths-config', 'milestones', 'resume'];
    const key = (parts[1] ?? 'diff') as GitProKey;
    return { kind: 'git-pro', key: allowed.includes(key) ? key : 'diff' };
  }
  if (head === 'multi-turn' || head === 'multiturn') {
    const state = (parts[1] ?? 'stream') as MultiTurnPreviewState;
    const allowed: MultiTurnPreviewState[] = ['running', 'paused', 'finalizing', 'done', 'stream'];
    return { kind: 'multi-turn', state: allowed.includes(state) ? state : 'stream' };
  }
  if (head === 'mockup-phase') {
    const state = (parts[1] ?? 'review') as MockupPreviewState;
    const allowed: MockupPreviewState[] = ['drafting', 'review', 'revising', 'approved'];
    return { kind: 'mockup-phase', state: allowed.includes(state) ? state : 'review' };
  }
  const [track, page] = parts;
  if (!track || !page) return { kind: 'index' };
  if (!['a', 'b', 'c'].includes(track)) return { kind: 'index' };
  if (!['landing', 'setup', 'workspace', 'done', 'settings'].includes(page)) return { kind: 'index' };
  return { kind: 'variant', track: track as VariantTrack, page: page as VariantPage };
}

/** Top-level preview shell. Fills the Zustand store with mock data before
 *  rendering the variant, so individual variant components stay simple and
 *  read from useStore as if a real daemon were behind them. */
export function Preview() {
  const param = readPreviewParam();
  const paramKey = paramToKey(param);

  useEffect(() => {
    if (!param || param.kind === 'index') {
      useStore.setState(mockStoreFor({ empty: true }));
      return;
    }
    if (param.kind === 'multi-turn') {
      useStore.setState({ ...mockStoreFor({ status: 'LOOPING' }), multiTurn: mockMultiTurnIdle });
      let initial = mockMultiTurnIdle;
      if (param.state === 'running') initial = mockMultiTurnRunning;
      else if (param.state === 'paused') initial = mockMultiTurnPaused;
      else if (param.state === 'finalizing') initial = mockMultiTurnFinalizing;
      else if (param.state === 'done') initial = mockMultiTurnDone;
      useStore.setState({ multiTurn: initial });
      if (param.state === 'stream') {
        const stop = startMockMultiTurnStream((s) => useStore.setState({ multiTurn: s }));
        return () => stop();
      }
      return;
    }
    if (param.kind === 'mockup-phase') {
      // mockup-phase preview is fully self-contained — no store required
      return;
    }
    if (param.kind === 'git-pro') {
      // git-pro previews are self-contained — no store required
      return;
    }
    if (param.kind === 'zerou-review') {
      // zerou-review previews are self-contained — no store required
      return;
    }
    const { page } = param;
    if (page === 'landing') {
      useStore.setState(mockStoreFor({ empty: true }));
    } else if (page === 'setup') {
      useStore.setState({ ...mockStoreFor({ status: 'SETUP' }), gaps: [], events: [] });
    } else if (page === 'workspace') {
      useStore.setState(mockStoreFor({ status: 'LOOPING' }));
    } else if (page === 'done') {
      useStore.setState(mockStoreFor({ status: 'DONE' }));
    } else if (page === 'settings') {
      useStore.setState(mockStoreFor({ empty: true }));
    }
  }, [paramKey]);

  if (!param) return null;
  if (param.kind === 'index') return <PreviewIndex />;
  if (param.kind === 'multi-turn') {
    return (
      <div className="h-screen bg-paper text-ink flex flex-col pt-9">
        <MultiTurnPreviewToolbar state={param.state} />
        <PreviewWorkspaceHeader />
        <div className="flex-1 flex overflow-hidden">
          <PreviewGapQueueRail />
          <div className="flex-1 overflow-hidden">
            <MultiTurnPanel onBackToGaps={() => undefined} />
          </div>
        </div>
      </div>
    );
  }
  if (param.kind === 'mockup-phase') {
    const stateMap: Record<MockupPreviewState, MockupPhaseState> = {
      drafting: mockupDrafting,
      review: mockupReview,
      revising: mockupRevising,
      approved: mockupApproved,
    };
    const mockState = stateMap[param.state];
    return (
      <div className="h-screen bg-paper text-ink flex flex-col pt-9 overflow-hidden">
        <MockupPhasePreviewToolbar state={param.state} />
        <div className="flex-1 overflow-hidden bg-paper border border-warmline rounded-lg m-4 shadow-card flex flex-col">
          <MockupPhasePanel
            state={mockState}
            onApprove={() => undefined}
            onRevise={() => undefined}
            onSkip={() => undefined}
          />
        </div>
      </div>
    );
  }
  if (param.kind === 'git-pro') {
    return <GitProPreview previewKey={param.key} />;
  }
  if (param.kind === 'zerou-review') {
    return <ZerouReviewPreview />;
  }
  const Component = variants[param.track][param.page];
  return (
    <div>
      <PreviewToolbar track={param.track} page={param.page} />
      <Component />
    </div>
  );
}

function paramToKey(p: PreviewParam | null): string {
  if (!p) return 'none';
  if (p.kind === 'index') return 'index';
  if (p.kind === 'multi-turn') return `mt/${p.state}`;
  if (p.kind === 'mockup-phase') return `mockup/${p.state}`;
  if (p.kind === 'git-pro') return `git-pro/${p.key}`;
  if (p.kind === 'zerou-review') return 'zerou-review';
  return `${p.track}/${p.page}`;
}

function ZerouReviewPreview() {
  return (
    <div className="min-h-screen bg-paper text-ink pt-9" data-testid="preview-zerou-review">
      <div className="fixed top-0 left-0 right-0 z-50 bg-ink text-cream text-xs px-4 py-1.5 flex items-center justify-between font-mono">
        <span>
          <a href="?preview=index" className="text-cream hover:text-coral">← all variants</a>
          <span className="mx-2 text-cream/40">·</span>
          <span className="text-cream/70">ZeroU · review page</span>
        </span>
        <span className="text-cream/40">mock bundle · meme-weather · no daemon</span>
      </div>
      <ZerouReview source={{ kind: 'preview' }} />
    </div>
  );
}

function PreviewToolbar({ track, page }: { track: VariantTrack; page: VariantPage }) {
  const trackName = { a: 'Editorial', b: 'Console', c: 'Mission Control' }[track];
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-ink text-cream text-xs px-4 py-1.5 flex items-center justify-between font-mono">
      <span>
        <a href="?preview=index" className="text-cream hover:text-coral">← all variants</a>
        <span className="mx-2 text-cream/40">·</span>
        <span className="text-cream/70">track</span> <strong>{track.toUpperCase()} {trackName}</strong>
        <span className="mx-2 text-cream/40">·</span>
        <span className="text-cream/70">page</span> <strong>{page}</strong>
      </span>
      <span className="text-cream/40">
        preview — mock data, no daemon
      </span>
    </div>
  );
}

function PreviewWorkspaceHeader() {
  return (
    <header className="border-b border-warmline bg-cream px-6 py-3 flex items-center justify-between flex-shrink-0">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl tracking-tight">ZeroU</h1>
          <span className="font-mono text-xs text-muted">D:\demos\notes-saas</span>
        </div>
        <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
          <span className="inline-flex px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium bg-forest/15 text-forest">
            LOOPING
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="text-forest flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-forest" /> healthy
        </span>
      </div>
    </header>
  );
}

function PreviewGapQueueRail() {
  return (
    <aside className="w-64 border-r border-warmline bg-paper/50 p-4 flex-shrink-0 overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wider text-muted/70 font-medium mb-2">
        Gap 队列
      </div>
      <ul className="text-sm space-y-1.5">
        <li className="text-coral font-medium">
          <span className="text-[10px] mr-1.5">P1</span>JWT 鉴权 ▶
        </li>
        <li className="text-muted">
          <span className="text-[10px] mr-1.5">P1</span>密码哈希
        </li>
        <li className="text-muted">
          <span className="text-[10px] mr-1.5">P1</span>health 端点
        </li>
        <li className="text-muted">
          <span className="text-[10px] mr-1.5">P2</span>速率限制
        </li>
        <li className="text-muted">
          <span className="text-[10px] mr-1.5">P2</span>结构化日志
        </li>
        <li className="text-forest line-through opacity-60">
          <span className="text-[10px] mr-1.5">P1</span>typecheck
        </li>
        <li className="text-forest line-through opacity-60">
          <span className="text-[10px] mr-1.5">P1</span>README quickstart
        </li>
      </ul>
      <div className="mt-3 text-[10px] text-muted/60 font-mono">
        5 PENDING · 8 DONE
      </div>
    </aside>
  );
}

function MultiTurnPreviewToolbar({ state }: { state: MultiTurnPreviewState }) {
  const STATES: MultiTurnPreviewState[] = ['running', 'paused', 'finalizing', 'done', 'stream'];
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-ink text-cream text-xs px-4 py-1.5 flex items-center justify-between font-mono">
      <span>
        <a href="?preview=index" className="text-cream hover:text-coral">← all variants</a>
        <span className="mx-2 text-cream/40">·</span>
        <span className="text-cream/70">multi-turn 自治</span>
        <span className="mx-2 text-cream/40">·</span>
        {STATES.map((s) => (
          <a
            key={s}
            href={`?preview=multi-turn/${s}`}
            className={`mr-2 ${state === s ? 'text-coral' : 'text-cream/70 hover:text-cream'}`}
          >
            {s}
          </a>
        ))}
      </span>
      <span className="text-cream/40">mock data · 6h cap · no daemon</span>
    </div>
  );
}

function MockupPhasePreviewToolbar({ state }: { state: MockupPreviewState }) {
  const STATES: MockupPreviewState[] = ['drafting', 'review', 'revising', 'approved'];
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-ink text-cream text-xs px-4 py-1.5 flex items-center justify-between font-mono">
      <span>
        <a href="?preview=index" className="text-cream hover:text-coral">← all variants</a>
        <span className="mx-2 text-cream/40">·</span>
        <span className="text-cream/70">mockup-first phase</span>
        <span className="mx-2 text-cream/40">·</span>
        {STATES.map((s) => (
          <a
            key={s}
            href={`?preview=mockup-phase/${s}`}
            className={`mr-2 ${state === s ? 'text-coral' : 'text-cream/70 hover:text-cream'}`}
          >
            {s}
          </a>
        ))}
      </span>
      <span className="text-cream/40">mock data · no daemon</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Git Pro + 长程任务 previews
// ---------------------------------------------------------------------------

const GIT_PRO_KEYS: GitProKey[] = ['diff', 'risk', 'core-paths-alert', 'core-paths-config', 'milestones', 'resume'];

function GitProToolbar({ previewKey }: { previewKey: GitProKey }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-ink text-cream text-xs px-4 py-1.5 flex items-center justify-between font-mono">
      <span>
        <a href="?preview=index" className="text-cream hover:text-coral">← all variants</a>
        <span className="mx-2 text-cream/40">·</span>
        <span className="text-cream/70">git-pro</span>
        <span className="mx-2 text-cream/40">·</span>
        {GIT_PRO_KEYS.map((k) => (
          <a
            key={k}
            href={`?preview=git-pro/${k}`}
            className={`mr-2 ${previewKey === k ? 'text-coral' : 'text-cream/70 hover:text-cream'}`}
          >
            {k}
          </a>
        ))}
      </span>
      <span className="text-cream/40">mock data · agent-game-platform · no daemon</span>
    </div>
  );
}

function GitProPreview({ previewKey }: { previewKey: GitProKey }) {
  const risk4944 = mockRiskByCommitSha['4944fba'];
  const risk22a7 = mockRiskByCommitSha['22a7654'];
  const riskC5ee = mockRiskByCommitSha['c5eeedb'];

  return (
    <div className="min-h-screen bg-paper text-ink pt-9" data-testid={`preview-git-pro-${previewKey}`}>
      <GitProToolbar previewKey={previewKey} />

      {previewKey === 'diff' && (
        <div className="relative" style={{ height: 'calc(100vh - 36px)' }}>
          <CommitDiffDrawer
            sha="4944fbae31e4dc5103303c905b9b802f7e45416a"
            message="feat(polish): Mode A iter-2 §5 — achievements + events + themes (FINAL)"
            files={mediumCommitDiff}
            risk={risk4944}
            onClose={() => window.history.back()}
          />
        </div>
      )}

      {previewKey === 'risk' && (
        <div className="max-w-2xl mx-auto py-10 px-8 space-y-6">
          <h2 className="text-2xl font-medium mb-6">Risk Badges — 3 band samples</h2>
          <div className="space-y-4">
            {risk22a7 && (
              <div className="bg-cream rounded-xl px-5 py-4 shadow-card ring-1 ring-warmline/60 flex items-start gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink mb-1">22a7654 · highlight classifier + friend-watch rooms</div>
                  <div className="text-xs text-muted/70 mb-2">feat(watch): Mode A iter-2 §4 · 7 files · +979/-48</div>
                </div>
                <RiskBadge risk={risk22a7} />
              </div>
            )}
            {risk4944 && (
              <div className="bg-cream rounded-xl px-5 py-4 shadow-card ring-1 ring-warmline/60 flex items-start gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink mb-1">4944fba · achievements + events + themes</div>
                  <div className="text-xs text-muted/70 mb-2">feat(polish): Mode A iter-2 §5 · 13 files · +1212/-63</div>
                </div>
                <RiskBadge risk={risk4944} />
              </div>
            )}
            {riskC5ee && (
              <div className="bg-cream rounded-xl px-5 py-4 shadow-card ring-1 ring-rust/30 ring-2 flex items-start gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink mb-1">c5eeedb · agent self-routing scoring</div>
                  <div className="text-xs text-muted/70 mb-2">feat(agents): Mode A iter-2 §3 · 6 files · +815/-1</div>
                </div>
                <RiskBadge risk={riskC5ee} />
              </div>
            )}
          </div>
        </div>
      )}

      {previewKey === 'core-paths-alert' && (
        <div className="flex items-center justify-center h-full" style={{ minHeight: 'calc(100vh - 36px)' }}>
          <div className="text-sm text-muted text-center">
            CorePathsAlert 弹出演示
          </div>
          <CorePathsAlert
            hits={sampleCorePathHits}
            onAllow={() => alert('演示：允许 merge')}
            onVeto={() => alert('演示：否决 merge')}
          />
        </div>
      )}

      {previewKey === 'core-paths-config' && (
        <div className="relative" style={{ height: 'calc(100vh - 36px)' }}>
          <div className="h-full flex items-center justify-center text-muted text-sm">
            <span>CorePathsConfigEditor 抽屉 — 从右侧展开</span>
          </div>
          <CorePathsConfigEditor onClose={() => undefined} />
        </div>
      )}

      {previewKey === 'milestones' && (
        <div className="max-w-5xl mx-auto py-10 px-4" data-testid="preview-milestones">
          <h2 className="text-2xl font-medium mb-6 px-2">Milestones Panel</h2>
          <div className="bg-cream rounded-2xl shadow-card ring-1 ring-warmline/60 overflow-hidden">
            <MilestonesPanel />
          </div>
        </div>
      )}

      {previewKey === 'resume' && (
        <div className="max-w-2xl mx-auto pt-10 px-8">
          <h2 className="text-2xl font-medium mb-6">Session Resume Banner</h2>
          <div className="bg-paper rounded-xl overflow-hidden shadow-card ring-1 ring-warmline/60">
            <SessionResumeBanner
              gapTitle="agent self-routing scoring (iter-2 §3)"
              gapSlug="agent-self-routing-scoring"
              pausedHoursAgo={3}
              onResume={() => undefined}
              onDiscard={() => undefined}
              onLater={() => undefined}
            />
            <div className="p-6 text-sm text-muted italic">
              （下方是 Workspace 主内容区域占位）
            </div>
          </div>

          {/* Also show the small commit diff inline for easy review */}
          <div className="mt-8">
            <h3 className="text-lg font-medium mb-4">Small commit diff (22a7654 · watch-room.ts)</h3>
            <div className="bg-cream rounded-xl shadow-card ring-1 ring-warmline/60 overflow-hidden">
              <CommitDiffDrawer
                sha="22a7654acd3a9466d36903fed4bdf8e658d61f9c"
                message="feat(watch): Mode A iter-2 §4 — highlight classifier + friend-watch rooms"
                files={smallCommitDiff}
                risk={risk22a7}
                onClose={() => undefined}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
