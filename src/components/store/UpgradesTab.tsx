'use client'
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import type { UpgradeCategory } from '@/game/types'
import { UpgradeRow } from './UpgradeRow'
import { UPGRADE_CATEGORIES, useReducedMotionPref, useVisibleUpgrades } from './storeHooks'

interface Group {
  id: UpgradeCategory
  label: string
  blurb: string
  ids: string[]
}

/** Every unlocked, unowned upgrade grouped by category under sticky headers. */
export function UpgradesTab() {
  const store = useGameStore()
  const ids = useVisibleUpgrades()
  const reduced = useReducedMotionPref()

  const groups = useMemo((): Group[] => {
    const { upgradeById } = buildIndex(store.catalog)
    const byCategory = new Map<UpgradeCategory, string[]>()
    for (const id of ids) {
      const def = upgradeById[id]
      if (!def) continue
      const list = byCategory.get(def.category) ?? []
      list.push(id)
      byCategory.set(def.category, list)
    }
    return UPGRADE_CATEGORIES.filter((c) => byCategory.has(c.id)).map((c) => ({ id: c.id, label: c.label, blurb: c.blurb, ids: byCategory.get(c.id) ?? [] }))
  }, [ids, store.catalog])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" role="list" aria-label="Upgrades">
      {groups.length === 0 && (
        <p className="px-2 py-8 text-center text-xs text-smoke-700">
          Nothing to install yet. Keep clicking; the Manager will find something.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <header className="sticky top-0 z-10 -mx-2 flex items-baseline justify-between gap-2 border-b border-charcoal-400/70 bg-charcoal-600/95 px-4 pt-2.5 pb-1.5 backdrop-blur-sm">
            <h3 className="text-[11px] font-semibold tracking-[0.08em] text-smoke-600 uppercase">{group.label}</h3>
            <span className="truncate text-[10px] text-smoke-800">{group.blurb}</span>
          </header>
          <div className="pt-1.5">
            <AnimatePresence initial={false}>
              {group.ids.map((id) => (
                <motion.div
                  key={id}
                  className="cv-auto"
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.18, ease: 'easeOut' }}
                >
                  <UpgradeRow id={id} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      ))}
    </div>
  )
}
