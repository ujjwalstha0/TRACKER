/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        terminal: {
          bg: '#060b10',
          panel: '#101a25',
          panelSoft: '#142130',
          border: '#274156',
          text: '#ebf3ff',
          muted: '#8fa6bd',
          green: '#22c55e',
          red: '#f97373',
          amber: '#f59e0b',
        },
      },
      boxShadow: {
        terminal: '0 20px 55px rgba(2, 10, 18, 0.48)',
      },
    },
  },
  plugins: [],
};
