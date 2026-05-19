type ClassValue = string | number | null | false | undefined | Record<string, boolean | null | undefined>;

export function clsx(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
      continue;
    }
    if (typeof input === 'object') {
      for (const [k, v] of Object.entries(input)) {
        if (v) out.push(k);
      }
    }
  }
  return out.join(' ');
}
