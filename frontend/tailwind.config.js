/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        terminal: {
          bg: '#030303',
          panel: '#111315',
          panelSoft: '#171a1d',
          border: '#30343a',
          text: '#f2f2f2',
          muted: '#9ca3af',
          green: '#22c55e',
          red: '#ef4444',
          amber: '#f59e0b',
        },
      },
      boxShadow: {
        terminal: '0 18px 55px rgba(0, 0, 0, 0.45)',
      },
    },
  },
  plugins: [],
};
