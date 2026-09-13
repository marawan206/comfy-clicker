'use client'
/**
 * The level-up card.
 *
 * `settleLevelUps` pays one level at a time and emits one `levelUp` per level, so a player who
 * crosses two thresholds on the same tick (the reward credits can push them over the next one)
 * gets two events a frame apart. Showing two cards in a row would read as a bug, so the banner
 * merges anything that arrives while it is already up: the headline becomes `Level 4 to 6`, the
 * credits add up and the unlock tiles concatenate in level order.
 *
 * Mounted in `Overlays`, which every route carries, so a level earned while reading the Graph is
 * still announced where it happened. Confetti and the electric flash are `FxCanvas`'s job (it maps
 * `levelUp` itself); this file only owns the card and never fires FX of its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { ChevronsUp } from 'lucide-react'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { runGuideAction } from '@/components/guidance/navigate'
import { ModalButton, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { formatNum } from '@/game/format'
import { levelTitle } from '@/game/level'
import type { ModelDef } from '@/game/types'
import { useGameEvents, useGameStore } from '@/state/useGame'

/** How long the card stays before it dismisses itself. */
export const LEVEL_UP_MS = 5_000

interface Run {
  /** First level of the run; equals `to` for the usual single level-up. */
  from: number
  to: number
  credits: number
  unlocked: string[]
  /** Bumped on every merge so the dismiss timer restarts and the entry animation replays. */
  nonce: number
}

export function LevelUpBanner() {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const router = useRouter()
  const [run, setRun] = useState<Run | null>(null)
  const timer = useRef<number | null>(null)

  const dismiss = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setRun(null)
  }, [])

  useGameEvents((event) => {
    if (event.type !== 'levelUp') return
    setRun((prev) =>
      prev === null
        ? { from: event.level, to: event.level, credits: event.credits, unlocked: [...event.unlocked], nonce: 1 }
        : {
            from: Math.min(prev.from, event.level),
            to: Math.max(prev.to, event.level),
            credits: prev.credits + event.credits,
            unlocked: [...prev.unlocked, ...event.unlocked],
            nonce: prev.nonce + 1,
          },
    )
  })

  // One timer per run, restarted by the nonce so a merged second level-up gets its full five
  // seconds instead of inheriting whatever was left of the first one's.
  useEffect(() => {
    if (!run) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setRun(null)
    }, LEVEL_UP_MS)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [run])

  const models: ModelDef[] = useMemo(() => {
    if (!run) return []
    const byId = new Map(store.catalog.models.map((m) => [m.id, m]))
    const out: ModelDef[] = []
    for (const id of run.unlocked) {
      const def = byId.get(id)
      if (def) out.push(def)
    }
    return out
  }, [run, store])

  const showMe = useCallback(() => {
    const first = models[0]
    dismiss()
    if (!first) return
    runGuideAction({ type: 'store', tab: 'models', focusId: first.id }, router)
  }, [models, dismiss, router])

  const range = run !== null && run.to > run.from

  return (
    <AnimatePresence>
      {run ? (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div
            key="level-up"
            role="status"
            aria-live="polite"
            onClick={dismiss}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -10 }}
            transition={reduced ? { duration: 0.1 } : { type: 'spring', stiffness: 380, damping: 26 }}
            className="pointer-events-auto w-full max-w-[420px] cursor-pointer rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-slot-mask bg-charcoal-600 p-5 text-center shadow-[0_4px_0_#0e0e0f,0_24px_60px_rgba(0,0,0,0.5)]"
          >
            <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold tracking-[0.16em] text-electric-400 uppercase">
              <ChevronsUp size={14} aria-hidden="true" />
              Level up
            </p>
            <p className="mt-1 text-[40px] leading-none font-extrabold tracking-tight text-smoke-100 tabular-nums">
              {range ? (
                <>
                  {run.from} <span className="text-2xl text-smoke-600">to</span> {run.to}
                </>
              ) : (
                run.to
              )}
            </p>
            <p className="mt-1 text-sm font-semibold text-smoke-100">{levelTitle(run.to)}</p>

            {models.length > 0 ? (
              <ul className="mt-4 flex flex-wrap items-start justify-center gap-3">
                {models.map((m) => (
                  <li key={m.id} className="flex w-[76px] flex-col items-center gap-1">
                    <Art id={`model-${m.id}`} size={40} alt="" />
                    <span className="text-[11px] leading-tight font-semibold text-smoke-600">{m.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-smoke-600">No new model at this one. The credits are real.</p>
            )}

            <p className="mt-4 flex items-center justify-center gap-1 text-lg font-extrabold text-credits tabular-nums">
              <CreditsIcon size={16} aria-hidden="true" />+{formatNum(run.credits)}
            </p>

            <div className="mt-4 flex items-center justify-center gap-2">
              {models.length > 0 ? (
                <ModalButton
                  tone="primary"
                  size="sm"
                  data-autofocus
                  onClick={(e) => {
                    e.stopPropagation()
                    showMe()
                  }}
                >
                  Show me
                </ModalButton>
              ) : null}
              <ModalButton
                tone="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  dismiss()
                }}
              >
                Later
              </ModalButton>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}
