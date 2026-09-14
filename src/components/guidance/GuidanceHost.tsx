'use client'
/**
 * One popover, mounted once, that explains any lock where the player clicked.
 *
 * It is a bus, not a component tree: any surface calls `guide(anchorEl, spec)` (or the shorthand
 * `guideCauses`) and this host anchors itself to that element. Nothing has to thread props, and
 * only one explanation is ever on screen.
 *
 * Chrome per UI-SPEC: 320 px of node panel with a red-ish left stripe, `z-[85]` (above modals, with
 * tooltips), 8 px off the anchor. Esc, an outside press, a purchase and any action close it.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { Popover } from '@base-ui/react/popover'
import { useRouter } from 'next/navigation'
import { ArrowRight, Lock } from 'lucide-react'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { ModalButton, SectionLabel } from '@/components/overlays/ModalBase'
import { formatDuration, formatNum } from '@/game/format'
import type { LockCause } from '@/game/guidance'
import type { Currency } from '@/game/types'
import { cn } from '@/lib/utils'
import { useGameEvents } from '@/state/useGame'
import { stepsFor, type GuideSpec, type GuideStep, type GuideStore } from './lockGuide'
import { actionLabel, applyGoto, consumeGoto, runGuideAction } from './navigate'

interface GuideEntry {
  anchor: Element
  spec: GuideSpec
  /** Bumped per open so re-guiding the same row re-runs the entrance. */
  nonce: number
}

const listeners = new Set<() => void>()
let entry: GuideEntry | null = null
let nonce = 0

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): GuideEntry | null => entry
const getServerSnapshot = (): GuideEntry | null => null

/**
 * Show the guide against `anchor`. A spec with no steps (or a null anchor) closes it instead, so a
 * caller can hand over whatever the engine said without checking first.
 */
export function guide(anchor: Element | null, spec: GuideSpec | null): void {
  if (!anchor || !spec || spec.steps.length === 0) {
    closeGuide()
    return
  }
  entry = { anchor, spec, nonce: ++nonce }
  emit()
}

/** `guide` from raw causes: the shape every `explain*` function in the engine already returns. */
export function guideCauses(
  anchor: Element | null,
  causes: readonly LockCause[],
  store: GuideStore,
  subject = '',
): void {
  guide(anchor, stepsFor(causes, store, subject))
}

/** One cause is the common case (a model that will not run, a quantize button). */
export function guideCause(
  anchor: Element | null,
  cause: LockCause | null,
  store: GuideStore,
  subject = '',
): void {
  guide(anchor, cause ? stepsFor([cause], store, subject) : null)
}

export function closeGuide(): void {
  if (!entry) return
  entry = null
  emit()
}

const POPUP_CLASS =
  'w-[320px] max-w-[calc(100vw-24px)] rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-slot-vae bg-charcoal-600 p-3 text-left shadow-[0_4px_0_#0e0e0f,0_16px_40px_rgba(0,0,0,0.45)] outline-none'

const CURRENCY_TINT: Record<Currency, string> = {
  credits: 'text-credits',
  rp: 'text-electric-400',
  cp: 'text-slot-latent',
}

/** `450` in amber with the credits diamond, or `3 RP` in its own tint. */
function Price({ cost, currency = 'credits' }: { cost: number; currency?: Currency }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[12px] font-extrabold tabular-nums', CURRENCY_TINT[currency])}>
      {currency === 'credits' ? <CreditsIcon size={12} aria-hidden="true" /> : null}
      {formatNum(cost)}
      {currency === 'credits' ? null : <span className="text-[10px] tracking-[0.08em]">{currency.toUpperCase()}</span>}
    </span>
  )
}

export function GuidanceHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const router = useRouter()

  // A purchase or an upgrade unmounts the row this is anchored to, and an anchorless popover is a
  // box floating in the corner. The lock it was explaining is usually gone anyway.
  useGameEvents(
    useCallback((event) => {
      if (event.type === 'purchase' || event.type === 'upgrade' || event.type === 'mapUnlock') closeGuide()
    }, []),
  )

  // The other half of a cross-route jump: whatever was parked before the push happens here. The
  // Graph takes its own hand-off in `GraphMap`; this takes the store, the centre tabs and the hero.
  useEffect(() => {
    const goto = consumeGoto(['store', 'center', 'hero'])
    if (!goto) return
    const id = window.setTimeout(() => applyGoto(goto), 80)
    return () => window.clearTimeout(id)
  }, [])

  const run = useCallback(
    (step: GuideStep) => {
      if (!step.action) return
      closeGuide()
      runGuideAction(step.action, router)
    },
    [router],
  )

  const primaryIndex = useMemo(() => current?.spec.steps.findIndex((s) => s.action !== undefined) ?? -1, [current])

  if (!current) return null
  const { spec } = current

  return (
    <Popover.Root
      open
      onOpenChange={(next) => {
        if (!next) closeGuide()
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={current.anchor}
          side="left"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          className="z-[85]"
        >
          <Popover.Popup className={POPUP_CLASS} aria-label={`Locked: ${spec.subject || 'requirements'}`}>
            <header className="flex items-center gap-1.5">
              <Lock size={12} aria-hidden="true" className="shrink-0 text-slot-vae" />
              <SectionLabel className="min-w-0 truncate text-slot-vae">
                Locked{spec.subject ? ` · ${spec.subject}` : ''}
              </SectionLabel>
            </header>

            {spec.why ? <p className="mt-1.5 text-[13px] leading-snug text-smoke-100">{spec.why}</p> : null}

            <ol className="mt-2.5 flex flex-col gap-2">
              {spec.steps.map((step, i) => (
                <li key={`${step.label}-${i}`} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-px grid size-[18px] shrink-0 place-items-center rounded-[0.354em] border border-charcoal-400 bg-charcoal-700 text-[10px] font-extrabold tabular-nums text-smoke-600"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 text-[12px] font-semibold leading-snug text-smoke-100">{step.label}</span>
                      {step.cost !== undefined ? <Price cost={step.cost} currency={step.currency ?? 'credits'} /> : null}
                    </div>
                    {step.detail ? <p className="mt-0.5 text-[11px] leading-snug text-smoke-600">{step.detail}</p> : null}
                    {step.etaSec !== undefined && Number.isFinite(step.etaSec) ? (
                      <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-electric-400">
                        {formatDuration(step.etaSec)} at your rate
                      </p>
                    ) : null}
                    {step.action && i === primaryIndex ? (
                      <ModalButton tone="primary" size="sm" className="mt-1.5" onClick={() => run(step)}>
                        {actionLabel(step.action)}
                        <ArrowRight size={13} aria-hidden="true" />
                      </ModalButton>
                    ) : step.action ? (
                      <button
                        type="button"
                        onClick={() => run(step)}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-electric-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
                      >
                        {actionLabel(step.action)}
                      </button>
                    ) : null}
                    {step.alt ? (
                      <button
                        type="button"
                        onClick={() => run(step.alt as GuideStep)}
                        disabled={!step.alt.action}
                        className="mt-1 flex w-full items-start justify-between gap-2 text-[11px] font-semibold text-electric-400 underline-offset-2 hover:underline disabled:text-smoke-700 disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
                      >
                        <span className="min-w-0 text-left leading-snug">or {step.alt.label.toLowerCase()}</span>
                        {step.alt.cost !== undefined ? <Price cost={step.alt.cost} currency={step.alt.currency ?? 'credits'} /> : null}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-2.5 flex justify-end border-t border-charcoal-400/70 pt-2">
              <Popover.Close
                render={
                  <button
                    type="button"
                    className="rounded-comfy px-2 py-1 text-[11px] font-semibold text-smoke-600 transition-colors hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
                  />
                }
              >
                Got it
              </Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
