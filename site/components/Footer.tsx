import { Pill } from './Pill';

export function Footer() {
  return (
    <footer className="border-t border-warmline mt-12">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-serif text-lg">ZeroU</span>
            <Pill mono tone="rust">alpha</Pill>
          </div>
          <div className="text-[11px] text-muted font-mono">
            demo → product · MIT licensed · made for vibe coders shipping for real
          </div>
        </div>

        <div className="flex items-center gap-5 text-sm">
          <a
            href="https://github.com/Upp-Ljl/d2p"
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink/80 hover:text-coral"
          >
            GitHub
          </a>
          <a
            href="https://github.com/Upp-Ljl/d2p/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink/80 hover:text-coral"
          >
            License
          </a>
          <a
            href="https://github.com/Upp-Ljl/d2p/issues"
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink/80 hover:text-coral"
          >
            Issues
          </a>
        </div>
      </div>
    </footer>
  );
}
