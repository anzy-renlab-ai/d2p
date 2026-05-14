import { useStore } from '../store.js';

export function HealthBadge() {
  const health = useStore((s) => s.health);
  const sse = useStore((s) => s.sseConnected);
  if (!health) {
    return (
      <span className="text-rust text-xs flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-rust animate-pulse" /> daemon down
      </span>
    );
  }
  if (!health.ok) {
    return (
      <span className="text-coral text-xs flex items-center gap-1.5" title={health.dbPath}>
        <span className="w-1.5 h-1.5 rounded-full bg-coral" /> degraded
      </span>
    );
  }
  return (
    <span
      className="text-forest text-xs flex items-center gap-1.5"
      title={`daemon ${health.daemonVersion}, prompts v${health.promptsVersion}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-forest" />
      healthy <span className="text-muted/70">· {sse ? 'stream' : 'stream offline'}</span>
    </span>
  );
}
