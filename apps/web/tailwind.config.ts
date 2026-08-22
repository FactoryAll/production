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
        'mist-metal': 'var(--color-mist-metal)'
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)'
      }
    }
  },
  plugins: []
};

export default config;
