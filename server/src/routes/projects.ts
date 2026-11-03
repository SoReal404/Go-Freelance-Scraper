import { Router, Request, Response } from 'express';
import { projectsStore, EmittedProject } from '../watcher.js';

export const projectsRouter = Router();

// GET /api/projects
// Query params: platform, skills (comma-separated), search, limit, offset
projectsRouter.get('/', (req: Request, res: Response) => {
  const platform = req.query.platform as string | undefined;
  const skillsParam = req.query.skills as string | undefined;
  const search = (req.query.search as string | undefined)?.toLowerCase().trim();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const requestedSkills = skillsParam
    ? skillsParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];

  let filtered: EmittedProject[] = projectsStore;

  // Platform filter
  if (platform) {
    const platforms = platform.split(',').map(p => p.trim().toLowerCase());
    filtered = filtered.filter(p => platforms.includes(p.platform.toLowerCase()));
  }

  // Skills filter
  if (requestedSkills.length > 0) {
    filtered = filtered.filter(p =>
      p.skills.some(s => requestedSkills.some(rs => s.toLowerCase().includes(rs) || rs.includes(s.toLowerCase())))
    );
  }

  // Search filter (title + description + skills)
  if (search) {
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(search) ||
      p.description.toLowerCase().includes(search) ||
      p.skills.some(s => s.toLowerCase().includes(search))
    );
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  res.json({ projects: page, total, limit, offset });
});

// GET /api/projects/platforms — returns list of active platforms with counts
projectsRouter.get('/platforms', (_req: Request, res: Response) => {
  const counts: Record<string, number> = {};
  for (const p of projectsStore) {
    counts[p.platform] = (counts[p.platform] ?? 0) + 1;
  }
  res.json(counts);
});

// GET /api/projects/skills — returns all unique skills
projectsRouter.get('/skills', (_req: Request, res: Response) => {
  const skillSet = new Set<string>();
  for (const p of projectsStore) {
    for (const s of p.skills) {
      if (s && s.length > 1) skillSet.add(s);
    }
  }
  res.json([...skillSet].slice(0, 200));
});
