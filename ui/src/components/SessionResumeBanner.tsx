/** Mock resume mark for demo mode.
 *  Non-null = there's a session to resume. */
export const mockResumeMark = {
  gapSlug: 'agent-self-routing-scoring',
  gapTitle: 'agent self-routing scoring (iter-2 §3)',
  pausedHoursAgo: 3,
};

interface SessionResumeBannerProps {
  gapTitle: string;
  gapSlug: string;
  pausedHoursAgo: number;
  onResume: () => void;
  onDiscard: () => void;
  onLater: () => void;
}

/** Top banner shown when ZeroU detects a previously interrupted session.
 *  Animates in from the top (anim-drift-in). */
export function SessionResumeBanner({
  gapTitle,
  pausedHoursAgo,
  onResume,
  onDiscard,
  onLater,
}: SessionResumeBannerProps) {
  return (
    <div
      className="bg-coralsoft border-b border-coral/20 px-5 py-2.5 flex items-center gap-3 flex-shrink-0 anim-drift-in"
      data-testid="session-resume-banner"
      role="alert"
    >
      <span className="text-coral text-sm flex-shrink-0">⏱</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-ink">
          上次你在 gap{' '}
          <span className="font-medium text-coral">«{gapTitle}»</span>
          {' '}中断 {pausedHoursAgo} 小时前，要继续吗？
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onResume}
          className="text-xs px-3 py-1.5 bg-coral text-cream rounded-lg hover:bg-coral/90 font-sans font-medium transition-colors"
          data-testid="resume-continue"
        >
          继续
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="text-xs px-3 py-1.5 text-rust border border-rust/30 rounded-lg hover:bg-rust/10 font-sans transition-colors"
          data-testid="resume-discard"
        >
          放弃这个 gap
        </button>
        <button
          type="button"
          onClick={onLater}
          className="text-xs px-3 py-1.5 text-muted hover:text-ink font-sans transition-colors"
          data-testid="resume-later"
        >
          稍后
        </button>
      </div>
    </div>
  );
}
