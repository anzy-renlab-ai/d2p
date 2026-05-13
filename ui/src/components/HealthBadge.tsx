import { useStore } from '../store.js';

export function HealthBadge() {
  const health = useStore((s) => s.health);
  const sse = useStore((s) => s.sseConnected);
  if (!health) return <span className="text-red-600 text-sm">● daemon down</span>;
  if (!health.ok) return <span className="text-amber-600 text-sm" title={health.dbPath}>● degraded</span>;
  return (
    <span className="text-green-600 text-sm" title={`daemon ${health.daemonVersion}, prompts v${health.promptsVersion}`}>
      ● healthy {sse ? '· stream' : '· stream offline'}
    </span>
  );
}
