'use client'
/**
 * The live numbers behind the header nav badges, and the "visited" bookkeeping the new-dots read.
 *
 * Two rules shape everything here. First, the loop bumps the store about twenty times a second, so
 * nothing in this file selects a value that changes every tick: the Map count walks all 132 Graph
 * nodes behind a two second clock and reads `store.state` directly rather than through a selector,
 * and every other badge selects a count that only moves when something actually happens. Second,
 * everything that lives in `localStorage` is a tiny external store read through `useSyncExternalStore`,
 * booted on the first subscribe and with a server snapshot of "nothing yet", so the server render
 * and the first client render agree and a badge clears everywhere at once.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAffordableNodeCount } from '@/components/map/mapHooks'
import { TUTORIAL_FLAG } from '@/game/actions'
import { LOUNGE_MIN_LEVEL } from '@/game/constants'
import { dayKey } from '@/game/daily'
import { playerLevel } from '@/game/level'
import { useNow } from '@/hooks/useNow'
import { GAME_VERSION } from '@/data/patchNotes'
import { hasUnseenNotes, readVersionSeen, writeVersionSeen } from '@/lib/version'
import { getGameStore } from '@/state/store'
import { useGame } from '@/state/useGame'
import {
  HUB_UNSEEN_KEY,
  RANK_CACHE_KEY,
  RANK_TTL_MS,
  STATS_SEEN_KEY,
  VISITED_KEY,
  addVisited,
  parseRankEntry,
  readVisited,
  writeRankCache,
  writeVisited,
  type NavTileId,
} from './navMeta'

/**
 * `HUB_ROYALTIES_EVENT` from `@/components/hub/useHub`, spelled out rather than imported: the
 * header ships on every route and that module drags the Supabase client and the hub API with it.
 */
const HUB_ROYALTIES_EVENT = 'comfy:hub-royalties'
/** `OPEN_MODAL_EVENT` from `@/components/overlays/ModalBase`, same reason. */
const OPEN_MODAL_EVENT = 'comfy:open-modal'

const DAY_MS = 86_400_000

/**
 * Milliseconds left in the current UTC day. Lives here because `src/game/daily.ts` does not export
 * it; move the call over if it ever grows a `msUntilDayEnd` of its own.
 */
export function msUntilDayEnd(now: number): number {
  if (!Number.isFinite(now)) return DAY_MS
  const d = new Date(now)
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  return Math.max(0, end - now)
}

// ---------------------------------------------------------------------------
// Storage helpers (every one of them survives a private window that throws)
// ---------------------------------------------------------------------------

function readKey(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode or a full quota: the badge is cosmetic, so lose it quietly */
  }
}

function readInt(key: string): number | null {
  const raw = readKey(key)
  if (raw === null) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// The visited set, as a tiny external store so every tile agrees instantly
// ---------------------------------------------------------------------------

const EMPTY: ReadonlySet<string> = new Set()
let visited: ReadonlySet<string> = EMPTY
let visitedBooted = false
const visitedListeners = new Set<() => void>()

function emitVisited(): void {
  for (const l of visitedListeners) l()
}

function bootVisited(): void {
  if (visitedBooted || typeof window === 'undefined') return
  visitedBooted = true
  const loaded = readVisited(readKey(VISITED_KEY))
  if (loaded.size > 0) {
    visited = loaded
    emitVisited()
  }
}

/** Record that a destination has been opened. Idempotent, and it clears that tile's own backlog. */
export function markVisited(id: NavTileId): void {
  bootVisited()
  const next = addVisited(visited, id)
  if (next !== visited) {
    visited = next
    writeKey(VISITED_KEY, writeVisited(next))
    emitVisited()
  }
  if (id === 'hub') clearHubUnseen()
}

function subscribeVisited(listener: () => void): () => void {
  bootVisited()
  visitedListeners.add(listener)
  return () => visitedListeners.delete(listener)
}

/** Destinations the player has already opened. Empty on the server and on the first client render. */
export function useVisited(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeVisited,
    () => visited,
    () => EMPTY,
  )
}

// ---------------------------------------------------------------------------
// Hub: runs of your workflows since the last /hub visit
// ---------------------------------------------------------------------------

let hubUnseen = 0
let hubBooted = false
const hubListeners = new Set<() => void>()

function emitHub(): void {
  for (const l of hubListeners) l()
}

function bootHub(): void {
  if (hubBooted || typeof window === 'undefined') return
  hubBooted = true
  hubUnseen = Math.max(0, readInt(HUB_UNSEEN_KEY) ?? 0)
  window.addEventListener(HUB_ROYALTIES_EVENT, onRoyalties as EventListener)
  if (hubUnseen > 0) emitHub()
}

function onRoyalties(event: Event): void {
  const detail = (event as CustomEvent<{ runs?: number }>).detail
  const runs = typeof detail?.runs === 'number' && detail.runs > 0 ? Math.floor(detail.runs) : 0
  if (runs === 0) return
  hubUnseen += runs
  writeKey(HUB_UNSEEN_KEY, String(hubUnseen))
  emitHub()
}

function clearHubUnseen(): void {
  bootHub()
  if (hubUnseen === 0) return
  hubUnseen = 0
  writeKey(HUB_UNSEEN_KEY, '0')
  emitHub()
}

function subscribeHub(listener: () => void): () => void {
  bootHub()
  hubListeners.add(listener)
  return () => hubListeners.delete(listener)
}

/** Runs of the player's published workflows collected since they last opened /hub. */
export function useHubUnseen(): number {
  return useSyncExternalStore(
    subscribeHub,
    () => hubUnseen,
    () => 0,
  )
}

// ---------------------------------------------------------------------------
// Map: Graph nodes affordable right now
// ---------------------------------------------------------------------------

/**
 * How many Graph nodes the player could unlock this second. Walking 132 nodes twenty times a second
 * would be the most expensive thing in the header, so the map module's hook reads the store outside
 * React on a two second clock instead of subscribing to it.
 */
export function useAffordableNodes(): number {
  return useAffordableNodeCount(2000)
}

// ---------------------------------------------------------------------------
// Board: the rank /leaderboard last saw
// ---------------------------------------------------------------------------

interface RankSnapshot {
  rank: number
  at: number
}

let rankSnapshot: RankSnapshot | null = null
let rankBooted = false
const rankListeners = new Set<() => void>()

function bootRank(): void {
  if (rankBooted || typeof window === 'undefined') return
  rankBooted = true
  // Keeps the original timestamp, so an hour-old rank expires an hour after it was fetched.
  const cached = parseRankEntry(readKey(RANK_CACHE_KEY), Date.now())
  if (cached !== null) {
    rankSnapshot = cached
    for (const l of rankListeners) l()
  }
}

function subscribeRank(listener: () => void): () => void {
  bootRank()
  rankListeners.add(listener)
  return () => rankListeners.delete(listener)
}

/**
 * The player's rank from the cache /leaderboard writes. The game page never fetches the board: a
 * badge is not worth a request every time somebody loads the studio, and an hour-stale rank is
 * dropped rather than shown.
 */
export function useBoardRank(): number | null {
  const snapshot = useSyncExternalStore(
    subscribeRank,
    () => rankSnapshot,
    () => null,
  )
  const minute = useNow(60_000)
  if (snapshot === null) return null
  return minute - snapshot.at <= RANK_TTL_MS ? snapshot.rank : null
}

/** Store a freshly fetched rank for the header to read. Called by /leaderboard. */
export function cacheRank(rank: number | null): void {
  if (rank === null || !Number.isFinite(rank) || rank < 1) return
  bootRank()
  const at = Date.now()
  writeKey(RANK_CACHE_KEY, writeRankCache(rank, at))
  rankSnapshot = { rank: Math.floor(rank), at }
  for (const l of rankListeners) l()
}

// ---------------------------------------------------------------------------
// Stats: achievements earned since the modal was last opened
// ---------------------------------------------------------------------------

let statsSeen: number | null = null
let statsBooted = false
const statsListeners = new Set<() => void>()

/** Read the count outside React, for the boot and the modal listener. */
function earnedNow(): number {
  return getGameStore().state.achievements.length
}

function setStatsSeen(value: number): void {
  if (statsSeen === value) return
  statsSeen = value
  writeKey(STATS_SEEN_KEY, String(value))
  for (const l of statsListeners) l()
}

function bootStats(): void {
  if (statsBooted || typeof window === 'undefined') return
  statsBooted = true
  const stored = readInt(STATS_SEEN_KEY)
  // No watermark yet means this browser has never opened Stats. Seed it at the current count so a
  // save carried over from another device does not greet the player with a badge of forty.
  statsSeen = stored ?? earnedNow()
  if (stored === null) writeKey(STATS_SEEN_KEY, String(statsSeen))
  window.addEventListener(OPEN_MODAL_EVENT, onModalOpen as EventListener)
}

function onModalOpen(event: Event): void {
  if ((event as CustomEvent<unknown>).detail !== 'stats') return
  setStatsSeen(earnedNow())
}

function subscribeStats(listener: () => void): () => void {
  bootStats()
  statsListeners.add(listener)
  return () => statsListeners.delete(listener)
}

/**
 * Achievements granted since the Stats modal was last opened. The watermark lives outside React so
 * the badge clears the moment the modal opens, on whichever route the header happens to be on.
 */
export function useStatsUnseen(): number {
  const earned = useGame((s) => s.achievements.length)
  const seen = useSyncExternalStore(
    subscribeStats,
    () => statsSeen,
    () => null,
  )
  if (seen === null) return 0
  return Math.max(0, earned - seen)
}

// ---------------------------------------------------------------------------
// Lounge: the free spin
// ---------------------------------------------------------------------------

/** Whether the Latent Lounge tile should be in the header at all. */
export function useLoungeUnlocked(): boolean {
  return useGame((s) => playerLevel(s) >= LOUNGE_MIN_LEVEL)
}

/** Whether today's free spin is still there. A UTC day, so a 30 s clock is plenty. */
export function useFreeSpinReady(): boolean {
  const now = useNow(30_000)
  const day = useGame((s) => s.gamble.freeSpinDay)
  return day !== dayKey(now)
}

// ---------------------------------------------------------------------------
// Settings: the patch-notes dot
// ---------------------------------------------------------------------------

let versionSeen: string | null = null
let versionBooted = false
const versionListeners = new Set<() => void>()

function setVersionSeen(value: string): void {
  if (versionSeen === value) return
  versionSeen = value
  writeVersionSeen(value)
  for (const l of versionListeners) l()
}

function bootVersion(): void {
  if (versionBooted || typeof window === 'undefined') return
  versionBooted = true
  const stored = readVersionSeen()
  // No watermark means this browser is new, or was here before the notes existed. Either way a dot
  // about a version they never played is noise, so stamp the current one and stay quiet.
  versionSeen = stored ?? GAME_VERSION
  if (stored === null) writeVersionSeen(versionSeen)
  window.addEventListener(OPEN_MODAL_EVENT, onPatchModalOpen as EventListener)
}

function onPatchModalOpen(event: Event): void {
  if ((event as CustomEvent<unknown>).detail !== 'patch') return
  setVersionSeen(GAME_VERSION)
}

function subscribeVersion(listener: () => void): () => void {
  bootVersion()
  versionListeners.add(listener)
  return () => versionListeners.delete(listener)
}

/**
 * Whether the game has updated since this browser last opened the patch notes. The watermark lives
 * outside React and outside the save: a cloud save arriving on a new device should still show the
 * notes, and opening them clears the dot on whichever route the header happens to be on.
 */
export function useUnseenPatchNotes(): boolean {
  const seen = useSyncExternalStore(
    subscribeVersion,
    () => versionSeen,
    () => null,
  )
  return hasUnseenNotes(seen)
}

// ---------------------------------------------------------------------------
// Help: the tutorial dot
// ---------------------------------------------------------------------------

/** The `?` tile keeps a dot until the tour has been run or skipped. */
export function useTourPending(): boolean {
  return useGame((s) => !s.flags[TUTORIAL_FLAG])
}

// ---------------------------------------------------------------------------
// Route pages: mark a destination visited
// ---------------------------------------------------------------------------

/**
 * Mark a destination as visited for as long as this page is mounted, so its "new" dot stops
 * pulsing and its backlog clears. /leaderboard also passes the rank it just fetched, which is the
 * only place that number is ever produced.
 */
export function useMarkVisited(id: NavTileId, rank?: number | null): void {
  useEffect(() => {
    markVisited(id)
  }, [id])
  useEffect(() => {
    if (rank !== undefined) cacheRank(rank)
  }, [rank])
}

// ---------------------------------------------------------------------------
// Everything the header needs, in one call
// ---------------------------------------------------------------------------

export interface NavBadges {
  visited: ReadonlySet<string>
  affordable: number
  hubUnseen: number
  rank: number | null
  statsUnseen: number
  loungeUnlocked: boolean
  /** The game updated since the player last opened the patch notes. */
  patchNotes: boolean
  freeSpin: boolean
  tourPending: boolean
}

export function useNavBadges(): NavBadges {
  const visitedSet = useVisited()
  const affordable = useAffordableNodes()
  const hub = useHubUnseen()
  const rank = useBoardRank()
  const statsUnseen = useStatsUnseen()
  const loungeUnlocked = useLoungeUnlocked()
  const patchNotes = useUnseenPatchNotes()
  const freeSpin = useFreeSpinReady()
  const tourPending = useTourPending()
  return useMemo(
    () => ({ visited: visitedSet, affordable, hubUnseen: hub, rank, statsUnseen, loungeUnlocked, patchNotes, freeSpin, tourPending }),
    [visitedSet, affordable, hub, rank, statsUnseen, loungeUnlocked, patchNotes, freeSpin, tourPending],
  )
}

/** A stable `markVisited` for click handlers on the tiles themselves. */
export function useMarkVisitedCallback(): (id: NavTileId) => void {
  return useCallback((id: NavTileId) => markVisited(id), [])
}
