'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { MousePointerClick } from 'lucide-react'
import { useGame, useGameShallow } from '@/state/useGame'
import { formatCps, formatNum } from '@/game/format'
import { CLICK_LINES } from '@/data/flavor'
import { Panel } from '@/components/common/Panel'
import { Tooltip } from '@/components/common/Tooltip'
import { incomeTip } from '@/components/common/tooltipCopy'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { CreditsCounter } from '@/components/hero/CreditsCounter'
import { ComboMeter } from '@/components/hero/ComboMeter'
import { GenerateButton, formatClickValue } from '@/components/hero/GenerateButton'

const FLAVOR_ROTATE_MS = 4200

/** The console line under the button: a new ComfyUI status every few seconds, crossfaded. */
function FlavorLine({ reduced }: { reduced: boolean }) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * CLICK_LINES.length))
  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % CLICK_LINES.length), FLAVOR_ROTATE_MS)
    return () => window.clearInterval(id)
  }, [])
  const line = CLICK_LINES[index] ?? CLICK_LINES[0]
  return (
    <div className="flex h-5 items-center gap-2 text-xs font-medium text-smoke-600" aria-live="off">
      <span className="text-electric-400/80" aria-hidden="true">
        ›
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={index}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="truncate"
        >
          {line}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

/**
 * The two numbers a new player needs in one line: what a click pays and what the rack pays while
 * they do nothing. Both come from `derived`, so they already carry every multiplier.
 */
function RateLine() {
  const clickValue = useGame((_s, d) => d.clickValue)
  const income = useGameShallow((_s, d) => ({ cps: d.cps, throttled: d.throttled, draw: d.powerDraw, budget: d.powerBudget }))
  return (
    <Tooltip {...incomeTip(income)} side="bottom">
      <p className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-smoke-600">
        <CreditsIcon size={12} className="shrink-0 text-credits" aria-hidden="true" />
        <span className="text-credits">+{formatClickValue(clickValue)}</span>
        <span>per click</span>
        <span className="h-1 w-1 rounded-full bg-charcoal-300" aria-hidden="true" />
        <span className={income.throttled ? 'text-slot-vae' : 'text-credits'}>+{formatCps(income.cps)}</span>
        <span>idle</span>
      </p>
    </Tooltip>
  )
}

/**
 * Left-column hero: the big credits odometer, the logo click target with its aura and pill,
 * the combo pill riding its shoulder, and a rotating ComfyUI console line.
 */
export function HeroPanel() {
  const totalClicks = useGame((s) => s.totalClicks)
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const prefersReduced = useReducedMotion()
  const reduced = reducedSetting || prefersReduced === true

  return (
    <Panel
      stripe="electric"
      title="Generate"
      right={
        <span className="flex items-center gap-1.5 tabular-nums">
          <MousePointerClick size={12} aria-hidden="true" />
          {formatNum(totalClicks)} clicks
        </span>
      }
      className="relative overflow-hidden"
      bodyClassName="relative flex flex-col items-center gap-4 px-4 pb-4 pt-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgba(23,45,215,0.22),transparent_70%)]"
      />
      <div className="relative flex flex-col items-center gap-1.5">
        <CreditsCounter size="lg" showCps={false} />
        <RateLine />
      </div>
      <div className="relative">
        <GenerateButton />
        <ComboMeter className="absolute -right-6 -top-3" />
      </div>
      <FlavorLine reduced={reduced} />
    </Panel>
  )
}
