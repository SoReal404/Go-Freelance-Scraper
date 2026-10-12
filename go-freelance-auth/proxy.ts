import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Pages that require a signed-in user.
const PROTECTED = ['/dashboard', '/bid', '/profile', '/onboarding']
// Pages a signed-in user has no reason to see.
const AUTH_PAGES = ['/login', '/signup']

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + '/'))

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // getUser() asks the Supabase Auth server to validate the token.
  // Never trust getSession() on the server: it only reads the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const redirectTo = (url: URL) => {
    const redirect = NextResponse.redirect(url)
    // keep any refreshed session cookies on the redirect response
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    return redirect
  }

  if (!user && matches(path, PROTECTED)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(path)}`
    return redirectTo(url)
  }

  if (user && matches(path, AUTH_PAGES)) {
    const url = request.nextUrl.clone()
    url.pathname = user.user_metadata?.onboarding_completed === true ? '/dashboard' : '/onboarding'
    url.search = ''
    return redirectTo(url)
  }

  if (user && matches(path, PROTECTED) && path !== '/onboarding' && user.user_metadata?.onboarding_completed !== true) {
    const url = request.nextUrl.clone()
    url.pathname = '/onboarding'
    url.search = ''
    return redirectTo(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
