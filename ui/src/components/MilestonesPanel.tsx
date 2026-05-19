import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { mockMilestones, getMilestoneKpi, type Milestone } from '../mock/milestones.js';
import { mockPresetItemsRich } from '../mock/data.js';
import type { MilestoneRow } from '../types.js';

// Daemon's MilestoneRow uses `in_progress` (snake-ish) while the mock uses
// `in-progress` (kebab). Adapter normalizes status casing and renames
// visionExcerpt → vision_excerpt. doneCount/totalCount are derived loosely
// from presetItemIds length (we don't yet join preset_status to compute the
// real done count here).
function adaptMilestone(m: MilestoneRow): Milestone {
  const status: Milestone['status'] =
    m.status === 'in_progress' ? 'in-progress' : (m.status as Milestone['status']);
  return {
    id: String(m.id),
    ordinal: m.ordinal,
    title: m.title,
    subtitle: '',
    status,
    vision_excerpt: m.visionExcerpt ?? '',
    presetItemIds: m.presetItemIds,
    completedAt: m.completedAt,
    doneCount: status === 'done' ? m.presetItemIds.length : 0,
    totalCount: m.presetItemIds.length,
  };
}

const STATUS_DOT: Record<Milestone['status'], string> = {
  done:        'bg-forest',
  'in-progress': 'bg-coral animate-pulse',
  pending:     'bg-muted/30',
};

const STATUS_LABEL: Record<Milestone['status'], string> = {
  done:        '完成',
  'in-progress': '进行中',
  pending:     '待开始',
};

interface MilestonesPanelProps {
  milestones?: Milestone[];
  onClose?: () => void;
}

/** Horizontal milestone stepper. Clickable steps expand vision excerpt + preset chips. */
export function MilestonesPanel({ milestones: milestonesProp, onClose }: MilestonesPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const realMilestones = useStore((s) => s.milestones);

  // Priority: explicit prop > real daemon data > mock fallback. Empty daemon
  // arrays fall through to the mock so first-run users still see the stepper.
  const milestones = useMemo<Milestone[]>(() => {
    if (milestonesProp) return milestonesProp;
    if (realMilestones.length > 0) return realMilestones.map(adaptMilestone);
    return mockMilestones;
  }, [milestonesProp, realMilestones]);

  const kpi = getMilestoneKpi(milestones);

  return (
    <div className="bg-paper flex flex-col" data-testid="milestones-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-warmline bg-cream flex-shrink-0">
        <div>
          <div className="text-sm font-medium text-ink">Milestone 进度</div>
          <div className="text-xs text-muted mt-0.5">
            <span className="text-sage-600 font-medium">{kpi.done}</span>
            <span className="text-muted/60"> / {kpi.total} 完成</span>
            <span className="mx-2 text-muted/30">·</span>
            <span className="font-mono text-xs">{kpi.pct}%</span>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink px-2 py-1 rounded hover:bg-paper transition-colors"
          >
            收起 ✕
          </button>
        )}
      </div>

      {/* Stepper */}
      <div className="overflow-x-auto flex-shrink-0">
        <div className="flex items-start px-6 py-5 gap-0 min-w-max">
          {milestones.map((m, idx) => {
            const isLast = idx === milestones.length - 1;
            const isExpanded = expanded === m.id;
            const pct = m.totalCount ? Math.round((m.doneCount / m.totalCount) * 100) : 0;

            return (
              <div key={m.id} className="flex items-start">
                {/* Step node */}
                <button
                  type="button"
                  className="flex flex-col items-center w-28 group"
                  onClick={() => setExpanded(isExpanded ? null : m.id)}
                  data-testid={`milestone-step-${m.id}`}
                >
                  {/* Circle */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-200 ring-2 ${
                    m.status === 'done'
                      ? 'bg-forest text-cream ring-forest/30'
                      : m.status === 'in-progress'
                      ? 'bg-coral text-cream ring-coral/30'
                      : 'bg-paper text-muted/60 ring-warmline group-hover:ring-coral/30'
                  }`}>
                    {m.status === 'done' ? '✓' : m.ordinal}
                  </div>

                  {/* Status dot (for in-progress breathing) */}
                  <div className="flex items-center gap-1 mt-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[m.status]}`} />
                    <span className="text-[9px] text-muted/60 uppercase tracking-wider">{STATUS_LABEL[m.status]}</span>
                  </div>

                  {/* Title */}
                  <div className={`text-xs font-medium mt-1 text-center leading-tight ${
                    isExpanded ? 'text-coral' : 'text-ink'
                  }`}>
                    {m.title}
                  </div>

                  {/* Progress bar */}
                  <div className="w-16 h-1 bg-warmline rounded-full mt-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        m.status === 'done' ? 'bg-forest' : m.status === 'in-progress' ? 'bg-coral' : 'bg-muted/30'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-muted/50 font-mono mt-0.5">{pct}%</div>
                </button>

                {/* Connector line */}
                {!isLast && (
                  <div className="flex-shrink-0 w-8 mt-4 h-px bg-warmline mx-1 self-start" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (() => {
        const m = milestones.find((ms) => ms.id === expanded);
        if (!m) return null;
        const presetItems = mockPresetItemsRich.filter((i) => m.presetItemIds.includes(i.id));
        return (
          <div className="border-t border-warmline px-6 py-4 anim-drift-in flex-shrink-0 overflow-y-auto max-h-60">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-ink mb-1">M{m.ordinal} · {m.title}</div>
                <div className="text-xs text-muted/80 leading-relaxed mb-3 italic line-clamp-3">
                  "{m.vision_excerpt}"
                </div>
                {/* Preset item chips */}
                <div className="flex flex-wrap gap-1.5">
                  {presetItems.map((item) => (
                    <span
                      key={item.id}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-sans ${
                        item.status === 'done'
                          ? 'bg-forest/15 text-forest'
                          : item.status === 'partial'
                          ? 'bg-coralsoft text-coral'
                          : 'bg-warmline/60 text-muted'
                      }`}
                      title={item.note ?? item.id}
                    >
                      {item.label}
                    </span>
                  ))}
                </div>
                {m.status === 'in-progress' && (
                  <div className="mt-2 text-[10px] text-coral font-mono">
                    当前进行中 — {m.doneCount} / {m.totalCount} preset items 完成
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
