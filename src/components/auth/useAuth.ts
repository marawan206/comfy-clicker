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
import { getSupabaseBrowserClient, type SupabaseBrowserClient } from '@/server/supabase/client'
import { getCloudSyncSnapshot, subscribeCloudSync, type CloudSyncStatus } from '@/state/persistence'

export type AuthStatus = 'loading' | 'guest' | 'signed-in' | 'unavailable'

export interface AuthState {
  status: AuthStatus
  user: User | null
  /** `profiles.handle` once loaded; null while guest or before the lookup returns. */
  handle: string | null
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
type Listener = () => void

const listeners = new Set<Listener>()
let state: AuthState = { status: 'loading', user: null, handle: null }
const SERVER_STATE: AuthState = { status: 'loading', user: null, handle: null }
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
    setState({ status: 'unavailable', user: null, handle: null })
    return
  }
  // INITIAL_SESSION fires synchronously-ish on subscribe with the cookie session (or null).
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      setState({ status: 'guest', user: null, handle: null })
      return
    }
    const sameUser = state.user?.id === session.user.id
    setState({ status: 'signed-in', user: session.user, handle: sameUser ? state.handle : null })
    if (!sameUser || !state.handle) void loadHandle(supabase, session)
  })
}

async function loadHandle(supabase: SupabaseBrowserClient, session: Session): Promise<void> {
  const { data, error } = await supabase.from('profiles').select('handle').eq('id', session.user.id).maybeSingle()
  if (error || !data) return
  if (state.user?.id === session.user.id) setState({ handle: data.handle })
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const UNAVAILABLE: AuthResult = { ok: false, error: 'Cloud accounts are switched off on this build. Guest saves still live in this browser.' }

function client(): SupabaseBrowserClient | null {
  boot()
  return getSupabaseBrowserClient()
}

function validate(email: string, password: string, signup: boolean): string | null {
  const e = email.trim()
  if (!e) return 'Enter your email.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'That email does not parse. The VAE is fine; the address is not.'
  if (!password) return 'Enter your password.'
  if (signup && password.length < 8) return 'Passwords need at least 8 characters. Think of it as a seed you can remember.'
  return null
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const supabase = client()
  if (!supabase) return UNAVAILABLE
  const invalid = validate(email, password, true)
  if (invalid) return { ok: false, error: invalid }
  const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`
  try {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo } })
    if (error) return { ok: false, error: mapAuthError(error) }
    // Supabase returns a user with no identities when the address already has an account (anti-enumeration).
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { ok: false, error: 'That email already has an account. Sign in instead.' }
    }
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
