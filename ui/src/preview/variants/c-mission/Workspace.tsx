import { useState } from 'react';
import {
  mockPresetItemsRich,
  mockCostBuckets,
  mockCacheHitPct,
  type MockPresetItem,
  type MockMechanism,
  type MockCostBucket,
} from '../../../mock/data.js';

export function WorkspaceC() {
  const [rightTab, setRightTab] = useState<'stream' | 'preset'>('stream');
  const items = mockPresetItemsRich.filter((i) => i.appliesTo.includes('W'));
  const done = items.filter((i) => i.status === 'done').length;
  const pct = Math.round((done / items.length) * 100);
  return (
    <div className="h-screen bg-paper flex flex-col pt-10">
      {/* F3 pathology row — surfaces detected agent failure modes
          (fixation / thrash / critic-bias / runaway-cost) before the user
          notices something feels wrong. Inspired by publicly-documented
          Devin / Replit failure signatures. */}
      <PathologyBar />

      {/* Top bar — mission status */}
      <header className="border-b border-warmline bg-cream px-6 py-3 grid grid-cols-12 gap-4 items-center">
        <div className="col-span-3">
          <div className="text-[10px] uppercase tracking-widest text-muted">mission</div>
          <div className="font-mono text-sm truncate">D:\demos\notes-saas</div>
        </div>
        <div className="col-span-1"><Big label="elapsed" v="41m" /></div>
        <div className="col-span-1"><Big label="merged" v="2" color="text-forest" /></div>
        <div className="col-span-1"><Big label="inflight" v="1" color="text-coral" /></div>
        <div className="col-span-1"><Big label="queue" v="4" /></div>
        <div className="col-span-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">preset · {done} / {items.length}</div>
          <Gauge pct={pct} />
        </div>
        <div className="col-span-1">
          <Big label="spend" v="$1.27" />
          <div className="text-[9px] text-forest mt-0.5">cache · {mockCacheHitPct()}%</div>
          <BudgetCapBar spentUsd={1.27} softUsd={5} hardUsd={10} />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <button className="px-3 py-1.5 border border-warmline text-xs rounded-md hover:border-coral">Pause ⏸</button>
          <button className="px-3 py-1.5 text-muted text-xs hover:text-ink">⚙</button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-12 gap-3 p-3 overflow-hidden">
        {/* Left — gap board */}
        <aside className="col-span-3 card overflow-hidden flex flex-col">
          <div className="card-header text-sm flex items-center justify-between">
            <span>Gap board</span>
            <span className="text-xs text-muted">8</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Lane label="In flight" tint="coral">
              <GapCard slug="add-observability-logging" sev="P1" attempt="1/3" hot />
            </Lane>
            <Lane label="Up next" tint="default">
              <GapCard slug="deploy-config-vercel" sev="P1" />
              <GapCard slug="rate-limit-auth-endpoints" sev="P2" />
              <GapCard slug="error-boundary-react" sev="P2" />
            </Lane>
            <Lane label="Needs human" tint="rust">
              <GapCard slug="mobile-workspace-responsive" sev="P2" warn />
            </Lane>
            <Lane label="Merged" tint="forest" small>
              <GapCard slug="add-license-mit" sev="P3" done />
              <GapCard slug="env-example-template" sev="P3" done />
            </Lane>
          </div>
        </aside>

        {/* Center top — current attempt detail */}
        <section className="col-span-6 flex flex-col gap-3 overflow-hidden">
          <div className="card overflow-hidden flex-1 flex flex-col">
            <div className="card-header flex items-center justify-between">
              <span>Current attempt · <span className="text-coral font-mono text-xs">add-observability-logging</span></span>
              <span className="text-xs text-muted">attempt 1 of 3 · 38s</span>
            </div>
            <div className="p-5 flex-1 overflow-y-auto">
              <p className="text-sm leading-relaxed text-ink mb-4">
                Every API request should emit a JSON log with <code>request_id</code>, <code>route</code>, <code>status</code>, <code>duration_ms</code>.
              </p>

              {/* F1 — cross-engine critic strip: worker engine vs critic engine,
                  + cross-family flag so the user can see at-a-glance whether
                  reviewers are decorrelated from the actor. */}
              <div className="mb-4 flex items-center gap-2 text-xs">
                <span className="text-[10px] uppercase tracking-widest text-muted">engines</span>
                <EnginePill role="worker" family="claude" name="claude-cli · sonnet" />
                <span className="text-muted">→</span>
                <EnginePill role="critic" family="openai-compat" name="minimax · M2" />
                <CrossFamilyBadge crossFamily={true} />
              </div>

              <div className="text-[10px] uppercase tracking-widest text-muted mb-2">pipeline</div>
              <div className="space-y-2">
                <Stage n="1" name="implementer" model="sonnet" engine="claude-cli" role="worker" status="done" time="27s" />
                <Stage n="2" name="static gate"  model="local"  engine="—"          role="local"  status="done" time="3s" />
                <Stage n="3" name="alignment review"  model="M2" engine="minimax"     role="critic" status="running" time="8s" />
                <Stage n="4" name="behavioral review" model="M2" engine="minimax"     role="critic" status="queued" />
              </div>
              <div className="mt-5 text-[10px] uppercase tracking-widest text-muted mb-2">files touched</div>
              <ul className="text-xs font-mono space-y-1 text-muted">
                <li>+ src/middleware/logger.ts (38 lines)</li>
                <li>~ src/server.ts (+4 lines)</li>
                <li>~ package.json (+1 dep · pino)</li>
              </ul>
            </div>
          </div>

          {/* Center bottom — sparklines + F4 spend attribution */}
          <div className="card p-4 grid grid-cols-12 gap-6">
            <div className="col-span-3">
              <Spark label="merges / hour" pts={[0, 0, 1, 1, 2, 2, 2, 2]} />
            </div>
            <div className="col-span-3">
              <Spark label="alignment score" pts={[0, 0.6, 0.92, 0.97, 0.97, 0.91, 0.93, 0.94]} color="forest" />
            </div>
            <div className="col-span-6">
              <SpendAttribution />
            </div>
          </div>
        </section>

        {/* Right — tabbed: live stream | preset breakdown */}
        <aside className="col-span-3 card overflow-hidden flex flex-col">
          <div className="card-header flex items-stretch p-0">
            <button
              onClick={() => setRightTab('stream')}
              className={`flex-1 px-4 py-2.5 text-sm flex items-center justify-between transition-colors ${
                rightTab === 'stream' ? 'bg-cream border-b-2 border-coral' : 'bg-paper text-muted hover:text-ink'
              }`}
            >
              <span>Live stream</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-coral">
                <span className="w-1.5 h-1.5 rounded-full bg-coral animate-pulse" /> 32
              </span>
            </button>
            <button
              onClick={() => setRightTab('preset')}
              className={`flex-1 px-4 py-2.5 text-sm flex items-center justify-between transition-colors border-l border-warmline ${
                rightTab === 'preset' ? 'bg-cream border-b-2 border-coral' : 'bg-paper text-muted hover:text-ink'
              }`}
            >
              <span>Preset</span>
              <span className="text-xs text-muted">{done}/{items.length}</span>
            </button>
          </div>

          {rightTab === 'stream' && (
            <div className="flex-1 overflow-y-auto p-2 text-[11px] font-mono leading-relaxed space-y-0">
              <Stream t="00:00:14" k="LOOP_STARTED" />
              <Stream t="00:00:34" k="DIFF_PRODUCED" p="+11" />
              <Stream t="00:00:39" k="FIX_COMMITTED" p="a1b2c3d" />
              <Stream t="00:00:52" k="MERGED" p="a1b2c3d" ok />
              <Stream t="00:01:14" k="GAP_PICKED" p="env-example" />
              <Stream t="00:01:32" k="MERGED" p="b2c3d4e" ok />
              <Stream t="00:01:45" k="GAP_PICKED" p="obs-logging" hi />
              <Stream t="00:01:46" k="WORKTREE_CREATED" />
              <Stream t="00:01:48" k="AGENT_START" p="implementer/sonnet" />
              <Stream t="00:02:15" k="FIX_COMMITTED" p="c3d4e5f" />
              <Stream t="00:02:18" k="STATIC_GATE" p="✓" ok />
              <Stream t="00:02:21" k="AGENT_START" p="alignment/haiku" active />
            </div>
          )}

          {rightTab === 'preset' && (
            <div className="flex-1 overflow-y-auto p-3">
              <div className="text-[10px] text-muted mb-2 leading-relaxed">
                {done} done · {items.filter((i) => i.status === 'partial').length} partial · {items.filter((i) => i.status === 'missing').length} missing · grounded in 12-Factor, OWASP 2025, SRE, WCAG, OpenSSF
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                <LegendDot mech="static-grep" />
                <span className="text-[9px] text-muted mr-2">static-grep</span>
                <LegendDot mech="file-exists" />
                <span className="text-[9px] text-muted mr-2">file</span>
                <LegendDot mech="test-execution" />
                <span className="text-[9px] text-muted mr-2">test</span>
                <LegendDot mech="cross-file-cohesion" />
                <span className="text-[9px] text-muted mr-2">cross-file</span>
                <LegendDot mech="llm-judgment" />
                <span className="text-[9px] text-muted">llm</span>
              </div>
              <ul className="space-y-1">
                {items.map((it) => <PresetRow key={it.id} item={it} />)}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

const MECH_COLOR: Record<MockMechanism, string> = {
  'static-grep':          'bg-muted/20 text-muted border-muted/40',
  'file-exists':          'bg-warmline text-ink border-warmline',
  'test-execution':       'bg-forest/15 text-forest border-forest/40',
  'cross-file-cohesion':  'bg-coral/15 text-coral border-coral/40',
  'llm-judgment':         'bg-ink/10 text-ink border-ink/40',
};

function LegendDot({ mech }: { mech: MockMechanism }) {
  return <span className={`inline-block w-2 h-2 rounded-sm border ${MECH_COLOR[mech]}`} />;
}

function PresetRow({ item }: { item: MockPresetItem }) {
  const icon = item.status === 'done' ? '✓' : item.status === 'partial' ? '◐' : '○';
  const iconColor =
    item.status === 'done' ? 'text-forest' : item.status === 'partial' ? 'text-coral' : 'text-rust';
  return (
    <li
      title={`${item.label}\n${item.severity} · ${item.source}${item.note ? '\n' + item.note : ''}`}
      className="flex items-center gap-1.5 text-[11px] font-mono leading-tight"
    >
      <span className={`${iconColor} w-3 shrink-0`}>{icon}</span>
      <span className="text-[9px] text-muted w-5 shrink-0">{item.severity}</span>
      <span className={`inline-block w-2 h-2 rounded-sm border shrink-0 ${MECH_COLOR[item.mechanism]}`} title={item.mechanism} />
      <span className="truncate text-ink">{item.id}</span>
    </li>
  );
}

function Big({ label, v, color }: { label: string; v: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color ?? 'text-ink'}`}>{v}</div>
    </div>
  );
}
function Gauge({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 mt-1.5 bg-paper rounded-full overflow-hidden border border-warmline">
      <div className="h-full bg-coral" style={{ width: `${pct}%` }} />
    </div>
  );
}
function Lane({ label, tint, small, children }: { label: string; tint: string; small?: boolean; children: React.ReactNode }) {
  const bg = tint === 'coral' ? 'bg-coralsoft/30' : tint === 'forest' ? 'bg-forest/10' : tint === 'rust' ? 'bg-rust/10' : 'bg-paper';
  return (
    <div className={small ? 'opacity-80' : ''}>
      <div className={`px-3 py-1 ${bg} text-[10px] uppercase tracking-wider text-muted font-medium`}>{label}</div>
      <div className="space-y-1 p-1.5">{children}</div>
    </div>
  );
}
function GapCard({ slug, sev, attempt, hot, done, warn }: { slug: string; sev: string; attempt?: string; hot?: boolean; done?: boolean; warn?: boolean }) {
  const border = hot ? 'border-coral' : done ? 'border-forest/40' : warn ? 'border-rust/40' : 'border-warmline';
  const bg = hot ? 'bg-coralsoft/50' : done ? 'bg-forest/5' : warn ? 'bg-rust/5' : 'bg-cream';
  return (
    <div className={`${bg} ${border} border rounded-md p-2.5 cursor-pointer hover:border-coral transition`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted">{sev}</span>
        {attempt && <span className="text-[10px] text-coral">{attempt}</span>}
        {done && <span className="text-[10px] text-forest">✓ merged</span>}
        {warn && <span className="text-[10px] text-rust">need human</span>}
      </div>
      <div className="text-xs font-mono text-ink mt-1 truncate">{slug}</div>
    </div>
  );
}
function Stage({ n, name, model, engine, role, status, time }: {
  n: string; name: string; model: string; engine: string; role: 'worker' | 'critic' | 'local'; status: string; time?: string;
}) {
  const icon = status === 'done' ? '✓' : status === 'running' ? '⟳' : '·';
  const color = status === 'done' ? 'text-forest' : status === 'running' ? 'text-coral' : 'text-muted/60';
  const roleColor =
    role === 'worker' ? 'text-coral bg-coralsoft/40' :
    role === 'critic' ? 'text-ink bg-warmline' :
    'text-muted bg-paper';
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${color} border border-current ${status === 'running' ? 'animate-spin' : ''}`}>{icon}</span>
      <span className="flex-1 flex items-baseline gap-2">
        <span className="text-ink">{name}</span>
        {role !== 'local' && (
          <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${roleColor}`}>{role}</span>
        )}
        <span className="text-xs text-muted">{engine !== '—' ? `${engine} · ${model}` : model}</span>
      </span>
      <span className="text-xs text-muted tabular-nums">{time ?? '—'}</span>
    </div>
  );
}

function BudgetCapBar({ spentUsd, softUsd, hardUsd }: { spentUsd: number; softUsd: number; hardUsd: number }) {
  const pct = Math.min((spentUsd / hardUsd) * 100, 100);
  const softPct = (softUsd / hardUsd) * 100;
  const overSoft = spentUsd >= softUsd;
  const overHard = spentUsd >= hardUsd;
  return (
    <div className="mt-1.5" title={`spent $${spentUsd.toFixed(2)} · soft $${softUsd} · hard $${hardUsd}`}>
      <div className="relative h-1 bg-paper border border-warmline rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${overHard ? 'bg-rust' : overSoft ? 'bg-coral' : 'bg-forest'}`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-px bg-coral/60"
          style={{ left: `${softPct}%` }}
          title={`soft cap $${softUsd}`}
        />
      </div>
      <div className="flex justify-between text-[9px] text-muted/70 mt-0.5">
        <span>$0</span>
        <span className="text-coral/70">soft ${softUsd}</span>
        <span>${hardUsd}</span>
      </div>
    </div>
  );
}

function SpendAttribution() {
  const totalUsd = mockCostBuckets.reduce((s, b) => s + b.usd, 0);
  const totalIn  = mockCostBuckets.reduce((s, b) => s + b.inputTokens, 0);
  const totalCache = mockCostBuckets.reduce((s, b) => s + b.cacheReadTokens, 0);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-muted">spend attribution</span>
        <span className="text-xs text-muted">${totalUsd.toFixed(2)} · cache <span className="text-forest">{Math.round((totalCache / Math.max(totalIn, 1)) * 100)}%</span></span>
      </div>
      <div className="space-y-1">
        {mockCostBuckets.filter((b) => b.usd > 0).map((b) => <SpendRow key={`${b.role}-${b.engine}`} b={b} max={totalUsd} />)}
      </div>
    </div>
  );
}

function SpendRow({ b, max }: { b: MockCostBucket; max: number }) {
  const pct = Math.max((b.usd / max) * 100, 1);
  const cachePct = b.inputTokens > 0 ? (b.cacheReadTokens / b.inputTokens) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 text-muted shrink-0 truncate">{b.role}</span>
      <span className="w-14 text-[10px] text-muted/70 font-mono shrink-0">{b.engine}</span>
      <div className="flex-1 h-3 bg-paper border border-warmline rounded relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-coral/80"
          style={{ width: `${pct}%` }}
        />
        {cachePct > 0 && (
          <div
            className="absolute inset-y-0 left-0 bg-forest/40"
            style={{ width: `${pct * (cachePct / 100)}%` }}
            title={`${Math.round(cachePct)}% from cache`}
          />
        )}
      </div>
      <span className="w-14 text-right text-ink tabular-nums font-mono shrink-0">${b.usd.toFixed(2)}</span>
    </div>
  );
}

function PathologyBar() {
  // Mock-state: one warning + one info, two clean. In production these come
  // from PATHOLOGY_DETECTED SSE events emitted by the daemon's pathology
  // detector (health/pathology.ts).
  const pathologies = [
    {
      id: 'fixation',
      label: 'Fixation',
      level: 'warn' as const,
      detail: 'mobile-workspace-responsive · 3 attempts in a row hit the same files w/ reviewer rejection',
    },
    {
      id: 'critic-bias',
      label: 'Critic bias',
      level: 'info' as const,
      detail: 'reviewer agreement rate 0.42 over last 8 attempts — consider adding 2nd engine',
    },
    { id: 'thrash',        label: 'Thrash',        level: 'ok' as const, detail: '0 reverts in 30m' },
    { id: 'runaway-cost',  label: 'Cost runaway',  level: 'ok' as const, detail: '$0.03/min · within budget' },
  ];
  return (
    <div className="bg-paper border-b border-warmline px-6 py-2 flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest text-muted mr-1">agent health</span>
      {pathologies.map((p) => <PathologyBadge key={p.id} {...p} />)}
      <span className="ml-auto text-[10px] text-muted/70 italic font-serif">grounded in Devin/Replit failure signatures</span>
    </div>
  );
}

function PathologyBadge({ label, level, detail }: { label: string; level: 'ok' | 'info' | 'warn' | 'crit'; detail: string }) {
  const styles = {
    ok:   'bg-forest/10 text-forest border-forest/30',
    info: 'bg-coralsoft/40 text-coral border-coral/40',
    warn: 'bg-coral/15 text-coral border-coral/50 ring-1 ring-coral/30',
    crit: 'bg-rust/10 text-rust border-rust/50 ring-2 ring-rust/40 animate-pulse',
  }[level];
  const icon = { ok: '✓', info: '·', warn: '⚠', crit: '⚡' }[level];
  return (
    <span
      title={detail}
      className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border ${styles} cursor-pointer`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

function EnginePill({ role, family, name }: { role: 'worker' | 'critic'; family: string; name: string }) {
  const bg = role === 'worker' ? 'bg-coralsoft/50 border-coral/40 text-ink' : 'bg-warmline/50 border-warmline text-ink';
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-xs px-2 py-1 rounded-md border ${bg}`}>
      <span className="text-[9px] uppercase tracking-wider text-muted">{role}</span>
      <span className="font-mono">{name}</span>
      <span className="text-[9px] text-muted/70">{family}</span>
    </span>
  );
}

function CrossFamilyBadge({ crossFamily }: { crossFamily: boolean }) {
  return crossFamily ? (
    <span
      title="reviewer engine family is different from worker — bias decorrelated (OpenHands Critic pattern)"
      className="inline-flex items-center gap-1 text-[10px] text-forest border border-forest/40 bg-forest/10 px-2 py-1 rounded-md cursor-default"
    >
      <span>✓</span> cross-family
    </span>
  ) : (
    <span
      title="reviewer + worker share an engine family — bias risk; add a 2nd engine in Settings to enable decorrelation"
      className="inline-flex items-center gap-1 text-[10px] text-rust border border-rust/40 bg-rust/10 px-2 py-1 rounded-md cursor-default"
    >
      <span>!</span> cross-family off
    </span>
  );
}
function Spark({ label, pts, color }: { label: string; pts: number[]; color?: 'coral' | 'forest' }) {
  const max = Math.max(...pts, 0.01);
  const w = 120;
  const h = 30;
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i / (pts.length - 1)) * w} ${h - (v / max) * h}`).join(' ');
  const stroke = color === 'coral' ? '#C96442' : color === 'forest' ? '#587A4C' : '#1F1F1E';
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-muted">{label}</span>
        <span className="text-xs font-semibold tabular-nums">{pts[pts.length - 1]?.toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8">
        <path d={path} stroke={stroke} strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}
function Stream({ t, k, p, ok, hi, active }: { t: string; k: string; p?: string; ok?: boolean; hi?: boolean; active?: boolean }) {
  const cls = ok ? 'text-forest' : hi ? 'text-coral' : 'text-ink/85';
  return (
    <div className={`${active ? 'bg-coralsoft/30 -mx-2 px-2' : ''}`}>
      <span className="text-muted/60">{t}</span>{'  '}
      <span className={cls}>{k}</span>
      {p && <span className="text-muted ml-1">· {p}</span>}
      {active && <span className="text-coral animate-pulse"> ▌</span>}
    </div>
  );
}
