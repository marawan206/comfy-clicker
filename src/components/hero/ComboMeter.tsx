'use client'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Flame } from 'lucide-react'
import { useGame, useGameEvents } from '@/state/useGame'
import { cn } from '@/lib/utils'

/** Two clicks belong to the same combo when no more than this many ms pass between them. */
export const COMBO_GAP_MS = 400
/** Show the counter from the first tier; each tier restyles the pill. */
export const COMBO_TIERS = [10, 25, 50] as const

function tierOf(n: number): number {
  let tier = 0
  for (const t of COMBO_TIERS) if (n >= t) tier++
  return tier
}

/**
 * Counts rapid clicks (≤ 400 ms apart) and shows "combo ×N" once a streak reaches 10; the pill
 * turns amber at 25 and shimmers electric at 50. The thin bar underneath drains over the gap
 * window so the player can see how long they have to keep the streak alive.
 */
export function ComboMeter({ className }: { className?: string }) {
  const [combo, setCombo] = useState(0)
  const comboRef = useRef(0)
  const lastAt = useRef(0)
  const timer = useRef<number>(0)
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const prefersReduced = useReducedMotion()
  const reduced = reducedSetting || prefersReduced === true

  useGameEvents((e) => {
    if (e.type !== 'click') return
    const now = performance.now()
    const next = now - lastAt.current <= COMBO_GAP_MS ? comboRef.current + 1 : 1
    lastAt.current = now
    comboRef.current = next
    // Only re-render when the visible pill would change (hidden below 10, then every click).
    if (next >= COMBO_TIERS[0] || combo !== 0) setCombo(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      comboRef.current = 0
      setCombo(0)
    }, COMBO_GAP_MS)
  })

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const visible = combo >= COMBO_TIERS[0]
  const tier = tierOf(combo)
  const milestone = (COMBO_TIERS as readonly number[]).includes(combo)

  return (
    <div className={cn('pointer-events-none flex flex-col items-center', className)} aria-live="off">
      <AnimatePresence>
        {visible && (
          <motion.div
            key="combo"
            initial={reduced ? false : { opacity: 0, scale: 0.8, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            className="flex flex-col items-center gap-1"
          >
            <motion.div
              key={milestone ? `pop-${combo}` : 'steady'}
              initial={milestone && !reduced ? { scale: 1.35 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 18 }}
              className={cn(
                'flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-extrabold tracking-tight tabular-nums shadow-[0_3px_0_#0e0e0f]',
                tier >= 3
                  ? 'border-electric-400 bg-charcoal-700 text-electric-400'
                  : tier >= 2
                    ? 'border-credits/70 bg-charcoal-700 text-credits'
                    : 'border-charcoal-300 bg-charcoal-700 text-smoke-100',
              )}
            >
              <Flame size={14} className={tier >= 2 ? 'text-credits' : 'text-smoke-600'} aria-hidden="true" />
              <span
                className={cn(
                  tier >= 3 &&
                    'cc-shimmer bg-gradient-to-r from-electric-400 via-smoke-100 to-electric-400 bg-clip-text text-transparent',
                )}
              >
                combo ×{combo}
              </span>
            </motion.div>
            <span className="h-0.5 w-16 overflow-hidden rounded-full bg-charcoal-400" aria-hidden="true">
              <motion.span
                key={combo}
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: COMBO_GAP_MS / 1000, ease: 'linear' }}
                className={cn('block h-full w-full origin-left', tier >= 3 ? 'bg-electric-400' : tier >= 2 ? 'bg-credits' : 'bg-smoke-600')}
              />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
