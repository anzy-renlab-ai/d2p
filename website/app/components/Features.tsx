'use client';

import { useLang } from '../i18n';
import { ScrollFadeIn } from './primitives/ScrollFadeIn';
import { ReviewerPipeline } from './ReviewerPipeline';
import { AgentBoard } from './AgentBoard';
import { PrCardMock } from './PrCardMock';

type FeatureBlockProps = {
  reverse?: boolean;
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
  visual: React.ReactNode;
};

function FeatureBlock({ reverse, eyebrow, title, body, bullets, visual }: FeatureBlockProps) {
  return (
    <ScrollFadeIn>
      <article
        className={`grid items-center gap-10 lg:grid-cols-2 lg:gap-16 ${
          reverse ? 'lg:[&>*:first-child]:order-2' : ''
        }`}
      >
        <div className="flex flex-col">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-coral">
            {eyebrow}
          </div>
          <h3 className="mt-4 font-serif text-[28px] font-medium leading-tight text-ink sm:text-[32px]">
            {title}
          </h3>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">{body}</p>
          {bullets && bullets.length > 0 && (
            <ul className="mt-6 space-y-3" role="list">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-muted">
                  <span className="mt-2 h-px w-4 flex-shrink-0 bg-coral" aria-hidden="true" />
                  <span className="font-mono text-[12.5px] text-ink/80">{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>{visual}</div>
      </article>
    </ScrollFadeIn>
  );
}

export function Features() {
  const { t } = useLang();
  return (
    <section className="bg-cream px-6 py-24 lg:py-32">
      <div className="mx-auto flex max-w-6xl flex-col gap-28 lg:gap-32">
        <FeatureBlock
          eyebrow="REVIEWER · 4 LAYERS"
          title={t(
            'Four reviewers. Not one LLM guessing.',
            '四层 reviewer 把关,不是一只 LLM 拍脑袋',
          )}
          body={t(
            'Static gate runs real tsc / lint / test. Alignment probe is a cross-engine score from minimax. Behavioral runs acceptance. Adversarial only fires for high-risk gaps. Any fail → NEED_HUMAN, no cost burn.',
            'Static gate 跑真 tsc / lint / test;alignment probe 用 minimax 跨引擎对齐打分;behavioral reviewer 跑 acceptance;adversarial 只在高敏 gap 上场。任何一层 fail 自动转 NEED_HUMAN,不烧用户的钱。',
          )}
          bullets={[
            'STATIC_GATE · skips when tsc / bun test missing',
            'ALIGNMENT_LOW · cross-engine must agree',
            'ADVERSARIAL_BREAK · security-sensitive gaps probed twice',
          ]}
          visual={<ReviewerPipeline />}
        />

        <FeatureBlock
          reverse
          eyebrow="AGENTS · 6 ROLES"
          title={t('Six agents, six jobs, watched live.', '6 个 agent 各司其职,实时看着干')}
          body={t(
            "Not a black-box worker. Each agent's current gap, call count, last turn — visible. Click in for the turn-by-turn timeline.",
            '不是黑盒后台 worker。每个 agent 当前在哪个 gap、调了几次、上一轮做了什么——全部在 UI 上,点开 drawer 看 turn-by-turn timeline。',
          )}
          bullets={['61 fix attempts · 2 merged · 24 escalated']}
          visual={<AgentBoard />}
        />

        <FeatureBlock
          eyebrow="PR · TRANSPARENT TRIAGE"
          title={t('PR body ships triage', 'PR body 自带 triage 清单')}
          body={t(
            "Each merged fix gets a PR. The body has gap meta, reviewer scores, the NEED_HUMAN list, and a cost footer. You review the PR, not the diff.",
            '每个 merged fix 一个 PR。PR body 4 段:gap meta、reviewer 评分、NEED_HUMAN 列表、cost footer。你 review 的是 PR 不是 diff。',
          )}
          visual={<PrCardMock />}
        />
      </div>
    </section>
  );
}
