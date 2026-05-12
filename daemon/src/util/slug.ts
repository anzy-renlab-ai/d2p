const SLUG_RE = /^[a-z][a-z0-9-]{1,63}$/;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

export function assertValidSlug(s: string): void {
  if (!isValidSlug(s)) {
    throw new Error(`invalid slug: ${JSON.stringify(s)} (expected ${SLUG_RE.source})`);
  }
}

export function kebab(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'gap';
}
