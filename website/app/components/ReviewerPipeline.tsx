'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const NODES = [
  { id: 'static', label: 'Static gate', sub: 'tsc · lint · test' },
  { id: 'alignment', label: 'Alignment', sub: 'cross-engine score' },
  { id: 'behavioral', label: 'Behavioral', sub: 'acceptance run' },
  { id: 'adversarial', label: 'Adversarial', sub: 'session-fixation' },
] as const;

type NodeState = 'idle' | 'pass' | 'break';

// 5s cycle: t in [0, 5)
// 0-1s: all idle
// 1-2s: static pass
// 2-3s: alignment pass
// 3-4s: behavioral pass
// 4-5s: adversarial break
function nodeState(idx: number, t: number): NodeState {
  const slot = idx + 1; // 1..4
  if (t < slot) return 'idle';
  if (idx === 3 && t >= 4) return 'break';
  return 'pass';
}

const CYCLE_MS = 5_000;

export function ReviewerPipeline() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) {
      setTick(4.5); // terminal state with break visible
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

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-cream p-6 ring-1 ring-warmline/60 sm:p-8">
      <div className="mb-6 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-coral anim-breathe" aria-hidden="true" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          reviewer pipeline · live
        </span>
      </div>

      {/* nodes + connectors */}
      <div className="relative flex items-start justify-between gap-2">
        {NODES.map((node, idx) => {
          const state = nodeState(idx, tick);
          const isLast = idx === NODES.length - 1;
          return (
            <div key={node.id} className="relative flex flex-1 flex-col items-center">
              {/* connector (right of all but last) */}
              {!isLast && (
                <div className="absolute left-1/2 top-3 h-px w-full -translate-y-1/2 bg-warmline" aria-hidden="true">
                  <motion.div
                    initial={false}
                    animate={{
                      backgroundColor:
                        state !== 'idle' ? 'rgba(88,122,76,0.5)' : 'transparent',
                    }}
                    transition={{ duration: 0.3 }}
                    className="h-full w-full"
                  />
                </div>
              )}

              {/* node dot */}
              <motion.div
                initial={false}
                animate={{
                  backgroundColor:
                    state === 'pass'
                      ? '#587A4C' // forest
                      : state === 'break'
                      ? '#B23A48' // rust
                      : '#E5E1D8', // warmline
                  boxShadow:
                    state === 'pass'
                      ? '0 0 0 4px rgba(88,122,76,0.18)'
                      : state === 'break'
                      ? '0 0 0 4px rgba(178,58,72,0.22)'
                      : 'none',
                }}
                transition={{ duration: 0.3 }}
                className="relative z-10 h-6 w-6 rounded-full"
                aria-label={`${node.label}: ${state}`}
              />

              <div className="mt-3 text-center">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ink/80">
                  {node.label}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted">{node.sub}</div>
              </div>

              {/* break tooltip on last node */}
              {idx === 3 && state === 'break' && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rust/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-rust ring-1 ring-rust/30"
                  role="status"
                >
                  break · session-fixation
                </motion.div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 border-t border-warmline pt-4 text-xs text-muted">
        <span className="font-mono uppercase tracking-wider">verdict:</span>{' '}
        <span className="font-mono text-ink">NEED_HUMAN</span>
        <span className="text-muted/70"> · reason_code </span>
        <span className="font-mono text-rust">ADVERSARIAL_BREAK</span>
      </div>
    </div>
  );
}
