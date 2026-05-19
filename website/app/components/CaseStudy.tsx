'use client';

import { ArrowRight, GitCommit } from 'lucide-react';
import { useLang } from '../i18n';
import { CountUp } from './primitives/CountUp';
import { ScrollFadeIn } from './primitives/ScrollFadeIn';

const COMMITS = [
  {
    sha: '5aedd6e',
    slug: 'fix/docs-changelog-missing',
    note: 'CHANGELOG.md · attempt 1 · merged',
    tone: 'merged' as const,
  },
  {
    sha: '4b58841',
    slug: 'fix/readme-minimal-incomplete',
    note: 'README expand · attempt 3 · merged · PR #6',
    tone: 'merged' as const,
  },
  {
    sha: '3d2ad5f',
    slug: 'fix/changelog-followup',
    note: 'still running',
    tone: 'open' as const,
  },
  {
    sha: '53df272',
    slug: 'fix/readme-polish',
    note: 'still running',
    tone: 'open' as const,
  },
];

const NEED_HUMAN = [
  'auth-csrf-protection · ALIGNMENT_LOW',
  'auth-password-recovery · BUGGY',
  'db-backup-path · INCOMPLETE',
  'ci-pipeline-missing · STATIC_GATE',
  'ui-empty-states · ALIGNMENT_LOW',
  'ui-loading-states · BUGGY',
  'a11y-basic-issues · INCOMPLETE',
  'deploy-env-doc-missing · ALIGNMENT_LOW',
];

export function CaseStudy() {
  const { t } = useLang();
  return (
    <section id="case" className="bg-paper px-6 py-24 lg:py-32">
      <div className="mx-auto max-w-5xl">
        <ScrollFadeIn>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-coral">
            CASE STUDY · 2026-05-19
          </div>
          <h2 className="mt-4 font-serif text-[32px] font-medium leading-tight text-ink sm:text-[44px]">
            {t(
              '1h 31min. $4.24. Two merges to main.',
              '1h 31min,$4.24,2 个 commit merged 到 main',
            )}
          </h2>
        </ScrollFadeIn>

        {/* Hero numbers */}
        <ScrollFadeIn delay={0.1}>
          <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
            <div>
              <div className="font-serif text-[44px] leading-none text-coral sm:text-[56px]">
                <CountUp
                  to={91}
                  duration={1400}
                  staticDisplay="1h 31min"
                  className="hidden"
                />
                <span>1h 31min</span>
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                DURATION
              </div>
            </div>
            <div>
              <div className="font-serif text-[44px] leading-none text-coral sm:text-[56px]">
                $<CountUp to={4.24} decimals={2} duration={1400} />
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                TOTAL COST
              </div>
            </div>
            <div>
              <div className="font-serif text-[44px] leading-none text-coral sm:text-[56px]">
                <CountUp to={2} duration={1100} />
                <span className="text-muted/60">/28</span>
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                PRESET CLOSED
              </div>
            </div>
            <div>
              <div className="font-serif text-[44px] leading-none text-coral sm:text-[56px]">
                <CountUp to={24} duration={1400} />
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted">
                NEED_HUMAN
              </div>
            </div>
          </div>
          <div className="mt-6 font-mono text-[12px] text-muted">
            454,674 in · 237,787 out tokens
          </div>
        </ScrollFadeIn>

        {/* Project description card */}
        <ScrollFadeIn delay={0.15}>
          <div className="mt-14 grid grid-cols-1 gap-8 rounded-2xl bg-cream p-8 shadow-card ring-1 ring-warmline/60 sm:grid-cols-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                vision excerpt
              </div>
              <blockquote className="mt-3 font-serif text-[16px] italic leading-relaxed text-ink">
                &ldquo;竞技化的德州扑克观赏与社交平台 / 抽水 rake 模式 / DAU 30%+&rdquo;
              </blockquote>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted">
                Project
              </dt>
              <dd className="font-mono text-ink">agent-game-platform</dd>
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted">
                Stack
              </dt>
              <dd className="text-ink">Next.js + Bun</dd>
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted">
                Preset
              </dt>
              <dd className="font-mono text-ink">saas-web · 28 items</dd>
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted">
                Verdict
              </dt>
              <dd className="text-ink">rake · social · spectator — three lines hit</dd>
            </dl>
          </div>
        </ScrollFadeIn>

        {/* Commit timeline */}
        <ScrollFadeIn delay={0.2}>
          <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[3fr_2fr]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                merged commits
              </div>
              <ul className="mt-4 space-y-3" role="list">
                {COMMITS.map((c) => (
                  <li
                    key={c.sha}
                    className="relative flex items-start gap-4 rounded-xl bg-cream px-4 py-3 shadow-soft ring-1 ring-warmline/60"
                  >
                    <span
                      className={`mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                        c.tone === 'merged'
                          ? 'bg-forest/15 text-forest'
                          : 'bg-paper text-muted'
                      }`}
                      aria-hidden="true"
                    >
                      <GitCommit size={12} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
                        <span className="text-ink">{c.sha}</span>
                        <span className="text-muted">·</span>
                        <span className="text-ink/80">{c.slug}</span>
                        {c.tone === 'merged' && (
                          <span className="inline-flex items-center rounded-full bg-sage-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sage-600 ring-1 ring-sage-600/20">
                            merged
                          </span>
                        )}
                        {c.slug.includes('readme-minimal') && (
                          <a
                            href="https://github.com/anzy-renlab-ai/agent-game-platform/pull/6"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-full bg-coralsoft px-2 py-0.5 text-[10px] uppercase tracking-wider text-coral ring-1 ring-coral/20 hover:bg-coral hover:text-cream"
                          >
                            PR #6
                          </a>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted">{c.note}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                NEED_HUMAN · 24 items
              </div>
              <div className="mt-4 rounded-xl bg-cream p-6 shadow-card ring-1 ring-warmline/60">
                <h3 className="text-sm font-medium text-ink">
                  {t(
                    "24 items need a human. ZeroU doesn't pretend otherwise.",
                    '24 项卡在人类决策上,ZeroU 不假装搞定',
                  )}
                </h3>
                <ul
                  className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 font-mono text-[12px] text-muted"
                  role="list"
                >
                  {NEED_HUMAN.map((line) => (
                    <li key={line} className="truncate">
                      {line}
                    </li>
                  ))}
                </ul>
                <a
                  href="https://github.com/anzy-renlab-ai/agent-game-platform/pull/6"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-1 text-sm text-coral hover:underline"
                >
                  {t('+ 16 more → see full PR body', '+ 16 项 → 看完整 PR body')}
                  <ArrowRight size={14} aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </ScrollFadeIn>

        {/* CTAs */}
        <ScrollFadeIn delay={0.25}>
          <div className="mt-14 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="https://github.com/anzy-renlab-ai/agent-game-platform/pull/6"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-coral px-5 py-3 text-sm font-medium text-cream transition-all hover:-translate-y-px hover:bg-coralhover"
            >
              {t('View the real PR #6', '看真 PR #6')}
              <ArrowRight size={14} aria-hidden="true" />
            </a>
            <a
              href="https://github.com/anzy-renlab-ai/agent-game-platform"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-coral underline-offset-4 hover:underline"
            >
              {t('See the full session summary →', '看完整 session summary →')}
            </a>
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
