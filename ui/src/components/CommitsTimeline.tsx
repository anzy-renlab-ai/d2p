import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { useLocale } from '../i18n/useLocale.js';
import { agentGamePlatformCommits } from '../mock/agentGamePlatform.js';
import { mockCommits as _fallbackCommits, mockCheckpoints } from '../mock/sessions.js';
import { mockRiskByCommitSha } from '../mock/risk.js';
import { mockDiffByCommitSha } from '../mock/diff.js';
import { checkpointsForCommit } from '../mock/checkpoints.js';
import { RiskBadge, riskCardRingClass } from './RiskBadge.js';
import { CommitDiffDrawer } from './CommitDiffDrawer.js';
import { CheckpointTimeline } from './CheckpointTimeline.js';

// Mock fallback when daemon's commit list is empty — useful in demo mode and
// first-run states. agent-game-platform mock is preferred, then sessions mock.
const fallbackCommits = agentGamePlatformCommits.length > 0 ? agentGamePlatformCommits : _fallbackCommits;

// Floating cards on a vertical timeline. No grid lines. Each commit card
// has primary actions (rewind / diff) inline + reviewer verdict chips.

function fmtRelative(ts: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  const diffMs = Date.now() - ts;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return t('time.secAgo', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('time.minAgo', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('time.hourAgo', { n: h });
  const d = Math.floor(h / 24);
  return t('time.dayAgo', { n: d });
}

const VERDICT_CLS: Record<'pass' | 'fail' | 'partial', string> = {
  pass: 'bg-sage-50 text-sage-600',
  fail: 'bg-rust/10 text-rust',
  partial: 'bg-coralsoft text-coral',
};

const VERDICT_KEY: Record<'pass' | 'fail' | 'partial', string> = {
  pass: 'commits.verdict.pass',
  fail: 'commits.verdict.fail',
  partial: 'commits.verdict.partial',
};

const REVIEW_KIND_KEY: Record<'alignment' | 'behavioral' | 'adversarial', string> = {
  alignment: 'commits.review.alignment',
  behavioral: 'commits.review.behavioral',
  adversarial: 'commits.review.adversarial',
};

export function CommitsTimeline() {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rewindTarget, setRewindTarget] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<string | null>(null);

  // Real daemon commits when available, else mock fallback so the panel
  // never renders empty during demos / first-run.
  const realCommits = useStore((s) => s.commits);
  const mockCommits = useMemo(() => {
    if (realCommits.length === 0) return fallbackCommits;
    return realCommits
      .filter((c): c is typeof c & { sha: string; shortSha: string } => c.sha !== null && c.shortSha !== null)
      .map((c) => ({
        sha: c.sha,
        shortSha: c.shortSha,
        ts: c.ts,
        gapSlug: c.gapSlug,
        gapTitle: c.gapTitle,
        filesChanged: c.filesChanged,
        insertions: c.insertions,
        deletions: c.deletions,
        message: c.message,
        reviewVerdicts: c.reviewVerdicts.map((r) => ({
          kind: r.kind,
          verdict: (r.verdict ?? 'partial') as 'pass' | 'fail' | 'partial',
          score: r.score ?? null,
        })),
      }));
  }, [realCommits]);

  const diffCommit = diffTarget ? mockCommits.find((c) => c.sha === diffTarget) ?? null : null;
  const diffFiles = diffTarget
    ? (mockDiffByCommitSha[diffTarget] ?? mockDiffByCommitSha[diffTarget.slice(0, 7)] ?? [])
    : [];
  const diffRisk = diffTarget
    ? (mockRiskByCommitSha[diffTarget] ?? mockRiskByCommitSha[diffTarget.slice(0, 7)])
    : undefined;

  return (
    <div className="h-full overflow-y-auto" data-testid="commits-timeline">
      <div className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="text-base font-medium text-ink">{t('commits.title')}</h2>
        <span className="text-xs text-muted/70 font-sans">{mockCommits.length} {t('commits.count')}</span>
      </div>

      <ol className="space-y-4">
        {mockCommits.map((c, idx) => {
          const isOpen = expanded === c.sha;
          const checkpoint = mockCheckpoints.find((cp) => cp.commitSha === c.sha);
          const isLast = idx === mockCommits.length - 1;
          const risk = mockRiskByCommitSha[c.sha] ?? mockRiskByCommitSha[c.shortSha];
          const ringClass = riskCardRingClass(risk);

          return (
            <li
              key={c.sha}
              className="relative pl-8 anim-stagger"
              style={{ ['--i' as 'width']: idx as unknown as string }}
              data-testid={`commit-${c.shortSha}`}
            >
              {/* Timeline dot + line */}
              <span className="absolute left-3 top-5 w-2.5 h-2.5 rounded-full bg-sage-600 ring-4 ring-sage-50" />
              {!isLast && (
                <span className="absolute left-[15px] top-9 bottom-[-16px] w-px bg-warmline" />
              )}

              <div className={`bg-cream rounded-xl shadow-card ring-1 ring-warmline/60 px-5 py-4 lift-on-hover ${ringClass}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-sage-600 text-xs">{c.shortSha}</span>
                  <span className="text-sm text-ink font-medium flex-1 line-clamp-1">{c.gapTitle}</span>
                  <span className="text-[11px] text-muted/60 font-sans">{fmtRelative(c.ts, t)}</span>
                  {risk && <RiskBadge risk={risk} />}
                </div>

                <div className="text-xs text-muted/80 mb-3 line-clamp-1">{c.message}</div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-[11px] text-muted/60 font-sans">{c.filesChanged} {t('commits.files')}</span>
                  <span className="text-[11px] text-sage-600 font-sans">+{c.insertions}</span>
                  <span className="text-[11px] text-rust font-sans">−{c.deletions}</span>
                  <span className="flex-1" />
                  {c.reviewVerdicts.map((v, i) => (
                    <span
                      key={i}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-sans ${VERDICT_CLS[v.verdict]}`}
                      title={v.score ? `score ${v.score}` : ''}
                    >
                      {t(REVIEW_KIND_KEY[v.kind])} {t(VERDICT_KEY[v.verdict])}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setRewindTarget(c.sha)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-coralsoft text-coral hover:bg-coral hover:text-cream transition-all duration-200 ease-out-quart font-sans font-medium"
                    data-testid={`rewind-${c.shortSha}`}
                    title={t('commits.rewindTip')}
                  >
                    {t('commits.rewind')}
                  </button>
                  <button
                    type="button"
                    className="text-xs px-3 py-1.5 rounded-lg text-muted hover:text-ink hover:bg-paper transition-colors font-sans"
                    onClick={() => setExpanded(isOpen ? null : c.sha)}
                  >
                    {isOpen ? t('commits.collapse') : t('commits.viewDiff')} {isOpen ? '▴' : '▾'}
                  </button>
                  <button
                    type="button"
                    className="text-xs px-3 py-1.5 rounded-lg bg-paper text-ink hover:bg-coralsoft hover:text-coral transition-colors font-sans"
                    onClick={() => setDiffTarget(c.sha)}
                    data-testid={`open-diff-${c.shortSha}`}
                  >
                    {t('commits.viewDiff')} →
                  </button>
                  {(() => {
                    const cps = checkpointsForCommit(c.sha);
                    if (cps.length === 0) return null;
                    const t0 = cps.filter((cp) => cp.pinned || cp.tier === 'T0').length;
                    return (
                      <span
                        className="ml-auto text-[11px] font-mono flex items-center gap-1"
                        title={`${cps.length} checkpoint${t0 ? ' · ' + t0 + ' T0' : ''}`}
                      >
                        <span className="text-muted/60">⏱ {cps.length}</span>
                        {t0 > 0 && (
                          <span className="text-rust">· T0 ×{t0}</span>
                        )}
                      </span>
                    );
                  })()}
                </div>

                {isOpen && (
                  <div className="mt-4 pt-3 border-t border-warmline/60 space-y-3">
                    {checkpoint && (
                      <div className="text-[11px] mb-1.5 text-coral/80">{checkpoint.description}</div>
                    )}
                    <CheckpointTimeline commitSha={c.sha} hideAuxByDefault={true} />
                    <div className="text-[11px] text-muted italic">{t('commits.diffPreview')}</div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {rewindTarget && (
        <RewindConfirm
          commit={mockCommits.find((c) => c.sha === rewindTarget)!}
          onCancel={() => setRewindTarget(null)}
          onConfirm={() => setRewindTarget(null)}
        />
      )}

      {diffTarget && diffCommit && (
        <CommitDiffDrawer
          sha={diffCommit.sha}
          message={diffCommit.message}
          files={diffFiles}
          risk={diffRisk}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </div>
  );
}

function RewindConfirm({
  commit,
  onCancel,
  onConfirm,
}: {
  commit: { shortSha: string; gapTitle: string };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  return (
    <div
      className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 anim-drift-in"
      data-testid="rewind-confirm-modal"
    >
      <div className="bg-cream rounded-2xl shadow-cardHover max-w-md w-full p-6 space-y-4 mx-4 anim-scale-in">
        <div className="text-lg font-medium text-ink">{t('commits.rewindConfirm')}</div>
        <div className="text-sm text-muted leading-relaxed">
          {t('commits.rewindDesc', { sha: commit.shortSha, title: commit.gapTitle })}
        </div>
        <div className="text-xs text-muted/70 bg-paper p-3 rounded-lg">
          {t('commits.rewindDemoNote')}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted hover:text-ink transition-colors font-sans"
          >
            {t('commits.rewindCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-rust text-cream rounded-lg hover:bg-rust/90 transition-colors font-sans font-medium"
          >
            {t('commits.rewindOK')}
          </button>
        </div>
      </div>
    </div>
  );
}
