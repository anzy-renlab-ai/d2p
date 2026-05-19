import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Crimson_Pro } from 'next/font/google';
import { LangProvider } from './i18n';
import './globals.css';

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

const serif = Crimson_Pro({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://zerou.dev'),
  title: 'ZeroU — Ship the demo. Skip the product work.',
  description:
    'Point ZeroU at a local demo folder. It writes the README, CI, CSRF, backups, empty states, loading states, a11y — then pushes a real PR.',
  openGraph: {
    title: 'ZeroU — Ship the demo. Skip the product work.',
    description:
      '6 agents, 4 reviewer layers, automatic GitHub PRs. Real run: 1h 31min, $4.24.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZeroU — Ship the demo. Skip the product work.',
    description:
      '6 agents, 4 reviewer layers, automatic GitHub PRs. Real run: 1h 31min, $4.24.',
  },
};

export const viewport: Viewport = {
  themeColor: '#F5F2EC',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="font-sans bg-paper text-ink antialiased">
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
