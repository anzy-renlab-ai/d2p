import { mockPresetItemsRich, type MockPresetItem, type MockMechanism } from '../../../mock/data.js';

export function DoneC() {
  // On the done page all preset items have flipped to 'done' (double-green).
  const items = mockPresetItemsRich
    .filter((i) => i.appliesTo.includes('W'))
    .map((i) => ({ ...i, status: 'done' as const }));
  return (
    <div className="min-h-screen bg-paper pt-10">
      <div className="max-w-5xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between">
          <div>
            <div className="text-xs font-mono text-forest uppercase tracking-widest mb-2">mission complete · double-green</div>
            <h1 className="text-4xl tracking-tight">notes-saas <span className="text-muted font-serif italic">is product.</span></h1>
            <p className="text-sm text-muted mt-1 font-mono">D:\demos\notes-saas · session 7 · 41m 02s</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-4 py-2 border border-warmline text-sm rounded-md hover:border-coral">summary.md</button>
            <button className="px-5 py-2 bg-coral text-cream text-sm rounded-md font-semibold">New session</button>
          </div>
        </header>

        {/* KPI strip */}
        <section className="grid grid-cols-5 gap-3 mb-6">
          <Kpi label="preset" v="18 / 18" pct={100} ok />
          <Kpi label="vision" v="YES" sub="reviewer verdict" ok />
          <Kpi label="gaps merged" v="13" sub="3 escalated to splits" />
          <Kpi label="tokens" v="612k" sub="487k in · 125k out" />
          <Kpi label="spend" v="$1.27" sub="haiku 72% · sonnet 26%" />
        </section>

        <div className="grid grid-cols-12 gap-6">
          <main className="col-span-8 space-y-6">
            <section className="card">
              <div className="card-header">Merged · 13</div>
              <ul className="divide-y divide-warmline">
                {[
                  ['add-observability-logging', 'P1', 'observability', 'c3d4e5f'],
                  ['deploy-config-vercel', 'P1', 'deploy', 'f6a7b8c'],
                  ['rate-limit-auth-endpoints', 'P2', 'security', 'd4e5f6a'],
                  ['error-boundary-react', 'P2', 'reliability', 'e5f6a7b'],
                  ['a11y-baseline', 'P2', 'ux', 'a7b8c9d'],
                  ['readme-quickstart', 'P3', 'docs', 'b8c9d0e'],
                  ['env-example-template', 'P3', 'docs', 'b2c3d4e'],
                  ['add-license-mit', 'P3', 'docs', 'a1b2c3d'],
                ].map(([slug, sev, cat, sha]) => (
                  <li key={slug} className="px-5 py-3 flex items-center justify-between text-sm">
                    <div className="flex items-baseline gap-3">
                      <span className="text-[10px] font-mono text-muted w-6">{sev}</span>
                      <span className="font-mono">{slug}</span>
                      <span className="text-xs text-muted">{cat}</span>
                    </div>
                    <code className="text-xs text-muted">{sha}</code>
                  </li>
                ))}
                <li className="px-5 py-3 text-xs text-muted/70 italic">+ 5 smaller items merged silently</li>
              </ul>
            </section>

            <section className="card">
              <div className="card-header">Deploy</div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <DeployTarget name="Vercel" conf={0.92} cmd="npx vercel --prod" />
                <DeployTarget name="GitHub Actions" conf={0.88} cmd="git push origin main" />
              </div>
            </section>
          </main>

          <aside className="col-span-4 space-y-4">
            <section className="card p-5">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-2">left for you · 1</div>
              <div className="border-l-2 border-rust pl-3 py-1">
                <div className="text-sm font-mono text-rust mb-1">mobile-workspace-responsive</div>
                <p className="text-xs text-muted leading-relaxed">
                  Reviewer escalated: collapse-to-tabs vs vertical-stack is a UX call. Open vision.md, decide, and d2p will pick it back up.
                </p>
              </div>
            </section>

            <section className="card p-5">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-3">Vision verdict</div>
              <blockquote className="text-sm italic font-serif leading-relaxed border-l-2 border-coral pl-3">
                "The product covers the stated done-conditions: magic-link auth, markdown CRUD, full-text search, Vercel deploy. Free/paid quotas in place."
              </blockquote>
              <div className="mt-3 text-xs text-forest font-mono">— done-check · sonnet · YES</div>
            </section>

            <section className="card p-5">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-3">Commit graph</div>
              <pre className="text-[10px] leading-tight font-mono text-muted">{`* f6a7b8c  feat: vercel deploy config
* e5f6a7b  fix: react error boundary
* d4e5f6a  feat: per-IP rate limit
* c3d4e5f  feat: structured logging
* b2c3d4e  docs: .env.example
* a1b2c3d  chore: MIT LICENSE
* (root)   initial demo`}</pre>
            </section>
          </aside>
        </div>

        {/* Preset breakdown — what was actually checked and how */}
        <section className="card mt-6">
          <div className="card-header flex items-center justify-between">
            <span>Preset breakdown · <span className="text-forest font-mono text-xs">{items.length} / {items.length}</span></span>
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <LegendDot mech="static-grep" /> static-grep
              <LegendDot mech="file-exists" /> file-exists
              <LegendDot mech="test-execution" /> test-exec
              <LegendDot mech="cross-file-cohesion" /> cross-file
              <LegendDot mech="llm-judgment" /> llm-judgment
            </div>
          </div>
          <div className="p-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted">
                  <th className="text-left pb-2 font-medium">item</th>
                  <th className="text-left pb-2 font-medium w-24">severity</th>
                  <th className="text-left pb-2 font-medium w-32">mechanism</th>
                  <th className="text-left pb-2 font-medium w-32">source</th>
                  <th className="text-right pb-2 font-medium w-16">status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warmline">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-paper">
                    <td className="py-2">
                      <div className="font-mono">{it.id}</div>
                      <div className="text-[10px] text-muted">{it.label}</div>
                    </td>
                    <td><span className="font-mono">{it.severity}</span></td>
                    <td>
                      <span className={`inline-block px-2 py-0.5 rounded border ${MECH_COLOR[it.mechanism]}`}>
                        {it.mechanism}
                      </span>
                    </td>
                    <td className="font-mono text-muted">{it.source}</td>
                    <td className="text-right text-forest">✓</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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

function Kpi({ label, v, sub, pct, ok }: { label: string; v: string; sub?: string; pct?: number; ok?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${ok ? 'text-forest' : 'text-ink'} tabular-nums`}>{v}</div>
      {pct !== undefined && (
        <div className="h-1 bg-paper border border-warmline rounded-full overflow-hidden mt-2">
          <div className="h-full bg-forest" style={{ width: `${pct}%` }} />
        </div>
      )}
      {sub && <div className="text-[11px] text-muted mt-1.5">{sub}</div>}
    </div>
  );
}
function DeployTarget({ name, conf, cmd }: { name: string; conf: number; cmd: string }) {
  return (
    <div className="border border-warmline rounded-md p-3 bg-paper">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-medium text-sm">{name}</span>
        <span className="text-xs text-muted">conf {Math.round(conf * 100)}%</span>
      </div>
      <code className="block bg-cream border border-warmline rounded px-2 py-1 text-xs font-mono">{cmd}</code>
    </div>
  );
}
