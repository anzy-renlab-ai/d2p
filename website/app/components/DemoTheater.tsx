'use client';

import { useLang } from '../i18n';
import { ScrollFadeIn } from './primitives/ScrollFadeIn';

/**
 * Dark-mode full-width section that puts the 62s demo video on stage. Matches
 * the video's own visual language (#0A0A0A bg, #7CFFB2 mint accent) so the
 * eye stays inside the same aesthetic the video already trains.
 */
export function DemoTheater() {
  const { t, lang } = useLang();

  return (
    <section
      id="demo"
      className="relative overflow-hidden bg-[#0A0A0A] py-24 lg:py-32"
      aria-label="ZeroU demo video"
    >
      {/* faint mint grid background */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'radial-gradient(rgba(124, 255, 178, 1) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* corner accent line */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 h-px w-32 bg-gradient-to-r from-[#7CFFB2] to-transparent"
      />
      <div
        aria-hidden="true"
        className="absolute right-0 bottom-0 h-px w-32 bg-gradient-to-l from-[#7CFFB2] to-transparent"
      />

      <div className="relative mx-auto max-w-6xl px-6 lg:px-10">
        <ScrollFadeIn>
          <div className="mb-10 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[#7CFFB2]">
            <span className="h-px w-12 bg-[#7CFFB2]" />
            <span>01 — the run, in 60 seconds</span>
          </div>
        </ScrollFadeIn>

        <ScrollFadeIn delay={0.08}>
          <h2 className="font-serif text-4xl font-medium leading-tight text-[#F5F5F0] sm:text-5xl lg:text-6xl">
            {lang === 'zh' ? (
              <>
                六个 agent。
                <span className="italic text-[#7CFFB2]">四层审核。</span>
                <br />
                一晚跑完。
              </>
            ) : (
              <>
                Six agents.{' '}
                <span className="italic text-[#7CFFB2]">Four reviewers.</span>
                <br />
                One overnight run.
              </>
            )}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[#A8A8A0]">
            {t(
              'Real data from a real run on agent-game-platform — every commit sha, every score, every rejection in the PR body.',
              '基于 agent-game-platform 真跑数据 — 每个 commit sha、每个 reviewer 评分、每条 NEED_HUMAN 都写进 PR body。',
            )}
          </p>
        </ScrollFadeIn>

        <ScrollFadeIn delay={0.16}>
          <div
            className="relative mt-12 overflow-hidden rounded-2xl ring-1 ring-[#7CFFB2]/20"
            style={{
              boxShadow:
                '0 0 0 1px rgba(124, 255, 178, 0.1), 0 20px 60px -20px rgba(124, 255, 178, 0.2)',
            }}
          >
            <video
              src="/zerou-demo.mp4"
              autoPlay
              loop
              muted
              playsInline
              controls
              preload="auto"
              className="aspect-video w-full bg-[#0A0A0A] object-cover"
              aria-label="ZeroU 60-second demo with full reviewer pipeline"
            />
            {/* inner mint frame glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-2xl"
              style={{
                boxShadow: '0 0 120px -30px rgba(124, 255, 178, 0.4) inset',
              }}
            />
          </div>
        </ScrollFadeIn>

        <ScrollFadeIn delay={0.24}>
          <div className="mt-10 grid grid-cols-2 gap-y-4 font-mono text-xs text-[#A8A8A0] sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#7CFFB2]/70">
                duration
              </div>
              <div className="mt-1 text-[#F5F5F0]">1h 31min</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#7CFFB2]/70">
                cost
              </div>
              <div className="mt-1 text-[#F5F5F0]">$4.24</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#7CFFB2]/70">
                merged
              </div>
              <div className="mt-1 text-[#F5F5F0]">2 / 28</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#7CFFB2]/70">
                need_human
              </div>
              <div className="mt-1 text-[#F5F5F0]">24 honest</div>
            </div>
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
