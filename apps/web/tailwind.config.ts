import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        graphite: 'var(--color-graphite)',
        'deep-industry-blue': 'var(--color-deep-industry-blue)',
        'signal-amber': 'var(--color-signal-amber)',
        'graphite-surface': 'var(--color-graphite-surface)',
        'mist-metal': 'var(--color-mist-metal)',
        neutral: {
          50: 'var(--color-neutral-50)',
          100: 'var(--color-neutral-100)',
          200: 'var(--color-neutral-200)',
          300: 'var(--color-neutral-300)',
          400: 'var(--color-neutral-400)',
          500: 'var(--color-neutral-500)',
          600: 'var(--color-neutral-600)',
          700: 'var(--color-neutral-700)',
          800: 'var(--color-neutral-800)',
          900: 'var(--color-neutral-900)',
          950: 'var(--color-neutral-950)'
        }
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)'
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        body: ['var(--font-body)']
      }
    }
  },
  plugins: []
};

export default config;
