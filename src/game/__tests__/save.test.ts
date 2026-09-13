import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATALOG } from '@/data'
import { SAVE_KEY, SAVE_VERSION } from '@/game/constants'
import {
  EXPORT_PREFIX,
  MIGRATIONS,
  SAVE_CORRUPT_KEY,
  deserialize,
  exportString,
  importString,
  loadSave,
  migrateSave,
  serialize,
} from '@/game/save'
import { createInitialState } from '@/game/state'
import type { GameState } from '@/game/types'

const T0 = 1_700_000_000_000
const GUEST = 'guest-abc'
const UNICODE_PROMPT = 'a cat 🐈 wearing a béret · 東京の夜 · spaghetti nodes'

/** A lived-in save using only real catalog ids. */
function richState(): GameState {
  const s = createInitialState(T0 - 3_600_000, GUEST)
  s.credits = 1234.5
  s.lifetimeCredits = 99_999
  s.seasonCredits = 4_321
  s.totalClicks = 77
  s.hardware = { 'pc-4c8t': 1, 'pc-8c16t': 3, 'rtx-3060': 2 }
  s.hardwareTiers = { 'rtx-3060': 1 }
  s.upgrades = ['better-prompts']
  s.models = { sd15: { precisions: ['native'], setup: true }, sdxl: { precisions: ['native', 'fp8'], setup: true } }
  s.loras = ['comfyui']
  s.mapNodes = ['core-root', 'core-manager']
  s.achievements = ['first-click']
  s.posts = [
    {
      id: 'post-1',
      createdAt: T0 - 5_000,
      modelId: 'sdxl',
      kind: 'image',
      precision: 'fp8',
      prompt: UNICODE_PROMPT,
      tags: ['comfyui'],
      matchedTrending: ['comfyui'],
      thumb: 'cat',
      cost: 12,
      targetLikes: 120,
      likes: 40,
      creditsPerLike: 1.5,
      creditsPaid: 60,
      windowMs: 8_000,
      viral: false,
      flop: false,
      founderBoost: false,
      followersGained: 0,
      granted: false,
      roll: 1.1,
      trendMult: 2,
    },
  ]
  s.queue = [
    {
      id: 'job-1',
      modelId: 'sd15',
      precision: 'native',
      prompt: 'quick test',
      tags: [],
      hardwareId: 'rtx-3060',
      cost: 12,
      durationMs: 4_000,
      createdAt: T0 - 1_000,
      startedAt: T0 - 500,
      endsAt: T0 + 3_500,
      clickBonusMs: 150,
    },
  ]
  s.followers = 42
  s.followersFrac = 0.25
  s.lifetimeFollowers = 50
  s.lifetimeLikes = 800
  s.signups = 1
  s.rp = 2
  s.cp = 3
  s.cpSpent = 1
  s.hubRep = 7
  s.contracts = {
    active: [{ defId: 'c-cousin-wedding', acceptedAt: T0 - 9_000, progress: 2, target: 5, rewardCredits: 300, done: false, claimed: false }],
    nextRotateAt: T0 + 60_000,
  }
  s.events = {
    active: [{ defId: 'ev-node-broke-import', kind: 'nodeBroke', startedAt: T0 - 1_000, endsAt: T0 + 119_000 }],
    nextAt: T0 + 200_000,
  }
  s.daily = { lastClaimDay: '2023-11-14', streak: 3, claimed: ['2023-11-12', '2023-11-13', '2023-11-14'] }
  s.stats = { ...s.stats, posts: 9, videos: 2, bestPostLikes: 500, lastPrompt: UNICODE_PROMPT, bestCps: 12.5, clicksWindow: [T0 - 300, T0 - 100] }
  s.settings = { sfx: false, particles: true, reducedMotion: true, projector: false, autosave: false }
  s.flags = { spaghetti: true }
  s.weekOverride = 4
  s.liveTrending = { tags: ['comfyui', 'wan22'], fetchedAt: T0 - 60_000 }
  return s
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('serialize / deserialize', () => {
  it('round-trips a lived-in state exactly', () => {
    const state = richState()
    const back = deserialize(serialize(state), T0, 'other-guest')
    expect(back).toEqual(state)
    expect(back.meta.guestId).toBe(GUEST)
  })

  it('round-trips a fresh state and stamps the save version', () => {
    const fresh = createInitialState(T0, GUEST)
    const json = serialize(fresh)
    expect(JSON.parse(json).v).toBe(SAVE_VERSION)
    expect(deserialize(json, T0, GUEST)).toEqual(fresh)
  })

  it('returns a fresh state for null, empty or corrupt input and reports corruption', () => {
    const fresh = createInitialState(T0, GUEST)
    expect(deserialize(null, T0, GUEST)).toEqual(fresh)
    expect(deserialize('', T0, GUEST)).toEqual(fresh)
    expect(deserialize('{"credits": 5', T0, GUEST)).toEqual(fresh)
    expect(deserialize('not json at all', T0, GUEST)).toEqual(fresh)
    expect(deserialize('[1,2,3]', T0, GUEST)).toEqual(fresh)
    expect(deserialize('"a string"', T0, GUEST)).toEqual(fresh)

    expect(loadSave(null, T0, GUEST).corrupt).toBe(false)
    expect(loadSave('{"credits": 5', T0, GUEST).corrupt).toBe(true)
    expect(loadSave('[1]', T0, GUEST).corrupt).toBe(true)
    expect(loadSave('{}', T0, GUEST).corrupt).toBe(false)
    expect(SAVE_CORRUPT_KEY).toBe(`${SAVE_KEY}.corrupt`)
  })

  it('drops ids the catalog does not know', () => {
    const state = richState()
    const blob = JSON.parse(serialize(state)) as Record<string, unknown>
    Object.assign(blob, {
      hardware: { ...state.hardware, 'rtx-9999': 4 },
      hardwareTiers: { ...state.hardwareTiers, 'gtx-1080': 2 },
      upgrades: [...state.upgrades, 'infinite-vram', 'tier:pc-4c8t:1'],
      models: { ...state.models, 'gpt-9': { precisions: ['native'], setup: true } },
      loras: [...state.loras, 'notatag'],
      mapNodes: [...state.mapNodes, 'secret-lab'],
      achievements: [...state.achievements, 'ghost'],
      posts: [...state.posts, { ...state.posts[0], id: 'post-2', modelId: 'gpt-9' }, { ...state.posts[0], id: 'post-3', tags: ['ghosttag'] }],
      queue: [...state.queue, { ...state.queue[0], id: 'job-2', hardwareId: 'gtx-1080' }],
      contracts: { ...state.contracts, active: [...state.contracts.active, { ...state.contracts.active[0], defId: 'c-nope' }] },
      events: { ...state.events, active: [...state.events.active, { ...state.events.active[0], defId: 'ev-nope' }] },
      liveTrending: { tags: ['comfyui', 'ghosttag'], fetchedAt: T0 },
    })
    const back = deserialize(JSON.stringify(blob), T0, GUEST)
    expect(back.hardware).toEqual(state.hardware)
    expect(back.hardwareTiers).toEqual(state.hardwareTiers)
    expect(back.upgrades).toEqual(state.upgrades)
    expect(Object.keys(back.models)).toEqual(['sd15', 'sdxl'])
    expect(back.loras).toEqual(['comfyui'])
    expect(back.mapNodes).toEqual(state.mapNodes)
    expect(back.achievements).toEqual(state.achievements)
    expect(back.posts.map((p) => p.id)).toEqual(['post-1', 'post-3'])
    expect(back.posts[1]?.tags).toEqual([])
    expect(back.queue.map((j) => j.id)).toEqual(['job-1'])
    expect(back.contracts.active.map((c) => c.defId)).toEqual(['c-cousin-wedding'])
    expect(back.events.active.map((e) => e.defId)).toEqual(['ev-node-broke-import'])
    expect(back.liveTrending).toEqual({ tags: ['comfyui'], fetchedAt: T0 })
  })

  it('strips unknown keys and fills missing fields from the fresh state', () => {
    const back = deserialize(
      JSON.stringify({ v: SAVE_VERSION, credits: 42, bogus: 1, stats: { posts: 3, bogus: 2 }, meta: { playedSec: 9 } }),
      T0,
      GUEST,
    )
    const fresh = createInitialState(T0, GUEST)
    expect(back.credits).toBe(42)
    expect(back.stats.posts).toBe(3)
    expect(back.stats.videos).toBe(0)
    expect(back.meta.playedSec).toBe(9)
    expect(back.meta.guestId).toBe(GUEST)
    expect(back.hardware).toEqual(fresh.hardware)
    expect(back.models).toEqual(fresh.models)
    expect('bogus' in back).toBe(false)
    expect('bogus' in back.stats).toBe(false)
    expect(Object.keys(back).sort()).toEqual(Object.keys(fresh).sort())
  })

  it('falls back per field on bad values instead of discarding the save', () => {
    const back = deserialize(
      JSON.stringify({
        v: SAVE_VERSION,
        credits: 'lots',
        totalClicks: -3,
        hardware: { 'pc-4c8t': 'two', 'pc-8c16t': 2, 'rtx-3060': 1.5 },
        models: { sd15: { precisions: ['native', 'int2', 'fp8'], setup: true }, sdxl: { precisions: [] } },
        settings: { sfx: 'yes', particles: false },
        weekOverride: 'week',
        posts: 'none',
      }),
      T0,
      GUEST,
    )
    expect(back.credits).toBe(0)
    expect(back.totalClicks).toBe(0)
    // The starter PC is restored even when its own entry was garbage.
    expect(back.hardware).toEqual({ 'pc-8c16t': 2, 'pc-4c8t': 1 })
    expect(back.models.sd15).toEqual({ precisions: ['native', 'fp8'], setup: true })
    expect(back.models.sdxl).toEqual({ precisions: ['native'], setup: true })
    expect(back.settings).toEqual({ sfx: true, particles: false, reducedMotion: false, projector: false, autosave: true })
    expect(back.weekOverride).toBeNull()
    expect(back.posts).toEqual([])
  })

  it('clamps a lastTickAt from the future to now', () => {
    const state = createInitialState(T0, GUEST)
    state.meta.lastTickAt = T0 + 999_999
    expect(deserialize(serialize(state), T0, GUEST).meta.lastTickAt).toBe(T0)
  })

  it('restores the fresh defaults when a record field is not a record at all', () => {
    const fresh = createInitialState(T0, GUEST)
    const back = deserialize(JSON.stringify({ v: SAVE_VERSION, hardware: 'a string', models: 42, flags: [1, 2] }), T0, GUEST)
    expect(back.hardware).toEqual(fresh.hardware)
    expect(back.models).toEqual(fresh.models)
    expect(back.flags).toEqual({})
  })

  it('always leaves the player with the starter PC and SD 1.5, set up', () => {
    const back = deserialize(
      JSON.stringify({ v: SAVE_VERSION, hardware: { 'rtx-3060': 2 }, models: { sdxl: { precisions: ['native'], setup: true }, sd15: { precisions: ['native'], setup: false } } }),
      T0,
      GUEST,
    )
    expect(back.hardware).toEqual({ 'rtx-3060': 2, 'pc-4c8t': 1 })
    expect(back.models.sd15).toEqual({ precisions: ['native'], setup: true })
    expect(back.models.sdxl?.setup).toBe(true)
  })

  it('normalises queued jobs: running jobs get an endsAt, pending ones lose it, click bonus is capped', () => {
    const state = richState()
    const base = state.queue[0]!
    state.queue = [
      { ...base, id: 'running-no-end', startedAt: T0 - 1000, endsAt: null, clickBonusMs: 0 },
      { ...base, id: 'pending-with-end', startedAt: null, endsAt: T0 + 5000, clickBonusMs: 0 },
      { ...base, id: 'over-clicked', startedAt: T0 - 1000, endsAt: T0 + 3000, clickBonusMs: 99_999 },
    ]
    const back = deserialize(serialize(state), T0, GUEST)
    const [running, pending, clicked] = back.queue
    expect(running).toMatchObject({ startedAt: T0 - 1000, endsAt: T0 - 1000 + base.durationMs })
    expect(pending).toMatchObject({ startedAt: null, endsAt: null })
    expect(clicked?.clickBonusMs).toBe(0.5 * base.durationMs)
  })

  it('pulls timestamps from a clock that ran ahead back to now, keeping relative timing', () => {
    const state = richState()
    const YEAR = 365 * 86_400_000
    state.events.nextAt = T0 + YEAR
    state.contracts.nextRotateAt = T0 + YEAR
    state.liveTrending = { tags: ['comfyui'], fetchedAt: T0 + YEAR }
    state.posts[0]!.createdAt = T0 + 60_000
    const job = state.queue[0]!
    job.createdAt = T0 + 10_000
    job.startedAt = T0 + 20_000
    job.endsAt = T0 + 20_000 + job.durationMs
    state.events.active[0]!.startedAt = T0 + YEAR
    state.events.active[0]!.endsAt = T0 + 2 * YEAR
    const back = deserialize(serialize(state), T0, GUEST)
    expect(back.events.nextAt).toBeLessThanOrEqual(T0 + 8 * 60_000)
    expect(back.contracts.nextRotateAt).toBeLessThanOrEqual(T0 + 30 * 60_000)
    expect(back.liveTrending?.fetchedAt).toBe(T0)
    expect(back.posts[0]?.createdAt).toBe(T0)
    const j = back.queue[0]!
    expect(j.startedAt).toBe(T0)
    expect(j.createdAt).toBe(T0 - 10_000)
    expect(j.endsAt).toBe(T0 + job.durationMs)
    const e = back.events.active[0]!
    expect(e.startedAt).toBe(T0)
    expect(e.endsAt).toBe(T0 + 120_000)
  })
})

describe('migrations', () => {
  const original0 = MIGRATIONS[0] as (s: unknown) => unknown

  afterEach(() => {
    MIGRATIONS[0] = original0
    delete MIGRATIONS[SAVE_VERSION]
  })

  it('runs the hook for every version below SAVE_VERSION and stamps v', () => {
    const spy = vi.fn((s: unknown) => original0(s))
    MIGRATIONS[0] = spy
    const back = deserialize(JSON.stringify({ credits: 5 }), T0, GUEST)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ credits: 5 })
    expect(back.credits).toBe(5)
    expect(back.v).toBe(SAVE_VERSION)
  })

  it('lets a migration reshape the save', () => {
    MIGRATIONS[0] = (s) => ({ ...(s as Record<string, unknown>), credits: 999, legacyField: 'gone' })
    const back = deserialize(JSON.stringify({ v: 0, credits: 1 }), T0, GUEST)
    expect(back.credits).toBe(999)
    expect('legacyField' in back).toBe(false)
  })

  it('does not run hooks for current or newer saves and treats a throwing hook as corrupt', () => {
    const spy = vi.fn((s: unknown) => original0(s))
    MIGRATIONS[0] = spy
    expect(migrateSave({ v: SAVE_VERSION, credits: 1 }).from).toBe(SAVE_VERSION)
    const newer = loadSave(JSON.stringify({ v: SAVE_VERSION + 5, credits: 8 }), T0, GUEST)
    expect(spy).not.toHaveBeenCalled()
    expect(newer.corrupt).toBe(false)
    expect(newer.state.credits).toBe(8)
    expect(newer.state.v).toBe(SAVE_VERSION)

    MIGRATIONS[0] = () => {
      throw new Error('boom')
    }
    expect(loadSave(JSON.stringify({ credits: 1 }), T0, GUEST).corrupt).toBe(true)
  })
})

describe('exportString / importString', () => {
  it('round-trips a state with a unicode prompt through a CC1| code', () => {
    const state = richState()
    const code = exportString(state)
    expect(code.startsWith(EXPORT_PREFIX)).toBe(true)
    expect(code.slice(EXPORT_PREFIX.length)).toMatch(/^[A-Za-z0-9+/=]+$/)
    const back = importString(code, T0, 'ignored')
    expect(back).toEqual(state)
    expect(back?.posts[0]?.prompt).toBe(UNICODE_PROMPT)
  })

  it('tolerates pasted whitespace, accepts raw JSON and rejects garbage', () => {
    const state = richState()
    const code = exportString(state)
    const wrapped = code.slice(0, 20) + '\n  ' + code.slice(20, 60) + ' ' + code.slice(60)
    expect(importString(`  ${wrapped}\n`, T0)).toEqual(state)
    expect(importString(serialize(state), T0)).toEqual(state)
    expect(importString('hello', T0)).toBeNull()
    expect(importString(`${EXPORT_PREFIX}!!!not base64!!!`, T0)).toBeNull()
    expect(importString(`${EXPORT_PREFIX}${btoa('[1,2]')}`, T0)).toBeNull()
    expect(importString('', T0)).toBeNull()
  })

  it('encodes large saves without blowing the call stack and matches the Buffer fallback', () => {
    const state = richState()
    state.stats.lastPrompt = 'x'.repeat(300_000)
    const viaBtoa = exportString(state)
    vi.stubGlobal('btoa', undefined)
    vi.stubGlobal('atob', undefined)
    const viaBuffer = exportString(state)
    expect(viaBuffer).toBe(viaBtoa)
    expect(importString(viaBuffer, T0)).toEqual(state)
  })

  it('uses the shipped catalog by default', () => {
    expect(CATALOG.hardware.length).toBeGreaterThan(0)
    const back = importString(exportString(richState()), T0)
    expect(back?.hardware['rtx-3060']).toBe(2)
  })
})
