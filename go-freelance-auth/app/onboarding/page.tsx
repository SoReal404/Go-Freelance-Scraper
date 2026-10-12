import { redirect } from 'next/navigation'
import { FreelancerOnboarding } from '@/components/freelancer-workspace'
import { createClient } from '@/lib/supabase/server'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!user.email_confirmed_at) redirect('/login?error=verify')
  if (user.user_metadata?.onboarding_completed === true) redirect('/dashboard')

  return <FreelancerOnboarding />
}
