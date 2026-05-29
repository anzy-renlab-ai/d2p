export function Differentiator() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <div className="card p-8 lg:p-12 relative overflow-hidden">
        <div className="absolute -right-16 -bottom-16 w-80 h-80 rounded-full bg-coralsoft/30 pointer-events-none" />
        <div className="absolute right-8 top-8 w-24 h-24 rounded-full border border-coral/15 pointer-events-none" />

        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-coral mb-3 font-mono">
              what makes ZeroU different
            </div>
            <h2 className="text-3xl sm:text-4xl tracking-tight leading-tight mb-4 title-underline">
              Log as proof.
            </h2>
            <p className="text-lg text-muted leading-relaxed mb-4">
              You don&apos;t get a confidence score. You get one independently
              grep-able line per decision the agent made — six months from now
              still readable, still replayable.
            </p>
            <p className="text-sm text-ink/80 leading-relaxed">
              Every scan, every fix attempt, every critic verdict lands in{' '}
              <code className="text-coral bg-coralsoft/30 px-1.5 py-0.5 rounded text-[12px]">
                .zerou/branch-trace.jsonl
              </code>
              . No DB to query. No SaaS to sign up for. Just a file your auditor
              already knows how to read.
            </p>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted mb-3 font-mono">
              try it
            </div>
            <pre className="bg-ink/[0.92] text-cream rounded-lg p-5 text-[12.5px] font-mono leading-relaxed overflow-x-auto">
              <code>
                <span className="text-muted"># count unique branches your audit explored</span>
                {'\n'}
                <span className="text-coralsoft">$</span> cat .zerou/branch-trace.jsonl \
                {'\n'}
                {'    '}| jq -r &apos;.branch_id&apos; | sort -u | wc -l
                {'\n'}
                <span className="text-sage-100">47</span>
                {'\n'}
                {'\n'}
                <span className="text-muted"># show every decision the critic made on this finding</span>
                {'\n'}
                <span className="text-coralsoft">$</span> jq &apos;select(.finding_id ==
                {' '}&quot;sql-001&quot;)&apos; \
                {'\n'}
                {'    '}.zerou/branch-trace.jsonl
                {'\n'}
                <span className="text-sage-100">{'{'} &quot;step&quot;: &quot;detect&quot;, &quot;verdict&quot;: &quot;hit&quot;, ... {'}'}</span>
                {'\n'}
                <span className="text-sage-100">{'{'} &quot;step&quot;: &quot;patch&quot;, &quot;branch&quot;: &quot;fix/sql-001&quot;, ... {'}'}</span>
                {'\n'}
                <span className="text-sage-100">{'{'} &quot;step&quot;: &quot;verify&quot;, &quot;result&quot;: &quot;confirmed&quot;, ... {'}'}</span>
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
