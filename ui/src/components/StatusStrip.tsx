import { useState, type ReactNode } from 'react';
import { useStore } from '../store.js';
import { useLocale } from '../i18n/useLocale.js';
import { GapList } from './GapList.js';
import { RunLog } from './RunLog.js';
import { PresetChecklistView } from './PresetChecklistView.js';
import { CountUp } from './CountUp.js';
import { mockPresetItemsRich } from '../mock/data.js';
import { MilestonesPanel } from './MilestonesPanel.js';
import { mockMilestones, getMilestoneKpi } from '../mock/milestones.js';

// One-line KPI bar that lives between the Workspace header and the main
// canvas. Each pill is a tappable drawer:
//   待办: opens GapList
//   验收清单: opens preset items (SidePanel)
//   日志: opens RunLog
// Cost / engine status are read-only summaries.

type DrawerKind = 'gaps' | 'preset' | 'log' | 'milestones';

export function StatusStrip() {
  const { t } = useLocale();
  const session = useStore((s) => s.session);
  const costTotals = useStore((s) => s.costTotals);
  const gaps = useStore((s) => s.gaps);
  const sseConnected = useStore((s) => s.sseConnected);

  const [open, setOpen] = useState<DrawerKind | null>(null);

  // Read the 32-item rich preset (same source PresetChecklistView uses).
  // Real wire-in will swap this for a store selector once the daemon
  // surfaces the rich shape.
  const presetDone = mockPresetItemsRich.filter((i) => i.status === 'done').length;
  const presetTotal = mockPresetItemsRich.length;
  const presetPct = presetTotal ? Math.round((presetDone / presetTotal) * 100) : 0;

  const gapsInProgress = gaps.filter((g) => g.status === 'IN_PROGRESS').length;
  const gapsPending = gaps.filter((g) => g.status === 'PENDING').length;
  const gapsComplex = gaps.filter((g) => g.complexity === 'complex').length;

  const milestoneKpi = getMilestoneKpi(mockMilestones);

  return (
    <>
      <div className="border-b border-warmline bg-cream px-6 py-2 flex items-center gap-2 flex-shrink-0 text-xs font-sans">
        <PresetKpi
          done={presetDone}
          total={presetTotal}
          pct={presetPct}
          active={open === 'preset'}
          onClick={() => setOpen(open === 'preset' ? null : 'preset')}
        />

        <KpiCountUp
          label={t('strip.todo')}
          value={gapsInProgress + gapsPending}
          hint={
            gapsInProgress > 0
              ? `${gapsInProgress} ${t('strip.todo.inProgress')} · ${gapsPending} ${t('strip.todo.waiting')}`
              : `${gapsPending} ${t('strip.todo.waiting')}`
          }
          onClick={() => setOpen(open === 'gaps' ? null : 'gaps')}
          active={open === 'gaps'}
        >
          {gapsComplex > 0 && (
            <span className="bg-rust/15 text-rust px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider">
              {gapsComplex} {t('strip.todo.complex')}
            </span>
          )}
        </KpiCountUp>

        <KpiCountUp
          label={t('strip.cost')}
          value={costTotals.estimatedUsd}
          format={(n) => `$${n.toFixed(2)}`}
          hint={`${fmtTokens(costTotals.inputTokens + costTotals.outputTokens)} ${t('strip.cost.tokens')}`}
        />

        <div className="flex-1" />

        {/* Milestone KPI */}
        <button
          type="button"
          aria-expanded={open === 'milestones'}
          onClick={() => setOpen(open === 'milestones' ? null : 'milestones')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 ease-out-quart ${
            open === 'milestones'
              ? 'bg-forest/15 ring-1 ring-forest/30'
              : 'hover:bg-paper hover:-translate-y-0.5 ring-1 ring-transparent cursor-pointer'
          }`}
          title={t('strip.milestone')}
          data-testid="milestone-kpi"
        >
          <span className="text-[10px] uppercase tracking-widest text-muted/60">{t('strip.milestone')}</span>
          <span className="font-mono text-sm text-ink">
            <span className="text-forest font-medium">{milestoneKpi.done}</span>
            <span className="text-muted/50"> / {milestoneKpi.total}</span>
          </span>
          <div className="w-12 h-1.5 bg-warmline rounded-full overflow-hidden">
            <div
              className="h-full bg-forest rounded-full transition-all duration-700"
              style={{ width: `${milestoneKpi.pct}%` }}
            />
          </div>
        </button>

        <Kpi
          label={t('strip.log')}
          value={t('strip.log.detail')}
          onClick={() => setOpen(open === 'log' ? null : 'log')}
          active={open === 'log'}
        />

        <StatusDot
          ok={sseConnected}
          label={sseConnected ? t('strip.online') : t('strip.offline')}
          hint={session ? t('strip.drawer.session', { id: session.id }) : t('strip.drawer.noSession')}
        />
      </div>

      {open === 'gaps' && (
        <Drawer onClose={() => setOpen(null)} title={t('strip.drawer.gaps')}>
          <div className="h-full overflow-hidden">
            <GapList />
          </div>
        </Drawer>
      )}
      {open === 'preset' && (
        <Drawer onClose={() => setOpen(null)} title={t('strip.drawer.preset')}>
          <PresetChecklistView />
        </Drawer>
      )}
      {open === 'log' && (
        <Drawer onClose={() => setOpen(null)} title={t('strip.drawer.log')}>
          <div className="h-full overflow-hidden">
            <RunLog />
          </div>
        </Drawer>
      )}
      {open === 'milestones' && (
        <Drawer onClose={() => setOpen(null)} title={t('strip.milestone')}>
          <div className="h-full overflow-hidden overflow-y-auto">
            <MilestonesPanel onClose={() => setOpen(null)} />
          </div>
        </Drawer>
      )}
    </>
  );
}

function KpiCountUp({
  label,
  value,
  format,
  hint,
  onClick,
  active,
  children,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  hint?: string;
  onClick?: () => void;
  active?: boolean;
  children?: ReactNode;
}) {
  const cls = `flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 ease-out-quart ${
    onClick
      ? active
        ? 'bg-coral/10 text-coral ring-1 ring-coral/30'
        : 'hover:bg-paper hover:-translate-y-0.5 text-ink ring-1 ring-transparent cursor-pointer'
      : 'text-ink'
  }`;
  const inner = (
    <>
      <span className="text-[10px] uppercase tracking-widest text-muted/60">{label}</span>
      <CountUp value={value} format={format} className="font-mono text-sm" />
      {hint && <span className="text-muted/70 text-xs">· {hint}</span>}
      {children}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-expanded={active}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function PresetKpi({
  done,
  total,
  pct,
  active,
  onClick,
}: {
  done: number;
  total: number;
  pct: number;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`flex items-center gap-3 pl-3 pr-4 py-1.5 rounded-lg transition-all duration-200 ease-out-quart ${
        active
          ? 'bg-sage-50 ring-1 ring-sage-600/30'
          : 'hover:bg-paper hover:-translate-y-0.5 ring-1 ring-transparent'
      }`}
      title={t('strip.checklistHint')}
    >
      <div className="flex flex-col items-start">
        <span className="text-[10px] uppercase tracking-widest text-muted/60 leading-tight">
          {t('strip.checklist')}
        </span>
        <span className="text-sm text-ink leading-tight">
          <CountUp value={done} className="font-medium" />
          <span className="text-muted/50"> / {total}</span>
        </span>
      </div>
      <div className="flex flex-col items-end gap-1">
        <CountUp
          value={pct}
          className="font-mono text-xs text-sage-600 font-medium leading-none"
          format={(n) => `${Math.round(n)}%`}
        />
        <div className="w-20 h-1.5 bg-warmline rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sage-600 to-sage-600/70 transition-all duration-700 ease-out-quart"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </button>
  );
}

function Kpi({
  label,
  value,
  hint,
  onClick,
  active,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
  active?: boolean;
  children?: ReactNode;
}) {
  const cls = `flex items-center gap-2 px-3 py-1 rounded transition-colors ${
    onClick
      ? active
        ? 'bg-coral/15 text-coral hover:bg-coral/20'
        : 'hover:bg-paper text-ink cursor-pointer'
      : 'text-ink'
  }`;
  const inner = (
    <>
      <span className="text-[10px] uppercase tracking-wider text-muted/70">{label}</span>
      <span className="font-mono">{value}</span>
      {hint && <span className="text-muted/70">· {hint}</span>}
      {children}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-expanded={active}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function StatusDot({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2" title={hint}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-forest' : 'bg-muted/40'}`} />
      <span className="text-muted/70">{label}</span>
    </div>
  );
}

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="fixed inset-x-0 top-[105px] bottom-0 bg-ink/30 z-40 flex anim-drift-in" onClick={onClose}>
      <div
        className="bg-paper border-r border-warmline w-[480px] flex flex-col shadow-xl anim-drawer-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header flex items-center justify-between bg-cream flex-shrink-0">
          <span>{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink transition-colors font-sans"
          >
            {t('strip.drawer.close')}
          </button>
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
