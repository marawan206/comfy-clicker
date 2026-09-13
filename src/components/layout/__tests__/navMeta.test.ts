/**
 * The header nav's rules, pinned. Everything under test is pure: the visited set, the badge cap,
 * the rank cache and its TTL, and the "new" dot policy, which exists so a player thirty seconds
 * into their first run is not looking at five blinking dots.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG } from '@/data'
import { computeDerived } from '@/game/derived'
import { createInitialState } from '@/game/state'
import type { GameState } from '@/game/types'
import {
  BADGE_CAP,
  BOARD_PULSE_CREDITS,
  NAV_TILES,
  RANK_TTL_MS,
  ROUTE_TILE_IDS,
  UTILITY_TILE_IDS,
  activeTileId,
  addVisited,
  formatBadge,
  navTile,
  MAX_PULSES,
  parseRankCache,
  parseRankEntry,
  pulseTiles,
  readVisited,
  shouldPulse,
  writeRankCache,
  writeVisited,
  type NavTileId,
  type PulseInput,
} from '../navMeta'

/** Built from the code point so this file can assert on the character the house style bans. */
const EM_DASH = String.fromCharCode(0x2014)

const NOW = Date.parse('2026-03-14T12:00:00Z')

function fresh(): GameState {
  return createInitialState(NOW, 'test-guest')
}

function input(state: GameState, over: Partial<PulseInput> = {}): PulseInput {
  return {
    state,
    derived: computeDerived(state, CATALOG),
    visited: new Set<string>(),
    signedIn: false,
    affordable: 0,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

describe('NAV_TILES', () => {
  it('is the eight tiles in header order, routes first', () => {
    expect(NAV_TILES.map((t) => t.id)).toEqual([...ROUTE_TILE_IDS, ...UTILITY_TILE_IDS])
    expect(new Set(NAV_TILES.map((t) => t.id)).size).toBe(NAV_TILES.length)
  })

  it('gives every route tile an href and every utility tile none', () => {
    for (const id of ROUTE_TILE_IDS) {
      const tile = navTile(id)
      if (id === 'seed') expect(tile.href).toBeNull()
      else expect(tile.href).toMatch(/^\//)
    }
    for (const id of UTILITY_TILE_IDS) expect(navTile(id).href).toBeNull()
  })

  it('writes no em-dash into any pitch, and keeps every pitch short', () => {
    for (const tile of NAV_TILES) {
      expect(tile.pitch).not.toContain(EM_DASH)
      expect(tile.pitch.length).toBeGreaterThan(8)
      expect(tile.pitch.length).toBeLessThanOrEqual(60)
      expect(tile.label).not.toContain(EM_DASH)
    }
  })

  it('matches a pathname to its tile, including nested routes', () => {
    expect(activeTileId('/map')).toBe('map')
    expect(activeTileId('/map/prestige')).toBe('map')
    expect(activeTileId('/hub')).toBe('hub')
    expect(activeTileId('/leaderboard')).toBe('leaderboard')
    expect(activeTileId('/')).toBeNull()
    expect(activeTileId(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The visited set
// ---------------------------------------------------------------------------

describe('the visited set', () => {
  it('round-trips through storage', () => {
    const visited = new Set(['map', 'hub'])
    const raw = writeVisited(visited)
    expect(readVisited(raw)).toEqual(visited)
  })

  it('is stable across writes so storage does not churn', () => {
    expect(writeVisited(['hub', 'map'])).toBe(writeVisited(['map', 'hub', 'map']))
  })

  it('treats missing and broken values as nothing seen', () => {
    expect(readVisited(null).size).toBe(0)
    expect(readVisited('').size).toBe(0)
    expect(readVisited('not json').size).toBe(0)
    expect(readVisited('{"map":true}').size).toBe(0)
    expect(readVisited('[1, 2, "map"]')).toEqual(new Set(['map']))
  })

  it('returns the same set when nothing changed, so the caller can skip the write', () => {
    const visited: ReadonlySet<string> = new Set(['map'])
    expect(addVisited(visited, 'map')).toBe(visited)
    expect(addVisited(visited, 'hub')).toEqual(new Set(['map', 'hub']))
  })
})

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

describe('formatBadge', () => {
  it('says nothing at zero', () => {
    expect(formatBadge(0)).toBeNull()
    expect(formatBadge(-3)).toBeNull()
    expect(formatBadge(Number.NaN)).toBeNull()
  })

  it('counts up to the cap and then reads 9+', () => {
    expect(formatBadge(1)).toBe('1')
    expect(formatBadge(BADGE_CAP)).toBe('9')
    expect(formatBadge(BADGE_CAP + 1)).toBe('9+')
    expect(formatBadge(132)).toBe('9+')
  })
})

// ---------------------------------------------------------------------------
// The rank cache
// ---------------------------------------------------------------------------

describe('the rank cache', () => {
  it('round-trips a rank written by /leaderboard', () => {
    expect(parseRankCache(writeRankCache(12, NOW), NOW)).toBe(12)
    expect(parseRankCache(writeRankCache(12, NOW), NOW + RANK_TTL_MS - 1)).toBe(12)
  })

  it('drops a rank older than the TTL rather than showing a stale one', () => {
    expect(parseRankCache(writeRankCache(12, NOW), NOW + RANK_TTL_MS + 1)).toBeNull()
  })

  it('keeps the write timestamp so a reload does not grant a fresh hour', () => {
    const entry = parseRankEntry(writeRankCache(12, NOW), NOW + 59 * 60 * 1000)
    expect(entry).toEqual({ rank: 12, at: NOW })
  })

  it('drops a clock that ran backwards and anything malformed', () => {
    expect(parseRankCache(writeRankCache(12, NOW), NOW - RANK_TTL_MS - 1)).toBeNull()
    expect(parseRankCache(null, NOW)).toBeNull()
    expect(parseRankCache('nonsense', NOW)).toBeNull()
    expect(parseRankCache('{"rank":"12","at":0}', NOW)).toBeNull()
    expect(parseRankCache(JSON.stringify({ rank: 0, at: NOW }), NOW)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The "new" dots
// ---------------------------------------------------------------------------

describe('shouldPulse', () => {
  it('leaves a brand new player with no dots at all', () => {
    const state = fresh()
    const pulses = NAV_TILES.filter((t) => shouldPulse(t.id, input(state)))
    expect(pulses).toEqual([])
  })

  it('lights Map only once a Graph node is actually affordable', () => {
    const state = fresh()
    expect(shouldPulse('map', input(state, { affordable: 0 }))).toBe(false)
    expect(shouldPulse('map', input(state, { affordable: 1 }))).toBe(true)
  })

  it('lights Hub and Stats after the first post', () => {
    const state = fresh()
    expect(shouldPulse('hub', input(state))).toBe(false)
    expect(shouldPulse('stats', input(state))).toBe(false)
    state.stats.posts = 1
    expect(shouldPulse('hub', input(state))).toBe(true)
    expect(shouldPulse('stats', input(state))).toBe(true)
  })

  it('lights Board when signed in, or once the lifetime total is worth showing', () => {
    const state = fresh()
    expect(shouldPulse('leaderboard', input(state))).toBe(false)
    expect(shouldPulse('leaderboard', input(state, { signedIn: true }))).toBe(true)
    state.lifetimeCredits = BOARD_PULSE_CREDITS
    expect(shouldPulse('leaderboard', input(state))).toBe(true)
  })

  it('never lights Settings, Projector, Help or Seed', () => {
    const state = fresh()
    state.stats.posts = 50
    state.lifetimeCredits = 1e9
    const rich = input(state, { signedIn: true, affordable: 40 })
    for (const id of ['settings', 'projector', 'help', 'seed'] as NavTileId[]) {
      expect(shouldPulse(id, rich)).toBe(false)
    }
  })

  it('caps the dots so the header nudges instead of blinking', () => {
    const state = fresh()
    state.stats.posts = 12
    state.lifetimeCredits = 5e5
    const loaded = input(state, { signedIn: true, affordable: 7 })
    const wanted = NAV_TILES.filter((t) => shouldPulse(t.id, loaded))
    expect(wanted.length).toBeGreaterThan(MAX_PULSES)
    const shown = pulseTiles(loaded)
    expect(shown.size).toBe(MAX_PULSES)
    // The cap keeps header order, so Map is always the first thing offered.
    expect([...shown][0]).toBe('map')
  })

  it('goes quiet for good once the destination has been opened', () => {
    const state = fresh()
    state.stats.posts = 3
    const visited = new Set(['hub', 'map', 'stats'])
    expect(shouldPulse('hub', input(state, { visited, affordable: 9 }))).toBe(false)
    expect(shouldPulse('map', input(state, { visited, affordable: 9 }))).toBe(false)
    expect(shouldPulse('stats', input(state, { visited }))).toBe(false)
  })
})
