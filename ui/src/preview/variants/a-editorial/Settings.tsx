export function SettingsA() {
  return (
    <div className="min-h-screen bg-paper pt-12">
      <div className="max-w-2xl mx-auto py-12 px-6">
        <div className="text-xs font-mono text-coral uppercase tracking-[0.2em] mb-3">settings</div>
        <h1 className="text-4xl tracking-tight">How ZeroU talks to LLMs.</h1>
        <p className="text-muted mt-3 font-serif italic">Keys stay on your machine.</p>

        <section className="mt-12">
          <h2 className="font-serif text-2xl mb-1">Engine</h2>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            Pick one. You can switch mid-session — the next agent call uses the new engine.
          </p>
          <div className="space-y-3">
            {[
              { kind: 'claude-cli', name: 'Claude CLI', d: 'your local claude login — free subscription path' },
              { kind: 'openai-compat', name: 'OpenAI-compatible', d: 'MiniMax · OpenRouter · DeepSeek · Kimi · GLM · Qwen' },
              { kind: 'anthropic-api', name: 'Anthropic API', d: 'official Messages API with your key' },
            ].map((e, i) => (
              <label
                key={e.kind}
                className={`block border rounded-lg p-5 cursor-pointer transition-colors ${
                  i === 1 ? 'border-coral bg-coralsoft/30' : 'border-warmline hover:border-coral/50'
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <input type="radio" name="engine" defaultChecked={i === 1} className="accent-coral" readOnly />
                  <span className="font-serif text-lg">{e.name}</span>
                  <span className="text-[10px] font-mono text-muted">{e.kind}</span>
                </div>
                <p className="text-sm text-muted ml-7 mt-1.5">{e.d}</p>
              </label>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-serif text-2xl mb-4">Quick presets</h2>
          <div className="flex flex-wrap gap-2">
            {['MiniMax', 'OpenRouter', 'DeepSeek', 'Z.ai', 'Moonshot', 'OpenAI', 'Qwen'].map((p) => (
              <button
                key={p}
                className={`px-4 py-1.5 rounded-full text-xs border transition ${
                  p === 'MiniMax'
                    ? 'border-coral bg-coralsoft/50 text-ink'
                    : 'border-warmline text-muted hover:border-coral hover:text-ink'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-5">
          <Field label="base URL" value="https://api.minimaxi.com/v1" />
          <Field label="API key" value="••••••••••••••••" secret />
          <div className="grid grid-cols-3 gap-4">
            <Field label="haiku" value="abab6.5s-chat" small />
            <Field label="sonnet" value="MiniMax-M2.7" small />
            <Field label="opus" value="MiniMax-M2.7" small />
          </div>
        </section>

        <div className="mt-12 pt-6 border-t border-warmline flex justify-end">
          <button className="px-7 py-2.5 bg-coral text-cream rounded-full text-sm font-medium hover:bg-coralhover">
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, secret, small }: { label: string; value: string; secret?: boolean; small?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted font-medium mb-1.5">{label}</label>
      <input
        readOnly
        type={secret ? 'password' : 'text'}
        defaultValue={value}
        className={`w-full bg-transparent border-b border-warmline focus:border-coral font-mono py-2 outline-none ${small ? 'text-sm' : 'text-base'}`}
      />
    </div>
  );
}
