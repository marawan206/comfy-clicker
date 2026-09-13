'use client'
import { useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import { motion } from 'motion/react'
import { Lock, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRECISION_ORDER } from '@/data/precisions'
import { buildIndex } from '@/game/catalog'
import { formatNum, formatPct } from '@/game/format'
import { explainQuantize, explainRun, type LockCause } from '@/game/guidance'
import type { Precision } from '@/game/types'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { Tooltip } from '@/components/common/Tooltip'
import { precisionCellTip } from '@/components/common/tooltipCopy'
import { guideCauses } from '@/components/guidance/GuidanceHost'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'
import {
  FOCUS_RING,
  LABEL_CLASS,
  expectedReturn,
  useMotionOK,
  useRosterEntry,
  useStudioSelection,
} from './studioHooks'

const THUMB_SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const

function mult(x: number): string {
  return `×${Number(x.toFixed(2))}`
}

/** Native / FP8 / Q4 GGUF for the selected model, with cost, time and quality trade-offs and the expected return. */
export function PrecisionToggle() {
  const { modelId, precision, setPrecision } = useStudioSelection()
  const entry = useRosterEntry(modelId)
  const store = useGameStore()
  const { catalog } = store
  const motionOk = useMotionOK()
  const credits = useGame((s) => s.credits)

  /** A cell that cannot be picked says why where it was clicked, instead of opening the store. */
  const guideCell = useCallback(
    (anchor: Element, p: Precision, unlocked: boolean) => {
      const model = buildIndex(store.catalog).modelById[modelId]
      if (!model) return
      const label = store.catalog.precisions[p]?.label ?? p
      const subject = `${model.name} · ${label}`
      const cause: LockCause | null = unlocked
        ? explainRun(model, p, store.state, store.derived, store.catalog)
        : (explainQuantize(model, p, store.state, store.catalog) ??
          (p === 'native' ? null : { kind: 'precision', modelId, precision: p, fee: entry?.quant[p]?.fee ?? 0, gateNodeId: null }))
      if (cause) guideCauses(anchor, [cause], store, subject)
    },
    [entry, modelId, store],
  )

  const ev = useGameShallow((_s, d, store) => {
    const model = buildIndex(store.catalog).modelById[modelId]
    const at = (p: Precision): number => (model ? expectedReturn(model, p, d, store.catalog) - 1 : 0)
    return { native: at('native'), fp8: at('fp8'), q4: at('q4') }
  })

  const selectedDef = catalog.precisions[precision]
  // Density (UI-SPEC): a model with one precision and no way to gain another is three cells of
  // nothing between the model row and the prompt. Hide the control and keep the CTA above the fold.
  const quantizable = entry !== null && entry.model.quantizable !== false && entry.model.api !== true
  if (entry !== null && !quantizable && entry.precisions.every((p) => p === 'native')) return null

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={LABEL_CLASS}>Precision</span>
        <span className="text-[11px] text-smoke-700">
          {selectedDef.label} · <span className="font-semibold text-electric-400">≈ {formatPct(ev[precision])} expected</span>
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Precision"
        className="grid grid-cols-3 gap-1 rounded-xl border-2 border-charcoal-400 bg-charcoal-700 p-1"
      >
        {PRECISION_ORDER.map((p) => {
          const def = catalog.precisions[p]
          const unlocked = entry?.precisions.includes(p) ?? false
          const runnable = entry?.runnable[p] ?? false
          const selected = p === precision
          const quant = p === 'native' ? null : entry?.quant[p]
          const fee = quant?.fee ?? 0
          const onClick = (e: ReactMouseEvent<HTMLButtonElement>): void => {
            if (unlocked && runnable) setPrecision(p)
            else guideCell(e.currentTarget, p, unlocked)
          }

          return (
            <Tooltip
              key={p}
              {...precisionCellTip(def, ev[p], {
                unlocked,
                runnable,
                fee,
                have: credits,
                blocker: unlocked ? entry?.lockReasons[p] : (quant?.blocker ?? null),
              })}
            >
              <motion.button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${def.label} precision${unlocked ? '' : ' (locked)'}`}
                aria-disabled={!unlocked}
                onClick={onClick}
                whileTap={motionOk ? { scale: 0.97 } : undefined}
                transition={THUMB_SPRING}
                className={cn(
                  'relative flex min-w-0 flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  FOCUS_RING,
                  unlocked ? 'text-smoke-200 hover:bg-charcoal-500/60' : 'text-slot-vae/70 hover:bg-charcoal-500/40',
                  selected && 'text-charcoal-800',
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="studio-precision-thumb"
                    aria-hidden="true"
                    className="absolute inset-0 z-0 rounded-lg bg-electric-400 shadow-[0_3px_0_#0e0e0f]"
                    transition={motionOk ? THUMB_SPRING : { duration: 0 }}
                  />
                )}
                <span className="relative z-10 flex w-full items-center gap-1 text-xs font-extrabold">
                  {!unlocked && <Lock size={11} aria-hidden="true" />}
                  {unlocked && !runnable && (
                    <TriangleAlert size={11} aria-hidden="true" className={selected ? 'text-charcoal-800' : 'text-slot-vae'} />
                  )}
                  <span className="truncate">{def.label}</span>
                  <span
                    className={cn(
                      'ml-auto tabular-nums text-[10px] font-bold',
                      selected ? 'text-charcoal-800/80' : ev[p] >= 0 ? 'text-smoke-600' : 'text-slot-vae/80',
                    )}
                  >
                    {formatPct(ev[p])}
                  </span>
                </span>
                <span
                  className={cn(
                    'relative z-10 w-full truncate text-[10px] tabular-nums leading-tight',
                    selected ? 'text-charcoal-800/80' : 'text-smoke-700',
                  )}
                >
                  {unlocked || p === 'native' ? (
                    <>
                      {mult(def.costMult)} cost · {mult(def.timeMult)} time · {Math.round(def.qualityMult * 100)}%
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-0.5">
                      quantize for <CreditsIcon size={10} className="text-credits" />
                      <span className="text-credits">{formatNum(fee)}</span>
                    </span>
                  )}
                </span>
              </motion.button>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
