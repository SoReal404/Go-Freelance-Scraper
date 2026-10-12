import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/safe-next'

// Handles the OAuth (Google) return trip: ?code=... -> session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNext(url.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const destination = data.user?.user_metadata?.onboarding_completed === true ? next : '/onboarding'
      return NextResponse.redirect(new URL(destination, url.origin))
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth', url.origin))
}
