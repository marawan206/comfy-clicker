'use client'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Lock } from 'lucide-react'
import { HARDWARE_FAMILIES } from '@/data/hardware'
import type { HardwareFamily } from '@/game/types'
import type { BuyCount } from '@/game/actions'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { guideCauses } from '@/components/guidance/GuidanceHost'
import { explainBuy } from '@/game/guidance'
import { cn } from '@/lib/utils'
import { BuyAmount, BUY_AMOUNTS } from './BuyAmount'
import { HardwareRow } from './HardwareRow'
import { SaveForBar } from './SaveForBar'
import { useFamilyUnlocked, useHighlight, useLocalState, useNewIds, useReducedMotionPref, useVisibleFamilies, useVisibleHardware } from './storeHooks'

/** A request from outside (save-for bar, power meter, header) to show a family; `nonce` re-fires a repeat request. */
export interface HardwareFocus {
  family: HardwareFamily
  nonce: number
}

const FAMILY_ORDER: readonly HardwareFamily[] = HARDWARE_FAMILIES.map((f) => f.id)
const FAMILY_STORAGE_KEY = 'comfy-clicker:store-family'
const AMOUNT_STORAGE_KEY = 'comfy-clicker:store-amount'
const SEEN_HW_KEY = 'comfy-clicker:seen-hardware'
const SEEN_FAMILY_KEY = 'comfy-clicker:seen-families'
const AMOUNT_VALUES: readonly string[] = BUY_AMOUNTS.map(String)

function parseAmount(raw: string): BuyCount {
  if (raw === 'max') return 'max'
  const n = Number(raw)
  return n === 10 || n === 100 ? n : 1
}

interface Props {
  focus?: HardwareFocus | null
}

/** Family chips, buy amount, the save-for bar and one row per visible unit in the chosen family. */
export function HardwareTab({ focus = null }: Props) {
  const store = useGameStore()
  const families = useVisibleFamilies(FAMILY_ORDER)
  const visible = useVisibleHardware()
  const [storedFamily, setStoredFamily] = useLocalState<string>(FAMILY_STORAGE_KEY, 'cpu')
  const [storedAmount, setStoredAmount] = useLocalState<string>(AMOUNT_STORAGE_KEY, '1', AMOUNT_VALUES)
  const amount = parseAmount(storedAmount)
  const reduced = useReducedMotionPref()
  const listRef = useRef<HTMLDivElement>(null)
  // A `focusId` on `comfy:store-tab` scrolls that row into view and rings it (guidance, Next up).
  useHighlight(listRef)

  const family: HardwareFamily = (families as readonly string[]).includes(storedFamily)
    ? (storedFamily as HardwareFamily)
    : (families[0] ?? 'cpu')

  useEffect(() => {
    if (focus) setStoredFamily(focus.family)
  }, [focus, setStoredFamily])

  const hardwareNew = useNewIds(visible, SEEN_HW_KEY)
  const familyNew = useNewIds(families, SEEN_FAMILY_KEY)

  const { hardwareById } = buildIndex(store.catalog)
  const rows = useMemo(() => visible.filter((id) => hardwareById[id]?.family === family), [visible, family, hardwareById])
  const meta = HARDWARE_FAMILIES.find((f) => f.id === family)

  const pickFamily = useCallback(
    (next: HardwareFamily) => {
      setStoredFamily(next)
      familyNew.markSeen(next)
    },
    [setStoredFamily, familyNew],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-20 shrink-0 space-y-2 border-b border-charcoal-400/70 bg-charcoal-600 px-3 pt-3 pb-2">
        <SaveForBar onSelectFamily={pickFamily} />
        <div role="tablist" aria-label="Hardware families" className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {families.map((id) => (
            <FamilyChip
              key={id}
              id={id}
              active={id === family}
              isNew={familyNew.isNew(id)}
              onPick={pickFamily}
              reduced={reduced}
            />
          ))}
        </div>
        <p className="min-w-0 text-[11px] leading-snug text-smoke-700">{meta?.blurb}</p>
        <div className="flex justify-end">
          <BuyAmount value={amount} onChange={(n) => setStoredAmount(String(n))} className="shrink-0" />
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2" role="tabpanel" aria-label={`${meta?.label ?? 'Hardware'} units`}>
        <AnimatePresence initial={false}>
          {rows.map((id) => (
            <motion.div
              key={id}
              className="cv-auto"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: 'easeOut' }}
            >
              <HardwareRow id={id} amount={amount} isNew={hardwareNew.isNew(id)} onSeen={hardwareNew.markSeen} />
            </motion.div>
          ))}
        </AnimatePresence>
        {rows.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-smoke-700">Nothing on this shelf yet. Keep generating.</p>
        )}
      </div>
    </div>
  )
}

interface ChipProps {
  id: HardwareFamily
  active: boolean
  isNew: boolean
  reduced: boolean
  onPick: (family: HardwareFamily) => void
}

function FamilyChip({ id, active, isNew, reduced, onPick }: ChipProps) {
  const store = useGameStore()
  const unlocked = useFamilyUnlocked(id)
  const meta = HARDWARE_FAMILIES.find((f) => f.id === id)
  const label = meta?.label ?? id
  const locked = !unlocked
  const tip = locked ? 'Needs ROCm setup (Upgrades)' : meta?.blurb

  // The AMD shelf is the one chip that can be locked. Clicking it still shows the cards (so the
  // player can see what ROCm buys them) and explains the one upgrade in the way.
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onPick(id)
      if (unlocked) return
      const def = store.catalog.hardware.find((h) => h.family === id)
      if (!def) return
      const causes = explainBuy(def, store.state, store.derived, store.catalog).filter((c) => c.kind !== 'credits')
      guideCauses(e.currentTarget, causes, store, `${label} cards`)
    },
    [id, label, onPick, store, unlocked],
  )

  return (
    <motion.button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={locked ? `${label} (locked: needs ROCm setup)` : label}
      title={tip}
      onClick={onClick}
      whileTap={reduced ? undefined : { scale: 0.95 }}
      className={cn(
        'relative flex h-7 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold tracking-tight whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
        active
          ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#0e0e0f]'
          : locked
            ? 'border-charcoal-400 bg-charcoal-700 text-slot-vae/70 hover:text-slot-vae'
            : 'border-charcoal-400 bg-charcoal-500 text-smoke-600 hover:border-charcoal-300 hover:text-smoke-100',
      )}
    >
      {locked && <Lock size={11} aria-hidden="true" />}
      <span>{label}</span>
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
