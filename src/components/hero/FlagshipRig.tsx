'use client'
/**
 * The best owned unit (derived.bestHardwareId): its art, VRAM, speed tier, which of the owned
 * models it can run and at what precision.
 *
 * What to buy next is not this panel's job: the "Next up" panel owns that line, and two surfaces
 * disagreeing about the next unlock is worse than one surface saying it.
 */
import { useMemo } from 'react'
import { Cpu, Gauge, MemoryStick } from 'lucide-react'
import { useGame, useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { runsOn } from '@/game/hardware'
import type { Derived, GameState, ModelDef, Precision } from '@/game/types'
import type { Catalog } from '@/data'
import { Art } from '@/components/common/Art'
import { Panel } from '@/components/common/Panel'
import { cn } from '@/lib/utils'

const MAX_TIER = 12
const MAX_CHIPS = 4
const PRECISION_ORDER: readonly Precision[] = ['native', 'fp8', 'q4']

interface RunChip {
  id: string
  label: string
  precision: Precision
}

interface RigView {
  id: string
  name: string
  short: string
  vram: number
  tier: number
  count: number
  cardsPerUnit: number
  realWorld: string | null
  chips: RunChip[]
  moreChips: number
  /** Owned, set-up models the flagship cannot run at any unlocked precision. */
  cannotRun: number
}

function bestPrecisionOn(model: ModelDef, unlocked: readonly Precision[], hw: Parameters<typeof runsOn>[2], derived: Derived, catalog: Catalog): Precision | null {
  for (const p of PRECISION_ORDER) {
    if (!unlocked.includes(p)) continue
    if (runsOn(model, p, hw, derived, catalog)) return p
  }
  return null
}

function buildView(state: GameState, derived: Derived, catalog: Catalog): RigView | null {
  const id = derived.bestHardwareId
  if (!id) return null
  const { hardwareById, modelById } = buildIndex(catalog)
  const hw = hardwareById[id]
  if (!hw) return null

  const chips: RunChip[] = []
  let cannotRun = 0
  const ownedModels = Object.entries(state.models)
    .filter(([, m]) => m.setup)
    .map(([modelId, m]) => ({ def: modelById[modelId], precisions: m.precisions }))
    .filter((m): m is { def: ModelDef; precisions: Precision[] } => m.def !== undefined)
    .sort((a, b) => b.def.baseCost - a.def.baseCost)
  for (const { def, precisions } of ownedModels) {
    const p = bestPrecisionOn(def, precisions, hw, derived, catalog)
    if (!p) {
      cannotRun++
      continue
    }
    chips.push({ id: def.id, label: p === 'native' ? def.name : `${def.name} (${catalog.precisions[p]?.label ?? p})`, precision: p })
  }

  return {
    id,
    name: hw.name,
    short: hw.short,
    vram: hw.vram,
    tier: hw.speedTier + (derived.coolingTier[hw.family] ?? 0),
    count: state.hardware[id] ?? 0,
    cardsPerUnit: hw.cardsPerUnit ?? 1,
    realWorld: hw.realWorld ?? null,
    chips: chips.slice(0, MAX_CHIPS),
    moreChips: Math.max(0, chips.length - MAX_CHIPS),
    cannotRun,
  }
}

/** A string that changes whenever anything `buildView` reads changes; the view is memoised on it. */
function viewKey(s: GameState, d: Derived): string {
  let models = ''
  for (const [id, m] of Object.entries(s.models)) models += `${id}:${m.setup ? 1 : 0}:${m.precisions.join('+')},`
  let hardware = ''
  for (const [id, n] of Object.entries(s.hardware)) if (n > 0) hardware += `${id}:${n},`
  return `${d.bestHardwareId}|${models}|${hardware}|${d.zluda ? 1 : 0}${d.apiNodes ? 1 : 0}|${Object.values(d.coolingTier).join(',')}|${d.unlockedFamilies.length}|${s.mapNodes.length}|${s.upgrades.length}|${s.stats.posts}|${s.totalClicks >= 100 ? 1 : 0}`
}

function useRigView(): RigView | null {
  const store = useGameStore()
  const key = useGame(viewKey)
  // `key` encodes every input `buildView` reads from the store.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildView(store.state, store.derived, store.catalog), [key, store])
}

const CHIP_STYLES: Record<Precision, string> = {
  native: 'border-sapphire-700 bg-sapphire-700/25 text-smoke-100',
  fp8: 'border-slot-latent/60 bg-slot-latent/10 text-slot-latent',
  q4: 'border-slot-cond/60 bg-slot-cond/10 text-slot-cond',
}

export function FlagshipRig() {
  const view = useRigView()
  const filled = view ? Math.min(MAX_TIER, Math.max(0, view.tier)) : 0

  return (
    <Panel
      stripe="image"
      title="Flagship rig"
      right={view && view.count > 1 ? <span className="tabular-nums text-smoke-100">×{view.count}</span> : undefined}
      bodyClassName="flex flex-col gap-3 p-4"
    >
      {view ? (
        <>
          <div className="flex items-start gap-3">
            <Art id={`hw-${view.id}`} size={96} className="shrink-0 shadow-[0_4px_0_#0e0e0f]" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-extrabold tracking-tight text-smoke-100" title={view.realWorld ?? view.name}>
                {view.name}
              </h3>
              <dl className="mt-1.5 flex flex-col gap-1 text-xs text-smoke-600">
                <div className="flex items-center gap-1.5">
                  <MemoryStick size={13} className="text-slot-image" aria-hidden="true" />
                  <dt className="sr-only">VRAM</dt>
                  <dd className="tabular-nums">
                    {Number.isFinite(view.vram) ? `${view.vram} GB` : 'Unlimited'} VRAM
                    {view.cardsPerUnit > 1 ? ` · ${view.cardsPerUnit}× cards` : ''}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <Gauge size={13} className="text-electric-400" aria-hidden="true" />
                  <dt className="sr-only">Speed tier</dt>
                  <dd className="flex items-center gap-2">
                    <span className="tabular-nums">Tier {view.tier}</span>
                    <span className="flex gap-0.5" aria-hidden="true">
                      {Array.from({ length: MAX_TIER }, (_, i) => (
                        <span key={i} className={cn('h-2 w-1 rounded-sm', i < filled ? 'bg-electric-400' : 'bg-charcoal-400')} />
                      ))}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-800">Can run</p>
            {view.chips.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {view.chips.map((chip) => (
                  <li
                    key={chip.id}
                    className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', CHIP_STYLES[chip.precision])}
                    title={chip.precision === 'native' ? 'Native weights' : `Quantized to ${chip.precision.toUpperCase()}`}
                  >
                    {chip.label}
                  </li>
                ))}
                {view.moreChips > 0 && (
                  <li className="rounded-full border border-charcoal-300 px-2 py-0.5 text-[11px] font-semibold text-smoke-600">+{view.moreChips} more</li>
                )}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-smoke-600">
                <Cpu size={13} aria-hidden="true" />
                Nothing you own fits on it yet. Quantize something.
              </p>
            )}
            {view.cannotRun > 0 && (
              <p className="mt-1.5 text-[11px] text-slot-vae/80">
                {view.cannotRun} owned model{view.cannotRun === 1 ? '' : 's'} won&apos;t fit on this card.
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="flex items-center gap-2 text-xs text-smoke-600">
          <Cpu size={14} aria-hidden="true" />
          No rig yet. Even the office PC would count.
        </p>
      )}
    </Panel>
  )
}
