'use client'
/**
 * Power draw against the breaker budget. The bar shifts from calm blue through amber to red as
 * the rack approaches the limit; once tripped, income scales by budget/draw and a banner offers
 * the Power tab of the store. `compact` renders the header chip ("⚡ 640/650 W").
 */
import { AlertTriangle, Zap } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useGame, useGameShallow } from '@/state/useGame'
import { formatWatts } from '@/game/format'
import { Panel } from '@/components/common/Panel'
import { Tooltip } from '@/components/common/Tooltip'
import { powerTip } from '@/components/common/tooltipCopy'
import { openStoreTab } from '@/components/store/storeHooks'
import { cn } from '@/lib/utils'

export interface PowerMeterProps {
  compact?: boolean
}

const CALM = '#64b5f6'
const AMBER = '#ffa931'
const RED = '#ff6e6e'

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a)
  const [br, bg, bb] = hex(b)
  const k = Math.min(1, Math.max(0, t))
  const r = Math.round(ar + (br - ar) * k)
  const g = Math.round(ag + (bg - ag) * k)
  const bl = Math.round(ab + (bb - ab) * k)
  return `rgb(${r} ${g} ${bl})`
}

/** Calm below 60 % load, amber by 80 %, red at the breaker. */
function loadColor(load: number): string {
  if (load >= 1) return RED
  if (load < 0.6) return CALM
  if (load < 0.8) return mix(CALM, AMBER, (load - 0.6) / 0.2)
  return mix(AMBER, RED, (load - 0.8) / 0.2)
}

function statusWord(load: number, throttled: boolean): string {
  if (throttled) return 'Breaker tripped'
  if (load >= 0.9) return 'Near the limit'
  if (load >= 0.7) return 'Warm'
  return 'Nominal'
}

interface PowerSlice {
  draw: number
  budget: number
  throttled: boolean
}

function usePower(): PowerSlice {
  return useGameShallow((_s, d) => ({
    draw: d.powerDraw,
    budget: d.powerBudget,
    throttled: d.throttled,
  }))
}

export function PowerMeter({ compact = false }: PowerMeterProps) {
  const { draw, budget, throttled } = usePower()
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const reduced = Boolean(useReducedMotion()) || reducedSetting
  const load = budget > 0 ? draw / budget : draw > 0 ? Infinity : 0
  const color = loadColor(load)
  const pct = Math.min(100, Math.max(0, (Number.isFinite(load) ? load : 1) * 100))
  const mult = throttled && draw > 0 ? budget / draw : 1
  const label = `${formatWatts(draw)} / ${formatWatts(budget)}`

  if (compact) {
    return (
      <Tooltip {...powerTip({ draw, budget, throttled })} side="bottom">
        <button
          type="button"
          onClick={() => openStoreTab('power')}
          aria-label={`Power ${label}. ${statusWord(load, throttled)}. Open the power store`}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-charcoal-400 bg-charcoal-700 px-2.5 text-xs font-semibold tabular-nums text-smoke-100 outline-none hover:border-charcoal-300 focus-visible:ring-2 focus-visible:ring-electric-400',
            throttled && 'border-slot-vae/60',
          )}
        >
          <Zap size={14} style={{ color }} fill={throttled ? color : 'none'} aria-hidden="true" />
          <span>
            {formatWatts(draw).replace(/ (k|M|G)?W$/, '')}
            <span className="text-smoke-600">/{formatWatts(budget)}</span>
          </span>
        </button>
      </Tooltip>
    )
  }

  return (
    <Panel
      stripe="vae"
      title="Power"
      right={
        <Tooltip {...powerTip({ draw, budget, throttled })} side="left">
          <span className="flex items-center gap-1.5 tabular-nums text-smoke-100">
            <Zap size={12} style={{ color }} fill={throttled ? color : 'none'} aria-hidden="true" />
            {label}
          </span>
        </Tooltip>
      }
      bodyClassName="flex flex-col gap-3 p-4"
    >
      <div
        role="meter"
        aria-label="Power draw"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(draw, budget)}
        aria-valuetext={label}
        className="relative h-3 w-full overflow-hidden rounded-full border border-charcoal-400 bg-charcoal-800"
      >
        <motion.div
          className={cn('absolute inset-y-0 left-0 rounded-full', throttled && !reduced && 'cc-striped')}
          initial={false}
          animate={{ width: `${pct}%`, backgroundColor: color }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 24 }}
          style={{ '--cc-stripe': 'rgb(0 0 0 / 0.22)' } as React.CSSProperties}
        />
        <span aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-smoke-100/40" />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-[0.08em]" style={{ color }}>
          {statusWord(load, throttled)}
        </span>
        <span className="tabular-nums text-smoke-600">
          {throttled ? `${formatWatts(draw - budget)} over` : `${formatWatts(budget - draw)} headroom`}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {throttled && (
          <motion.div
            key="tripped"
            role="alert"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="flex items-center gap-3 rounded-xl border-2 border-slot-vae/60 bg-slot-vae/10 px-3 py-2"
          >
            <AlertTriangle size={18} className="shrink-0 text-slot-vae" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-smoke-100">Breaker tripped</p>
              <p className="text-xs text-smoke-600">
                Income at <span className="font-semibold tabular-nums text-slot-vae">{Math.round(mult * 100)}%</span> until the rack fits the circuit.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openStoreTab('power')}
              className="shrink-0 cursor-pointer rounded-lg bg-electric-400 px-3 py-1.5 text-xs font-bold text-charcoal-800 shadow-[0_3px_0_#0e0e0f] outline-none hover:brightness-105 focus-visible:ring-2 focus-visible:ring-electric-400 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-600 active:translate-y-0.5 active:shadow-[0_1px_0_#0e0e0f]"
            >
              Buy a PSU
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}
