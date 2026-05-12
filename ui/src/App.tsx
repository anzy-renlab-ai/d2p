import { useEffect } from 'react';
import { api, openLogStream } from './api.js';
import { useStore } from './store.js';

export function App() {
  const health = useStore((s) => s.health);
  const events = useStore((s) => s.events);
  const setHealth = useStore((s) => s.setHealth);
  const pushEvent = useStore((s) => s.pushEvent);

  useEffect(() => {
    let mounted = true;
    api
      .health()
      .then((h) => {
        if (mounted) setHealth(h);
      })
      .catch(() => {
        if (mounted) setHealth(null);
      });
    const id = setInterval(() => {
      api.health().then((h) => mounted && setHealth(h)).catch(() => mounted && setHealth(null));
    }, 10_000);
    const close = openLogStream(pushEvent);
    return () => {
      mounted = false;
      clearInterval(id);
      close();
    };
  }, [setHealth, pushEvent]);

  return (
    <div className="min-h-screen p-6 font-sans">
      <header className="flex items-center justify-between border-b pb-3 mb-6">
        <h1 className="text-2xl font-semibold">d2p</h1>
        <HealthBadge />
      </header>

      <main className="grid gap-6">
        <section>
          <h2 className="text-lg font-medium mb-2">Daemon</h2>
          {health ? (
            <pre className="bg-white rounded p-3 text-xs overflow-auto border">
              {JSON.stringify(health, null, 2)}
            </pre>
          ) : (
            <div className="text-red-600">daemon unreachable</div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-medium mb-2">Live Run Log ({events.length})</h2>
          <div className="bg-white rounded border max-h-96 overflow-auto">
            {events.length === 0 ? (
              <div className="p-3 text-slate-500 text-sm">no events yet</div>
            ) : (
              <ul className="divide-y">
                {events.map((e) => (
                  <li key={e.id} className="px-3 py-2 text-sm">
                    <span className="text-slate-400 mr-2">
                      {new Date(e.ts).toISOString().slice(11, 19)}
                    </span>
                    <span className="font-mono">{e.kind}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function HealthBadge() {
  const health = useStore((s) => s.health);
  if (!health) return <span className="text-red-600 text-sm">● daemon down</span>;
  if (!health.ok) return <span className="text-amber-600 text-sm">● degraded</span>;
  return <span className="text-green-600 text-sm">● healthy</span>;
}
