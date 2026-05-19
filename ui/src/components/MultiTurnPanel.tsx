import { useState } from 'react';
import type { MultiTurnState, MultiTurnPhase, MultiTurnTurn } from '../types.js';
import { useStore } from '../store.js';
import { Button } from './Button.js';

function fmtMinutes(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${total} 秒`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

type HealthBand = 'green' | 'yellow' | 'red';

function judgeHealth(mt: MultiTurnState): HealthBand {
  if (mt.phase === 'done') return 'green';
  if (mt.phase === 'paused') return 'yellow';
  const turnRatio = mt.maxTurns > 0 ? mt.currentTurn / mt.maxTurns : 0;
  const timeRatio = mt.capMs > 0 ? mt.elapsedMs / mt.capMs : 0;
  const ratio = Math.max(turnRatio, timeRatio);
  if (ratio < 0.6) return 'green';
  if (ratio < 0.85) return 'yellow';
  return 'red';
}

function narrative(mt: MultiTurnState): { headline: string; verdict: string; band: HealthBand } {
  const band = judgeHealth(mt);
  if (mt.phase === 'done') {
    return { headline: 'ZeroU 修完了', verdict: '已合并到 main · 看一眼改了啥', band: 'green' };
  }
  if (mt.phase === 'finalizing') {
    return {
      headline: 'ZeroU 说写完了',
      verdict: 'reviewer 正在帮你验证 · 一般 1-2 分钟出结果',
      band: 'green',
    };
  }
  if (mt.phase === 'paused') {
    return {
      headline: 'ZeroU 暂停了',
      verdict: '点「继续」让它接着跑，或点「中止」放弃这次修复',
      band: 'yellow',
    };
  }
  if (band === 'green') {
    return { headline: 'ZeroU 正在帮你修', verdict: '进展正常，不用管', band };
  }
  if (band === 'yellow') {
    return {
      headline: 'ZeroU 正在帮你修',
      verdict: '跑得有点久了，可以再等等，也可以暂停看看进度',
      band,
    };
  }
  return {
    headline: 'ZeroU 卡住了',
    verdict: '快到上限了，建议暂停看看；继续可能浪费 token',
    band,
  };
}

const BAND_STYLE: Record<HealthBand, { bar: string; text: string; dot: string; border: string }> = {
  green: { bar: 'bg-forest', text: 'text-forest', dot: 'bg-forest', border: 'border-forest/40' },
  yellow: { bar: 'bg-coral', text: 'text-coral', dot: 'bg-coral', border: 'border-coral/40' },
  red: { bar: 'bg-rust', text: 'text-rust', dot: 'bg-rust', border: 'border-rust/40' },
};

const PHASE_LABEL: Record<MultiTurnPhase, string> = {
  idle: '待命',
  running: '进行中',
  paused: '暂停',
  finalizing: '收尾',
  done: '完成',
};

/** Helper for App layout — true when MultiTurnPanel should take over the
 *  Workspace main column. */
export function isMultiTurnActive(mt: MultiTurnState | null): boolean {
  return !!mt && mt.complexity === 'complex' && mt.phase !== 'idle';
}

export function MultiTurnPanel({ onBackToGaps }: { onBackToGaps?: () => void } = {}) {
  const mt = useStore((s) => s.multiTurn);
  const [showDetails, setShowDetails] = useState(false);

  if (!mt || mt.phase === 'idle' || mt.complexity !== 'complex') return null;

  const { headline, verdict, band } = narrative(mt);
  const style = BAND_STYLE[band];
  const timeFraction = mt.capMs > 0 ? Math.min(1, mt.elapsedMs / mt.capMs) : 0;

  return (
    <div className="h-full overflow-y-auto" data-testid="multi-turn-panel">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        {/* Top bar — gap title + back link */}
        <div className="flex items-center justify-between">
          {onBackToGaps && (
            <button
              type="button"
              onClick={onBackToGaps}
              className="text-xs font-sans text-muted hover:text-ink transition-colors"
              data-testid="multi-turn-back-to-gaps"
            >
              ← 返回 gap 队列
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <span
              className={`inline-block w-2 h-2 rounded-full ${style.dot} ${
                mt.phase === 'running' ? 'anim-breathe-dot' : ''
              }`}
              data-testid="multi-turn-health-dot"
            />
            <span
              className={`inline-flex px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium font-sans bg-paper ${style.text}`}
              data-testid="multi-turn-phase"
            >
              {PHASE_LABEL[mt.phase]}
            </span>
          </div>
        </div>

        {/* Status card + Timeline side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className={`card border-l-4 ${style.border} lg:col-span-3 self-start`}>
          <div className="p-5 space-y-3">
            <div className="text-lg font-medium text-ink" data-testid="multi-turn-headline">
              {headline}
            </div>
            <div className="text-sm text-muted" data-testid="multi-turn-gap">
              <span className="text-muted/60">任务：</span>
              {mt.gapTitle}
            </div>

            {mt.lastAssistantText && mt.phase !== 'done' && (
              <div className="bg-paper border-l-2 border-warmline pl-3 py-1.5 text-sm text-ink/80 italic">
                <span className="text-[10px] uppercase tracking-wider text-muted/70 not-italic font-sans mr-2">
                  ZeroU 说
                </span>
                <span data-testid="multi-turn-last-text">{mt.lastAssistantText}</span>
              </div>
            )}

            {(mt.phase === 'running' || mt.phase === 'finalizing') && (
              <div>
                <div className="flex items-center justify-between text-xs font-sans text-muted/70 mb-1">
                  <span>
                    第 {mt.currentTurn} 轮 · 已跑 {fmtMinutes(mt.elapsedMs)}
                  </span>
                  <span>上限 {fmtMinutes(mt.capMs)}</span>
                </div>
                <div className="h-1.5 bg-warmline rounded overflow-hidden">
                  <div
                    className={`h-full ${style.bar} transition-all duration-700 ease-out-quart`}
                    style={{ width: `${Math.round(timeFraction * 100)}%` }}
                    data-testid="multi-turn-progress-bar"
                  />
                </div>
              </div>
            )}

            <div className={`text-sm ${style.text}`} data-testid="multi-turn-verdict">
              {verdict}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex gap-2">
                {mt.phase === 'running' && (
                  <>
                    <Button variant="secondary" onClick={() => undefined}>暂停</Button>
                    <Button variant="ghost" onClick={() => undefined}>中止</Button>
                  </>
                )}
                {mt.phase === 'paused' && (
                  <>
                    <Button variant="primary" onClick={() => undefined}>继续</Button>
                    <Button variant="ghost" onClick={() => undefined}>中止</Button>
                  </>
                )}
                {mt.phase === 'done' && (
                  <Button variant="ghost" onClick={() => undefined}>看改动</Button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-muted hover:text-ink transition-colors font-sans"
                aria-expanded={showDetails}
                data-testid="multi-turn-details-toggle"
              >
                {showDetails ? '收起细节 ▴' : '展开细节 ▾'}
              </button>
            </div>

            {/* Detail drawer — inside status card, right under the toggle button */}
            {showDetails && (
              <div className="pt-3 mt-1 border-t border-warmline space-y-3 text-xs font-sans">
                <div className="grid grid-cols-3 gap-3">
                  <DetailStat label="轮次" value={`${mt.currentTurn} / ${mt.maxTurns}`} />
                  <DetailStat
                    label="token (in / out)"
                    value={`${fmtTokens(mt.tokensIn)} / ${fmtTokens(mt.tokensOut)}`}
                  />
                  <DetailStat
                    label="估算花费"
                    value={fmtUsd(mt.estimatedUsd)}
                    hint={mt.ccSessionId ? '续接 session' : '新 session'}
                  />
                </div>
                {mt.scratchpad.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted font-medium mb-1">
                      ZeroU 自己记的笔记 · {mt.scratchpad.length} 条
                    </div>
                    <ul
                      className="space-y-1 max-h-40 overflow-y-auto font-mono text-xs border border-warmline rounded p-2 bg-paper"
                      data-testid="multi-turn-scratchpad"
                    >
                      {mt.scratchpad
                        .slice()
                        .reverse()
                        .map((n, idx) => (
                          <li key={`${n.turn}-${n.ts}-${idx}`} className="flex gap-2">
                            <span className="text-muted/60 flex-shrink-0">第{n.turn}轮</span>
                            <span className="text-ink/80 whitespace-pre-wrap">{n.text}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Turn timeline — right column */}
        <div className="lg:col-span-2 self-start">
          <TurnTimeline turns={mt.turns} />
        </div>
        </div>
      </div>
    </div>
  );
}

function TurnTimeline({ turns }: { turns: MultiTurnTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="text-sm text-muted italic font-serif px-2">
        ZeroU 还没开始干活…
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="multi-turn-timeline">
      <div className="text-[10px] uppercase tracking-wider text-muted font-medium font-sans px-2">
        自治过程 · {turns.length} 轮
      </div>
      <ol className="space-y-2">
        {turns.map((t, idx) => {
          const isLast = idx === turns.length - 1;
          return (
            <li
              key={t.index}
              className="flex gap-3 items-start anim-stagger"
              style={{ ['--i' as 'width']: idx as unknown as string }}
              data-testid={`multi-turn-step-${t.index}`}
            >
              <div className="flex flex-col items-center flex-shrink-0 pt-1">
                <TurnDot status={t.status} />
                {!isLast && <div className="w-px flex-1 bg-warmline min-h-[20px] mt-1" />}
              </div>
              <div className="flex-1 pb-2">
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-mono text-muted/70 flex-shrink-0">T{t.index}</span>
                  <span className="text-sm text-ink">{t.title}</span>
                  <TurnStatusLabel status={t.status} />
                </div>
                <div className="text-xs text-muted pl-7 mt-0.5">{t.summary}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TurnDot({ status }: { status: MultiTurnTurn['status'] }) {
  if (status === 'done') {
    return (
      <div className="w-4 h-4 rounded-full bg-forest text-cream flex items-center justify-center text-[9px]">
        ✓
      </div>
    );
  }
  if (status === 'running') {
    return <div className="w-4 h-4 rounded-full bg-coral animate-pulse" />;
  }
  return <div className="w-4 h-4 rounded-full border-2 border-warmline" />;
}

function TurnStatusLabel({ status }: { status: MultiTurnTurn['status'] }) {
  if (status === 'done') return <span className="text-[10px] text-forest font-sans">完成</span>;
  if (status === 'running')
    return <span className="text-[10px] text-coral font-sans animate-pulse">进行中</span>;
  return <span className="text-[10px] text-muted/60 font-sans">待开始</span>;
}

function DetailStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-muted/70 font-medium">{label}</div>
      <div className="text-sm font-mono text-ink">{value}</div>
      {hint && <div className="text-[10px] text-muted/60">{hint}</div>}
    </div>
  );
}
