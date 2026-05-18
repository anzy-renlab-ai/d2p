import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { Button } from '../components/Button.js';
import { DeployTargets } from '../components/DeployTargets.js';
import type { Gap } from '../types.js';

export function Done() {
  const session = useStore((s) => s.session);
  const demo = useStore((s) => s.demo);
  const gaps = useStore((s) => s.gaps);
  const presetStatus = useStore((s) => s.presetStatus);
  const costTotals = useStore((s) => s.costTotals);
  const endSession = useStore((s) => s.endSession);
  const summaryMdPath = useStore((s) => s.summaryMdPath);
  const [endedBusy, setEndedBusy] = useState(false);

  useEffect(() => {
    if (session?.status === 'DONE' && !summaryMdPath && !endedBusy) {
      setEndedBusy(true);
      void endSession().finally(() => setEndedBusy(false));
    }
  }, [session?.status, summaryMdPath, endedBusy, endSession]);

  const done = gaps.filter((g) => g.status === 'DONE');
  const skipped = gaps.filter((g) => g.status === 'SKIPPED');
  const needHuman = gaps.filter((g) => g.status === 'NEED_HUMAN');
  const splitDone = gaps.filter((g) => g.status === 'SPLIT_DONE');
  const presetDone = presetStatus.filter((i) => i.status === 'done').length;

  const success = session?.status === 'DONE';

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-3xl mx-auto py-14 px-6 space-y-6">
        <header className="pb-6 border-b border-warmline">
          <h1 className={`text-4xl tracking-tight ${success ? 'text-forest' : 'text-ink'}`}>
            {success ? '✓ Product ready' : `会话已结束（${session?.status}）`}
          </h1>
          <p className="text-xs text-muted mt-2 font-mono break-all">{demo?.path}</p>
        </header>

        <section className="card p-5 grid grid-cols-2 gap-y-2 text-sm">
          <Stat label="完成的 gap" value={done.length} color="text-forest" />
          <Stat label="跳过的 gap" value={skipped.length} />
          <Stat label="需人工的 gap" value={needHuman.length} color={needHuman.length > 0 ? 'text-coral' : undefined} />
          <Stat label="拆分的 gap" value={splitDone.length} />
          <Stat label="Preset 完成度" value={`${presetDone} / ${presetStatus.length}`} />
          <Stat label="累计 token (in)" value={costTotals.inputTokens.toLocaleString()} />
          <Stat label="累计 token (out)" value={costTotals.outputTokens.toLocaleString()} />
          <Stat label="预估费用" value={`$${costTotals.estimatedUsd.toFixed(2)}`} bold />
        </section>

        {done.length > 0 && (
          <Section title={`完成的 gap (${done.length})`} icon="✓" color="text-forest">
            {done.map((g) => (<Row key={g.id} g={g} />))}
          </Section>
        )}

        {needHuman.length > 0 && (
          <Section title={`需人工 (${needHuman.length})`} icon="⚠" color="text-coral">
            {needHuman.map((g) => (<Row key={g.id} g={g} />))}
          </Section>
        )}

        {splitDone.length > 0 && (
          <Section title={`拆分 (${splitDone.length})`} icon="↳" color="text-muted">
            {splitDone.map((g) => (<Row key={g.id} g={g} />))}
          </Section>
        )}

        <section className="card">
          <div className="card-header">部署目标</div>
          <div className="p-5">
            <DeployTargets />
          </div>
        </section>

        {summaryMdPath && (
          <div className="card p-5 text-sm">
            <div className="text-muted mb-1.5">完整 session summary 已写到：</div>
            <code className="break-all text-xs text-ink">{summaryMdPath}</code>
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button
            variant="secondary"
            onClick={() => {
              // Clear the just-ended session from the store so App.tsx routes
              // to Landing. window.location.reload() also works but flashes
              // health-load placeholders; in-memory clear is instantaneous.
              useStore.setState({
                session: null,
                demo: null,
                summaryMdPath: null,
                gaps: [],
                events: [],
                presetStatus: [],
                detector: null,
                visionRound: null,
              });
            }}
          >新建 session</Button>
          <Button variant="ghost" onClick={() => window.close()}>关闭</Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, bold }: { label: string; value: string | number; color?: string; bold?: boolean }) {
  return (
    <>
      <div className="text-muted">{label}</div>
      <div className={`text-right ${color ?? 'text-ink'} ${bold ? 'font-semibold' : ''}`}>{value}</div>
    </>
  );
}

function Section({ title, icon, color, children }: { title: string; icon: string; color: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className={`card-header ${color}`}>{icon} {title}</div>
      <ul className="divide-y divide-warmline">{children}</ul>
    </section>
  );
}

function Row({ g }: { g: Gap }) {
  return (
    <li className="px-5 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted">{g.severity}</span>
        <span className="font-mono text-xs text-muted">{g.slug}</span>
      </div>
      <div className="text-ink">{g.title}</div>
    </li>
  );
}
