import { useEffect, useMemo } from 'react';
import { useStore } from '../store.js';
import { useLocale } from '../i18n/useLocale.js';
import { CountUp } from './CountUp.js';
import { mockProjects, STATUS_META, type ProjectStatus, type ProjectSummary } from '../mock/projects.js';
import { sessionsForProject, type SessionSummary } from '../mock/sessionsHistory.js';
import type { ProjectListItem, SessionListItem, SessionStatus } from '../types.js';

function adaptStatus(s: SessionStatus | null): ProjectStatus {
  if (s === 'LOOPING') return 'looping';
  if (s === 'PAUSED') return 'paused';
  if (s === 'DONE') return 'done';
  if (s === 'SETUP') return 'setup';
  return 'idle';
}

function adaptProjectFromReal(p: ProjectListItem): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    inferredType: (p.inferredType ?? 'saas-web') as ProjectSummary['inferredType'],
    status: adaptStatus(p.latestSessionStatus),
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

function adaptSessionFromReal(s: SessionListItem, projectId: number): SessionSummary {
  return {
    id: s.id,
    projectId,
    status: adaptStatus(s.status),
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    title: `Session #${s.id}`,
    gapsFound: 0,
    gapsDone: 0,
    gapsNeedHuman: 0,
    commitCount: s.commitsCount,
    topRisk: s.topRisk ?? 'none',
    costUsd: 0,
    agentCalls: s.agentCalls,
  };
}

// Sessions list for one project: drill from ProjectsHome → here → click a
// session to enter Workspace. Each row shows status + summary + topRisk + cost.

const STATUS_TONE_BADGE: Record<string, { chip: string; dot: string; label: string }> = {
  looping:  { chip: 'bg-coral/10 text-coral',      dot: 'bg-coral anim-breathe-dot', label: 'Running' },
  paused:   { chip: 'bg-coralsoft text-coral',     dot: 'bg-coral',                  label: 'Paused' },
  done:     { chip: 'bg-sage-50 text-sage-600',    dot: 'bg-sage-600',               label: 'Done' },
  setup:    { chip: 'bg-paper text-muted/70',      dot: 'bg-muted/40',               label: 'Setup' },
  idle:     { chip: 'bg-paper text-muted/70',      dot: 'bg-muted/40',               label: 'Idle' },
  error:    { chip: 'bg-rust/10 text-rust',        dot: 'bg-rust',                   label: 'Error' },
};

const RISK_TONE: Record<'low' | 'mid' | 'high' | 'none', { chip: string; label: string }> = {
  none: { chip: 'bg-paper text-muted/50',         label: '—' },
  low:  { chip: 'bg-sage-50 text-sage-600',       label: 'Low' },
  mid:  { chip: 'bg-coralsoft text-coral',        label: 'Mid' },
  high: { chip: 'bg-rust/10 text-rust',           label: 'High' },
};

function fmtDate(ts: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return t('time.minAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('time.hourAgo', { n: hr });
  return t('time.dayAgo', { n: Math.floor(hr / 24) });
}

function fmtDuration(startedAt: number, endedAt: number | null): string {
  const end = endedAt ?? Date.now();
  const mins = Math.floor((end - startedAt) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hr = Math.floor(mins / 60);
  const remM = mins % 60;
  return `${hr}h ${remM}m`;
}

export function SessionsList() {
  const { t, locale } = useLocale();
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useStore((s) => s.setSelectedProjectId);
  const setSelectedSessionId = useStore((s) => s.setSelectedSessionId);
  const startDemo = useStore((s) => s.startMultiTurnDemo);
  const realProjects = useStore((s) => s.projects);
  const realSessionsMap = useStore((s) => s.sessionsByProject);
  const refreshSessionsByProject = useStore((s) => s.refreshSessionsByProject);

  // Fetch sessions for this project from daemon. Mock fallback when daemon
  // has nothing yet (so first-run users still see the demo flow).
  useEffect(() => {
    if (selectedProjectId !== null) {
      void refreshSessionsByProject(selectedProjectId);
    }
  }, [selectedProjectId, refreshSessionsByProject]);

  const project: ProjectSummary | null = useMemo(() => {
    if (selectedProjectId === null) return null;
    const real = realProjects.find((p) => p.id === selectedProjectId);
    if (real) return adaptProjectFromReal(real);
    return mockProjects.find((p) => p.id === selectedProjectId) ?? null;
  }, [selectedProjectId, realProjects]);

  const sessions: SessionSummary[] = useMemo(() => {
    if (selectedProjectId === null) return [];
    const realRows = realSessionsMap[selectedProjectId];
    if (realRows && realRows.length > 0) {
      return realRows.map((r) => adaptSessionFromReal(r, selectedProjectId));
    }
    // No real sessions yet for this project (or daemon empty) — fall back to
    // the mock history so the page is never empty in a first-run demo.
    return sessionsForProject(selectedProjectId);
  }, [selectedProjectId, realSessionsMap]);

  if (!project) return null;
  const status = STATUS_META[project.status];

  const totalCost = sessions.reduce((s, x) => s + x.costUsd, 0);
  const totalCommits = sessions.reduce((s, x) => s + x.commitCount, 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-5xl mx-auto pt-10 pb-16 px-8">
        <header className="mb-8">
          <button
            type="button"
            onClick={() => setSelectedProjectId(null)}
            className="text-xs text-muted hover:text-ink transition-colors font-sans mb-4"
          >
            {t('workspace.backToProjects')}
          </button>
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3 mb-1.5">
                <h1 className="text-3xl tracking-tight text-ink truncate">{project.name}</h1>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-sans ${
                  status.tone === 'active' ? 'bg-coral/10 text-coral' :
                  status.tone === 'good' ? 'bg-sage-50 text-sage-600' :
                  status.tone === 'warn' ? 'bg-coralsoft text-coral' :
                  status.tone === 'bad' ? 'bg-rust/10 text-rust' :
                  'bg-paper text-muted/70'
                }`}>
                  {status.label}
                </span>
              </div>
              <div className="text-xs text-muted font-mono mb-3">{project.path}</div>
              <div className="text-sm text-muted flex items-center gap-4 font-sans">
                <span>
                  <CountUp value={sessions.length} className="text-ink font-medium" />{' '}
                  {locale === 'en' ? 'sessions' : '个 session'}
                </span>
                <span className="text-muted/40">·</span>
                <span>
                  <CountUp value={totalCommits} className="text-ink font-medium" />{' '}
                  {locale === 'en' ? 'commits' : '次 commit'}
                </span>
                <span className="text-muted/40">·</span>
                <span>
                  {locale === 'en' ? 'spent ' : '累计花费 '}
                  <CountUp
                    value={totalCost}
                    format={(n) => `$${n.toFixed(2)}`}
                    className="text-ink font-medium"
                  />
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => startDemo()}
              className="text-xs text-coral hover:text-rust transition-colors font-sans whitespace-nowrap"
            >
              {locale === 'en' ? 'View demo →' : '试看演示 →'}
            </button>
          </div>
        </header>

        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-medium text-ink">
            {locale === 'en' ? 'Sessions' : 'Session 历史'}
          </h2>
          <span className="text-xs text-muted/70 font-sans">
            {locale === 'en' ? 'newest first' : '最新在上'}
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center text-muted italic font-serif py-16">
            {locale === 'en' ? 'No sessions yet — start one to see ZeroU in action' : '还没有 session — 启动一个让 ZeroU 干活'}
          </div>
        ) : (
          <ol className="space-y-3">
            {sessions.map((s, i) => (
              <div
                key={s.id}
                className="anim-stagger"
                style={{ ['--i' as 'width']: i as unknown as string }}
              >
                <SessionRow session={s} onOpen={() => setSelectedSessionId(s.id)} />
              </div>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function SessionRow({ session: s, onOpen }: { session: SessionSummary; onOpen: () => void }) {
  const { t, locale } = useLocale();
  const status = STATUS_TONE_BADGE[s.status] ?? STATUS_TONE_BADGE.idle!;
  const risk = RISK_TONE[s.topRisk] ?? RISK_TONE.none!;
  const isActive = s.status === 'looping';
  const isError = s.status === 'error';

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`session-row-${s.id}`}
      className={`w-full text-left bg-cream rounded-xl px-5 py-4 lift-on-hover ring-1 transition-all ${
        isActive ? 'ring-coral/20 shadow-card anim-breathe' :
        isError ? 'ring-rust/20 shadow-card' :
        'ring-warmline/60 shadow-card hover:shadow-cardHover'
      }`}
    >
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-sans flex-shrink-0 ${status.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
          <span className="text-[11px] font-mono text-muted/50">#{s.id}</span>
          <span className="text-sm text-ink truncate">{s.title}</span>
        </div>
        <span className={`text-[10px] uppercase tracking-wider font-sans flex-shrink-0 px-2 py-0.5 rounded ${risk.chip}`} title={locale === 'en' ? 'Top commit risk' : '最高 commit 风险'}>
          {locale === 'en' ? 'risk ' : '风险 '}{risk.label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-sans">
        <Stat
          label={locale === 'en' ? 'gaps' : '待办'}
          value={`${s.gapsDone} / ${s.gapsFound}`}
          tone={s.gapsNeedHuman > 0 ? 'warn' : 'normal'}
        />
        <Stat
          label={locale === 'en' ? 'commits' : 'commit'}
          value={String(s.commitCount)}
        />
        <Stat
          label={locale === 'en' ? 'agent calls' : 'agent 调用'}
          value={String(s.agentCalls)}
        />
        <Stat
          label={locale === 'en' ? 'cost' : '花费'}
          value={`$${s.costUsd.toFixed(2)}`}
        />
      </div>

      <div className="mt-2 text-[11px] text-muted/60 font-sans flex items-center gap-2">
        {s.gapsNeedHuman > 0 && (
          <span className="text-rust font-medium">
            ⚠ {s.gapsNeedHuman} {locale === 'en' ? 'gaps need human' : '个 gap 需要人工'}
          </span>
        )}
        {s.gapsNeedHuman > 0 && <span className="text-muted/40">·</span>}
        <span>
          {fmtDate(s.startedAt, t)} · {fmtDuration(s.startedAt, s.endedAt)}
        </span>
      </div>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'normal' | 'warn' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted/60 font-medium">{label}</div>
      <div className={`text-sm font-mono ${tone === 'warn' ? 'text-rust' : 'text-ink'}`}>{value}</div>
    </div>
  );
}
