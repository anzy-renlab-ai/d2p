export function SettingsB() {
  return (
    <div className="min-h-screen bg-ink text-cream font-mono pt-10">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="text-2xl mb-1">$ <span className="text-coral">zerou config</span></div>
        <div className="text-xs text-cream/50 mb-8">~/.d2p/config.json · keys never leave this box</div>

        <section className="mb-8 border border-cream/15 rounded-md">
          <header className="px-4 py-2 border-b border-cream/15 bg-cream/5 text-xs flex items-center justify-between">
            <span><span className="text-cream/50">[ENGINE]</span> select model provider</span>
            <span className="text-coral">openai-compat</span>
          </header>
          <div className="text-xs">
            {[
              { id: 'claude-cli', t: 'Claude CLI', sub: 'subprocess to local claude · uses your login' },
              { id: 'openai-compat', t: 'OpenAI-compat', sub: 'MiniMax · OpenRouter · DeepSeek · Kimi · GLM · Qwen', active: true },
              { id: 'anthropic-api', t: 'Anthropic API', sub: 'official Messages API · raw fetch' },
            ].map((e) => (
              <div
                key={e.id}
                className={`flex items-center gap-3 px-4 py-3 border-t border-cream/10 first:border-t-0 ${
                  e.active ? 'bg-coral/10 border-l-2 border-l-coral' : ''
                }`}
              >
                <span className="text-cream/40 w-6 shrink-0">{e.active ? '◉' : '○'}</span>
                <span className="w-32 shrink-0">{e.t}</span>
                <span className="text-cream/40 text-[11px]">[{e.id}]</span>
                <span className="text-cream/60 ml-auto text-[11px]">{e.sub}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <div className="text-[10px] uppercase tracking-widest text-cream/50 mb-3">presets · click to apply</div>
          <div className="flex flex-wrap gap-2">
            {['MiniMax', 'OpenRouter', 'DeepSeek', 'Z.ai', 'Moonshot', 'OpenAI', 'Qwen'].map((p, i) => (
              <button
                key={p}
                className={`px-3 py-1 text-[11px] border rounded-sm transition ${
                  i === 0
                    ? 'bg-coral text-ink border-coral'
                    : 'border-cream/20 text-cream/70 hover:text-cream hover:border-cream/50'
                }`}
              >
                [{p}]
              </button>
            ))}
          </div>
        </section>

        <section className="mb-8 space-y-1 text-xs">
          <Cfg k="baseUrl"        v="https://api.minimaxi.com/v1" />
          <Cfg k="apiKey"         v="••••••••••••••••" secret />
          <Cfg k="model.haiku"    v="abab6.5s-chat" />
          <Cfg k="model.sonnet"   v="MiniMax-M2.7" />
          <Cfg k="model.opus"     v="MiniMax-M2.7" />
          <Cfg k="extraHeaders"   v="{}" dim />
        </section>

        <section className="mb-8 border border-cream/15 rounded-md">
          <header className="px-4 py-2 border-b border-cream/15 bg-cream/5 text-xs">
            <span className="text-cream/50">[GITHUB]</span> optional · enables PR mode
          </header>
          <div className="p-4 space-y-1 text-xs">
            <Cfg k="github.token"      v="(not set)" dim />
            <Cfg k="github.baseBranch" v="main" />
          </div>
        </section>

        <div className="flex items-center justify-between border-t border-cream/15 pt-4">
          <span className="text-[11px] text-cream/40">↵ save · esc cancel</span>
          <button className="px-5 py-1.5 bg-coral text-ink rounded-sm text-xs font-bold tracking-wider uppercase">
            Save ↵
          </button>
        </div>
      </div>
    </div>
  );
}

function Cfg({ k, v, secret, dim }: { k: string; v: string; secret?: boolean; dim?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 px-1 py-1 hover:bg-cream/5 group">
      <span className="text-cream/40 w-44 shrink-0">{k}</span>
      <span className="text-cream/30">=</span>
      <input
        readOnly
        type={secret ? 'password' : 'text'}
        defaultValue={v}
        className={`flex-1 bg-transparent border-none outline-none ${dim ? 'text-cream/40' : 'text-coral'}`}
      />
    </div>
  );
}
