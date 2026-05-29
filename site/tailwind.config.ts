import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Anthropic / Claude-inspired warm palette — inherited from d2p
        paper: '#F5F2EC',
        cream: '#FAF9F5',
        ink: '#1F1F1E',
        muted: '#5E5C57',
        warmline: '#E5E1D8',
        coral: '#C96442',
        coralhover: '#B85636',
        coralsoft: '#F0D9CC',
        forest: '#587A4C',
        rust: '#B23A48',
        slate: { 50: '#F1F4F7', 100: '#E2E8EE', 600: '#52647A' },
        sage: { 50: '#EEF3EC', 100: '#DBE6D6', 600: '#5A7350' },
        amber: { 50: '#FAF1E4', 100: '#F2DFBE', 600: '#9B6A1F' },
        plum: { 50: '#F4EEF4', 100: '#E5D6E5', 600: '#7A4F7A' },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(31,31,30,0.04), 0 0 0 1px rgba(31,31,30,0.04)',
        card: '0 1px 3px rgba(31,31,30,0.05), 0 4px 12px rgba(31,31,30,0.04)',
        cardHover: '0 2px 4px rgba(31,31,30,0.06), 0 8px 20px rgba(31,31,30,0.06)',
        glow: '0 0 0 1px rgba(201,100,66,0.20), 0 4px 16px rgba(201,100,66,0.12)',
      },
      fontFamily: {
        serif: [
          'Tiempos Headline',
          'ui-serif',
          'Iowan Old Style',
          'Apple Garamond',
          'Baskerville',
          'Times New Roman',
          'serif',
        ],
        sans: [
          'Styrene B',
          'Söhne',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
export default config;
