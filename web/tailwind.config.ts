import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#050508',
        'card-bg': '#0a0a12',
        'border-subtle': '#ffffff0d',
        // Platform colors
        freelancer: { DEFAULT: '#29B2FE', dark: '#0E1E25' },
        upwork: { DEFAULT: '#14A800', dark: '#1D1D1D' },
        pph: { DEFAULT: '#FF6B35', dark: '#1A1A2E' },
        guru: { DEFAULT: '#1B75BB', dark: '#1A1A2E', accent: '#F58026' },
        mostaql: { DEFAULT: '#F0A500', dark: '#1B2A4A' },
        nafezly: { DEFAULT: '#8B5CF6', dark: '#1E1B4B' },
        shoghlonline: { DEFAULT: '#14B8A6', dark: '#0F2027' },
        freelancearabs: { DEFAULT: '#22C55E', dark: '#14532D' },
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'fade-slide-up': 'fade-slide-up 0.5s ease-out',
        'slide-down': 'slide-down 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-slide-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-20px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

export default config;
