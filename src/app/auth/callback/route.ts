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

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl
  const next = safeNext(url.searchParams.get('next'))
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
