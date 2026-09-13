'use client'
/**
 * Email + password sign-in / sign-up dialog on the shared modal chrome. Opens on
 * `comfy:open-modal` with detail `'auth'` (see `openAuthSheet` in ./useAuth), closes on Esc,
 * the backdrop, `comfy:close-modals` or a successful sign-in. Also reads the `?auth=ok|error`
 * bounce from `/auth/callback` once and turns it into a toast.
 */
import { useEffect, useId, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { Cloud, Eye, EyeOff, KeyRound, LogIn, MailCheck, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AUTH_MODAL_ID, AUTH_TAB_EVENT, signIn, signUp, useAuth } from '@/components/auth/useAuth'
import { HANDLE_HINT } from '@/components/auth/UsernameModal'
import { ModalBase, ModalButton, OPEN_MODAL_EVENT, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { normalizeHandle, validateHandle } from '@/lib/handle'

type Tab = 'sign-in' | 'sign-up'

const TABS: { id: Tab; label: string }[] = [
  { id: 'sign-in', label: 'Sign in' },
  { id: 'sign-up', label: 'Create account' },
]

const INPUT =
  'h-10 w-full rounded-xl border bg-charcoal-800 px-3 text-sm text-smoke-100 placeholder:text-smoke-800 transition-colors focus-visible:border-electric-400 focus-visible:outline-none disabled:opacity-60'

export function AuthSheet() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('sign-in')
  const auth = useAuth()

  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<unknown>).detail === AUTH_MODAL_ID) setOpen(true)
    }
    const onTab = (e: Event) => {
      const t = (e as CustomEvent<unknown>).detail
      if (t === 'sign-in' || t === 'sign-up') setTab(t)
    }
    window.addEventListener(OPEN_MODAL_EVENT, onOpen)
    window.addEventListener(AUTH_TAB_EVENT, onTab)
    return () => {
      window.removeEventListener(OPEN_MODAL_EVENT, onOpen)
      window.removeEventListener(AUTH_TAB_EVENT, onTab)
    }
  }, [])

  useCallbackBounce()

  // Signing in from anywhere (another tab, the callback bounce) closes the sheet.
  const signedIn = auth.status === 'signed-in'

  // `open` has to be cleared, not just masked: the email-confirmation path leaves the sheet open and
  // returns before `onDone`, so a sheet that only hid behind `signedIn` would pop itself back up the
  // next time the player signed out. Adjusting during render rather than in an effect, because the
  // session can arrive from another tab or the `/auth/callback` bounce: React re-runs this component
  // before anything paints, so the sheet never flashes.
  if (open && signedIn) setOpen(false)

  return (
    <ModalBase
      open={open && !signedIn}
      onClose={() => setOpen(false)}
      title={tab === 'sign-in' ? 'Sign in' : 'Create account'}
      icon={<Cloud size={16} />}
      stripe="sapphire"
      size="sm"
    >
      <AuthBody tab={tab} onTab={setTab} onDone={() => setOpen(false)} unavailable={auth.status === 'unavailable'} />
    </ModalBase>
  )
}

function AuthBody({ tab, onTab, onDone, unavailable }: { tab: Tab; onTab: (t: Tab) => void; onDone: () => void; unavailable: boolean }) {
  const reduced = useReducedMotionPref()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [handle, setHandle] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const emailId = useId()
  const passwordId = useId()
  const handleId = useId()
  const handleHintId = useId()
  const signup = tab === 'sign-up'
  // The field is optional, so an empty one is never wrong; anything typed must hold up.
  const handleCheck = validateHandle(handle)
  const handleError = handle.length > 0 && !handleCheck.ok ? handleCheck.error : null
  const blocked = busy || unavailable || (signup && handleError !== null)

  const switchTab = (t: Tab) => {
    onTab(t)
    setError(null)
    setNotice(null)
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = signup ? await signUp(email, password, handle) : await signIn(email, password)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.message) {
      setNotice(result.message)
      return
    }
    toast(signup ? 'Account created' : 'Signed in', {
      title: 'Cloud',
      description: signup ? 'Your guest run is being uploaded. Same rig, now with a backup.' : 'Cloud save is syncing. Play on; it uploads in the background.',
      icon: <Cloud className="text-electric-400" />,
      tone: 'electric',
      key: 'auth',
    })
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
      <div role="tablist" aria-label="Sign in or create an account" className="relative grid grid-cols-2 rounded-xl border border-charcoal-400 bg-charcoal-700/60 p-1">
        {TABS.map((t) => {
          const selected = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => switchTab(t.id)}
              className={cn(
                'relative z-10 h-8 rounded-lg text-xs font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
                selected ? 'text-charcoal-800' : 'text-smoke-600 hover:text-smoke-100',
              )}
            >
              {selected ? (
                <motion.span
                  layoutId="auth-tab-pill"
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-lg bg-electric-400 shadow-[0_2px_0_#8a9a00]"
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 36 }}
                />
              ) : null}
              {t.label}
            </button>
          )
        })}
      </div>

      <p className="text-xs leading-relaxed text-smoke-600">
        {signup
          ? 'An account backs your save up to the cloud, puts you on the board and times the daily on a clock you cannot nudge. Your guest run comes with you.'
          : 'Welcome back. Signing in loads your cloud save. If this browser has its own run, you get to pick.'}
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={emailId} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={busy || unavailable}
          data-autofocus
          className={cn(INPUT, error ? 'border-slot-vae' : 'border-charcoal-400')}
        />
      </div>

      {signup ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={handleId} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
            Username <span className="text-smoke-800 normal-case">(optional)</span>
          </label>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-semibold text-smoke-800">
              @
            </span>
            <input
              id={handleId}
              type="text"
              name="handle"
              value={handle}
              onChange={(e) => setHandle(normalizeHandle(e.target.value))}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              placeholder="leave blank for comfy-xxxxxx"
              disabled={busy || unavailable}
              aria-describedby={handleHintId}
              aria-invalid={handleError ? 'true' : undefined}
              className={cn(INPUT, 'pr-3 pl-7', handleError ? 'border-slot-vae' : 'border-charcoal-400')}
            />
          </div>
          <p id={handleHintId} className="text-[11px] leading-relaxed text-smoke-800">
            {handleError ?? HANDLE_HINT}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={passwordId} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
          Password
        </label>
        <div className="relative">
          <input
            id={passwordId}
            type={show ? 'text' : 'password'}
            name="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            required
            minLength={signup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={signup ? 'At least 8 characters' : 'Your password'}
            disabled={busy || unavailable}
            className={cn(INPUT, 'pr-10', error ? 'border-slot-vae' : 'border-charcoal-400')}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-comfy text-smoke-800 transition-colors hover:bg-charcoal-500 hover:text-smoke-100"
          >
            {show ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-slot-vae/40 bg-slot-vae/5 px-3 py-2 text-xs text-slot-vae">
          <KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-sapphire-700/60 bg-sapphire-700/15 px-3 py-2 text-xs text-smoke-100">
          <MailCheck size={14} className="mt-0.5 shrink-0 text-[#7f8dff]" aria-hidden="true" />
          {notice}
        </p>
      ) : null}
      {unavailable ? (
        <p role="status" className="text-xs text-smoke-600">
          Cloud accounts are off on this build. Guest saves still live in this browser; export a code in Settings to move them.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={() => switchTab(signup ? 'sign-in' : 'sign-up')}
          className="text-xs text-smoke-600 underline-offset-2 hover:text-smoke-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
        >
          {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        <ModalButton type="submit" tone="primary" size="lg" disabled={blocked} aria-disabled={blocked ? 'true' : undefined}>
          {signup ? <UserPlus size={16} /> : <LogIn size={16} />}
          {busy ? (signup ? 'Creating…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
        </ModalButton>
      </div>
    </form>
  )
}

/** Turns the `?auth=ok|error&reason=` query the callback route appends into one toast, then strips it. */
function useCallbackBounce(): void {
  useEffect(() => {
    const url = new URL(window.location.href)
    const outcome = url.searchParams.get('auth')
    if (outcome !== 'ok' && outcome !== 'error') return
    const reason = url.searchParams.get('reason')
    if (outcome === 'ok') {
      toast('Email confirmed', {
        title: 'Cloud',
        description: 'You are signed in. The cloud save starts syncing now.',
        icon: <MailCheck className="text-electric-400" />,
        tone: 'electric',
        key: 'auth',
      })
    } else {
      toast(describeCallbackError(reason), { title: 'Cloud', description: 'Ask for a fresh link from the sign-in sheet.', tone: 'danger', key: 'auth' })
    }
    url.searchParams.delete('auth')
    url.searchParams.delete('reason')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])
}

/**
 * Fixed copy for the `reason` the callback bounces with. The query string is attacker-writable,
 * so it is matched against known Supabase / callback failures and never rendered verbatim.
 */
function describeCallbackError(reason: string | null): string {
  const r = (reason ?? '').toLowerCase()
  if (r.includes('expired')) return 'That link has expired.'
  if (r.includes('already') || r.includes('used')) return 'That link was already used. Sign in with your password instead.'
  if (r.includes('not configured')) return 'Cloud accounts are switched off on this build.'
  if (r.includes('missing its code')) return 'That link is missing its code.'
  if (r.includes('invalid') || r.includes('not found') || r.includes('otp')) return 'That link is not valid any more.'
  if (r.includes('access_denied') || r.includes('denied')) return 'The sign-in was cancelled.'
  return 'That link did not work.'
}
