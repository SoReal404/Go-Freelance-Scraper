export type FreelancerProject = {
  id: string
  title: string
  description: string
  url: string
  skills: string[]
}

export type FreelancerProfile = {
  id: string
  title: string
  overview: string
  skills: string[]
  projects: FreelancerProject[]
}

export type FreelancerWorkspace = {
  fullName: string
  profiles: FreelancerProfile[]
  activeProfileId: string
  activityDates: string[]
  streakCount: number
  lastActivityDate: string
}

type UserMetadata = Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

export function readWorkspace(metadata: UserMetadata): FreelancerWorkspace {
  const profiles = Array.isArray(metadata.freelancer_profiles)
    ? metadata.freelancer_profiles.flatMap((value): FreelancerProfile[] => {
        if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return []
        const projects = Array.isArray(value.projects)
          ? value.projects.flatMap((project): FreelancerProject[] => {
              if (!isRecord(project) || typeof project.id !== 'string' || typeof project.title !== 'string') return []
              return [{
                id: project.id,
                title: project.title,
                description: typeof project.description === 'string' ? project.description : '',
                url: typeof project.url === 'string' ? project.url : '',
                skills: readStrings(project.skills),
              }]
            })
          : []
        return [{
          id: value.id,
          title: value.title,
          overview: typeof value.overview === 'string' ? value.overview : '',
          skills: readStrings(value.skills),
          projects,
        }]
      })
    : []
  const activeProfileId = typeof metadata.active_freelancer_profile_id === 'string'
    ? metadata.active_freelancer_profile_id
    : ''
  const activityDates = readStrings(metadata.freelancer_activity_dates)
  const lastActivityDate = typeof metadata.freelancer_last_activity_date === 'string'
    ? metadata.freelancer_last_activity_date
    : ''
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const recentActivity = lastActivityDate === getUtcDateKey() || lastActivityDate === getUtcDateKey(yesterday)

  return {
    fullName: typeof metadata.full_name === 'string' ? metadata.full_name : '',
    profiles,
    activeProfileId: profiles.some((profile) => profile.id === activeProfileId)
      ? activeProfileId
      : profiles[0]?.id ?? '',
    activityDates,
    streakCount: recentActivity
      ? typeof metadata.freelancer_streak_count === 'number'
        ? metadata.freelancer_streak_count
        : getStreakLength(activityDates, lastActivityDate || getUtcDateKey())
      : lastActivityDate
        ? 0
        : getStreakLength(activityDates),
    lastActivityDate,
  }
}

export function getUtcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function getStreakLength(activityDates: string[], today = getUtcDateKey()): number {
  const dates = new Set(activityDates)
  let streak = 0
  const date = new Date(`${today}T00:00:00.000Z`)

  while (dates.has(getUtcDateKey(date))) {
    streak += 1
    date.setUTCDate(date.getUTCDate() - 1)
  }

  return streak
}

export function recordDailyActivity(workspace: FreelancerWorkspace, today = getUtcDateKey()): FreelancerWorkspace {
  const activityDates = [...new Set([...workspace.activityDates, today])].sort().slice(-365)
  if (workspace.lastActivityDate === today) {
    return { ...workspace, activityDates }
  }

  const yesterday = new Date(`${today}T00:00:00.000Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const continuesStreak = workspace.lastActivityDate
    ? workspace.lastActivityDate === getUtcDateKey(yesterday)
    : workspace.activityDates.includes(getUtcDateKey(yesterday))

  return {
    ...workspace,
    activityDates,
    streakCount: continuesStreak
      ? (workspace.streakCount || getStreakLength(workspace.activityDates, getUtcDateKey(yesterday))) + 1
      : 1,
    lastActivityDate: today,
  }
}

export function getRecentActivity(activityDates: string[], days = 28, today = getUtcDateKey()): boolean[] {
  const dates = new Set(activityDates)
  const date = new Date(`${today}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - days + 1)

  return Array.from({ length: days }, () => {
    const active = dates.has(getUtcDateKey(date))
    date.setUTCDate(date.getUTCDate() + 1)
    return active
  })
}
