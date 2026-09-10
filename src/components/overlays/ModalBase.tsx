'use client'
/**
 * Shared modal chrome: dimmed backdrop, a node-styled panel with a category stripe, spring
 * scale/fade, Esc and the `comfy:close-modals` window event close it, focus stays inside while
 * open and returns to the opener afterwards, and the page stops scrolling underneath.
 * Also home to the small pieces every overlay reuses: `useReducedMotionPref`, `STRIPE_CLASS`,
 * `SectionLabel`, `ModalButton` and `HoldToConfirm`.
 */
import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion, useAnimation, useIsPresent, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { useGame } from '@/state/useGame'
import { cn } from '@/lib/utils'
import type { Stripe } from '@/components/common/Panel'

export const CLOSE_MODALS_EVENT = 'comfy:close-modals'
export const OPEN_MODAL_EVENT = 'comfy:open-modal'

/** Left-stripe class per ComfyUI slot colour (mirrors Panel's table for overlay cards). */
export const STRIPE_CLASS: Record<Stripe, string> = {
  model: 'border-l-slot-model',
  clip: 'border-l-slot-clip',
  cond: 'border-l-slot-cond',
  image: 'border-l-slot-image',
  latent: 'border-l-slot-latent',
  vae: 'border-l-slot-vae',
  mask: 'border-l-slot-mask',
  electric: 'border-l-electric-400',
  sapphire: 'border-l-sapphire-700',
  none: 'border-l-charcoal-400',
}

const SIZES = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[760px]',
} as const

/** True when the OS or the in-game setting asks for calmer motion (both read unconditionally). */
export function useReducedMotionPref(): boolean {
  const os = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  return Boolean(os) || setting
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

let scrollLocks = 0
function lockScroll(): () => void {
  scrollLocks += 1
  if (scrollLocks === 1) document.documentElement.style.overflow = 'hidden'
  return () => {
    scrollLocks = Math.max(0, scrollLocks - 1)
    if (scrollLocks === 0) document.documentElement.style.overflow = ''
  }
}

export interface ModalBaseProps {
  open: boolean
  onClose: () => void
  /** Uppercase node-title label in the header. */
  title: ReactNode
  /** Small icon left of the title. */
  icon?: ReactNode
  /** Right-aligned header content next to the close button. */
  right?: ReactNode
  stripe?: Stripe
  size?: keyof typeof SIZES
  /** Sticky footer row (actions). */
  footer?: ReactNode
  /** Backdrop click closes (default true); turn off for must-answer dialogs. */
  dismissible?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
}

export function ModalBase({
  open,
  onClose,
  title,
  icon,
  right,
  stripe = 'none',
  size = 'md',
  footer,
  dismissible = true,
  className,
  bodyClassName,
  children,
}: ModalBaseProps) {
  const reduced = useReducedMotionPref()
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Esc + close-modals event + scroll lock + focus management, only while open.
  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const unlock = lockScroll()
    const close = () => onCloseRef.current()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const panel = panelRef.current
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0] as HTMLElement
      const last = nodes[nodes.length - 1] as HTMLElement
      const active = document.activeElement
      const inside = panel.contains(active)
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(CLOSE_MODALS_EVENT, close)
    // Focus the preferred control after the panel paints.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(CLOSE_MODALS_EVENT, close)
      unlock()
      const opener = openerRef.current
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [open])

  const onBackdrop = useCallback(() => {
    if (dismissible) onCloseRef.current()
  }, [dismissible])

  return (
    <AnimatePresence>
      {open ? (
        <PresenceGuard key="backdrop">
          {(present) => (
            <motion.div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-charcoal-800/75 p-4 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.08 : 0.18 }}
              style={{ pointerEvents: present ? undefined : 'none' }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) onBackdrop()
              }}
            >
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
                transition={reduced ? { duration: 0.1 } : { type: 'spring', stiffness: 420, damping: 30 }}
                className={cn(
                  'flex max-h-[min(88dvh,900px)] w-full flex-col rounded-2xl border-2 border-charcoal-400 border-l-4 bg-charcoal-600 shadow-[0_4px_0_#0e0e0f,0_24px_60px_rgba(0,0,0,0.5)] outline-none',
                  STRIPE_CLASS[stripe],
                  SIZES[size],
                  className,
                )}
              >
                <header className="flex items-center justify-between gap-3 border-b border-charcoal-400/70 px-4 py-2.5">
                  <h2 id={titleId} className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
                    {icon ? <span className="text-smoke-600 [&>svg]:size-4">{icon}</span> : null}
                    {title}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-smoke-600">
                    {right}
                    <button
                      type="button"
                      onClick={() => onCloseRef.current()}
                      aria-label="Close dialog"
                      className="grid size-7 place-items-center rounded-comfy text-smoke-800 transition-colors hover:bg-charcoal-500 hover:text-smoke-100"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                </header>
                <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', bodyClassName)}>{children}</div>
                {footer ? (
                  <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-charcoal-400/70 px-4 py-3">
                    {footer}
                  </footer>
                ) : null}
              </motion.div>
            </motion.div>
          )}
        </PresenceGuard>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Reports whether the modal is still mounted for real or only lingering for its exit animation.
 * While it fades out the backdrop must stop swallowing clicks, otherwise a Generate click
 * landing in that window hits the invisible overlay instead of the button underneath.
 */
function PresenceGuard({ children }: { children: (present: boolean) => ReactNode }) {
  const present = useIsPresent()
  return <>{children(present)}</>
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** Uppercase 11 px tracking label, like a ComfyUI node title. */
export function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600', className)}>{children}</p>
}

export type ModalButtonTone = 'primary' | 'secondary' | 'sapphire' | 'danger' | 'ghost'
export type ModalButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_TONE: Record<ModalButtonTone, string> = {
  primary:
    'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_3px_0_#8a9a00] hover:brightness-105 active:translate-y-[2px] active:shadow-none',
  sapphire:
    'border-sapphire-700 bg-sapphire-700 text-smoke-100 shadow-[0_3px_0_#0b1a80] hover:brightness-110 active:translate-y-[2px] active:shadow-none',
  secondary: 'border-charcoal-400 bg-charcoal-500 text-smoke-100 hover:border-charcoal-300 hover:bg-charcoal-400',
  ghost: 'border-transparent bg-transparent text-smoke-600 hover:bg-charcoal-500 hover:text-smoke-100',
  danger: 'border-slot-vae/40 bg-charcoal-500 text-slot-vae hover:border-slot-vae hover:bg-slot-vae/10',
}

const BUTTON_SIZE: Record<ModalButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-sm',
}

export interface ModalButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ModalButtonTone
  size?: ModalButtonSize
}

/** Chunky rounded-square button in the brand's flavours. */
export function ModalButton({ tone = 'secondary', size = 'md', className, children, ...props }: ModalButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-comfy border font-semibold whitespace-nowrap transition-[filter,transform,background-color,border-color,box-shadow,color] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_3px_0_#8a9a00] [&>svg]:shrink-0',
        BUTTON_TONE[tone],
        BUTTON_SIZE[size],
        className,
      )}
    >
      {children}
    </button>
  )
}

export interface HoldToConfirmProps {
  /** Runs once the pointer (or Space/Enter) has been held for `holdMs`. */
  onConfirm: () => void
  label: string
  holdingLabel?: string
  holdMs?: number
  tone?: 'primary' | 'danger'
  icon?: ReactNode
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Hold-to-confirm, after Kokonut's hold-button: a fill sweeps across while the pointer is down
 * and the action fires when it reaches the far edge. Releasing early cancels. Keyboard users hold
 * Space or Enter the same way.
 */
export function HoldToConfirm({
  onConfirm,
  label,
  holdingLabel = 'Keep holding…',
  holdMs = 1500,
  tone = 'danger',
  icon,
  disabled,
  className,
  ...aria
}: HoldToConfirmProps) {
  const controls = useAnimation()
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onConfirmRef = useRef(onConfirm)
  useEffect(() => {
    onConfirmRef.current = onConfirm
  })

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
    controls.stop()
    void controls.start({ width: '0%', transition: { duration: 0.12 } })
  }, [controls])

  const start = useCallback(() => {
    if (disabled || timer.current) return
    setHolding(true)
    controls.set({ width: '0%' })
    void controls.start({
      width: '100%',
      transition: { duration: holdMs / 1000, ease: 'linear' },
    })
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      controls.set({ width: '0%' })
      onConfirmRef.current()
    }, holdMs)
  }, [controls, disabled, holdMs])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const danger = tone === 'danger'
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      aria-label={aria['aria-label'] ?? `${label} (hold for ${(holdMs / 1000).toFixed(1)} seconds)`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          start()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') cancel()
      }}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'relative inline-flex h-11 min-w-44 touch-none items-center justify-center overflow-hidden rounded-comfy border px-4 text-sm font-semibold select-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'border-slot-vae/50 bg-charcoal-500 text-slot-vae hover:border-slot-vae'
          : 'border-electric-400/60 bg-charcoal-500 text-electric-400 hover:border-electric-400',
        className,
      )}
    >
      <motion.span
        aria-hidden="true"
        animate={controls}
        initial={{ width: '0%' }}
        className={cn('absolute top-0 left-0 h-full', danger ? 'bg-slot-vae/25' : 'bg-electric-400/25')}
      />
      <span className="relative z-10 flex items-center gap-2 [&>svg]:shrink-0">
        {icon}
        {holding ? holdingLabel : label}
      </span>
    </button>
  )
}
