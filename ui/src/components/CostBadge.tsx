import { useStore } from '../store.js';

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export function CostBadge() {
  const c = useStore((s) => s.costTotals);
  return (
    <div className="text-xs text-slate-600">
      ≈ ${c.estimatedUsd.toFixed(2)}{' '}
      <span className="text-slate-400">
        ({fmtTok(c.inputTokens)} in / {fmtTok(c.outputTokens)} out)
      </span>
    </div>
  );
}
