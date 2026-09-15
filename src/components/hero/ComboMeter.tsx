'use client'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Flame } from 'lucide-react'
import { useGame, useGameEvents } from '@/state/useGame'
import { comboTier, isComboTierUp, nextComboTier } from '@/game/combo'
import { COMBO_GAP_MS, COMBO_TIERS } from '@/game/constants'
import { cn } from '@/lib/utils'

/** How long the pill reads `MAX` after the engine refuses a click for going over the rate cap. */
const MAX_FLASH_MS = 600
/** The top tier's colour, the pink of the aura; there is no palette token for it. */
const PINK = '#ff9cf9'

/** Reads `×2` for a whole multiplier and `×1.25` otherwise. */
export function formatMult(mult: number): string {
  return `×${Number.isInteger(mult) ? mult : mult.toFixed(2).replace(/0+$/, '')}`
}

/**
 * The combo pill. It reads the streak off the engine's `click` event (`combo`, `mult`) rather
 * than counting clicks itself, so what it says is exactly what the click paid: `combo ×N` from
 * the first tier, then the tier's multiplier as a badge. Amber at 25, electric at 50, pink at
 * 100; the click that reaches a tier pops the pill. The thin bar underneath drains over the gap
 * window so the player can see how long they have to keep the streak alive, and under the pill,
 * before the first tier is paid, a hint says what the next tier is worth.
 *
 * The same pill is where a refused click surfaces: past `CLICK_CAP_PER_SEC` in a second the engine
 * stops paying, and the pill says `MAX` for 600 ms instead of a combo. Nothing else changes,
 * because nothing else happened: the click simply did not count, and the next one inside the
 * window will.
 */
export function ComboMeter({ className }: { className?: string }) {
  const [combo, setCombo] = useState(0)
  const [mult, setMult] = useState(1)
  const [capped, setCapped] = useState(false)
  const timer = useRef<number>(0)
  const capTimer = useRef<number>(0)
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const prefersReduced = useReducedMotion()
  const reduced = reducedSetting || prefersReduced === true
  const first = COMBO_TIERS[0]?.at ?? 10

  useGameEvents((e) => {
    if (e.type === 'clickBlocked') {
      // The rate cap is the only reason a click is ever refused, and this pill is where it shows.
      setCapped(true)
      window.clearTimeout(capTimer.current)
      capTimer.current = window.setTimeout(() => setCapped(false), MAX_FLASH_MS)
      return
    }
    if (e.type !== 'click') return
    // Re-render only once the pill is visible: below the first tier it is hidden, and a re-render
    // per click at 20 Hz for nothing is what the selectors rule is about.
    setCombo((prev) => (e.combo >= first || prev !== 0 ? e.combo : prev))
    setMult(e.mult)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setCombo(0)
      setMult(1)
    }, COMBO_GAP_MS)
  })

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      window.clearTimeout(capTimer.current)
    },
    [],
  )

  const visible = capped || combo >= first
  const tier = comboTier(combo)
  const tierUp = isComboTierUp(combo)
  const next = nextComboTier(combo)
  const top = tier >= COMBO_TIERS.length
  const colour = capped ? 'text-slot-vae' : top ? 'text-[#ff9cf9]' : tier >= 3 ? 'text-electric-400' : tier >= 2 ? 'text-credits' : 'text-smoke-100'
  const border = capped ? 'border-slot-vae' : top ? 'border-[#ff9cf9]' : tier >= 3 ? 'border-electric-400' : tier >= 2 ? 'border-credits/70' : 'border-charcoal-300'
  const bar = top ? PINK : tier >= 3 ? '#f0ff41' : tier >= 2 ? undefined : undefined

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
              key={capped ? 'capped' : tierUp ? `pop-${combo}` : 'steady'}
              initial={tierUp && !reduced ? { scale: 1.6, rotate: tier >= 3 ? -6 : 0 } : false}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 16 }}
              className={cn(
                'flex items-center gap-1.5 rounded-full border-2 bg-charcoal-700 px-3 py-1 text-sm font-extrabold tracking-tight tabular-nums shadow-[0_3px_0_#0e0e0f]',
                border,
                colour,
              )}
            >
              <Flame size={14} className={capped ? 'text-slot-vae' : tier >= 2 ? colour : 'text-smoke-600'} aria-hidden="true" />
              <span
                className={cn(
                  !capped && tier >= 3 && !top && 'cc-shimmer bg-gradient-to-r from-electric-400 via-smoke-100 to-electric-400 bg-clip-text text-transparent',
                )}
              >
                {capped ? 'MAX' : `combo ×${combo}`}
              </span>
              {!capped && mult > 1 && (
                <span
                  className={cn(
                    'rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide',
                    top ? 'border-[#ff9cf9]/60 bg-[#ff9cf9]/15' : tier >= 3 ? 'border-electric-400/60 bg-electric-400/15' : 'border-credits/60 bg-credits/15',
                  )}
                  title={`Every click in this streak pays ${formatMult(mult)}`}
                >
                  {formatMult(mult)} pay
                </span>
              )}
            </motion.div>
            <span className="h-0.5 w-16 overflow-hidden rounded-full bg-charcoal-400" aria-hidden="true">
              <motion.span
                key={combo}
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: COMBO_GAP_MS / 1000, ease: 'linear' }}
                className={cn('block h-full w-full origin-left', tier >= 2 && !bar && 'bg-credits', tier < 2 && 'bg-smoke-600')}
                style={bar ? { backgroundColor: bar } : undefined}
              />
            </span>
            {!capped && next && (
              <span className="text-[10px] font-semibold tabular-nums text-smoke-700">
                {formatMult(next.mult)} at {next.at}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
