'use client'
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import { useGame, useGameEvents } from '@/state/useGame'
import { formatCps, formatNum } from '@/game/format'
import { NumberTicker } from '@/components/common/NumberTicker'
import { Tooltip } from '@/components/common/Tooltip'
import { creditsTip } from '@/components/common/tooltipCopy'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { cn } from '@/lib/utils'

interface Props {
  /** `lg` is the hero odometer (44 px, Inter 800); `md` fits a header row. */
  size?: 'lg' | 'md'
  /** Render the +cps rate next to the number (default true); the header passes false and draws its own. */
  showCps?: boolean
  className?: string
}

/** Owned hardware units, for the tooltip's "from N units" line. A number, so the 20 Hz loop is free. */
function useOwnedUnits(): number {
  return useGame((s) => {
    let n = 0
    for (const id in s.hardware) n += s.hardware[id] ?? 0
    return n
  })
}

/**
 * The bank balance as a smoothly rolling number with the credits glyph in amber and the income
 * rate underneath. Pulses once whenever cps crosses a power of ten (engine `milestone` event).
 */
export function CreditsCounter({ size = 'lg', showCps = true, className }: Props) {
  const credits = useGame((s) => Math.floor(s.credits))
  const cps = useGame((_, d) => d.cps)
  const units = useOwnedUnits()
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const prefersReduced = useReducedMotion()
  const reduced = reducedSetting || prefersReduced === true
  const pulse = useAnimationControls()

  useGameEvents((e) => {
    if (e.type !== 'milestone' || reduced) return
    void pulse.start({
      scale: [1, 1.08, 1],
      textShadow: ['0 0 0 rgba(240,255,65,0)', '0 0 28px rgba(240,255,65,0.65)', '0 0 0 rgba(240,255,65,0)'],
      transition: { duration: 0.7, ease: 'easeOut' },
    })
  })

  if (size === 'md') {
    return (
      <Tooltip {...creditsTip(cps, units)} side="bottom">
        <div className={cn('flex items-baseline gap-2 whitespace-nowrap', className)} aria-live="off">
          <span className="flex items-center gap-1.5 text-lg font-extrabold tracking-tight text-smoke-100 tabular-nums">
            <CreditsIcon size={16} className="shrink-0 text-credits" />
            <NumberTicker value={credits} />
          </span>
          {showCps ? <span className="text-xs font-semibold text-smoke-600 tabular-nums">+{formatCps(cps)}</span> : null}
        </div>
      </Tooltip>
    )
  }

  return (
    <Tooltip {...creditsTip(cps, units)} side="bottom">
      <div className={cn('flex flex-col items-center gap-1', className)}>
        <motion.div
          animate={pulse}
          className="flex items-center gap-2.5 text-[44px] font-extrabold leading-none tracking-tight text-smoke-100 tabular-nums"
          aria-label={`${formatNum(credits)} credits`}
        >
          <CreditsIcon size={34} className="shrink-0 text-credits" />
          <NumberTicker value={credits} />
        </motion.div>
        <div className="flex items-center gap-2 text-sm font-semibold text-smoke-600">
          <span className="text-[11px] uppercase tracking-[0.08em]">credits</span>
          {showCps ? (
            <>
              <span className="h-1 w-1 rounded-full bg-charcoal-300" aria-hidden="true" />
              <span className="tabular-nums text-credits">+{formatCps(cps)}</span>
            </>
          ) : null}
        </div>
      </div>
    </Tooltip>
  )
}
