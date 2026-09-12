'use client'
import { motion } from 'motion/react'
import { PiggyBank } from 'lucide-react'
import type { HardwareFamily } from '@/game/types'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { formatDuration, formatNum } from '@/game/format'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { useReducedMotionPref, useSaveTarget } from './storeHooks'

interface Props {
  /** Called with the target's family so the tab can jump to its shelf. */
  onSelectFamily?: (family: HardwareFamily) => void
}

/** "Next: RTX 4090 in 0:48": the cheapest unit you can't afford yet, with a progress bar toward it. */
export function SaveForBar({ onSelectFamily }: Props) {
  const store = useGameStore()
  const target = useSaveTarget()
  const reduced = useReducedMotionPref()

  if (!target) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-lg border border-dashed border-charcoal-400 px-2.5 text-[11px] text-smoke-700">
        <PiggyBank size={14} aria-hidden="true" />
        <span>Everything in reach is affordable. Spend it.</span>
      </div>
    )
  }

  const def = buildIndex(store.catalog).hardwareById[target.id]
  const eta = Number.isFinite(target.etaSec) ? `in ${formatDuration(target.etaSec)}` : 'no income yet'

  return (
    <button
      type="button"
      onClick={() => onSelectFamily?.(target.family)}
      aria-label={`Saving for ${target.name}: ${formatNum(target.cost)} credits, ${target.pct}% there, ${eta}`}
      title="Jump to this unit"
      className="group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg border border-charcoal-400 bg-charcoal-700 px-2.5 py-1.5 text-left transition-colors hover:border-charcoal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
    >
      <motion.span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 origin-left bg-electric-400/12"
        style={{ width: '100%' }}
        animate={{ scaleX: target.pct / 100 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 24 }}
      />
      {def && <Art id={def.art} size={28} className="relative shrink-0" />}
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-semibold tracking-[0.08em] text-smoke-700 uppercase">Next</span>
          <span className="truncate font-semibold text-smoke-100">{target.name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-smoke-600">{eta}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-charcoal-400">
            <motion.div
              className="h-full origin-left rounded-full bg-electric-400"
              style={{ width: '100%' }}
              animate={{ scaleX: target.pct / 100 }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 24 }}
            />
          </div>
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-extrabold tabular-nums text-credits">
            <CreditsIcon size={11} />
            {formatNum(target.cost)}
          </span>
        </div>
      </div>
    </button>
  )
}
