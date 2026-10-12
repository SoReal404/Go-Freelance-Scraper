'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  Search,
  ExternalLink,
  Sparkles,
  Clock,
  DollarSign,
  Filter,
  CheckCircle2,
  Lock,
  Flame,
  Globe,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
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
  details_enriched: boolean
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
  upwork: {
    bg: 'bg-[#14A800]/15',
    text: 'text-[#14A800]',
    border: 'border-[#14A800]/30 hover:border-[#14A800]/70',
    glow: 'hover:shadow-[0_0_30px_rgba(20,168,0,0.18)]',
    name: 'Upwork',
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

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Recently'
  const time = new Date(dateStr).getTime()
  if (isNaN(time)) return 'Recently'
  const diffSec = Math.floor((Date.now() - time) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay}d ago`
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
  const supabase = createClient()
  const [projects, setProjects] = useState<LiveProject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [skillsOnly, setSkillsOnly] = useState(false)
  const [selectedProject, setSelectedProject] = useState<LiveProject | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const normalizedUserSkills = useMemo(
    () => userSkills.map((s) => s.trim().toLowerCase()).filter(Boolean),
    [userSkills],
  )

  const fetchProjects = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('posted_at', { ascending: false })
      .limit(200)

    if (!error && data) {
      setProjects(data as LiveProject[])
    }
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
          setProjects((prev) => [payload.new as LiveProject, ...prev])
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects' },
        (payload) => {
          setProjects((prev) =>
            prev.map((item) => (item.id === payload.new.id ? (payload.new as LiveProject) : item)),
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
  }, [projects, selectedPlatform, skillsOnly, normalizedUserSkills, search])

  const copyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects, skills (e.g. n8n, React, Python, Translation)..."
            className="h-11 w-full rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#6e80ff]"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-1">
            <button
              onClick={() => setSelectedPlatform('all')}
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
                  onClick={() => setSelectedPlatform(key)}
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
              onClick={() => setSkillsOnly((v) => !v)}
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
          Showing <span className="font-medium text-white/80">{filteredProjects.length}</span> live projects
          {search ? ` matching "${search}"` : ''}
        </p>
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-[#2bd9a3]" />
          <span>Live Feed</span>
        </div>
      </div>

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
          <Search className="mx-auto size-8 text-white/20" />
          <h3 className="mt-4 text-base font-medium text-white/80">No projects found</h3>
          <p className="mt-1 text-xs text-white/40">Try adjusting your search terms or platform filters.</p>
          {(search || selectedPlatform !== 'all' || skillsOnly) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('')
                setSelectedPlatform('all')
                setSkillsOnly(false)
              }}
              className="mt-5 border-white/10 text-xs"
            >
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => {
            const meta = getPlatformMeta(project.platform)
            const hasSkillMatch =
              normalizedUserSkills.length > 0 &&
              project.skills.some((sk) =>
                normalizedUserSkills.some((uk) => sk.toLowerCase().includes(uk) || uk.includes(sk.toLowerCase())),
              )

            return (
              <div
                key={project.id}
                className={`group relative flex flex-col justify-between rounded-2xl border bg-[#0a0c16]/90 p-5 transition-all duration-300 ${meta.border} ${meta.glow}`}
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
                        <Clock className="size-3" /> {timeAgo(project.posted_at)}
                      </span>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="mt-3 line-clamp-2 text-base font-medium leading-snug text-white group-hover:text-white">
                    {project.title}
                  </h3>

                  {/* Description snippet */}
                  <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-white/50">
                    {project.description || project.listing_desc || 'No description provided.'}
                  </p>

                  {/* Skills tags */}
                  {project.skills && project.skills.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {project.skills.slice(0, 4).map((skill) => {
                        const isMatch = normalizedUserSkills.some(
                          (uk) => skill.toLowerCase().includes(uk) || uk.includes(skill.toLowerCase()),
                        )
                        return (
                          <span
                            key={skill}
                            className={`rounded-md px-2 py-1 text-[11px] transition ${
                              isMatch
                                ? 'bg-[#2541FF]/30 font-medium text-[#b5c5ff]'
                                : 'bg-white/[.05] text-white/60'
                            }`}
                          >
                            {skill}
                          </span>
                        )
                      })}
                      {project.skills.length > 4 && (
                        <span className="rounded-md bg-white/[.04] px-1.5 py-1 text-[10px] text-white/35">
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
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.03] px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/30 hover:bg-white/[.08] hover:text-white"
                    >
                      <span>Apply</span>
                      <ExternalLink className="size-3" />
                    </a>
                    <button
                      disabled
                      title="AI Bid Maker is coming soon!"
                      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-medium text-white/40 opacity-75"
                    >
                      <Lock className="size-3 text-white/40" />
                      <span>AI Bid (Soon)</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
