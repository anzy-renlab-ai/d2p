import { useState, useMemo } from 'react';
import type { ReviewBundle, StageStatus } from '../types-zerou.js';
import { ZerouStageCard } from './ZerouStageCard.js';
import { ZerouModuleCards } from './ZerouModuleCards.js';
import { ZerouFilesList } from './ZerouFilesList.js';
import { ZerouFindingsList } from './ZerouFindingsList.js';

/**
 * Stage ③ — Fix view.
 *
 * What ZeroU just did: enhance modules ran in order (log inject / health /
 * sentry / env / bug-patch). The 38 findings here are static + test-fail
 * surface — module statuses + file diffs show what got auto-merged vs left
 * for the human.
 */

export interface ZerouStageFixProps {
  bundle: ReviewBundle;
  status?: StageStatus;
}

type Tab = 'modules' | 'files' | 'findings';

export function ZerouStageFix({ bundle, status }: ZerouStageFixProps) {
  const [tab, setTab] = useState<Tab>('modules');

  const counts = useMemo(() => {
    const patched = bundle.findings.filter((f) => f.status === 'patched').length;
    const unpatched = bundle.findings.filter((f) => f.status === 'unpatched').length;
    const failed = bundle.findings.filter((f) => f.status === 'failed').length;
    const skipped = bundle.findings.filter((f) => f.status === 'skipped').length;
    return { patched, unpatched, failed, skipped, total: bundle.findings.length };
  }, [bundle.findings]);

  const logSites = useMemo(() => {
    return bundle.files.reduce(
      (s, f) => s + (f.modules.includes('logging') ? f.additions : 0),
      0
    );
  }, [bundle.files]);

  // Stage is 'done' even when not all findings are patched — P1s untouched is
  // EXPECTED behaviour (loud demo of "hardener can't auto-fix these"). Only
  // fail when zero modules ran or a verify-blocking module failed.
  const failedModule = bundle.modules.some((m) => m.status === 'failed');
  const stageStatus: StageStatus =
    status ?? (failedModule ? 'fail' : bundle.modules.length === 0 ? 'pending' : 'done');

  const metric = (
    <>
      <span className="text-ink">{bundle.files.length}</span> files ·{' '}
      <span className="text-ink">{logSites}</span> log sites ·{' '}
      <span className="text-ink">{counts.total}</span> findings
    </>
  );

  return (
    <ZerouStageCard
      numeral="③"
      title="改"
      metric={metric}
      subMetric={
        <>
          <span className="text-forest">{counts.patched} patched</span>
          <span className="text-muted/40 mx-2">·</span>
          <span className="text-coral">{counts.unpatched} unpatched</span>
          {counts.failed > 0 && (
            <>
              <span className="text-muted/40 mx-2">·</span>
              <span className="text-rust">{counts.failed} failed</span>
            </>
          )}
          {counts.skipped > 0 && (
            <>
              <span className="text-muted/40 mx-2">·</span>
              <span className="text-muted">{counts.skipped} skipped</span>
            </>
          )}
        </>
      }
      status={stageStatus}
      testId="zerou-stage-fix"
    >
      <div className="px-5 py-4 space-y-3">
        <div className="text-xs text-muted font-mono leading-relaxed">
          enhance modules 按顺序跑（log inject → health → sentry → env →
          bug-patch）。低风险的自动 merge，patcher 拿不准的 escalate 给你 — 文档
          里就是 unpatched / skipped 那几条。
        </div>

        <div className="flex items-center gap-1 border-b border-warmline">
          <TabBtn active={tab === 'modules'} onClick={() => setTab('modules')} testId="zerou-stage-fix-tab-modules">
            Modules ({bundle.modules.length})
          </TabBtn>
          <TabBtn active={tab === 'files'} onClick={() => setTab('files')} testId="zerou-stage-fix-tab-files">
            Files ({bundle.files.length})
          </TabBtn>
          <TabBtn active={tab === 'findings'} onClick={() => setTab('findings')} testId="zerou-stage-fix-tab-findings">
            Findings ({counts.total})
          </TabBtn>
        </div>

        <div className="anim-drift-in" key={tab}>
          {tab === 'modules' && <ZerouModuleCards modules={bundle.modules} />}
          {tab === 'files' && <ZerouFilesList files={bundle.files} />}
          {tab === 'findings' && <ZerouFindingsList findings={bundle.findings} />}
        </div>
      </div>
    </ZerouStageCard>
  );
}

function TabBtn({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors border-b-2 -mb-px ${
        active
          ? 'border-coral text-coral'
          : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
