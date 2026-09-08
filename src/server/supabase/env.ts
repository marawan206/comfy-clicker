/**
 * Typed access to the Supabase / cron environment.
 *
 * The game must work without any of these set (guest mode, local saves only), so
 * every getter returns `null` instead of throwing; `require*` variants throw with a
 * helpful message for code paths that genuinely cannot proceed.
 *
 * NOTE: `process.env.NEXT_PUBLIC_*` must be referenced literally (not via a
 * computed key) so Next.js can inline the values into the client bundle.
 */

export interface SupabasePublicEnv {
  url: string
  anonKey: string
}

function clean(v: string | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

/** Public URL + anon key. Available on both server and client. */
export function getPublicEnv(): SupabasePublicEnv | null {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  // Newer Supabase projects issue `sb_publishable_…` keys instead of the legacy anon JWT.
  const anonKey =
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
    clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  if (!url || !anonKey) return null
  return { url, anonKey }
}

/** True when the public Supabase env is configured. Cheap; safe to call anywhere. */
export function hasSupabase(): boolean {
  return getPublicEnv() !== null
}

export function requirePublicEnv(): SupabasePublicEnv {
  const env = getPublicEnv()
  if (!env) {
    throw new Error(
      'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).',
    )
  }
  return env
}

/** Service-role key. Server only; never inlined into the client bundle. */
export function getServiceRoleKey(): string | null {
  return clean(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? clean(process.env.SUPABASE_SECRET_KEY)
}

export function requireServiceRoleKey(): string {
  const key = getServiceRoleKey()
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (server-only; see .env.example).')
  }
  return key
}

/** Shared secret for cron route handlers. */
export function getCronSecret(): string | null {
  return clean(process.env.CRON_SECRET)
}

/** Constant-time string comparison (no node:crypto so this module stays isomorphic). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Validates a cron request. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`;
 * a bare secret header value is accepted too. Always false when CRON_SECRET is unset,
 * so cron endpoints are closed by default.
 */
export function isCronAuthorized(authorizationHeader: string | null | undefined): boolean {
  const secret = getCronSecret()
  if (!secret || !authorizationHeader) return false
  const token = authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : authorizationHeader.trim()
  return safeEqual(token, secret)
}
