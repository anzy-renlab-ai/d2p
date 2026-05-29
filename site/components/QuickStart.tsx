import { Pill } from './Pill';

type Cmd = {
  step: string;
  cmd: string;
  comment: string;
  out: string;
};

const cmds: Cmd[] = [
  {
    step: '01',
    cmd: 'zerou audit ./my-app',
    comment: 'Static + LLM scan across active presets',
    out: '21 findings · 8 confirmed · 11 needs-context · 2 false-positive',
  },
  {
    step: '02',
    cmd: 'zerou enhance ./my-app',
    comment: 'Patch each finding on its own branch',
    out: 'fix/sql-001 ✓ · fix/secret-002 ✓ · fix/auth-003 ✓ (7 patched, 1 skipped)',
  },
  {
    step: '03',
    cmd: 'zerou review ./my-app --serve',
    comment: 'Live dashboard at http://localhost:7654',
    out: 'mission-control dashboard up · live branch-trace feed streaming',
  },
  {
    step: '04',
    cmd: 'zerou coverage ./my-app --threshold 50',
    comment: 'Block merge if patched lines aren\'t covered',
    out: 'branch coverage 73% ≥ 50% → exit 0 · audit trail at .zerou/branch-trace.jsonl',
  },
];

export function QuickStart() {
  return (
    <section id="quickstart" className="max-w-6xl mx-auto px-6 py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
            quick start
          </div>
          <h2 className="text-3xl tracking-tight leading-tight">
            Four commands. Your demo is hardened.
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Pill mono tone="coral">node 22+</Pill>
          <Pill mono>claude-cli</Pill>
          <Pill mono>git</Pill>
        </div>
      </div>

      <p className="text-sm text-muted max-w-2xl mb-8 leading-relaxed">
        ZeroU runs locally and drives the Claude Code CLI as its worker. No API
        key. No SaaS dashboard. Your code never leaves the machine.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {cmds.map((c, i) => (
          <div
            key={c.step}
            className="card p-5 lift-on-hover anim-stagger"
            style={{ ['--i' as string]: i }}
          >
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-[11px] font-mono text-muted">{c.step}</span>
              <span className="text-[11px] uppercase tracking-widest text-muted font-mono">
                {c.comment}
              </span>
            </div>
            <pre className="bg-ink/[0.92] text-cream rounded-md px-3 py-2.5 text-[12.5px] font-mono overflow-x-auto mb-3">
              <code>
                <span className="text-coralsoft">$</span> {c.cmd}
              </code>
            </pre>
            <div className="text-[12px] text-sage-600 font-mono leading-relaxed">
              <span className="text-muted">→ </span>
              {c.out}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 card p-5 bg-coralsoft/20 border-coral/20">
        <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
          install
        </div>
        <pre className="bg-ink/[0.92] text-cream rounded-md px-3 py-2.5 text-[13px] font-mono overflow-x-auto">
          <code>
            <span className="text-coralsoft">$</span> npm install -g zerou
            {'\n'}
            <span className="text-coralsoft">$</span> zerou --version
            {'\n'}
            <span className="text-sage-100">zerou 0.1.0 · alpha · MIT</span>
          </code>
        </pre>
      </div>
    </section>
  );
}
