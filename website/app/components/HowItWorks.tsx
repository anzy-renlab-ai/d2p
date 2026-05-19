'use client';

import { FolderInput, MessageCircle, Network, GitPullRequest, type LucideIcon } from 'lucide-react';
import { useLang } from '../i18n';
import { ScrollFadeIn } from './primitives/ScrollFadeIn';

type Step = {
  n: string;
  icon: LucideIcon;
  titleEn: string;
  titleZh: string;
  descEn: string;
  descZh: string;
};

const STEPS: Step[] = [
  {
    n: '01',
    icon: FolderInput,
    titleEn: 'Drop a path',
    titleZh: '给一个路径',
    descEn:
      'Any local folder. ZeroU runs `git init`, detects the stack, runs the detector, and lists gaps in 5 seconds.',
    descZh:
      '任意本地文件夹,ZeroU 自动 git init、识别栈、跑 detector,5 秒出 gap 清单。',
  },
  {
    n: '02',
    icon: MessageCircle,
    titleEn: 'Elicit your vision',
    titleZh: '多轮 elicit vision',
    descEn:
      'No prompt writing — haiku asks 5–7 specific questions (target user, business model, core scenarios, what NOT to build). You click answers.',
    descZh:
      '不写 prompt——haiku 提 5–7 个具体问题(目标用户、商业模式、核心场景、不做什么),你按按钮答完即可。',
  },
  {
    n: '03',
    icon: Network,
    titleEn: 'Six agents go to work',
    titleZh: '派 6 个 agent 干活',
    descEn:
      'differ / implementer / alignment / behavioral / done-check / repo-summary run in parallel. Four reviewer layers gate the result — static → alignment → behavioral → adversarial (high-risk only).',
    descZh:
      'differ / implementer / alignment / behavioral / done-check / repo-summary 并行跑;4 层 reviewer pipeline 把关——static gate → alignment probe → behavioral → adversarial(高敏 gap 才上)。',
  },
  {
    n: '04',
    icon: GitPullRequest,
    titleEn: 'PR lands on GitHub',
    titleZh: '自动 PR 上 GitHub',
    descEn:
      'Merged commits land on main, push to your remote, and `gh pr create` runs. NEED_HUMAN items go into the PR body with reason codes. You review the PR, not the diff.',
    descZh:
      'merged commit 直接进 main + 真 push 远端 + gh pr create。NEED_HUMAN 的 gap 写进 PR body,带 reason code。你 review 的是 PR 不是 diff。',
  },
];

export function HowItWorks() {
  const { t } = useLang();
  return (
    <section id="how" className="bg-paper px-6 py-24 lg:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollFadeIn className="text-center">
          <h2 className="font-serif text-[32px] font-medium leading-tight text-ink sm:text-[40px]">
            {t('4 steps. Demo to PR.', '4 步,从 demo 到 PR')}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-muted">
            {t(
              'No diff review. No prompt engineering. Give a path. Wait for green.',
              '不审 diff,不写 prompt。给路径,等绿。',
            )}
          </p>
        </ScrollFadeIn>

        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <ScrollFadeIn key={step.n} delay={idx * 0.08}>
                <article className="group relative flex h-full flex-col rounded-2xl bg-cream p-6 shadow-card ring-1 ring-warmline/60 transition-all hover:-translate-y-0.5 hover:shadow-cardHover">
                  <span className="font-serif italic text-[28px] text-coral">{step.n}</span>
                  <h3 className="mt-4 text-lg font-medium text-ink">
                    {t(step.titleEn, step.titleZh)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {t(step.descEn, step.descZh)}
                  </p>
                  <div className="mt-6 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-paper ring-1 ring-warmline transition-colors group-hover:bg-coralsoft">
                    <Icon size={18} strokeWidth={1.5} className="text-coral" aria-hidden="true" />
                  </div>
                </article>
              </ScrollFadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}
