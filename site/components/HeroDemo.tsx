'use client';

/**
 * HeroDemo — 52-second auto-playing centerpiece animation for the ZeroU site.
 *
 * Tells the ZeroU story in 7 phases (total 52s, loops forever):
 *   problem    0.0s –  5.0s  (5.0s)   — "Vibe-coded demo. Works locally."
 *   install    5.0s – 10.0s  (5.0s)   — npm install -g zerou + audit invocation
 *   scan      10.0s – 18.0s  (8.0s)   — AST + presets + LLM judge findings
 *   fix       18.0s – 27.0s  (9.0s)   — diff + verdict timeline × → ↻ → ✓
 *   enhance   27.0s – 37.0s  (10.0s)  — IDE ↔ log-viewer: log line points to src line
 *   verify    37.0s – 45.0s  (8.0s)   — 4 gates flipping + victory banner
 *   bench     45.0s – 52.0s  (7.0s)   — head-to-head vs Sonnet/Opus, real numbers
 *
 * Pure CSS animations + React state. No external animation libs.
 * Respects prefers-reduced-motion: pins to final 'bench' frame + Play button.
 *
 * Default-exports HeroDemo. Sub-components live in this same file by design
 * (self-contained, no separate files for sub-pieces).
 */

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Phase = 'problem' | 'install' | 'scan' | 'fix' | 'enhance' | 'verify' | 'bench';

interface PhaseSpec {
  id: Phase;
  /** Duration in milliseconds */
  duration: number;
  /** Human-readable stage label (shown in indicator chip) */
  label: string;
  /** Caption shown at top during the phase */
  caption: string;
  /** Optional sub-caption below the caption */
  subcaption?: string;
}

export const PHASES: PhaseSpec[] = [
  { id: 'problem', duration: 5000,  label: 'Problem', caption: 'Vibe-coded demo. Works locally.', subcaption: 'Pre-production. 31 hardening gaps. Zero structured logs. No tests.' },
  { id: 'install', duration: 5000,  label: 'Install', caption: 'npm install -g zerou', subcaption: 'One command. Pointed at a real Next.js project.' },
  { id: 'scan',    duration: 8000,  label: 'Scan',    caption: 'Scan: AST + presets + LLM judge', subcaption: '27 preset families · 359 rules · 31 issues surface.' },
  { id: 'fix',     duration: 9000,  label: 'Fix',     caption: 'Generate spec → judge fails → patch → judge passes', subcaption: 'Bug found, fix applied, re-verified. × → ✓' },
  { id: 'enhance', duration: 10000, label: 'Enhance', caption: 'Enhance: production-grade observability, generated', subcaption: 'pino · Sentry · trace_id · /health — every log points back to source.' },
  { id: 'verify',  duration: 8000,  label: 'Verify',  caption: 'Verify: install · tsc · test · build', subcaption: 'Tests still pass. Build still works. Verified.' },
  { id: 'bench',   duration: 7000,  label: 'Bench',   caption: 'Benchmark: ZeroU vs frontier models', subcaption: 'Head-to-head on real audit work. Architecture > raw model.' },
];

export const TOTAL_DURATION = PHASES.reduce((acc, p) => acc + p.duration, 0); // 52000ms

// Cumulative end-of-phase markers. cumulative[i] is the elapsed-ms boundary at
// which phase i ENDS and phase i+1 begins. Phase i covers
// [cumulative[i-1] ?? 0, cumulative[i]) — half-open, strict less-than upper.
const PHASE_CUMULATIVE: number[] = PHASES.reduce<number[]>((acc, p, i) => {
  acc.push((acc[i - 1] ?? 0) + p.duration);
  return acc;
}, []);

/**
 * Single source of truth for "where are we in the 52s loop?". Used by BOTH the
 * phase content router AND PhaseTimeline so the bottom progress strip can
 * never disagree with the rendered phase by even one frame.
 *
 * Boundary semantics: phase i contains [start(i), start(i+1)) — strict less
 * than on the upper bound. At exactly elapsed = PHASE_CUMULATIVE[i-1] we are
 * already in phase i with progress = 0.
 */
export function phaseAt(elapsedMs: number): { index: number; progress: number } {
  const t = ((elapsedMs % TOTAL_DURATION) + TOTAL_DURATION) % TOTAL_DURATION;
  for (let i = 0; i < PHASES.length; i++) {
    const start = i === 0 ? 0 : PHASE_CUMULATIVE[i - 1];
    const end = PHASE_CUMULATIVE[i];
    if (t < end) {
      return { index: i, progress: (t - start) / PHASES[i].duration };
    }
  }
  return { index: PHASES.length - 1, progress: 1 };
}

// Stage title strings used by the big PhaseTimeline section-title strip below.
const STAGE_TITLES: Record<Phase, string> = {
  problem: 'Problem: vibe-coded demo, ~31 hardening gaps',
  install: 'Install: one npm install, point at your repo',
  scan:    'Scan: AST + presets + LLM judge',
  fix:     'Fix: spec, judge, patch, re-judge',
  enhance: 'Enhance: production-grade observability, generated',
  verify:  'Verify: install · tsc · test · build',
  bench:   'Benchmark: ZeroU vs frontier models',
};

// ---------------------------------------------------------------------------
// Reduced-motion hook
// ---------------------------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefers(mql.matches);
    const handler = (e: MediaQueryListEvent) => setPrefers(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);
  return prefers;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HeroDemo() {
  const prefersReduced = usePrefersReducedMotion();
  const [forcePlay, setForcePlay] = useState(false);
  const animationDisabled = prefersReduced && !forcePlay;

  const [phaseIdx, setPhaseIdx] = useState(0);
  const [phaseProgress, setPhaseProgress] = useState(0); // 0..1 within current phase
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const pauseAccumRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);

  // Drive phase + progress with a single RAF loop.
  useEffect(() => {
    if (animationDisabled) return;

    startRef.current = performance.now();
    pauseAccumRef.current = 0;
    pauseStartRef.current = null;
    setFinished(false);

    const tick = (now: number) => {
      if (paused) {
        if (pauseStartRef.current == null) pauseStartRef.current = now;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (pauseStartRef.current != null) {
        pauseAccumRef.current += now - pauseStartRef.current;
        pauseStartRef.current = null;
      }
      const elapsed = now - startRef.current - pauseAccumRef.current;

      // Clamp to TOTAL_DURATION; stop animation when reached.
      if (elapsed >= TOTAL_DURATION) {
        const { index, progress } = phaseAt(TOTAL_DURATION - 1);
        setPhaseIdx(index);
        setPhaseProgress(progress);
        setFinished(true);
        return; // Don't schedule next frame
      }

      const { index, progress } = phaseAt(elapsed);
      setPhaseIdx(index);
      setPhaseProgress(progress);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [animationDisabled, paused]);

  const phase = PHASES[phaseIdx].id;
  const spec = PHASES[phaseIdx];

  // Static fallback: pin to the final 'bench' phase (the punchline frame).
  const effectivePhase: Phase = animationDisabled ? 'bench' : phase;
  const effectiveProgress = animationDisabled ? 1 : phaseProgress;
  const effectiveSpec = animationDisabled ? PHASES[PHASES.length - 1] : spec;
  const effectiveIdx = animationDisabled ? PHASES.length - 1 : phaseIdx;

  const replay = () => {
    setFinished(false);
    startRef.current = performance.now();
    pauseAccumRef.current = 0;
    pauseStartRef.current = null;
    setPhaseIdx(0);
    setPhaseProgress(0);
    rafRef.current = requestAnimationFrame((now: number) => {
      const tick = (t: number) => {
        if (paused) {
          if (pauseStartRef.current == null) pauseStartRef.current = t;
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        if (pauseStartRef.current != null) {
          pauseAccumRef.current += t - pauseStartRef.current;
          pauseStartRef.current = null;
        }
        const elapsed = t - startRef.current - pauseAccumRef.current;

        if (elapsed >= TOTAL_DURATION) {
          const { index, progress } = phaseAt(TOTAL_DURATION - 1);
          setPhaseIdx(index);
          setPhaseProgress(progress);
          setFinished(true);
          return;
        }

        const { index, progress } = phaseAt(elapsed);
        setPhaseIdx(index);
        setPhaseProgress(progress);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick(now);
    });
  };

  return (
    <div
      data-testid="hero-demo"
      data-phase={effectivePhase}
      className="relative w-full h-full min-h-[600px] rounded-lg overflow-hidden border border-warmline bg-cream shadow-card font-sans"
      onMouseEnter={() => !animationDisabled && setPaused(true)}
      onMouseLeave={() => !animationDisabled && setPaused(false)}
    >
      {/* Caption */}
      <Caption
        caption={effectiveSpec.caption}
        subcaption={effectiveSpec.subcaption}
      />

      {/* Phase canvas — slim header (88px) + big PhaseTimeline at bottom (~150px). */}
      <div className="absolute inset-x-0 top-[88px] bottom-[150px] px-4 sm:px-6 overflow-hidden">
        {effectivePhase === 'problem' && <PhaseProblem progress={effectiveProgress} />}
        {effectivePhase === 'install' && <PhaseInstall progress={effectiveProgress} />}
        {effectivePhase === 'scan' && <PhaseScan progress={effectiveProgress} />}
        {effectivePhase === 'fix' && <PhaseFix progress={effectiveProgress} />}
        {effectivePhase === 'enhance' && <PhaseEnhance progress={effectiveProgress} />}
        {effectivePhase === 'verify' && <PhaseVerify progress={effectiveProgress} />}
        {effectivePhase === 'bench' && <PhaseBench progress={effectiveProgress} />}
      </div>

      {/* Big stepped section-title strip at bottom */}
      <PhaseTimeline
        currentIdx={effectiveIdx}
        phaseProgress={effectiveProgress}
      />

      {/* Reduced-motion play button */}
      {prefersReduced && !forcePlay && (
        <button
          type="button"
          data-testid="hero-demo-play"
          onClick={() => setForcePlay(true)}
          className="absolute top-2 right-2 z-10 px-3 py-1.5 text-xs font-medium rounded-full bg-ink/85 text-cream hover:bg-ink transition-colors"
          aria-label="Play hero animation"
        >
          ▶ Play
        </button>
      )}

      {/* Replay button (animation finished) */}
      {finished && !animationDisabled && (
        <button
          type="button"
          data-testid="hero-demo-replay"
          onClick={replay}
          className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-md bg-coral text-cream text-xs font-medium hover:opacity-90 transition-opacity anim-drift-in"
          aria-label="Replay demo"
        >
          ↻ Replay
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caption (aria-live)
// ---------------------------------------------------------------------------

function Caption({ caption, subcaption }: { caption: string; subcaption?: string }) {
  return (
    <div
      className="absolute inset-x-0 top-0 px-5 pt-4 pb-2 flex flex-col gap-1 z-[5]"
      aria-live="polite"
      aria-atomic="true"
    >
      <p
        key={caption}
        className="text-base sm:text-lg font-serif font-semibold text-ink leading-tight anim-drift-in"
      >
        {caption}
      </p>
      {subcaption && (
        <p
          key={subcaption}
          className="text-xs sm:text-sm text-muted leading-snug anim-drift-in"
          style={{ animationDelay: '60ms' }}
        >
          {subcaption}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Big PhaseTimeline — section-title-style stepped progress strip
// ---------------------------------------------------------------------------

const STAGE_ORDER: Phase[] = ['problem', 'install', 'scan', 'fix', 'enhance', 'verify', 'bench'];
const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];

function PhaseTimeline({
  currentIdx,
  phaseProgress,
}: {
  currentIdx: number;
  phaseProgress: number;
}) {
  const current = STAGE_ORDER[currentIdx];
  const totalMs = PHASES.reduce((a, p) => a + p.duration, 0);

  return (
    <div className="absolute inset-x-0 bottom-0 z-[5] bg-gradient-to-t from-cream via-cream to-cream/95 border-t border-warmline/70 px-4 sm:px-6 pt-3 pb-3">
      {/* Row of 7 stepped segments, flex with grow proportional to phase ms */}
      <div className="flex items-stretch gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
        {STAGE_ORDER.map((stage, i) => {
          const spec = PHASES[i];
          const active = i === currentIdx;
          const past = i < currentIdx;
          const future = i > currentIdx;
          // Bar fill: active fills per phaseProgress; past 100%; future 0%.
          const fillPct = active ? Math.min(100, Math.max(0, phaseProgress * 100)) : past ? 100 : 0;

          // Color tokens
          const numberCls = active
            ? 'text-coral ring-2 ring-coral/50 bg-coral/10'
            : past
            ? 'text-forest bg-sage-100'
            : 'text-muted bg-warmline/40';
          const labelCls = active
            ? 'text-ink font-bold'
            : past
            ? 'text-muted'
            : 'text-muted/70';
          const barBgCls = future ? 'bg-warmline/60' : 'bg-warmline/30';
          const barFillCls = active ? 'bg-coral' : past ? 'bg-forest' : 'bg-transparent';

          return (
            <div
              key={stage}
              className="flex-1 min-w-[110px] sm:min-w-0 flex flex-col items-stretch gap-1.5"
              style={{ flex: '1 1 0' }}
              aria-current={active ? 'step' : undefined}
            >
              {/* Number + name */}
              <div className="flex items-center gap-1.5 px-0.5">
                <span
                  className={[
                    'inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-mono font-semibold transition-all duration-200 shrink-0',
                    numberCls,
                  ].join(' ')}
                >
                  {CIRCLED_NUMBERS[i]}
                </span>
                <span
                  className={[
                    'font-serif uppercase tracking-widest text-sm sm:text-base lg:text-lg leading-tight truncate transition-colors duration-200',
                    labelCls,
                  ].join(' ')}
                >
                  {spec.label}
                </span>
              </div>

              {/* Thick bar — no width transition: bar fill must track RAF tick exactly,
                  otherwise the active bar visibly lags 150ms behind phase content. */}
              <div className={['relative h-2 sm:h-2.5 rounded-full overflow-hidden', barBgCls].join(' ')}>
                <div
                  className={[
                    'absolute inset-y-0 left-0 rounded-full',
                    barFillCls,
                  ].join(' ')}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Caption row */}
      <div className="mt-2 flex items-center justify-center">
        <p
          key={current}
          className="text-sm sm:text-base font-mono text-ink leading-tight anim-drift-in text-center"
        >
          <span className="text-muted">Stage {currentIdx + 1} of 7 —</span>{' '}
          <span className="font-semibold text-ink">{STAGE_TITLES[current]}</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeUpTo(full: string, progress: number, startAt = 0, endAt = 0.65): string {
  // Type the string out over [startAt, endAt] segment of phase progress.
  if (progress <= startAt) return '';
  const cap = Math.min(1, (progress - startAt) / (endAt - startAt));
  const len = Math.floor(full.length * cap);
  return full.slice(0, len);
}

function reveal<T>(items: T[], progress: number, start = 0.1, end = 0.95): number {
  if (progress <= start) return 0;
  if (progress >= end) return items.length;
  const ratio = (progress - start) / (end - start);
  return Math.min(items.length, Math.floor(items.length * ratio) + 1);
}

// ---------------------------------------------------------------------------
// PHASE 1 — Problem: IDE-like file tree + "what's wrong" diagnostic strip
// ---------------------------------------------------------------------------

const MW_TREE: { depth: number; name: string; tag: 'file' | 'dir'; bug?: boolean }[] = [
  { depth: 0, name: 'meme-weather/', tag: 'dir' },
  { depth: 1, name: 'app/', tag: 'dir' },
  { depth: 2, name: 'page.tsx', tag: 'file' },
  { depth: 2, name: 'api/', tag: 'dir' },
  { depth: 3, name: 'auth/callback/route.ts', tag: 'file', bug: true },
  { depth: 3, name: 'me/profile/route.ts', tag: 'file', bug: true },
  { depth: 3, name: 'weather/route.ts', tag: 'file' },
  { depth: 1, name: 'lib/supabase.ts', tag: 'file' },
  { depth: 1, name: 'scripts/seed.ts', tag: 'file', bug: true },
  { depth: 1, name: 'components/share-poster.tsx', tag: 'file', bug: true },
  { depth: 1, name: 'package.json', tag: 'file' },
];

const PROBLEM_ISSUES: { sev: 'P1' | 'P2'; where: string; what: string }[] = [
  { sev: 'P1', where: 'auth/callback/route.ts:24',  what: 'missing 401 handler' },
  { sev: 'P1', where: 'me/profile/route.ts:51',     what: 'auth context required' },
  { sev: 'P2', where: 'seed.ts:58-66',              what: '12 floating promises' },
  { sev: 'P2', where: 'share-poster.tsx:47',        what: 'memory leak' },
];

function PhaseProblem({ progress }: { progress: number }) {
  const visible = reveal(MW_TREE, progress, 0.05, 0.55);
  const issuesShown = reveal(PROBLEM_ISSUES, progress, 0.45, 0.92);
  return (
    <div className="h-full grid grid-cols-5 gap-3 sm:gap-4">
      {/* Left: file tree (IDE-like) */}
      <div className="col-span-2 rounded-md border border-warmline bg-paper/60 p-3 overflow-hidden flex flex-col">
        <div className="text-xs uppercase tracking-wider text-muted mb-2 font-mono">
          ./meme-weather
        </div>
        <ul className="font-mono text-sm text-ink space-y-1 flex-1">
          {MW_TREE.slice(0, visible).map((n, i) => (
            <li
              key={i}
              className="anim-stagger flex items-center gap-1 relative"
              style={{ ['--i' as string]: i } as React.CSSProperties}
            >
              <span style={{ paddingLeft: `${n.depth * 10}px` }} />
              <span className="text-muted">{n.tag === 'dir' ? '▸' : '·'}</span>
              <span className={n.tag === 'dir' ? 'text-muted' : n.bug ? 'text-rust' : 'text-ink'}>
                {n.name}
              </span>
              {n.bug && progress > 0.45 && (
                <span
                  className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-rust anim-breathe-dot"
                  aria-label="known bug area"
                />
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Right: "What's wrong" diagnostic callout box */}
      <div className="col-span-3 rounded-md border border-rust/40 bg-rust/5 p-3 overflow-hidden flex flex-col">
        <div className="text-xs uppercase tracking-widest text-rust mb-2 font-mono font-semibold flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-rust anim-breathe-dot" />
          What&apos;s wrong
        </div>
        <ul className="space-y-2 flex-1">
          {PROBLEM_ISSUES.slice(0, issuesShown).map((iss, i) => (
            <li
              key={i}
              className="anim-drift-in flex items-start gap-2 rounded border border-rust/30 bg-cream/80 px-2.5 py-2"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span
                className={[
                  'shrink-0 px-1.5 py-0.5 rounded text-xs font-mono font-semibold',
                  iss.sev === 'P1' ? 'bg-rust text-cream' : 'bg-amber-100 text-amber-600',
                ].join(' ')}
              >
                {iss.sev}
              </span>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-mono text-sm text-ink truncate">{iss.where}</span>
                <span className="text-sm text-muted">{iss.what}</span>
              </div>
            </li>
          ))}
        </ul>
        {progress > 0.85 && (
          <div className="mt-2 text-sm font-mono text-rust anim-drift-in text-center">
            …and 27 more. Vibe-grade.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 2 — Install: animated terminal types 6 lines with cursor
// ---------------------------------------------------------------------------

const INSTALL_LINES: { kind: 'cmd' | 'out' | 'info'; text: string; start: number }[] = [
  { kind: 'cmd',  text: '$ npm install -g zerou',                                       start: 0.02 },
  { kind: 'out',  text: 'added 1 package in 4s',                                        start: 0.20 },
  { kind: 'cmd',  text: '$ zerou --version',                                            start: 0.30 },
  { kind: 'out',  text: 'zerou 0.5.0',                                                  start: 0.40 },
  { kind: 'cmd',  text: '$ zerou audit ./meme-weather',                                 start: 0.50 },
  { kind: 'info', text: 'Loaded 27 preset families (359 rules)',                        start: 0.62 },
  { kind: 'info', text: 'Engine: your key, your model (MiniMax M2.7 · your token plan)', start: 0.74 },
  { kind: 'info', text: 'Critic: cross-engine policy enforced',                         start: 0.84 },
  { kind: 'info', text: 'Output: .zerou/audit-report.md',                               start: 0.92 },
];

function PhaseInstall({ progress }: { progress: number }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 rounded-md bg-ink text-cream font-mono text-base sm:text-lg px-5 py-4 overflow-hidden flex flex-col justify-center gap-1.5 leading-relaxed">
        {INSTALL_LINES.map((line, i) => {
          if (progress < line.start) return <div key={i} className="h-[1.4em]" aria-hidden="true" />;
          const next = INSTALL_LINES[i + 1];
          const localEnd = next ? Math.min(0.98, next.start - 0.01) : 0.98;
          const typed = typeUpTo(line.text, progress, line.start, Math.min(localEnd, line.start + 0.16));
          const done = typed.length >= line.text.length;
          const color =
            line.kind === 'cmd' ? 'text-coralsoft' :
            line.kind === 'out' ? 'text-sage-100' :
            'text-cream/70';
          return (
            <div key={i} className="flex items-center anim-drift-in">
              <span className={color}>{typed}</span>
              {!done && (
                <span className="inline-block w-[8px] h-[1em] bg-coralsoft/80 align-middle ml-0.5 anim-tick" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 3 — Scan: file tree pulses + findings stream + family tags
// ---------------------------------------------------------------------------

const SCAN_FILES: { path: string; family?: string; severity?: 'P1' | 'P2' | 'P3' }[] = [
  { path: 'app/page.tsx',                       family: 'observability-missing', severity: 'P3' },
  { path: 'app/api/auth/callback/route.ts',     family: 'auth-missing',          severity: 'P1' },
  { path: 'app/api/me/profile/route.ts',        family: 'auth-missing',          severity: 'P1' },
  { path: 'app/api/weather/route.ts',           family: 'perf-issues',           severity: 'P2' },
  { path: 'lib/supabase.ts',                    family: 'async-pitfalls',        severity: 'P2' },
  { path: 'lib/llm.ts',                         family: 'secrets-leak',          severity: 'P1' },
  { path: 'scripts/seed.ts',                    family: 'async-pitfalls',        severity: 'P2' },
  { path: 'components/share-poster.tsx',        family: 'perf-issues',           severity: 'P2' },
];

const SCAN_FINDINGS: { sev: 'P1' | 'P2' | 'P3'; rule: string; loc: string }[] = [
  { sev: 'P1', rule: 'auth-missing.no-session-check',         loc: 'auth/callback:24' },
  { sev: 'P1', rule: 'auth-missing.no-401-fallthrough',       loc: 'me/profile:51' },
  { sev: 'P2', rule: 'async-pitfalls.floating-promise',       loc: 'seed.ts:58' },
  { sev: 'P2', rule: 'async-pitfalls.floating-promise',       loc: 'seed.ts:59' },
  { sev: 'P2', rule: 'async-pitfalls.floating-promise',       loc: 'seed.ts:60' },
  { sev: 'P3', rule: 'observability-missing.console-only',    loc: 'app/page.tsx:114' },
  { sev: 'P2', rule: 'perf-issues.memory-leak-listener',      loc: 'share-poster:47' },
  { sev: 'P1', rule: 'secrets-leak.api-key-in-log',           loc: 'lib/llm.ts:88' },
];

function PhaseScan({ progress }: { progress: number }) {
  const scanned = reveal(SCAN_FILES, progress, 0.03, 0.50);
  const badgeProgress = Math.max(0, (progress - 0.40) / 0.30);
  const findingsShown = reveal(SCAN_FINDINGS, progress, 0.50, 0.96);
  const counter = Math.min(SCAN_FILES.length, scanned);
  const issues = progress > 0.7 ? 31 : Math.floor(progress * 31);

  return (
    <div className="h-full grid grid-rows-[auto_1fr] gap-2">
      {/* Top counter banner */}
      <div className="text-sm font-mono text-ink flex items-center justify-between px-1">
        <span className="text-muted">
          scanning · {counter} / {SCAN_FILES.length} files
        </span>
        <span className={progress > 0.5 ? 'text-rust font-semibold anim-drift-in' : 'text-muted'}>
          Found {issues} issues across 25 preset families
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 overflow-hidden min-h-0">
        {/* Left: file tree with preset family tags */}
        <div className="rounded-md border border-warmline bg-paper/60 p-3 overflow-hidden flex flex-col min-h-0">
          <div className="text-xs uppercase tracking-wider text-muted mb-2 font-mono">
            files · preset family
          </div>
          <ul className="font-mono text-sm space-y-1 flex-1 overflow-hidden">
            {SCAN_FILES.map((f, i) => {
              const done = i < scanned;
              const hasBug = !!f.severity && badgeProgress > i / SCAN_FILES.length;
              return (
                <li
                  key={f.path}
                  className={[
                    'flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors',
                    hasBug
                      ? 'bg-rust/10 text-rust'
                      : done
                      ? 'anim-pulse-green text-ink'
                      : 'text-muted',
                  ].join(' ')}
                  style={done && !hasBug ? { animationDelay: `${i * 70}ms` } : undefined}
                >
                  <span className={hasBug ? 'text-rust' : done ? 'text-forest' : 'text-muted/60'}>
                    {hasBug ? '!' : done ? '✓' : '·'}
                  </span>
                  <span className="truncate text-sm">{f.path}</span>
                  {done && f.family && (
                    <span className="ml-auto text-xs text-coral/80 font-mono anim-drift-in shrink-0">
                      → {f.family}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right: findings stream */}
        <div className="rounded-md border border-warmline bg-cream p-3 overflow-hidden flex flex-col min-h-0">
          <div className="text-xs uppercase tracking-wider text-muted mb-2 font-mono">
            findings stream
          </div>
          <ul className="space-y-1 flex-1 overflow-hidden">
            {SCAN_FINDINGS.slice(0, findingsShown).map((f, i) => (
              <li
                key={i}
                className="anim-drift-in flex items-center gap-2 rounded border border-warmline/70 bg-paper/40 px-2 py-1 font-mono"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <span
                  className={[
                    'shrink-0 px-1.5 py-px rounded text-xs font-semibold',
                    f.sev === 'P1' ? 'bg-rust text-cream' :
                    f.sev === 'P2' ? 'bg-amber-100 text-amber-600' :
                                     'bg-warmline/60 text-muted',
                  ].join(' ')}
                >
                  [{f.sev}]
                </span>
                <span className="text-sm text-ink truncate flex-1">{f.rule}</span>
                <span className="text-xs text-muted shrink-0 hidden sm:inline">· {f.loc}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 4 — Fix: bug banner + annotated before/after + verdict timeline
// Story-driven: viewer learns what the code does, what's wrong, what ZeroU did.
// ---------------------------------------------------------------------------

const FIX_BEFORE_CODE = `// GET /api/me/profile
export async function GET(
  req: Request
) {
  const uid = req.headers
    .get('x-user-id');
  const data = await db.users
    .find(uid);
  return Response.json(data);
}`;

const FIX_AFTER_CODE = `// GET /api/me/profile
export async function GET(
  req: Request
) {
  const session =
    await getSession(req);
  if (!session) {
    return new Response(
      'Unauthorized',
      { status: 401 });
  }
  const data = await db.users
    .find(session.userId);
  return Response.json(data);
}`;

function PhaseFix({ progress }: { progress: number }) {
  // 4 sub-stages within the 9s phase:
  // 0.00 - 0.18  → bug banner appears
  // 0.18 - 0.55  → BEFORE/AFTER code panels appear (staggered)
  // 0.55 - 0.78  → annotations under each code block appear
  // 0.78 - 0.95  → verdict timeline 3 rows stack in
  // 0.95 - 1.00  → bottom summary
  const banner = progress >= 0.0;
  const showBefore = progress >= 0.18;
  const showAfter = progress >= 0.3;
  const showAnnot = progress >= 0.55;
  const showVerdict1 = progress >= 0.78;
  const showVerdict2 = progress >= 0.84;
  const showVerdict3 = progress >= 0.9;
  const showSummary = progress >= 0.95;

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* BUG BANNER */}
      {banner && (
        <div className="rounded-md border-2 border-rust bg-rust/5 px-3 py-1.5 anim-drift-in shrink-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-rust text-sm font-bold">🐛 BUG DETECTED</span>
            <span className="text-rust/80 text-[10px] font-mono px-1.5 py-0.5 rounded bg-rust/10">
              P1 · auth-missing.no-session-check
            </span>
            <span className="text-xs font-mono text-ink">
              app/api/me/profile/route.ts:51
            </span>
          </div>
          <div className="text-xs text-ink/80 mt-0.5 leading-snug">
            GET handler trusts <code className="font-mono text-rust">x-user-id</code> header from the client. Anyone can read any user&apos;s profile.
          </div>
        </div>
      )}

      {/* CODE SPLIT */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-2 min-h-0">
        {/* BEFORE */}
        <div
          className={[
            'rounded-md border border-rust/30 bg-cream flex flex-col overflow-hidden min-h-0',
            showBefore ? 'anim-drift-in' : 'opacity-0',
          ].join(' ')}
        >
          <div className="px-2.5 py-1 border-b border-warmline bg-rust/5 flex items-baseline gap-2 shrink-0">
            <span className="text-[10px] font-mono text-rust font-semibold uppercase tracking-wider">
              BEFORE
            </span>
            <span className="text-[10px] text-muted font-mono">{'// broken'}</span>
          </div>
          <pre className="flex-1 px-2.5 py-1.5 text-[11px] sm:text-xs font-mono leading-snug overflow-hidden text-ink whitespace-pre">
{FIX_BEFORE_CODE}
          </pre>
          {showAnnot && (
            <div className="px-2.5 pb-1.5 anim-drift-in shrink-0">
              <div className="text-[11px] text-rust flex items-start gap-1">
                <span aria-hidden="true">🚨</span>
                <span>
                  anyone can pass any <code className="font-mono">uid</code>
                </span>
              </div>
              <div className="text-[11px] text-rust flex items-start gap-1 mt-0.5">
                <span aria-hidden="true">🚨</span>
                <span>no auth check at all</span>
              </div>
            </div>
          )}
        </div>

        {/* AFTER */}
        <div
          className={[
            'rounded-md border border-forest/30 bg-cream flex flex-col overflow-hidden min-h-0',
            showAfter ? 'anim-drift-in' : 'opacity-0',
          ].join(' ')}
        >
          <div className="px-2.5 py-1 border-b border-warmline bg-sage-600/10 flex items-baseline gap-2 shrink-0">
            <span className="text-[10px] font-mono text-forest font-semibold uppercase tracking-wider">
              AFTER
            </span>
            <span className="text-[10px] text-muted font-mono">{'// zerou patched'}</span>
          </div>
          <pre className="flex-1 px-2.5 py-1.5 text-[11px] sm:text-xs font-mono leading-snug overflow-hidden text-ink whitespace-pre">
{FIX_AFTER_CODE}
          </pre>
          {showAnnot && (
            <div className="px-2.5 pb-1.5 anim-drift-in shrink-0">
              <div className="text-[11px] text-forest flex items-start gap-1">
                <span aria-hidden="true">✓</span>
                <span>session required</span>
              </div>
              <div className="text-[11px] text-forest flex items-start gap-1 mt-0.5">
                <span aria-hidden="true">✓</span>
                <span>401 on missing session</span>
              </div>
              <div className="text-[11px] text-forest flex items-start gap-1 mt-0.5">
                <span aria-hidden="true">✓</span>
                <span>
                  <code className="font-mono">uid</code> from session, not client
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* VERDICT TIMELINE */}
      <div className="rounded-md border border-warmline bg-paper/60 px-2.5 py-1.5 shrink-0">
        <div className="text-[10px] font-mono text-muted mb-1 truncate">
          spec:{' '}
          <code className="text-ink">
            test(&apos;GET /api/me/profile without auth → 401&apos;)
          </code>
        </div>
        <div className="flex flex-col gap-0.5">
          {showVerdict1 && (
            <div className="flex items-center gap-2 anim-drift-in text-xs">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-rust text-cream font-bold text-[10px] shrink-0">
                ×
              </span>
              <span className="text-rust font-mono font-semibold">round 1</span>
              <span className="text-muted">judge FAIL</span>
              <span className="text-ink truncate">
                &quot;got 200, expected 401&quot;
              </span>
            </div>
          )}
          {showVerdict2 && (
            <div className="flex items-center gap-2 anim-drift-in text-xs">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-coral text-cream font-bold text-[10px] shrink-0">
                <span className="anim-spin-arrow inline-block">↻</span>
              </span>
              <span className="text-coral font-mono font-semibold">round 2</span>
              <span className="text-muted">patcher dispatched</span>
              <span className="text-ink truncate">MiniMax M2.7 (your token plan) · 15s</span>
            </div>
          )}
          {showVerdict3 && (
            <div className="flex items-center gap-2 anim-cross-morph text-xs">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-forest text-cream font-bold text-[10px] shrink-0">
                ✓
              </span>
              <span className="text-forest font-mono font-semibold">round 3</span>
              <span className="text-muted">judge PASS</span>
              <span className="text-ink truncate">
                &quot;auth guard added, 401 confirmed&quot;
              </span>
            </div>
          )}
        </div>
        {showSummary && (
          <div className="mt-1 text-[10px] font-mono text-coral anim-drift-in truncate">
            1 bug · 3 rounds · 18s total · branch fix/auth-missing-profile
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 5 — Enhance: 3 sub-stages.
//   Stage A (0.00–0.25): "ZeroU built your observability stack" — 7-row file list
//   Stage B (0.25–0.80): IDE ↔ log viewer split with trace arrow (compressed)
//   Stage C (0.80–1.00): closing punchline + 4 colored ✓ pills
// ---------------------------------------------------------------------------

// 7 production-grade observability files that ZeroU enhance generated.
// Counts mirror D:/lll/meme-weather-zerou-test/.zerou/enhance-report.md verbatim.
const ENHANCE_ARTIFACTS: { path: string; loc: string; note: string }[] = [
  { path: 'src/logger.ts',                          loc: '+61 LOC', note: 'pino bootstrap' },
  { path: 'middleware.ts',                          loc: '+30 LOC', note: 'trace_id propagation' },
  { path: 'instrumentation.ts',                     loc: '+8 LOC',  note: 'Sentry init hook' },
  { path: 'sentry.{client,server,edge}.config.ts',  loc: '+18 LOC', note: 'Sentry transports' },
  { path: 'app/health/route.ts',                    loc: '+14 LOC', note: '/health endpoint' },
  { path: '.env.example',                           loc: '+3 LOC',  note: 'LOG_LEVEL et al.' },
  { path: '119 console.log → logger.info',          loc: '5 files', note: 'migrated in place' },
];

// Source code lines 20–28 of auth/callback/route.ts (compressed: 5 lines shown).
// Line 24 is the punchline that the log payload's `line: 24` field points back to.
const ENHANCE_SRC: { lineNo: number; text: string; isLink?: boolean }[] = [
  { lineNo: 22, text: '  if (!session) {' },
  { lineNo: 23, text: "    logger.warn(" },
  { lineNo: 24, text: "      'auth.no-session',", isLink: true },
  { lineNo: 25, text: '    );' },
  { lineNo: 26, text: '    return new Response(null, { status: 401 });' },
];

// Log viewer rows (compressed: 3 preview rows + 1 expanded payload).
const ENHANCE_LOGS: { lineNo: number; preview: string; expanded?: boolean }[] = [
  { lineNo: 45, preview: "{ts: '14:02:11', event: 'session.miss', cookie: 'sb-…'}" },
  { lineNo: 46, preview: "{ts: '14:02:11', event: 'audit.write', branch_id: 'b_42'}" },
  { lineNo: 47, preview: '', expanded: true },
  { lineNo: 48, preview: "{ts: '14:02:12', event: 'http.resp', status: 401}" },
];

function PhaseEnhance({ progress }: { progress: number }) {
  // Stage A (0.00–0.25): 7 observability-stack artifacts reveal (Pino+Sentry+trace_id+/health)
  // Stage B (0.25–0.80): IDE ↔ log viewer with traceability arrow (compressed)
  // Stage C (0.80–1.00): closing punchline + 4 ✓ pills
  const artifactCount = reveal(ENHANCE_ARTIFACTS, progress, 0.01, 0.25);
  const showStackHeader = progress >= 0.0;
  const srcCount = reveal(ENHANCE_SRC, progress, 0.28, 0.50);
  const logCount = reveal(ENHANCE_LOGS, progress, 0.38, 0.66);
  const showExpanded = progress > 0.60;
  const showArrow = progress > 0.62;
  const showPunch = progress > 0.80;
  // Line 24 highlight: in compressed src list, index 2 = lineNo 24.
  const highlightLine24 = srcCount >= 3;

  return (
    <div
      className="h-full flex flex-col gap-2 relative min-h-0"
      data-testid="phase-enhance"
    >
      {/* STAGE A — observability stack banner (always visible, populates progressively) */}
      <div
        data-testid="enhance-stack-banner"
        className="rounded-md border-2 border-forest/40 bg-sage-50 px-3 py-2 shrink-0 anim-drift-in"
      >
        <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
          <span className="text-forest text-sm font-bold uppercase tracking-wider font-mono">
            ⚙ Production-grade observability — generated
          </span>
          <span className="text-xs text-muted font-mono">
            pino · Sentry · trace_id · /health
          </span>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
          {ENHANCE_ARTIFACTS.slice(0, artifactCount).map((art, i) => (
            <li
              key={art.path}
              className="anim-drift-in flex items-center gap-1.5 text-[11px] sm:text-xs leading-snug"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-forest text-cream font-bold text-[9px] shrink-0"
              >
                ✓
              </span>
              <code className="font-mono text-ink truncate">{art.path}</code>
              <span className="font-mono text-forest shrink-0">{art.loc}</span>
              <span className="italic text-muted truncate hidden sm:inline">
                {art.note}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0 relative">
        {/* STAGE B (compressed) */}
        {/* LEFT — IDE-style source view */}
        <div className="rounded-md border border-warmline bg-paper/40 overflow-hidden flex flex-col anim-drawer-left min-h-0">
          <div className="px-3 py-1.5 border-b border-warmline text-xs uppercase tracking-wider text-muted font-mono flex items-center justify-between">
            <span>📄 auth/callback/route.ts</span>
            <span className="text-muted/70 normal-case">lines 22–26</span>
          </div>
          <div className="font-mono text-base leading-relaxed flex-1 overflow-hidden py-1">
            {ENHANCE_SRC.slice(0, srcCount).map((row, i) => {
              const isLine24 = row.lineNo === 24;
              const cls = [
                'flex items-center px-2 py-0.5',
                isLine24 && highlightLine24
                  ? 'bg-coral/15 anim-breathe'
                  : '',
                isLine24 && showArrow ? 'ring-1 ring-coral/60 rounded' : '',
              ].join(' ');
              return (
                <div
                  key={row.lineNo}
                  id={isLine24 ? 'enhance-src-line-24' : undefined}
                  className={cls}
                >
                  <span className="w-7 shrink-0 text-right pr-2 text-muted/60 select-none text-xs">
                    {row.lineNo}
                  </span>
                  <span
                    className={[
                      'whitespace-pre',
                      isLine24 ? 'text-coral font-semibold' : 'text-ink',
                    ].join(' ')}
                  >
                    {row.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — log-viewer panel */}
        <div className="rounded-md border border-warmline bg-ink text-cream/90 overflow-hidden flex flex-col anim-drawer-right min-h-0">
          <div className="px-3 py-1.5 border-b border-cream/10 text-xs uppercase tracking-wider text-coralsoft font-mono flex items-center justify-between">
            <span>📋 .zerou/branch-trace.jsonl</span>
            <span className="text-cream/60 normal-case">{ENHANCE_LOGS.length} rows</span>
          </div>
          <div className="font-mono text-xs sm:text-sm leading-relaxed flex-1 overflow-hidden py-1">
            {ENHANCE_LOGS.slice(0, logCount).map((row) => {
              if (row.expanded) {
                if (!showExpanded) {
                  return (
                    <div key={row.lineNo} className="flex items-start px-2 py-0.5 text-cream/40">
                      <span className="w-12 shrink-0 text-right pr-2 select-none text-cream/30">
                        line {row.lineNo}
                      </span>
                      <span className="text-cream/40">{'{ … }'}</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={row.lineNo}
                    id="enhance-log-payload"
                    className="px-2 py-0.5 anim-drift-in bg-coral/10 border-l-2 border-coral/60 my-0.5"
                  >
                    <div className="flex items-start">
                      <span className="w-12 shrink-0 text-right pr-2 select-none text-coralsoft font-semibold">
                        ▶ {row.lineNo}
                      </span>
                      <span>{'{'}</span>
                    </div>
                    <div className="pl-14 text-cream/80">
                      <div>event: <span className="text-sage-100">{"'auth.no-session'"}</span>,</div>
                      <div>
                        file: <span
                          id="enhance-log-file"
                          className={[
                            'text-sage-100',
                            showArrow ? 'bg-coral/30 text-coralsoft px-1 rounded transition-colors' : '',
                          ].join(' ')}
                        >{"'auth/callback/route.ts'"}</span>,
                      </div>
                      <div>
                        line: <span
                          id="enhance-log-line"
                          className={[
                            'font-bold',
                            showArrow ? 'bg-coral/50 text-cream px-1.5 rounded transition-colors' : 'text-sage-100',
                          ].join(' ')}
                        >24</span>,
                      </div>
                      <div>trace_id: <span className="text-cream/60">{"'b7c4…e9'"}</span></div>
                    </div>
                    <div className="pl-2">{'}'}</div>
                  </div>
                );
              }
              return (
                <div key={row.lineNo} className="flex items-start px-2 py-0.5 anim-drift-in">
                  <span className="w-12 shrink-0 text-right pr-2 select-none text-cream/40">
                    line {row.lineNo}
                  </span>
                  <span className="text-cream/70 truncate">{row.preview}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center arrow overlay — drawn from log `line: 24` field on the right
            to source line 24 on the left. Sits absolutely between the panels. */}
        {showArrow && (
          <svg
            className="pointer-events-none absolute inset-0 z-10"
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="arrow-head-enhance"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#C96442" />
              </marker>
            </defs>
            {/* Curved arrow from right panel's "line: 24" payload field (~82, 62)
                to left panel's source line 24 (~20, 50). preserveAspectRatio="none"
                lets us treat the 0–100 viewBox as percent of container. */}
            <path
              d="M 82 62 C 60 62, 40 50, 20 50"
              fill="none"
              stroke="#C96442"
              strokeWidth="2.5"
              strokeDasharray="3 2"
              strokeLinecap="round"
              markerEnd="url(#arrow-head-enhance)"
              vectorEffect="non-scaling-stroke"
              style={{ animation: 'drift-in 600ms ease-out both' }}
            />
            <text
              x="50"
              y="52"
              fontSize="3.2"
              fill="#C96442"
              fontFamily="JetBrains Mono"
              textAnchor="middle"
              vectorEffect="non-scaling-stroke"
            >
              log → src
            </text>
          </svg>
        )}
      </div>

      {/* STAGE C — punchline + 4 colored pills + verify line */}
      <div className="rounded-md border border-warmline/70 bg-cream/80 px-3 py-1.5 text-center min-h-[68px] flex flex-col justify-center gap-1 shrink-0">
        {showPunch ? (
          <>
            <p
              data-testid="enhance-punchline"
              className="text-base sm:text-lg lg:text-xl font-serif text-ink leading-tight anim-drift-in"
            >
              Any log line points back to the exact source line.
            </p>
            <p
              className="text-[11px] sm:text-xs font-mono text-muted anim-drift-in"
              style={{ animationDelay: '120ms' }}
            >
              grep, jq, awk — coverage is greppable.
            </p>
            <div
              className="flex items-center justify-center gap-1.5 flex-wrap anim-drift-in"
              style={{ animationDelay: '220ms' }}
            >
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-forest/15 text-forest text-[10px] font-mono font-semibold">
                <span aria-hidden="true">✓</span> pino logger
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-coral/15 text-coral text-[10px] font-mono font-semibold">
                <span aria-hidden="true">✓</span> trace_id
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-plum-100 text-plum-600 text-[10px] font-mono font-semibold">
                <span aria-hidden="true">✓</span> Sentry
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-mono font-semibold">
                <span aria-hidden="true">✓</span> /health
              </span>
            </div>
            <p
              className="text-[10px] font-mono text-muted/80 anim-drift-in"
              style={{ animationDelay: '320ms' }}
            >
              Verify: install · tsc · test · build — all green.
            </p>
          </>
        ) : (
          <p className="text-sm font-mono text-muted/60">
            linking log lines to source…
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 6 — Verify: 4 big pill rows + victory banner
// ---------------------------------------------------------------------------

const VERIFY_GATES: { id: string; label: string; cmd: string; result: string }[] = [
  { id: 'install', label: 'install', cmd: 'npm ci',         result: 'deps installed · 547 packages' },
  { id: 'tsc',     label: 'tsc',     cmd: 'tsc --noEmit',   result: '0 errors · 359 files' },
  { id: 'test',    label: 'test',    cmd: 'npm test',       result: '24 passed, 0 failed · 1.8s' },
  { id: 'build',   label: 'build',   cmd: 'next build',     result: 'Next.js 15 compiled in 4.2s' },
];

function PhaseVerify({ progress }: { progress: number }) {
  // 4 gates flip at 1.5s intervals across an 8s phase → progress slots
  // start: 0.04, 0.21, 0.39, 0.56 ; flip duration ~0.10
  const gateState = (i: number): 'pending' | 'running' | 'done' => {
    const start = 0.04 + i * 0.17;
    const flip = start + 0.10;
    if (progress < start) return 'pending';
    if (progress < flip) return 'running';
    return 'done';
  };
  const showBanner = progress > 0.78;

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="rounded-md bg-ink text-cream font-mono text-base px-3 py-1.5">
        <span className="text-coralsoft">$ zerou verify ./meme-weather</span>
      </div>

      <div className="flex-1 flex flex-col gap-2 min-h-0">
        {VERIFY_GATES.map((gate, i) => {
          const state = gateState(i);
          return (
            <div
              key={gate.id}
              className={[
                'rounded-lg border flex items-center gap-3 px-3 py-2 transition-all duration-300 min-h-[56px]',
                state === 'done'
                  ? 'border-sage-600/50 bg-sage-50'
                  : state === 'running'
                  ? 'border-coral/60 bg-cream anim-breathe'
                  : 'border-warmline bg-paper/40',
              ].join(' ')}
            >
              <div
                className={[
                  'w-10 h-10 rounded-full flex items-center justify-center text-lg font-semibold shrink-0',
                  state === 'done'
                    ? 'bg-forest text-cream anim-tick-pop'
                    : state === 'running'
                    ? 'bg-coral text-cream'
                    : 'bg-warmline text-muted',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : state === 'running' ? (
                  <span className="anim-spin-arrow inline-block">↻</span>
                ) : '□'}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg sm:text-xl font-semibold text-ink">
                    {gate.label}
                  </span>
                  <span className="text-sm font-mono text-muted truncate">
                    {gate.cmd}
                  </span>
                </div>
                <div className="text-sm font-mono text-sage-600 min-h-[1.2em]">
                  {state === 'done' && (
                    <span className="anim-drift-in inline-block">{gate.result}</span>
                  )}
                  {state === 'running' && (
                    <span className="text-coral/80">running…</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showBanner && (
        <div className="rounded-md bg-forest text-cream px-3 py-2 anim-scale-in flex flex-col gap-0.5">
          <div className="text-base font-mono font-semibold text-center">
            ✓ Verify: PASS · 4/4 gates · ready to ship
          </div>
          <div className="text-xs font-mono text-cream/80 text-center">
            Branch zerou-enhance-20260529-131520 · merged to main
          </div>
        </div>
      )}
      {!showBanner && (
        <div className="rounded-md bg-paper/40 text-muted px-3 py-2 text-sm font-mono text-center opacity-60">
          verifying…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 7 — Bench: head-to-head table (Opus / Sonnet / ZeroU), highlight pill.
// Numbers verbatim from D:/lll/hardener-bench/COMPARISON.md (Phase 22, alpha, n=1).
// Cost ranges quoted as upper bound of the published range for cleaner display.
// ---------------------------------------------------------------------------

interface BenchRow {
  model: string;
  precision: string;
  recall: string;
  cost: string;
  speed: string;
  isZerou?: boolean;
}

const BENCH_ROWS: BenchRow[] = [
  { model: 'Claude Opus',   precision: 'P=0.41', recall: 'R=0.95', cost: '$2.00–$8.00', speed: '2m 18s' },
  { model: 'Claude Sonnet', precision: 'P=0.46', recall: 'R=0.90', cost: '$0.50–$1.50', speed: '1m 44s' },
  { model: 'ZeroU (BYO-key)', precision: 'P=0.91', recall: 'R=1.00', cost: '$0.05–$0.20', speed: '1m 12s', isZerou: true },
];

function PhaseBench({ progress }: { progress: number }) {
  // 0.00–0.10: title + table header slide in
  // 0.10–0.50: 3 rows stagger in (one every ~0.13)
  // 0.50–0.80: highlight pill slides in
  // 0.80–1.00: bottom note + honesty footer
  const rowsShown = reveal(BENCH_ROWS, progress, 0.10, 0.50);
  const showPill = progress > 0.50;
  const showNote = progress > 0.78;

  return (
    <div
      className="h-full flex flex-col gap-2 min-h-0"
      data-testid="phase-bench"
    >
      {/* Header row */}
      <div className="rounded-md border border-warmline bg-paper/60 px-3 py-2 flex items-center justify-between">
        <div className="font-mono text-xs sm:text-sm text-ink">
          <span className="text-coral font-semibold">zerou-target</span>
          <span className="text-muted"> · real audit task · 19 truths · proximity ± 3</span>
        </div>
        <div className="font-mono text-[10px] text-muted hidden sm:block">
          Source: hardener-bench/COMPARISON.md
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border border-warmline bg-cream overflow-hidden flex-1 min-h-0 flex flex-col">
        {/* Column header */}
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1.2fr_1fr] gap-2 px-3 py-1.5 border-b border-warmline bg-paper/60 text-[10px] sm:text-xs uppercase tracking-widest text-muted font-mono">
          <div>model</div>
          <div className="text-right">precision</div>
          <div className="text-right">recall</div>
          <div className="text-right">cost / audit</div>
          <div className="text-right">speed</div>
        </div>
        {/* Rows */}
        <div className="flex-1 flex flex-col">
          {BENCH_ROWS.slice(0, rowsShown).map((row, i) => (
            <div
              key={row.model}
              data-testid={row.isZerou ? 'bench-row-zerou' : undefined}
              className={[
                'grid grid-cols-[1.4fr_1fr_1fr_1.2fr_1fr] gap-2 px-3 py-2.5 sm:py-3 items-center anim-drift-in',
                row.isZerou
                  ? 'bg-coral/10 border-y border-coral/40 relative'
                  : 'border-b border-warmline/40',
              ].join(' ')}
              style={{ animationDelay: `${i * 280}ms` }}
            >
              <div className={['font-mono text-sm sm:text-base flex items-center gap-2', row.isZerou ? 'text-coral font-bold' : 'text-ink'].join(' ')}>
                <span className="truncate">{row.model}</span>
                {row.isZerou && (
                  <span className="text-coral anim-scale-in inline-block" aria-label="winner">★</span>
                )}
              </div>
              <div className={['text-right font-mono text-sm', row.isZerou ? 'text-coral font-bold' : 'text-ink/70'].join(' ')}>
                {row.precision}
              </div>
              <div className={['text-right font-mono text-sm', row.isZerou ? 'text-coral font-bold' : 'text-ink/70'].join(' ')}>
                {row.recall}
              </div>
              <div className={['text-right font-mono text-sm', row.isZerou ? 'text-coral font-bold' : 'text-ink/70'].join(' ')}>
                {row.cost}
              </div>
              <div className={['text-right font-mono text-sm', row.isZerou ? 'text-coral font-bold' : 'text-ink/70'].join(' ')}>
                {row.speed}
              </div>
            </div>
          ))}
        </div>

        {/* Highlight pill — animates in after rows visible */}
        {showPill && (
          <div className="px-3 pb-2 pt-1">
            <div
              data-testid="bench-pill"
              className="rounded-lg bg-coral/15 border-2 border-coral/50 px-4 py-2 text-center anim-scale-in"
            >
              <p className="text-xl sm:text-2xl lg:text-3xl font-serif text-coral leading-tight font-semibold">
                ZeroU 2.2× more precise than Opus.{' '}
                <span className="whitespace-nowrap">40× cheaper.</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom note + honesty footer */}
      <div className="rounded-md border border-warmline/60 bg-paper/40 px-3 py-1.5 flex flex-col gap-0.5 min-h-[36px]">
        <div className="flex items-center justify-between gap-2">
          {showNote ? (
            <p className="text-sm sm:text-base font-serif italic text-ink anim-drift-in">
              Architecture &gt; raw frontier model.
            </p>
          ) : (
            <span className="text-xs text-muted/60 font-mono">measuring…</span>
          )}
          <span className="text-[10px] font-mono text-muted shrink-0 ml-2">
            n=1 · alpha · 2026-05-29
          </span>
        </div>
        {showNote && (
          <p className="text-[10px] sm:text-xs font-mono text-muted leading-snug anim-drift-in" style={{ animationDelay: '180ms' }}>
            Bench used claude-haiku worker for Claude-vs-Claude fairness.{' '}
            <span className="text-ink font-semibold">Production uses your key — any provider (MiniMax · OpenAI · Anthropic · Gemini · Codex).</span>
          </p>
        )}
      </div>
    </div>
  );
}
