import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Anthropic / Claude-inspired warm palette
        paper: '#F5F2EC',        // page bg (warm cream)
        cream: '#FAF9F5',        // surfaces / cards
        ink: '#1F1F1E',          // primary text
        muted: '#5E5C57',        // secondary text
        warmline: '#E5E1D8',     // borders
        coral: '#C96442',        // primary accent (Claude orange)
        coralhover: '#B85636',
        coralsoft: '#F0D9CC',    // tinted bg
        forest: '#587A4C',       // success
        rust: '#B23A48',         // error
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
      boxShadow: {
        soft: '0 1px 2px rgba(31,31,30,0.04), 0 0 0 1px rgba(31,31,30,0.04)',
      },
    },
  },
  plugins: [],
};
export default config;
