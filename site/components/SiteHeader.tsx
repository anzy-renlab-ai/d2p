import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-paper/85 backdrop-blur border-b border-warmline">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-serif text-xl tracking-tight">ZeroU</span>
          <span className="text-[10px] uppercase tracking-widest text-muted font-mono">
            alpha · v0.1.0
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#bench" className="text-ink/80 hover:text-coral">
            Bench
          </a>
          <a href="#quickstart" className="text-ink/80 hover:text-coral">
            Docs
          </a>
          <a
            href="https://github.com/Upp-Ljl/d2p"
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink/80 hover:text-coral"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
