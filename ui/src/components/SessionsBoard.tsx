import { useState } from 'react';
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

function fmtRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分前`;
  const h = Math.floor(m / 60);
  return `${h} 小时前`;
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
  const [activeRole, setActiveRole] = useState<AgentRole | null>(null);
  const drawerOpen = activeRole !== null;

  return (
    <div className="h-full flex gap-5 overflow-hidden" data-testid="sessions-board">
      {/* Card grid column */}
      <div className={`${drawerOpen ? 'w-96 flex-shrink-0' : 'flex-1'} overflow-y-auto pr-1`}>
        <div className="flex items-baseline justify-between mb-4 px-1">
          <h2 className="text-base font-medium text-ink">Agents</h2>
          <span className="text-xs text-muted/70 font-sans">
            {mockAgentSessions.length} 个
          </span>
        </div>
        <div className="space-y-3">
          {sortSessions(mockAgentSessions).map((s, i) => (
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
        <div key={activeRole} className="flex-1 anim-drawer-right min-w-0">
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
      <div className="flex items-center gap-3 mb-2">
        <span className={`w-1.5 h-6 rounded-full ${isWorking ? 'bg-coral' : 'bg-warmline'}`} />
        <span className={`text-base font-medium ${tint.text}`}>{agent.zh}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted/50 font-mono">
          {session.role}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          <span className={`text-xs ${status.color} font-sans`}>{status.zh}</span>
        </span>
      </div>
      {session.currentGapTitle ? (
        <div className="text-sm text-ink/90 line-clamp-1 mb-1">
          {session.currentGapTitle}
        </div>
      ) : (
        <div className="text-sm text-muted/60 italic font-serif mb-1">没在跑活</div>
      )}
      <div className="text-xs text-muted line-clamp-1">{session.lastTurnSummary}</div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted/60 font-mono">
        <span>{session.callsThisSession} 次调用</span>
        {session.turnCountThisGap > 0 && <span>· 当前 {session.turnCountThisGap} turn</span>}
        <span>· {fmtRelative(session.lastActivityTs)}</span>
      </div>
    </button>
  );
}

function SessionTimelineDrawer({ role, onClose }: { role: AgentRole; onClose: () => void }) {
  const agent = AGENT_LABEL[role];
  const tint = ROLE_TINT[role];
  const turns = mockTimelinesByRole[role];

  return (
    <div
      className="h-full overflow-y-auto bg-cream rounded-xl shadow-card ring-1 ring-warmline/60"
      data-testid="session-timeline-drawer"
    >
      <div className="sticky top-0 bg-cream px-5 py-4 flex items-center justify-between rounded-t-xl">
        <div className="flex items-center gap-3">
          <span className={`w-1.5 h-6 rounded-full bg-coral`} />
          <span className={`font-medium text-base ${tint.text}`}>{agent.zh}</span>
          <span className="text-[10px] uppercase tracking-widest text-muted/50 font-mono">
            {role}
          </span>
          <span className="text-xs text-muted/70">{turns.length} 次调用</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-ink transition-colors font-sans"
          aria-label="关闭时间轴"
        >
          收起 ✕
        </button>
      </div>
      {turns.length === 0 ? (
        <div className="p-8 text-sm text-muted italic font-serif">没有历史调用</div>
      ) : (
        <ol className="px-5 pb-5 space-y-5">
          {turns
            .slice()
            .reverse()
            .map((t, idx) => (
              <div
                key={`${t.turn}-${t.ts}`}
                className="anim-stagger"
                style={{ ['--i' as 'width']: idx as unknown as string }}
              >
                <TimelineEntry t={t} isLast={idx === 0} />
              </div>
            ))}
        </ol>
      )}
    </div>
  );
}

function TimelineEntry({ t, isLast }: { t: SessionTurnEntry; isLast: boolean }) {
  return (
    <li
      className="relative pl-6"
      data-testid={`timeline-entry-${t.turn}`}
    >
      <span
        className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${
          isLast ? 'bg-coral shadow-glow' : 'bg-warmline'
        }`}
      />
      <span className="absolute left-[5px] top-5 bottom-0 w-px bg-warmline" />
      <div className="flex items-center gap-2 text-xs mb-2">
        <span className="font-mono text-coral font-medium">T{t.turn}</span>
        <span className="font-mono text-muted/70">{t.gapSlug}</span>
        <span className="text-muted/60 ml-auto">{fmtRelative(t.ts)}</span>
      </div>
      <div className="text-xs space-y-2 text-ink/85">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted/60 mb-0.5">输入</div>
          <div>{t.inputSummary}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted/60 mb-0.5">输出</div>
          <div>{t.outputSummary}</div>
        </div>
        {t.toolUses.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted/60 mb-0.5">用了什么</div>
            <div className="flex flex-wrap gap-1.5">
              {t.toolUses.slice(0, 4).map((u, i) => (
                <span key={i} className="bg-paper text-muted px-2 py-0.5 rounded-full text-[11px]">
                  {u}
                </span>
              ))}
              {t.toolUses.length > 4 && (
                <span className="text-[11px] text-muted/60">+{t.toolUses.length - 4}</span>
              )}
            </div>
          </div>
        )}
        {(t.commitSha || t.checkpointTag) && (
          <div className="pt-1 flex items-center gap-2 flex-wrap text-[11px]">
            {t.commitSha && (
              <span className="bg-sage-50 text-sage-600 px-2 py-0.5 rounded-full font-mono">
                commit {t.commitSha.slice(0, 7)}
              </span>
            )}
            {t.checkpointTag && (
              <span className="bg-coralsoft text-coral px-2 py-0.5 rounded-full font-mono">
                ⏱ checkpoint
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
