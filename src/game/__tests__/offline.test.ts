import { describe, expect, it, vi } from 'vitest'
import { createCatalog } from '@/data'
import { OFFLINE_EFFICIENCY, POWER_BUDGET_BASE, SHORT_GAP_S, XP_CREDITS } from '@/game/constants'
import { createInitialState } from '@/game/state'
import type { Derived, GameEvent, GameState, Job, Post } from '@/game/types'

/**
 * studio/virality are replaced with minimal stand-ins so the test pins down offline.ts's own
 * behaviour (income rule, sequential replay, settlement ordering) rather than their formulas.
 */
vi.mock('@/game/studio', () => ({
  advanceQueue: (state: GameState, derived: Derived, _catalog: unknown, now: number): GameEvent[] => {
    const events: GameEvent[] = []
    for (const job of [...state.queue]) {
      if (job.startedAt === null || job.endsAt === null || job.endsAt - job.clickBonusMs > now) continue
      state.queue.splice(state.queue.indexOf(job), 1)
      const post: Post = {
        id: `post-${job.id}`,
        createdAt: now,
        modelId: job.modelId,
        kind: 'image',
        precision: job.precision,
        prompt: job.prompt,
        tags: [],
        matchedTrending: [],
        thumb: 'x',
        cost: job.cost,
        targetLikes: 100,
        likes: 0,
        creditsPerLike: 1,
        creditsPaid: 0,
        windowMs: 8000,
        viral: false,
        flop: false,
        founderBoost: false,
        followersGained: 0,
        granted: false,
        roll: 1,
        trendMult: 1,
      }
      state.posts.unshift(post)
      events.push({ type: 'postCreated', postId: post.id })
    }
    let running = state.queue.filter((j) => j.startedAt !== null).length
    for (const job of state.queue) {
      if (running >= derived.concurrency) break
      if (job.startedAt !== null) continue
      job.startedAt = now
      job.endsAt = now + job.durationMs
      running += 1
      events.push({ type: 'jobStarted', jobId: job.id })
    }
    return events
  },
}))

vi.mock('@/game/virality', () => ({
  settlePosts: (state: GameState, _derived: Derived, _catalog: unknown, now: number): GameEvent[] => {
    const events: GameEvent[] = []
    for (const post of state.posts) {
      const p = Math.min(1, Math.max(0, (now - post.createdAt) / post.windowMs))
      const likes = Math.floor(post.targetLikes * (1 - (1 - p) ** 3))
      if (likes > post.likes) {
        const pay = (likes - post.likes) * post.creditsPerLike
        post.likes = likes
        post.creditsPaid += pay
        state.credits += pay
        state.lifetimeCredits += pay
        state.seasonCredits += pay
      }
      if (p >= 1 && !post.granted) {
        post.granted = true
        events.push({ type: 'postResolved', postId: post.id, viral: false, flop: false, ratioed: false })
      }
    }
    return events
  },
}))

import { levelReward, xpForLevel } from '@/game/level'
import { applyOffline, OFFLINE_CLAIM_MIN_S, offlineGain, replayQueue } from '@/game/offline'
import { ACHIEVEMENTS } from '@/data/achievements'
import { CONTRACTS } from '@/data/contracts'
import { EVENT_DEFS } from '@/data/events'
import { HASHTAGS } from '@/data/hashtags'
import { WEEK_MS } from '@/game/constants'
import { acceptContract } from '@/game/contracts'
import { tick } from '@/game/engine'
import { currentTrending } from '@/game/hashtags'
import { mulberry32 } from '@/game/rng'

const T0 = Date.UTC(2026, 8, 13, 12, 0, 0)
const catalog = createCatalog()

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return {
    cps: 2,
    rawCps: 2,
    clickValue: 1,
    bestVram: 8,
    bestTier: 1,
    bestHardwareId: 'pc-4c8t',
    hasGpu: false,
    powerDraw: 0,
    powerBudget: POWER_BUDGET_BASE,
    throttled: false,
    concurrency: 1,
    speedMult: 1,
    likesMult: 1,
    payoutBonus: 0,
    followRate: 0.05,
    viralChance: 0.05,
    flopChance: 0.15,
    offlineCapHours: 12,
    offlineEfficiency: OFFLINE_EFFICIENCY,
    globalMult: 1,
    cpMult: 1,
    familyMult: {},
    rigMult: {},
    familyGenTime: {},
    coolingTier: {},
    tagLikes: {},
    unlockedFamilies: ['cpu'],
    zluda: false,
    apiNodes: false,
    hashtagResearch: false,
    streakGrace: false,
    reservedCapacity: false,
    weekSpeed: 1,
    ...overrides,
  }
}

function job(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    modelId: 'sd15',
    precision: 'native',
    prompt: 'a cat',
    tags: [],
    hardwareId: 'pc-4c8t',
    cost: 10,
    durationMs: 10_000,
    createdAt: T0 - 60_000,
    startedAt: null,
    endsAt: null,
    clickBonusMs: 0,
    ...overrides,
  }
}

function stateAt(lastTickAt: number): GameState {
  const s = createInitialState(T0 - 3600_000, 'guest-offline')
  s.meta.lastTickAt = lastTickAt
  return s
}

/** Lifetime credits whose derived term alone reaches `xp`: the inverse of `creditsXp`, rounded up. */
const creditsForXp = (xp: number): number => Math.ceil(10 ** (xp / XP_CREDITS))

describe('offlineGain', () => {
  it('pays the full rate, uncapped, for short gaps', () => {
    expect(offlineGain(100, derivedWith({ cps: 2 }))).toEqual({ paidSec: 100, gain: 200, short: true })
    expect(offlineGain(SHORT_GAP_S, derivedWith({ cps: 2 })).short).toBe(true)
    expect(offlineGain(SHORT_GAP_S + 1, derivedWith({ cps: 2 })).short).toBe(false)
    expect(offlineGain(-5, derivedWith())).toEqual({ paidSec: 0, gain: 0, short: true })
  })

  it('caps long gaps at offlineCapHours and applies OFFLINE_EFFICIENCY', () => {
    const r = offlineGain(48 * 3600, derivedWith({ cps: 2, offlineCapHours: 12 }))
    expect(r).toEqual({ paidSec: 12 * 3600, gain: 2 * 12 * 3600 * OFFLINE_EFFICIENCY, short: false })
    expect(offlineGain(2 * 3600, derivedWith({ cps: 2, offlineCapHours: 12 })).paidSec).toBe(2 * 3600)
    expect(offlineGain(48 * 3600, derivedWith({ cps: 1, offlineCapHours: Infinity })).paidSec).toBe(48 * 3600)
    expect(offlineGain(3600, derivedWith({ cps: 1, offlineCapHours: 0 })).gain).toBe(0)
  })
})

describe('applyOffline', () => {
  it('short gap: silent full-rate catch-up, no offline event', () => {
    const state = stateAt(T0)
    const now = T0 + 120_000
    const r = applyOffline(state, derivedWith({ cps: 2 }), catalog, now)
    expect(r).toEqual({ elapsedSec: 120, gain: 240, events: [] })
    expect(state.credits).toBe(240)
    expect(state.lifetimeCredits).toBe(240)
    expect(state.seasonCredits).toBe(240)
    expect(state.meta.lastTickAt).toBe(now)
    // A two-minute tab switch pays at the full rate and shows no card, so it is not a claim
    // either: "Comfy Sleep Mode" cannot be earned by alt-tabbing.
    expect(state.stats.offlineClaims).toBe(0)
  })

  it('no offline claim anywhere inside the short-gap band', () => {
    for (const sec of [OFFLINE_CLAIM_MIN_S - 1, OFFLINE_CLAIM_MIN_S, OFFLINE_CLAIM_MIN_S + 1, SHORT_GAP_S]) {
      const state = stateAt(T0)
      applyOffline(state, derivedWith({ cps: 2 }), catalog, T0 + sec * 1000)
      expect(state.stats.offlineClaims).toBe(0)
    }
    const state = stateAt(T0)
    applyOffline(state, derivedWith({ cps: 2 }), catalog, T0 + (OFFLINE_CLAIM_MIN_S - 1) * 1000)
    expect(state.credits).toBeCloseTo(2 * (OFFLINE_CLAIM_MIN_S - 1))
  })

  it('the first gap past the short band is an offline claim', () => {
    const state = stateAt(T0)
    applyOffline(state, derivedWith({ cps: 2 }), catalog, T0 + (SHORT_GAP_S + 1) * 1000)
    expect(state.stats.offlineClaims).toBe(1)
  })

  it('long gap: capped income and an offline report first in the event list', () => {
    const state = stateAt(T0)
    const now = T0 + 48 * 3600_000
    const gain = 2 * 12 * 3600 * OFFLINE_EFFICIENCY
    // Seeded so the gap's income tips the credits term over level 2, and no further.
    state.lifetimeCredits = creditsForXp(xpForLevel(2)) - gain
    const r = applyOffline(state, derivedWith({ cps: 2, offlineCapHours: 12 }), catalog, now)
    expect(r.elapsedSec).toBe(48 * 3600)
    expect(r.gain).toBe(gain)
    expect(r.events[0]).toEqual({ type: 'offline', gain, elapsedSec: 48 * 3600 })
    // The credits earned in the gap cross level 2; settleLevelUps pays for it on the way out.
    expect(state.stats.levelSeen).toBe(2)
    expect(state.credits).toBe(gain + levelReward(2, 2))
    expect(state.stats.offlineClaims).toBe(1)
    expect(state.meta.lastTickAt).toBe(now)
  })

  it('a clock that went backwards pays nothing and still resyncs lastTickAt', () => {
    const state = stateAt(T0)
    const r = applyOffline(state, derivedWith({ cps: 2 }), catalog, T0 - 5000)
    expect(r).toEqual({ elapsedSec: 0, gain: 0, events: [] })
    expect(state.credits).toBe(0)
    expect(state.meta.lastTickAt).toBe(T0 - 5000)
  })

  it('replays the queue sequentially and settles the resulting posts in full', () => {
    const state = stateAt(T0)
    state.queue = [job('j1', { startedAt: T0 - 5000, endsAt: T0 + 5000 }), job('j2'), job('j3')]
    const now = T0 + 3600_000
    // Seeded so the hour's income plus the three posts tip the credits term over level 2.
    state.lifetimeCredits = creditsForXp(xpForLevel(2)) - (3600 * OFFLINE_EFFICIENCY + 300)
    const r = applyOffline(state, derivedWith({ cps: 1, concurrency: 1 }), catalog, now)

    expect(state.queue).toEqual([])
    expect(state.posts.map((p) => p.id)).toEqual(['post-j3', 'post-j2', 'post-j1'])
    expect(state.posts.map((p) => p.createdAt)).toEqual([T0 + 25_000, T0 + 15_000, T0 + 5_000])
    expect(state.posts.every((p) => p.granted && p.likes === 100)).toBe(true)
    // 1 cps × 3600 s of income at the offline rate + 3 posts × 100 likes × 1 credit, which is
    // enough lifetime credits for level 2, so settleLevelUps pays for it on the way out.
    expect(state.stats.levelSeen).toBe(2)
    expect(state.credits).toBe(3600 * OFFLINE_EFFICIENCY + 300 + levelReward(2, 1))

    const types = r.events.map((e) => e.type)
    expect(types[0]).toBe('offline')
    expect(types.filter((t) => t === 'postCreated')).toHaveLength(3)
    expect(types.filter((t) => t === 'postResolved')).toHaveLength(3)
    expect(types.indexOf('postResolved')).toBeGreaterThan(types.lastIndexOf('postCreated'))
  })

  it('honours concurrency and leaves jobs that end after now running', () => {
    const state = stateAt(T0)
    state.queue = [job('j1'), job('j2'), job('j3')]
    const now = T0 + 12_000
    applyOffline(state, derivedWith({ cps: 0, concurrency: 2 }), catalog, now)

    expect(state.posts.map((p) => p.createdAt)).toEqual([T0 + 10_000, T0 + 10_000])
    expect(state.queue.map((j) => [j.id, j.startedAt, j.endsAt])).toEqual([['j3', T0 + 10_000, T0 + 20_000]])
    // Two seconds into an 8 s window: floor(100 × (1 − 0.75³)) = 57 likes each, not yet granted.
    expect(state.posts.every((p) => p.likes === 57 && !p.granted)).toBe(true)
    expect(state.credits).toBe(114)
  })

  it('finishes a job early by its click bonus', () => {
    const state = stateAt(T0)
    state.queue = [job('j1', { startedAt: T0, endsAt: T0 + 10_000, clickBonusMs: 3000 })]
    applyOffline(state, derivedWith({ cps: 0 }), catalog, T0 + 600_000)
    expect(state.posts[0]!.createdAt).toBe(T0 + 7_000)
  })

  it('replayQueue is a no-op on an empty queue', () => {
    const state = stateAt(T0)
    expect(replayQueue(state, derivedWith(), catalog, T0, T0 + 1000, () => 0.5)).toEqual([])
    expect(state.posts).toEqual([])
  })

  it('credits posts finished while away toward contracts (the tick never sees those events)', () => {
    const wedding = CONTRACTS.find((c) => c.id === 'c-cousin-wedding')!
    const withContracts = createCatalog({ contracts: [wedding] })
    const state = stateAt(T0)
    const derived = derivedWith({ cps: 1, concurrency: 1 })
    state.contracts.active = [acceptContract(wedding, state, derived, T0)]
    state.queue = [job('j1', { startedAt: T0 - 5000, endsAt: T0 + 5000 }), job('j2'), job('j3')]
    const r = applyOffline(state, derived, withContracts, T0 + 3600_000)
    expect(state.contracts.active[0]!.progress).toBe(3)
    // Three more posts would finish it, and the completion is announced in the same batch.
    state.queue = [job('j4'), job('j5')]
    const r2 = applyOffline(state, derived, withContracts, T0 + 7200_000)
    expect(state.contracts.active[0]!.done).toBe(true)
    expect(r2.events.map((e) => e.type)).toContain('contractDone')
    expect(r.events.map((e) => e.type)).not.toContain('contractDone')
  })

  it('expires random events as the replay passes their end, before later jobs finish', () => {
    const founder = EVENT_DEFS.find((e) => e.kind === 'founderRepost')!
    const withEvents = createCatalog({ events: [founder] })
    const state = stateAt(T0)
    state.events.active = [{ defId: founder.id, kind: 'founderRepost', startedAt: T0 - 50_000, endsAt: T0 + 10_000 }]
    state.queue = [job('j1', { startedAt: T0 - 5000, endsAt: T0 + 5000 }), job('j2'), job('j3')]
    const r = applyOffline(state, derivedWith({ cps: 0 }), withEvents, T0 + 3600_000)
    const types = r.events.map((e) => e.type)
    const end = types.indexOf('eventEnd')
    expect(end).toBeGreaterThan(-1)
    // j1 (T0 + 5 s) still rides the window; j2 (T0 + 15 s) and j3 finish after it closed.
    expect(end).toBeGreaterThan(types.indexOf('postCreated'))
    expect(end).toBeLessThan(types.lastIndexOf('postCreated'))
    expect(state.events.active).toEqual([])
  })

  it('announces a trending-week rollover that happened while away, exactly once', () => {
    const withTags = createCatalog({ hashtags: HASHTAGS })
    const boundary = Math.ceil(T0 / WEEK_MS) * WEEK_MS
    const state = stateAt(boundary - 1000)
    const derived = derivedWith({ cps: 1 })
    const now = boundary + 1000
    const r = applyOffline(state, derived, withTags, now)
    const rollovers = r.events.filter((e) => e.type === 'weekRollover')
    expect(rollovers).toEqual([{ type: 'weekRollover', tags: currentTrending(state, now, withTags, 1) }])
    // The next tick has been primed and stays quiet about the same rollover.
    const next = tick(state, derived, withTags, 0.05, now + 50, mulberry32(1))
    expect(next.filter((e) => e.type === 'weekRollover')).toEqual([])
    // A gap inside one week announces nothing.
    const same = stateAt(boundary + 5000)
    expect(applyOffline(same, derived, withTags, boundary + 9000).events.filter((e) => e.type === 'weekRollover')).toEqual([])
    // The demo override pins the week: no rollover however long the gap.
    const pinned = stateAt(boundary - 1000)
    pinned.weekOverride = 4
    expect(applyOffline(pinned, derived, withTags, boundary + WEEK_MS * 3).events.filter((e) => e.type === 'weekRollover')).toEqual([])
  })

  it('grants achievements reached offline with the welcome-back card', () => {
    const sleep = ACHIEVEMENTS.find((a) => a.id === 'offline-first')!
    const withAchievements = createCatalog({ achievements: [sleep] })
    const state = stateAt(T0)
    const r = applyOffline(state, derivedWith({ cps: 1 }), withAchievements, T0 + 3600_000)
    expect(r.events).toContainEqual({ type: 'achievement', id: 'offline-first', reward: 0 })
    expect(state.achievements).toEqual(['offline-first'])
  })
})
