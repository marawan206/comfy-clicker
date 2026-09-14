'use client'
/**
 * The level-up card.
 *
 * `settleLevelUps` pays one level at a time and emits one `levelUp` per level, so a player who
 * crosses two thresholds on the same tick (the reward credits can push them over the next one)
 * gets two events a frame apart. Showing two cards in a row would read as a bug, so the banner
 * merges anything that arrives while it is already up: the headline becomes `Level 4 to 6`, the
 * credits add up and the unlock tiles, cards and checkpoints alike, concatenate in level order.
 *
 * A level opens a rung of cards and the checkpoints those cards run, so the card shows both: a
 * `New in the store` row of hardware tiles over a `New checkpoints` row of model tiles, or one
 * unlabelled row when the rung has only one kind. `Show me` opens the Hardware shelf on the first
 * new card (the card is what the level was gating), or the Models tab when the rung is checkpoints
 * only; `Checkpoints` sits beside it when there are both.
 *
 * Mounted in `Overlays`, which every route carries, so a level earned while reading the Graph is
 * still announced where it happened. Confetti and the electric flash are `FxCanvas`'s job (it maps
 * `levelUp` itself); this file only owns the card and never fires FX of its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { ChevronsUp } from 'lucide-react'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { runGuideAction } from '@/components/guidance/navigate'
import { ModalButton, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { buildIndex } from '@/game/catalog'
import { formatNum } from '@/game/format'
import { levelTitle } from '@/game/level'
import type { HardwareDef, ModelDef } from '@/game/types'
import { useGameEvents, useGameStore } from '@/state/useGame'

/** How long the card stays before it dismisses itself. */
export const LEVEL_UP_MS = 5_000

interface Run {
  /** First level of the run; equals `to` for the usual single level-up. */
  from: number
  to: number
  credits: number
  /** Model ids the run opened, in level order. */
  unlocked: string[]
  /** Hardware ids the run opened, in level order. */
  hardware: string[]
  /** Bumped on every merge so the dismiss timer restarts and the entry animation replays. */
  nonce: number
}

/** One unlock tile: the asset id `Art` resolves and the name printed under it. */
interface TileItem {
  id: string
  art: string
  name: string
}

/** Defs for the ids that resolve, in the order given; an id the catalog no longer knows is skipped. */
function resolve<T extends { id: string }>(ids: readonly string[], byId: Record<string, T>): T[] {
  const out: T[] = []
  for (const id of ids) {
    const def = byId[id]
    if (def) out.push(def)
  }
  return out
}

function TileRow({ label, items }: { label?: string; items: TileItem[] }) {
  return (
    <div>
      {label ? <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-smoke-600 uppercase">{label}</p> : null}
      <ul className="flex flex-wrap items-start justify-center gap-3">
        {items.map((t) => (
          <li key={t.id} className="flex w-[76px] flex-col items-center gap-1">
            <Art id={t.art} size={40} alt="" />
            <span className="text-[11px] leading-tight font-semibold text-smoke-600">{t.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LevelUpBanner() {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const router = useRouter()
  const [run, setRun] = useState<Run | null>(null)
  const timer = useRef<number | null>(null)

  const dismiss = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setRun(null)
  }, [])

  useGameEvents((event) => {
    if (event.type !== 'levelUp') return
    setRun((prev) =>
      prev === null
        ? {
            from: event.level,
            to: event.level,
            credits: event.credits,
            unlocked: [...event.unlocked],
            hardware: [...event.hardware],
            nonce: 1,
          }
        : {
            from: Math.min(prev.from, event.level),
            to: Math.max(prev.to, event.level),
            credits: prev.credits + event.credits,
            unlocked: [...prev.unlocked, ...event.unlocked],
            hardware: [...prev.hardware, ...event.hardware],
            nonce: prev.nonce + 1,
          },
    )
  })

  // One timer per run, restarted by the nonce so a merged second level-up gets its full five
  // seconds instead of inheriting whatever was left of the first one's.
  useEffect(() => {
    if (!run) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setRun(null)
    }, LEVEL_UP_MS)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [run])

  const { hardware, models } = useMemo((): { hardware: HardwareDef[]; models: ModelDef[] } => {
    if (!run) return { hardware: [], models: [] }
    const index = buildIndex(store.catalog)
    return { hardware: resolve(run.hardware, index.hardwareById), models: resolve(run.unlocked, index.modelById) }
  }, [run, store])

  const showHardware = useCallback(() => {
    const first = hardware[0]
    dismiss()
    if (!first) return
    runGuideAction({ type: 'store', tab: 'hardware', family: first.family, focusId: first.id }, router)
  }, [hardware, dismiss, router])

  const showModels = useCallback(() => {
    const first = models[0]
    dismiss()
    if (!first) return
    runGuideAction({ type: 'store', tab: 'models', focusId: first.id }, router)
  }, [models, dismiss, router])

  const hasHardware = hardware.length > 0
  const hasModels = models.length > 0
  const both = hasHardware && hasModels
  // The shelf first: a card is what the level was gating, and the checkpoint runs on it.
  const showMe = hasHardware ? showHardware : showModels

  const range = run !== null && run.to > run.from

  return (
    <AnimatePresence>
      {run ? (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div
            key="level-up"
            role="status"
            aria-live="polite"
            onClick={dismiss}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -10 }}
            transition={reduced ? { duration: 0.1 } : { type: 'spring', stiffness: 380, damping: 26 }}
            className="pointer-events-auto w-full max-w-[420px] cursor-pointer rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-slot-mask bg-charcoal-600 p-5 text-center shadow-[0_4px_0_#0e0e0f,0_24px_60px_rgba(0,0,0,0.5)]"
          >
            <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold tracking-[0.16em] text-electric-400 uppercase">
              <ChevronsUp size={14} aria-hidden="true" />
              Level up
            </p>
            <p className="mt-1 text-[40px] leading-none font-extrabold tracking-tight text-smoke-100 tabular-nums">
              {range ? (
                <>
                  {run.from} <span className="text-2xl text-smoke-600">to</span> {run.to}
                </>
              ) : (
                run.to
              )}
            </p>
            <p className="mt-1 text-sm font-semibold text-smoke-100">{levelTitle(run.to)}</p>

            {hasHardware || hasModels ? (
              <div className="mt-4 flex flex-col gap-3">
                {hasHardware ? (
                  <TileRow
                    label={both ? 'New in the store' : undefined}
                    items={hardware.map((h) => ({ id: h.id, art: `hw-${h.id}`, name: h.name }))}
                  />
                ) : null}
                {hasModels ? (
                  <TileRow
                    label={both ? 'New checkpoints' : undefined}
                    items={models.map((m) => ({ id: m.id, art: `model-${m.id}`, name: m.name }))}
                  />
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs text-smoke-600">No new model at this one. The credits are real.</p>
            )}

            <p className="mt-4 flex items-center justify-center gap-1 text-lg font-extrabold text-credits tabular-nums">
              <CreditsIcon size={16} aria-hidden="true" />+{formatNum(run.credits)}
            </p>

            <div className="mt-4 flex items-center justify-center gap-2">
              {hasHardware || hasModels ? (
                <ModalButton
                  tone="primary"
                  size="sm"
                  data-autofocus
                  onClick={(e) => {
                    e.stopPropagation()
                    showMe()
                  }}
                >
                  Show me
                </ModalButton>
              ) : null}
              {both ? (
                <ModalButton
                  tone="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    showModels()
                  }}
                >
                  Checkpoints
                </ModalButton>
              ) : null}
              <ModalButton
                tone="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  dismiss()
                }}
              >
                Later
              </ModalButton>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}
