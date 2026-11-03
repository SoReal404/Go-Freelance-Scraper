export interface Project {
  id: string;
  platform: string;
  externalId: string;
  title: string;
  description: string;
  listingDescription?: string;
  url: string;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  budgetType?: 'fixed' | 'hourly';
  skills: string[];
  category?: string;
  language: string;
  postedAt: string;
  firstSeenAt: string;
  detailsEnriched: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  skills: string[];
  description: string;
  plan: 'trial' | 'free' | 'pro';
  trialEndsAt: string | null;
  aiBidsUsed: number;
  aiBidsLimit: number;
  gmailAlerts: boolean;
  gmailEmail: string | null;
  isTrialActive: boolean;
  isLocked: boolean;
}

export interface PlatformTheme {
  name: string;
  primary: string;
  secondary: string;
  glow: string;
  gradient: string;
  icon: string;
}
