import { describe, expect, it } from 'vitest'
import { CATALOG, createCatalog } from '@/data'
import { CONTRACTS } from '@/data/contracts'
import { EVENT_DEFS } from '@/data/events'
import { HASHTAGS } from '@/data/hashtags'
import { MAP_NODES } from '@/data/mapNodes'
import { checkAchievements } from '@/game/achievements'
import {
  CONTRACT_ROTATE_MS,
  CONTRACT_SLOTS,
  DAILY_BASE_SECS,
  DAILY_MIN_CREDITS,
  EVENT_MAX_GAP_MS,
  EVENT_MIN_GAP_MS,
  POWER_BUDGET_BASE,
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_REBRAND,
} from '@/game/constants'
import {
  acceptContract,
  claimContract,
  CONTRACT_REFILL_RETRY_MS,
  contractExpiresAt,
  contractsDue,
  MIN_CONTRACT_REWARD,
  progressContracts,
  quantizedCount,
  rotateContracts,
} from '@/game/contracts'
import { canClaim, claimDaily, cycleDay, dayKey, daysBetween, effectiveStreak } from '@/game/daily'
import {
  eventEffects,
  eventLikesBoost,
  expireEvents,
  FIXED_NODE_FLAG,
  maybeStartEvent,
  resolveEvent,
  SPARK_CAUGHT_FLAG,
  SPARK_FLAG,
} from '@/game/events'
import { dailyXp } from '@/game/level'
import { canRebrand, creditsForCp, rebrand, rebrandCp } from '@/game/prestige'
import { mulberry32 } from '@/game/rng'
import { createInitialState } from '@/game/state'
import type { ActiveEvent, ContractDef, Derived, GameEvent, GameState, Job, Post } from '@/game/types'

const T0 = Date.UTC(2026, 8, 13, 12, 0, 0)
const DAY = 86_400_000

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return {
    cps: 0,
    rawCps: 0,
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
    offlineEfficiency: 0.5,
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

const fresh = (now = T0): GameState => createInitialState(now, 'guest-test')
const claimAt = (state: GameState, idx: number): void => {
  const c = state.contracts.active[idx]!
  c.done = true
  c.progress = c.target
  claimContract(state, idx, CATALOG)
}
const def = (id: string): ContractDef => {
  const d = CONTRACTS.find((c) => c.id === id)
  if (!d) throw new Error(`no contract ${id}`)
  return d
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: `post-${Math.random().toString(36).slice(2)}`,
    createdAt: T0,
    modelId: 'sd15',
    kind: 'image',
    precision: 'native',
    prompt: 'a cat',
    tags: [],
    matchedTrending: [],
    thumb: 'model-sd15',
    cost: 10,
    targetLikes: 100,
    likes: 100,
    creditsPerLike: 1,
    creditsPaid: 100,
    windowMs: 8000,
    viral: false,
    flop: false,
    founderBoost: false,
    followersGained: 0,
    granted: true,
    roll: 1,
    trendMult: 1,
    ...overrides,
  }
}

function makeJob(): Job {
  return {
    id: 'job-1',
    modelId: 'sd15',
    precision: 'native',
    prompt: 'x',
    tags: [],
    hardwareId: 'pc-4c8t',
    cost: 10,
    durationMs: 5000,
    createdAt: T0,
    startedAt: null,
    endsAt: null,
    clickBonusMs: 0,
  }
}

const activeOf = (kind: ActiveEvent['kind'], payload?: string, now = T0): ActiveEvent => {
  const d = EVENT_DEFS.find((e) => e.kind === kind)
  if (!d) throw new Error(`no event of kind ${kind}`)
  const e: ActiveEvent = { defId: d.id, kind, startedAt: now, endsAt: now + d.durationSec * 1000 }
  if (payload) e.payload = payload
  return e
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
describe('contracts: rotation', () => {
  it('fills every slot with distinct, tier-eligible contracts priced at rewardSecs × cps', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 2, bestTier: 1 })
    expect(contractsDue(state, T0)).toBe(true)
    const events = rotateContracts(state, derived, CATALOG, T0, mulberry32(1))
    expect(events).toEqual([])
    const active = state.contracts.active
    expect(active).toHaveLength(CONTRACT_SLOTS)
    expect(new Set(active.map((c) => c.defId)).size).toBe(CONTRACT_SLOTS)
    for (const c of active) {
      const d = def(c.defId)
      expect(d.minTier).toBeLessThanOrEqual(1)
      expect(c.rewardCredits).toBe(Math.max(MIN_CONTRACT_REWARD, Math.round(d.rewardSecs * 2)))
      expect(c.acceptedAt).toBe(T0)
      expect(c.done).toBe(false)
      expect(c.claimed).toBe(false)
    }
    expect(state.contracts.nextRotateAt).toBe(T0 + CONTRACT_ROTATE_MS)
    expect(contractsDue(state, T0 + 1)).toBe(false)
  })

  it('floors the credit reward at MIN_CONTRACT_REWARD when income is tiny', () => {
    const state = fresh()
    rotateContracts(state, derivedWith({ cps: 0.01 }), CATALOG, T0, mulberry32(2))
    for (const c of state.contracts.active) expect(c.rewardCredits).toBe(MIN_CONTRACT_REWARD)
  })

  it('leaves the slots alone before the timer and swaps only unfinished ones at rotation', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 1, bestTier: 12 })
    const rng = mulberry32(3)
    rotateContracts(state, derived, CATALOG, T0, rng)
    const before = state.contracts.active.map((c) => ({ ...c }))
    rotateContracts(state, derived, CATALOG, T0 + CONTRACT_ROTATE_MS - 1, rng)
    expect(state.contracts.active).toEqual(before)

    const kept = state.contracts.active[0]!
    kept.done = true
    kept.progress = kept.target
    const later = T0 + CONTRACT_ROTATE_MS
    rotateContracts(state, derived, CATALOG, later, rng)
    expect(state.contracts.active).toHaveLength(CONTRACT_SLOTS)
    expect(state.contracts.active[0]).toEqual(kept)
    for (const c of state.contracts.active.slice(1)) expect(c.acceptedAt).toBe(later)
    expect(state.contracts.nextRotateAt).toBe(later + CONTRACT_ROTATE_MS)
  })

  it('never rolls an absolute goal the player already meets', () => {
    for (let seed = 0; seed < 60; seed++) {
      const state = fresh()
      state.hardware['rtx-3060'] = 5
      state.models['flux-dev'] = { precisions: ['native', 'fp8', 'q4'], setup: true }
      rotateContracts(state, derivedWith({ bestTier: 3 }), CATALOG, T0, mulberry32(seed))
      const ids = state.contracts.active.map((c) => c.defId)
      expect(ids).not.toContain('c-cousin-3060s')
      expect(ids).not.toContain('c-devrel-quants')
    }
  })

  it('refills a slot freed by a claim on the next rotation call', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 1 })
    rotateContracts(state, derived, CATALOG, T0, mulberry32(4))
    const c = state.contracts.active[1]!
    c.done = true
    claimContract(state, 1, CATALOG)
    expect(state.contracts.active).toHaveLength(CONTRACT_SLOTS - 1)
    expect(state.contracts.nextRotateAt).toBe(0)
    expect(contractsDue(state, T0 + 5)).toBe(true)
    rotateContracts(state, derived, CATALOG, T0 + 5, mulberry32(5))
    expect(state.contracts.active).toHaveLength(CONTRACT_SLOTS)
    expect(state.contracts.active.filter((x) => x.acceptedAt === T0 + 5)).toHaveLength(1)
    expect(state.contracts.nextRotateAt).toBe(T0 + CONTRACT_ROTATE_MS)
  })

  it('expires each contract on its own clock and exposes the deadline', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 1 })
    rotateContracts(state, derived, CATALOG, T0, mulberry32(8))
    const first = state.contracts.active[0]!
    claimAt(state, 0)
    const t1 = T0 + 60_000
    rotateContracts(state, derived, CATALOG, t1, mulberry32(9))
    const late = state.contracts.active.find((c) => c.acceptedAt === t1)!
    expect(contractExpiresAt(late)).toBe(t1 + CONTRACT_ROTATE_MS)
    expect(state.contracts.nextRotateAt).toBe(T0 + CONTRACT_ROTATE_MS)

    rotateContracts(state, derived, CATALOG, T0 + CONTRACT_ROTATE_MS, mulberry32(10))
    expect(state.contracts.active.map((c) => c.acceptedAt)).toContain(t1)
    expect(state.contracts.active.some((c) => c.acceptedAt === T0)).toBe(false)
    expect(state.contracts.nextRotateAt).toBe(t1 + CONTRACT_ROTATE_MS)
    expect(first.claimed).toBe(true)
  })

  it('retries soon when no eligible contract can fill a slot', () => {
    const catalog = createCatalog({ ...CATALOG, contracts: [def('c-cousin-wedding')] })
    const state = fresh()
    rotateContracts(state, derivedWith({ cps: 1 }), catalog, T0, mulberry32(1))
    expect(state.contracts.active).toHaveLength(1)
    expect(state.contracts.nextRotateAt).toBe(T0 + CONTRACT_REFILL_RETRY_MS)
    state.hardware['rtx-3060'] = 1
    rotateContracts(state, derivedWith({ cps: 1 }), createCatalog({ ...CATALOG, contracts: [] }), T0 + 1, mulberry32(1))
    expect(state.contracts.active).toHaveLength(1)
  })
})

describe('contracts: progress', () => {
  const clicks = (n: number): GameEvent[] => Array.from({ length: n }, () => ({ type: 'click', value: 1, combo: 1, mult: 1 }))

  it('counts clicks from events and completes exactly once', () => {
    const state = fresh()
    state.contracts.active = [acceptContract(def('c-cousin-clicks'), state, derivedWith({ cps: 1 }), T0)]
    expect(progressContracts(state, clicks(199), CATALOG)).toEqual([])
    expect(state.contracts.active[0]!.progress).toBe(199)
    expect(progressContracts(state, clicks(5), CATALOG)).toEqual([{ type: 'contractDone', defId: 'c-cousin-clicks' }])
    const c = state.contracts.active[0]!
    expect(c.done).toBe(true)
    expect(c.progress).toBe(c.target)
    expect(progressContracts(state, clicks(5), CATALOG)).toEqual([])
    expect(c.progress).toBe(c.target)
  })

  it('counts posts by kind and by tag (selected, trending, literal #tag, keyword)', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 1 })
    state.contracts.active = [
      acceptContract(def('c-vtuber-clips'), state, derived, T0),
      acceptContract(def('c-devrel-wan-week'), state, derived, T0),
      acceptContract(def('c-cousin-wedding'), state, derived, T0),
    ]
    const wanKeyword = HASHTAGS.find((h) => h.id === 'wan22')!.keywords[0]!
    const posts = [
      makePost({ id: 'v1', kind: 'video' }),
      makePost({ id: 'v2', kind: 'video', tags: ['wan22'] }),
      makePost({ id: 'i1', kind: 'image', matchedTrending: ['wan22'] }),
      makePost({ id: 'i2', kind: 'image', prompt: 'noodles #WAN22 at dawn' }),
      makePost({ id: 'i3', kind: 'image', prompt: `render with ${wanKeyword} tonight` }),
      makePost({ id: 'i4', kind: 'image', prompt: 'wan22x is not the tag' }),
    ]
    state.posts = posts
    const events: GameEvent[] = posts.map((p) => ({ type: 'postCreated', postId: p.id }))
    progressContracts(state, events, CATALOG)
    const [videos, wan, any] = state.contracts.active
    expect(videos!.progress).toBe(2)
    expect(wan!.progress).toBe(4)
    expect(any!.progress).toBe(5)
    expect(any!.done).toBe(true)
  })

  it('counts likes, followers and virals when posts resolve', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 1 })
    state.contracts.active = [
      acceptContract(def('c-cousin-likes'), state, derived, T0),
      acceptContract(def('c-mods-followers'), state, derived, T0),
      acceptContract(def('c-buck-viral'), state, derived, T0),
    ]
    state.posts = [
      makePost({ id: 'a', likes: 300, followersGained: 40 }),
      makePost({ id: 'b', likes: 300, followersGained: 70, viral: true }),
    ]
    const events = progressContracts(
      state,
      [
        { type: 'postResolved', postId: 'a', viral: false, flop: false, ratioed: false },
        { type: 'postResolved', postId: 'b', viral: true, flop: false, ratioed: false },
      ],
      CATALOG,
    )
    const [likes, followers, virals] = state.contracts.active
    expect(likes!.progress).toBe(500)
    expect(likes!.done).toBe(true)
    expect(followers!.progress).toBe(100)
    expect(followers!.done).toBe(true)
    expect(virals!.done).toBe(true)
    expect(events.map((e) => e.type)).toEqual(['contractDone', 'contractDone', 'contractDone'])
  })

  it('reads ownHardware and quantize goals from the live state', () => {
    const state = fresh()
    state.hardware['rtx-3060'] = 2
    state.contracts.active = [
      acceptContract(def('c-cousin-3060s'), state, derivedWith(), T0),
      acceptContract(def('c-devrel-quants'), state, derivedWith(), T0),
    ]
    expect(state.contracts.active[0]!.progress).toBe(2)
    expect(progressContracts(state, [], CATALOG)).toEqual([])
    state.hardware['rtx-3060'] = 3
    state.models['flux-dev'] = { precisions: ['native', 'fp8'], setup: true }
    state.models['sdxl'] = { precisions: ['native', 'q4'], setup: false }
    expect(quantizedCount(state)).toBe(2)
    const events = progressContracts(state, [], CATALOG)
    expect(events).toHaveLength(2)
    expect(state.contracts.active.every((c) => c.done)).toBe(true)
  })
})

describe('contracts: claim', () => {
  it('pays credits plus RP/CP, bumps contractsDone and frees the slot', () => {
    const state = fresh()
    const c = acceptContract(def('c-mods-showcase'), state, derivedWith({ cps: 10 }), T0)
    c.done = true
    c.progress = c.target
    state.contracts.active = [c]
    // The completion was announced by progressContracts; the claim answers with the XP it banked.
    expect(claimContract(state, 0, CATALOG)).toEqual([{ type: 'xp', amount: XP_CONTRACT, source: 'contract' }])
    expect(state.stats.xpBy.contract).toBe(XP_CONTRACT)
    expect(state.credits).toBe(4200)
    expect(state.lifetimeCredits).toBe(4200)
    expect(state.seasonCredits).toBe(4200)
    expect(state.rp).toBe(1)
    expect(state.cp).toBe(0)
    expect(state.stats.contractsDone).toBe(1)
    expect(state.contracts.active).toEqual([])
  })

  it('pays CP rewards', () => {
    const state = fresh()
    const c = acceptContract(def('c-netflix-p5'), state, derivedWith({ cps: 1000 }), T0)
    c.done = true
    state.contracts.active = [c]
    claimContract(state, 0, CATALOG)
    expect(state.cp).toBe(1)
    expect(state.credits).toBe(3_600_000)
  })

  it('refuses unfinished, claimed or missing contracts', () => {
    const state = fresh()
    const c = acceptContract(def('c-cousin-wedding'), state, derivedWith({ cps: 1 }), T0)
    state.contracts.active = [c]
    expect(claimContract(state, 0, CATALOG)).toEqual([])
    expect(claimContract(state, 3, CATALOG)).toEqual([])
    expect(state.credits).toBe(0)
    expect(state.stats.contractsDone).toBe(0)
    c.done = true
    claimContract(state, 0, CATALOG)
    expect(state.credits).toBe(300)
    expect(claimContract(state, 0, CATALOG)).toEqual([])
    expect(state.credits).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
describe('events: lifecycle', () => {
  it('waits for nextAt, then starts a tier-eligible event and reschedules inside the gap window', () => {
    for (let seed = 0; seed < 40; seed++) {
      const state = fresh()
      const derived = derivedWith({ bestTier: 1 })
      const rng = mulberry32(seed)
      expect(state.events.nextAt).toBe(T0 + EVENT_MIN_GAP_MS)
      expect(maybeStartEvent(state, derived, CATALOG, state.events.nextAt - 1, rng)).toEqual([])
      expect(state.events.active).toEqual([])

      const start = state.events.nextAt
      const events = maybeStartEvent(state, derived, CATALOG, start, rng)
      expect(events).toHaveLength(1)
      const e = state.events.active[0]!
      const d = EVENT_DEFS.find((x) => x.id === e.defId)!
      expect(events[0]).toEqual({ type: 'eventStart', defId: d.id, kind: d.kind })
      expect(d.minTier).toBeLessThanOrEqual(1)
      expect(e.startedAt).toBe(start)
      expect(e.endsAt).toBe(start + d.durationSec * 1000)
      expect(state.events.nextAt - start).toBeGreaterThanOrEqual(EVENT_MIN_GAP_MS)
      expect(state.events.nextAt - start).toBeLessThanOrEqual(EVENT_MAX_GAP_MS)

      expect(expireEvents(state, e.endsAt - 1)).toEqual([])
      expect(state.events.active).toHaveLength(1)
      expect(expireEvents(state, e.endsAt)).toEqual([{ type: 'eventEnd', defId: d.id, kind: d.kind }])
      expect(state.events.active).toEqual([])
    }
  })

  it('never stacks a running kind and retries after the minimum gap when nothing is eligible', () => {
    const state = fresh()
    const derived = derivedWith({ bestTier: 1 })
    const rng = mulberry32(7)
    // Tier 1 has exactly two kinds available: modelDrop and nodeBroke.
    state.events.nextAt = T0
    maybeStartEvent(state, derived, CATALOG, T0, rng)
    state.events.nextAt = T0 + 1
    maybeStartEvent(state, derived, CATALOG, T0 + 1, rng)
    const kinds = state.events.active.map((e) => e.kind)
    expect(kinds).toHaveLength(2)
    expect(new Set(kinds)).toEqual(new Set(['modelDrop', 'nodeBroke']))
    state.events.nextAt = T0 + 2
    expect(maybeStartEvent(state, derived, CATALOG, T0 + 2, rng)).toEqual([])
    expect(state.events.active).toHaveLength(2)
    expect(state.events.nextAt).toBe(T0 + 2 + EVENT_MIN_GAP_MS)
  })

  it('rolls a spot reclaim only against an owned cloud node', () => {
    const catalog = createCatalog({
      ...CATALOG,
      events: EVENT_DEFS.filter((e) => e.kind === 'spotReclaim'),
    })
    const derived = derivedWith({ bestTier: 12 })
    const state = fresh()
    state.events.nextAt = T0
    expect(maybeStartEvent(state, derived, catalog, T0, mulberry32(1))).toEqual([])
    expect(state.events.active).toEqual([])
    state.hardware['aws-p5'] = 2
    state.events.nextAt = T0
    expect(maybeStartEvent(state, derived, catalog, T0, mulberry32(1))).toHaveLength(1)
    expect(state.events.active[0]!.payload).toBe('aws-p5')
  })

  it('gives a model drop a subject hashtag payload', () => {
    const catalog = createCatalog({ ...CATALOG, events: EVENT_DEFS.filter((e) => e.kind === 'modelDrop') })
    for (let seed = 0; seed < 20; seed++) {
      const state = fresh()
      state.events.nextAt = T0
      maybeStartEvent(state, derivedWith(), catalog, T0, mulberry32(seed))
      const tag = HASHTAGS.find((h) => h.id === state.events.active[0]!.payload)
      expect(tag).toBeDefined()
      expect(tag!.kind).toBeUndefined()
    }
  })
})

describe('events: effects and interaction', () => {
  const reservedNode = MAP_NODES.find((n) => n.effects.some((e) => e.kind === 'reservedCapacity'))!

  it('encodes each kind as the documented Effect', () => {
    const state = fresh()
    state.events.active = [activeOf('modelDrop', 'cats')]
    expect(eventEffects(state, CATALOG)).toEqual([{ kind: 'tagLikes', tag: 'cats', value: 1 }])
    state.events.active = [activeOf('cloudPromo')]
    expect(eventEffects(state, CATALOG)).toEqual([{ kind: 'globalMult', value: 1 }])
    state.events.active = [activeOf('powerSurge')]
    expect(eventEffects(state, CATALOG)).toEqual([{ kind: 'powerBudget', value: -0.4 * POWER_BUDGET_BASE }])
    // A brownout takes 40 % of the rig's *current* budget, PSUs and map nodes included.
    state.upgrades.push('psu-850')
    state.mapNodes.push('infra-undervolt')
    expect(eventEffects(state, CATALOG)).toEqual([{ kind: 'powerBudget', value: -0.4 * (POWER_BUDGET_BASE + 300 + 200) }])
    state.upgrades.length = 0
    state.mapNodes.length = 0
    state.events.active = [activeOf('nodeBroke')]
    expect(eventEffects(state, CATALOG)).toEqual([{ kind: 'globalMult', value: -0.5 }])
    state.events.active = [activeOf('spotReclaim', 'aws-p5')]
    expect(eventEffects(state, CATALOG)).toEqual([{ kind: 'rigMult', hardwareId: 'aws-p5', value: 0 }])
    state.events.active = [activeOf('founderRepost'), activeOf('trendingSpark')]
    expect(eventEffects(state, CATALOG)).toEqual([])
  })

  it('suppresses a spot reclaim when the state owns reserved capacity', () => {
    const state = fresh()
    state.events.active = [activeOf('spotReclaim', 'aws-p5')]
    state.mapNodes.push(reservedNode.id)
    expect(eventEffects(state, CATALOG)).toEqual([])
  })

  it('ignores resolved events', () => {
    const state = fresh()
    state.events.active = [{ ...activeOf('cloudPromo'), resolved: true }]
    expect(eventEffects(state, CATALOG)).toEqual([])
  })

  it('eventLikesBoost: founder window ×3, armed spark ×3 once', () => {
    const state = fresh()
    expect(eventLikesBoost(state)).toBe(1)
    state.events.active = [activeOf('founderRepost')]
    expect(eventLikesBoost(state)).toBe(3)
    state.flags[SPARK_FLAG] = true
    expect(eventLikesBoost(state)).toBe(9)
    expect(state.flags[SPARK_FLAG]).toBeUndefined()
    expect(eventLikesBoost(state)).toBe(3)
  })

  it('resolveEvent fixes a broken node and catches a spark, ending the event immediately', () => {
    const state = fresh()
    const broke = activeOf('nodeBroke')
    const spark = activeOf('trendingSpark')
    const promo = activeOf('cloudPromo')
    state.events.active = [broke, spark, promo]

    expect(resolveEvent(state, broke.defId, T0 + 1000)).toEqual([{ type: 'eventEnd', defId: broke.defId, kind: 'nodeBroke' }])
    expect(state.flags[FIXED_NODE_FLAG]).toBe(true)
    expect(state.events.active.map((e) => e.defId)).toEqual([spark.defId, promo.defId])

    expect(resolveEvent(state, spark.defId, T0 + 2000)).toHaveLength(1)
    expect(state.flags[SPARK_FLAG]).toBe(true)
    expect(state.flags[SPARK_CAUGHT_FLAG]).toBe(true)

    expect(resolveEvent(state, promo.defId, T0 + 3000)).toEqual([])
    expect(resolveEvent(state, 'ev-does-not-exist', T0)).toEqual([])
    expect(state.events.active).toEqual([promo])
  })

  it('cannot catch a spark after its window', () => {
    const state = fresh()
    const spark = activeOf('trendingSpark')
    state.events.active = [spark]
    expect(resolveEvent(state, spark.defId, spark.endsAt + 1)).toEqual([])
    expect(state.flags[SPARK_FLAG]).toBeUndefined()
    expect(expireEvents(state, spark.endsAt + 1)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------
describe('daily', () => {
  it('keys days in UTC and counts whole days between keys', () => {
    expect(dayKey(Date.UTC(2026, 8, 13, 23, 59, 59))).toBe('2026-09-13')
    expect(dayKey(Date.UTC(2026, 8, 14, 0, 0, 0))).toBe('2026-09-14')
    expect(daysBetween('2026-09-13', '2026-09-14')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2)
    expect(daysBetween('2026-09-14', '2026-09-13')).toBe(-1)
  })

  it('cycles days 1..7', () => {
    expect([1, 2, 3, 6, 7, 8, 14, 15].map(cycleDay)).toEqual([1, 2, 3, 6, 7, 1, 7, 1])
  })

  it('pays cps × DAILY_BASE_SECS × day, once per UTC day', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 1 })
    expect(canClaim(state, T0)).toBe(true)
    expect(claimDaily(state, derived, T0)).toEqual([
      { type: 'daily', day: 1, credits: DAILY_BASE_SECS },
      { type: 'xp', amount: dailyXp(1), source: 'daily' },
    ])
    expect(state.credits).toBe(DAILY_BASE_SECS)
    expect(state.daily).toEqual({ lastClaimDay: '2026-09-13', streak: 1, claimed: ['2026-09-13'] })
    expect(canClaim(state, T0 + 3600_000)).toBe(false)
    expect(claimDaily(state, derived, T0 + 3600_000)).toEqual([])
    expect(state.credits).toBe(DAILY_BASE_SECS)

    expect(claimDaily(state, derived, T0 + DAY)).toEqual([
      { type: 'daily', day: 2, credits: 2 * DAILY_BASE_SECS },
      { type: 'xp', amount: dailyXp(2), source: 'daily' },
    ])
    expect(state.daily.streak).toBe(2)
    expect(state.stats.xpBy.daily).toBe(dailyXp(1) + dailyXp(2))
  })

  it('floors the reward at DAILY_MIN_CREDITS', () => {
    const state = fresh()
    expect(claimDaily(state, derivedWith({ cps: 0 }), T0)).toEqual([
      { type: 'daily', day: 1, credits: DAILY_MIN_CREDITS },
      { type: 'xp', amount: dailyXp(1), source: 'daily' },
    ])
  })

  it('grants RP on day 3, CP on day 7 and wraps the cycle on day 8', () => {
    const state = fresh()
    const derived = derivedWith({ cps: 1 })
    for (let d = 0; d < 8; d++) claimDaily(state, derived, T0 + d * DAY)
    expect(state.daily.streak).toBe(8)
    expect(state.rp).toBe(1)
    expect(state.cp).toBe(1)
    expect(state.daily.claimed).toHaveLength(7)
    expect(state.daily.claimed[0]).toBe('2026-09-14')
    const total = DAILY_BASE_SECS * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 1)
    expect(state.credits).toBe(total)
    expect(state.lifetimeCredits).toBe(total)
    expect(state.seasonCredits).toBe(total)
  })

  it('resets the streak after a missed day unless streakGrace covers a single gap', () => {
    const state = fresh()
    claimDaily(state, derivedWith(), T0)
    claimDaily(state, derivedWith(), T0 + DAY)
    expect(effectiveStreak(state, T0 + 3 * DAY)).toBe(0)
    expect(effectiveStreak(state, T0 + 3 * DAY, true)).toBe(2)
    expect(effectiveStreak(state, T0 + 4 * DAY, true)).toBe(0)

    const strict = structuredClone(state)
    claimDaily(strict, derivedWith({ streakGrace: false }), T0 + 3 * DAY)
    expect(strict.daily.streak).toBe(1)

    const graced = structuredClone(state)
    expect(claimDaily(graced, derivedWith({ streakGrace: true }), T0 + 3 * DAY)[0]).toMatchObject({ day: 3 })
    expect(graced.daily.streak).toBe(3)
    expect(graced.rp).toBe(1)

    claimDaily(graced, derivedWith({ streakGrace: true }), T0 + 6 * DAY)
    expect(graced.daily.streak).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Prestige
// ---------------------------------------------------------------------------
describe('prestige', () => {
  it('rebrandCp follows floor((credits / 1e8) ^ 0.45)', () => {
    expect(rebrandCp(0)).toBe(0)
    expect(rebrandCp(5e7)).toBe(0)
    expect(rebrandCp(1e8)).toBe(1)
    expect(rebrandCp(1e10)).toBe(7)
    expect(rebrandCp(1e12)).toBe(63)
    expect(rebrandCp(NaN)).toBe(0)
    expect(creditsForCp(1)).toBe(1e8)
    expect(rebrandCp(creditsForCp(20) * 1.001)).toBe(20)
  })

  it('unlocks once a cloud node or region is owned', () => {
    const state = fresh()
    expect(canRebrand(state, CATALOG)).toBe(false)
    state.hardware['h100-80'] = 8
    expect(canRebrand(state, CATALOG)).toBe(false)
    state.hardware['aws-p5'] = 1
    expect(canRebrand(state, CATALOG)).toBe(true)
    delete state.hardware['aws-p5']
    state.hardware['region-eu-west'] = 1
    expect(canRebrand(state, CATALOG)).toBe(true)
    state.hardware['region-eu-west'] = 0
    expect(canRebrand(state, CATALOG)).toBe(false)
  })

  it('refuses to rebrand without a cloud node', () => {
    const state = fresh()
    state.credits = 123
    state.seasonCredits = 1e10
    expect(rebrand(state, CATALOG, T0)).toEqual([])
    expect(state.credits).toBe(123)
    expect(state.meta.season).toBe(1)
  })

  it('resets the season, keeps the meta-progress and seeds start hardware', () => {
    const state = fresh()
    const reservedNode = MAP_NODES.find((n) => n.effects.some((e) => e.kind === 'reservedCapacity'))!
    Object.assign(state, {
      credits: 5e9,
      seasonCredits: 1e10,
      lifetimeCredits: 2e10,
      hardware: { 'pc-4c8t': 3, 'rtx-4090': 4, 'aws-p5': 1 },
      hardwareTiers: { 'rtx-4090': 2 },
      upgrades: ['better-prompts', 'psu-850', 'tier:rtx-4090:1'],
      models: {
        sd15: { precisions: ['native'], setup: true },
        'flux-dev': { precisions: ['native', 'fp8'], setup: true },
      },
      queue: [makeJob()],
      posts: [makePost()],
      followers: 1234,
      followersFrac: 0.5,
      lifetimeFollowers: 5000,
      lifetimeLikes: 99_999,
      signups: 12,
      rp: 5,
      cp: 2,
      cpSpent: 8,
      hubRep: 3,
      loras: ['cats'],
      mapNodes: ['core-root', 'season-income-1', 'start-with-4090', reservedNode.id],
      achievements: ['first-click', 'own-rtx-4090'],
      flags: { konami: true },
    })
    state.contracts.active = [acceptContract(def('c-cousin-wedding'), state, derivedWith({ cps: 1 }), T0)]
    state.events.active = [activeOf('cloudPromo')]
    state.daily = { lastClaimDay: '2026-09-12', streak: 4, claimed: ['2026-09-12'] }
    state.stats.posts = 40
    state.stats.lastPostKey = 'sd15|cats'

    const now = T0 + 1000
    expect(rebrand(state, CATALOG, now)).toEqual([
      { type: 'rebrand', cp: 7 },
      { type: 'xp', amount: XP_REBRAND, source: 'rebrand' },
    ])

    expect(state.credits).toBe(0)
    expect(state.seasonCredits).toBe(0)
    expect(state.lifetimeCredits).toBe(2e10)
    expect(state.hardware).toEqual({ 'pc-4c8t': 1, 'rtx-4090': 1 })
    expect(state.hardwareTiers).toEqual({})
    expect(state.upgrades).toEqual([])
    expect(state.models).toEqual({ sd15: { precisions: ['native'], setup: true } })
    expect(state.queue).toEqual([])
    expect(state.posts).toEqual([])
    expect(state.followers).toBe(0)
    expect(state.followersFrac).toBe(0)
    expect(state.lifetimeFollowers).toBe(5000)
    expect(state.lifetimeLikes).toBe(99_999)
    expect(state.signups).toBe(12)
    expect(state.contracts).toEqual({ active: [], nextRotateAt: now })
    expect(state.events).toEqual({ active: [], nextAt: now + EVENT_MIN_GAP_MS })
    expect(state.stats.lastPostKey).toBe('')

    expect(state.rp).toBe(5)
    expect(state.cp).toBe(9)
    expect(state.cpSpent).toBe(8)
    expect(state.hubRep).toBe(3)
    expect(state.loras).toEqual(['cats'])
    expect(state.mapNodes).toEqual(['core-root', 'season-income-1', 'start-with-4090', reservedNode.id])
    expect(state.achievements).toEqual(['first-click', 'own-rtx-4090'])
    expect(state.flags).toEqual({ konami: true })
    expect(state.daily.streak).toBe(4)
    expect(state.stats.posts).toBe(40)
    expect(state.meta.season).toBe(2)
    expect(state.stats.rebrands).toBe(1)
    expect(canRebrand(state, CATALOG)).toBe(false)
  })

  it('does not stack start hardware across seasons', () => {
    const state = fresh()
    state.mapNodes = ['core-root', 'season-income-1', 'start-with-4090']
    state.hardware['aws-p5'] = 1
    state.seasonCredits = 1e8
    rebrand(state, CATALOG, T0)
    state.hardware['aws-p5'] = 1
    state.seasonCredits = 1e8
    rebrand(state, CATALOG, T0 + 1)
    expect(state.hardware).toEqual({ 'pc-4c8t': 1, 'rtx-4090': 1 })
    expect(state.meta.season).toBe(3)
    expect(state.cp).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
describe('achievements', () => {
  it('grants nothing on a fresh save and each achievement exactly once', () => {
    const state = fresh()
    expect(checkAchievements(state, derivedWith(), CATALOG)).toEqual([])
    state.totalClicks = 1
    expect(checkAchievements(state, derivedWith(), CATALOG)).toEqual([
      { type: 'achievement', id: 'first-click', reward: 0 },
      { type: 'xp', amount: XP_ACHIEVEMENT, source: 'achievement' },
    ])
    expect(checkAchievements(state, derivedWith(), CATALOG)).toEqual([])
    expect(state.achievements).toEqual(['first-click'])
    expect(state.stats.xpBy.achievement).toBe(XP_ACHIEVEMENT)
  })

  it('reads cps and flags through the unlock predicate', () => {
    const state = fresh()
    state.flags.konami = true
    const ids = checkAchievements(state, derivedWith({ cps: 10 }), CATALOG).flatMap((e) => (e.type === 'achievement' ? [e.id] : []))
    expect(ids).toEqual(['cps-10', 'konami'])
  })

  it('cascades count-based achievements within one call', () => {
    const catalog = createCatalog({
      achievements: [
        { id: 'c', name: 'C', desc: '', icon: 'x', cond: { type: 'stat', key: 'achievements', value: 2 } },
        { id: 'a', name: 'A', desc: '', icon: 'x', cond: { type: 'stat', key: 'clicks', value: 1 } },
        { id: 'b', name: 'B', desc: '', icon: 'x', cond: { type: 'stat', key: 'achievements', value: 1 } },
      ],
    })
    const state = fresh()
    state.totalClicks = 1
    const events = checkAchievements(state, derivedWith(), catalog)
    const ids = events.flatMap((e) => (e.type === 'achievement' ? [e.id] : []))
    expect(ids).toEqual(['a', 'b', 'c'])
    // Each grant is followed by its own XP, inside the pass that granted it.
    expect(events.map((e) => e.type)).toEqual(['achievement', 'xp', 'achievement', 'xp', 'achievement', 'xp'])
    expect(state.stats.xpBy.achievement).toBe(3 * XP_ACHIEVEMENT)
    expect(checkAchievements(state, derivedWith(), catalog)).toEqual([])
  })
})
