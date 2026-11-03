import type { PlatformTheme } from './types';

export const PLATFORM_THEMES: Record<string, PlatformTheme> = {
  freelancer: {
    name: 'Freelancer.com',
    primary: '#29B2FE',
    secondary: '#0E1E25',
    glow: 'rgba(41,178,254,0.35)',
    gradient: 'from-[#29B2FE] to-[#1B6FA8]',
    icon: '💼',
  },
  upwork: {
    name: 'Upwork',
    primary: '#14A800',
    secondary: '#1D1D1D',
    glow: 'rgba(20,168,0,0.35)',
    gradient: 'from-[#14A800] to-[#0A5C00]',
    icon: '🔰',
  },
  peopleperhour: {
    name: 'PeoplePerHour',
    primary: '#FF6B35',
    secondary: '#1A1A2E',
    glow: 'rgba(255,107,53,0.35)',
    gradient: 'from-[#FF6B35] to-[#C43E10]',
    icon: '⏰',
  },
  guru: {
    name: 'Guru',
    primary: '#1B75BB',
    secondary: '#1A1A2E',
    glow: 'rgba(27,117,187,0.35)',
    gradient: 'from-[#1B75BB] to-[#F58026]',
    icon: '🧙',
  },
  mostaql: {
    name: 'Mostaql',
    primary: '#F0A500',
    secondary: '#1B2A4A',
    glow: 'rgba(240,165,0,0.35)',
    gradient: 'from-[#F0A500] to-[#C07800]',
    icon: '🌙',
  },
  nafezly: {
    name: 'Nafezly',
    primary: '#8B5CF6',
    secondary: '#1E1B4B',
    glow: 'rgba(139,92,246,0.35)',
    gradient: 'from-[#8B5CF6] to-[#5B21B6]',
    icon: '✨',
  },
  shoghlonline: {
    name: 'ShoghlOnline',
    primary: '#14B8A6',
    secondary: '#0F2027',
    glow: 'rgba(20,184,166,0.35)',
    gradient: 'from-[#14B8A6] to-[#0A7067]',
    icon: '🏢',
  },
  'freelance-arabs': {
    name: 'FreelanceArabs',
    primary: '#22C55E',
    secondary: '#14532D',
    glow: 'rgba(34,197,94,0.35)',
    gradient: 'from-[#22C55E] to-[#15803D]',
    icon: '🌍',
  },
};

export function getTheme(platform: string): PlatformTheme {
  const key = platform.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return (
    PLATFORM_THEMES[key] ??
    PLATFORM_THEMES[platform.toLowerCase()] ?? {
      name: platform,
      primary: '#6366F1',
      secondary: '#1e1b4b',
      glow: 'rgba(99,102,241,0.35)',
      gradient: 'from-[#6366F1] to-[#4338CA]',
      icon: '🔗',
    }
  );
}
