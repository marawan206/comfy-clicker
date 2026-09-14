'use client'
/**
 * Store › Models: one shelf per kind, picked with a chip, the same way the Hardware tab picks a
 * family.
 *
 * It used to stack all five kinds in one column, so reaching 3D or Audio meant scrolling past every
 * image checkpoint, and that gets worse with every model added. The chips are the navigation now
 * and the list holds one kind at a time. Each chip carries its count, so an empty shelf is visible
 * before it is opened, and a pulsing dot the first time a kind appears, so unlocking your first
 * video model announces itself instead of waiting to be scrolled past.
 *
 * The chosen shelf is a browser preference rather than save data (`useLocalState`), like the
 * hardware family and the buy amount: it belongs to this screen, not to this account.
 *
 * The thing this file has to get right: four other places hand the store a `focusId` to point at a
 * single model (the lock guidance, the Studio's model chips, the level-up banner, Next up). A card
 * only exists while its own shelf is showing, so the `comfy:store-tab` listener below opens the
 * shelf that model lives on. `useHighlight` then finds the card a frame or two later, which its
 * retry loop already allows for.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { motion } from 'motion/react'
import { Box, Clapperboard, Cloud, Image as ImageIcon, Music } from 'lucide-react'
import { useGame } from '@/state/useGame'
import { isUnlocked } from '@/game/unlock'
import { API_COST_MULT } from '@/game/constants'
import type { ModelKind } from '@/game/types'
import { cn } from '@/lib/utils'
import { ModelCard } from './ModelCard'
import {
  STORE_TAB_EVENT,
  useHighlight,
  useLocalState,
  useNewIds,
  useReducedMotionPref,
  type StoreTabEventDetail,
} from './storeHooks'

type Section = ModelKind | 'api'

const SECTIONS: ReadonlyArray<{ id: Section; label: string; icon: typeof ImageIcon; blurb: string }> = [
  { id: 'image', label: 'Image', icon: ImageIcon, blurb: 'Stills. Fast, cheap, the bread and butter of the feed.' },
  { id: 'video', label: 'Video', icon: Clapperboard, blurb: 'Bigger jobs, bigger reach. Three seconds of cat, perfected.' },
  { id: '3d', label: '3D', icon: Box, blurb: 'Meshes for people who own a printer and a grudge.' },
  { id: 'audio', label: 'Audio', icon: Music, blurb: 'Songs, stems and a jingle for the intro nobody skips.' },
  { id: 'api', label: 'API nodes', icon: Cloud, blurb: `No VRAM, +${Math.round((API_COST_MULT - 1) * 100)}% job cost. Someone else’s cluster, your prompt.` },
]

const SECTION_IDS: readonly Section[] = SECTIONS.map((s) => s.id)
const KIND_STORAGE_KEY = 'comfy-clicker:store-model-kind'
const SEEN_KIND_KEY = 'comfy-clicker:seen-model-kinds'

/** Ids of models the store shows, grouped: local models always, API models even before API Nodes (as locked cards). */
function useVisibleModels(): Record<Section, string[]> {
  const key = useGame((s, d, store) =>
    store.catalog.models
      .filter((m) => m.api || isUnlocked(m.unlock, s, d, store.catalog))
      .map((m) => `${m.api ? 'api' : m.kind}:${m.id}`)
      .join('|'),
  )
  return useMemo(() => {
    const out: Record<Section, string[]> = { image: [], video: [], '3d': [], audio: [], api: [] }
    if (!key) return out
    for (const entry of key.split('|')) {
      const sep = entry.indexOf(':')
      const section = entry.slice(0, sep) as Section
      out[section]?.push(entry.slice(sep + 1))
    }
    return out
  }, [key])
}

/** Store › Models: kind chips, then one card per checkpoint on that shelf. */
export function ModelsTab() {
  const listRef = useRef<HTMLDivElement>(null)
  // A guidance step can hand this tab a `focusId`: scroll that card in and ring it electric.
  useHighlight(listRef)
  const groups = useVisibleModels()
  const reduced = useReducedMotionPref()
  const setupCount = useGame((s) => Object.values(s.models).filter((m) => m.setup).length)
  const total = useGame((_s, _d, store) => store.catalog.models.length)

  const sections = useMemo(() => SECTIONS.filter((s) => groups[s.id].length > 0), [groups])
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections])
  const [storedKind, setStoredKind] = useLocalState<string>(KIND_STORAGE_KEY, 'image')
  const kindNew = useNewIds(sectionIds, SEEN_KIND_KEY)

  // Clamped on read rather than corrected in an effect: a shelf can empty out between renders (a
  // rebrand takes the models back), and a render that needs a second pass to be legal is a render
  // that maps over a kind which is no longer there.
  const active: Section = (sectionIds as readonly string[]).includes(storedKind)
    ? (storedKind as Section)
    : (sectionIds[0] ?? 'image')
  const meta = SECTIONS.find((s) => s.id === active)
  const ids = groups[active] ?? []

  const pick = useCallback(
    (next: Section) => {
      setStoredKind(next)
      kindNew.markSeen(next)
    },
    [setStoredKind, kindNew],
  )

  // Somebody outside is pointing at one model. Open the shelf it lives on, or the ring lands on a
  // card that is not mounted and the player is told to set up something they cannot see.
  useEffect(() => {
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<StoreTabEventDetail | string>).detail
      const id = typeof detail === 'object' && detail ? detail.focusId : undefined
      if (!id) return
      const owner = SECTION_IDS.find((s) => groups[s].includes(id))
      if (owner) setStoredKind(owner)
    }
    window.addEventListener(STORE_TAB_EVENT, onTab)
    return () => window.removeEventListener(STORE_TAB_EVENT, onTab)
  }, [groups, setStoredKind])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-20 shrink-0 space-y-2 border-b border-charcoal-400/70 bg-charcoal-600 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold uppercase tracking-[0.08em] text-smoke-700">Checkpoints</span>
          <span className="tabular-nums text-smoke-800">
            {setupCount}/{total} installed
          </span>
        </div>
        {/* Wraps rather than scrolling sideways, unlike the hardware families: there are exactly
            five kinds and there will not be a sixth, so all of them fit on two rows at the store's
            width. A chip you have to scroll to find is the thing this tab exists to stop. */}
        <div role="tablist" aria-label="Model kinds" className="flex flex-wrap gap-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <KindChip
              key={id}
              id={id}
              label={label}
              icon={Icon}
              count={groups[id].length}
              active={id === active}
              isNew={kindNew.isNew(id)}
              reduced={reduced}
              onPick={pick}
            />
          ))}
        </div>
        <p className="min-w-0 text-[11px] leading-snug text-smoke-700">{meta?.blurb}</p>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto p-2"
        role="tabpanel"
        aria-label={`${meta?.label ?? 'Model'} checkpoints`}
      >
        {/* Swap synchronously and only fade in, the way `StorePanel` swaps its own tabs and for the
            same reason: an exit animation on a `cv-auto` card that is scrolled out of view has
            nothing to run, so `AnimatePresence` never hears it finish and leaves the whole previous
            shelf mounted underneath the new one. Keyed on the shelf, so it is one fade, not one per
            card. */}
        <motion.ul
          key={active}
          className="flex flex-col gap-2"
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.16, ease: 'easeOut' }}
        >
          {ids.map((modelId) => (
            // `data-id` is what a guidance step scrolls to and rings (`useHighlight`).
            <li key={modelId} data-id={modelId} className="cv-auto">
              <ModelCard id={modelId} />
            </li>
          ))}
        </motion.ul>
        {ids.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-smoke-700">Nothing on this shelf yet. Levels bring checkpoints.</p>
        )}
      </div>
    </div>
  )
}

interface ChipProps {
  id: Section
  label: string
  icon: typeof ImageIcon
  count: number
  active: boolean
  isNew: boolean
  reduced: boolean
  onPick: (id: Section) => void
}

/** One shelf chip: icon, label, and how many checkpoints are on it. Mirrors the hardware family chip. */
function KindChip({ id, label, icon: Icon, count, active, isNew, reduced, onPick }: ChipProps) {
  return (
    <motion.button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={`${label}, ${count} checkpoint${count === 1 ? '' : 's'}`}
      onClick={() => onPick(id)}
      whileTap={reduced ? undefined : { scale: 0.95 }}
      className={cn(
        'relative flex h-7 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold tracking-tight whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
        active
          ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#0e0e0f]'
          : 'border-charcoal-400 bg-charcoal-500 text-smoke-600 hover:border-charcoal-300 hover:text-smoke-100',
      )}
    >
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
      <span className="tabular-nums opacity-60">{count}</span>
      {isNew && !active && (
        <motion.span
          aria-label="new"
          className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-electric-400"
          animate={reduced ? undefined : { scale: [1, 1.5, 1], opacity: [1, 0.6, 1] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
        />
      )}
    </motion.button>
  )
}
