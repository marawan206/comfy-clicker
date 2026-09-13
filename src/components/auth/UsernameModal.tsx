'use client'
/**
 * "Change username." One field, one rule set, three places that enforce it: `validateHandle` here,
 * the `profiles` check constraint and unique index, and the 0004 before-update trigger (reserved
 * names, one rename a day).
 *
 * The input normalises as you type rather than complaining afterwards, so SHOUTING or a pasted
 * `@name` is corrected in place and never becomes an error message. Save stays disabled until the
 * value is both valid and different, which leaves the error line for things only the server knows:
 * the name was taken a second ago, the cooldown, a dropped session.
 */
import { useId, useState, type FormEvent } from 'react'
import { AtSign, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { updateHandle } from '@/components/auth/useAuth'
import { ModalBase, ModalButton, SectionLabel } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { normalizeHandle, validateHandle } from '@/lib/handle'

/** The rules, in the order the field applies them. Shown under the input at all times. */
export const HANDLE_HINT = '3 to 32 characters: lowercase letters, digits, - and _. Starts with a letter or digit. One change a day.'

export interface UsernameModalProps {
  open: boolean
  onClose: () => void
  /** The handle in `profiles` right now, or null while it is still loading. */
  current: string | null
}

export function UsernameModal({ open, onClose, current }: UsernameModalProps) {
  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="Change username"
      icon={<AtSign size={16} />}
      stripe="sapphire"
      size="sm"
    >
      <UsernameForm onClose={onClose} current={current} />
    </ModalBase>
  )
}

/**
 * The form is a child of `ModalBase` on purpose: the modal mounts its children only while it is
 * open, so every opening starts from the current handle with no effect syncing props into state.
 */
function UsernameForm({ onClose, current }: { onClose: () => void; current: string | null }) {
  const [value, setValue] = useState(current ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const hintId = useId()

  const check = validateHandle(value)
  const changed = value !== (current ?? '')
  const canSave = check.ok && changed && !busy
  // Nothing is wrong with an empty field the player has not filled in yet.
  const liveError = value.length > 0 && !check.ok ? check.error : null

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    setError(null)
    const result = await updateHandle(value)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast('Username changed', {
      title: 'Account',
      description: `@${value} · the board and ComfyHub pick it up on their next refresh.`,
      icon: <AtSign className="text-electric-400" />,
      tone: 'electric',
      key: 'handle',
    })
    onClose()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
      <p className="text-xs leading-relaxed text-smoke-600">
        {current ? (
          <>
            You are <span className="font-semibold text-smoke-100">@{current}</span> on the leaderboard and on every
            workflow you publish. Pick the name you want to be known by.
          </>
        ) : (
          'Loading your current name. The field fills in as soon as it lands.'
        )}
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId}>
          <SectionLabel>New username</SectionLabel>
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-semibold text-smoke-800">
            @
          </span>
          <input
            id={inputId}
            type="text"
            name="handle"
            value={value}
            onChange={(e) => {
              setValue(normalizeHandle(e.target.value))
              setError(null)
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            disabled={busy}
            data-autofocus
            aria-describedby={hintId}
            aria-invalid={liveError !== null || error !== null ? 'true' : undefined}
            className={cn(
              'h-10 w-full rounded-xl border bg-charcoal-800 pr-3 pl-7 text-sm text-smoke-100 placeholder:text-smoke-800 transition-colors focus-visible:border-electric-400 focus-visible:outline-none disabled:opacity-60',
              liveError || error ? 'border-slot-vae' : 'border-charcoal-400',
            )}
          />
        </div>
        <p id={hintId} className="text-[11px] leading-relaxed text-smoke-800">
          {HANDLE_HINT}
        </p>
      </div>

      {liveError ? (
        <p role="status" className="rounded-xl border border-charcoal-400 bg-charcoal-700/60 px-3 py-2 text-xs text-smoke-600">
          {liveError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-slot-vae/40 bg-slot-vae/5 px-3 py-2 text-xs text-slot-vae">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <ModalButton type="button" tone="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </ModalButton>
        <ModalButton type="submit" tone="primary" disabled={!canSave} aria-disabled={canSave ? undefined : 'true'}>
          <Check size={16} />
          {busy ? 'Saving…' : 'Save'}
        </ModalButton>
      </div>
    </form>
  )
}
