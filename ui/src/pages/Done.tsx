import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { Button } from '../components/Button.js';
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
    // auto-end if reached DONE
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
    <div className="max-w-3xl mx-auto py-12 px-6 space-y-6">
      <div className={success ? 'text-green-700' : 'text-slate-700'}>
        <h1 className="text-3xl font-semibold">
          {success ? '✅ Product ready' : `会话已结束（${session?.status}）`}
        </h1>
        <p className="text-sm text-slate-600 mt-1 font-mono">{demo?.path}</p>
      </div>

      <section className="bg-white rounded border p-4 grid grid-cols-2 gap-y-2 text-sm">
        <div>完成的 gap</div>
        <div className="text-right text-green-700 font-medium">{done.length}</div>
        <div>跳过的 gap</div>
        <div className="text-right">{skipped.length}</div>
        <div>需人工的 gap</div>
        <div className="text-right text-amber-700">{needHuman.length}</div>
        <div>拆分的 gap</div>
        <div className="text-right">{splitDone.length}</div>
        <div>Preset 完成度</div>
        <div className="text-right">{presetDone} / {presetStatus.length}</div>
        <div>累计 token (输入)</div>
        <div className="text-right">{costTotals.inputTokens.toLocaleString()}</div>
        <div>累计 token (输出)</div>
        <div className="text-right">{costTotals.outputTokens.toLocaleString()}</div>
        <div>预估费用</div>
        <div className="text-right font-semibold">${costTotals.estimatedUsd.toFixed(2)}</div>
      </section>

      {done.length > 0 && (
        <Section title={`完成的 gap (${done.length})`} icon="✓" color="text-green-700">
          {done.map((g) => (
            <Row key={g.id} g={g} />
          ))}
        </Section>
      )}

      {needHuman.length > 0 && (
        <Section title={`需人工 (${needHuman.length})`} icon="⚠" color="text-amber-700">
          {needHuman.map((g) => (
            <Row key={g.id} g={g} />
          ))}
        </Section>
      )}

      {splitDone.length > 0 && (
        <Section title={`拆分 (${splitDone.length})`} icon="↳" color="text-purple-700">
          {splitDone.map((g) => (
            <Row key={g.id} g={g} />
          ))}
        </Section>
      )}

      {summaryMdPath && (
        <div className="bg-slate-50 border rounded p-4 text-sm">
          <div className="text-slate-600 mb-1">完整 session summary 已写到：</div>
          <code className="break-all text-xs">{summaryMdPath}</code>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => window.location.reload()}>
          新建 session
        </Button>
        <Button variant="ghost" onClick={() => window.close()}>关闭</Button>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  color,
  children,
}: {
  title: string;
  icon: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded border">
      <div className={`px-4 py-2 border-b bg-slate-50 font-medium ${color}`}>
        {icon} {title}
      </div>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function Row({ g }: { g: Gap }) {
  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-start gap-2">
        <span className="text-xs uppercase text-slate-500">{g.severity}</span>
        <span className="font-mono text-xs text-slate-500">{g.slug}</span>
      </div>
      <div className="text-slate-700">{g.title}</div>
    </li>
  );
}
