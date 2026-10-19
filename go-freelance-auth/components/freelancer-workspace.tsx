'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Flame, Menu, Plus, Search, Trash2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { LiveProjectsFeed } from '@/components/live-projects-feed'
import {
  getRecentActivity,
  recordDailyActivity,
  getUtcDateKey,
  readWorkspace,
  type FreelancerProfile,
  type FreelancerProject,
  type FreelancerWorkspace,
} from '@/lib/freelancer-profile'

const emptyWorkspace: FreelancerWorkspace = {
  fullName: '',
  profiles: [],
  activeProfileId: '',
  activityDates: [],
  streakCount: 0,
  lastActivityDate: '',
}

const skillCatalog = [
  '3D Modeling', 'A/B Testing', 'Accessibility', 'Adobe After Effects', 'Adobe Illustrator',
  'Adobe InDesign', 'Adobe Photoshop', 'Adobe Premiere Pro', 'AI Agents', 'AI Automation',
  'AI Content Creation', 'AI Integration', 'Amazon Web Services (AWS)', 'Angular', 'API Development',
  'API Integration', 'App Development', 'Automation', 'AWS Lambda', 'Azure', 'Bash', 'Blender',
  'Brand Identity', 'C#', 'C++', 'Canva', 'Chatbot Development', 'CI/CD', 'Cloud Computing',
  'Content Marketing', 'Content Writing', 'Conversion Rate Optimization', 'Copywriting', 'CSS',
  'Cybersecurity', 'Data Analysis', 'Data Engineering', 'Data Entry', 'Data Science', 'Django',
  'Docker', 'E-commerce', 'Email Marketing', 'Express.js', 'Figma', 'Firebase', 'Flask', 'Flutter',
  'Framer', 'GCP', 'Generative AI', 'Git', 'Go', 'Google Ads', 'Graphic Design', 'GraphQL',
  'HubSpot', 'HTML', 'Illustration', 'Java', 'JavaScript', 'Jest', 'Kotlin', 'Kubernetes',
  'Landing Pages', 'Laravel', 'Lead Generation', 'LinkedIn Marketing', 'LLM Integration',
  'Logo Design', 'Machine Learning', 'Make.com', 'Marketing Automation', 'Market Research',
  'Microsoft Azure', 'Microsoft Excel', 'Microsoft Power BI', 'Mobile App Design', 'MongoDB',
  'Motion Graphics', 'MySQL', 'Next.js', 'NLP', 'Node.js', 'No-Code Development', 'n8n',
  'OpenAI API', 'PHP', 'PostgreSQL', 'Presentation Design', 'Product Design', 'Product Management',
  'Prompt Engineering', 'Python', 'PyTorch', 'Quality Assurance', 'React', 'React Native',
  'Redis', 'REST API', 'Ruby', 'Ruby on Rails', 'SaaS', 'Salesforce', 'Search Engine Optimization',
  'Shopify', 'Social Media Marketing', 'Software Testing', 'SQL', 'Supabase', 'Swift', 'Tailwind CSS',
  'Technical Writing', 'TensorFlow', 'TypeScript', 'UI Design', 'UX Design', 'Video Editing',
  'Vue.js', 'Web Design', 'Web Development', 'Web Scraping', 'Webflow', 'Webhooks', 'WordPress',
  'Workflow Automation', 'Zapier',
]

function SkillPicker({
  skills,
  onChange,
  label = 'Skills',
  placeholder = 'Search skills, e.g. n8n, Python, UI design…',
}: {
  skills: string[]
  onChange: (skills: string[]) => void
  label: string
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const suggestions = normalizedQuery
    ? skillCatalog.filter((skill) =>
        skill.toLocaleLowerCase().includes(normalizedQuery)
        && !skills.some((selected) => selected.toLocaleLowerCase() === skill.toLocaleLowerCase()),
      ).slice(0, 8)
    : skillCatalog.filter((skill) =>
        !skills.some((selected) => selected.toLocaleLowerCase() === skill.toLocaleLowerCase()),
      ).slice(0, 8)
  const canAddCustom = Boolean(normalizedQuery)
    && !skills.some((skill) => skill.toLocaleLowerCase() === normalizedQuery)
    && !skillCatalog.some((skill) => skill.toLocaleLowerCase() === normalizedQuery)

  const addSkill = (skill: string) => {
    const cleaned = skill.trim()
    if (cleaned && !skills.some((selected) => selected.toLocaleLowerCase() === cleaned.toLocaleLowerCase())) {
      onChange([...skills, cleaned])
    }
    setQuery('')
    setOpen(true)
  }

  return (
    <div>
      <label className="text-sm text-white/70">{label}</label>
      <div className="mt-2 flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 focus-within:border-[#6e80ff]">
        {skills.map((skill) => (
          <span key={skill} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2541FF]/20 px-2.5 py-1.5 text-xs text-[#c1caff]">
            {skill}
            <button type="button" aria-label={`Remove ${skill}`} onClick={() => onChange(skills.filter((item) => item !== skill))} className="text-white/55 hover:text-white">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-0 top-1/2 size-4 -translate-y-1/2 text-white/35" />
          <input
            className="h-8 w-full bg-transparent pl-6 text-sm text-white outline-none placeholder:text-white/35"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (canAddCustom || suggestions.length)) {
                event.preventDefault()
                addSkill(canAddCustom ? query : suggestions[0])
              }
              if (event.key === 'Escape') setOpen(false)
            }}
            role="combobox"
            aria-label={`Search ${label.toLowerCase()}`}
            aria-expanded={open}
            aria-controls={`skill-options-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            aria-autocomplete="list"
            placeholder={placeholder}
          />
        </div>
      </div>
      {open && (suggestions.length > 0 || canAddCustom) && <div
        id={`skill-options-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        role="listbox"
        aria-label={`${label} suggestions`}
        className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#10121d] p-2 shadow-xl"
      >
        {suggestions.map((skill) => <button
          key={skill}
          type="button"
          role="option"
          aria-selected="false"
          onClick={() => addSkill(skill)}
          className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[.08] hover:text-white"
        >{skill}</button>)}
        {canAddCustom && <button
          type="button"
          onClick={() => addSkill(query)}
          className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-white/[.08] px-3 py-3 text-left text-sm text-[#aeb8ff] hover:bg-white/[.05]"
        ><Plus className="size-4" /> Add custom skill “{query.trim()}”</button>}
      </div>}
      <p className="mt-2 text-xs text-white/35">Search and select skills, or add your own. Choose as many as you need.</p>
    </div>
  )
}

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [name, setName] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) return
      if (mounted) {
        const metadataName = data.user.user_metadata.full_name
        setName(typeof metadataName === 'string' ? metadataName : data.user.email ?? '')
      }
    })
    return () => { mounted = false }
  }, [supabase])

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) return
    window.location.assign('/')
  }

  return (
    <div className="min-h-screen bg-[#05050a] text-white">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-y-3 border-b border-white/[.07] px-4 py-3 sm:px-5 md:h-20 md:flex-nowrap md:px-10 md:py-0">
        <a href="/dashboard" className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-[#2541FF]"><Zap className="size-4 fill-current" /></span>
          GO <span className="text-[#6f82ff]">Freelance</span>
        </a>
        <nav aria-label="Workspace navigation" className="hidden items-center gap-4 text-sm text-white/60 md:flex">
          <a href="/dashboard" className="hover:text-white">Dashboard</a>
          <a href="/profile" className="hover:text-white">Profile</a>
          <span className="hidden max-w-48 truncate text-white/35 lg:block">{name}</span>
          <button onClick={signOut} className="hover:text-white">Sign out</button>
        </nav>
        <button
          type="button"
          className="grid size-9 place-items-center rounded-lg border border-white/10 text-white md:hidden"
          aria-label={mobileMenuOpen ? 'Close workspace navigation' : 'Open workspace navigation'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
        {mobileMenuOpen && <nav aria-label="Mobile workspace navigation" className="flex w-full flex-col gap-1 border-t border-white/[.07] pt-2 text-sm text-white/65 md:hidden">
          <a href="/dashboard" className="rounded-lg px-3 py-3 hover:bg-white/[.06] hover:text-white">Dashboard</a>
          <a href="/profile" className="rounded-lg px-3 py-3 hover:bg-white/[.06] hover:text-white">Profile</a>
          {name && <span className="px-3 py-2 text-xs text-white/35">{name}</span>}
          <button onClick={signOut} className="rounded-lg px-3 py-3 text-left hover:bg-white/[.06] hover:text-white">Sign out</button>
        </nav>}
      </header>
      <main>{children}</main>
    </div>
  )
}

function saveWorkspace(
  supabase: ReturnType<typeof createClient>,
  metadata: Record<string, unknown>,
  workspace: FreelancerWorkspace,
) {
  return supabase.auth.updateUser({
    data: {
      ...metadata,
      full_name: workspace.fullName,
      freelancer_profiles: workspace.profiles,
      active_freelancer_profile_id: workspace.activeProfileId,
      freelancer_activity_dates: workspace.activityDates,
      freelancer_streak_count: workspace.streakCount,
      freelancer_last_activity_date: workspace.lastActivityDate,
    },
  })
}

export function FreelancerOnboarding() {
  const supabase = createClient()
  const [fullName, setFullName] = useState('')
  const [title, setTitle] = useState('')
  const [overview, setOverview] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data, error: userError }) => {
      if (!mounted) return
      if (userError) {
        setError('Could not load your account. Please sign in again.')
        return
      }
      const metadata = data.user.user_metadata
      const workspace = readWorkspace(metadata)
      setFullName(workspace.fullName || (typeof metadata.name === 'string' ? metadata.name : ''))
      const firstProfile = workspace.profiles[0]
      if (firstProfile) {
        setTitle(firstProfile.title)
        setOverview(firstProfile.overview)
        setSkills(firstProfile.skills)
      }
    })
    return () => { mounted = false }
  }, [supabase])

  const finish = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selectedSkills = [...new Set(skills)]
    if (!fullName.trim() || !title.trim() || selectedSkills.length === 0) {
      setError('Add your name, a profile title, and at least one skill to continue.')
      return
    }

    setBusy(true)
    setError('')
    const { data, error: userError } = await supabase.auth.getUser()
    if (userError) {
      setBusy(false)
      setError('We could not load your account. Please sign in again.')
      return
    }

    const workspace = readWorkspace(data.user.user_metadata)
    const profile = workspace.profiles[0] ?? {
      id: crypto.randomUUID(),
      title: title.trim(),
      overview: overview.trim(),
      skills: selectedSkills,
      projects: [],
    }
    const profiles = workspace.profiles.length
      ? workspace.profiles.map((item) => item.id === profile.id
          ? { ...item, title: title.trim(), overview: overview.trim(), skills: selectedSkills }
          : item)
      : [profile]
    const { error: saveError } = await supabase.auth.updateUser({
      data: {
        ...data.user.user_metadata,
        full_name: fullName.trim(),
        freelancer_profiles: profiles,
        active_freelancer_profile_id: profile.id,
        freelancer_activity_dates: workspace.activityDates,
        freelancer_streak_count: workspace.streakCount,
        freelancer_last_activity_date: workspace.lastActivityDate,
        onboarding_completed: true,
      },
    })
    setBusy(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    window.location.assign('/dashboard')
  }

  return (
    <WorkspaceShell>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-5 sm:py-16">
        <p className="text-xs uppercase tracking-[.2em] text-[#8290ff]">Set up your workspace</p>
        <h1 className="mt-3 text-3xl font-medium sm:text-4xl">Tell us what you do.</h1>
        <p className="mt-3 text-sm leading-6 text-white/50">Your profile is used to personalize your workspace. You can add separate profiles for different specialties later.</p>
        <form onSubmit={finish} className="mt-8 flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/[.025] p-4 sm:p-6 md:p-8">
          <label className="flex flex-col gap-2 text-sm text-white/70">Your name
            <input className="input" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/70">Your first profile
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="n8n automation specialist, machine learning engineer…" required />
          </label>
          <label className="flex flex-col gap-2 text-sm text-white/70">About your work
            <textarea className="input min-h-28" value={overview} onChange={(event) => setOverview(event.target.value)} placeholder="What kind of work do you do, and what makes your approach different?" />
          </label>
          <SkillPicker skills={skills} onChange={setSkills} label="Your skills" />
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <Button type="submit" disabled={busy} className="h-12 bg-[#2541FF] text-white">
            {busy ? 'Saving profile…' : 'Save profile and continue'} <ArrowRight data-icon="inline-end" />
          </Button>
        </form>
      </div>
    </WorkspaceShell>
  )
}

export function FreelancerDashboard() {
  const supabase = createClient()
  const [workspace, setWorkspace] = useState(emptyWorkspace)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const loadAndRecordActivity = async () => {
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError) {
        if (mounted) { setError('Could not load your workspace. Please refresh the page.'); setLoading(false) }
        return
      }

      const current = readWorkspace(data.user.user_metadata)
      const next = recordDailyActivity(current, getUtcDateKey())
      if (next.lastActivityDate !== current.lastActivityDate || next.activityDates.length !== current.activityDates.length) {
        const { error: saveError } = await saveWorkspace(supabase, data.user.user_metadata, next)
        if (saveError) {
          if (mounted) { setError('Could not record today’s activity. Please refresh to try again.'); setLoading(false) }
          return
        }
      }
      if (mounted) { setWorkspace(next); setLoading(false) }
    }
    void loadAndRecordActivity()
    return () => { mounted = false }
  }, [supabase])

  const activeProfile = workspace.profiles.find((profile) => profile.id === workspace.activeProfileId)
  const streak = workspace.streakCount
  const activity = getRecentActivity(workspace.activityDates)

  return (
    <WorkspaceShell>
      <div className="mx-auto max-w-7xl px-5 py-10">
        <p className="text-xs uppercase tracking-[.2em] text-[#8290ff]">
          {new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Welcome back{workspace.fullName ? `, ${workspace.fullName}` : ''}.</h1>
            <p className="mt-2 text-sm text-white/45">{activeProfile ? `Your active profile: ${activeProfile.title}` : 'Your freelancer workspace'}</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-orange-400/20 bg-orange-400/10 px-4 py-3">
            <Flame className="size-5 fill-orange-300 text-orange-300" />
            <div>
              <p className="text-lg font-semibold text-orange-100">{loading ? '…' : `${streak} ${streak === 1 ? 'day' : 'days'}`}</p>
              <p className="text-[10px] text-orange-200/55">daily streak</p>
            </div>
          </div>
        </div>
        {error && <p role="alert" className="mt-6 text-sm text-red-300">{error}</p>}
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-medium">Your activity</h2><p className="mt-1 text-sm text-white/40">Visit your dashboard to keep your streak going.</p></div>
            <a href="/profile" className="text-sm text-[#aeb8ff] hover:text-white">Manage profile <ArrowRight className="ml-1 inline size-4" /></a>
          </div>
          <div className="mt-5 grid grid-cols-7 gap-2 sm:grid-cols-14">
            {activity.map((active, index) => <span key={index} title={`${28 - index} days ago`} className={`aspect-square rounded ${active ? 'bg-[#5268ff]' : 'bg-white/[.07]'}`} />)}
          </div>
        </section>
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-6">
          <h2 className="text-lg font-medium">Your profile skills</h2>
          {activeProfile?.skills.length
            ? <div className="mt-4 flex flex-wrap gap-2">{activeProfile.skills.map((skill) => <span key={skill} className="rounded-lg bg-[#2541FF]/15 px-3 py-2 text-xs text-[#aeb8ff]">{skill}</span>)}</div>
            : <p className="mt-3 text-sm text-white/40">Add skills to your profile to help personalize your workspace.</p>}
        </section>

        {/* Live Scraped Projects Feed from Supabase */}
        <LiveProjectsFeed userSkills={activeProfile?.skills || []} />
      </div>
    </WorkspaceShell>
  )
}

export function FreelancerProfilePage() {
  const supabase = createClient()
  const [workspace, setWorkspace] = useState(emptyWorkspace)
  const [profile, setProfile] = useState<FreelancerProfile | null>(null)
  const [projectDraft, setProjectDraft] = useState<FreelancerProject | null>(null)
  const [newProfileTitle, setNewProfileTitle] = useState('')
  const [addingProfile, setAddingProfile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: userError } = await supabase.auth.getUser()
    if (userError) { setError('Could not load your profile. Please refresh the page.'); return }
    const loaded = readWorkspace(data.user.user_metadata)
    setWorkspace(loaded)
    setProfile(loaded.profiles.find((item) => item.id === loaded.activeProfileId) ?? null)
    setError('')
  }, [supabase])

  useEffect(() => { void load() }, [load])

  const persist = async (nextWorkspace: FreelancerWorkspace) => {
    setBusy(true)
    setError('')
    setMessage('')
    const { data, error: userError } = await supabase.auth.getUser()
    if (userError) { setError('Could not verify your account. Please sign in again.'); setBusy(false); return false }
    const { error: saveError } = await saveWorkspace(supabase, data.user.user_metadata, nextWorkspace)
    setBusy(false)
    if (saveError) { setError(saveError.message); return false }
    setWorkspace(nextWorkspace)
    setProfile(nextWorkspace.profiles.find((item) => item.id === nextWorkspace.activeProfileId) ?? null)
    setMessage('Changes saved.')
    return true
  }

  const selectProfile = async (id: string) => {
    const profiles = profile
      ? workspace.profiles.map((item) => item.id === profile.id ? profile : item)
      : workspace.profiles
    await persist({ ...workspace, profiles, activeProfileId: id })
  }

  const addProfile = async () => {
    const title = newProfileTitle.trim()
    if (!title) { setError('Add a title for your new profile.'); return }
    const newProfile: FreelancerProfile = { id: crypto.randomUUID(), title, overview: '', skills: [], projects: [] }
    const profiles = profile
      ? workspace.profiles.map((item) => item.id === profile.id ? profile : item)
      : workspace.profiles
    const saved = await persist({ ...workspace, profiles: [...profiles, newProfile], activeProfileId: newProfile.id })
    if (saved) {
      setNewProfileTitle('')
      setAddingProfile(false)
    }
  }

  const saveProfile = async () => {
    if (!profile?.title.trim()) { setError('Add a title to this profile before saving.'); return }
    await persist({ ...workspace, profiles: workspace.profiles.map((item) => item.id === profile.id ? profile : item) })
  }

  const saveProject = async () => {
    if (!profile || !projectDraft?.title.trim()) { setError('Add a project title before saving.'); return }
    const projects = projectDraft.id
      ? profile.projects.map((project) => project.id === projectDraft.id ? projectDraft : project)
      : [...profile.projects, { ...projectDraft, id: crypto.randomUUID() }]
    const updatedProfile = { ...profile, projects }
    const saved = await persist({
      ...workspace,
      profiles: workspace.profiles.map((item) => item.id === profile.id ? updatedProfile : item),
    })
    if (saved) {
      setProjectDraft(null)
      setError('')
    }
  }

  return (
    <WorkspaceShell>
      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-5 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[.2em] text-[#8290ff]">Freelancer workspace</p><h1 className="mt-2 text-3xl font-medium">Your profiles</h1><p className="mt-2 text-sm text-white/45">Keep separate skills and projects for each specialty.</p></div>
          <Button onClick={() => setAddingProfile((open) => !open)} disabled={busy} className="w-full bg-[#2541FF] text-white sm:w-auto"><Plus data-icon="inline-start" /> Add specialized profile</Button>
        </div>

        {addingProfile && <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void addProfile() }}>
          <input className="input" value={newProfileTitle} onChange={(event) => setNewProfileTitle(event.target.value)} placeholder="e.g. Machine learning engineer" aria-label="New profile title" />
          <Button type="submit" disabled={busy} className="bg-[#2541FF] text-white">Create</Button>
          <Button type="button" onClick={() => setAddingProfile(false)} variant="ghost" className="text-white/60">Cancel</Button>
        </form>}

        <div className="mt-7 flex flex-wrap gap-2">
          {workspace.profiles.map((item) => <button key={item.id} onClick={() => void selectProfile(item.id)} disabled={busy} className={`rounded-full border px-4 py-2 text-sm ${item.id === profile?.id ? 'border-[#6e80ff] bg-[#2541FF]/20 text-white' : 'border-white/10 text-white/50'}`}>{item.title}</button>)}
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-lg font-medium">Daily streak</h2><p className="mt-1 text-sm text-white/40">Activity is counted once per UTC day when you visit your dashboard.</p></div>
            <p className="text-3xl font-semibold text-orange-200">{workspace.streakCount} <span className="text-sm font-normal text-white/40">days</span></p>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-2 sm:grid-cols-14">
            {getRecentActivity(workspace.activityDates).map((active, index) => <span key={index} title={`${27 - index} days ago`} className={`aspect-square rounded ${active ? 'bg-[#5268ff]' : 'bg-white/[.07]'}`} />)}
          </div>
        </section>

        {error && !profile && <p role="alert" className="mt-6 text-sm text-red-300">{error}</p>}
        {profile ? <>
          <section className="mt-6 flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-6">
            <h2 className="text-lg font-medium">Profile details</h2>
            <label className="flex flex-col gap-2 text-sm text-white/65">Profile title
              <input className="input" value={profile.title} onChange={(event) => setProfile({ ...profile, title: event.target.value })} />
            </label>
            <label className="flex flex-col gap-2 text-sm text-white/65">About this specialty
              <textarea className="input min-h-28" value={profile.overview} onChange={(event) => setProfile({ ...profile, overview: event.target.value })} placeholder="Describe your experience and the work you want to do." />
            </label>
            <SkillPicker
              skills={profile.skills}
              onChange={(skills) => setProfile({ ...profile, skills })}
              label="Skills for this profile"
            />
          </section>

          <section className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-6">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-lg font-medium">Projects</h2><p className="mt-1 text-sm text-white/40">Show work you have completed for this specialty.</p></div><Button onClick={() => setProjectDraft({ id: '', title: '', description: '', url: '', skills: [] })} variant="outline" className="w-full border-white/15 text-white sm:w-auto"><Plus data-icon="inline-start" /> Add project</Button></div>
            {profile.projects.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-2">{profile.projects.map((project) => <article key={project.id} className="rounded-xl border border-white/10 p-4"><div className="flex justify-between gap-3"><h3 className="font-medium">{project.title}</h3><div className="flex gap-2"><button aria-label={`Edit ${project.title}`} onClick={() => setProjectDraft({ ...project })} className="text-xs text-[#aeb8ff]">Edit</button><button aria-label={`Remove ${project.title}`} onClick={() => setProfile({ ...profile, projects: profile.projects.filter((item) => item.id !== project.id) })}><Trash2 className="size-4 text-white/40" /></button></div></div>{project.description && <p className="mt-2 text-sm text-white/45">{project.description}</p>}{project.url && <a href={project.url} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-[#aeb8ff]">{project.url}</a>}{project.skills.length > 0 && <p className="mt-3 text-xs text-white/40">{project.skills.join(' · ')}</p>}</article>)}</div>}
            {projectDraft && <div className="mt-5 grid gap-3 rounded-xl border border-[#5268ff]/30 p-4">
              <label className="flex flex-col gap-2 text-sm text-white/65">Project title<input className="input" value={projectDraft.title} onChange={(event) => setProjectDraft({ ...projectDraft, title: event.target.value })} /></label>
              <label className="flex flex-col gap-2 text-sm text-white/65">Description<textarea className="input min-h-20" value={projectDraft.description} onChange={(event) => setProjectDraft({ ...projectDraft, description: event.target.value })} /></label>
              <label className="flex flex-col gap-2 text-sm text-white/65">Project link<input className="input" type="url" value={projectDraft.url} onChange={(event) => setProjectDraft({ ...projectDraft, url: event.target.value })} placeholder="https://" /></label>
              <SkillPicker
                skills={projectDraft.skills}
                onChange={(skills) => setProjectDraft({ ...projectDraft, skills })}
                label="Skills used in this project"
              />
              <div className="flex gap-2"><Button onClick={() => void saveProject()} disabled={busy} className="bg-[#2541FF] text-white">Save project</Button><Button onClick={() => setProjectDraft(null)} variant="ghost" className="text-white/60">Cancel</Button></div>
            </div>}
          </section>
          <div className="mt-5 flex items-center gap-4">{message && <p role="status" className="text-sm text-[#65e2be]">{message}</p>}{error && <p role="alert" className="text-sm text-red-300">{error}</p>}<Button onClick={() => void saveProfile()} disabled={busy} className="ml-auto bg-[#2541FF] text-white">{busy ? 'Saving…' : 'Save profile changes'}</Button></div>
        </> : <p className="mt-8 rounded-xl border border-white/10 p-6 text-sm text-white/55">{workspace.profiles.length ? 'Select a profile above.' : 'Create your first specialized profile to get started.'}</p>}
      </div>
    </WorkspaceShell>
  )
}
