'use client'
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { HARDWARE_FAMILIES } from '@/data/hardware'
import type { HardwareFamily } from '@/game/types'
import { useGame, useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { formatCps } from '@/game/format'
import { Panel } from '@/components/common/Panel'
import { cn } from '@/lib/utils'
import { useFamilyDraw, useLocalState, useOwnedHardware, useReducedMotionPref } from '@/components/store/storeHooks'
import { RigRow } from './RigRow'

const COLLAPSED_KEY = 'comfy-clicker:rack-collapsed'
const COLLAPSED_VALUES = ['open', 'closed'] as const

interface Group {
  family: HardwareFamily
  label: string
  ids: string[]
}

/** Below this many units the rack starts collapsed so the Studio gets the first screen. */
const AUTO_OPEN_UNITS = 4

/** Owned hardware grouped by family; collapsible, scrolls inside 22vh, one-line shelf when closed. */
export function RackPanel() {
  const store = useGameStore()
  const owned = useOwnedHardware()
  const totalUnits = useGame((s) => {
    let n = 0
    for (const id in s.hardware) n += s.hardware[id] ?? 0
    return n
  })
  const [state, setState] = useLocalState<(typeof COLLAPSED_VALUES)[number]>(
    COLLAPSED_KEY,
    totalUnits >= AUTO_OPEN_UNITS ? 'open' : 'closed',
    COLLAPSED_VALUES,
  )
  const collapsed = state === 'closed'
  const reduced = useReducedMotionPref()
  const cps = useGame((_s, d) => Math.round(d.cps * 10) / 10)
  const throttled = useGame((_s, d) => d.throttled)
  const draw = useFamilyDraw()

  // Closed, the rack still has to read as a rack: one chip per family, in catalog order.
  const shelf = useMemo(() => {
    const label = new Map(HARDWARE_FAMILIES.map((f) => [f.id, f.label]))
    return HARDWARE_FAMILIES.map((f) => draw.find((d) => d.family === f.id))
      .filter((d): d is NonNullable<typeof d> => d !== undefined)
      .map((d) => ({ family: d.family, label: label.get(d.family) ?? d.family, units: d.units, cps: d.cps }))
  }, [draw])

  const groups = useMemo((): Group[] => {
    const { hardwareById } = buildIndex(store.catalog)
    const byFamily = new Map<HardwareFamily, string[]>()
    for (const id of owned) {
      const def = hardwareById[id]
      if (!def) continue
      const list = byFamily.get(def.family) ?? []
      list.push(id)
      byFamily.set(def.family, list)
    }
    return HARDWARE_FAMILIES.filter((f) => byFamily.has(f.id)).map((f) => ({ family: f.id, label: f.label, ids: byFamily.get(f.id) ?? [] }))
  }, [owned, store.catalog])

  return (
    <Panel
      stripe="image"
      title={
        <button
          type="button"
          onClick={() => setState(collapsed ? 'open' : 'closed')}
          aria-expanded={!collapsed}
          aria-controls="rack-body"
          className="flex items-center gap-1.5 rounded text-[11px] font-semibold tracking-[0.08em] uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
        >
          <motion.span animate={{ rotate: collapsed ? -90 : 0 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }} className="inline-flex">
            <ChevronDown size={14} aria-hidden="true" />
          </motion.span>
          Rack
          <span className="ml-1 font-semibold tracking-normal text-smoke-800 normal-case">
            {totalUnits} unit{totalUnits === 1 ? '' : 's'}
          </span>
        </button>
      }
      right={
        <span className={cn('font-extrabold tabular-nums tracking-tight', throttled ? 'text-slot-vae' : 'text-smoke-100')} title={throttled ? 'Breaker tripped: every rig is off' : 'Total income'}>
          {formatCps(cps)}
        </span>
      }
      className="shrink-0"
      bodyClassName="p-0"
    >
      {collapsed &&
        (shelf.length === 0 ? (
          <p id="rack-body" className="px-4 py-2 text-xs text-smoke-700">The rack is empty. Even the office PC left.</p>
        ) : (
          <ul
            id="rack-body"
            aria-label="Rack summary"
            className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {shelf.map((f) => (
              <li key={f.family} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setState('open')}
                  title={`${f.label}: ${f.units} unit${f.units === 1 ? '' : 's'} making ${formatCps(f.cps)}. Open the rack.`}
                  className="flex items-center gap-1.5 rounded-[0.354em] border border-charcoal-400/70 bg-charcoal-500/60 px-1.5 py-0.5 text-[11px] transition-colors hover:border-charcoal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
                >
                  <span className="font-semibold text-smoke-100">{f.label}</span>
                  <span className="font-extrabold tabular-nums text-smoke-100">×{f.units}</span>
                  <span className="tabular-nums text-smoke-600">{formatCps(f.cps)}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            id="rack-body"
            key="body"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
            className="max-h-[22vh] overflow-y-auto px-2 pb-2"
          >
            {groups.map((group) => (
              <section key={group.family} aria-label={group.label}>
                <header className="sticky top-0 z-10 -mx-2 flex items-center gap-2 bg-charcoal-600/95 px-4 pt-2 pb-1 backdrop-blur-sm">
                  <h3 className="text-[10px] font-semibold tracking-[0.08em] text-smoke-700 uppercase">{group.label}</h3>
                  <span className="h-px flex-1 bg-charcoal-400/60" aria-hidden="true" />
                </header>
                {group.ids.map((id) => (
                  <RigRow key={id} id={id} />
                ))}
              </section>
            ))}
            {groups.length === 0 && <p className="px-2 py-4 text-center text-xs text-smoke-700">The rack is empty. Even the office PC left.</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}
