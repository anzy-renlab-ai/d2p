export function LandingA() {
  return (
    <div className="min-h-screen bg-paper pt-12">
      <div className="max-w-2xl mx-auto pt-16 px-6">
        <div className="text-xs font-mono text-coral uppercase tracking-[0.2em] mb-6">
          demo → product, hands-off
        </div>
        <h1 className="text-7xl tracking-tight leading-none mb-6">ZeroU</h1>
        <p className="text-2xl font-serif italic text-muted leading-snug mb-10">
          You bring a demo and a vision.
          <br />
          A clinic of LLM reviewers brings it to product.
        </p>

        <div className="border-t border-warmline pt-8 space-y-6">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-muted font-medium mb-2">
              Demo folder · absolute path
            </label>
            <input
              type="text"
              placeholder="D:\demos\notes-saas"
              className="w-full bg-transparent border-b-2 border-warmline focus:border-coral text-xl py-3 font-mono outline-none transition-colors"
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted/80 leading-relaxed max-w-xs font-serif italic">
              No <code className="not-italic">.git</code>? ZeroU inits one. Worktrees live
              outside your repo.
            </p>
            <button className="px-7 py-3 bg-coral text-cream rounded-full text-sm font-medium hover:bg-coralhover transition">
              Start session →
            </button>
          </div>
        </div>

        <footer className="mt-24 pt-8 border-t border-warmline text-[11px] text-muted/70 font-serif italic flex items-center justify-between">
          <span>daemon v0.1.0 · prompts v1 · healthy</span>
          <span>made for nights you'd rather not code</span>
        </footer>
      </div>
    </div>
  );
}
