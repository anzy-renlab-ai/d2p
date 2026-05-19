import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { useLocale } from '../i18n/useLocale.js';
import {
  mockAgentSessions,
  mockTimelinesByRole,
  AGENT_LABEL,
  STATUS_LABEL,
  type AgentRole,
  type AgentSession,
  type AgentStatus,
  type SessionTurnEntry,
} from '../mock/sessions.js';
import type { AgentSessionAgg } from '../types.js';

function adaptAgent(a: AgentSessionAgg): AgentSession {
  return {
    role: a.role,
    status: a.status,
    currentGapSlug: a.currentGapSlug,
    currentGapTitle: a.currentGapTitle,
    lastTurnSummary: a.lastTurnSummary ?? '',
    turnCountThisGap: a.turnCountThisGap,
    callsThisSession: a.callsThisSession,
    lastActivityTs: a.lastActivityTs ?? Date.now(),
  };
}

// Sort by status priority — actionable first, idle / stale last. Within the
// same status bucket preserve original order so role identity is stable.
const STATUS_PRIORITY: Record<AgentStatus, number> = {
  working: 0,
  blocked: 1,
  done: 2,
  idle: 3,
  stale: 4,
};

function sortSessions(list: AgentSession[]): AgentSession[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const dp = STATUS_PRIORITY[a.s.status] - STATUS_PRIORITY[b.s.status];
      return dp !== 0 ? dp : a.i - b.i;
    })
    .map((x) => x.s);
}

// Soft, role-tinted cards. No table-grid lines; cards float on the page.
// Working agent gets a subtle glow + the role's tint background.

function fmtRelative(ts: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  const diffMs = Date.now() - ts;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return t('time.secAgo', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('time.minAgo', { n: m });
  const h = Math.floor(m / 60);
  return t('time.hourAgo', { n: h });
}

// Per-role tint: differ=slate, implementer=amber, reviewers=sage, done-check=plum
const ROLE_TINT: Record<AgentRole, { ringHover: string; bg: string; bgWorking: string; text: string }> = {
  differ:       { ringHover: 'hover:ring-slate-100', bg: 'bg-slate-50',  bgWorking: 'bg-slate-50',  text: 'text-slate-600' },
  implementer:  { ringHover: 'hover:ring-amber-100', bg: 'bg-amber-50',  bgWorking: 'bg-amber-50',  text: 'text-amber-600' },
  alignment:    { ringHover: 'hover:ring-sage-100',  bg: 'bg-sage-50',   bgWorking: 'bg-sage-50',   text: 'text-sage-600' },
  behavioral:   { ringHover: 'hover:ring-sage-100',  bg: 'bg-sage-50',   bgWorking: 'bg-sage-50',   text: 'text-sage-600' },
  adversarial:  { ringHover: 'hover:ring-sage-100',  bg: 'bg-sage-50',   bgWorking: 'bg-sage-50',   text: 'text-sage-600' },
  'done-check': { ringHover: 'hover:ring-plum-100',  bg: 'bg-plum-50',   bgWorking: 'bg-plum-50',   text: 'text-plum-600' },
  'repo-summary': { ringHover: 'hover:ring-slate-100', bg: 'bg-slate-50', bgWorking: 'bg-slate-50', text: 'text-slate-600' },
};

export function SessionsBoard() {
  const { t } = useLocale();
  const [activeRole, setActiveRole] = useState<AgentRole | null>(null);
  const drawerOpen = activeRole !== null;

  const realAgents = useStore((s) => s.agentsAgg);
  const agents = useMemo<AgentSession[]>(
    () => (realAgents.length > 0 ? realAgents.map(adaptAgent) : mockAgentSessions),
    [realAgents],
  );

  return (
    <div className="h-full flex gap-5 overflow-hidden" data-testid="sessions-board">
      {/* Card grid column */}
      <div className={`${drawerOpen ? 'w-96 flex-shrink-0' : 'flex-1'} min-h-0 overflow-y-auto pr-1`}>
        <div className="flex items-baseline justify-between mb-4 px-1">
          <h2 className="text-base font-medium text-ink">{t('agents.title')}</h2>
          <span className="text-xs text-muted/70 font-sans">
            {agents.length}{t('agents.count')}
          </span>
        </div>
        <div className="space-y-3">
          {sortSessions(agents).map((s, i) => (
            <div
              key={s.role}
              className="anim-stagger"
              style={{ ['--i' as 'width']: i as unknown as string }}
            >
              <SessionCard
                session={s}
                active={activeRole === s.role}
                onClick={() => setActiveRole(activeRole === s.role ? null : s.role)}
              />
            </div>
          ))}
        </div>
      </div>

      {drawerOpen && activeRole && (
        // Use opacity-only fade (no transform) — wrapping a scroll container
        // with a transformed ancestor breaks sticky positioning inside.
        <div key={activeRole} className="flex-1 anim-fade-in min-w-0 min-h-0">
          <SessionTimelineDrawer role={activeRole} onClose={() => setActiveRole(null)} />
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session,
  active,
  onClick,
}: {
  session: AgentSession;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useLocale();
  const agent = AGENT_LABEL[session.role];
  const status = STATUS_LABEL[session.status];
  const tint = ROLE_TINT[session.role];
  const isWorking = session.status === 'working';

  const cls = [
    'w-full text-left rounded-xl px-5 py-4 lift-on-hover',
    isWorking
      ? `${tint.bgWorking} ring-1 ring-coral/20 anim-breathe`
      : active
        ? 'bg-cream shadow-cardHover ring-1 ring-warmline'
        : 'bg-cream shadow-card hover:shadow-cardHover ring-1 ring-warmline/60',
  ].join(' ');

  return (
    <button
      type="button"
      onClick={onClick}
      className={cls}
      data-testid={`session-card-${session.role}`}
      aria-pressed={active}
    >
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <span className={`w-1.5 h-6 rounded-full flex-shrink-0 ${isWorking ? 'bg-coral' : 'bg-warmline'}`} />
        <span className={`text-base font-medium ${tint.text}`}>{t(`agents.role.${session.role}`)}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted/50 font-mono">
          {session.role}
        </span>
        <span className="flex-1 min-w-0" />
        <span className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          <span className={`text-xs ${status.color} font-sans whitespace-nowrap`}>{t(`agents.status.${session.status}`)}</span>
        </span>
      </div>
      {session.currentGapTitle ? (
        <div className="text-sm text-ink/90 line-clamp-1 mb-1">
          {session.currentGapTitle}
        </div>
      ) : (
        <div className="text-sm text-muted/60 italic font-serif mb-1">{t('agents.idle')}</div>
      )}
      <div className="text-xs text-muted line-clamp-1">{session.lastTurnSummary}</div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted/60 font-mono">
        <span>{session.callsThisSession} {t('agents.calls')}</span>
        {session.turnCountThisGap > 0 && <span>· {t('agents.currentTurn', { n: session.turnCountThisGap })}</span>}
        <span>· {fmtRelative(session.lastActivityTs, t)}</span>
      </div>
    </button>
  );
}

function SessionTimelineDrawer({ role, onClose }: { role: AgentRole; onClose: () => void }) {
  const { t } = useLocale();
  const agent = AGENT_LABEL[role];
  const tint = ROLE_TINT[role];
  const turns = mockTimelinesByRole[role];

  return (
    <div
      className="h-full overflow-y-auto bg-cream rounded-xl shadow-card ring-1 ring-warmline/60"
      data-testid="session-timeline-drawer"
    >
      <div className="sticky top-0 z-10 bg-cream px-5 py-4 flex items-center justify-between rounded-t-xl border-b border-warmline/60">
        <div className="flex items-center gap-3">
          <span className={`w-1.5 h-6 rounded-full bg-coral`} />
          <span className={`font-medium text-base ${tint.text}`}>{t(`agents.role.${role}`)}</span>
          <span className="text-[10px] uppercase tracking-widest text-muted/50 font-mono">
            {role}
          </span>
          <span className="text-xs text-muted/70">{turns.length} {t('agents.timeline.calls')}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-ink transition-colors font-sans"
          aria-label={t('strip.drawer.close')}
        >
          {t('strip.drawer.close')}
        </button>
      </div>
      {turns.length === 0 ? (
        <div className="p-8 text-sm text-muted italic font-serif">{t('agents.timeline.empty')}</div>
      ) : (
        <ol className="px-5 pb-5 space-y-5">
          {turns
            .slice()
            .reverse()
            .map((te, idx) => (
              // No anim-stagger wrapper here — its transform creates a
              // containing block that breaks the drawer's sticky header.
              <TimelineEntry key={`${te.turn}-${te.ts}`} t={te} isLast={idx === 0} />
            ))}
        </ol>
      )}
    </div>
  );
}

function TimelineEntry({ t: te, isLast }: { t: SessionTurnEntry; isLast: boolean }) {
  const { t } = useLocale();
  return (
    <li
      className="relative pl-6"
      data-testid={`timeline-entry-${te.turn}`}
    >
      <span
        className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${
          isLast ? 'bg-coral shadow-glow' : 'bg-warmline'
        }`}
      />
      <span className="absolute left-[5px] top-5 bottom-0 w-px bg-warmline" />
      <div className="flex items-center gap-2 text-xs mb-2">
        <span className="font-mono text-coral font-medium">T{te.turn}</span>
        <span className="font-mono text-muted/70">{te.gapSlug}</span>
        <span className="text-muted/60 ml-auto">{fmtRelative(te.ts, t)}</span>
      </div>
      <div className="text-xs space-y-2 text-ink/85">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted/60 mb-0.5">{t('agents.timeline.input')}</div>
          <div>{te.inputSummary}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted/60 mb-0.5">{t('agents.timeline.output')}</div>
          <div>{te.outputSummary}</div>
        </div>
        {te.toolUses.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted/60 mb-0.5">{t('agents.timeline.tools')}</div>
            <div className="flex flex-wrap gap-1.5">
              {te.toolUses.slice(0, 4).map((u, i) => (
                <span key={i} className="bg-paper text-muted px-2 py-0.5 rounded-full text-[11px]">
                  {u}
                </span>
              ))}
              {te.toolUses.length > 4 && (
                <span className="text-[11px] text-muted/60">+{te.toolUses.length - 4}</span>
              )}
            </div>
          </div>
        )}
        {(te.commitSha || te.checkpointTag) && (
          <div className="pt-1 flex items-center gap-2 flex-wrap text-[11px]">
            {te.commitSha && (
              <span className="bg-sage-50 text-sage-600 px-2 py-0.5 rounded-full font-mono">
                {t('agents.timeline.commit')} {te.commitSha.slice(0, 7)}
              </span>
            )}
            {te.checkpointTag && (
              <span className="bg-coralsoft text-coral px-2 py-0.5 rounded-full font-mono">
                ⏱ {t('agents.timeline.checkpoint')}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
