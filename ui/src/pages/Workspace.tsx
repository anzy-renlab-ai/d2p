import { useStore } from '../store.js';
import { Button } from '../components/Button.js';
import { GapList } from '../components/GapList.js';
import { RunLog } from '../components/RunLog.js';
import { SidePanel } from '../components/SidePanel.js';

export function Workspace() {
  const session = useStore((s) => s.session);
  const demo = useStore((s) => s.demo);
  const loopState = useStore((s) => s.loopState);
  const pauseLoop = useStore((s) => s.pauseLoop);
  const resumeLoop = useStore((s) => s.resumeLoop);
  const endSession = useStore((s) => s.endSession);

  const isPaused = session?.status === 'PAUSED';
  const isLooping = session?.status === 'LOOPING';
  const isPausing = loopState?.pauseRequested === true && loopState?.isRunning === true;

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b bg-white px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-semibold">
            d2p / <span className="font-mono text-sm text-slate-600">{demo?.path}</span>
          </h1>
          <div className="text-xs text-slate-500">
            {session?.status} · {isPausing && '(pausing — 当前 attempt 跑完后停)'}
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="ghost" onClick={() => void endSession()}>结束会话</Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        <div className="col-span-3 overflow-hidden">
          <GapList />
        </div>
        <div className="col-span-6 overflow-hidden">
          <RunLog />
        </div>
        <div className="col-span-3 overflow-y-auto">
          <SidePanel />
        </div>
      </div>
    </div>
  );
}
