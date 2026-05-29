import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { api } from '../api.js';

export function SidePanel() {
  const presetStatus = useStore((s) => s.presetStatus);
  const costTotals = useStore((s) => s.costTotals);
  const session = useStore((s) => s.session);
  const [visionMd, setVisionMd] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.visionMdPath) {
      setVisionMd(null);
      return;
    }
    let cancelled = false;
    void api.visionRound().then((r) => {
      if (!cancelled && r.visionMd) setVisionMd(r.visionMd);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.visionMdPath, session?.id]);

  const done = presetStatus.filter((i) => i.status === 'done').length;
  const total = presetStatus.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header text-sm">Preset 进度</div>
        <div className="p-4">
          <div className="text-xs text-muted mb-2">
            {done} / {total} 完成 · <span className="text-ink font-medium">{pct}%</span>
          </div>
          <div className="w-full bg-paper border border-warmline rounded-full h-2 overflow-hidden">
            <div className="bg-forest h-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          {total > 0 && (
            <ul className="mt-4 text-xs space-y-1.5 max-h-48 overflow-y-auto">
              {presetStatus.map((i) => (
                <li key={i.item} className="flex items-start gap-2">
                  <span
                    className={
                      i.status === 'done'
                        ? 'text-forest'
                        : i.status === 'partial'
                        ? 'text-coral'
                        : 'text-muted/60'
                    }
                  >
                    {i.status === 'done' ? '✓' : i.status === 'partial' ? '◐' : '○'}
                  </span>
                  <span className="font-mono text-ink break-all">{i.item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header text-sm">Cost</div>
        <div className="p-4 text-xs space-y-1 font-mono">
          <div className="text-muted">in: <span className="text-ink">{costTotals.inputTokens.toLocaleString()}</span> tok</div>
          <div className="text-muted">out: <span className="text-ink">{costTotals.outputTokens.toLocaleString()}</span> tok</div>
          <div className="font-semibold text-ink mt-2">≈ ${costTotals.estimatedUsd.toFixed(2)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header text-sm">Vision</div>
        <div className="p-4 text-xs">
          {visionMd ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-ink max-h-72 overflow-y-auto leading-relaxed">
              {visionMd}
            </pre>
          ) : (
            <span className="text-muted font-mono">尚未定稿</span>
          )}
        </div>
      </div>
    </div>
  );
}
