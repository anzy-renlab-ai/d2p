import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ZeroU palette — warm-graphite, intentionally ~5–8% off Claude's
        // reference values so the dashboard reads as instrument panel,
        // not Claude.ai blog. Cool electric blue is the secondary accent
        // used on numeric/data strips — Claude never pairs blue with coral.
        paper: '#F0EDE4',        // page bg (cooler, graphite-warm)
        cream: '#F7F5EF',        // surfaces / cards
        ink: '#1F1F1E',          // primary text
        muted: '#5E5C57',        // secondary text
        warmline: '#E0D9CC',     // borders (slightly cooler tan, more 'panel')
        coral: '#C5563E',        // primary accent (brick-rust, deeper than Claude coral)
        coralhover: '#A8472D',
        coralsoft: '#EBCDBE',    // tinted bg
        electric: '#0066CC',     // secondary accent — instrument-panel blue (data / numeric / links)
        forest: '#587A4C',       // success
        rust: '#B23A48',         // error
        // Role-specific soft tints for cards / chips
        slate:  { 50: '#F1F4F7', 100: '#E2E8EE', 600: '#52647A' },
        sage:   { 50: '#EEF3EC', 100: '#DBE6D6', 600: '#5A7350' },
        amber:  { 50: '#FAF1E4', 100: '#F2DFBE', 600: '#9B6A1F' },
        plum:   { 50: '#F4EEF4', 100: '#E5D6E5', 600: '#7A4F7A' },
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
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
export default config;
