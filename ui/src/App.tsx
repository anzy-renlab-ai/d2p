import { useEffect } from 'react';
import { bootstrap, useStore } from './store.js';
import { HealthBadge } from './components/HealthBadge.js';
import { Landing } from './pages/Landing.js';
import { Setup } from './pages/Setup.js';
import { Workspace } from './pages/Workspace.js';
import { Done } from './pages/Done.js';

export function App() {
  useEffect(() => bootstrap(), []);
  const session = useStore((s) => s.session);
  const health = useStore((s) => s.health);

  // Routing by session status — explicit, no router lib needed.
  let body;
  if (!session) {
    body = <Landing />;
  } else if (session.status === 'SETUP') {
    body = <Setup />;
  } else if (session.status === 'LOOPING' || session.status === 'PAUSED') {
    body = <Workspace />;
  } else {
    // DONE or ENDED
    body = <Done />;
  }

  return (
    <div className="min-h-screen">
      {(!session || session.status === 'SETUP' || session.status === 'DONE' || session.status === 'ENDED') && (
        <div className="absolute top-3 right-4 z-10">
          <HealthBadge />
        </div>
      )}
      {body}
      {health?.ok && !session && (
        <div className="fixed bottom-2 right-3 text-xs text-slate-400">
          daemon v{health.daemonVersion} · prompts v{health.promptsVersion}
        </div>
      )}
    </div>
  );
}
