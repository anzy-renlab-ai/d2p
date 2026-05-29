import { useEffect } from 'react';
import { bootstrap, useStore } from './store.js';
import { HealthBadge } from './components/HealthBadge.js';
import { Landing } from './pages/Landing.js';
import { Setup } from './pages/Setup.js';
import { Workspace } from './pages/Workspace.js';
import { Done } from './pages/Done.js';
import { Settings } from './pages/Settings.js';
import { Preview, readPreviewParam } from './preview/Preview.js';
import { SessionsList } from './components/SessionsList.js';
import { ZerouReview, readReviewParam } from './pages/ZerouReview.js';

export function App() {
  // ZeroU review mode short-circuits everything else when ?review=... is set.
  // It reads the bundle from window.__ZEROU_DATA__ (server-injected),
  // /api/review-data.json (live daemon), or the mock (preview).
  const reviewParam = readReviewParam();
  // Preview mode short-circuits production routing entirely — no daemon poll,
  // no SSE, no real session — so designers can iterate offline.
  const previewParam = readPreviewParam();
  useEffect(() => {
    if (reviewParam || previewParam) return; // skip bootstrap in review/preview
    return bootstrap();
  }, [reviewParam, previewParam]);
  if (reviewParam) return <ZerouReview source={reviewParam} />;
  if (previewParam) return <Preview />;

  const session = useStore((s) => s.session);
  const summaryMdPath = useStore((s) => s.summaryMdPath);
  const health = useStore((s) => s.health);
  const showSettings = useStore((s) => s.showSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const demoMode = useStore((s) => s.multiTurnDemoMode);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectedSessionId = useStore((s) => s.selectedSessionId);

  if (showSettings) {
    return <Settings onClose={() => setShowSettings(false)} />;
  }

  // An ENDED session is shown as Done ONLY when the user just ended it in this
  // UI lifetime (summaryMdPath was set by endSession()). Otherwise — e.g. user
  // reloaded the page after a session ended weeks ago — route to Landing so
  // they can start fresh. Prevents the daemon's "latest session" fallback
  // from trapping the UI on a stale Done page.
  const isTerminalAndStale =
    session && (session.status === 'ENDED' || session.status === 'DONE') && !summaryMdPath;

  // Multi-project routing:
  //   default                                          → Landing (ProjectsHome)
  //   selectedProjectId set, no selectedSessionId      → SessionsList
  //   selectedProjectId + selectedSessionId set        → Workspace (real session)
  //   demoMode                                         → Workspace (mock canvas)
  //   Real session flows (SETUP / DONE) still pick up when daemon has them.
  let body;
  if (demoMode) {
    body = <Workspace />;
  } else if (selectedProjectId == null) {
    body = <Landing />;
  } else if (selectedSessionId == null) {
    body = <SessionsList />;
  } else if (!session || isTerminalAndStale) {
    body = <Workspace />;
  } else if (session.status === 'SETUP') {
    body = <Setup />;
  } else if (session.status === 'LOOPING' || session.status === 'PAUSED') {
    body = <Workspace />;
  } else {
    body = <Done />;
  }

  return (
    <div className="min-h-screen bg-paper bg-grid-faint text-ink">
      {(!session || session.status === 'SETUP' || session.status === 'DONE' || session.status === 'ENDED') && (
        <div className="absolute top-4 right-6 z-10 flex items-center gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs text-muted hover:text-ink transition-colors"
          >
            ⚙ 设置
          </button>
          <HealthBadge />
        </div>
      )}
      {body}
      {health?.ok && !session && (
        <div className="fixed bottom-3 right-4 text-[10px] text-muted/60 font-mono">
          daemon v{health.daemonVersion} · prompts v{health.promptsVersion}
        </div>
      )}
    </div>
  );
}
