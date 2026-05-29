export function SetupA() {
  return (
    <div className="min-h-screen bg-paper pt-12">
      <div className="max-w-2xl mx-auto py-12 px-6">
        <div className="text-xs font-mono text-coral uppercase tracking-[0.2em] mb-3">
          session 7 · setup
        </div>
        <h1 className="text-4xl tracking-tight mb-2">Tell ZeroU what you want.</h1>
        <p className="text-muted font-serif italic mb-12">
          Three steps. The first two are short.
        </p>

        <article className="mb-14">
          <header className="flex items-baseline gap-4 mb-4">
            <span className="font-serif text-5xl text-coral leading-none">1</span>
            <div>
              <h2 className="text-2xl font-serif">Project type</h2>
              <p className="text-sm text-muted">detector confidence 0.94</p>
            </div>
          </header>
          <div className="pl-16">
            <div className="text-sm text-ink mb-3">
              <span className="font-mono bg-coralsoft/40 px-2 py-1 rounded">saas-web</span>
            </div>
            <ul className="text-sm text-muted leading-relaxed list-['—_'] pl-4 space-y-1">
              <li>package.json declares vite + react</li>
              <li>src/pages/ + src/api/ split typical of SaaS app</li>
              <li>Drizzle ORM schemas in src/db/</li>
              <li>Auth middleware in src/middleware/auth.ts</li>
            </ul>
            <div className="mt-4 text-sm text-forest">✓ confirmed · saas-web</div>
          </div>
        </article>

        <article className="mb-14">
          <header className="flex items-baseline gap-4 mb-4">
            <span className="font-serif text-5xl text-coral leading-none">2</span>
            <div>
              <h2 className="text-2xl font-serif">Vision</h2>
              <p className="text-sm text-muted">round 3 of 5 · finalized</p>
            </div>
          </header>
          <div className="pl-16">
            <div className="text-sm text-forest mb-4">✓ vision.md written</div>
            <blockquote className="border-l-2 border-coral pl-5 py-2 text-sm font-serif text-ink/90 leading-relaxed italic">
              A minimal note-taking SaaS for solo creators.
              <br />
              Done means: magic-link auth, markdown CRUD, full-text search,
              one-click Vercel deploy, free 100 + paid unlimited.
            </blockquote>
          </div>
        </article>

        <article>
          <header className="flex items-baseline gap-4 mb-4">
            <span className="font-serif text-5xl text-coral leading-none">3</span>
            <div>
              <h2 className="text-2xl font-serif">Begin</h2>
              <p className="text-sm text-muted">ZeroU takes over from here</p>
            </div>
          </header>
          <div className="pl-16">
            <p className="text-sm text-muted leading-relaxed mb-5">
              Close this tab if you want. The daemon keeps working.
              It'll stop when preset and vision are both green.
            </p>
            <button className="px-7 py-3 bg-coral text-cream rounded-full text-sm font-medium hover:bg-coralhover">
              Start the loop →
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
