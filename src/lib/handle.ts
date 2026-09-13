/**
 * Username rules, shared by the sign-up form, the change-username modal and the SQL migration
 * that enforces the same regex server side. Pure: no Supabase, no React.
 */

/** Lowercase, 3 to 32 characters, starts with a letter or digit. Mirrors the `profiles` check. */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/

/** Names the app owns: routes, roles and the generated-handle prefix. */
export const RESERVED_HANDLES: readonly string[] = [
  'admin',
  'administrator',
  'api',
  'board',
  'comfy',
  'comfyui',
  'comfyanonymous',
  'guest',
  'help',
  'hub',
  'leaderboard',
  'login',
  'logout',
  'map',
  'moderator',
  'null',
  'root',
  'settings',
  'signin',
  'signup',
  'staff',
  'stats',
  'support',
  'system',
  'undefined',
  'user',
]

/** What the input field does on every keystroke: trim, drop a leading `@`, lowercase, spaces to `-`. */
export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
}

export interface HandleCheck {
  ok: boolean
  /** Empty when `ok`. */
  error: string
}

/** Validate a normalised handle. The copy is the copy the modal shows. */
export function validateHandle(raw: string): HandleCheck {
  const handle = normalizeHandle(raw)
  if (handle.length < 3) return { ok: false, error: 'At least 3 characters.' }
  if (handle.length > 32) return { ok: false, error: 'At most 32 characters.' }
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'Lowercase letters, digits, - and _. Starts with a letter or digit.' }
  }
  if (RESERVED_HANDLES.includes(handle)) return { ok: false, error: 'That one is reserved. Nice try.' }
  return { ok: true, error: '' }
}

/** Postgres and PostgREST codes the profile update can come back with, in the game's voice. */
export function mapProfileError(code?: string | null, message?: string | null): string {
  const text = `${code ?? ''} ${message ?? ''}`.toLowerCase()
  if (text.includes('23505')) return 'That username is taken. The other one got there first.'
  if (text.includes('handle_reserved')) return 'That one is reserved. Nice try.'
  if (text.includes('handle_cooldown')) return 'One change a day. Try again tomorrow.'
  if (text.includes('23514')) {
    return 'That username breaks the rules: 3 to 32 characters, lowercase letters, digits, - and _.'
  }
  if (text.includes('fetch') || text.includes('network')) {
    return 'Could not reach the auth server. The game keeps running locally.'
  }
  return 'Could not update the username. Are you still signed in?'
}
