import { useState } from 'react';
import { useStore } from '../store.js';
import { Button } from '../components/Button.js';
import { GapList } from '../components/GapList.js';
import { RunLog } from '../components/RunLog.js';
import { SidePanel } from '../components/SidePanel.js';
import { ArchitecturalAlert } from '../components/ArchitecturalAlert.js';
import { PresetOverrideEditor } from '../components/PresetOverrideEditor.js';
import { HealthBadge } from '../components/HealthBadge.js';
import { MultiTurnPanel, isMultiTurnActive } from '../components/MultiTurnPanel.js';

export function Workspace() {
  const session = useStore((s) => s.session);
  const demo = useStore((s) => s.demo);
  const loopState = useStore((s) => s.loopState);
  const multiTurn = useStore((s) => s.multiTurn);
  const pauseLoop = useStore((s) => s.pauseLoop);
  const resumeLoop = useStore((s) => s.resumeLoop);
  const endSession = useStore((s) => s.endSession);

  const setShowSettings = useStore((s) => s.setShowSettings);
  const isPaused = session?.status === 'PAUSED';
  const isLooping = session?.status === 'LOOPING';
  const isPausing = loopState?.pauseRequested === true && loopState?.isRunning === true;

  // When a complex gap is running, the multi-turn panel takes over the main
  // canvas. User can press "← 返回 gap 队列" to peek at the gap list/run log.
  const mtActive = isMultiTurnActive(multiTurn);
  const [forceShowQueue, setForceShowQueue] = useState(false);
  const showMultiTurnFullscreen = mtActive && !forceShowQueue;

  return (
    <div className="h-screen flex flex-col bg-paper">
      <header className="border-b border-warmline bg-cream px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl tracking-tight">d2p</h1>
            <span className="font-mono text-xs text-muted truncate max-w-md" title={demo?.path}>
              {demo?.path}
            </span>
          </div>
          <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
            <StatusPill status={session?.status} />
            {isPausing && <span className="text-coral">(pausing — 当前 attempt 跑完后停)</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HealthBadge />
          <div className="w-px h-5 bg-warmline mx-1" />
          {isLooping && (
            <Button variant="secondary" onClick={() => void pauseLoop()} disabled={isPausing}>
              {isPausing ? 'Pausing…' : 'Pause ⏸'}
            </Button>
          )}
          {isPaused && (
            <Button variant="primary" onClick={() => void resumeLoop()}>
              Resume ▶
            </Button>
          )}
          <Button variant="ghost" onClick={() => setShowSettings(true)}>⚙ 设置 / 切引擎</Button>
          <Button variant="ghost" onClick={() => void endSession()}>结束会话</Button>
        </div>
      </header>

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
        <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
          <div className="col-span-3 overflow-hidden">
            <GapList />
            {mtActive && (
              <button
                type="button"
                onClick={() => setForceShowQueue(false)}
                className="mt-3 w-full text-xs text-coral hover:text-rust transition-colors font-sans"
              >
                返回自治视图 →
              </button>
            )}
          </div>
          <div className="col-span-6 overflow-hidden">
            <RunLog />
          </div>
          <div className="col-span-3 overflow-y-auto space-y-4">
            <SidePanel />
            {isPaused && (
              <div className="card p-4">
                <div className="text-sm font-medium mb-2">调整验收清单</div>
                <PresetOverrideEditor />
              </div>
            )}
          </div>
        </div>
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
