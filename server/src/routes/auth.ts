import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

export const authRouter = Router();

function makeToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, process.env.JWT_SECRET ?? 'dev-secret', { expiresIn: '30d' });
}

function formatUser(user: {
  id: string;
  email: string;
  name: string;
  skills: string;
  description: string;
  plan: string;
  trialEndsAt: Date | null;
  aiBidsUsed: number;
  aiBidsLimit: number;
  gmailAlerts: boolean;
  gmailEmail: string | null;
}) {
  const now = new Date();
  const isTrialActive = user.plan === 'trial' && user.trialEndsAt != null && user.trialEndsAt > now;
  const isLocked = user.plan === 'free' || (user.plan === 'trial' && !isTrialActive);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    skills: JSON.parse(user.skills) as string[],
    description: user.description,
    plan: user.plan as 'trial' | 'free' | 'pro',
    trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    aiBidsUsed: user.aiBidsUsed,
    aiBidsLimit: user.aiBidsLimit,
    gmailAlerts: user.gmailAlerts,
    gmailEmail: user.gmailEmail,
    isTrialActive,
    isLocked,
  };
}

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  const schema = z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(6),
    skills: z.array(z.string()).optional().default([]),
    description: z.string().optional().default(''),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }

  const { name, email, password, skills, description } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashed,
      skills: JSON.stringify(skills),
      description,
      plan: 'trial',
      trialEndsAt,
    },
  });

  const token = makeToken(user.id, user.email);
  res.status(201).json({ token, user: formatUser(user) });
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email or password format' });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = makeToken(user.id, user.email);
  res.json({ token, user: formatUser(user) });
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user: formatUser(user) });
});

// PUT /api/auth/profile
authRouter.put('/profile', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    name: z.string().min(2).max(80).optional(),
    skills: z.array(z.string()).optional(),
    description: z.string().max(2000).optional(),
    gmailAlerts: z.boolean().optional(),
    gmailEmail: z.string().email().optional().or(z.literal('')),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.skills !== undefined) data.skills = JSON.stringify(parsed.data.skills);
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.gmailAlerts !== undefined) data.gmailAlerts = parsed.data.gmailAlerts;
  if (parsed.data.gmailEmail !== undefined) data.gmailEmail = parsed.data.gmailEmail || null;

  const user = await prisma.user.update({
    where: { id: req.user!.userId },
    data,
  });

  res.json({ user: formatUser(user) });
});
