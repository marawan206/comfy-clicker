/**
 * What the header nav is made of, as data: one row per destination with its icon, label, pitch and
 * the static Tailwind classes for its colour, plus the pure rules behind the badges and the "new"
 * dots. Nothing here touches the DOM or the store, so every rule is testable in isolation
 * (`__tests__/navMeta.test.ts`); the React side lives in `navBadges.ts` and `NavTile.tsx`.
 *
 * The tint classes are written out as literal strings on purpose. Tailwind scans source files for
 * class names, so a template built at runtime would never be generated.
 */
import type { ComponentType } from 'react'
import { ChartColumn, Dices, HelpCircle, Monitor, Settings, Trophy, Waypoints, Workflow, type LucideProps } from 'lucide-react'
import type { NavTileId } from '@/components/common/tooltipCopy'
import type { Derived, GameState } from '@/game/types'

export type { NavTileId }

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

/** Destinations the player has already opened, so a "new" dot never nags twice. */
export const VISITED_KEY = 'comfy-clicker:visited'
/** Hub runs collected since the last /hub visit. */
export const HUB_UNSEEN_KEY = 'comfy-clicker:hub-unseen'
/** `achievements.length` the last time the Stats modal was opened. */
export const STATS_SEEN_KEY = 'comfy-clicker:stats-seen'
/** The last rank /leaderboard saw, so the game page can show it without fetching. */
export const RANK_CACHE_KEY = 'comfy-clicker:rank'

/** A cached rank older than an hour is a lie, so the Board tile drops the badge instead. */
export const RANK_TTL_MS = 60 * 60 * 1000

/** Badges stop counting here and read `9+`. */
export const BADGE_CAP = 9

/** Lifetime credits at which the leaderboard becomes worth a look for a guest. */
export const BOARD_PULSE_CREDITS = 10_000

/**
 * How many "new" dots may pulse at once. The rules below already wait for a destination to be
 * useful, but a player who has been away for a week can satisfy four of them on the same load, and
 * four blinking dots is decoration rather than an invitation. Two is a nudge.
 */
export const MAX_PULSES = 2

// ---------------------------------------------------------------------------
// The tiles
// ---------------------------------------------------------------------------

/** Static class names for one destination's colour. Literals, never built at runtime. */
export interface NavTint {
  /** The icon itself. */
  icon: string
  /** The 2 px underline on the active route. */
  bar: string
  /** Background wash while the route is active. */
  activeBg: string
  /** Border on hover. */
  hoverBorder: string
  /** Badge pill: background plus the dark text that sits on it. */
  badge: string
  /** The "new" dot. */
  dot: string
}

export interface NavTileMeta {
  id: NavTileId
  /** Route tiles navigate; the rest dispatch `comfy:open-modal` or flip a setting. */
  href: string | null
  /** Uppercase label, shown from xl up on route tiles. */
  label: string
  /**
   * One dry line explaining the destination, used for the tour and the icon-only aria-label.
   * Kept short: this is the thing a new player reads to decide whether to click.
   */
  pitch: string
  tint: NavTint
  icon: ComponentType<LucideProps>
  /** Route tiles keep their label at xl; utility tiles are icon-only from xl down. */
  labelled: boolean
}

const ELECTRIC: NavTint = {
  icon: 'text-electric-400',
  bar: 'bg-electric-400',
  activeBg: 'bg-electric-400/15',
  hoverBorder: 'hover:border-electric-400/60',
  badge: 'bg-electric-400 text-charcoal-800',
  dot: 'bg-electric-400',
}

const PERIWINKLE: NavTint = {
  icon: 'text-[#7f8dff]',
  bar: 'bg-[#7f8dff]',
  activeBg: 'bg-[#7f8dff]/15',
  hoverBorder: 'hover:border-[#7f8dff]/60',
  badge: 'bg-[#7f8dff] text-charcoal-800',
  dot: 'bg-[#7f8dff]',
}

const AMBER: NavTint = {
  icon: 'text-credits',
  bar: 'bg-credits',
  activeBg: 'bg-credits/15',
  hoverBorder: 'hover:border-credits/60',
  badge: 'bg-credits text-charcoal-800',
  dot: 'bg-credits',
}

const LATENT: NavTint = {
  icon: 'text-slot-latent',
  bar: 'bg-slot-latent',
  activeBg: 'bg-slot-latent/15',
  hoverBorder: 'hover:border-slot-latent/60',
  badge: 'bg-slot-latent text-charcoal-800',
  dot: 'bg-slot-latent',
}

const SMOKE: NavTint = {
  icon: 'text-smoke-600',
  bar: 'bg-smoke-600',
  activeBg: 'bg-smoke-600/15',
  hoverBorder: 'hover:border-smoke-600/60',
  badge: 'bg-smoke-600 text-charcoal-800',
  dot: 'bg-smoke-600',
}

const IMAGE: NavTint = {
  icon: 'text-slot-image',
  bar: 'bg-slot-image',
  activeBg: 'bg-slot-image/15',
  hoverBorder: 'hover:border-slot-image/60',
  badge: 'bg-slot-image text-charcoal-800',
  dot: 'bg-slot-image',
}

const COND: NavTint = {
  icon: 'text-slot-cond',
  bar: 'bg-slot-cond',
  activeBg: 'bg-slot-cond/15',
  hoverBorder: 'hover:border-slot-cond/60',
  badge: 'bg-slot-cond text-charcoal-800',
  dot: 'bg-slot-cond',
}

/** Every tile in header order. The divider sits between `seed` and `help`. */
export const NAV_TILES: readonly NavTileMeta[] = [
  { id: 'map', href: '/map', label: 'Map', pitch: 'The Graph: 132 nodes to spend on', tint: ELECTRIC, icon: Waypoints, labelled: true },
  { id: 'hub', href: '/hub', label: 'Hub', pitch: "ComfyHub: run other players' workflows", tint: PERIWINKLE, icon: Workflow, labelled: true },
  { id: 'leaderboard', href: '/leaderboard', label: 'Board', pitch: 'Leaderboard: top 100 by lifetime credits', tint: AMBER, icon: Trophy, labelled: true },
  { id: 'seed', href: null, label: 'Seed', pitch: 'Seed Roulette: wager credits on a spin', tint: LATENT, icon: Dices, labelled: true },
  { id: 'help', href: null, label: 'Help', pitch: 'Replay the tutorial', tint: SMOKE, icon: HelpCircle, labelled: false },
  { id: 'stats', href: null, label: 'Stats', pitch: 'Lifetime numbers and achievements', tint: IMAGE, icon: ChartColumn, labelled: false },
  { id: 'settings', href: null, label: 'Settings', pitch: 'Save, export, sound, motion', tint: COND, icon: Settings, labelled: false },
  { id: 'projector', href: null, label: 'Projector', pitch: 'Bigger type for the back row', tint: SMOKE, icon: Monitor, labelled: false },
]

/** The tiles above the divider (destinations), in order. */
export const ROUTE_TILE_IDS: readonly NavTileId[] = ['map', 'hub', 'leaderboard', 'seed']
/** The tiles below the divider (utilities), in order. */
export const UTILITY_TILE_IDS: readonly NavTileId[] = ['help', 'stats', 'settings', 'projector']

export function navTile(id: NavTileId): NavTileMeta {
  const found = NAV_TILES.find((t) => t.id === id)
  if (!found) throw new Error(`Unknown nav tile: ${id}`)
  return found
}

/** Which route a pathname counts as, so `/map/anything` still lights the Map tile. */
export function activeTileId(pathname: string | null | undefined): NavTileId | null {
  if (!pathname) return null
  for (const tile of NAV_TILES) {
    if (!tile.href) continue
    if (pathname === tile.href || pathname.startsWith(`${tile.href}/`)) return tile.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/** `null` below 1, the number up to the cap, `9+` above it. */
export function formatBadge(count: number): string | null {
  if (!Number.isFinite(count)) return null
  const n = Math.floor(count)
  if (n <= 0) return null
  return n > BADGE_CAP ? `${BADGE_CAP}+` : String(n)
}

// ---------------------------------------------------------------------------
// The visited set
// ---------------------------------------------------------------------------

/** Parse `localStorage['comfy-clicker:visited']`. Anything unreadable is treated as "nothing seen". */
export function readVisited(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

/** Serialise the visited set back to storage, sorted so the value is stable across writes. */
export function writeVisited(visited: Iterable<string>): string {
  return JSON.stringify([...new Set(visited)].sort())
}

/** The set with `id` added. Returns the original when nothing changed, so callers can skip the write. */
export function addVisited(visited: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (visited.has(id)) return visited
  const next = new Set(visited)
  next.add(id)
  return next
}

// ---------------------------------------------------------------------------
// The rank cache
// ---------------------------------------------------------------------------

interface RankCache {
  rank: number
  at: number
}

export function writeRankCache(rank: number, at: number): string {
  return JSON.stringify({ rank: Math.floor(rank), at } satisfies RankCache)
}

/**
 * The cached entry with the timestamp it was written at, or null when it is missing, malformed or
 * older than the TTL. Keeping `at` matters: a rank read back at boot must keep its original age,
 * not get a fresh hour every time the page loads.
 */
export function parseRankEntry(raw: string | null | undefined, now: number, ttlMs: number = RANK_TTL_MS): { rank: number; at: number } | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { rank, at } = parsed as Partial<RankCache>
    if (typeof rank !== 'number' || typeof at !== 'number') return null
    if (!Number.isFinite(rank) || rank < 1) return null
    if (!Number.isFinite(at) || now - at > ttlMs || now < at - ttlMs) return null
    return { rank: Math.floor(rank), at }
  } catch {
    return null
  }
}

/** The cached rank, or null when it is missing, malformed or older than the TTL. */
export function parseRankCache(raw: string | null | undefined, now: number, ttlMs: number = RANK_TTL_MS): number | null {
  return parseRankEntry(raw, now, ttlMs)?.rank ?? null
}

// ---------------------------------------------------------------------------
// "New" dots
// ---------------------------------------------------------------------------

/** Everything the pulse rules read. Kept flat so a test can build one by hand. */
export interface PulseInput {
  state: GameState
  derived: Derived
  /** Destinations already opened (`readVisited`). */
  visited: ReadonlySet<string>
  signedIn: boolean
  /** Graph nodes that are available and affordable right now (the Map badge count). */
  affordable: number
}

/**
 * Whether a tile should pulse a "new" dot. A destination has to be both unvisited *and* worth the
 * detour: a player thirty seconds into their first run must not face five blinking dots, so Map
 * waits for a node they can actually buy, Hub and Stats wait for the first post, Board waits for a
 * reason to care, and Settings never pulses at all.
 */
export function shouldPulse(id: NavTileId, input: PulseInput): boolean {
  const { state, visited, signedIn, affordable } = input
  if (visited.has(id)) return false
  switch (id) {
    case 'map':
      return affordable > 0
    case 'hub':
    case 'stats':
      return state.stats.posts > 0
    case 'leaderboard':
      return signedIn || state.lifetimeCredits >= BOARD_PULSE_CREDITS
    case 'seed':
    case 'help':
    case 'settings':
    case 'projector':
      return false
  }
}

/**
 * Every tile that should pulse, in header order, capped at `MAX_PULSES`. This is what the header
 * calls: `shouldPulse` answers per tile, this decides how many of those answers get a dot.
 */
export function pulseTiles(input: PulseInput, max: number = MAX_PULSES): Set<NavTileId> {
  const out = new Set<NavTileId>()
  for (const tile of NAV_TILES) {
    if (out.size >= max) break
    if (shouldPulse(tile.id, input)) out.add(tile.id)
  }
  return out
}
