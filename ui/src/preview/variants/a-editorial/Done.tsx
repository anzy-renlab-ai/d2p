export function DoneA() {
  return (
    <div className="min-h-screen bg-paper pt-12">
      <div className="max-w-2xl mx-auto py-16 px-6">
        <div className="text-xs font-mono text-forest uppercase tracking-[0.2em] mb-6">
          double-green · session complete
        </div>
        <h1 className="text-6xl tracking-tight leading-none mb-3 font-serif">
          notes-saas
          <br />
          <span className="italic text-muted">is product.</span>
        </h1>
        <p className="text-lg text-muted font-serif italic max-w-md leading-snug mt-6">
          preset 18 of 18 · vision verdict YES · 41 minutes · $1.27
        </p>

        <hr className="my-12 border-warmline" />

        <section className="mb-12">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-4">what landed</div>
          <ul className="divide-y divide-warmline font-serif">
            <li className="py-3"><span className="text-forest mr-2">✓</span> structured request logging (pino)</li>
            <li className="py-3"><span className="text-forest mr-2">✓</span> per-IP rate limit on /auth/*</li>
            <li className="py-3"><span className="text-forest mr-2">✓</span> React error boundary</li>
            <li className="py-3"><span className="text-forest mr-2">✓</span> Vercel deploy config + GitHub Action</li>
            <li className="py-3"><span className="text-forest mr-2">✓</span> MIT LICENSE</li>
            <li className="py-3"><span className="text-forest mr-2">✓</span> .env.example with documentation</li>
            <li className="py-3 text-muted"><span className="mr-2">…</span> 6 smaller items merged silently</li>
          </ul>
        </section>

        <section className="mb-12">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-4">left for you</div>
          <div className="border-l-2 border-coral pl-5 py-2 font-serif italic text-ink">
            Mobile workspace responsive — escalated. Reviewer wants a UX call on whether to
            collapse to tabs vs. stack vertically.
          </div>
        </section>

        <section className="mb-12">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-4">deploy</div>
          <p className="text-sm text-muted mb-3">ZeroU doesn't push for you. Run when ready:</p>
          <code className="block text-xs font-mono bg-cream border border-warmline rounded-md px-4 py-3">
            npx vercel --prod
          </code>
        </section>

        <div className="flex items-center justify-between pt-8 border-t border-warmline">
          <button className="text-sm text-muted hover:text-ink">← new session</button>
          <button className="px-6 py-2 bg-coral text-cream rounded-full text-sm font-medium">
            View summary.md
          </button>
        </div>
      </div>
    </div>
  );
}
