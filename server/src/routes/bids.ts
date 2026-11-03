import { Router, Response } from 'express';
import OpenAI from 'openai';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

export const bidsRouter = Router();

// POST /api/bids/generate
bidsRouter.post('/generate', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    projectId: z.string(),
    projectTitle: z.string(),
    projectDescription: z.string(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Check locked status
  const now = new Date();
  const isTrialActive = user.plan === 'trial' && user.trialEndsAt != null && user.trialEndsAt > now;
  const isLocked = user.plan === 'free' || (user.plan === 'trial' && !isTrialActive);

  if (isLocked) {
    res.status(403).json({
      error: 'locked',
      message: 'Your free trial has expired. Upgrade to Pro to generate AI bids.',
    });
    return;
  }

  // Check AI bid limit for non-pro users
  if (user.plan !== 'pro' && user.aiBidsUsed >= user.aiBidsLimit) {
    res.status(403).json({
      error: 'limit_reached',
      message: `You've used all ${user.aiBidsLimit} AI bids. Upgrade to Pro for unlimited bids.`,
      used: user.aiBidsUsed,
      limit: user.aiBidsLimit,
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: 'AI bid generation is not configured. Add OPENAI_API_KEY to server .env' });
    return;
  }

  const userSkills: string[] = JSON.parse(user.skills);
  const { projectTitle, projectDescription } = parsed.data;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional freelancer writing winning bid proposals. Be specific, confident, and concise. No generic phrases or filler content.`,
        },
        {
          role: 'user',
          content: `Write a winning bid proposal for this freelance project.

MY SKILLS: ${userSkills.join(', ')}
MY PROFILE: ${user.description || 'Experienced freelancer'}

PROJECT TITLE: ${projectTitle}
PROJECT DESCRIPTION: ${projectDescription}

Write a professional bid (150-200 words) that:
1. Opens with a specific hook tied to the project's exact need
2. Highlights my most relevant skills for this specific project
3. Proposes a clear approach or solution
4. Ends with a confident call to action

Be direct and personal. No filler phrases like "I am writing to express my interest".`,
        },
      ],
      max_tokens: 400,
      temperature: 0.7,
    });

    const bid = completion.choices[0]?.message?.content?.trim();
    if (!bid) {
      res.status(500).json({ error: 'AI returned an empty response' });
      return;
    }

    // Increment usage
    await prisma.user.update({
      where: { id: user.id },
      data: { aiBidsUsed: { increment: 1 } },
    });

    res.json({
      bid,
      usedAfter: user.aiBidsUsed + 1,
      limit: user.aiBidsLimit,
      plan: user.plan,
    });
  } catch (err) {
    console.error('[Bids] OpenAI error:', err);
    res.status(500).json({ error: 'Failed to generate bid. Try again.' });
  }
});
