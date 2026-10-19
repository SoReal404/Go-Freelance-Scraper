'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  ExternalLink,
  Sparkles,
  Clock,
  DollarSign,
  Filter,
  CheckCircle2,
  Flame,
  Globe,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bookmark,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export interface LiveProject {
  id: string
  platform: string
  external_id: string
  title: string
  description: string | null
  listing_desc: string | null
  url: string
  budget_min: number | null
  budget_max: number | null
  currency: string | null
  budget_type: string | null
  skills: string[]
  category: string | null
  language: string | null
  posted_at: string | null
  created_at?: string | null
  details_enriched: boolean
}

const PROJECTS_PER_PAGE = 12
const MAX_FUTURE_POSTING_SKEW_MS = 60_000

function projectTimestamp(project: LiveProject, now: number): number | null {
  const postedAt = Date.parse(project.posted_at ?? '')
  if (Number.isFinite(postedAt) && postedAt <= now + MAX_FUTURE_POSTING_SKEW_MS) return postedAt

  const createdAt = Date.parse(project.created_at ?? '')
  if (Number.isFinite(createdAt) && createdAt <= now + MAX_FUTURE_POSTING_SKEW_MS) return createdAt

  return null
}

function newestFirst(projects: LiveProject[], now: number): LiveProject[] {
  return [...projects].sort((a, b) => (projectTimestamp(b, now) ?? 0) - (projectTimestamp(a, now) ?? 0))
}

function safeProjectUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string; glow: string; name: string }> = {
  freelancer: {
    bg: 'bg-[#29B2FE]/15',
    text: 'text-[#29B2FE]',
    border: 'border-[#29B2FE]/30 hover:border-[#29B2FE]/70',
    glow: 'hover:shadow-[0_0_30px_rgba(41,178,254,0.18)]',
    name: 'Freelancer.com',
  },
  mostaql: {
    bg: 'bg-[#F0A500]/15',
    text: 'text-[#F0A500]',
    border: 'border-[#F0A500]/30 hover:border-[#F0A500]/70',
    glow: 'hover:shadow-[0_0_30px_rgba(240,165,0,0.18)]',
    name: 'Mostaql',
  },
  peopleperhour: {
    bg: 'bg-[#FF6B35]/15',
    text: 'text-[#FF6B35]',
    border: 'border-[#FF6B35]/30 hover:border-[#FF6B35]/70',
    glow: 'hover:shadow-[0_0_30px_rgba(255,107,53,0.18)]',
    name: 'PeoplePerHour',
  },
  nafezly: {
    bg: 'bg-[#8B5CF6]/15',
    text: 'text-[#8B5CF6]',
    border: 'border-[#8B5CF6]/30 hover:border-[#8B5CF6]/70',
    glow: 'hover:shadow-[0_0_30px_rgba(139,92,246,0.18)]',
    name: 'Nafezly',
  },
  shoghlonline: {
    bg: 'bg-[#14B8A6]/15',
    text: 'text-[#14B8A6]',
    border: 'border-[#14B8A6]/30 hover:border-[#14B8A6]/70',
    glow: 'hover:shadow-[0_0_30px_rgba(20,184,166,0.18)]',
    name: 'ShoghlOnline',
  },
  'freelance-arabs': {
    bg: 'bg-[#22C55E]/15',
    text: 'text-[#22C55E]',
    border: 'border-[#22C55E]/30 hover:border-[#22C55E]/70',
    glow: 'hover:shadow-[0_0_30px_rgba(34,197,94,0.18)]',
    name: 'FreelanceArabs',
  },

}

function getPlatformMeta(platform: string) {
  const key = platform.toLowerCase()
  return (
    PLATFORM_COLORS[key] || {
      bg: 'bg-[#6366F1]/15',
      text: 'text-[#6366F1]',
      border: 'border-[#6366F1]/30 hover:border-[#6366F1]/70',
      glow: 'hover:shadow-[0_0_30px_rgba(99,102,241,0.18)]',
      name: platform,
    }
  )
}

function timeAgo(project: LiveProject, now: number): string {
  const time = projectTimestamp(project, now)
  if (time === null) return 'Recently'
  const diffSec = Math.floor((now - time) / 1000)
  if (diffSec < 0) return 'Just now'
  if (diffSec === 0) return 'Just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay}d ago`
}

function highlightMatches(text: string, query: string) {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return text

  const escapedQuery = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escapedQuery})`, 'ig'))

  return parts.map((part, index) =>
    part.toLowerCase() === trimmedQuery.toLowerCase()
      ? <mark key={index} className="rounded-sm bg-yellow-300 px-0.5 text-black">{part}</mark>
      : <span key={index}>{part}</span>,
  )
}

function formatBudget(p: LiveProject): string {
  if (p.budget_min == null && p.budget_max == null) return 'Budget not listed'
  const cur = p.currency ? `${p.currency} ` : '$'
  if (p.budget_min != null && p.budget_max != null && p.budget_min !== p.budget_max) {
    return `${cur}${p.budget_min.toLocaleString()} – ${cur}${p.budget_max.toLocaleString()}`
  }
  const amt = p.budget_min ?? p.budget_max
  return `${cur}${amt?.toLocaleString()}`
}

export function LiveProjectsFeed({ userSkills = [] }: { userSkills?: string[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [projects, setProjects] = useState<LiveProject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [skillsOnly, setSkillsOnly] = useState(false)
  const [savedOnly, setSavedOnly] = useState(false)
  const [savedProjectIds, setSavedProjectIds] = useState<string[]>([])
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [bookmarkError, setBookmarkError] = useState('')
  const [page, setPage] = useState(1)
  const [now, setNow] = useState(() => Date.now())
  const [newProjectIds, setNewProjectIds] = useState<Set<string>>(() => new Set())
  const realtimeProjectIds = useRef(new Set<string>())
  const [selectedProject, setSelectedProject] = useState<LiveProject | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const normalizedUserSkills = useMemo(
    () => userSkills.map((s) => s.trim().toLowerCase()).filter(Boolean),
    [userSkills],
  )

  useEffect(() => {
    const updateClock = () => setNow(Date.now())
    const interval = window.setInterval(updateClock, 15_000)
    window.addEventListener('focus', updateClock)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', updateClock)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadSavedProjects = async () => {
      const { data, error } = await supabase.auth.getUser()
      if (!mounted) return
      if (error) {
        setBookmarkError('Could not load your saved projects.')
        return
      }

      const savedIds = data.user.user_metadata.saved_project_ids
      if (Array.isArray(savedIds)) {
        setSavedProjectIds(savedIds.filter((id): id is string => typeof id === 'string'))
      }
    }
    void loadSavedProjects()

    return () => { mounted = false }
  }, [supabase])

  const fetchProjects = async () => {
    setLoading(true)
    setLoadError('')
    const batchSize = 500
    const allProjects: LiveProject[] = []

    for (let from = 0; ; from += batchSize) {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('posted_at', { ascending: false })
        .range(from, from + batchSize - 1)

      if (error) {
        setLoadError('Could not load projects. Please refresh and try again.')
        setLoading(false)
        return
      }

      allProjects.push(...(data as LiveProject[]))
      if (data.length < batchSize) break
    }

    setProjects((previous) => {
      const fetchedIds = new Set(allProjects.map((project) => project.id))
      const receivedDuringFetch = previous.filter(
        (project) => realtimeProjectIds.current.has(project.id) && !fetchedIds.has(project.id),
      )
      return newestFirst([...allProjects, ...receivedDuringFetch], Date.now())
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchProjects()

    // Realtime Supabase updates
    const channel = supabase
      .channel('realtime_projects')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'projects' },
        (payload) => {
          const project = payload.new as LiveProject
          realtimeProjectIds.current.add(project.id)
          setProjects((prev) => newestFirst([project, ...prev.filter((item) => item.id !== project.id)], Date.now()))
          setNewProjectIds((prev) => new Set(prev).add(project.id))
          setPage(1)
          window.setTimeout(() => {
            setNewProjectIds((prev) => {
              const next = new Set(prev)
              next.delete(project.id)
              return next
            })
          }, 3000)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects' },
        (payload) => {
          setProjects((prev) =>
            newestFirst(
              prev.map((item) => (item.id === payload.new.id ? (payload.new as LiveProject) : item)),
              Date.now(),
            ),
          )
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of projects) {
      const key = p.platform.toLowerCase()
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [projects])

  const filteredProjects = useMemo(() => {
    let list = projects

    if (selectedPlatform !== 'all') {
      list = list.filter((p) => p.platform.toLowerCase() === selectedPlatform.toLowerCase())
    }

    if (savedOnly) {
      list = list.filter((project) => savedProjectIds.includes(project.id))
    }

    if (skillsOnly && normalizedUserSkills.length > 0) {
      list = list.filter((p) =>
        p.skills.some((sk) =>
          normalizedUserSkills.some((uk) => sk.toLowerCase().includes(uk) || uk.includes(sk.toLowerCase())),
        ),
      )
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          p.skills.some((sk) => sk.toLowerCase().includes(q)),
      )
    }

    return list
  }, [projects, selectedPlatform, skillsOnly, savedOnly, savedProjectIds, normalizedUserSkills, search])

  const recommendedProjects = useMemo(() => {
    if (normalizedUserSkills.length === 0) return []

    return projects
      .map((project) => {
        const matchedSkills = project.skills.filter((skill) =>
          normalizedUserSkills.some((userSkill) => skill.trim().toLowerCase() === userSkill),
        )
        const hasRelatedSkill = project.skills.some((skill) =>
          normalizedUserSkills.some((userSkill) => {
            const normalizedSkill = skill.trim().toLowerCase()
            return normalizedSkill.includes(userSkill) || userSkill.includes(normalizedSkill)
          }),
        )
        return { project, matchedSkills, hasRelatedSkill }
      })
      .filter(({ hasRelatedSkill }) => hasRelatedSkill)
      .sort((a, b) => {
        const skillMatchDifference = b.matchedSkills.length - a.matchedSkills.length
        if (skillMatchDifference !== 0) return skillMatchDifference
        return (projectTimestamp(b.project, now) ?? 0) - (projectTimestamp(a.project, now) ?? 0)
      })
      .slice(0, 12)
  }, [projects, normalizedUserSkills, now])

  const pageCount = Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE)
  const currentPage = Math.min(page, Math.max(pageCount, 1))
  const paginatedProjects = useMemo(
    () => filteredProjects.slice((currentPage - 1) * PROJECTS_PER_PAGE, currentPage * PROJECTS_PER_PAGE),
    [filteredProjects, currentPage],
  )

  const copyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleBookmark = async (project: LiveProject) => {
    setBookmarkBusy(true)
    setBookmarkError('')

    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      setBookmarkError('Could not save this project. Please sign in again and retry.')
      setBookmarkBusy(false)
      return
    }

    const existingIds = data.user.user_metadata.saved_project_ids
    const currentIds = Array.isArray(existingIds)
      ? existingIds.filter((id): id is string => typeof id === 'string')
      : []
    const nextIds = currentIds.includes(project.id)
      ? currentIds.filter((id) => id !== project.id)
      : [...currentIds, project.id]
    const { error: saveError } = await supabase.auth.updateUser({
      data: { saved_project_ids: nextIds },
    })

    if (saveError) {
      setBookmarkError('Could not save this project. Please try again.')
    } else {
      setSavedProjectIds(nextIds)
    }
    setBookmarkBusy(false)
  }

  const createBidForProject = (project: LiveProject) => {
    try {
      window.sessionStorage.setItem('go-freelance:pending-bid-project', JSON.stringify({
        title: project.title,
        description: project.description || project.listing_desc || '',
        skills: project.skills ?? [],
      }))
    } catch {
      setBookmarkError('Could not open the AI Bid Maker. Please allow session storage and try again.')
      return
    }

    router.push('/bid')
  }

  return (
    <div className="mt-8">
      {/* Controls Bar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[.025] p-4 backdrop-blur-md lg:flex-row lg:items-center lg:justify-between">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/35" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search projects, skills (e.g. n8n, React, Python, Translation)..."
            className="h-11 w-full rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#6e80ff]"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-1">
            <button
              onClick={() => {
                setSelectedPlatform('all')
                setPage(1)
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                selectedPlatform === 'all'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/50 hover:bg-white/[.05] hover:text-white'
              }`}
            >
              All ({projects.length})
            </button>
            {Object.entries(PLATFORM_COLORS).map(([key, meta]) => {
              const count = platformCounts[key] || 0
              if (count === 0 && selectedPlatform !== key) return null
              return (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedPlatform(key)
                    setPage(1)
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    selectedPlatform === key
                      ? `${meta.bg} ${meta.text} border border-current shadow-sm`
                      : 'text-white/50 hover:bg-white/[.05] hover:text-white'
                  }`}
                >
                  <span>{meta.name}</span>
                  <span className="opacity-60">({count})</span>
                </button>
              )
            })}
          </div>

          {/* User Skills Toggle */}
          {normalizedUserSkills.length > 0 && (
            <button
              onClick={() => {
                setSkillsOnly((v) => !v)
                setPage(1)
              }}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium transition ${
                skillsOnly
                  ? 'border-[#2541FF] bg-[#2541FF]/20 text-[#aeb8ff]'
                  : 'border-white/10 bg-black/30 text-white/55 hover:border-white/20 hover:text-white'
              }`}
            >
              <Sparkles className="size-3.5" />
              <span>Matching My Skills</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSavedOnly((value) => !value)
              setPage(1)
            }}
            aria-pressed={savedOnly}
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium transition ${
              savedOnly
                ? 'border-[#6e80ff] bg-[#2541FF]/20 text-[#aeb8ff]'
                : 'border-white/10 bg-black/30 text-white/55 hover:border-white/20 hover:text-white'
            }`}
          >
            <Bookmark className="size-3.5" />
            <span>Saved ({savedProjectIds.length})</span>
          </button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchProjects}
            disabled={loading}
            className="h-10 border-white/10 bg-black/30 text-white/70 hover:bg-white/5"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mt-4 flex items-center justify-between px-1 text-xs text-white/40">
        <p>
          {savedOnly ? 'Saved projects' : 'Showing'} <span className="font-medium text-white/80">{filteredProjects.length}</span> {savedOnly ? 'bookmarked jobs' : 'live projects'}
          {search ? ` matching "${search}"` : ''}
        </p>
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-[#2bd9a3]" />
          <span>Live Feed</span>
        </div>
      </div>

      {loadError && <p role="alert" className="mt-4 text-sm text-red-300">{loadError}</p>}
      {bookmarkError && <p role="alert" className="mt-3 text-sm text-red-300">{bookmarkError}</p>}
      {savedOnly && (
        <section aria-label="Your bookmarked projects" className="mt-4 rounded-xl border border-[#6e80ff]/20 bg-[#2541FF]/[.06] px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-[#c2caff]">
            <Bookmark className="size-3.5 fill-current" />
            Your saved jobs
            <span className="text-white/40">· {filteredProjects.length}</span>
          </div>
          <p className="mt-1 text-[11px] text-white/40">Bookmarks are saved to your account and stay available when you come back.</p>
        </section>
      )}

      {recommendedProjects.length > 0 && (
        <section className="mt-7" aria-labelledby="recommended-projects-heading">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="recommended-projects-heading" className="text-sm font-medium text-white/85">Recommended for you</h2>
              <p className="mt-1 text-[11px] text-white/40">Projects matched to your profile skills</p>
            </div>
            <span className="text-[10px] text-white/35">{recommendedProjects.length} matches</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recommendedProjects.map(({ project, matchedSkills }) => (
              <a
                key={project.id}
                href={safeProjectUrl(project.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-64 shrink-0 rounded-xl border border-[#6e80ff]/20 bg-[#0a0c16]/80 p-3 transition hover:border-[#6e80ff]/50 hover:bg-[#11152a]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] text-[#aeb8ff]">{getPlatformMeta(project.platform).name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] ${matchedSkills.length > 0 ? 'bg-[#2bd9a3]/10 text-[#65e2be]' : 'bg-white/[.06] text-white/45'}`}>
                    {matchedSkills.length > 0 ? 'Exact skill match' : 'Recommended'}
                  </span>
                </div>
                <p className="mt-2 line-clamp-1 text-xs font-medium text-white/85">{project.title}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/45">
                  <span className="truncate">{matchedSkills.length > 0 ? matchedSkills.join(', ') : project.skills.slice(0, 2).join(', ')}</span>
                  <span className="shrink-0">{formatBudget(project)}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Grid of Projects */}
      {loading && projects.length === 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-2xl border border-white/5 bg-white/[.02] p-5"
            />
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-white/10 bg-white/[.015] p-12 text-center">
          {savedOnly ? <Bookmark className="mx-auto size-8 text-white/20" /> : <Search className="mx-auto size-8 text-white/20" />}
          <h3 className="mt-4 text-base font-medium text-white/80">{savedOnly ? 'No bookmarked projects yet' : 'No projects found'}</h3>
          <p className="mt-1 text-xs text-white/40">{savedOnly ? 'Bookmark a project to keep it here for later.' : 'Try adjusting your search terms or platform filters.'}</p>
          {(search || selectedPlatform !== 'all' || skillsOnly || savedOnly) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('')
                setSelectedPlatform('all')
                setSkillsOnly(false)
                setSavedOnly(false)
                setPage(1)
              }}
              className="mt-5 border-white/10 text-xs"
            >
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedProjects.map((project) => {
            const meta = getPlatformMeta(project.platform)
            const hasSkillMatch =
              normalizedUserSkills.length > 0 &&
              project.skills.some((sk) =>
                normalizedUserSkills.some((uk) => sk.toLowerCase().includes(uk) || uk.includes(sk.toLowerCase())),
              )

            return (
              <div
                key={project.id}
                className={`group relative flex min-w-0 flex-col justify-between rounded-2xl border bg-[#0a0c16]/90 p-4 transition-all duration-300 sm:p-5 md:hover:z-20 md:hover:scale-[1.035] md:hover:shadow-[0_18px_50px_rgba(37,65,255,.2)] md:focus-within:z-20 md:focus-within:scale-[1.02] md:focus-within:shadow-[0_18px_50px_rgba(37,65,255,.2)] ${meta.border} ${meta.glow} ${newProjectIds.has(project.id) ? 'project-enter' : ''}`}
              >
                <div>
                  {/* Top Bar */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${meta.bg} ${meta.text}`}
                    >
                      {meta.name}
                    </span>
                    <div className="flex items-center gap-2">
                      {hasSkillMatch && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#2541FF]/25 px-2 py-0.5 text-[10px] font-semibold text-[#8ba3ff]">
                          <Sparkles className="size-3" /> MATCH
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[11px] text-white/40">
                        <Clock className="size-3" /> {timeAgo(project, now)}
                      </span>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="mobile-project-title mt-3 line-clamp-2 text-base font-medium leading-snug text-white group-hover:line-clamp-none group-focus-within:line-clamp-none">
                    {highlightMatches(project.title, search)}
                  </h3>

                  {/* Description snippet */}
                  <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-white/50">
                    {highlightMatches(project.description || project.listing_desc || 'No description provided.', search)}
                  </p>

                  {/* Skills tags */}
                  {project.skills && project.skills.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5" title={project.skills.join(', ')} aria-label={`All skills: ${project.skills.join(', ')}`}>
                      {project.skills.map((skill, index) => {
                        const isMatch = normalizedUserSkills.some(
                          (uk) => skill.toLowerCase().includes(uk) || uk.includes(skill.toLowerCase()),
                        )
                        return (
                          <span
                            key={skill}
                            className={`inline-block rounded-md px-2 py-1 text-[11px] transition-all duration-300 ${
                              index >= 4 ? 'inline-block md:hidden md:group-hover:inline-block md:group-focus-within:inline-block' : ''
                            } ${isMatch ? 'bg-[#2541FF]/30 font-medium text-[#b5c5ff]' : 'bg-white/[.05] text-white/60'}`}
                          >
                            {highlightMatches(skill, search)}
                          </span>
                        )
                      })}
                      {project.skills.length > 4 && (
                        <span className="hidden rounded-md bg-white/[.04] px-1.5 py-1 text-[10px] text-white/35 md:inline-block md:group-hover:hidden md:group-focus-within:hidden">
                          +{project.skills.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer Bar */}
                <div className="mt-6 flex items-center justify-between border-t border-white/[.07] pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                    <DollarSign className="size-3.5" />
                    <span>{formatBudget(project)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleBookmark(project)}
                      disabled={bookmarkBusy}
                      aria-label={savedProjectIds.includes(project.id) ? 'Remove saved project' : 'Save project'}
                      aria-pressed={savedProjectIds.includes(project.id)}
                      title={savedProjectIds.includes(project.id) ? 'Remove from saved projects' : 'Save project'}
                      className={`inline-flex size-8 items-center justify-center rounded-lg border transition disabled:cursor-wait disabled:opacity-50 ${
                        savedProjectIds.includes(project.id)
                          ? 'border-[#6e80ff]/40 bg-[#2541FF]/20 text-[#aeb8ff]'
                          : 'border-white/10 bg-white/[.03] text-white/55 hover:border-white/30 hover:text-white'
                      }`}
                    >
                      <Bookmark className={`size-3.5 ${savedProjectIds.includes(project.id) ? 'fill-current' : ''}`} />
                    </button>
                    <a
                      href={safeProjectUrl(project.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.03] px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/30 hover:bg-white/[.08] hover:text-white"
                    >
                      <span>Apply</span>
                      <ExternalLink className="size-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => createBidForProject(project)}
                      aria-label={`Generate an AI bid for ${project.title}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#6e80ff]/25 bg-[#2541FF]/10 px-3 py-1.5 text-xs font-medium text-[#b5c5ff] transition hover:border-[#6e80ff]/50 hover:bg-[#2541FF]/20"
                    >
                      <Sparkles className="size-3" />
                      <span>AI Bid</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          </div>
          {pageCount > 1 && (
            <nav aria-label="Project pages" className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 transition hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft className="size-3.5" /> Previous
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setPage(pageNumber)}
                  aria-label={`Page ${pageNumber}`}
                  aria-current={currentPage === pageNumber ? 'page' : undefined}
                  className={`size-9 rounded-lg border text-xs transition ${
                    currentPage === pageNumber
                      ? 'border-[#6e80ff] bg-[#2541FF]/25 text-white'
                      : 'border-white/10 text-white/55 hover:bg-white/[.06] hover:text-white'
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage === pageCount}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 transition hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-35"
              >
                Next <ChevronRight className="size-3.5" />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
