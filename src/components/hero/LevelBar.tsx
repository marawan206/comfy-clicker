'use client'
/**
 * The level, as a bar in the hero panel rather than a chip in the header that nobody read.
 *
 * Three rows in one button. `LV 4 Guidance Scale` with the percent and the XP still to go; a
 * 6 px electric bar; and what the next level opens, as chips (cards first, then checkpoints, then
 * the Lounge on the level that has it) with `+N more` past three. The whole thing opens the Level
 * screen, where the roadmap and every way to earn XP live: nothing here explains, it only points.
 *
 * Selectors return primitives (the level, the whole-number percent, the XP to go), so the 20 Hz
 * loop re-renders this only when a number moves, and the chips are memoised on the level.
 *
 * Feedback: every `xp` event floats `+16 XP` off the right end of the bar and pulses it. Grants
 * that land inside `XP_COALESCE_MS` of each other become one figure, because an achievement and
 * the post that earned it arrive in the same tick and two floats on top of each other read as
 * noise. A `levelUp` fills the bar, flashes it, then lets it spring down to the new percent. Under
 * reduced motion the numbers still move and the float still rises (the FX canvas decides whether
 * it draws); only the pulse and the fill-and-settle are skipped.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'motion/react'
import { useGameEvents, useGameShallow, useGameStore } from '@/state/useGame'
import { MAX_LEVEL } from '@/game/constants'
import { formatInt } from '@/game/format'
import { levelProgress, levelTitle, nextUnlocks } from '@/game/level'
import type { Catalog } from '@/game/types'
import { Art } from '@/components/common/Art'
import { Tooltip } from '@/components/common/Tooltip'
import { levelChipTip } from '@/components/common/tooltipCopy'
import { fx } from '@/components/fx/fxBus'
import { OPEN_MODAL_EVENT, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { cn } from '@/lib/utils'

/** `electric-400`: the bar, and the colour every XP float wears. */
const ELECTRIC = '#f0ff41'
/** Grants closer together than this become one float. */
const XP_COALESCE_MS = 150
/** How long the bar sits at 100 % after a level-up before it springs down to the new percent. */
const LEVEL_FILL_MS = 600
/** Chips shown for the next level before the row says `+N more`. */
const MAX_CHIPS = 3

const TAP = { type: 'spring', stiffness: 500, damping: 30 } as const
const BAR_SPRING = { type: 'spring', stiffness: 220, damping: 30 } as const
const INSTANT = { duration: 0 } as const
/** The pulse behind an XP grant: a brightness bump and a little height, on the track. */
const PULSE = { filter: ['brightness(1)', 'brightness(1.8)', 'brightness(1)'], scaleY: [1, 1.5, 1] }
/** The flash behind a level-up: brighter, and it lingers while the bar sits full. */
const FLASH = { filter: ['brightness(1)', 'brightness(2.4)', 'brightness(1.4)', 'brightness(1)'], scaleY: [1, 1.8, 1.3, 1] }

// ---------------------------------------------------------------------------
// Pure helpers (exported so a test can pin them without a DOM)
// ---------------------------------------------------------------------------

export interface UnlockChip {
  key: string
  /** Art id (`hw-<id>` or `model-<id>`), or null for a feature, which renders as a plain chip. */
  art: string | null
  name: string
}

/**
 * What the level after `level` opens, as chips: hardware first, then models, then features, the
 * first `max` of them, and how many were left out. Empty at MAX_LEVEL, and empty on a rung that
 * only pays credits.
 */
export function unlockChips(level: number, catalog: Catalog, max = MAX_CHIPS): { chips: UnlockChip[]; more: number } {
  const next = nextUnlocks(level, catalog)
  const all: UnlockChip[] = [
    ...next.hardware.map((h) => ({ key: `hw-${h.id}`, art: `hw-${h.id}`, name: h.name })),
    ...next.models.map((m) => ({ key: `model-${m.id}`, art: `model-${m.id}`, name: m.name })),
    ...next.features.map((name) => ({ key: `feature-${name}`, art: null, name })),
  ]
  return { chips: all.slice(0, max), more: Math.max(0, all.length - max) }
}

/** 0..100, floored, so the bar never reads 100 while there is XP still to go. */
export function pctOf(fraction: number): number {
  if (!(fraction > 0)) return 0
  return Math.min(100, Math.floor(fraction * 100))
}

/** The accessible name: the level, the percent, and what the next level opens. */
export function levelBarLabel(level: number, pct: number, xpToGo: number, names: readonly string[], more: number): string {
  const title = levelTitle(level)
  if (level >= MAX_LEVEL) return `Level ${level}, ${title}, maxed. Open your level.`
  const next = level + 1
  const opens =
    names.length === 0 ? `Level ${next} pays credits only.` : `Level ${next} unlocks ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`
  return `Level ${level}, ${title}, ${pct} percent of the way to level ${next}, ${formatInt(xpToGo)} XP to go. ${opens} Open your level.`
}

/** A float off a bar the player cannot see is a float nobody sees, and the canvas caps them. */
function inViewport(rect: DOMRect): boolean {
  return rect.width > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
}

function openLevel(): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_MODAL_EVENT, { detail: 'level' }))
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

function Chip({ chip }: { chip: UnlockChip }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-comfy border border-charcoal-400 bg-charcoal-700 py-0.5 pr-1.5 text-smoke-100',
        chip.art ? 'pl-0.5' : 'pl-1.5',
      )}
    >
      {chip.art ? <Art id={chip.art} size={20} alt="" className="shrink-0" /> : null}
      <span className="truncate">{chip.name}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

export function LevelBar() {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const controls = useAnimationControls()
  const trackRef = useRef<HTMLSpanElement | null>(null)
  const pending = useRef(0)
  const floatTimer = useRef(0)
  const holdTimer = useRef(0)
  /** True between a level-up and the settle: the fill's target is 100 % rather than the percent. */
  const [full, setFull] = useState(false)

  const { level, pct, xpToGo } = useGameShallow((s) => {
    const p = levelProgress(s)
    return { level: p.level, pct: pctOf(p.fraction), xpToGo: p.xpToGo }
  })
  const maxed = level >= MAX_LEVEL
  const title = levelTitle(level)

  const { chips, more } = useMemo(() => unlockChips(level, store.catalog), [level, store])

  const tip = useMemo(() => {
    const p = levelProgress(store.state)
    const next = nextUnlocks(p.level, store.catalog)
    return levelChipTip({
      level: p.level,
      levelTitle: levelTitle(p.level),
      xp: p.xp,
      ceiling: p.ceiling > p.floor ? p.ceiling : null,
      unlocks: [...next.hardware.map((h) => h.name), ...next.models.map((m) => m.name)],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when a number moves, not every tick
  }, [store, level, pct, xpToGo])

  /** One float and one pulse for everything that landed inside the coalescing window. */
  const floatXp = useCallback(
    (amount: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || !inViewport(rect)) return
      fx.floatText(rect.right - 16, rect.top - 6, `+${formatInt(amount)} XP`, ELECTRIC)
      if (!reduced) void controls.start(PULSE, { duration: 0.4, ease: 'easeOut' })
    },
    [controls, reduced],
  )

  useGameEvents((e) => {
    if (e.type === 'xp') {
      pending.current += e.amount
      if (floatTimer.current) return
      floatTimer.current = window.setTimeout(() => {
        floatTimer.current = 0
        const amount = pending.current
        pending.current = 0
        if (amount > 0) floatXp(amount)
      }, XP_COALESCE_MS)
      return
    }
    if (e.type === 'levelUp') {
      // The numbers have already moved; under reduced motion the bar simply shows them.
      if (reduced) return
      setFull(true)
      void controls.start(FLASH, { duration: 0.7, ease: 'easeOut' })
      window.clearTimeout(holdTimer.current)
      holdTimer.current = window.setTimeout(() => setFull(false), LEVEL_FILL_MS)
    }
  })

  useEffect(
    () => () => {
      window.clearTimeout(floatTimer.current)
      window.clearTimeout(holdTimer.current)
    },
    [],
  )

  const names = useMemo(() => chips.map((c) => c.name), [chips])
  const right = maxed ? null : `${pct}% · ${formatInt(xpToGo)} XP to go`

  return (
    <Tooltip {...tip} side="top">
      <motion.button
        type="button"
        data-tour="level"
        onClick={openLevel}
        whileTap={reduced ? undefined : { scale: 0.985 }}
        transition={TAP}
        aria-label={levelBarLabel(level, pct, xpToGo, names, more)}
        className="flex w-full cursor-pointer flex-col gap-1.5 rounded-comfy border-2 border-transparent px-2 py-1.5 text-left outline-none hover:border-charcoal-400 hover:bg-charcoal-700/60 focus-visible:ring-2 focus-visible:ring-electric-400"
      >
        {/* Row one: the level, the title, the numbers. */}
        <span className="flex w-full items-baseline gap-1.5">
          <span className="text-[10px] font-bold tracking-[0.08em] text-electric-400 uppercase">LV</span>
          <span className="text-base leading-none font-extrabold tracking-tight text-electric-400 tabular-nums">{level}</span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-smoke-100">
            {title}
            {maxed ? <span className="font-semibold text-smoke-600"> · maxed</span> : null}
          </span>
          {right ? <span className="shrink-0 text-[11px] font-semibold text-smoke-600 tabular-nums">{right}</span> : null}
        </span>

        {/* Row two: the bar. The track carries the pulse so the fill keeps its own width spring. */}
        <motion.span
          ref={trackRef}
          animate={controls}
          aria-hidden="true"
          className="block h-1.5 w-full origin-center overflow-hidden rounded-full bg-charcoal-800"
        >
          <motion.span
            className="block h-full rounded-full bg-electric-400"
            initial={false}
            animate={{ width: `${full ? 100 : pct}%` }}
            transition={reduced ? INSTANT : BAR_SPRING}
          />
        </motion.span>

        {/* Row three: what the next level opens. Gone at the top of the table. */}
        {maxed ? null : (
          <span className="flex w-full flex-wrap items-center gap-1 text-[11px] font-semibold text-smoke-600">
            <span className="shrink-0">{chips.length > 0 ? `Next: level ${level + 1} unlocks` : `Next: level ${level + 1} · credits only`}</span>
            {chips.map((chip) => (
              <Chip key={chip.key} chip={chip} />
            ))}
            {more > 0 ? <span className="shrink-0 text-smoke-800">+{more} more</span> : null}
          </span>
        )}
      </motion.button>
    </Tooltip>
  )
}
