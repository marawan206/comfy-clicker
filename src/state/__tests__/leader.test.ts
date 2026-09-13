/**
 * Cross-tab coordination and the welcome-back gate, both of which live in `GameStore`.
 *
 * Two tabs share one localStorage, so without a writer lock the last one to autosave wins
 * unconditionally: a hidden tab that wakes up stamps its stale state over an hour of play in the
 * tab that was actually being used. The tests below run two stores against one stubbed storage,
 * which is exactly the shape of that bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG } from '@/data'
import { SAVE_KEY, SHORT_GAP_S } from '@/game/constants'
import { GameStore, LEADER_KEY, LEADER_STALE_MS } from '@/state/store'

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)

type Handler = (event?: unknown) => void
/** One tab's event listeners; a real `storage` event never reaches the tab that wrote the key. */
interface Tab {
  store: GameStore
  listeners: [string, Handler][]
}

let storage: Map<string, string>
let clock = T0
let saveWrites = 0
let listening: [string, Handler][] = []

function stubWindow(): void {
  storage = new Map()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === SAVE_KEY) saveWrites += 1
        storage.set(k, v)
      },
      removeItem: (k: string) => {
        storage.delete(k)
      },
    },
    addEventListener: (type: string, fn: Handler) => listening.push([type, fn]),
    removeEventListener: () => {},
  }
}

/** Open a tab: a fresh store whose listeners are captured separately from the other tab's. */
function openTab(): Tab {
  listening = []
  const store = new GameStore(CATALOG)
  store.start()
  return { store, listeners: listening }
}

function fire(tab: Tab, type: string, event?: unknown): void {
  for (const [t, fn] of tab.listeners) if (t === type) fn(event)
}

function step(tab: Tab, at: number): void {
  clock = at
  ;(tab.store as unknown as { tick(dt: number, now: number): void }).tick(0.05, at)
}

beforeEach(() => {
  clock = T0
  saveWrites = 0
  listening = []
  stubWindow()
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { window?: unknown }).window
})

describe('writer lock', () => {
  it('the first tab leads and the second follows', () => {
    const a = openTab()
    const b = openTab()
    expect(a.store.leader).toBe(true)
    expect(b.store.leader).toBe(false)
  })

  it('a follower never writes the shared save, and the leader still does', () => {
    const a = openTab()
    const b = openTab()
    saveWrites = 0

    clock = T0 + 1_000
    b.store.save('interval')
    b.store.save('action')
    b.store.save('hide')
    expect(saveWrites).toBe(0)

    a.store.save('interval')
    expect(saveWrites).toBe(1)
  })

  it('a follower does not overwrite the leader with its own stale run', () => {
    const a = openTab()
    const b = openTab()

    // The leader plays: ten thousand credits of progress reach the shared blob.
    clock = T0 + 5_000
    a.store.state.credits = 10_000
    a.store.save('interval')
    const written = storage.get(SAVE_KEY)

    // The follower wakes up on a much older state and autosaves exactly as it used to.
    clock = T0 + 6_000
    b.store.state.credits = 3
    b.store.save('hide')
    expect(storage.get(SAVE_KEY)).toBe(written)
  })

  it('a follower adopts the leader newer blob instead of drifting', () => {
    const a = openTab()
    const b = openTab()

    clock = T0 + 5_000
    a.store.state.credits = 12_345
    a.store.save('interval')

    fire(b, 'storage', { key: SAVE_KEY, newValue: storage.get(SAVE_KEY) ?? null })
    expect(b.store.state.credits).toBe(12_345)
    expect(b.store.savedAt).toBe(T0 + 5_000)
  })

  it('ignores a storage event in the tab that is doing the writing', () => {
    const a = openTab()
    clock = T0 + 5_000
    a.store.state.credits = 999
    a.store.save('interval')
    const blob = storage.get(SAVE_KEY) ?? null

    a.store.state.credits = 1_000_000
    fire(a, 'storage', { key: SAVE_KEY, newValue: blob })
    expect(a.store.state.credits).toBe(1_000_000)
  })

  it('hands the lock back on pagehide so the next tab takes over at once', () => {
    const a = openTab()
    const b = openTab()

    clock = T0 + 1_000
    fire(a, 'pagehide')
    expect(storage.get(LEADER_KEY)).toBeUndefined()

    step(b, T0 + 2_000)
    expect(b.store.leader).toBe(true)
    saveWrites = 0
    b.store.save('interval')
    expect(saveWrites).toBe(1)
  })

  it('takes over a lock whose tab stopped restamping, and demotes that tab on its next write', () => {
    const a = openTab()
    const b = openTab()

    // Tab A is hidden: rAF is throttled, so its tick (and its heartbeat) stops.
    step(b, T0 + LEADER_STALE_MS + 1_000)
    expect(b.store.leader).toBe(true)

    saveWrites = 0
    a.store.save('interval')
    expect(a.store.leader).toBe(false)
    expect(saveWrites).toBe(0)
  })

  it('an explicit save takes the lock: the player asked this tab to write', () => {
    const a = openTab()
    const b = openTab()
    expect(b.store.leader).toBe(false)

    saveWrites = 0
    clock = T0 + 1_000
    b.store.save('manual')
    expect(b.store.leader).toBe(true)
    expect(saveWrites).toBe(1)

    a.store.save('interval')
    expect(a.store.leader).toBe(false)
    expect(saveWrites).toBe(1)
  })

  it('announces every change of hands', () => {
    const a = openTab()
    const b = openTab()
    const seen: boolean[] = []
    b.store.onLeaderChange((leader) => seen.push(leader))

    fire(a, 'pagehide')
    step(b, T0 + 2_000)
    expect(seen).toEqual([true])
  })

  it('keeps the owner stamp next to the save and drops it when the run is replaced', () => {
    const a = openTab()
    a.store.setSaveOwner('user-a')
    expect(a.store.saveOwner).toBe('user-a')

    a.store.hardReset()
    expect(a.store.saveOwner).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The welcome-back gate
// ---------------------------------------------------------------------------
/** Write a save that stopped ticking `gapSec` ago, with enough hardware for a non-zero cps. */
function seedSave(gapSec: number): number {
  const seed = new GameStore(CATALOG)
  seed.state.credits = 1e9
  expect(seed.buyHardware('pc-4c8t', 10).error).toBeUndefined()
  expect(seed.derived.cps).toBeGreaterThan(0)
  seed.state.meta.lastTickAt = clock - gapSec * 1000
  seed.save('manual')
  seed.stop()
  saveWrites = 0
  return seed.state.credits
}

describe('offline report', () => {
  it('a tab switch inside the short-gap window shows no card', () => {
    const before = seedSave(90)
    const tab = openTab()
    // The gap was paid at the full rate with no cap, so there is nothing to report.
    expect(tab.store.offlineReport).toBeNull()
    expect(tab.store.state.credits).toBeGreaterThan(before)
  })

  it('still shows the card for a real absence', () => {
    seedSave(SHORT_GAP_S + 3600)
    const tab = openTab()
    expect(tab.store.offlineReport).not.toBeNull()
    expect(tab.store.offlineReport!.elapsedSec).toBeCloseTo(SHORT_GAP_S + 3600, 3)
    expect(tab.store.offlineReport!.gain).toBeGreaterThan(0)
  })
})
