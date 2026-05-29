export function LandingB() {
  return (
    <div className="min-h-screen bg-ink text-cream font-mono pt-10">
      <div className="max-w-3xl mx-auto px-8 py-12">
        <pre className="text-coral text-[11px] leading-tight mb-8 select-none">{`
   ▄▄▄▄    ▄▄▄▄▄▄▄    ▄▄▄▄▄▄▄
   █  ██   ▀▀▀▀▀█▀    █  ▄ ▄ █
   █  ██▄  ▀▀▀▀█▀     █  █▄█ █
   █▄▄▄██▄▄█▄▄▄█▄▄▄   █▄▄▄▄▄▄█    demo → product, daemon-driven`}</pre>

        <div className="border border-cream/20 rounded-md mb-6">
          <div className="px-4 py-2 border-b border-cream/20 bg-cream/5 text-[11px] flex items-center justify-between">
            <span><span className="text-coral">●</span> daemon · localhost:5174 · healthy</span>
            <span className="text-cream/40">uptime 20m 34s</span>
          </div>
          <div className="px-4 py-6">
            <div className="text-[10px] uppercase tracking-widest text-cream/40 mb-3">demo path</div>
            <div className="flex items-baseline gap-3 text-xl">
              <span className="text-coral select-none">$</span>
              <span className="text-cream/30">zerou start</span>
              <input
                type="text"
                placeholder="D:\demos\notes-saas"
                className="flex-1 bg-transparent border-none outline-none text-cream placeholder:text-cream/30"
              />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-1 text-[11px] text-cream/60">
              <span>auto git-init</span><span className="text-cream/40">yes</span>
              <span>worktree location</span><span className="text-cream/40">../&lt;parent&gt;/.d2p-worktrees/</span>
              <span>engine</span><span className="text-cream/40">claude-cli (login active)</span>
              <span>concurrency</span><span className="text-cream/40">2 attempts/gap</span>
            </div>
          </div>
          <div className="px-4 py-3 border-t border-cream/20 flex items-center justify-between">
            <button className="text-[11px] text-cream/60 hover:text-cream">[s] settings</button>
            <button className="px-4 py-1.5 bg-coral text-ink rounded-sm text-xs font-bold tracking-wider uppercase">
              Start ↵
            </button>
          </div>
        </div>

        <div className="text-[11px] text-cream/40 space-y-0.5">
          <div>──── about ────────────────────────────────────────────────</div>
          <div>zerou loops: differ → pick gap → K attempts → 4-layer review → merge</div>
          <div>stops when: preset all-green AND vision verdict YES (double-green)</div>
          <div>UI is a window onto a daemon; close the tab, daemon keeps working</div>
          <div>──────────────────────────────────────────────────────────</div>
        </div>

        <div className="mt-10 text-[10px] text-cream/30 flex items-center justify-between">
          <span>claude 2.1.81 · git 2.51.2 · sqlite ok · prompts v1</span>
          <span>↵ to start · ⌃C to cancel</span>
        </div>
      </div>
    </div>
  );
}
