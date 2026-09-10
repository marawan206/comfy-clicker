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
import { useLocalState, useOwnedHardware, useReducedMotionPref } from '@/components/store/storeHooks'
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

/** Owned hardware grouped by family; collapsible, scrolls inside 28vh. */
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
        <span className={cn('font-extrabold tabular-nums tracking-tight', throttled ? 'text-slot-vae' : 'text-smoke-100')} title={throttled ? 'Breaker tripped: income throttled' : 'Total income'}>
          {formatCps(cps)}
        </span>
      }
      className="shrink-0"
      bodyClassName={cn('p-0', collapsed && 'hidden')}
    >
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            id="rack-body"
            key="body"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
            className="max-h-[28vh] overflow-y-auto px-2 pb-2"
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
