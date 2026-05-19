'use client';

import { useLang } from '../i18n';
import { ScrollFadeIn } from './primitives/ScrollFadeIn';
import { ChipBadge } from './primitives/ChipBadge';

const LOGOS = [
  'Anthropic',
  'Claude Code',
  'git',
  'GitHub',
  'gh CLI',
  'Node.js 24',
  'TypeScript',
  'SQLite',
  'vitest',
];

export function TechCredibility() {
  const { t } = useLang();
  return (
    <section className="bg-cream px-6 py-24 lg:py-28">
      <div className="mx-auto max-w-5xl">
        <ScrollFadeIn className="text-center">
          <h2 className="font-serif text-[26px] font-medium leading-tight text-ink sm:text-[32px]">
            {t('Built on tools you already trust.', '跑在你已经信任的东西上')}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-muted">
            {t(
              'ZeroU holds no API keys and runs no models. Everything goes through the `claude` CLI subprocess, system `git`, and `gh` CLI.',
              'ZeroU 不持任何 API key,不跑自己的模型。全部走 claude CLI 子进程,git 走系统 git,PR 走 gh CLI。',
            )}
          </p>
        </ScrollFadeIn>

        <ScrollFadeIn delay={0.1}>
          <ul
            className="mt-12 flex flex-wrap items-center justify-center gap-x-12 gap-y-6"
            role="list"
          >
            {LOGOS.map((logo) => (
              <li
                key={logo}
                className="font-mono text-[14px] uppercase tracking-[0.15em] text-muted transition-colors hover:text-ink"
              >
                {logo}
              </li>
            ))}
          </ul>
        </ScrollFadeIn>

        <ScrollFadeIn delay={0.15}>
          <div className="mt-12 flex flex-wrap justify-center gap-2">
            <ChipBadge tone="paper">no api key stored</ChipBadge>
            <ChipBadge tone="paper">your git, your remote, your gh</ChipBadge>
            <ChipBadge tone="paper">model switch any time</ChipBadge>
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
