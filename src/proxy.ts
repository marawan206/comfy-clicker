/**
 * Session refresh for Supabase auth. Runs before every page and API request that carries
 * cookies: `getUser()` validates the access token against Supabase and, when it has expired,
 * writes the refreshed pair back onto the response so server components, route handlers and the
 * browser client all see a live session. Without this only the browser client refreshed tokens,
 * so a tab left open for an hour would hit /api/daily or /api/hub with a stale cookie.
 *
 * Guest mode (no Supabase env) and requests without an auth cookie pass straight through.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseProxyClient } from '@/server/supabase/server'

const AUTH_COOKIE_PREFIX = 'sb-'

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request })
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith(AUTH_COOKIE_PREFIX))
  if (!hasAuthCookie) return response
  const supabase = createSupabaseProxyClient(request, response)
  if (!supabase) return response
  try {
    // Do not put logic between the client creation and getUser(): the refresh happens inside it.
    await supabase.auth.getUser()
  } catch {
    // An unreachable auth server must not block the page; the browser client retries on its own.
  }
  return response
}

export const config = {
  // Everything except static assets, generated art and the sound files.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|brand/|art/|sfx/|fonts/|.*\\.(?:svg|png|webp|mp4|mp3|ico)$).*)'],
}
