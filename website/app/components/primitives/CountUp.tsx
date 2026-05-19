'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';

type Props = {
  to: number;
  /** Decimal places for display. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Duration in ms. */
  duration?: number;
  className?: string;
  /** If provided, render this static string while reduced-motion is on. */
  staticDisplay?: string;
};

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

function format(n: number, decimals: number): string {
  return decimals > 0
    ? n.toFixed(decimals)
    : Math.round(n).toLocaleString('en-US');
}

/**
 * Lightweight count-up. Triggers when scrolled into view, once.
 * If prefers-reduced-motion, jumps straight to the terminal value.
 */
export function CountUp({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1200,
  className,
  staticDisplay,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px -15% 0px' });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      setValue(to * easeOutQuart(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduce]);

  const text = staticDisplay ?? `${prefix}${format(value, decimals)}${suffix}`;
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
