import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://zerou.dev'),
  title: 'ZeroU — scan, fix, verify, trace your demo into production',
  description:
    'ZeroU hardens vibe-coded demos for production: preset-driven scan, deterministic fixes, runtime verification, and log-as-proof traceability. Built for an audit trail you can grep.',
  openGraph: {
    title: 'ZeroU — demo to production, with proof',
    description:
      'Scan + fix + verify + trace. Powered by presets, not vibes. Beats raw Opus 2.2× on precision at the same recall.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink">{children}</body>
    </html>
  );
}
