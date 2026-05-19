'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { AgentCard, type AgentRole, type AgentStatus } from './primitives/AgentCard';
import { CountUp } from './primitives/CountUp';

const AGENTS: AgentRole[] = [
  'differ',
  'implementer',
  'alignment',
  'behavioral',
  'done-check',
  'adversarial',
];

const CAPTIONS: Record<AgentRole, string> = {
  differ: 'scanning · 28 items',
  implementer: 'fix/readme-minimal · 3',
  alignment: 'score 8.2 · approve',
  behavioral: 'acceptance ok',
  'done-check': 'verifying merge',
  adversarial: 'standby · low risk',
};

const CYCLE_MS = 6_000;

export function AgentBoard() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) {
      setTick(0);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      setTick(((now - start) % CYCLE_MS) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  // Each second a different agent flips to "working"
  const activeIdx = Math.floor(tick) % AGENTS.length;

  function statusFor(idx: number): AgentStatus {
    if (idx === activeIdx) return 'working';
    if (idx < activeIdx) return 'done';
    return 'idle';
  }

  return (
    <div className="rounded-2xl bg-cream p-6 ring-1 ring-warmline/60 sm:p-8">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-coral anim-breathe" aria-hidden="true" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
            sessions · 6 agents
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted">attempt 12 / max 40</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {AGENTS.map((role, idx) => (
          <AgentCard
            key={role}
            role={role}
            status={statusFor(idx)}
            caption={CAPTIONS[role]}
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-warmline pt-5">
        <div>
          <div className="font-serif text-[22px] text-coral">
            <CountUp to={6} />
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            agents
          </div>
        </div>
        <div>
          <div className="font-serif text-[22px] text-coral">
            <CountUp to={61} duration={1500} />
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            fix attempts
          </div>
        </div>
        <div>
          <div className="font-serif text-[22px] text-forest">
            <CountUp to={2} />
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            merged
          </div>
        </div>
      </div>
    </div>
  );
}
