import { useStore } from '../store.js';

export function PresetProgress() {
  const items = useStore((s) => s.presetStatus);
  if (items.length === 0) {
    return <div className="text-xs text-muted/60">preset not loaded</div>;
  }
  const done = items.filter((i) => i.status === 'done').length;
  const partial = items.filter((i) => i.status === 'partial').length;
  const pct = Math.round((done / items.length) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium text-ink">Preset</span>
        <span className="text-xs text-muted">
          {done}/{items.length}
          {partial > 0 && ` (+${partial} partial)`}
        </span>
      </div>
      <div className="h-2 w-full bg-paper border border-warmline rounded-full overflow-hidden">
        <div
          className="h-full bg-coral transition-all"
          style={{ width: `${pct}%` }}
          aria-label={`${pct}%`}
        />
      </div>
    </div>
  );
}
