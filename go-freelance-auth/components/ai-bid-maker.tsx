'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Check, Copy, Sparkles, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { readWorkspace, type FreelancerWorkspace } from '@/lib/freelancer-profile'

type AIBidMakerProps = {
  onNavigate: (page: string) => void
}

const emptyWorkspace: FreelancerWorkspace = {
  fullName: '',
  profiles: [],
  activeProfileId: '',
  activityDates: [],
  streakCount: 0,
  lastActivityDate: '',
}

export function AIBidMaker({ onNavigate }: AIBidMakerProps) {
  const [workspace, setWorkspace] = useState(emptyWorkspace)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skills, setSkills] = useState('')
  const [notes, setNotes] = useState('')
  const [language, setLanguage] = useState<'en' | 'ar'>('en')
  const [proposal, setProposal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let mounted = true
    const supabase = createClient()

    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (!mounted) return
      if (userError) {
        setProfileError('Could not load your profile. Please refresh the page.')
      } else if (!data.user) {
        setProfileError('Please sign in again to load your profile.')
      } else {
        setWorkspace(readWorkspace(data.user.user_metadata))
      }
      setProfileLoading(false)
    })

    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const storageKey = 'go-freelance:pending-bid-project'
    let pendingProject: string | null
    try {
      pendingProject = window.sessionStorage.getItem(storageKey)
      if (pendingProject) window.sessionStorage.removeItem(storageKey)
    } catch {
      setError('Could not load the selected project. Enter its details manually and try again.')
      return
    }
    if (!pendingProject) return

    try {
      const value: unknown = JSON.parse(pendingProject)
      if (
        typeof value !== 'object'
        || value === null
        || !('title' in value)
        || typeof value.title !== 'string'
        || !('description' in value)
        || typeof value.description !== 'string'
        || !('skills' in value)
        || !Array.isArray(value.skills)
        || !value.skills.every((skill) => typeof skill === 'string')
      ) {
        setError('Could not read the selected project details. Enter them manually and try again.')
        return
      }

      setTitle(value.title)
      setDescription(value.description)
      setSkills(value.skills.join(', '))
      setProposal('')
      setError('')
    } catch {
      setError('Could not read the selected project details. Enter them manually and try again.')
    }
  }, [])

  const generateBid = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          skills: skills.split(/[,\n]/).map((skill) => skill.trim()).filter(Boolean),
          language,
          notes,
        }),
      })
      const result: unknown = await response.json()
      if (!response.ok || typeof result !== 'object' || result === null || !('proposal' in result) || typeof result.proposal !== 'string') {
        const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'Could not generate a bid. Please try again.'
        setError(message)
        return
      }
      setProposal(result.proposal)
    } catch {
      setError('Could not connect to the bid service. Please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const copyProposal = async () => {
    try {
      await navigator.clipboard.writeText(proposal)
      setNotice('Bid copied to clipboard.')
      setError('')
    } catch {
      setError('Could not copy the bid. Select and copy the text manually.')
      setNotice('')
    }
  }

  const profileSkills = [...new Set(workspace.profiles.flatMap((profile) => profile.skills))]
  const projectCount = workspace.profiles.reduce((total, profile) => total + profile.projects.length, 0)

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 text-white md:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <div className="robot mx-auto"><div className="robot-eye left"/><div className="robot-eye right"/><div className="robot-mouth"/></div>
          <p className="eyebrow mt-6">Your unfair advantage</p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight md:text-5xl">Write a bid that sounds like <span className="text-gradient">you.</span></h1>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-white/45">Gemini uses your complete project brief and every saved freelancer profile, skill, and portfolio project to write a grounded proposal.</p>
          <div className="mt-7 inline-flex rounded-xl border border-white/10 bg-white/[.04] p-1" aria-label="Bid language">
            <button type="button" onClick={() => setLanguage('en')} aria-pressed={language === 'en'} className={`rounded-lg px-4 py-2 text-xs transition ${language === 'en' ? 'bg-white text-[#0b0d18]' : 'text-white/45'}`}>English</button>
            <button type="button" onClick={() => setLanguage('ar')} aria-pressed={language === 'ar'} className={`rounded-lg px-4 py-2 text-xs transition ${language === 'ar' ? 'bg-white text-[#0b0d18]' : 'text-white/45'}`}>Arabic · عربي</button>
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-[1fr_.8fr]">
          <form onSubmit={generateBid} className="rounded-2xl border border-white/10 bg-white/[.025] p-5 sm:p-6">
            <p className="text-sm font-medium">Project details</p>
            <div className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm text-white/65">Project title
                <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Enter the full project title" required maxLength={500} />
              </label>
              <label className="flex flex-col gap-2 text-sm text-white/65">Full project description
                <textarea className="input min-h-40" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Paste the complete project description so Gemini can respond to the exact requirements." required maxLength={30_000} />
              </label>
              <label className="flex flex-col gap-2 text-sm text-white/65">Required skills
                <input className="input" value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Separate skills with commas, e.g. React, TypeScript, UI design" />
              </label>
              <label className="flex flex-col gap-2 text-sm text-white/65">Notes for Gemini <span className="text-xs text-white/35">(optional)</span>
                <textarea className="input min-h-24" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Tone, approach, or specific points to mention" maxLength={3_000} />
              </label>
            </div>
            {profileError && <p role="alert" className="mt-4 text-sm text-red-300">{profileError}</p>}
            {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
            <Button type="submit" disabled={busy || profileLoading || Boolean(profileError)} className="mt-5 h-12 w-full bg-[#2541FF] text-white hover:bg-[#3651ff]">
              {busy ? 'Writing your bid…' : proposal ? 'Generate another bid' : 'Generate bid'}
              <Sparkles data-icon="inline-end" />
            </Button>
          </form>

          <aside className="rounded-2xl border border-[#5268ff]/20 bg-gradient-to-b from-[#11183d] to-[#0b0d18] p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-xl bg-[#2541FF]/20"><UserRound className="size-4 text-[#8290ff]" /></div>
              <div><p className="text-sm font-medium">Profile context</p><p className="text-xs text-white/35">Loaded securely from your account</p></div>
              <Check className="ml-auto size-4 text-[#2bd9a3]" />
            </div>
            {profileLoading ? <p className="mt-6 text-sm text-white/45">Loading your saved profiles…</p> : workspace.profiles.length > 0 ? <>
              <p className="mt-6 text-sm text-white/70">{workspace.fullName || 'Your profile'} · {workspace.profiles.length} {workspace.profiles.length === 1 ? 'specialty' : 'specialties'} · {projectCount} portfolio {projectCount === 1 ? 'project' : 'projects'}</p>
              <div className="mt-4 flex flex-wrap gap-2">{profileSkills.map((skill) => <span key={skill} className="rounded-lg bg-white/[.07] px-2.5 py-2 text-xs text-white/55">{skill}</span>)}</div>
              <div className="mt-5 flex flex-col gap-3">
                {workspace.profiles.map((profile) => <details key={profile.id} className="rounded-xl border border-white/10 p-3">
                  <summary className="cursor-pointer text-sm text-white/75">{profile.title} <span className="text-xs text-white/35">· {profile.projects.length} projects</span></summary>
                  <p className="mt-3 whitespace-pre-line text-xs leading-5 text-white/45">{profile.overview || 'No profile description yet.'}</p>
                  {profile.projects.map((project) => <div key={project.id} className="mt-3 border-t border-white/[.08] pt-3">
                    <p className="text-xs font-medium text-white/65">{project.title}</p>
                    <p className="mt-1 whitespace-pre-line text-xs leading-5 text-white/40">{project.description || 'No project description yet.'}</p>
                    {project.skills.length > 0 && <p className="mt-2 text-xs text-[#aeb8ff]/70">{project.skills.join(' · ')}</p>}
                  </div>)}
                </details>)}
              </div>
            </> : <div className="mt-6">
              <p className="text-sm leading-6 text-white/50">Add a freelancer profile, description, skills, and portfolio projects to personalize your bids.</p>
              <Button type="button" onClick={() => onNavigate('profile')} variant="outline" className="mt-4 border-white/15 text-white">Complete your profile <ArrowRight data-icon="inline-end" /></Button>
            </div>}
            <p className="mt-5 text-xs leading-5 text-white/35">All your specialties and saved portfolio projects are sent to Gemini for context. The AI is instructed not to invent experience or results.</p>
          </aside>
        </div>

        {proposal && <section className="mt-5 rounded-2xl border border-[#2bd9a3]/20 bg-[#0b1717] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-[#b6f6e4]">Your {language === 'ar' ? 'Arabic bid · عربي' : 'English bid'}</p>
            <Button type="button" onClick={() => void copyProposal()} size="sm" variant="outline" className="border-white/10 text-white/70"><Copy data-icon="inline-start" /> Copy bid</Button>
          </div>
          {notice && <p role="status" className="mt-3 text-sm text-[#65e2be]">{notice}</p>}
          <p dir={language === 'ar' ? 'rtl' : 'ltr'} className="mt-5 whitespace-pre-line text-sm leading-7 text-white/75">{proposal}</p>
        </section>}
    </div>
  )
}
