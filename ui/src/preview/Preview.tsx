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
import { PreviewIndex } from './PreviewIndex.js';
import { variants, type VariantTrack, type VariantPage } from './variants/index.js';
import { MultiTurnPanel } from '../components/MultiTurnPanel.js';

export type MultiTurnPreviewState = 'running' | 'paused' | 'finalizing' | 'done' | 'stream';

export type PreviewParam =
  | { kind: 'variant'; track: VariantTrack; page: VariantPage }
  | { kind: 'multi-turn'; state: MultiTurnPreviewState }
  | { kind: 'index' };

/** Parses ?preview=track/page, ?preview=index, ?preview=multi-turn[/state]. */
export function readPreviewParam(): PreviewParam | null {
  if (typeof window === 'undefined') return null;
  const sp = new URLSearchParams(window.location.search);
  const v = sp.get('preview');
  if (!v) return null;
  if (v === 'index' || v === '1' || v === 'true') return { kind: 'index' };
  const parts = v.split('/');
  const head = parts[0];
  if (head === 'multi-turn' || head === 'multiturn') {
    const state = (parts[1] ?? 'stream') as MultiTurnPreviewState;
    const allowed: MultiTurnPreviewState[] = ['running', 'paused', 'finalizing', 'done', 'stream'];
    return { kind: 'multi-turn', state: allowed.includes(state) ? state : 'stream' };
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
  return `${p.track}/${p.page}`;
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
          <h1 className="text-xl tracking-tight">d2p</h1>
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
