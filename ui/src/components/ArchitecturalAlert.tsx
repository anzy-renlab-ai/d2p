import { useMemo } from 'react';
import type { SseEnvelope } from '../types.js';
import { useStore } from '../store.js';

export function ArchitecturalAlert() {
  const events = useStore((s) => s.events);
  const session = useStore((s) => s.session);

  const archEvent = useMemo<SseEnvelope | undefined>(() => {
    if (session?.status !== 'PAUSED') return undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.kind !== 'GAP_ESCALATED') continue;
      if ((e.payload as { reason?: string }).reason !== 'ARCHITECTURAL') continue;
      return e;
    }
    return undefined;
  }, [events, session?.status]);

  if (!archEvent) return null;
  const rationale = (archEvent.payload as { rationale?: string }).rationale ?? '(no rationale)';
  return (
    <div className="border-l-4 border-coral bg-coralsoft/40 p-4 rounded mb-4">
      <div className="font-medium text-ink mb-1">需要架构决策</div>
      <div className="text-sm text-ink">{rationale}</div>
      <div className="text-xs text-muted mt-2 leading-relaxed">
        改一下 <code>vision.md</code> 或 <code>preset-overrides.yaml</code> 让方向更明确，ZeroU 会自动捕获并继续。或者点 Resume 让它再试一次。
      </div>
    </div>
  );
}
