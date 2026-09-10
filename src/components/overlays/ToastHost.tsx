'use client'
/**
 * Bottom-right toast stack. Shows the first TOAST_MAX_VISIBLE queued toasts, slides them in with a
 * spring, auto-dismisses each TOAST_DURATION_MS after it becomes visible (paused while hovered),
 * and lets the pointer dismiss early.
 */
import { memo, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useReducedMotionPref } from '@/components/overlays/ModalBase'
import { dismissToast, TOAST_MAX_VISIBLE, useToasts, type Toast, type ToastTone } from '@/components/overlays/useToasts'

const STRIPE: Record<ToastTone, string> = {
  default: 'border-l-charcoal-300',
  electric: 'border-l-electric-400',
  credits: 'border-l-credits',
  sapphire: 'border-l-sapphire-700',
  danger: 'border-l-slot-vae',
  mask: 'border-l-slot-mask',
}

const TITLE: Record<ToastTone, string> = {
  default: 'text-smoke-600',
  electric: 'text-electric-400',
  credits: 'text-credits',
  sapphire: 'text-[#7f8dff]',
  danger: 'text-slot-vae',
  mask: 'text-slot-mask',
}

export function ToastHost() {
  const all = useToasts()
  const visible = all.slice(0, TOAST_MAX_VISIBLE)
  const reduced = useReducedMotionPref()
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col-reverse gap-2"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {visible.map((t) => (
          <ToastCard key={t.id} toast={t} reduced={reduced} />
        ))}
      </AnimatePresence>
    </div>
  )
}

const ToastCard = memo(function ToastCard({ toast, reduced }: { toast: Toast; reduced: boolean }) {
  const remaining = useRef(toast.durationMs)
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss runs from the moment the card is visible; hovering pauses it.
  useEffect(() => {
    const arm = () => {
      startedAt.current = Date.now()
      timer.current = setTimeout(() => dismissToast(toast.id), remaining.current)
    }
    arm()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [toast.id])

  const pause = () => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    remaining.current = Math.max(600, remaining.current - (Date.now() - startedAt.current))
  }
  const resume = () => {
    if (timer.current) return
    startedAt.current = Date.now()
    timer.current = setTimeout(() => dismissToast(toast.id), remaining.current)
  }

  return (
    <motion.div
      layout={!reduced}
      role="status"
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.96 }}
      transition={reduced ? { duration: 0.12 } : { type: 'spring', stiffness: 460, damping: 34 }}
      onPointerEnter={pause}
      onPointerLeave={resume}
      className={cn(
        'pointer-events-auto relative flex items-start gap-3 rounded-2xl border-2 border-charcoal-400 border-l-4 bg-charcoal-600 py-2.5 pr-2 pl-3',
        'shadow-[0_4px_0_#0e0e0f,0_12px_30px_rgba(0,0,0,0.35)]',
        STRIPE[toast.tone],
      )}
    >
      {toast.icon ? (
        <div className="mt-0.5 grid size-10 shrink-0 place-items-center overflow-hidden rounded-comfy bg-charcoal-700 text-smoke-100 [&>svg]:size-5">
          {toast.icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 py-0.5">
        {toast.title ? (
          <p className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', TITLE[toast.tone])}>{toast.title}</p>
        ) : null}
        <p className="text-sm leading-snug font-semibold text-smoke-100">{toast.message}</p>
        {toast.description ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs leading-snug text-smoke-600 [&_svg]:inline-block [&_svg]:shrink-0">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss notification"
        className="grid size-7 shrink-0 place-items-center rounded-comfy text-smoke-800 transition-colors hover:bg-charcoal-500 hover:text-smoke-100"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
})
