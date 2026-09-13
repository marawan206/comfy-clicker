'use client'
/**
 * Auth session as a tiny external store shared by the header menu, the auth sheet, the daily
 * modal and cloud sync. One Supabase browser client (cookie-backed, see `src/server/supabase/client`),
 * one `onAuthStateChange` subscription, and a `profiles.handle` lookup after sign-in.
 *
 * Guest play never depends on this: when Supabase is not configured the status is `unavailable`
 * and every action returns a friendly error instead of throwing.
 */
import { useSyncExternalStore } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { mapProfileError, normalizeHandle, validateHandle } from '@/lib/handle'
import { getSupabaseBrowserClient, type SupabaseBrowserClient } from '@/server/supabase/client'
import { getCloudSyncSnapshot, subscribeCloudSync, type CloudSyncStatus } from '@/state/persistence'

export type AuthStatus = 'loading' | 'guest' | 'signed-in' | 'unavailable'

export interface AuthState {
  status: AuthStatus
  user: User | null
  /** `profiles.handle` once loaded; null while guest or before the lookup returns. */
  handle: string | null
  /**
   * `profiles.handle_changed_at`: null means the handle is still the one sign-up handed out.
   * The welcome gift reads it, because a handle somebody renamed themselves into is not evidence
   * of anything (see FounderGiftModal).
   */
  handleChangedAt: string | null
}

export type AuthResult = { ok: true; message?: string } | { ok: false; error: string }

/** Modal id the auth sheet listens for on `comfy:open-modal`. */
export const AUTH_MODAL_ID = 'auth'

/** Ask the mounted AuthSheet to open (optionally on a specific tab). */
export function openAuthSheet(tab: 'sign-in' | 'sign-up' = 'sign-in'): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_MODAL_EVENT, { detail: AUTH_MODAL_ID }))
  window.dispatchEvent(new CustomEvent<'sign-in' | 'sign-up'>(AUTH_TAB_EVENT, { detail: tab }))
}
export const AUTH_TAB_EVENT = 'comfy:auth-tab'

/** Fired with the new handle in `detail` after a successful rename. */
export const HANDLE_CHANGED_EVENT = 'comfy:handle-changed'

/**
 * The handle asked for on the create-account form, parked until the account actually exists.
 * Confirming the email can happen days later in another tab, and the 0004 trigger silently falls
 * back to `comfy-xxxxxx` when the name was taken in between, so this is the only way to tell the
 * player their pick did not land.
 */
const WANTED_HANDLE_KEY = 'comfy-clicker:wanted-handle'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
type Listener = () => void

const listeners = new Set<Listener>()
let state: AuthState = { status: 'loading', user: null, handle: null, handleChangedAt: null }
const SERVER_STATE: AuthState = { status: 'loading', user: null, handle: null, handleChangedAt: null }
let booted = false

function setState(next: Partial<AuthState>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export function getAuthState(): AuthState {
  return state
}

export function subscribeAuth(listener: Listener): () => void {
  listeners.add(listener)
  boot()
  return () => {
    listeners.delete(listener)
  }
}

/** Starts the session watcher once per page. Safe to call repeatedly. */
function boot(): void {
  if (booted || typeof window === 'undefined') return
  booted = true
  const supabase = getSupabaseBrowserClient()
  if (!supabase) {
    setState({ status: 'unavailable', user: null, handle: null, handleChangedAt: null })
    return
  }
  // INITIAL_SESSION fires synchronously-ish on subscribe with the cookie session (or null).
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      setState({ status: 'guest', user: null, handle: null, handleChangedAt: null })
      return
    }
    const sameUser = state.user?.id === session.user.id
    setState({
      status: 'signed-in',
      user: session.user,
      handle: sameUser ? state.handle : null,
      handleChangedAt: sameUser ? state.handleChangedAt : null,
    })
    if (!sameUser || !state.handle) void loadHandle(supabase, session)
  })
}

async function loadHandle(supabase: SupabaseBrowserClient, session: Session): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .select('handle, handle_changed_at')
    .eq('id', session.user.id)
    .maybeSingle()
  if (error || !data) return
  if (state.user?.id !== session.user.id) return
  setState({ handle: data.handle, handleChangedAt: data.handle_changed_at })
  reportWantedHandle(data.handle, data.handle_changed_at)
}

/**
 * One toast when the sign-up handle did not survive: the name was taken between the form and the
 * confirmation click, so the trigger handed out the generated one instead.
 */
function reportWantedHandle(actual: string, changedAt: string | null): void {
  const wanted = readWanted()
  if (!wanted) return
  clearWanted()
  if (wanted === actual || changedAt !== null) return
  toast('That username was gone', {
    title: 'Account',
    description: `@${wanted} was claimed while you confirmed the email, so you are @${actual} for now. Change username is in the account menu.`,
    tone: 'sapphire',
    key: 'handle',
  })
}

function readWanted(): string | null {
  try {
    return window.localStorage.getItem(WANTED_HANDLE_KEY)
  } catch {
    return null
  }
}

function rememberWanted(handle: string): void {
  try {
    window.localStorage.setItem(WANTED_HANDLE_KEY, handle)
  } catch {
    /* storage unavailable: the player just does not get the heads-up */
  }
}

function clearWanted(): void {
  try {
    window.localStorage.removeItem(WANTED_HANDLE_KEY)
  } catch {
    /* nothing to clean up */
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const UNAVAILABLE: AuthResult = { ok: false, error: 'Cloud accounts are switched off on this build. Guest saves still live in this browser.' }

function client(): SupabaseBrowserClient | null {
  boot()
  return getSupabaseBrowserClient()
}

/**
 * Origin the confirmation email should send people back to. `NEXT_PUBLIC_SITE_URL` wins when it is
 * set (the deployed URL, so a link requested from a preview or a dev server still lands on
 * production); otherwise the page's own origin. Supabase also needs that origin in its redirect
 * allow-list, or it silently falls back to the project's Site URL (see docs/DEPLOY.md).
 */
export function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return window.location.origin
}

function validate(email: string, password: string, signup: boolean): string | null {
  const e = email.trim()
  if (!e) return 'Enter your email.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'That email does not parse. The VAE is fine; the address is not.'
  if (!password) return 'Enter your password.'
  if (signup && password.length < 8) return 'Passwords need at least 8 characters. Think of it as a seed you can remember.'
  return null
}

/**
 * Create an account. `handle` is optional: when it is given it rides along as
 * `raw_user_meta_data.handle` and the 0004 trigger takes it if it is still free, otherwise the
 * player gets the generated `comfy-xxxxxx` and one toast about it on the way back in.
 */
export async function signUp(email: string, password: string, handle?: string): Promise<AuthResult> {
  const supabase = client()
  if (!supabase) return UNAVAILABLE
  const invalid = validate(email, password, true)
  if (invalid) return { ok: false, error: invalid }
  const wanted = normalizeHandle(handle ?? '')
  if (wanted) {
    const check = validateHandle(wanted)
    if (!check.ok) return { ok: false, error: check.error }
  }
  const emailRedirectTo = `${siteOrigin()}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: wanted ? { emailRedirectTo, data: { handle: wanted } } : { emailRedirectTo },
    })
    if (error) return { ok: false, error: mapAuthError(error) }
    // Supabase returns a user with no identities when the address already has an account (anti-enumeration).
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { ok: false, error: 'That email already has an account. Sign in instead.' }
    }
    if (wanted) rememberWanted(wanted)
    if (!data.session) {
      return { ok: true, message: 'Check your inbox, confirm the email and this browser signs in on the way back.' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapAuthError(err) }
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const supabase = client()
  if (!supabase) return UNAVAILABLE
  const invalid = validate(email, password, false)
  if (invalid) return { ok: false, error: invalid }
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return { ok: false, error: mapAuthError(error) }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapAuthError(err) }
  }
}

export async function signOut(): Promise<AuthResult> {
  const supabase = client()
  if (!supabase) return UNAVAILABLE
  try {
    const { error } = await supabase.auth.signOut()
    if (error) return { ok: false, error: mapAuthError(error) }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapAuthError(err) }
  }
}

/**
 * Rename the signed-in player. The rules live in three places that must agree: `validateHandle`
 * here, the `profiles` check constraint and unique index, and the 0004 before-update trigger
 * (reserved names, one rename a day). Everything the server refuses comes back as copy from
 * `mapProfileError`, so a race with another account reads like a sentence and not like Postgres.
 */
export async function updateHandle(next: string): Promise<AuthResult> {
  const supabase = client()
  if (!supabase) return UNAVAILABLE
  const user = state.user
  if (!user) return { ok: false, error: 'Sign in first. A guest run has no name to change.' }
  const handle = normalizeHandle(next)
  const check = validateHandle(handle)
  if (!check.ok) return { ok: false, error: check.error }
  if (handle === state.handle) return { ok: false, error: 'That is already your username.' }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ handle })
      .eq('id', user.id)
      .select('handle, handle_changed_at')
    if (error) return { ok: false, error: mapProfileError(error.code, error.message) }
    // RLS refusing the row and a vanished profile both arrive as zero rows, not as an error.
    const row = data?.[0]
    if (!row) return { ok: false, error: mapProfileError(null, null) }
    if (state.user?.id === user.id) setState({ handle: row.handle, handleChangedAt: row.handle_changed_at })
    clearWanted()
    window.dispatchEvent(new CustomEvent<string>(HANDLE_CHANGED_EVENT, { detail: row.handle }))
    return { ok: true }
  } catch (err) {
    const message = typeof err === 'object' && err !== null ? String((err as { message?: unknown }).message ?? '') : String(err)
    return { ok: false, error: mapProfileError(null, message) }
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------
const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong email or password. No, the caps lock is not a feature.',
  email_not_confirmed: 'Email not confirmed yet. Open the link we sent you, then try again.',
  user_already_exists: 'That email already has an account. Sign in instead.',
  email_exists: 'That email already has an account. Sign in instead.',
  weak_password: 'Password is too weak. Longer beats cleverer.',
  over_email_send_rate_limit: 'Too many emails sent to that address. Give it a few minutes.',
  over_request_rate_limit: 'Too many attempts. The auth server is throttling like a 4-slot PSU.',
  signup_disabled: 'Sign-ups are closed right now.',
  email_address_invalid: 'That email address is not accepted.',
  email_provider_disabled: 'Email sign-in is switched off on this build.',
  validation_failed: 'The server rejected that input. Check the email and password.',
  session_expired: 'Session expired. Sign in again.',
  refresh_token_not_found: 'Session expired. Sign in again.',
}

/** Human copy for a Supabase auth error (or anything thrown around it). */
export function mapAuthError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') {
      const m = message.toLowerCase()
      if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) {
        return 'Could not reach the auth server. Check the connection. The game keeps running locally.'
      }
      if (m.includes('invalid login credentials')) return CODE_MESSAGES.invalid_credentials
      if (m.includes('already registered')) return CODE_MESSAGES.user_already_exists
      if (m.includes('rate limit')) return CODE_MESSAGES.over_request_rate_limit
      if (message.trim()) return message
    }
  }
  return 'Something went wrong on the auth side. Try again in a moment.'
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
const getServerSnapshot = (): AuthState => SERVER_STATE

/** Current session state; re-renders on sign-in / sign-out and once the handle loads. */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribeAuth, getAuthState, getServerSnapshot)
}

const SERVER_SYNC: CloudSyncStatus = 'offline'
const getSyncServer = (): CloudSyncStatus => SERVER_SYNC

/** Cloud save status: `offline` (guest / unreachable), `syncing`, `synced`, `error`. */
export function useCloudSync(): CloudSyncStatus {
  return useSyncExternalStore(subscribeCloudSync, getCloudSyncSnapshot, getSyncServer)
}
