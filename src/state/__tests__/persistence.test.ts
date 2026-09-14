// @vitest-environment jsdom
/**
 * The two sign-in paths that can destroy a run: adopting a cloud save, and deciding whose run the
 * local blob is. Supabase is a hand-rolled double so the decision logic is the only thing under
 * test; `startCloudSync` takes the client and the store, so nothing here touches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG } from '@/data'
import type { GameEvent } from '@/game/types'
import { serialize } from '@/game/save'
import { GameStore } from '@/state/store'
import { CLOUD_MERGE_EVENT, startCloudSync, type CloudMergeRequest } from '@/state/persistence'

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)

type Row = Record<string, unknown>
interface FakeDb {
  row: Row | null
  inserted: Row[]
  updated: Row[]
}

/** Minimal PostgREST double: `.select().eq().maybeSingle()`, `.insert().select().single()`, `.update().eq().select()`. */
function makeSupabase(db: FakeDb) {
  let authCb: ((event: string, session: unknown) => void) | null = null
  const from = () => {
    const q = {
      op: 'select' as 'select' | 'insert' | 'update',
      payload: {} as Row,
      select: () => q,
      eq: () => q,
      insert(v: Row) {
        q.op = 'insert'
        q.payload = v
        return q
      },
      update(v: Row) {
        q.op = 'update'
        q.payload = v
        return q
      },
      result() {
        if (q.op === 'insert') {
          db.inserted.push(q.payload)
          db.row = { ...q.payload }
          return { data: { saved_at: q.payload.saved_at }, error: null }
        }
        if (q.op === 'update') {
          db.updated.push(q.payload)
          db.row = { ...(db.row ?? {}), ...q.payload }
          return { data: [{ saved_at: q.payload.saved_at }], error: null }
        }
        return { data: db.row, error: null }
      },
      maybeSingle: () => Promise.resolve(q.result()),
      single: () => Promise.resolve(q.result()),
      then: <T,>(ok: (v: unknown) => T, fail?: (e: unknown) => T) => Promise.resolve(q.result()).then(ok, fail),
    }
    return q
  }
  return {
    auth: {
      onAuthStateChange(cb: (event: string, session: unknown) => void) {
        authCb = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
    from,
    signIn(userId: string) {
      authCb?.('SIGNED_IN', { user: { id: userId } })
    },
  }
}

type Supabase = ReturnType<typeof makeSupabase>
/** `startCloudSync` wants the real client type; the double only implements what it calls. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (s: Supabase): any => s

/** A cloud row holding a real run that stopped ticking `gapSec` ago. */
function cloudRow(gapSec: number, savedAt = new Date(T0 - gapSec * 1000).toISOString()): Row {
  const seed = new GameStore(CATALOG)
  seed.state.credits = 1e9
  // Four more office PCs, not ten: eleven of them draw 715 W and a tripped breaker earns nothing.
  for (let i = 0; i < 4; i++) seed.buyHardware('pc-4c8t')
  seed.state.lifetimeCredits = 5e9
  seed.state.meta.playedSec = 9_000
  seed.state.totalClicks = 4_000
  seed.state.meta.lastTickAt = T0 - gapSec * 1000
  return {
    user_id: 'cloud-owner',
    version: 1,
    state: JSON.parse(serialize(seed.state)) as Row,
    cps: seed.derived.cps,
    lifetime_credits: 5e9,
    followers: 0,
    season: 1,
    saved_at: savedAt,
  }
}

/** A local run big enough that `isFreshRun` is false. */
function bigLocalRun(): GameStore {
  const store = new GameStore(CATALOG)
  store.state.credits = 7e6
  store.state.lifetimeCredits = 7e6
  store.state.meta.playedSec = 4_000
  store.state.totalClicks = 3_000
  return store
}

let stop: (() => void) | null = null
let merges: CloudMergeRequest[] = []

function onMerge(e: Event): void {
  const request = (e as CustomEvent<CloudMergeRequest>).detail
  merges.push(request)
  request.choose('local')
}

beforeEach(() => {
  merges = []
  window.localStorage.clear()
  vi.spyOn(Date, 'now').mockImplementation(() => T0)
  window.addEventListener(CLOUD_MERGE_EVENT, onMerge)
})

afterEach(() => {
  window.removeEventListener(CLOUD_MERGE_EVENT, onMerge)
  stop?.()
  stop = null
  vi.restoreAllMocks()
})

describe('adopting a cloud save', () => {
  it('fans out every event the adopted gap produced', async () => {
    const store = new GameStore(CATALOG)
    const events: GameEvent[] = []
    store.onEvent((e) => events.push(e))

    const db: FakeDb = { row: cloudRow(7_200), inserted: [], updated: [] }
    const supabase = makeSupabase(db)
    stop = startCloudSync(store, asClient(supabase))
    supabase.signIn('user-a')

    // The local run is fresh, so the cloud save is adopted silently.
    await vi.waitFor(() => expect(store.state.lifetimeCredits).toBeGreaterThan(1e9))
    expect(merges).toHaveLength(0)
    // Before the fix `adoptCloud` kept the report and dropped `report.events`, so the ComfyHub
    // royalty bridge never saw the posts the gap settled and no achievement ever toasted.
    expect(events.some((e) => e.type === 'offline')).toBe(true)
    expect(store.offlineReport?.gain).toBeGreaterThan(0)
    expect(store.saveOwner).toBe('user-a')
  })
})

describe('whose run is the local save', () => {
  it('never offers the previous account run to the next one', async () => {
    const store = bigLocalRun()
    store.setSaveOwner('user-a')

    const db: FakeDb = { row: cloudRow(60), inserted: [], updated: [] }
    const supabase = makeSupabase(db)
    stop = startCloudSync(store, asClient(supabase))
    supabase.signIn('user-b')

    await vi.waitFor(() => expect(store.saveOwner).toBe('user-b'))
    // No question, and nothing of user A survives into user B's account.
    expect(merges).toHaveLength(0)
    expect(store.state.lifetimeCredits).toBeGreaterThan(1e9)
    expect(db.updated).toHaveLength(0)
  })

  it('starts a brand new account clean rather than claiming the run it found', async () => {
    const store = bigLocalRun()
    store.setSaveOwner('user-a')

    const db: FakeDb = { row: null, inserted: [], updated: [] }
    const supabase = makeSupabase(db)
    stop = startCloudSync(store, asClient(supabase))
    supabase.signIn('user-b')

    await vi.waitFor(() => expect(db.inserted).toHaveLength(1))
    expect(merges).toHaveLength(0)
    expect(store.state.lifetimeCredits).toBe(0)
    expect(db.inserted[0].lifetime_credits).toBe(0)
    expect(db.inserted[0].user_id).toBe('user-b')
  })

  it('still uploads an unclaimed guest run when the player signs up', async () => {
    const store = bigLocalRun()
    expect(store.saveOwner).toBeNull()

    const db: FakeDb = { row: null, inserted: [], updated: [] }
    const supabase = makeSupabase(db)
    stop = startCloudSync(store, asClient(supabase))
    supabase.signIn('user-c')

    await vi.waitFor(() => expect(db.inserted).toHaveLength(1))
    expect(db.inserted[0].lifetime_credits).toBe(7e6)
    expect(store.saveOwner).toBe('user-c')
  })

  it('still asks when a guest run meets a real cloud save', async () => {
    const store = bigLocalRun()
    const db: FakeDb = { row: cloudRow(60), inserted: [], updated: [] }
    const supabase = makeSupabase(db)
    stop = startCloudSync(store, asClient(supabase))
    supabase.signIn('user-d')

    await vi.waitFor(() => expect(merges).toHaveLength(1))
    expect(merges[0].local.lifetimeCredits).toBe(7e6)
    expect(merges[0].cloud.lifetimeCredits).toBe(5e9)
  })
})
