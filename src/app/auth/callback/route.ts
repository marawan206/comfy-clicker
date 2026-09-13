/**
 * Auth callback. Email confirmation and magic links land here with either a PKCE `code`
 * (exchanged for a session written to the cookies) or a `token_hash` + `type` pair (verified
 * directly). Then it bounces to `next` (same-origin paths only) with `?auth=` on the query
 * string so the client can toast the outcome.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/server/supabase/server'

export const dynamic = 'force-dynamic'

const OTP_TYPES: ReadonlySet<string> = new Set<EmailOtpType>(['signup', 'email', 'recovery', 'invite', 'magiclink', 'email_change'])

/**
 * `next` is attacker-controlled: it arrives on the query string of a link that looks like a
 * first-party auth URL, and the error branch below bounces before any auth work, so no session is
 * needed to fire it. A prefix test on the raw string is not enough, because the WHATWG URL parser
 * strips TAB, LF and CR from its input before parsing: `/%09/evil.com` decodes to "/\t/evil.com",
 * passes a `startsWith('//')` check, and then parses as the protocol-relative `//evil.com`.
 *
 * So: no control characters at all, and the verdict comes from the parsed URL's origin rather than
 * from the shape of the string. Only the path, query and fragment survive.
 */
function safeNext(raw: string | null, origin: string): string {
  if (!raw || raw[0] !== '/' || /[\u0000-\u001f\u007f]/.test(raw)) return '/'
  try {
    const url = new URL(raw, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch {
    return '/'
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl
  const next = safeNext(url.searchParams.get('next'), url.origin)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  const bounce = (outcome: 'ok' | 'error', reason?: string): NextResponse => {
    const target = new URL(next, url.origin)
    target.searchParams.set('auth', outcome)
    if (reason) target.searchParams.set('reason', reason.slice(0, 160))
    return NextResponse.redirect(target)
  }

  if (providerError) return bounce('error', providerError)

  const supabase = await createSupabaseServerClient()
  if (!supabase) return bounce('error', 'Cloud accounts are not configured on this build.')

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    return error ? bounce('error', error.message) : bounce('ok')
  }
  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
    return error ? bounce('error', error.message) : bounce('ok')
  }
  return bounce('error', 'That link is missing its code. Ask for a fresh one.')
}
