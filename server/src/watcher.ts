import fs from 'fs';
import path from 'path';
import { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import { prisma } from './db.js';

export interface StoredProject {
  platform: string;
  externalId: string;
  title: string;
  description: string;
  listingDescription?: string;
  url: string;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  budgetType?: string;
  skills: string[];
  category?: string;
  subCategory?: string;
  language: string;
  postedAt: string;
  firstSeenAt: string;
  detailsEnriched: boolean;
}

export interface EmittedProject extends StoredProject {
  id: string;
}

// In-memory store — shared with routes/projects.ts
export const projectsStore: EmittedProject[] = [];
const seenIds = new Set<string>();

function toEmitted(p: StoredProject): EmittedProject {
  return { ...p, id: `${p.platform}:${p.externalId}` };
}

function loadProjectsFile(filePath: string): StoredProject[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function sendGmailAlert(project: EmittedProject, userEmail: string, userName: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    const budgetText =
      project.budgetMin != null
        ? `${project.currency ?? '$'}${project.budgetMin}${project.budgetMax && project.budgetMax !== project.budgetMin ? ` – ${project.currency ?? '$'}${project.budgetMax}` : ''}`
        : 'Not specified';

    await transporter.sendMail({
      from: `"GO Freelance" <${process.env.GMAIL_USER}>`,
      to: userEmail,
      subject: `🚀 New matching project on ${project.platform}: ${project.title}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a12;color:#fff;padding:24px;border-radius:12px;">
          <h2 style="color:#29B2FE;margin-top:0">New Skill-Matched Project</h2>
          <p>Hi ${userName},</p>
          <p>A new project matching your skills was just posted on <strong>${project.platform}</strong>:</p>
          <div style="background:#111;border:1px solid #29B2FE44;border-radius:8px;padding:16px;margin:16px 0;">
            <h3 style="margin:0 0 8px;color:#fff">${project.title}</h3>
            <p style="color:#aaa;margin:0 0 12px;font-size:14px">${project.description?.slice(0, 300)}${project.description?.length > 300 ? '...' : ''}</p>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
              <span style="background:#29B2FE22;color:#29B2FE;padding:4px 10px;border-radius:20px;font-size:12px">💰 ${budgetText}</span>
              ${project.skills.slice(0, 5).map(s => `<span style="background:#ffffff11;color:#ccc;padding:4px 10px;border-radius:20px;font-size:12px">${s}</span>`).join('')}
            </div>
            <a href="${project.url}" style="background:#29B2FE;color:#000;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">View Project →</a>
          </div>
          <p style="color:#666;font-size:12px">Sent by GO Freelance • Manage alerts in your account settings</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Gmail] Failed to send alert:', err);
  }
}

async function checkSkillAlerts(newProjects: EmittedProject[], io: Server) {
  try {
    const usersWithAlerts = await prisma.user.findMany({
      where: { gmailAlerts: true },
      select: { id: true, email: true, name: true, skills: true, alertedIds: true, gmailEmail: true },
    });

    for (const user of usersWithAlerts) {
      const userSkills: string[] = JSON.parse(user.skills).map((s: string) => s.toLowerCase());
      const alertedIds: string[] = JSON.parse(user.alertedIds);
      const targetEmail = user.gmailEmail || user.email;

      for (const project of newProjects) {
        if (alertedIds.includes(project.id)) continue;
        const projectSkills = project.skills.map(s => s.toLowerCase());
        const hasMatch = userSkills.some(us => projectSkills.some(ps => ps.includes(us) || us.includes(ps)));
        if (!hasMatch) continue;

        // Emit socket alert to specific user session
        io.emit(`alert:${user.id}`, project);

        // Send Gmail
        await sendGmailAlert(project, targetEmail, user.name);

        // Mark as alerted
        alertedIds.push(project.id);
        await prisma.user.update({
          where: { id: user.id },
          data: { alertedIds: JSON.stringify(alertedIds) },
        });
      }
    }
  } catch (err) {
    console.error('[Alerts] Error checking skill alerts:', err);
  }
}

export function startWatcher(io: Server) {
  const filePath = path.resolve(process.env.WORKER_DATA_PATH ?? '../worker/data/projects.json');

  // Initial load
  const initial = loadProjectsFile(filePath);
  for (const p of initial) {
    const emitted = toEmitted(p);
    if (!seenIds.has(emitted.id)) {
      seenIds.add(emitted.id);
      projectsStore.unshift(emitted);
    }
  }
  // Keep at most 500 projects in memory
  if (projectsStore.length > 500) projectsStore.splice(500);
  console.log(`[Watcher] Loaded ${projectsStore.length} existing projects from ${filePath}`);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function onFileChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const projects = loadProjectsFile(filePath);
      const newProjects: EmittedProject[] = [];

      for (const p of projects) {
        const emitted = toEmitted(p);
        if (!seenIds.has(emitted.id)) {
          seenIds.add(emitted.id);
          projectsStore.unshift(emitted);
          newProjects.push(emitted);
        }
      }

      if (projectsStore.length > 500) projectsStore.splice(500);

      if (newProjects.length > 0) {
        console.log(`[Watcher] ${newProjects.length} new project(s) detected`);
        for (const project of newProjects) {
          io.emit('project:new', project);
        }
        // Check Gmail alerts asynchronously
        checkSkillAlerts(newProjects, io).catch(console.error);
      }
    }, 500);
  }

  // Watch file with fs.watch
  try {
    fs.watch(filePath, { persistent: false }, onFileChange);
    console.log(`[Watcher] Watching ${filePath}`);
  } catch {
    console.warn(`[Watcher] fs.watch failed, falling back to polling`);
  }

  // Polling fallback every 10 seconds (also catches missed watch events)
  setInterval(onFileChange, 10_000);
}
