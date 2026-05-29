export function LandingC() {
  return (
    <div className="min-h-screen bg-paper pt-10">
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="grid grid-cols-12 gap-4">
          {/* Hero left */}
          <section className="col-span-7 card p-8 relative overflow-hidden">
            <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-coralsoft/40" />
            <div className="absolute -right-4 bottom-8 w-32 h-32 rounded-full border border-coral/20" />
            <div className="relative">
              <div className="text-xs font-mono text-coral uppercase tracking-widest mb-3">mission control · v0.1.0</div>
              <h1 className="text-6xl tracking-tight leading-none mb-3">ZeroU</h1>
              <p className="text-lg text-muted leading-snug max-w-md">
                Aim a demo at a vision.<br />
                Watch a clinic of agents <em>and</em> reviewers walk it to product.
              </p>

              <div className="mt-10 space-y-3">
                <div>
                  <label className="label">Target demo folder</label>
                  <input
                    type="text"
                    placeholder="D:\demos\notes-saas"
                    className="input input-mono py-3 text-base"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <span className="px-2 py-0.5 bg-cream rounded border border-warmline">claude-cli</span>
                    <span className="px-2 py-0.5 bg-cream rounded border border-warmline">local-merge</span>
                    <span className="px-2 py-0.5 bg-cream rounded border border-warmline">K=2</span>
                  </div>
                  <button className="px-6 py-2.5 bg-coral text-cream rounded-md text-sm font-semibold hover:bg-coralhover">
                    Launch mission →
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Quick-spec right */}
          <aside className="col-span-5 space-y-4">
            <div className="card p-5">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-3">how it works</div>
              <ol className="text-sm space-y-2.5">
                <Step n="1" t="Detect" sub="haiku scans repo for type signal" />
                <Step n="2" t="Elicit" sub="multi-round vision Q+A (5 rounds max)" />
                <Step n="3" t="Loop" sub="differ → K attempts → 4-layer review → merge" />
                <Step n="4" t="Verify" sub="double-green stop: preset AND vision satisfied" />
              </ol>
            </div>

            <div className="card p-5">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-3">daemon health</div>
              <div className="space-y-1.5 text-sm font-mono">
                <Health label="claude-cli" v="2.1.81" ok />
                <Health label="git"        v="2.51.2" ok />
                <Health label="sqlite"     v="state.db" ok />
                <Health label="prompts"    v="v1"      ok />
              </div>
            </div>

            <div className="card p-4 bg-coralsoft/30">
              <div className="text-xs text-ink leading-relaxed">
                <strong>New here?</strong> Try the included fixture:
                <code className="block mt-1 bg-cream rounded px-2 py-1 text-[11px]">d:\lll\d2p\fixtures\demo-cli</code>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Step({ n, t, sub }: { n: string; t: string; sub: string }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="w-5 h-5 rounded-full bg-coralsoft text-coral text-[10px] font-bold flex items-center justify-center shrink-0">{n}</span>
      <span>
        <span className="text-ink font-medium">{t}</span>
        <span className="text-muted text-xs ml-2">— {sub}</span>
      </span>
    </li>
  );
}
function Health({ label, v, ok }: { label: string; v: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-ink">{v}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-forest' : 'bg-rust'}`} />
      </span>
    </div>
  );
}
