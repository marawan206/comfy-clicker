'use client'
import { memo, useMemo } from 'react'
import { motion } from 'motion/react'
import { ChevronRight, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatNum } from '@/game/format'
import type { Precision } from '@/game/types'
import {
  FOCUS_RING,
  KIND_LABELS,
  LABEL_CLASS,
  openStoreTab,
  useModelRoster,
  useMotionOK,
  useStudioSelection,
  type ModelRosterEntry,
} from './studioHooks'

/** A model vendor mark from `public/brand/vendors`, sized for chips and rows. */
export function VendorIcon({ icon, size = 16, className }: { icon: string; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand SVGs, no optimisation wanted
    <img
      src={`/brand/vendors/${icon}.svg`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={cn('shrink-0 select-none', className)}
    />
  )
}

/** How many not-yet-usable models the strip shows before pointing at the store. */
const LOCKED_PREVIEW = 3

const PRESS = { type: 'spring', stiffness: 500, damping: 30 } as const

function firstRunnable(entry: ModelRosterEntry): Precision | null {
  for (const p of entry.precisions) if (entry.runnable[p]) return p
  return null
}

function lockedReason(entry: ModelRosterEntry): string {
  if (!entry.setup) {
    const fee = entry.setupFee > 0 ? `${formatNum(entry.setupFee)} credits to set up` : 'free to set up'
    const reason = entry.lockReasons.native
    return reason ? `Not set up · ${fee} · ${reason}` : `Not set up · ${fee}`
  }
  return entry.lockReasons.native ?? 'Nothing you own can run this'
}

interface ReadyChipProps {
  entry: ModelRosterEntry
  selected: boolean
  motionOk: boolean
  onSelect: (id: string) => void
}

const ReadyChip = memo(function ReadyChip({ entry, selected, motionOk, onSelect }: ReadyChipProps) {
  const { model } = entry
  const runs = firstRunnable(entry)
  const on = runs ? entry.hardwareName[runs] : undefined
  const title = `${model.name} · ${KIND_LABELS[model.kind]}${on ? ` · runs on ${on}` : ''}`
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={model.name}
      title={title}
      onClick={() => onSelect(model.id)}
      whileTap={motionOk ? { scale: 0.95 } : undefined}
      transition={PRESS}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
        FOCUS_RING,
        selected
          ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_3px_0_#0e0e0f]'
          : 'border-charcoal-300 bg-charcoal-500 text-smoke-200 hover:border-smoke-700 hover:bg-charcoal-400',
      )}
    >
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-[0.354em]',
          selected ? 'bg-charcoal-800/15' : 'bg-charcoal-800/60',
        )}
      >
        <VendorIcon icon={model.vendorIcon} size={13} className="opacity-90" />
      </span>
      <span className="truncate">{model.name}</span>
      {model.kind !== 'image' && (
        <span
          className={cn(
            'rounded-[0.354em] px-1 text-[10px] font-bold uppercase tracking-wide',
            selected ? 'bg-charcoal-800/15 text-charcoal-800' : 'bg-charcoal-800/60 text-smoke-600',
          )}
        >
          {KIND_LABELS[model.kind]}
        </span>
      )}
    </motion.button>
  )
})

const LockedChip = memo(function LockedChip({ entry }: { entry: ModelRosterEntry }) {
  const reason = lockedReason(entry)
  return (
    <button
      type="button"
      title={reason}
      aria-label={`${entry.model.name}: locked. ${reason}. Open the Models store`}
      onClick={() => openStoreTab('models')}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-charcoal-300 bg-charcoal-600 px-2.5 py-1.5 text-xs font-semibold text-slot-vae/70 transition-colors hover:border-smoke-800',
        FOCUS_RING,
      )}
    >
      <Lock size={12} aria-hidden="true" />
      <span className="truncate">{entry.model.name}</span>
      <span className="text-electric-400">Get</span>
    </button>
  )
})

/** Owned-and-set-up models as selectable chips; the nearest locked ones point at the store. */
export function ModelChips() {
  const roster = useModelRoster()
  const { modelId, setModel } = useStudioSelection()
  const motionOk = useMotionOK()

  const { ready, locked, more } = useMemo(() => {
    const visible = roster.filter((e) => e.visible)
    const ready = visible.filter((e) => e.ready)
    const lockedAll = visible.filter((e) => !e.ready)
    return { ready, locked: lockedAll.slice(0, LOCKED_PREVIEW), more: Math.max(0, lockedAll.length - LOCKED_PREVIEW) }
  }, [roster])

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={LABEL_CLASS}>Model</span>
        <span className="text-[11px] tabular-nums text-smoke-700">
          {ready.length} ready · {locked.length + more} locked
        </span>
      </div>
      <div role="radiogroup" aria-label="Model" className="flex flex-wrap gap-1.5">
        {ready.map((entry) => (
          <ReadyChip
            key={entry.model.id}
            entry={entry}
            selected={entry.model.id === modelId}
            motionOk={motionOk}
            onSelect={setModel}
          />
        ))}
        {locked.map((entry) => (
          <LockedChip key={entry.model.id} entry={entry} />
        ))}
        {more > 0 && (
          <button
            type="button"
            onClick={() => openStoreTab('models')}
            aria-label={`${more} more models in the store`}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg border border-charcoal-300 px-2.5 py-1.5 text-xs font-semibold text-smoke-600 transition-colors hover:border-electric-400 hover:text-electric-400',
              FOCUS_RING,
            )}
          >
            +{more} more
            <ChevronRight size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
