import { useState } from 'react';
import type { MockupPhaseState, MockupPage } from '../mock/mockupPhase.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageThumbnail({
  page,
  active,
  onClick,
}: {
  page: MockupPage;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`mockup-thumb-${page.name}`}
      className={`w-full text-left rounded-lg border transition-all duration-150 overflow-hidden ${
        active
          ? 'border-coral shadow-glow bg-coralsoft/20'
          : 'border-warmline bg-cream hover:border-coral/50 hover:bg-coralsoft/10'
      }`}
    >
      {/* Tiny preview */}
      <div className="w-full aspect-[4/3] bg-paper border-b border-warmline overflow-hidden">
        {page.htmlPreviewSrc ? (
          <iframe
            src={page.htmlPreviewSrc}
            title={`${page.title} thumbnail`}
            className="w-[400%] h-[400%] origin-top-left pointer-events-none"
            style={{ transform: 'scale(0.25)' }}
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-warmline border-t-coral animate-spin" />
          </div>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className={`text-xs font-medium truncate ${active ? 'text-coral' : 'text-ink'}`}>
          {page.title}
        </div>
        <div className="text-[10px] text-muted font-mono truncate">{page.route}</div>
      </div>
    </button>
  );
}

function RevisionMask({ feedback }: { feedback: string | null }) {
  return (
    <div
      data-testid="mockup-revising-mask"
      className="absolute inset-0 bg-paper/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-lg"
    >
      <div className="w-8 h-8 rounded-full border-2 border-warmline border-t-coral animate-spin mb-4" />
      <div className="text-sm font-medium text-ink text-center px-4">
        正在按你的建议重画…
      </div>
      {feedback && (
        <div className="mt-2 text-xs text-muted max-w-xs text-center leading-relaxed bg-cream border border-warmline rounded-lg px-3 py-2">
          "{feedback}"
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase: drafting
// ---------------------------------------------------------------------------

function DraftingView({ state }: { state: MockupPhaseState }) {
  return (
    <div
      data-testid="mockup-phase-panel"
      className="flex flex-col items-center justify-center py-16 px-8 text-center"
    >
      <div
        data-testid="mockup-drafting-spinner"
        className="w-10 h-10 rounded-full border-2 border-warmline border-t-coral animate-spin mb-6"
      />
      <h2 className="text-lg font-medium text-ink mb-2" data-testid="mockup-drafting-headline">
        ZeroU 正在为你画产品成品的样子…
      </h2>
      <p className="text-sm text-muted" data-testid="mockup-drafting-progress">
        已经画好{' '}
        <span className="font-medium text-ink tabular-nums">{state.pages.length}</span>
        {' / '}
        <span className="font-medium text-ink tabular-nums">{state.totalPages}</span>
        {' '}页
      </p>
      <p className="text-xs text-muted/70 mt-4 max-w-sm leading-relaxed">
        画好后你可以审一眼，确认方向对了再正式找 gap、改代码。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase: review / revising (shared layout)
// ---------------------------------------------------------------------------

function ReviewView({
  state,
  onApprove,
  onRevise,
  onSkip,
}: {
  state: MockupPhaseState;
  onApprove?: () => void;
  onRevise?: (feedback: string) => void;
  onSkip?: () => void;
}) {
  const [activePage, setActivePage] = useState(0);
  const [reviseMode, setReviseMode] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const current = state.pages[activePage] ?? state.pages[0];
  const isRevising = state.phase === 'revising';

  return (
    <div
      data-testid="mockup-phase-panel"
      className="flex flex-col h-full min-h-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-warmline flex-shrink-0">
        <div>
          <h2 className="text-sm font-medium text-ink" data-testid="mockup-review-headline">
            {isRevising ? '正在按你的建议重画…' : '这是 ZeroU 帮你画的产品预期'}
          </h2>
          <p className="text-xs text-muted mt-0.5">
            {state.pages.length} 个页面 · saas-web 类型 · 对齐后进 differ 找 gap
          </p>
        </div>
        <div
          className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${
            isRevising
              ? 'bg-amber-50 text-amber-600 border border-amber-100'
              : 'bg-coralsoft text-coral border border-coral/20'
          }`}
          data-testid="mockup-phase-badge"
        >
          {isRevising ? 'revising' : 'review'}
        </div>
      </div>

      {/* Body: sidebar + main preview */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Revising overlay */}
        {isRevising && <RevisionMask feedback={state.userFeedback} />}

        {/* Thumbnail sidebar */}
        <aside
          className="w-44 flex-shrink-0 border-r border-warmline bg-paper/50 overflow-y-auto p-3 flex flex-col gap-2"
          data-testid="mockup-page-nav"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-medium mb-1">
            页面
          </div>
          {state.pages.map((page, i) => (
            <PageThumbnail
              key={page.name}
              page={page}
              active={i === activePage}
              onClick={() => setActivePage(i)}
            />
          ))}
        </aside>

        {/* Main iframe */}
        <div className="flex-1 flex flex-col min-h-0 bg-paper">
          {current?.htmlPreviewSrc ? (
            <iframe
              key={current.name}
              src={current.htmlPreviewSrc}
              title={current.title}
              className="flex-1 w-full border-0"
              sandbox="allow-same-origin"
              data-testid="mockup-iframe"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-muted text-sm">正在生成…</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex-shrink-0 border-t border-warmline bg-cream px-5 py-3">
        {/* Page description strip */}
        {current && (
          <div className="text-xs text-muted mb-3 flex items-baseline gap-2">
            <span className="font-medium text-ink">{current.title}</span>
            <span className="font-mono text-muted/70">{current.route}</span>
            <span>—</span>
            <span>{current.description}</span>
          </div>
        )}

        {reviseMode ? (
          <div className="flex flex-col gap-2" data-testid="mockup-revise-form">
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="告诉 ZeroU 你想改什么，比如「侧边栏太宽了」、「首页 CTA 换成橙色」…"
              className="w-full text-sm border border-warmline rounded-lg px-3 py-2 bg-paper resize-none focus:outline-none focus:border-coral"
              rows={3}
              data-testid="mockup-feedback-input"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (feedbackText.trim()) onRevise?.(feedbackText.trim());
                  setReviseMode(false);
                  setFeedbackText('');
                }}
                disabled={!feedbackText.trim()}
                className="px-4 py-1.5 rounded-md bg-coral text-cream text-sm font-medium disabled:opacity-40 hover:bg-coralhover transition-colors"
                data-testid="mockup-revise-submit"
              >
                提交建议
              </button>
              <button
                type="button"
                onClick={() => { setReviseMode(false); setFeedbackText(''); }}
                className="px-4 py-1.5 rounded-md border border-warmline bg-cream text-ink text-sm hover:bg-paper transition-colors"
                data-testid="mockup-revise-cancel"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2" data-testid="mockup-action-bar">
            <button
              type="button"
              onClick={onApprove}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-forest text-cream text-sm font-medium hover:opacity-90 transition-opacity"
              data-testid="mockup-approve-btn"
            >
              <span>✓</span> 这就是我想要的
            </button>
            <button
              type="button"
              onClick={() => setReviseMode(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md border border-warmline bg-cream text-ink text-sm hover:bg-paper transition-colors"
              data-testid="mockup-revise-btn"
            >
              <span>✎</span> 我想改一下
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="ml-auto px-4 py-1.5 rounded-md border border-warmline/60 text-muted text-sm hover:bg-paper transition-colors"
              data-testid="mockup-skip-btn"
            >
              → 跳过这步
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase: approved
// ---------------------------------------------------------------------------

function ApprovedView({ state }: { state: MockupPhaseState }) {
  return (
    <div
      data-testid="mockup-phase-panel"
      className="flex flex-col"
    >
      {/* Compact approved banner */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-warmline">
        <span className="text-forest text-lg">✓</span>
        <div>
          <div className="text-sm font-medium text-ink" data-testid="mockup-approved-headline">
            已对齐预期 · differ 正在按这个目标找 gap…
          </div>
          {state.approvedAt && (
            <div className="text-xs text-muted mt-0.5">
              你在 {fmtTime(state.approvedAt)} 点头确认了这版 mockup
            </div>
          )}
        </div>
      </div>

      {/* Thumbnail row */}
      <div className="flex gap-3 p-5" data-testid="mockup-approved-thumbs">
        {state.pages.map((page) => (
          <div
            key={page.name}
            className="flex-1 max-w-[200px] rounded-lg border border-warmline overflow-hidden"
            data-testid={`mockup-approved-thumb-${page.name}`}
          >
            <div className="aspect-[4/3] bg-paper overflow-hidden">
              {page.htmlPreviewSrc && (
                <iframe
                  src={page.htmlPreviewSrc}
                  title={`${page.title} approved`}
                  className="w-[400%] h-[400%] origin-top-left pointer-events-none"
                  style={{ transform: 'scale(0.25)' }}
                  sandbox="allow-same-origin"
                />
              )}
            </div>
            <div className="px-2.5 py-1.5 bg-cream">
              <div className="text-xs font-medium text-ink truncate">{page.title}</div>
              <div className="text-[10px] text-muted font-mono truncate">{page.route}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 pb-4">
        <p className="text-xs text-muted leading-relaxed">
          differ 会把这 {state.pages.length} 个页面的目标意图作为额外输入，找出与现有代码之间的 gap，比单纯靠 vision 文字更精准。
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export type MockupPhasePanelProps = {
  state: MockupPhaseState;
  onApprove?: () => void;
  onRevise?: (feedback: string) => void;
  onSkip?: () => void;
};

/**
 * MockupPhasePanel — renders one of 4 layouts based on state.phase:
 *   drafting  | review | revising | approved
 */
export function MockupPhasePanel({ state, onApprove, onRevise, onSkip }: MockupPhasePanelProps) {
  switch (state.phase) {
    case 'drafting':
      return <DraftingView state={state} />;
    case 'review':
      return <ReviewView state={state} onApprove={onApprove} onRevise={onRevise} onSkip={onSkip} />;
    case 'revising':
      return <ReviewView state={state} onApprove={onApprove} onRevise={onRevise} onSkip={onSkip} />;
    case 'approved':
      return <ApprovedView state={state} />;
    default:
      return null;
  }
}
