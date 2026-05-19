import { useState } from 'react';
import { useStore } from '../store.js';
import { useLocale } from '../i18n/useLocale.js';
import { Button } from '../components/Button.js';
import { ArchitecturalAlert } from '../components/ArchitecturalAlert.js';
import { PresetOverrideEditor } from '../components/PresetOverrideEditor.js';
import { HealthBadge } from '../components/HealthBadge.js';
import { MultiTurnPanel, isMultiTurnActive } from '../components/MultiTurnPanel.js';
import { SessionsBoard } from '../components/SessionsBoard.js';
import { CommitsTimeline } from '../components/CommitsTimeline.js';
import { StatusStrip } from '../components/StatusStrip.js';
import { SessionResumeBanner, mockResumeMark } from '../components/SessionResumeBanner.js';

export function Workspace() {
  const { t } = useLocale();
  const session = useStore((s) => s.session);
  const demo = useStore((s) => s.demo);
  const loopState = useStore((s) => s.loopState);
  const multiTurn = useStore((s) => s.multiTurn);
  const pauseLoop = useStore((s) => s.pauseLoop);
  const resumeLoop = useStore((s) => s.resumeLoop);
  const endSession = useStore((s) => s.endSession);

  const setShowSettings = useStore((s) => s.setShowSettings);
  const demoMode = useStore((s) => s.multiTurnDemoMode);
  const startDemoStream = useStore((s) => s.startMultiTurnDemoStream);
  const stopDemo = useStore((s) => s.stopMultiTurnDemo);
  const setSelectedProjectId = useStore((s) => s.setSelectedProjectId);
  const isPaused = session?.status === 'PAUSED';
  const isLooping = session?.status === 'LOOPING';
  const isPausing = loopState?.pauseRequested === true && loopState?.isRunning === true;

  // When a complex gap is running, the multi-turn panel takes over the main
  // canvas. User can press "← 返回 gap 队列" to peek at the gap list/run log.
  const mtActive = isMultiTurnActive(multiTurn);
  const [forceShowQueue, setForceShowQueue] = useState(false);
  const showMultiTurnFullscreen = mtActive && !forceShowQueue;

  // Demo-mode resume mark — shows SessionResumeBanner at top when non-null.
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const showResumeBanner = demoMode && !resumeDismissed && mockResumeMark !== null;

  return (
    <div className="h-screen flex flex-col bg-paper">
      <header className="border-b border-warmline bg-cream px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (demoMode) stopDemo();
              setSelectedProjectId(null);
            }}
            className="text-xs text-muted hover:text-ink transition-colors font-sans"
            title={t('workspace.demoBack')}
          >
            {t('workspace.backToProjects')}
          </button>
          <div className="w-px h-6 bg-warmline" />
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-xl tracking-tight">d2p</h1>
              <span className="font-mono text-xs text-muted truncate max-w-md" title={demo?.path}>
                {demo?.path}
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
              <StatusPill status={session?.status} />
              {isPausing && <span className="text-coral">{t('workspace.pausingInline')}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HealthBadge />
          <div className="w-px h-5 bg-warmline mx-1" />
          {isLooping && (
            <Button variant="secondary" onClick={() => void pauseLoop()} disabled={isPausing}>
              {isPausing ? t('workspace.pausing') : t('workspace.pause')}
            </Button>
          )}
          {isPaused && (
            <Button variant="primary" onClick={() => void resumeLoop()}>
              {t('workspace.resume')}
            </Button>
          )}
          {demoMode && !showMultiTurnFullscreen && !mtActive && (
            <Button variant="secondary" onClick={() => startDemoStream()}>
              {t('workspace.tryMultiTurn')}
            </Button>
          )}
          {demoMode && <Button variant="ghost" onClick={() => stopDemo()}>{t('workspace.exitDemo')}</Button>}
          <Button variant="ghost" onClick={() => setShowSettings(true)}>{t('workspace.settings')}</Button>
          <Button variant="ghost" onClick={() => void endSession()}>{t('workspace.endSession')}</Button>
        </div>
      </header>
      {demoMode && (
        <div className="bg-coral/10 border-b border-coral/30 text-coral text-xs font-sans px-6 py-1.5 text-center">
          {t('workspace.demoBanner')}
        </div>
      )}
      {showResumeBanner && mockResumeMark && (
        <SessionResumeBanner
          gapTitle={mockResumeMark.gapTitle}
          gapSlug={mockResumeMark.gapSlug}
          pausedHoursAgo={mockResumeMark.pausedHoursAgo}
          onResume={() => setResumeDismissed(true)}
          onDiscard={() => setResumeDismissed(true)}
          onLater={() => setResumeDismissed(true)}
        />
      )}

      {isPaused && (
        <div className="px-6 pt-3">
          <ArchitecturalAlert />
        </div>
      )}
      {showMultiTurnFullscreen ? (
        <div className="flex-1 overflow-hidden">
          <MultiTurnPanel onBackToGaps={() => setForceShowQueue(true)} />
        </div>
      ) : (
        <>
          <StatusStrip />
          <div className="flex-1 grid grid-cols-12 gap-8 px-8 py-7 overflow-hidden">
            <div className="col-span-7 overflow-hidden flex flex-col gap-3">
              <div className="flex-1 overflow-hidden">
                <SessionsBoard />
              </div>
              {mtActive && (
                <button
                  type="button"
                  onClick={() => setForceShowQueue(false)}
                  className="text-xs text-coral hover:text-rust transition-colors font-sans"
                >
                  {t('workspace.backToQueue')}
                </button>
              )}
            </div>
            <div className="col-span-5 overflow-hidden">
              <CommitsTimeline />
              {isPaused && (
                <div className="card p-4 mt-4">
                  <div className="text-sm font-medium mb-2">{t('workspace.editChecklist')}</div>
                  <PresetOverrideEditor />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    LOOPING: 'bg-forest/15 text-forest',
    PAUSED: 'bg-coral/15 text-coral',
    DONE: 'bg-forest/15 text-forest',
    ENDED: 'bg-warmline text-muted',
    SETUP: 'bg-warmline text-muted',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium ${colors[status] ?? 'bg-warmline text-muted'}`}>
      {status}
    </span>
  );
}
