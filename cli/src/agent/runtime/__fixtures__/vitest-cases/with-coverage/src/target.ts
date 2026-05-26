// Fixture target source for coverage.
// Excluded from main vitest run via cli/vitest.config.ts (__fixtures__ glob).
export function add(a: number, b: number): number {
  return a + b;
}

export function classify(n: number): string {
  if (n > 0) return 'positive';
  if (n < 0) return 'negative';
  return 'zero';
}
