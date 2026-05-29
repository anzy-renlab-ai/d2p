export function DoneB() {
  return (
    <div className="min-h-screen bg-ink text-cream font-mono pt-10">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <pre className="text-forest text-[10px] leading-tight mb-6 select-none">{`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║  ██████  ██████  ███    ██ ███████                           ║
║  ██   ██ ██   ██ ████   ██ ██                                ║
║  ██   ██ ██   ██ ██ ██  ██ █████                             ║
║  ██   ██ ██   ██ ██  ██ ██ ██                                ║
║  ██████  ██████  ██   ████ ███████                           ║
║                                                              ║
║                                  double-green · session 7    ║
╚══════════════════════════════════════════════════════════════╝`}</pre>

        <div className="grid grid-cols-4 gap-px bg-cream/10 mb-8">
          <Stat label="preset" v="18 / 18" big ok />
          <Stat label="vision" v="YES" big ok />
          <Stat label="duration" v="41m 02s" />
          <Stat label="cost" v="$1.27" />
        </div>

        <div className="grid grid-cols-2 gap-8 mb-10">
          <section>
            <div className="text-[10px] uppercase tracking-widest text-cream/50 mb-3">merged · 13</div>
            <ul className="text-xs space-y-1">
              <Line ok>add-license-mit                  a1b2c3d</Line>
              <Line ok>env-example-template             b2c3d4e</Line>
              <Line ok>add-observability-logging        c3d4e5f</Line>
              <Line ok>rate-limit-auth-endpoints        d4e5f6a</Line>
              <Line ok>error-boundary-react             e5f6a7b</Line>
              <Line ok>deploy-config-vercel             f6a7b8c</Line>
              <Line ok>a11y-baseline                    a7b8c9d</Line>
              <Line ok>readme-quickstart                b8c9d0e</Line>
              <Line dim>+5 small items merged silently</Line>
            </ul>
          </section>
          <section>
            <div className="text-[10px] uppercase tracking-widest text-cream/50 mb-3">left for you · 1</div>
            <div className="border border-rust/40 bg-rust/5 rounded p-3 text-xs">
              <div className="text-rust mb-1 font-bold">mobile-workspace-responsive</div>
              <div className="text-cream/70 leading-relaxed">
                reviewer escalated: collapse-to-tabs vs vertical-stack is a UX call,
                not a code one. open vision.md and decide; zerou will re-try.
              </div>
            </div>
            <div className="mt-4 text-[10px] uppercase tracking-widest text-cream/50 mb-2">tokens</div>
            <div className="text-xs space-y-1">
              <Line>input    487,352 tok</Line>
              <Line>output   124,891 tok</Line>
              <Line dim>haiku    72%  · sonnet  26%  · opus  2%</Line>
            </div>
          </section>
        </div>

        <section className="border border-cream/15 rounded-md p-4 mb-6">
          <div className="text-[10px] uppercase tracking-widest text-cream/50 mb-2">deploy</div>
          <div className="text-xs text-cream/70 mb-2">zerou doesn't push for you. run when ready:</div>
          <code className="block bg-cream/5 px-3 py-2 rounded-sm text-coral text-sm">
            $ npx vercel --prod
          </code>
        </section>

        <div className="flex items-center justify-between text-xs text-cream/50 pt-4 border-t border-cream/15">
          <button className="hover:text-cream">[n] new session</button>
          <span>summary.md → D:\demos\notes-saas\.d2p\summary.md</span>
          <button className="hover:text-cream">[c] close</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v, big, ok }: { label: string; v: string; big?: boolean; ok?: boolean }) {
  return (
    <div className="bg-ink p-4">
      <div className="text-[10px] uppercase tracking-widest text-cream/50 mb-1">{label}</div>
      <div className={`${big ? 'text-3xl' : 'text-xl'} ${ok ? 'text-forest' : 'text-cream'}`}>{v}</div>
    </div>
  );
}
function Line({ children, ok, dim }: { children: React.ReactNode; ok?: boolean; dim?: boolean }) {
  const cls = ok ? 'text-forest' : dim ? 'text-cream/40' : 'text-cream/85';
  return <li className={cls}>{children}</li>;
}
