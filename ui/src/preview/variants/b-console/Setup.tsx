export function SetupB() {
  return (
    <div className="min-h-screen bg-ink text-cream font-mono pt-10">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="text-[11px] text-cream/50 mb-1">
          session #7 · D:\demos\notes-saas · SETUP
        </div>
        <div className="text-2xl mb-8">$ <span className="text-coral">zerou setup</span></div>

        <div className="space-y-6">
          <Block step="1" title="DETECT" status="DONE">
            <Row k="type" v="saas-web" hi />
            <Row k="confidence" v="0.94" />
            <Row k="evidence" v="package.json: vite + react" />
            <Row k="" v="src/pages/ + src/api/ split" />
            <Row k="" v="drizzle ORM in src/db/" />
            <Row k="" v="auth middleware in src/middleware/auth.ts" />
            <div className="mt-2 text-coral text-xs">[✓] type confirmed</div>
          </Block>

          <Block step="2" title="ELICIT VISION" status="DONE">
            <Row k="round" v="3 of 5 (finalized early)" />
            <Row k="output" v=".d2p/vision.md (834 bytes)" />
            <div className="mt-2 bg-cream/5 border-l-2 border-coral pl-3 py-2 text-xs text-cream/80 whitespace-pre-line leading-relaxed">
{`# Vision — notes-saas
A minimal note-taking SaaS for solo creators.
## Done means
- magic-link auth
- markdown CRUD + full-text search
- one-click Vercel deploy
- free 100 / paid unlimited
## Not in scope (yet)
- mobile app
- real-time collab`}
            </div>
          </Block>

          <Block step="3" title="ATTACH INPUTS" status="optional" small>
            <Row k="prd.md" v="1.2KB · attached" />
            <Row k="api-spec.yaml" v="—" />
            <div className="mt-2 text-xs text-cream/50">[+ paste more]</div>
          </Block>

          <Block step="4" title="OVERRIDE PRESET" status="optional" small>
            <Row k="add"    v="[]" />
            <Row k="remove" v="[]" />
            <Row k="skip"   v="[]" />
            <div className="mt-2 text-xs text-cream/50">[edit preset-overrides.yaml]</div>
          </Block>

          <Block step="5" title="LAUNCH LOOP" status="READY">
            <div className="text-xs text-cream/70 leading-relaxed">
              ⏵ zerou will differ → pick gap → K attempts → review → merge → repeat<br/>
              ⏵ daemon survives tab close; SSE reconnects on refresh<br/>
              ⏵ stop: ⌃C at any time, or click Pause; resume from where it stopped
            </div>
            <button className="mt-4 px-5 py-2 bg-coral text-ink rounded-sm text-xs font-bold tracking-wider uppercase">
              Start loop ↵
            </button>
          </Block>
        </div>
      </div>
    </div>
  );
}

function Block({ step, title, status, children, small }: { step: string; title: string; status: string; children: React.ReactNode; small?: boolean }) {
  const color = status === 'DONE' ? 'text-forest' : status === 'READY' ? 'text-coral' : 'text-cream/40';
  return (
    <section className={`border border-cream/15 rounded-md ${small ? 'opacity-70' : ''}`}>
      <header className="px-4 py-2 border-b border-cream/15 bg-cream/5 flex items-center justify-between text-xs">
        <span><span className="text-cream/40">[{step}]</span> <span className="tracking-wider">{title}</span></span>
        <span className={`${color} font-bold tracking-widest`}>{status}</span>
      </header>
      <div className="px-4 py-3 text-xs">{children}</div>
    </section>
  );
}

function Row({ k, v, hi }: { k: string; v: string; hi?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 leading-relaxed">
      <span className="text-cream/40 w-28 shrink-0">{k}</span>
      <span className={hi ? 'text-coral font-bold' : 'text-cream/85'}>{v}</span>
    </div>
  );
}
