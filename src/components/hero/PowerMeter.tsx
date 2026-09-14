'use client'
/**
 * Power draw against the breaker budget. The bar shifts from calm blue through amber to red as
 * the rack approaches the limit; once tripped, every rig stops earning and the banner turns into
 * the fix: the supplies that are actually for sale, cheapest first, each saying whether it clears
 * the breaker on its own, bought straight from the banner. `compact` renders the header chip
 * ("⚡ 640/650 W"), and `inStore` drops the "Open the Power tab" link for the copy of the meter
 * that already lives in that tab.
 */
import { useMemo } from 'react'
import { AlertTriangle, Zap } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'
import { formatWatts } from '@/game/format'
import { Panel } from '@/components/common/Panel'
import { Tooltip } from '@/components/common/Tooltip'
import { powerTip } from '@/components/common/tooltipCopy'
import { openStoreTab, useVisibleUpgrades } from '@/components/store/storeHooks'
import { UpgradeRow } from '@/components/store/UpgradeRow'
import { buildIndex } from '@/game/catalog'
import { cn } from '@/lib/utils'

export interface PowerMeterProps {
  compact?: boolean
  /** True for the meter rendered inside the store's Power tab, where a link to that tab is noise. */
  inStore?: boolean
}

/** Supplies offered in the tripped banner. Three is a choice; the whole ladder is a shop. */
const PSU_CHOICES = 3

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

export function PowerMeter({ compact = false, inStore = false }: PowerMeterProps) {
  const { draw, budget, throttled } = usePower()
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const reduced = Boolean(useReducedMotion()) || reducedSetting
  const load = budget > 0 ? draw / budget : draw > 0 ? Infinity : 0
  const color = loadColor(load)
  const pct = Math.min(100, Math.max(0, (Number.isFinite(load) ? load : 1) * 100))
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
            className="flex flex-col gap-2 rounded-xl border-2 border-slot-vae/60 bg-slot-vae/10 px-3 py-2"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-slot-vae" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-smoke-100">Breaker tripped</p>
                <p className="text-xs text-smoke-600">
                  Every rig is <span className="font-semibold text-slot-vae">off</span> and passive income is zero until the rack fits the circuit.
                  Clicks still pay.
                </p>
              </div>
            </div>
            <BreakerFix draw={draw} budget={budget} inStore={inStore} />
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}

/**
 * The way out of a tripped breaker, in the banner rather than one tab away.
 *
 * "Buy a PSU" used to switch the store to its Power tab, which did nothing visible when the meter
 * was already in that tab and never said which supply to buy. These are the supplies actually on
 * sale, cheapest first, each tagged with what it adds and whether it clears the breaker on its own.
 * The rows are the store's own `UpgradeRow`, so buying, the price, the "not enough credits"
 * popover and the disabled styling all behave exactly as they do in the store.
 */
function BreakerFix({ draw, budget, inStore }: { draw: number; budget: number; inStore: boolean }) {
  const store = useGameStore()
  const ids = useVisibleUpgrades('power')
  const options = useMemo(() => {
    const { upgradeById } = buildIndex(store.catalog)
    return ids
      .map((id) => {
        const def = upgradeById[id]
        const watts = def ? def.effects.reduce((sum, e) => (e.kind === 'powerBudget' ? sum + e.value : sum), 0) : 0
        return { id, watts }
      })
      // Cooling upgrades share the Power tab but add no watts, so they are not a fix for this.
      .filter((o) => o.watts > 0)
      .sort((a, b) => a.watts - b.watts)
      .slice(0, PSU_CHOICES)
  }, [ids, store])

  const over = Math.max(0, draw - budget)

  if (options.length === 0) {
    return (
      <p className="text-xs text-smoke-600">
        Nothing bigger is on sale yet. Keep clicking Generate, the next supply shows up as the rack grows.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] text-smoke-600 tabular-nums">
        Needs <span className="font-bold text-slot-vae">{formatWatts(over)}</span> more. Pick a supply:
      </p>
      {options.map((o) => (
        <div key={o.id} className="relative">
          <UpgradeRow id={o.id} />
          <span
            className={cn(
              'pointer-events-none absolute top-1 right-2 rounded-[0.354em] px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
              o.watts >= over ? 'bg-electric-400 text-charcoal-800' : 'bg-charcoal-700 text-smoke-600',
            )}
          >
            {o.watts >= over ? 'clears it' : `${formatWatts(o.watts)} short of it`}
          </span>
        </div>
      ))}
      {inStore ? null : (
        <button
          type="button"
          onClick={() => openStoreTab('power')}
          className="self-start text-[11px] font-semibold text-electric-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
        >
          Open the Power tab
        </button>
      )}
    </div>
  )
}
