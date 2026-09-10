'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { MousePointerClick } from 'lucide-react'
import { useGame } from '@/state/useGame'
import { formatNum } from '@/game/format'
import { CLICK_LINES } from '@/data/flavor'
import { Panel } from '@/components/common/Panel'
import { CreditsCounter } from '@/components/hero/CreditsCounter'
import { GenerateButton } from '@/components/hero/GenerateButton'
import { ComboMeter } from '@/components/hero/ComboMeter'

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
      bodyClassName="relative flex flex-col items-center gap-5 px-4 pb-5 pt-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgba(23,45,215,0.22),transparent_70%)]"
      />
      <CreditsCounter size="lg" className="relative" />
      <div className="relative">
        <GenerateButton />
        <ComboMeter className="absolute -right-6 -top-3" />
      </div>
      <FlavorLine reduced={reduced} />
    </Panel>
  )
}
