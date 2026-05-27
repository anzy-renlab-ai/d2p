import type { ReviewBundle, StageStatus, ReviewVerify } from '../types-zerou.js';
import { ZerouStageCard } from './ZerouStageCard.js';

/**
 * Stage ④ — Verify view.
 *
 * What ZeroU just did: ran the user's own toolchain (npm install / tsc /
 * test / build) inside the enhance worktree, with all the patches applied.
 * If anything went red here, stage ③'s changes are not safe to merge.
 */

const STEP_GLYPH: Record<
  ReviewVerify['steps'][number]['status'],
  { glyph: string; tone: string; ring: string; label: string }
> = {
  pass:    { glyph: '✅', tone: 'text-forest', ring: 'ring-forest/30', label: 'pass' },
  fail:    { glyph: '❌', tone: 'text-rust',   ring: 'ring-rust/40',   label: 'fail' },
  skipped: { glyph: '⏭', tone: 'text-muted',  ring: 'ring-warmline',  label: 'skipped' },
};

export interface ZerouStageVerifyProps {
  bundle: ReviewBundle;
  status?: StageStatus;
}

export function ZerouStageVerify({ bundle, status }: ZerouStageVerifyProps) {
  const verify = bundle.verify;

  const stageStatus: StageStatus =
    status ??
    (verify.steps.length === 0
      ? 'pending'
      : verify.ok
      ? 'done'
      : 'fail');

  const metric = (
    <span className="font-mono">
      {verify.steps.map((s, i) => {
        const meta = STEP_GLYPH[s.status];
        return (
          <span key={s.name}>
            <span className="text-ink">{s.name}</span> <span className={meta.tone}>{meta.glyph}</span>
            {i < verify.steps.length - 1 && <span className="text-muted/40 mx-1.5">·</span>}
          </span>
        );
      })}
    </span>
  );

  return (
    <ZerouStageCard
      numeral="④"
      title="验"
      metric={metric}
      subMetric={
        verify.ok
          ? '改造后用户原 test suite 重跑全过'
          : `broken by ${verify.brokenBy ?? 'unknown'}`
      }
      status={stageStatus}
      testId="zerou-stage-verify"
    >
      <div className="px-5 py-4 space-y-3 text-sm">
        <div className="text-xs text-muted font-mono leading-relaxed">
          ZeroU 在 enhance 分支上跑了你 package.json 里那条管道 — install / tsc /
          test / build。这一步是绿，才能给你 merge 命令；红，stage ③ 自动回滚到
          上一个绿 commit。
        </div>

        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          data-testid="zerou-stage-verify-chips"
        >
          {verify.steps.map((step) => {
            const meta = STEP_GLYPH[step.status];
            return (
              <div
                key={step.name}
                className={`bg-paper border border-warmline rounded-md p-3 ring-1 ${meta.ring}`}
                data-testid={`zerou-stage-verify-step-${step.name}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-mono uppercase tracking-wider text-ink">
                    {step.name}
                  </span>
                  <span className={`text-lg leading-none ${meta.tone}`} aria-label={meta.label}>
                    {meta.glyph}
                  </span>
                </div>
                <div className="text-[10px] text-muted/70 font-mono mt-1.5">
                  {step.durationMs > 0 ? `${(step.durationMs / 1000).toFixed(1)}s` : '—'}
                </div>
                {step.failOutput && (
                  <pre className="mt-2 text-[10px] font-mono text-rust whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                    {step.failOutput}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-[10px] text-muted/60 font-serif italic pt-1 border-t border-warmline/60">
          这条 stage 不证明你的代码是对的 — 只证明 ZeroU 没把它弄坏。
        </div>
      </div>
    </ZerouStageCard>
  );
}
