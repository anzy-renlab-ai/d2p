export function SetupC() {
  return (
    <div className="min-h-screen bg-paper pt-10">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center gap-4">
            {['Type', 'Vision', 'Inputs', 'Preset', 'Launch'].map((s, i) => (
              <div key={s} className="flex items-center gap-4 flex-1 last:flex-initial">
                <div className={`flex items-center gap-2 ${i < 2 ? '' : i === 2 ? '' : 'opacity-50'}`}>
                  <span
                    className={`w-7 h-7 rounded-full text-xs flex items-center justify-center font-bold ${
                      i < 2 ? 'bg-forest text-cream' : i === 2 ? 'bg-coral text-cream' : 'bg-warmline text-muted'
                    }`}
                  >
                    {i < 2 ? '✓' : i + 1}
                  </span>
                  <span className="text-sm">{s}</span>
                </div>
                {i < 4 && <div className={`flex-1 h-px ${i < 2 ? 'bg-forest' : 'bg-warmline'}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Main column */}
          <main className="col-span-8 space-y-4">
            <section className="card overflow-hidden">
              <div className="card-header flex items-center justify-between">
                <span>Step 3 · Attach context <span className="text-xs text-muted ml-2 font-sans">optional</span></span>
                <span className="text-xs text-muted">vision elicitor reads these as background</span>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-3 bg-paper border border-warmline rounded-md px-4 py-2.5">
                  <span className="text-coral">📄</span>
                  <span className="font-mono text-sm">prd.md</span>
                  <span className="text-xs text-muted ml-auto">1.2 KB · 4 min ago</span>
                  <button className="text-xs text-muted hover:text-rust">remove</button>
                </div>
                <div className="border-2 border-dashed border-warmline rounded-md p-4 text-center">
                  <div className="text-sm text-muted">drop PRD / API spec / mockup notes</div>
                  <div className="text-xs text-muted/70 mt-1">or paste below</div>
                </div>
                <textarea
                  rows={4}
                  placeholder="paste markdown or text — ZeroU stores it at <demo>/.d2p/inputs/…"
                  className="input input-mono text-xs"
                />
              </div>
            </section>

            <section className="card">
              <div className="card-header">Step 4 · Override preset <span className="text-xs text-muted ml-2 font-sans">optional</span></div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <Pill label="Add custom item" hint="+ extra acceptance" />
                  <Pill label="Remove" hint="drop a preset item" />
                  <Pill label="Skip" hint="mark as done w/o impl" />
                </div>
                <p className="text-xs text-muted">
                  preset-overrides.yaml will be applied on the next differ pass.
                </p>
              </div>
            </section>

            <section className="card">
              <div className="card-header">Step 5 · Launch</div>
              <div className="p-5 flex items-center justify-between">
                <p className="text-sm text-muted leading-relaxed max-w-md">
                  ZeroU will: differ → pick gap → spin K attempts → 4-layer review → merge. Stops when preset and vision are both green.
                </p>
                <button className="px-6 py-3 bg-coral text-cream rounded-md text-sm font-semibold whitespace-nowrap">
                  Launch loop →
                </button>
              </div>
            </section>
          </main>

          {/* Right rail — context */}
          <aside className="col-span-4 space-y-4">
            <section className="card p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-2">type detected</div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-mono text-base text-coral">saas-web</span>
                <span className="text-xs text-muted">conf 0.94</span>
              </div>
              <ul className="text-xs text-muted space-y-1">
                <li>• vite + react in package.json</li>
                <li>• src/pages/ + src/api/</li>
                <li>• drizzle ORM</li>
                <li>• auth middleware</li>
              </ul>
            </section>
            <section className="card p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-2">vision excerpt</div>
              <p className="text-xs italic font-serif leading-relaxed">
                "A minimal note-taking SaaS for solo creators. Done means: magic-link auth, markdown CRUD, full-text search, one-click Vercel deploy."
              </p>
              <button className="text-xs text-coral mt-2">expand vision.md →</button>
            </section>
            <section className="card p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-2">preset preview</div>
              <div className="text-xs text-muted leading-relaxed">
                18 items will be checked: typecheck, build, tests, README, LICENSE, .env.example,
                auth flow, rate limiting, logging, deploy config, CI, error boundaries, a11y, mobile…
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Pill({ label, hint }: { label: string; hint: string }) {
  return (
    <button className="card p-3 text-left hover:border-coral transition">
      <div className="text-xs font-medium text-ink">{label}</div>
      <div className="text-[10px] text-muted mt-0.5">{hint}</div>
    </button>
  );
}
