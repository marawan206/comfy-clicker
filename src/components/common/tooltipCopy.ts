/**
 * Copy builders for the rich tooltips. Pure functions: they take the data the calling component
 * already has and return `TooltipProps` fields, so every string is testable without a DOM and the
 * wording lives in one place instead of in fifteen `title=` attributes.
 *
 * Nothing here imports from `@/game` beyond types and the formatters, and nothing reads the store.
 */
import type { HardwareDef, HashtagDef, ModelDef, ModelKind, Precision, PrecisionDef, UpgradeDef } from '@/game/types'
import { formatCps, formatDuration, formatInt, formatNum, formatPct, formatWatts } from '@/game/format'
import type { TooltipCost, TooltipSide, TooltipTone } from './Tooltip'

/** The subset of `TooltipProps` a copy builder fills in; spread straight onto `<Tooltip>`. */
export interface TooltipCopy {
  title: string
  description?: string
  cost?: TooltipCost
  meta?: string
  lock?: string | null
  shortcut?: string
  tone?: TooltipTone
  side?: TooltipSide
}

// ---------------------------------------------------------------------------
// Local formatting helpers (kept here so the builders stay import-light)
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<ModelKind, string> = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' }
const KIND_WORDS: Record<ModelKind, string> = { image: 'image', video: 'video', '3d': '3D', audio: 'audio' }
const KIND_ARTICLES: Record<ModelKind, string> = { image: 'an', video: 'a', '3d': 'a', audio: 'an' }
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'] as const

const PRECISION_LABELS: Record<Precision, string> = { native: 'Native', fp8: 'FP8', q4: 'Q4 GGUF' }

/** `2.8/s` without the suffix, so a sentence can carry its own units. */
function cpsNumber(cps: number): string {
  return formatCps(cps).replace('/s', '')
}

/** `12 s` below a minute, `3:50` above. Mirrors `formatShortSecs` in studioHooks. */
function shortSecs(sec: number): string {
  if (Number.isNaN(sec) || sec < 0) return '0 s'
  if (!Number.isFinite(sec)) return 'forever'
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`
  return formatDuration(sec)
}

/** One decimal while a click is worth single digits (`1.2`), compact once it is large. */
function clickValueText(value: number): string {
  if (Number.isFinite(value) && value < 100 && !Number.isInteger(value)) return String(Math.round(value * 10) / 10)
  return formatNum(value)
}

/** `640 of 650 W`: only the second figure carries the unit while both fit in watts. */
function wattsPair(draw: number, budget: number): string {
  if (Math.abs(draw) < 1000 && Math.abs(budget) < 1000) return `${formatInt(draw)} of ${formatWatts(budget)}`
  return `${formatWatts(draw)} of ${formatWatts(budget)}`
}

/** `x0.85`: the multiplier the way the precision table prints it, with no trailing zeros. */
function mult(x: number): string {
  return `x${Number(x.toFixed(2))}`
}

/** `ten minutes`, `one minute`, `20 minutes`. */
function minutesWord(minutes: number): string {
  const n = Math.max(1, Math.round(minutes))
  const word = n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : formatInt(n)
  return `${word} ${n === 1 ? 'minute' : 'minutes'}`
}

/** Up to three names, then `and N more`, so a meta line never runs past the popup. */
function nameList(names: readonly string[], max = 3): string {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

/** Join the lines a tooltip renders with `whitespace-pre-line`, dropping the empty ones. */
function lines(...parts: (string | null | undefined | false)[]): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.length > 0)
  return kept.length > 0 ? kept.join('\n') : undefined
}

// ---------------------------------------------------------------------------
// 1. Generate button
// ---------------------------------------------------------------------------

/** The hero button. `clickValue` is `derived.clickValue`. */
export function generateButtonTip(clickValue: number): TooltipCopy {
  return {
    title: 'Generate',
    description: 'One click, one credit. Also shaves 150 ms off the running job.',
    meta: `+${clickValueText(clickValue)} per click`,
    shortcut: 'Space',
    tone: 'electric',
  }
}

// ---------------------------------------------------------------------------
// 2. Credits counter
// ---------------------------------------------------------------------------

/** The header counter. `units` is the number of owned hardware units. */
export function creditsTip(cps: number, units: number): TooltipCopy {
  return {
    title: 'Credits',
    description: 'The only currency. Hardware, models, posts and the Graph all cost it.',
    meta: units > 0 ? `+${formatCps(cps)} from ${formatInt(units)} unit${units === 1 ? '' : 's'}` : 'No hardware yet. Every credit is a click.',
    tone: 'credits',
  }
}

// ---------------------------------------------------------------------------
// 3. Income (cps line)
// ---------------------------------------------------------------------------

export interface IncomeTipState {
  cps: number
  throttled: boolean
  draw: number
  budget: number
}

/** The `+2.8/s` line next to the counter; throttled it explains the breaker instead. */
export function incomeTip({ cps, throttled, draw, budget }: IncomeTipState): TooltipCopy {
  if (throttled) {
    const pct = draw > 0 ? Math.round((budget / draw) * 100) : 100
    return {
      title: 'Throttled',
      description: `Draw ${formatInt(draw)} is over the ${formatInt(budget)} budget. Income runs at ${pct}% until it fits.`,
      tone: 'locked',
      lock: 'Buy a PSU in the Power tab, or shed a card',
    }
  }
  return {
    title: 'Income',
    description: `${cpsNumber(cps)} credits per second from the rack.`,
    tone: 'credits',
  }
}

// ---------------------------------------------------------------------------
// 4. Level chip
// ---------------------------------------------------------------------------

export interface LevelTipState {
  level: number
  /** `LEVEL_TITLES[level]`, e.g. `Guidance Scale`. */
  levelTitle: string
  xp: number
  /** XP the next level needs, or null at the top of the table. */
  ceiling: number | null
  /** Names of the models the next level unlocks, in catalog order. */
  unlocks: readonly string[]
}

const XP_SOURCES = 'XP comes from credits earned, posts, achievements, contracts and Graph nodes.'

/** The header `LV 4` chip. Takes plain numbers so it never imports the level module. */
export function levelChipTip({ level, levelTitle, xp, ceiling, unlocks }: LevelTipState): TooltipCopy {
  const progress = ceiling === null ? `${formatInt(xp)} XP. Top of the table.` : `${formatInt(xp)} of ${formatInt(ceiling)} XP.`
  return {
    title: `Level ${level} · ${levelTitle}`,
    description: `${progress} ${XP_SOURCES}`,
    meta: unlocks.length > 0 ? `Level ${level + 1} unlocks ${nameList(unlocks)}` : undefined,
    tone: 'electric',
  }
}

// ---------------------------------------------------------------------------
// 5. Signups chip
// ---------------------------------------------------------------------------

export function signupsTip(signups: number, rp: number): TooltipCopy {
  return {
    title: 'Comfy Cloud signups',
    description: 'Each signup is a Research Point: +1% income forever, and RP buys Graph nodes.',
    meta: rp > 0 ? `${formatInt(rp)} RP unspent` : `${formatInt(signups)} so far, all spent`,
  }
}

// ---------------------------------------------------------------------------
// 6. Streak chip
// ---------------------------------------------------------------------------

export interface StreakTipState {
  /** Days already banked (`effectiveStreak`). */
  streak: number
  /** Day of the 7-day cycle the next claim pays (`cycleDay(streak + 1)`). */
  nextDay: number
  claimable: boolean
  /** Credits that next claim pays. */
  reward: number
}

export function streakTip({ streak, nextDay, claimable, reward }: StreakTipState): TooltipCopy {
  if (claimable) {
    return {
      title: 'Daily login',
      description: `Day ${nextDay} is waiting: ${formatInt(reward)} credits, ten minutes of income times the day.`,
      tone: 'electric',
    }
  }
  const held = streak > 0 ? `Day ${streak}.` : 'No streak yet.'
  return {
    title: 'Daily login',
    description: `${held} Come back tomorrow (UTC) to keep it. Day 3 adds RP, day 7 adds CP.`,
  }
}

// ---------------------------------------------------------------------------
// 7. Power chip
// ---------------------------------------------------------------------------

export interface PowerTipState {
  draw: number
  budget: number
  throttled: boolean
}

export function powerTip({ draw, budget, throttled }: PowerTipState): TooltipCopy {
  return {
    title: 'Power',
    description: `${wattsPair(draw, budget)}. Past the breaker, income scales by budget over draw.`,
    tone: throttled ? 'locked' : 'default',
    lock: throttled ? 'Breaker tripped · buy a PSU in the Power tab' : null,
  }
}

// ---------------------------------------------------------------------------
// 8. Save status
// ---------------------------------------------------------------------------

export interface SaveTipState {
  autosave: boolean
  /** The browser refused the last write (storage full or private mode). */
  failed?: boolean
  /** The chip's own wording, e.g. `saved 12s ago`. */
  status?: string | null
}

export function saveStatusTip({ autosave, failed = false, status }: SaveTipState): TooltipCopy {
  if (failed) {
    return {
      title: 'Not saving',
      description: 'The browser refused the write (storage full or private mode). Export a code from Settings.',
      meta: status ?? undefined,
      tone: 'locked',
      lock: 'Nothing has been written since the refusal',
    }
  }
  if (!autosave) {
    return {
      title: 'Autosave off',
      description: 'Only S, Save now, and leaving the tab write the save. Living dangerously.',
      meta: status ?? undefined,
      tone: 'credits',
    }
  }
  return {
    title: 'Autosave',
    description: 'Every 10 s, 1.5 s after any purchase, and when the tab hides. S saves now.',
    meta: status ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// 9. Hardware row
// ---------------------------------------------------------------------------

/** `useHardwareRow`'s slice plus the player's credits; extra fields on the row are ignored. */
export interface HardwareRowTipState {
  cost: number
  /** `state.credits`. */
  have: number
  cpsEach: number
  paybackSec: number
  lockReason?: string | null
}

/** A store hardware row. Side `left` so the popup never covers the column it belongs to. */
export function hardwareRowTip(def: HardwareDef, row: HardwareRowTipState): TooltipCopy {
  const locked = typeof row.lockReason === 'string' && row.lockReason.length > 0
  return {
    title: def.name,
    description: lines(def.realWorld, def.flavor),
    cost: { credits: row.cost, have: row.have },
    meta: locked ? undefined : `+${formatCps(row.cpsEach)} each · payback ${formatDuration(row.paybackSec)} · ${formatWatts(def.watts)}`,
    lock: locked ? row.lockReason : null,
    tone: locked ? 'locked' : 'default',
    side: 'left',
  }
}

// ---------------------------------------------------------------------------
// 10. Upgrade row
// ---------------------------------------------------------------------------

/** `useUpgradeRow`'s slice plus the player's balance in that currency. */
export interface UpgradeRowTipState {
  cost: number
  currency: 'credits' | 'rp' | 'cp'
  have: number
}

/** A store upgrade row; `effects` is `summarizeEffects(def.effects, catalog)`. */
export function upgradeRowTip(def: UpgradeDef, row: UpgradeRowTipState, effects?: string): TooltipCopy {
  const cost: TooltipCost =
    row.currency === 'rp' ? { rp: row.cost } : row.currency === 'cp' ? { cp: row.cost } : { credits: row.cost, have: row.have }
  return {
    title: def.name,
    description: def.desc,
    cost,
    meta: effects && effects.length > 0 ? effects : undefined,
    side: 'left',
  }
}

// ---------------------------------------------------------------------------
// 11. Model chip
// ---------------------------------------------------------------------------

/** A `ModelRosterEntry`; only these fields are read, so the roster can grow without breaking this. */
export interface ModelChipEntry {
  model: Pick<ModelDef, 'name' | 'kind' | 'flavor'>
  setup: boolean
  ready: boolean
  setupFee: number
  hardwareName: Partial<Record<Precision, string>>
  lockReasons: Record<Precision, string | null>
}

export interface ModelChipTipState {
  precision: Precision
  /** `jobCost(model, precision, derived, catalog)`. */
  cost: number
  have: number
  /** Seconds a job takes on the unit it would run on, or null when nothing can run it. */
  genSec?: number | null
}

/** Why a not-ready model cannot be used, worded like `ModelChips.lockedReason`. */
function modelLockReason(entry: ModelChipEntry): string {
  if (!entry.setup) {
    const fee = entry.setupFee > 0 ? `${formatNum(entry.setupFee)} credits to set up` : 'free to set up'
    const reason = entry.lockReasons.native
    return reason ? `Not set up · ${fee} · ${reason}` : `Not set up · ${fee}`
  }
  return entry.lockReasons.native ?? 'Nothing you own can run this'
}

/** A Studio model chip, ready or locked. */
export function modelChipTip(entry: ModelChipEntry, run: ModelChipTipState): TooltipCopy {
  const title = `${entry.model.name} · ${KIND_LABELS[entry.model.kind]}`
  if (!entry.ready) {
    return {
      title,
      description: entry.model.flavor,
      tone: 'locked',
      lock: modelLockReason(entry),
    }
  }
  const on = entry.hardwareName[run.precision]
  const parts: string[] = []
  if (on) parts.push(`runs ${PRECISION_LABELS[run.precision]} on ${on}`)
  if (typeof run.genSec === 'number') parts.push(`about ${shortSecs(run.genSec)}`)
  return {
    title,
    description: entry.model.flavor,
    cost: { credits: run.cost, have: run.have },
    meta: parts.length > 0 ? parts.join(' · ') : undefined,
  }
}

// ---------------------------------------------------------------------------
// 12. Precision cell
// ---------------------------------------------------------------------------

export interface PrecisionCellTipState {
  /** The precision is owned for this model (native always is). */
  unlocked: boolean
  /** Something owned can run the model at this precision. */
  runnable: boolean
  /** Why it is not available, credits aside: `quant.blocker` or the engine's lock reason. */
  blocker?: string | null
  /** One-off quantization fee, when the tier still has to be bought. */
  fee?: number
  have?: number
}

/** One cell of the Studio precision toggle; `ev` is `expectedReturn(...) - 1`. */
export function precisionCellTip(def: PrecisionDef, ev: number, cell: PrecisionCellTipState): TooltipCopy {
  const stats = `cost ${mult(def.costMult)} · time ${mult(def.timeMult)} · quality ${Math.round(def.qualityMult * 100)}%`
  const expected = `about ${formatPct(ev)} expected`
  if (!cell.unlocked) {
    return {
      title: def.label,
      description: stats,
      cost: cell.fee !== undefined && cell.fee > 0 ? { credits: cell.fee, have: cell.have } : undefined,
      meta: expected,
      tone: 'locked',
      lock: cell.blocker ?? `Quantize to ${def.label} in the Models tab first`,
    }
  }
  if (!cell.runnable) {
    return {
      title: def.label,
      description: stats,
      meta: expected,
      tone: 'locked',
      lock: cell.blocker ?? `Nothing you own can run this at ${def.label}`,
    }
  }
  return { title: def.label, description: stats, meta: expected }
}

// ---------------------------------------------------------------------------
// 13. Hashtag chip
// ---------------------------------------------------------------------------

export interface HashtagChipTipState {
  /** The tag is one of this week's three. */
  trending: boolean
  /** Kind of the post being composed (the selected model's kind). */
  postKind: ModelKind
}

/** A Studio or Trending-strip hashtag chip. A type tag on the wrong kind reads as a warning. */
export function hashtagChipTip(def: HashtagDef, { trending, postKind }: HashtagChipTipState): TooltipCopy {
  const tag = `#${def.tag}`
  if (def.kind !== undefined && def.kind !== postKind) {
    return {
      title: `${tag} · wrong kind`,
      description: `${tag} is for ${KIND_WORDS[def.kind]} posts. On ${KIND_ARTICLES[postKind]} ${KIND_WORDS[postKind]} post it gets ratioed.`,
      tone: 'locked',
      lock: 'Dislikes instead of likes, and you pay for them',
    }
  }
  if (def.kind !== undefined) {
    return {
      title: `${tag} · ${KIND_WORDS[def.kind]}`,
      description: trending
        ? `+20% on ${KIND_WORDS[def.kind]} posts, no slot used.`
        : `Tags this as ${KIND_ARTICLES[def.kind]} ${KIND_WORDS[def.kind]} post. No boost until it trends.`,
      tone: trending ? 'electric' : 'default',
    }
  }
  if (trending) {
    return {
      title: `${tag} · trending`,
      description: 'Doubles the likes on this post. A second trending tag adds +40%. A third voids the boost.',
      tone: 'electric',
    }
  }
  return {
    title: tag,
    description:
      def.keywords.length > 0
        ? `Not trending this week. Picked up from: ${def.keywords.slice(0, 4).join(', ')}.`
        : 'Not trending this week. No reach boost until it comes back around.',
  }
}

// ---------------------------------------------------------------------------
// 14. Trending countdown
// ---------------------------------------------------------------------------

/** The countdown ring on the trending strip. `weekMinutes` is `weekPeriodMs(weekSpeed) / 60000`. */
export function trendingCountdownTip(msLeft: number, weekMinutes: number): TooltipCopy {
  return {
    title: `Next week in ${formatDuration(msLeft / 1000)}`,
    description: `AI weeks are ${minutesWord(weekMinutes)}. Tags come from the real ComfyUI wire when it answers, the calendar when it does not.`,
  }
}

// ---------------------------------------------------------------------------
// 15. Nav tiles
// ---------------------------------------------------------------------------

export type NavTileId = 'map' | 'hub' | 'leaderboard' | 'seed' | 'help' | 'stats' | 'settings' | 'projector'

const NAV_TILE_COPY: Record<NavTileId, TooltipCopy> = {
  map: {
    title: 'The Graph',
    description: 'Spend credits, RP and CP on the skill tree. 132 nodes, drawn as a workflow.',
    tone: 'electric',
  },
  hub: {
    title: 'ComfyHub',
    description: "Run other players' recipes for +15% likes. Publish yours: 5% of every run is yours.",
  },
  leaderboard: {
    title: 'Leaderboard',
    description: 'Top 100 cloud saves by lifetime credits. Sign in to appear.',
    tone: 'credits',
  },
  seed: {
    title: 'Seed Roulette',
    description: 'Wager credits on a random seed. One spin every three minutes, one free a day.',
  },
  help: {
    title: 'Tutorial',
    description: 'Replay the six-step tour.',
    shortcut: '?',
  },
  stats: {
    title: 'Stats',
    description: 'Lifetime numbers and the achievement grid. Hidden ones show as ???.',
  },
  settings: {
    title: 'Settings',
    description: 'Save, export, sound, motion, hard reset.',
  },
  projector: {
    title: 'Projector mode',
    description: 'Bigger type for the back row.',
  },
}

/** Copy for one header nav tile. The objects are frozen: callers spread, never mutate. */
export function navTileTip(id: NavTileId): TooltipCopy {
  return { ...NAV_TILE_COPY[id], side: 'bottom' }
}

/** Every nav tile id in header order, for tests and for the nav itself. */
export const NAV_TILE_IDS: readonly NavTileId[] = ['map', 'hub', 'leaderboard', 'seed', 'help', 'stats', 'settings', 'projector']
