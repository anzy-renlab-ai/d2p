import { useState, useEffect, useMemo } from 'react';
import { Button } from './Button.js';
import { CountUp } from './CountUp.js';
import { useLocale } from '../i18n/useLocale.js';
import { useStore } from '../store.js';
import {
  mockProjects,
  STATUS_META,
  TYPE_LABEL,
  type ProjectStatus,
  type ProjectSummary,
} from '../mock/projects.js';
import type { ProjectListItem, SessionStatus } from '../types.js';

// Multi-project home — pulls real /api/projects from the store and adapts the
// thin ProjectListItem rows to the rich ProjectSummary display shape. Falls
// back to mockProjects when no real projects are registered yet (so first-run
// users still see something meaningful).

function statusFromSession(s: SessionStatus | null): ProjectStatus {
  if (s === 'LOOPING') return 'looping';
  if (s === 'PAUSED') return 'paused';
  if (s === 'DONE') return 'done';
  if (s === 'SETUP') return 'setup';
  return 'idle';
}

const INFERRED_FALLBACK: ProjectSummary['inferredType'] = 'saas-web';

function adaptProject(p: ProjectListItem): ProjectSummary {
  const inferred = (p.inferredType ?? INFERRED_FALLBACK) as ProjectSummary['inferredType'];
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    inferredType: inferred,
    status: statusFromSession(p.latestSessionStatus),
    agentsWorking: p.agentsWorking,
    agentsTotal: p.agentsTotal,
    presetDone: p.presetDone,
    presetTotal: p.presetTotal,
    visionVerdict: p.visionVerdict,
    lastCommitTs: p.lastCommitTs ?? p.lastSessionAt ?? p.firstSeenAt,
    lastCommitMsg: p.lastCommitMsg ?? '',
    costUsd: p.estimatedUsd,
    pinned: false,
  };
}

const TONE_BADGE: Record<'good' | 'warn' | 'bad' | 'mute' | 'active', { chip: string; dot: string }> = {
  good:   { chip: 'bg-sage-50 text-sage-600',  dot: 'bg-sage-600' },
  warn:   { chip: 'bg-coralsoft text-coral',   dot: 'bg-coral' },
  bad:    { chip: 'bg-rust/10 text-rust',      dot: 'bg-rust' },
  mute:   { chip: 'bg-paper text-muted/70',    dot: 'bg-muted/40' },
  active: { chip: 'bg-coral/10 text-coral',    dot: 'bg-coral anim-breathe-dot' },
};

const VERDICT_BADGE: Record<ProjectSummary['visionVerdict'], { label: string; cls: string }> = {
  yes:     { label: 'vision ✓', cls: 'bg-sage-50 text-sage-600' },
  partial: { label: 'vision 部分', cls: 'bg-coralsoft text-coral' },
  no:      { label: 'vision ✗', cls: 'bg-rust/10 text-rust' },
  pending: { label: 'vision 未定', cls: 'bg-paper text-muted/70' },
};

function fmtRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s 前`;
  const mm = Math.floor(s / 60);
  if (mm < 60) return `${mm} 分前`;
  const hh = Math.floor(mm / 60);
  if (hh < 24) return `${hh} 小时前`;
  return `${Math.floor(hh / 24)} 天前`;
}

export interface ProjectsHomeProps {
  onOpenProject: (p: ProjectSummary) => void;
  onAddProject: () => void;
  onDemoMode: () => void;
}

export function ProjectsHome({ onOpenProject, onAddProject, onDemoMode }: ProjectsHomeProps) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const realProjects = useStore((s) => s.projects);
  const refreshProjects = useStore((s) => s.refreshProjects);

  // Refresh on mount so users adding projects elsewhere see the update.
  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // Source-of-truth selection: real projects when registered, else mock for
  // an empty home that still has something to show new users.
  const projects: ProjectSummary[] = useMemo(
    () => (realProjects.length > 0 ? realProjects.map(adaptProject) : mockProjects),
    [realProjects],
  );

  const filtered = projects.filter((p) => {
    if (filter === 'active') return p.status === 'looping' || p.status === 'paused' || p.status === 'error';
    if (filter === 'done') return p.status === 'done';
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastCommitTs - a.lastCommitTs;
  });

  const activeCount = projects.filter((p) => p.status === 'looping').length;
  const totalCost = projects.reduce((s, p) => s + p.costUsd, 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-6xl mx-auto pt-12 pb-16 px-8">
        <header className="mb-10 flex items-start justify-between gap-8">
          <div>
            <h1 className="text-5xl tracking-tight text-ink">{t('app.title')}</h1>
            <p className="text-lg text-muted mt-3 font-sans">
              {t('app.tagline')}
            </p>
            <div className="text-sm text-muted mt-4 flex items-center gap-4 font-sans">
              <span>
                <CountUp value={projects.length} className="text-ink font-medium" /> {t('home.summary.projects')}
              </span>
              <span className="text-muted/40">·</span>
              <span className="text-coral">
                <CountUp value={activeCount} className="font-medium" /> {t('home.summary.running')}
              </span>
              <span className="text-muted/40">·</span>
              <span>
                {t('home.summary.cost')}{' '}
                <CountUp
                  value={totalCost}
                  format={(n) => `$${n.toFixed(2)}`}
                  className="text-ink font-medium"
                />
              </span>
            </div>
          </div>
          <Button variant="primary" onClick={onAddProject}>
            {t('home.newProject')}
          </Button>
        </header>

        <div className="mb-6 flex items-center justify-between">
          <div className="flex gap-1">
            {(['all', 'active', 'done'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full font-sans transition-colors ${
                  filter === f
                    ? 'bg-ink text-cream'
                    : 'text-muted hover:text-ink hover:bg-warmline/40'
                }`}
              >
                {f === 'all' ? t('home.filter.all') : f === 'active' ? t('home.filter.active') : t('home.filter.done')}
                <span className={`ml-1.5 ${filter === f ? 'text-cream/60' : 'text-muted/50'}`}>
                  {f === 'all'
                    ? projects.length
                    : f === 'active'
                      ? projects.filter((p) => p.status === 'looping' || p.status === 'paused' || p.status === 'error').length
                      : projects.filter((p) => p.status === 'done').length}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onDemoMode}
            className="text-xs text-coral hover:text-rust transition-colors font-sans"
          >
            {t('home.tryDemo')}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sorted.map((p, i) => (
            <div
              key={p.id}
              className="anim-stagger"
              style={{ ['--i' as 'width']: i as unknown as string }}
            >
              <ProjectCard project={p} onClick={() => onOpenProject(p)} />
            </div>
          ))}
          <AddProjectCard onClick={onAddProject} stagger={sorted.length} />
        </div>

        {sorted.length === 0 && (
          <div className="text-center text-muted font-mono py-16">
            这个分类下没有项目
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project: p, onClick }: { project: ProjectSummary; onClick: () => void }) {
  const status = STATUS_META[p.status];
  const tone = TONE_BADGE[status.tone];
  const verdict = VERDICT_BADGE[p.visionVerdict];
  const presetPct = p.presetTotal ? Math.round((p.presetDone / p.presetTotal) * 100) : 0;
  const isActive = p.status === 'looping';

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`project-card-${p.id}`}
      className={`w-full text-left bg-cream rounded-xl px-5 py-4 lift-on-hover ring-1 ${
        isActive
          ? 'ring-coral/20 shadow-card anim-breathe'
          : 'ring-warmline/60 shadow-card hover:shadow-cardHover'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {p.pinned && <span className="text-coral/70 text-xs">📌</span>}
          <span className="text-base font-medium text-ink truncate">{p.name}</span>
          <span className="text-[10px] uppercase tracking-widest text-muted/50 font-mono">
            {TYPE_LABEL[p.inferredType]}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-sans ${tone.chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
          {status.label}
        </span>
      </div>

      <div className="text-xs font-mono text-muted/70 mb-3 truncate">{p.path}</div>

      <div className="space-y-2">
        <div>
          <div className="flex items-baseline justify-between text-[11px] font-sans mb-1">
            <span className="text-muted/70">验收清单</span>
            <span className="text-ink">
              <span className="font-medium">{p.presetDone}</span>
              <span className="text-muted/50"> / {p.presetTotal}</span>
              <span className="text-sage-600 ml-2 font-medium">{presetPct}%</span>
            </span>
          </div>
          <div className="w-full h-1.5 bg-paper rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sage-600 to-sage-600/70 transition-all duration-700 ease-out-quart"
              style={{ width: `${presetPct}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans ${verdict.cls}`}>
            {verdict.label}
          </span>
          {p.agentsWorking > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans bg-coral/10 text-coral">
              <span className="w-1.5 h-1.5 rounded-full bg-coral anim-breathe-dot" />
              {p.agentsWorking} agent 在跑
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans bg-paper text-muted/70 font-mono">
            ${p.costUsd.toFixed(2)}
          </span>
        </div>

        <div className="pt-2 text-xs text-muted line-clamp-1">
          <span className="text-muted/50">最新：</span>
          <span className="text-ink/80">{p.lastCommitMsg}</span>
          <span className="text-muted/50 ml-2">· {fmtRelative(p.lastCommitTs)}</span>
        </div>
      </div>
    </button>
  );
}

function AddProjectCard({ onClick, stagger }: { onClick: () => void; stagger: number }) {
  const { t } = useLocale();
  return (
    <div className="anim-stagger" style={{ ['--i' as 'width']: stagger as unknown as string }}>
      <button
        type="button"
        onClick={onClick}
        data-testid="add-project-card"
        className="w-full h-full min-h-[200px] flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-warmline text-muted hover:border-coral hover:text-coral transition-colors duration-200 ease-out-quart bg-paper/30"
      >
        <span className="text-3xl">+</span>
        <span className="text-sm font-sans">{t('home.newProject').replace(/^\+ /, '')}</span>
        <span className="text-[11px] text-muted/60 font-mono">{t('home.addProjectHint')}</span>
      </button>
    </div>
  );
}
