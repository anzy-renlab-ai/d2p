'use client';

/**
 * HeroDemo — 30-second auto-playing hero animation for the ZeroU site.
 *
 * Tells the ZeroU story in 6 phases (total 30s, loops forever):
 *   problem  0.0s –  3.0s  (3.0s)  — "Your vibe-coded demo"
 *   scan     3.0s –  8.0s  (5.0s)  — Stage 1 Scan, file tree pulses green
 *   test     8.0s – 14.0s  (6.0s)  — Stage 2 LLM-judge verdicts arrive
 *   enhance 14.0s – 19.0s  (5.0s)  — Stage 3 Auto-fix + harden, diff appears
 *   verify  19.0s – 24.0s  (5.0s)  — Stage 4 Verify, 4 chips light up
 *   proof   24.0s – 30.0s  (6.0s)  — Money shot: log-as-proof terminal
 *
 * Pure CSS animations + React state. No external animation libs.
 * Respects prefers-reduced-motion: shows static final frame + play button.
 *
 * Default-exports HeroDemo. Sub-components live in this same file by design
 * (self-contained, no separate files for sub-pieces).
 */

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Phase = 'problem' | 'scan' | 'test' | 'enhance' | 'verify' | 'proof';

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
  { id: 'problem', duration: 3000, label: 'Demo', caption: 'Your vibe-coded demo', subcaption: 'Working but not production' },
  { id: 'scan', duration: 5000, label: 'Scan', caption: 'Stage 1 of 5 — Scan', subcaption: '359 functions across 12 files' },
  { id: 'test', duration: 6000, label: 'Test', caption: 'Stage 2 — LLM-judge finds 11 bugs', subcaption: '19 specs generated' },
  { id: 'enhance', duration: 5000, label: 'Enhance', caption: 'Stage 3 — Auto-fix + harden', subcaption: 'Branches written, tests unchanged' },
  { id: 'verify', duration: 5000, label: 'Verify', caption: 'Stage 4 — Verify all pass', subcaption: 'install · tsc · test · build' },
  { id: 'proof', duration: 6000, label: 'Trace', caption: 'Coverage is a log file.', subcaption: 'Not a screenshot.' },
];

export const TOTAL_DURATION = PHASES.reduce((acc, p) => acc + p.duration, 0); // 30000ms

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
      const elapsed = (now - startRef.current - pauseAccumRef.current) % TOTAL_DURATION;
      let acc = 0;
      let idx = 0;
      for (let i = 0; i < PHASES.length; i++) {
        if (elapsed < acc + PHASES[i].duration) {
          idx = i;
          break;
        }
        acc += PHASES[i].duration;
      }
      const within = (elapsed - acc) / PHASES[idx].duration;
      setPhaseIdx(idx);
      setPhaseProgress(within);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [animationDisabled, paused]);

  const phase = PHASES[phaseIdx].id;
  const spec = PHASES[phaseIdx];

  // Static fallback: pin to final phase + 100% progress.
  const effectivePhase: Phase = animationDisabled ? 'proof' : phase;
  const effectiveProgress = animationDisabled ? 1 : phaseProgress;
  const effectiveSpec = animationDisabled ? PHASES[PHASES.length - 1] : spec;

  return (
    <div
      data-testid="hero-demo"
      data-phase={effectivePhase}
      className="relative w-full h-full min-h-[260px] rounded-lg overflow-hidden border border-warmline bg-cream shadow-card font-sans"
      onMouseEnter={() => !animationDisabled && setPaused(true)}
      onMouseLeave={() => !animationDisabled && setPaused(false)}
    >
      {/* Caption */}
      <Caption
        caption={effectiveSpec.caption}
        subcaption={effectiveSpec.subcaption}
      />

      {/* Phase canvas */}
      <div className="absolute inset-x-0 top-[58px] bottom-[44px] px-3 sm:px-5 overflow-hidden">
        {effectivePhase === 'problem' && <PhaseProblem progress={effectiveProgress} />}
        {effectivePhase === 'scan' && <PhaseScan progress={effectiveProgress} />}
        {effectivePhase === 'test' && <PhaseTest progress={effectiveProgress} />}
        {effectivePhase === 'enhance' && <PhaseEnhance progress={effectiveProgress} />}
        {effectivePhase === 'verify' && <PhaseVerify progress={effectiveProgress} />}
        {effectivePhase === 'proof' && <PhaseProof progress={effectiveProgress} />}
      </div>

      {/* Stage indicator chips */}
      <PhaseIndicator current={effectivePhase} />

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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caption (aria-live)
// ---------------------------------------------------------------------------

function Caption({ caption, subcaption }: { caption: string; subcaption?: string }) {
  return (
    <div
      className="absolute inset-x-0 top-0 px-4 pt-3 pb-2 flex flex-col gap-0.5 z-[5]"
      aria-live="polite"
      aria-atomic="true"
    >
      <p
        key={caption}
        className="text-[13px] sm:text-sm font-semibold text-ink leading-tight anim-drift-in"
      >
        {caption}
      </p>
      {subcaption && (
        <p
          key={subcaption}
          className="text-[11px] sm:text-xs text-muted leading-tight anim-drift-in"
          style={{ animationDelay: '60ms' }}
        >
          {subcaption}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase indicator (5 stage chips + "demo" preamble dot)
// ---------------------------------------------------------------------------

const STAGE_ORDER: Phase[] = ['scan', 'test', 'enhance', 'verify', 'proof'];

function PhaseIndicator({ current }: { current: Phase }) {
  const currentStageIdx = STAGE_ORDER.indexOf(current);
  return (
    <div className="absolute inset-x-0 bottom-0 px-4 pb-2.5 pt-2 flex items-center justify-center gap-1.5 sm:gap-2 z-[5] bg-gradient-to-t from-cream via-cream/95 to-transparent">
      {STAGE_ORDER.map((stage, i) => {
        const active = stage === current;
        const past = currentStageIdx > i;
        return (
          <div key={stage} className="flex items-center gap-1.5 sm:gap-2">
            <span
              className={[
                'inline-flex items-center justify-center rounded-full text-[9px] sm:text-[10px] font-mono font-semibold transition-all duration-200',
                active
                  ? 'h-5 sm:h-5 px-2 sm:px-2.5 bg-coral text-cream shadow-glow'
                  : past
                  ? 'h-4 sm:h-5 px-1.5 sm:px-2 bg-sage-100 text-sage-600'
                  : 'h-4 sm:h-5 px-1.5 sm:px-2 bg-warmline/60 text-muted',
              ].join(' ')}
              aria-current={active ? 'step' : undefined}
            >
              {i + 1}
              <span className="hidden sm:inline">&nbsp;{labelFor(stage)}</span>
            </span>
            {i < STAGE_ORDER.length - 1 && (
              <span className={`h-px w-2 sm:w-4 ${past ? 'bg-sage-600/60' : 'bg-warmline'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function labelFor(stage: Phase): string {
  return PHASES.find((p) => p.id === stage)?.label ?? stage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeUpTo(full: string, progress: number): string {
  // Type the string out over the [0, 0.65] segment of phase progress.
  const cap = Math.min(1, progress / 0.65);
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
// PHASE 1 — Problem
// ---------------------------------------------------------------------------

const DEMO_TREE: { depth: number; name: string; tag?: 'file' | 'dir' }[] = [
  { depth: 0, name: 'my-next-app/', tag: 'dir' },
  { depth: 1, name: 'app/', tag: 'dir' },
  { depth: 2, name: 'page.tsx', tag: 'file' },
  { depth: 2, name: 'api/', tag: 'dir' },
  { depth: 3, name: 'login/route.ts', tag: 'file' },
  { depth: 3, name: 'users/route.ts', tag: 'file' },
  { depth: 1, name: 'lib/db.ts', tag: 'file' },
  { depth: 1, name: 'package.json', tag: 'file' },
];

function PhaseProblem({ progress }: { progress: number }) {
  const visible = reveal(DEMO_TREE, progress, 0.05, 0.85);
  return (
    <div className="h-full grid grid-cols-2 gap-3 sm:gap-4">
      {/* Left: file tree */}
      <div className="rounded-md border border-warmline bg-paper/60 p-3 overflow-hidden">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-2 font-mono">
          ./my-next-app
        </div>
        <ul className="font-mono text-[11px] sm:text-xs text-ink space-y-0.5">
          {DEMO_TREE.slice(0, visible).map((n, i) => (
            <li
              key={i}
              className="anim-stagger flex items-center gap-1"
              style={{ ['--i' as string]: i } as React.CSSProperties}
            >
              <span style={{ paddingLeft: `${n.depth * 10}px` }} />
              <span className="text-muted">{n.tag === 'dir' ? '▸' : '·'}</span>
              <span className={n.tag === 'dir' ? 'text-muted' : 'text-ink'}>{n.name}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Right: snippet of vibe-code */}
      <div className="rounded-md border border-warmline bg-ink text-cream p-3 overflow-hidden font-mono text-[10px] sm:text-[11px] leading-snug">
        <div className="text-coralsoft mb-1.5">app/api/login/route.ts</div>
        <pre className="whitespace-pre-wrap">
{`export async function POST(req) {
  const { email, pw } = await req.json();
  const u = await db.user.findFirst({
    where: { email, pw } // ← plaintext
  });
  console.log("login", email);
  return Response.json(u);
}`}
        </pre>
        {progress > 0.55 && (
          <div className="mt-2 inline-block px-1.5 py-0.5 rounded bg-rust/20 text-rust text-[9px] font-semibold anim-drift-in">
            no tests · no logger · plaintext pw
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 2 — Scan
// ---------------------------------------------------------------------------

const SCAN_FILES = [
  'app/page.tsx',
  'app/api/login/route.ts',
  'app/api/users/route.ts',
  'app/api/orders/route.ts',
  'lib/db.ts',
  'lib/auth.ts',
  'lib/logger.ts',
  'components/Nav.tsx',
];

function PhaseScan({ progress }: { progress: number }) {
  const cmd = '$ zerou audit ./my-app';
  const typed = typeUpTo(cmd, progress);
  const scanned = reveal(SCAN_FILES, progress, 0.25, 0.95);
  const fnCount = Math.floor(359 * Math.min(1, progress / 0.9));
  const fileCount = Math.floor(12 * Math.min(1, progress / 0.9));

  return (
    <div className="h-full grid grid-rows-[auto_1fr] gap-2">
      {/* Terminal line */}
      <div className="rounded-md bg-ink text-cream font-mono text-[11px] sm:text-xs px-3 py-2">
        <span className="text-coralsoft">{typed}</span>
        <span className="inline-block w-1.5 h-3 bg-coralsoft/80 align-middle ml-0.5 anim-tick" />
      </div>

      {/* Scan body */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="rounded-md border border-warmline bg-paper/60 p-3 overflow-hidden">
          <ul className="font-mono text-[11px] space-y-0.5">
            {SCAN_FILES.map((f, i) => {
              const done = i < scanned;
              return (
                <li
                  key={f}
                  className={[
                    'flex items-center gap-1.5 rounded px-1',
                    done ? 'anim-pulse-green text-ink' : 'text-muted',
                  ].join(' ')}
                  style={done ? { animationDelay: `${i * 60}ms` } : undefined}
                >
                  <span className={done ? 'text-forest' : 'text-muted/60'}>
                    {done ? '✓' : '·'}
                  </span>
                  <span>{f}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* HUD */}
        <div className="flex flex-col gap-2 min-w-[110px]">
          <Stat label="functions" value={fnCount} of={359} />
          <Stat label="files" value={fileCount} of={12} />
          <Stat label="risks" value={Math.floor(progress * 14)} of={14} accent="coral" />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  of,
  accent = 'ink',
}: {
  label: string;
  value: number;
  of: number;
  accent?: 'ink' | 'coral';
}) {
  return (
    <div className="rounded-md border border-warmline bg-cream px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted font-mono">{label}</div>
      <div className="font-mono text-[13px] leading-tight">
        <span className={accent === 'coral' ? 'text-coral font-semibold' : 'text-ink font-semibold'}>
          {value}
        </span>
        <span className="text-muted"> / {of}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 3 — Test (specs + judge verdicts)
// ---------------------------------------------------------------------------

const VERDICTS: ('pass' | 'fail')[] = [
  'pass','pass','fail','pass','fail','fail','pass','pass','fail','pass',
  'fail','pass','fail','pass','fail','fail','pass','fail','pass',
];

const TEST_SPECS = [
  'login rejects empty email',
  'login hashes password',
  'login returns 401 on bad creds',
  'users requires auth',
  'orders pagination caps at 100',
  'orders rejects negative offset',
  'db connection retries 3x',
  'logger redacts pw field',
];

function PhaseTest({ progress }: { progress: number }) {
  const specsShown = reveal(TEST_SPECS, progress, 0.05, 0.45);
  const verdictsShown = reveal(VERDICTS, progress, 0.45, 0.95);
  const bugCount = VERDICTS.slice(0, verdictsShown).filter((v) => v === 'fail').length;

  return (
    <div className="h-full grid grid-cols-2 gap-3">
      {/* Left: spec list */}
      <div className="rounded-md border border-warmline bg-paper/60 p-3 overflow-hidden">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 font-mono">
          specs generated · {Math.min(19, specsShown * 2 + 3)}
        </div>
        <ul className="space-y-1 text-[11px]">
          {TEST_SPECS.slice(0, specsShown).map((s, i) => (
            <li
              key={i}
              className="anim-drift-in flex items-start gap-1.5 text-ink"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="text-plum-600 font-mono">spec</span>
              <span className="truncate">{s}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Right: branch tree with judge verdicts */}
      <div className="rounded-md border border-warmline bg-cream p-3 overflow-hidden flex flex-col">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 font-mono flex items-center justify-between">
          <span>llm-judge</span>
          {bugCount > 0 && (
            <span className="text-rust font-semibold normal-case">
              {bugCount} bug{bugCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="grid grid-cols-6 gap-1 flex-1 content-start">
          {VERDICTS.map((v, i) => {
            const shown = i < verdictsShown;
            return (
              <span
                key={i}
                className={[
                  'aspect-square rounded-sm text-[10px] font-mono flex items-center justify-center transition-all',
                  shown
                    ? v === 'pass'
                      ? 'bg-sage-100 text-sage-600 anim-scale-in'
                      : 'bg-coralsoft text-rust anim-scale-in'
                    : 'bg-warmline/40 text-muted/40',
                ].join(' ')}
                style={shown ? { animationDelay: `${i * 35}ms` } : undefined}
                aria-label={v}
              >
                {shown ? (v === 'pass' ? '✓' : '✗') : '·'}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 4 — Enhance (terminal + diff)
// ---------------------------------------------------------------------------

const DIFF_LINES: { kind: 'ctx' | 'add' | 'del'; text: string }[] = [
  { kind: 'ctx', text: "import { db } from './db';" },
  { kind: 'add', text: "import { logger } from './logger';" },
  { kind: 'add', text: "import { hash, verify } from './auth';" },
  { kind: 'ctx', text: '' },
  { kind: 'ctx', text: 'export async function POST(req) {' },
  { kind: 'ctx', text: '  const { email, pw } = await req.json();' },
  { kind: 'del', text: '  const u = await db.user.findFirst({' },
  { kind: 'del', text: '    where: { email, pw }' },
  { kind: 'del', text: '  });' },
  { kind: 'add', text: '  const u = await db.user.findFirst({ where: { email } });' },
  { kind: 'add', text: '  if (!u || !verify(pw, u.pwHash)) return new Response("", { status: 401 });' },
  { kind: 'del', text: '  console.log("login", email);' },
  { kind: 'add', text: '  logger.info({ userId: u.id }, "login");' },
  { kind: 'ctx', text: '  return Response.json(u);' },
  { kind: 'ctx', text: '}' },
];

function PhaseEnhance({ progress }: { progress: number }) {
  const cmd = '$ zerou enhance ./my-app';
  const typed = typeUpTo(cmd, progress);
  const linesShown = reveal(DIFF_LINES, progress, 0.25, 0.95);

  return (
    <div className="h-full grid grid-rows-[auto_1fr] gap-2">
      <div className="rounded-md bg-ink text-cream font-mono text-[11px] sm:text-xs px-3 py-2">
        <span className="text-coralsoft">{typed}</span>
        <span className="inline-block w-1.5 h-3 bg-coralsoft/80 align-middle ml-0.5 anim-tick" />
      </div>

      <div className="rounded-md border border-warmline bg-paper/40 overflow-hidden flex flex-col">
        <div className="px-3 py-1 border-b border-warmline text-[10px] uppercase tracking-wider text-muted font-mono flex items-center justify-between">
          <span>diff · app/api/login/route.ts</span>
          <span className="text-forest normal-case">+6 −4</span>
        </div>
        <div className="flex-1 overflow-hidden font-mono text-[10px] sm:text-[11px] leading-tight">
          {DIFF_LINES.slice(0, linesShown).map((l, i) => (
            <div
              key={i}
              className={[
                'px-3 py-[1px] flex anim-drift-in',
                l.kind === 'add'
                  ? 'bg-sage-50 text-sage-600'
                  : l.kind === 'del'
                  ? 'bg-coralsoft/40 text-rust'
                  : 'text-ink',
              ].join(' ')}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="w-3 select-none opacity-70">
                {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
              </span>
              <span className="whitespace-pre">{l.text || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 5 — Verify (4 chips light up)
// ---------------------------------------------------------------------------

const VERIFY_STEPS: { id: string; label: string; cmd: string }[] = [
  { id: 'install', label: 'install', cmd: 'npm ci' },
  { id: 'tsc', label: 'tsc', cmd: 'tsc --noEmit' },
  { id: 'test', label: 'test', cmd: 'npm test' },
  { id: 'build', label: 'build', cmd: 'next build' },
];

function PhaseVerify({ progress }: { progress: number }) {
  // Stagger: each chip turns green over 1.0s windows
  const stepProgress = (i: number) => {
    const start = 0.1 + i * 0.18;
    const end = start + 0.15;
    if (progress < start) return 'pending';
    if (progress < end) return 'running';
    return 'done';
  };

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="rounded-md bg-ink text-cream font-mono text-[11px] px-3 py-1.5">
        <span className="text-coralsoft">$ zerou verify ./my-app</span>
      </div>

      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {VERIFY_STEPS.map((step, i) => {
          const state = stepProgress(i);
          return (
            <div
              key={step.id}
              className={[
                'rounded-md border p-2.5 sm:p-3 flex flex-col items-center justify-center text-center transition-all duration-300',
                state === 'done'
                  ? 'border-sage-600/40 bg-sage-50'
                  : state === 'running'
                  ? 'border-coral/60 bg-cream anim-breathe'
                  : 'border-warmline bg-paper/40',
              ].join(' ')}
            >
              <div
                className={[
                  'w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-base font-semibold mb-1',
                  state === 'done'
                    ? 'bg-sage-600 text-cream'
                    : state === 'running'
                    ? 'bg-coral text-cream anim-breathe-dot'
                    : 'bg-warmline text-muted',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : state === 'running' ? '↻' : '·'}
              </div>
              <div className="text-[11px] sm:text-xs font-semibold text-ink">{step.label}</div>
              <div className="text-[9px] sm:text-[10px] font-mono text-muted truncate w-full">
                {step.cmd}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[10px] sm:text-[11px] text-muted font-mono text-center">
        your tests still pass · no behavior drift
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PHASE 6 — Proof (log-as-proof terminal)
// ---------------------------------------------------------------------------

const PROOF_LINES: { kind: 'cmd' | 'out' | 'hi'; text: string }[] = [
  { kind: 'cmd', text: "$ cat .zerou/branch-trace.jsonl | jq '.branch_id' | sort -u | wc -l" },
  { kind: 'out', text: '359' },
  { kind: 'cmd', text: '$ zerou coverage .' },
  { kind: 'out', text: 'tested  : 75 branches' },
  { kind: 'out', text: 'untested: 284 branches' },
  { kind: 'hi', text: 'coverage: 75 / 359  (20.9%)' },
];

function PhaseProof({ progress }: { progress: number }) {
  const linesShown = reveal(PROOF_LINES, progress, 0.05, 0.75);
  return (
    <div className="h-full grid grid-rows-[1fr_auto] gap-2">
      <div className="rounded-md bg-ink text-cream font-mono text-[11px] sm:text-xs px-3 py-2 overflow-hidden">
        {PROOF_LINES.slice(0, linesShown).map((l, i) => (
          <div
            key={i}
            className="anim-drift-in py-[1px]"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            {l.kind === 'cmd' && <span className="text-coralsoft">{l.text}</span>}
            {l.kind === 'out' && <span className="text-cream/85">{l.text}</span>}
            {l.kind === 'hi' && (
              <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-coral text-cream font-semibold">
                {l.text}
              </span>
            )}
          </div>
        ))}
        {linesShown < PROOF_LINES.length && (
          <span className="inline-block w-1.5 h-3 bg-coralsoft/80 align-middle anim-tick" />
        )}
      </div>

      <div className="rounded-md border border-warmline bg-paper/60 px-3 py-2 text-[10px] sm:text-[11px] text-ink text-center font-mono">
        <span className="text-muted">trace · </span>
        <span>every branch · every retry · every verdict — replayable</span>
      </div>
    </div>
  );
}
