import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const lockWaitMs = 100;
const staleLockMs = 120_000;

async function acquireLock(lockPath, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await open(lockPath, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleLockMs) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      await new Promise((done) => setTimeout(done, lockWaitMs));
    }
  }
  throw new Error(`Timed out waiting for project store lock: ${lockPath}`);
}

export async function readProjectStore(path = resolve('data/projects.json')) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`Could not read project store ${path}: ${error.message}`);
  }
}

export async function upsertProject(project, path = resolve('data/projects.json')) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const lock = await acquireLock(lockPath);
  let tempPath;
  try {
    let projects = [];
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      if (!Array.isArray(parsed.projects)) throw new Error('projects must be an array');
      projects = parsed.projects;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const index = projects.findIndex((item) => item.platform === project.platform && String(item.external_id) === String(project.external_id));
    if (index === -1) projects.push(project);
    else projects[index] = { ...projects[index], ...project, details: { ...projects[index].details, ...project.details } };
    projects.sort((a, b) => String(b.posted_at ?? '').localeCompare(String(a.posted_at ?? '')));

    const document = { schema_version: 1, updated_at: new Date().toISOString(), projects };
    tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await rename(tempPath, path);
    const savedProject = projects.find((item) => item.platform === project.platform && String(item.external_id) === String(project.external_id));
    return { inserted: index === -1, project: savedProject };
  } finally {
    if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
