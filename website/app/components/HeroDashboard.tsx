'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AgentCard, type AgentRole, type AgentStatus } from './primitives/AgentCard';
import { Check, GitCommit } from 'lucide-react';

type CommitEntry = {
  sha: string;
  label: string;
};

const COMMITS: CommitEntry[] = [
  { sha: '5aedd6e', label: 'docs-changelog-missing' },
  { sha: '4b58841', label: 'readme-minimal-incomplete' },
  { sha: '3d2ad5f', label: 'changelog-followup' },
  { sha: '53df272', label: 'readme-polish' },
];

const AGENTS: AgentRole[] = [
  'differ',
  'implementer',
  'alignment',
  'behavioral',
  'adversarial',
  'done-check',
];

const CAPTIONS: Record<AgentRole, string> = {
  differ: 'scanning preset · 28 items',
  implementer: 'fix/readme-minimal · attempt 3',
  alignment: 'cross-engine score · 8.2',
  behavioral: 'acceptance · APPROVE',
  adversarial: 'standby · low risk',
  'done-check': 'verifying merge',
};

// Schedule: which agent enters "working" at each second, indexed by second offset.
// Cycle is 10 seconds total.
const AGENT_TIMELINE: { at: number; role: AgentRole; until: number }[] = [
  { at: 0.6, role: 'differ', until: 2.0 },
  { at: 2.0, role: 'implementer', until: 4.5 },
  { at: 4.5, role: 'alignment', until: 6.0 },
  { at: 6.0, role: 'behavioral', until: 7.5 },
  { at: 7.5, role: 'done-check', until: 9.0 },
];

const COMMIT_SCHEDULE = [2.2, 3.8, 5.4, 7.0]; // seconds when commit chips appear
const CYCLE_MS = 10_000;

function statusAt(role: AgentRole, t: number): AgentStatus {
  for (const window of AGENT_TIMELINE) {
    if (window.role === role) {
      if (t >= window.at && t < window.until) return 'working';
      if (t >= window.until) return 'done';
    }
  }
  return 'idle';
}

function presetCount(t: number): number {
  // 8 → 26 over the 10s cycle, easeOutQuart
  const base = 8;
  const peak = 26;
  const norm = Math.min(1, t / 9);
  const eased = 1 - Math.pow(1 - norm, 4);
  return Math.round(base + (peak - base) * eased);
}

function costAt(t: number): number {
  const norm = Math.min(1, t / 9);
  const eased = 1 - Math.pow(1 - norm, 4);
  return 4.24 * eased;
}

export function HeroDashboard() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0); // seconds into the cycle

  useEffect(() => {
    if (reduce) {
      setTick(9.5);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const elapsed = (now - start) % CYCLE_MS;
      setTick(elapsed / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const visibleCommits = COMMIT_SCHEDULE.reduce<CommitEntry[]>((acc, at, idx) => {
    if (tick >= at) {
      const commit = COMMITS[idx];
      if (commit) acc.push(commit);
    }
    return acc;
  }, []);

  const preset = presetCount(tick);
  const cost = costAt(tick);

  return (
    <div
      className="relative h-full w-full rounded-2xl bg-cream p-5 shadow-cardHover ring-1 ring-warmline"
      aria-label="ZeroU workspace preview"
    >
      {/* Status strip */}
      <div className="flex items-center justify-between gap-3 border-b border-warmline pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-forest" aria-hidden="true" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
            session · live
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-muted">
          <span>
            preset <span className="text-ink">{preset}</span>/28
          </span>
          <span className="text-warmline">·</span>
          <span>
            cost <span className="text-coral">${cost.toFixed(2)}</span>
          </span>
        </div>
      </div>

      {/* Body: left agents / right commits */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1.1fr_1fr]">
        {/* Agents */}
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
            agents
          </div>
          {AGENTS.map((role) => (
            <AgentCard
              key={role}
              role={role}
              status={statusAt(role, tick)}
              caption={CAPTIONS[role]}
              compact
            />
          ))}
        </div>

        {/* Commit timeline */}
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
            commits → main
          </div>
          <div className="relative min-h-[200px] rounded-xl bg-paper p-3 ring-1 ring-warmline">
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {visibleCommits.map((c) => (
                  <motion.li
                    key={c.sha}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="flex items-center gap-2"
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-forest/15 text-forest"
                      aria-hidden="true"
                    >
                      <Check size={12} strokeWidth={2.5} />
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-cream px-2 py-1 font-mono text-[11px] ring-1 ring-warmline">
                      <GitCommit size={11} className="text-muted" aria-hidden="true" />
                      <span className="text-ink">{c.sha}</span>
                      <span className="truncate text-muted">· {c.label}</span>
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            {visibleCommits.length === 0 && (
              <div className="font-mono text-[11px] text-muted/70">
                waiting for first merge…
              </div>
            )}
          </div>

          {/* PR chip — appears late in cycle */}
          {tick > 7.2 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="inline-flex w-fit items-center gap-2 rounded-full bg-coralsoft px-3 py-1 font-mono text-[11px] text-coral ring-1 ring-coral/20"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" />
              PR #6 opened on GitHub
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
