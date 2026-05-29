import { Pill, PillTone } from './Pill';

type Tier = {
  n: string;
  glyph: string;
  title: string;
  cn: string;
  body: string;
  tone: PillTone;
};

const tiers: Tier[] = [
  {
    n: '01',
    glyph: 'scan',
    title: 'Scan',
    cn: '扫',
    body:
      'Preset-driven static + LLM scan finds the bug classes you actually care about — secrets, SQLi, missing auth, weak crypto. Tunable. Auditable. No vibes.',
    tone: 'coral',
  },
  {
    n: '02',
    glyph: 'fix',
    title: 'Fix',
    cn: '修',
    body:
      'Each finding becomes a targeted patch on its own branch. claude-cli does the typing; ZeroU constrains scope so the patch fixes the bug — not the surrounding 200 lines.',
    tone: 'forest',
  },
  {
    n: '03',
    glyph: 'verify',
    title: 'Verify',
    cn: '验',
    body:
      'Generated tests cover the patched path. Critic verdict (confirmed / false-positive / needs-context) per finding. Branch-coverage check ensures the fix actually ran.',
    tone: 'amber',
  },
  {
    n: '04',
    glyph: 'trace',
    title: 'Trace',
    cn: '追溯',
    body:
      'Every step writes a line of structured JSONL. Six months from now you can grep `branch_id`, replay the verdict, and show your auditor the receipts.',
    tone: 'plum',
  },
];

export function ValueTiers() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <div className="mb-10">
        <div className="text-[10px] uppercase tracking-widest text-muted mb-2 font-mono">
          four tiers
        </div>
        <h2 className="text-3xl tracking-tight max-w-2xl leading-tight title-underline">
          The whole pipeline — not a single trick.
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiers.map((t, i) => (
          <div
            key={t.n}
            className="card card-hover p-5 lift-on-hover anim-stagger flex flex-col"
            style={{ ['--i' as string]: i }}
          >
            <div className="flex items-baseline justify-between mb-4">
              <span className="text-[11px] font-mono text-muted">{t.n}</span>
              <Pill tone={t.tone}>{t.cn}</Pill>
            </div>
            <div className="font-serif text-2xl mb-1">{t.title}</div>
            <div className="text-[11px] uppercase tracking-widest text-muted font-mono mb-3">
              {t.glyph}
            </div>
            <p className="text-sm text-ink/80 leading-relaxed">{t.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
