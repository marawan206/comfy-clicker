'use client'
/**
 * The Level screen: where the level stands, every way to earn XP with the number each one pays,
 * where the XP so far came from, and the roadmap of every level with what it opens.
 *
 * Nothing in the earn table is a literal. Every figure is a constant or a function out of
 * `src/game/level.ts`, so a retune moves this screen with it. Each row is a button that takes the
 * player to the place the XP is made, through the same `GuideAction` vocabulary the guidance
 * popover uses, and closes the modal first so the destination is not sitting under a dialog.
 *
 * The roadmap is public information from the first minute: every unit, every checkpoint and the
 * Lounge sit on their rung, past levels dimmed, the current one ringed, the rest with a lock. It
 * scrolls in its own box and lands on the current rung when the modal opens, so a level 14 player
 * is not shown level 1 first.
 */
import { memo, useCallback, useEffect, useMemo, useRef, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { ArrowRight, Check, ChevronsUp, Dices, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Art } from '@/components/common/Art'
import type { GuideAction } from '@/components/guidance/lockGuide'
import { runGuideAction } from '@/components/guidance/navigate'
import { ModalBase, SectionLabel, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { LORA_MAP_NODE } from '@/game/actions'
import {
  MAX_LEVEL,
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_CREDITS,
  XP_HARDWARE_FIRST,
  XP_LORA,
  XP_MAP_NODE,
  XP_MILESTONE,
  XP_POST_BASE,
  XP_POST_PER_LEVEL,
  XP_QUANTIZE,
  XP_REBRAND,
  XP_SETUP,
  XP_TIER,
  XP_UPGRADE,
  XP_VIRAL_MULT,
} from '@/game/constants'
import { DAILY_CYCLE_DAYS } from '@/game/daily'
import { formatInt } from '@/game/format'
import {
  creditsXp,
  dailyXp,
  levelProgress,
  levelRoadmap,
  levelTitle,
  playerXp,
  postXp,
  xpBreakdown,
  type LevelRung,
} from '@/game/level'
import { ROOT_NODE_ID, mapNodeAvailable, mapNodeCost } from '@/game/map'
import type { Catalog, Derived, GameState, ModelDef } from '@/game/types'
import { useNow } from '@/hooks/useNow'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'

export interface LevelModalProps {
  open: boolean
  onClose: () => void
}

/**
 * How often the earn table looks again. Its rows depend on things the XP total does not always
 * move (a Graph node coming into reach on a stat), and a scan of the map per second is plenty.
 */
const EARN_TICK_MS = 1000

export function LevelModal({ open, onClose }: LevelModalProps) {
  return (
    <ModalBase open={open} onClose={onClose} title="Level" icon={<ChevronsUp size={16} />} stripe="electric" size="lg">
      <LevelBody onClose={onClose} />
    </ModalBase>
  )
}

function LevelBody({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <LevelHeader />
      <EarnSection onClose={onClose} />
      <SourcesSection />
      <RoadmapSection />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/** `LV 4 · Guidance Scale`, the bar, and the figure under it. */
function LevelHeader() {
  const p = useGameShallow((state) => {
    const prog = levelProgress(state)
    return {
      level: prog.level,
      xp: prog.xp,
      ceiling: prog.ceiling,
      pct: Math.floor(prog.fraction * 100),
      xpToGo: prog.xpToGo,
    }
  })
  const maxed = p.level >= MAX_LEVEL

  return (
    <section
      aria-label="Your level"
      className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-electric-400 bg-charcoal-700/40 p-3"
    >
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-3xl leading-none font-extrabold tracking-tight text-electric-400 tabular-nums">LV {p.level}</span>
        <span className="text-sm text-smoke-600" aria-hidden="true">
          ·
        </span>
        <span className="text-sm font-semibold text-smoke-100">{levelTitle(p.level)}</span>
      </p>
      <XpBar fraction={maxed ? 1 : p.pct / 100} className="mt-2 h-2" />
      <p className="mt-1.5 text-xs text-smoke-600 tabular-nums">
        {maxed ? (
          <>
            <span className="font-extrabold text-smoke-100">{formatInt(p.xp)}</span> XP ·{' '}
            <span className="font-semibold text-electric-400">maxed</span>
          </>
        ) : (
          <>
            <span className="font-extrabold text-smoke-100">{formatInt(p.xp)}</span> / {formatInt(p.ceiling)} XP · {formatInt(p.xpToGo)} to go
          </>
        )}
      </p>
    </section>
  )
}

/** The electric bar. A spring on the fill, instant under reduced motion. */
function XpBar({ fraction, className }: { fraction: number; className?: string }) {
  const reduced = useReducedMotionPref()
  const clamped = Math.min(1, Math.max(0, fraction))
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-charcoal-700', className)}
      role="meter"
      aria-label="XP through this level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <motion.div
        className="h-full w-full origin-left bg-electric-400"
        initial={false}
        animate={{ scaleX: clamped }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// How to earn XP
// ---------------------------------------------------------------------------

export interface EarnRow {
  key: string
  /** The thing to do: `Post with Stable Diffusion 1.5`. */
  label: string
  /** What it pays, as the row prints it: `+7`, `+40 · tiers +60`, `+40 to +280`. */
  value: string
  /** One short line under the label, when the figure needs a footnote. */
  note?: string
  /** Where the XP is made. */
  action: GuideAction
}

/** The set-up model that pays the most per post: the highest `minLevel` with `setup` true. */
export function bestSetupModel(state: GameState, catalog: Catalog): ModelDef | null {
  let best: ModelDef | null = null
  for (const model of catalog.models) {
    if (state.models[model.id]?.setup !== true) continue
    if (!best || (model.minLevel ?? 1) > (best.minLevel ?? 1)) best = model
  }
  return best
}

/** The cheapest node the Graph would sell right now, or the root when nothing is on offer. */
export function cheapestOpenNode(state: GameState, derived: Derived, catalog: Catalog): string {
  let bestId: string | null = null
  let bestCost = Infinity
  for (const node of catalog.mapNodes) {
    if (!mapNodeAvailable(node, state, derived, catalog)) continue
    const cost = mapNodeCost(node)
    if (cost < bestCost) {
      bestCost = cost
      bestId = node.id
    }
  }
  return bestId ?? ROOT_NODE_ID
}

/** What a landed post pays on `model`, or on the starter formula when there is no model at all. */
function postPays(model: ModelDef | undefined, viral: boolean): number {
  if (model) return postXp(model, viral)
  return (XP_POST_BASE + XP_POST_PER_LEVEL) * (viral ? XP_VIRAL_MULT : 1)
}

/**
 * Every way to earn XP, in the order the screen lists them, with the live number each one pays
 * and the place it is paid. Pure, so the rows can be pinned without a store.
 */
export function earnRows(state: GameState, derived: Derived, catalog: Catalog): EarnRow[] {
  const model = bestSetupModel(state, catalog) ?? catalog.models[0]
  const loraOnGraph = state.mapNodes.includes(LORA_MAP_NODE)
  return [
    {
      key: 'post',
      label: `Post with ${model?.name ?? 'a checkpoint'}`,
      value: `+${postPays(model, false)}`,
      note: `+${postPays(model, true)} when it goes viral`,
      action: { type: 'center', tab: 'studio' },
    },
    { key: 'contract', label: 'Finish a contract', value: `+${XP_CONTRACT}`, action: { type: 'center', tab: 'contracts' } },
    {
      key: 'mapNode',
      label: 'Unlock a Graph node',
      value: `+${XP_MAP_NODE}`,
      action: { type: 'map', nodeId: cheapestOpenNode(state, derived, catalog) },
    },
    { key: 'achievement', label: 'Earn an achievement', value: `+${XP_ACHIEVEMENT}`, action: { type: 'modal', id: 'stats' } },
    {
      key: 'hardware',
      label: 'Buy a card you have never owned',
      value: `+${XP_HARDWARE_FIRST}`,
      note: 'once per kind, whatever the count',
      action: { type: 'store', tab: 'hardware' },
    },
    { key: 'upgrade', label: 'Buy an upgrade', value: `+${XP_UPGRADE} · tiers +${XP_TIER}`, action: { type: 'store', tab: 'upgrades' } },
    { key: 'setup', label: 'Set up a checkpoint', value: `+${XP_SETUP}`, action: { type: 'store', tab: 'models' } },
    { key: 'quantize', label: 'Quantize one', value: `+${XP_QUANTIZE}`, action: { type: 'store', tab: 'models' } },
    {
      key: 'lora',
      label: 'Train a LoRA',
      value: `+${XP_LORA}`,
      note: loraOnGraph ? undefined : 'LoRA Training is a Graph node first',
      action: loraOnGraph ? { type: 'store', tab: 'models' } : { type: 'map', nodeId: LORA_MAP_NODE },
    },
    {
      key: 'daily',
      label: 'Claim the daily',
      value: `+${dailyXp(1)} to +${dailyXp(DAILY_CYCLE_DAYS)}`,
      note: 'the streak is what pays',
      action: { type: 'modal', id: 'daily' },
    },
    {
      key: 'milestone',
      label: 'Reach the next income milestone',
      value: `+${XP_MILESTONE}`,
      note: 'every power of ten per second',
      action: { type: 'hero' },
    },
    { key: 'rebrand', label: 'Rebrand', value: `+${XP_REBRAND}`, action: { type: 'modal', id: 'rebrand' } },
    {
      key: 'credits',
      label: 'Credits earned',
      value: `${XP_CREDITS} per decade`,
      note: `you are at ${formatInt(creditsXp(state))}`,
      action: { type: 'hero' },
    },
  ]
}

function EarnSection({ onClose }: { onClose: () => void }) {
  const store = useGameStore()
  const router = useRouter()
  const tick = useNow(EARN_TICK_MS)
  // The total moves on every grant, which covers the model set up, the node bought and the
  // credits term; the tick covers a node coming into reach on its own.
  const xp = useGame(playerXp)
  const rows = useMemo(
    () => earnRows(store.state, store.derived, store.catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` and `xp` are the change signal for the live store
    [store, tick, xp],
  )
  const go = useCallback(
    (action: GuideAction) => {
      onClose()
      runGuideAction(action, router)
    },
    [onClose, router],
  )

  return (
    <section aria-labelledby="level-earn">
      <SectionLabel className="mb-2">
        <span id="level-earn">How to earn XP</span>
      </SectionLabel>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => go(row.action)}
              className="flex w-full items-center gap-2 rounded-comfy border border-charcoal-400 bg-charcoal-700/50 px-2.5 py-2 text-left transition-colors hover:border-electric-400 hover:bg-charcoal-700"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold leading-snug text-smoke-100">{row.label}</span>
                {row.note ? <span className="block text-[11px] leading-snug text-smoke-600">{row.note}</span> : null}
              </span>
              <span className="shrink-0 text-xs font-extrabold tabular-nums text-electric-400">{row.value}</span>
              <ArrowRight size={12} className="shrink-0 text-smoke-800" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Where it came from
// ---------------------------------------------------------------------------

function SourcesSection() {
  const store = useGameStore()
  // The breakdown is a handful of floors over the whole state; it only moves when the total moves.
  const xp = useGame(playerXp)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `xp` is the change signal for the live store
  const rows = useMemo(() => xpBreakdown(store.state), [store, xp])

  return (
    <section aria-labelledby="level-sources">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>
          <span id="level-sources">Where it came from</span>
        </SectionLabel>
        <p className="text-xs text-smoke-600 tabular-nums">
          <span className="font-extrabold text-smoke-100">{formatInt(xp)}</span> XP in all
        </p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-xl border border-charcoal-400 bg-charcoal-700/40 p-3 sm:grid-cols-[1fr_auto_1fr_auto]">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-xs text-smoke-600">{r.label}</dt>
            <dd className="text-right text-xs font-bold text-smoke-100 tabular-nums">{formatInt(r.xp)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------

type RungStatus = 'past' | 'current' | 'future'

function RoadmapSection() {
  const store = useGameStore()
  const { level, pct } = useGameShallow((state) => {
    const prog = levelProgress(state)
    return { level: prog.level, pct: Math.floor(prog.fraction * 100) }
  })
  // Built once per catalog object and shared; read, never mutated.
  const rungs = levelRoadmap(store.catalog)
  const listRef = useRef<HTMLOListElement>(null)
  const currentRef = useRef<HTMLLIElement>(null)

  // Land on the current rung when the modal opens (the body mounts with it) and follow a level-up
  // while it is open. Only the list's own scroll moves: `scrollIntoView` would drag the modal body
  // down past the header and the earn table as well.
  useEffect(() => {
    const list = listRef.current
    const row = currentRef.current
    if (!list || !row) return
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2)
  }, [level])

  return (
    <section aria-labelledby="level-roadmap">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>
          <span id="level-roadmap">Roadmap</span>
        </SectionLabel>
        <p className="text-xs text-smoke-600 tabular-nums">
          {MAX_LEVEL} levels · every unlock is on the list
        </p>
      </div>
      <ol
        ref={listRef}
        aria-label="Every level and what it opens"
        className="relative flex max-h-[46vh] flex-col gap-1 overflow-y-auto rounded-xl border border-charcoal-400 bg-charcoal-700/40 p-2"
      >
        {rungs.map((rung) => {
          const status: RungStatus = rung.level < level ? 'past' : rung.level === level ? 'current' : 'future'
          return (
            <RoadmapRow
              key={rung.level}
              rung={rung}
              status={status}
              pct={status === 'current' ? pct : 0}
              rowRef={status === 'current' ? currentRef : undefined}
            />
          )
        })}
      </ol>
    </section>
  )
}

const RoadmapRow = memo(function RoadmapRow({
  rung,
  status,
  pct,
  rowRef,
}: {
  rung: LevelRung
  status: RungStatus
  pct: number
  rowRef?: Ref<HTMLLIElement>
}) {
  const current = status === 'current'
  const unlocks = rung.hardware.length + rung.models.length + rung.features.length
  return (
    <li
      ref={rowRef}
      aria-current={current ? 'step' : undefined}
      className={cn(
        'flex gap-3 rounded-comfy border px-2.5 py-2',
        current ? 'border-electric-400 bg-electric-400/5 ring-1 ring-electric-400/60' : 'border-transparent',
        status === 'past' && 'opacity-55',
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-[0.354em] border text-xs font-extrabold tabular-nums',
          current ? 'border-electric-400 bg-electric-400 text-charcoal-800' : 'border-charcoal-400 bg-charcoal-700 text-smoke-100',
        )}
      >
        {rung.level}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-smoke-100">{rung.title}</span>
          <span className="text-[11px] text-smoke-600 tabular-nums">{rung.level === 1 ? 'start' : `${formatInt(rung.xp)} XP`}</span>
          {current ? <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-electric-400">you are here</span> : null}
          <span className="ml-auto flex items-center text-smoke-800">
            {status === 'past' ? (
              <>
                <Check size={12} className="text-slot-mask" aria-hidden="true" />
                <span className="sr-only">reached</span>
              </>
            ) : status === 'future' ? (
              <>
                <Lock size={12} aria-hidden="true" />
                <span className="sr-only">not yet</span>
              </>
            ) : null}
          </span>
        </div>
        {current ? <XpBar fraction={pct / 100} className="mt-1.5 h-1.5" /> : null}
        {unlocks > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Level ${rung.level} unlocks`}>
            {rung.hardware.map((h) => (
              <Chip key={`hw-${h.id}`} art={`hw-${h.id}`} name={h.name} />
            ))}
            {rung.models.map((m) => (
              <Chip key={`model-${m.id}`} art={`model-${m.id}`} name={m.name} />
            ))}
            {rung.features.map((f) => (
              <Chip key={f} name={f} feature />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-smoke-800">Nothing new on the shelf. The credits land all the same.</p>
        )}
      </div>
    </li>
  )
})

/** One unlock on a rung: art and name for a card or a checkpoint, a die for the Lounge. */
function Chip({ art, name, feature }: { art?: string; name: string; feature?: boolean }) {
  return (
    <li className={cn('flex items-center gap-1.5 rounded-comfy border border-charcoal-400 bg-charcoal-600 py-0.5 pr-2', art ? 'pl-0.5' : 'pl-2')}>
      {art ? <Art id={art} size={20} alt="" /> : <Dices size={12} className="text-slot-latent" aria-hidden="true" />}
      <span className={cn('text-[11px] font-semibold', feature ? 'text-slot-latent' : 'text-smoke-100')}>{name}</span>
    </li>
  )
}
