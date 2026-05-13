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
      <div className="bg-white rounded border">
        <div className="px-3 py-2 border-b bg-slate-50 text-sm font-medium">Preset 进度</div>
        <div className="p-3">
          <div className="text-xs text-slate-600 mb-1">
            {done} / {total} 完成 · {pct}%
          </div>
          <div className="w-full bg-slate-100 rounded h-2 overflow-hidden">
            <div className="bg-green-500 h-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          {total > 0 && (
            <ul className="mt-3 text-xs space-y-1 max-h-48 overflow-y-auto">
              {presetStatus.map((i) => (
                <li key={i.item} className="flex items-start gap-2">
                  <span
                    className={
                      i.status === 'done'
                        ? 'text-green-600'
                        : i.status === 'partial'
                        ? 'text-amber-600'
                        : 'text-slate-400'
                    }
                  >
                    {i.status === 'done' ? '✓' : i.status === 'partial' ? '◐' : '○'}
                  </span>
                  <span className="font-mono text-slate-700 break-all">{i.item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded border">
        <div className="px-3 py-2 border-b bg-slate-50 text-sm font-medium">Cost</div>
        <div className="p-3 text-xs space-y-1">
          <div>input: {costTotals.inputTokens.toLocaleString()} tok</div>
          <div>output: {costTotals.outputTokens.toLocaleString()} tok</div>
          <div className="font-semibold">≈ ${costTotals.estimatedUsd.toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-white rounded border">
        <div className="px-3 py-2 border-b bg-slate-50 text-sm font-medium">Vision</div>
        <div className="p-3 text-xs">
          {visionMd ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-slate-700 max-h-72 overflow-y-auto">
              {visionMd}
            </pre>
          ) : (
            <span className="text-slate-400">尚未定稿</span>
          )}
        </div>
      </div>
    </div>
  );
}
