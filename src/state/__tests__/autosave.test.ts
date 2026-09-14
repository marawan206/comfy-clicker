/**
 * The save cadence: the pure `autosaveDue` decision and the `GameStore` behaviour built on it.
 *
 * The store is driven through its private `tick` rather than through `start()`: the rAF loop adds
 * nothing here, and the point of `autosaveDue` is that the tick is the only clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG } from '@/data'
import { AUTOSAVE_MS, MANUAL_SAVE_COOLDOWN_MS, SAVE_DEBOUNCE_MS, SAVE_KEY } from '@/game/constants'
import { autosaveDue } from '@/state/autosave'
import { GameStore } from '@/state/store'

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)

// ---------------------------------------------------------------------------
// The pure decision
// ---------------------------------------------------------------------------
describe('autosaveDue', () => {
  const rows: [string, number, number, number | null, boolean, string | null][] = [
    ['nothing pending, nothing due', T0 + 1_000, T0, null, true, null],
    ['dirty but still inside the debounce', T0 + 1_000, T0, T0 + 500, true, null],
    ['dirty and the debounce elapsed', T0 + SAVE_DEBOUNCE_MS, T0, T0, true, 'action'],
    ['dirty exactly at the debounce edge', T0 + SAVE_DEBOUNCE_MS, T0, T0, true, 'action'],
    ['clean and the interval elapsed', T0 + AUTOSAVE_MS, T0, null, true, 'interval'],
    ['clean just inside the interval', T0 + AUTOSAVE_MS - 1, T0, null, true, null],
    ['action wins over interval', T0 + AUTOSAVE_MS, T0, T0, true, 'action'],
    ['autosave off, dirty and overdue', T0 + AUTOSAVE_MS * 10, T0, T0, false, null],
    ['never saved yet', T0, 0, null, true, 'interval'],
  ]

  for (const [name, now, lastSaveAt, dirtyAt, autosave, expected] of rows) {
    it(name, () => {
      expect(autosaveDue(now, lastSaveAt, dirtyAt, autosave)).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
interface FakeWindow {
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void }
  addEventListener(): void
  removeEventListener(): void
}

/** How many times the save blob itself was written (the guest id write does not count). */
let writes = 0
let throwOnSet = false
let clock = T0

function stubWindow(): void {
  const store = new Map<string, string>()
  const fake: FakeWindow = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        if (throwOnSet) throw new DOMException('QuotaExceededError')
        if (k === SAVE_KEY) writes += 1
        store.set(k, v)
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  ;(globalThis as { window?: unknown }).window = fake
}

/** Step the store's own tick, the clock the autosave rides on. */
function step(store: GameStore, at: number): void {
  clock = at
  ;(store as unknown as { tick(dt: number, now: number): void }).tick(0.05, at)
}

function makeStore(): GameStore {
  const store = new GameStore(CATALOG)
  store.state.credits = 1e9
  // Establish a baseline write so the very first tick is not an "never saved" interval write.
  // `interval`, not `manual`: a manual write starts the manual cooldown, which these tests set.
  store.save('interval')
  writes = 0
  return store
}

describe('GameStore save cadence', () => {
  beforeEach(() => {
    writes = 0
    throwOnSet = false
    clock = T0
    stubWindow()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { window?: unknown }).window
  })

  it('ten buys inside 200 ms write once', () => {
    const store = makeStore()
    for (let i = 0; i < 10; i++) {
      clock = T0 + i * 20
      expect(store.buyHardware('pc-4c8t', 1).error).toBeUndefined()
    }

    step(store, T0 + 300)
    expect(writes).toBe(0)

    step(store, T0 + 200 + SAVE_DEBOUNCE_MS)
    expect(writes).toBe(1)
    expect(store.saveReason).toBe('action')

    // The debounce window is closed again, so the next tick is quiet.
    step(store, T0 + 400 + SAVE_DEBOUNCE_MS)
    expect(writes).toBe(1)
  })

  it('click never schedules an action save', () => {
    const store = makeStore()
    for (let i = 0; i < 10; i++) {
      clock = T0 + i * 137
      store.click()
    }

    step(store, T0 + 2_000 + SAVE_DEBOUNCE_MS)
    expect(writes).toBe(0)

    // The interval still catches it within ten seconds.
    step(store, T0 + AUTOSAVE_MS)
    expect(writes).toBe(1)
    expect(store.saveReason).toBe('interval')
  })

  it('a failed action schedules nothing', () => {
    const store = makeStore()
    expect(store.buyHardware('no-such-card').error).toBeDefined()
    step(store, T0 + SAVE_DEBOUNCE_MS * 2)
    expect(writes).toBe(0)
  })

  it('a refused write sets saveError and the next success clears it', () => {
    const store = makeStore()
    const savedAt = store.savedAt

    throwOnSet = true
    clock = T0 + 1_000
    store.save('manual')
    expect(store.saveError).toBe(true)
    // A write that did not land must not claim it did.
    expect(store.savedAt).toBe(savedAt)

    throwOnSet = false
    clock = T0 + 1_000 + MANUAL_SAVE_COOLDOWN_MS
    store.save('manual')
    expect(store.saveError).toBe(false)
    expect(store.savedAt).toBe(clock)
    expect(store.saveReason).toBe('manual')
  })

  it('refuses a second manual save inside the cooldown and says how long is left', () => {
    const store = makeStore()
    clock = T0 + 1_000
    expect(store.save('manual')).toBe(true)
    const written = writes

    clock = T0 + 2_000
    expect(store.save('manual')).toBe(false)
    expect(writes).toBe(written)
    expect(store.msUntilManualSave(clock)).toBe(MANUAL_SAVE_COOLDOWN_MS - 1_000)

    // The cadence the tick asks for is untouched: only the player's own key is on a cooldown.
    clock = T0 + 2_000 + AUTOSAVE_MS
    step(store, clock)
    expect(writes).toBe(written + 1)

    clock = T0 + 1_000 + MANUAL_SAVE_COOLDOWN_MS
    expect(store.save('manual')).toBe(true)
    expect(store.msUntilManualSave(clock)).toBe(MANUAL_SAVE_COOLDOWN_MS)
  })

  it('autosave off stops the tick writes but never an explicit one', () => {
    const store = makeStore()
    store.toggleSetting('autosave', false)
    writes = 0

    step(store, T0 + AUTOSAVE_MS * 3)
    expect(writes).toBe(0)

    // Hiding the tab writes regardless of the setting.
    clock = T0 + AUTOSAVE_MS * 3
    store.save('hide')
    expect(writes).toBe(1)
    expect(store.saveReason).toBe('hide')
  })

  it('replaceState saves with the import reason', () => {
    const store = makeStore()
    clock = T0 + 5_000
    store.replaceState({ ...store.state })
    expect(writes).toBe(1)
    expect(store.saveReason).toBe('import')
    expect(store.savedAt).toBe(T0 + 5_000)
  })
})
