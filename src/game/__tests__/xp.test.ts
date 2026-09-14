/**
 * Every way the activity ledger moves, through the real actions and engine functions: one grant
 * per source, the `xp` event right behind the event that earned it, the ledger row it landed in,
 * and the two things that must never pay (a click, the Lounge).
 */
import { describe, expect, it } from 'vitest'

import { CATALOG, createCatalog, type Catalog } from '@/data'
import { HARDWARE } from '@/data/hardware'
import { MODELS } from '@/data/models'
import {
  type ActionContext,
  buyHardware,
  buyUpgrade,
  claimContract,
  claimDaily,
  click,
  flip,
  grantGift,
  quantize,
  rebrand,
  setupModel,
  spin,
  trainLora,
  unlockMapNode,
} from '@/game/actions'
import { checkAchievements } from '@/game/achievements'
import { buildIndex } from '@/game/catalog'
import {
  LOUNGE_MIN_LEVEL,
  TIER_UPGRADE_THRESHOLDS,
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_DAILY_PER_DAY,
  XP_HARDWARE_FIRST,
  XP_LORA,
  XP_MAP_NODE,
  XP_MILESTONE,
  XP_QUANTIZE,
  XP_REBRAND,
  XP_SETUP,
  XP_TIER,
  XP_UPGRADE,
} from '@/game/constants'
import { acceptContract } from '@/game/contracts'
import { DAILY_CYCLE_DAYS, dayKey } from '@/game/daily'
import { computeDerived, createEmptyDerived } from '@/game/derived'
import { resetTickMemo, tick } from '@/game/engine'
import { activityXp, dailyXp, postXp } from '@/game/level'
import { mulberry32 } from '@/game/rng'
import { createInitialState } from '@/game/state'
import { settlePosts } from '@/game/virality'
import { claimDailyFromServer } from '@/state/cloudActions'
import type { ContractDef, Derived, GameEvent, GameState, ModelDef, Post } from '@/game/types'

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)
const DAY = 86_400_000
const { modelById } = buildIndex(CATALOG)

/** Real ladder and models, nothing that fires on its own, so a tick says only what we asked it. */
const QUIET: Catalog = createCatalog({ hardware: HARDWARE, models: MODELS })

const model = (id: string): ModelDef => modelById[id] as ModelDef
const contractDef = (id: string): ContractDef => CATALOG.contracts.find((c) => c.id === id) as ContractDef

/** A state with money in the bank and nothing else changed. */
function richState(credits = 1_000_000): GameState {
  const state = createInitialState(T0, 'guest')
  state.credits = credits
  return state
}

function ctxFor(state: GameState, over: Partial<ActionContext> = {}): ActionContext {
  return {
    state,
    derived: over.derived ?? computeDerived(state, CATALOG),
    catalog: over.catalog ?? CATALOG,
    now: over.now ?? T0,
    rng: over.rng ?? (() => 0.5),
  }
}

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

const xpEvents = (events: GameEvent[]) => events.filter((e) => e.type === 'xp')
const types = (events: GameEvent[]) => events.map((e) => e.type)

function makePost(over: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    createdAt: T0 - 10_000,
    modelId: 'sd15',
    kind: 'image',
    precision: 'native',
    prompt: 'a cat',
    tags: [],
    matchedTrending: [],
    thumb: 'cat',
    cost: 10,
    targetLikes: 10,
    likes: 0,
    creditsPerLike: 1,
    creditsPaid: 0,
    windowMs: 8_000,
    viral: false,
    flop: false,
    founderBoost: false,
    followersGained: 0,
    granted: false,
    roll: 1,
    trendMult: 1,
    ...over,
  }
}

describe('the store', () => {
  it('buyHardware pays for the first unit of a kind, once, whatever the count', () => {
    const state = richState()
    const first = buyHardware(ctxFor(state), 'pc-8c16t')
    expect(first.events).toEqual([
      { type: 'purchase', hardwareId: 'pc-8c16t', count: 1 },
      { type: 'xp', amount: XP_HARDWARE_FIRST, source: 'hardware' },
    ])
    expect(state.stats.xpBy.hardware).toBe(XP_HARDWARE_FIRST)

    // More of the same kind pays nothing.
    const more = buyHardware(ctxFor(state), 'pc-8c16t', 10)
    expect(more.error).toBeUndefined()
    expect(xpEvents(more.events)).toEqual([])
    // The office PC was owned from the start, so it is never a first unit.
    expect(xpEvents(buyHardware(ctxFor(state), 'pc-4c8t').events)).toEqual([])
    expect(state.stats.xpBy.hardware).toBe(XP_HARDWARE_FIRST)

    // Ten at once of a new kind is still one first unit.
    state.stats.levelSeen = 2
    const bulk = buyHardware(ctxFor(state), 'rtx-3060', 10)
    expect(bulk.error).toBeUndefined()
    expect(xpEvents(bulk.events)).toEqual([{ type: 'xp', amount: XP_HARDWARE_FIRST, source: 'hardware' }])
    expect(state.stats.xpBy.hardware).toBe(2 * XP_HARDWARE_FIRST)
  })

  it('buyHardware refused by the level pays nothing', () => {
    const state = richState()
    state.hardware['pc-8c16t'] = 1
    const refused = buyHardware(ctxFor(state), 'rtx-3060')
    expect(refused.error).toBe('Needs level 2 · you are level 1')
    expect(refused.events).toEqual([])
    expect(state.stats.xpBy).toEqual({})
  })

  it('buyUpgrade pays XP_UPGRADE for a named upgrade and XP_TIER for a tier', () => {
    const state = richState()
    state.totalClicks = 10
    expect(buyUpgrade(ctxFor(state), 'better-prompts').events).toEqual([
      { type: 'upgrade', id: 'better-prompts' },
      { type: 'xp', amount: XP_UPGRADE, source: 'upgrade' },
    ])
    state.hardware['pc-4c8t'] = TIER_UPGRADE_THRESHOLDS[0]
    expect(buyUpgrade(ctxFor(state), 'tier:pc-4c8t:1').events).toEqual([
      { type: 'upgrade', id: 'tier:pc-4c8t:1' },
      { type: 'xp', amount: XP_TIER, source: 'tier' },
    ])
    expect(state.stats.xpBy).toEqual({ upgrade: XP_UPGRADE, tier: XP_TIER })
  })

  it('setupModel pays XP_SETUP, and a refused setup nothing', () => {
    const state = richState()
    expect(setupModel(ctxFor(state), 'sdxl').error).toBe('Needs level 2 · you are level 1')
    expect(state.stats.xpBy).toEqual({})
    state.stats.levelSeen = 2
    expect(setupModel(ctxFor(state), 'sdxl').events).toEqual([{ type: 'xp', amount: XP_SETUP, source: 'setup' }])
    expect(state.stats.xpBy.setup).toBe(XP_SETUP)
  })

  it('quantize pays XP_QUANTIZE per new tier only', () => {
    const state = richState()
    state.models['sdxl'] = { precisions: ['native'], setup: true }
    state.mapNodes.push('quant-fp8', 'quant-q4')
    expect(quantize(ctxFor(state), 'sdxl', 'fp8').events).toEqual([{ type: 'xp', amount: XP_QUANTIZE, source: 'quantize' }])
    expect(quantize(ctxFor(state), 'sdxl', 'fp8').error).toMatch(/Already/)
    expect(state.stats.xpBy.quantize).toBe(XP_QUANTIZE)
    expect(quantize(ctxFor(state), 'sdxl', 'q4').events).toEqual([{ type: 'xp', amount: XP_QUANTIZE, source: 'quantize' }])
    expect(state.stats.xpBy.quantize).toBe(2 * XP_QUANTIZE)
    expect(state.stats.quantizations).toBe(2)
  })

  it('grantGift pays the first-unit XP for a gifted card', () => {
    const state = richState(0)
    const result = grantGift(ctxFor(state), 'founder')
    expect(types(result.events)).toEqual(['purchase', 'xp', 'reward'])
    expect(result.events[1]).toEqual({ type: 'xp', amount: XP_HARDWARE_FIRST, source: 'hardware' })
    expect(state.stats.xpBy.hardware).toBe(XP_HARDWARE_FIRST)
  })
})

describe('the Graph, LoRAs and contracts', () => {
  it('unlockMapNode pays XP_MAP_NODE', () => {
    const state = richState()
    expect(unlockMapNode(ctxFor(state), 'core-root').events).toEqual([
      { type: 'mapUnlock', id: 'core-root' },
      { type: 'xp', amount: XP_MAP_NODE, source: 'mapNode' },
    ])
    expect(state.stats.xpBy.mapNode).toBe(XP_MAP_NODE)
  })

  it('trainLora pays XP_LORA', () => {
    const state = richState()
    state.mapNodes.push('lora-training')
    expect(trainLora(ctxFor(state), 'comfyui').events).toEqual([{ type: 'xp', amount: XP_LORA, source: 'lora' }])
    expect(state.stats.xpBy.lora).toBe(XP_LORA)
  })

  it('claimContract pays XP_CONTRACT and answers with that event alone', () => {
    const state = richState(0)
    const derived = computeDerived(state, CATALOG)
    const c = acceptContract(contractDef('c-cousin-wedding'), state, derived, T0)
    c.done = true
    c.progress = c.target
    state.contracts.active = [c]
    const result = claimContract(ctxFor(state, { derived }), 0)
    expect(result.error).toBeUndefined()
    expect(result.events).toEqual([{ type: 'xp', amount: XP_CONTRACT, source: 'contract' }])
    expect(state.stats.xpBy.contract).toBe(XP_CONTRACT)
    expect(state.stats.contractsDone).toBe(1)
    // The claim is gone, so a second one grants nothing.
    expect(claimContract(ctxFor(state, { derived }), 0).error).toBeDefined()
    expect(state.stats.xpBy.contract).toBe(XP_CONTRACT)
  })
})

describe('the daily', () => {
  it('claimDaily pays by cycle day: day 1 and day 7', () => {
    const state = richState()
    const first = claimDaily(ctxFor(state))
    expect(first.error).toBeUndefined()
    expect(types(first.events)).toEqual(['daily', 'xp'])
    expect(first.events[1]).toEqual({ type: 'xp', amount: XP_DAILY_PER_DAY, source: 'daily' })
    expect(state.stats.xpBy.daily).toBe(dailyXp(1))

    // Six claims in, the seventh is the streak's payday.
    const later = richState()
    later.daily = { lastClaimDay: dayKey(T0 - DAY), streak: DAILY_CYCLE_DAYS - 1, claimed: [] }
    const seventh = claimDaily(ctxFor(later))
    expect(seventh.events[0]).toMatchObject({ type: 'daily', day: DAILY_CYCLE_DAYS })
    expect(seventh.events[1]).toEqual({ type: 'xp', amount: DAILY_CYCLE_DAYS * XP_DAILY_PER_DAY, source: 'daily' })
    expect(later.stats.xpBy.daily).toBe(dailyXp(DAILY_CYCLE_DAYS))
  })

  it('claimDailyFromServer pays the same XP on the server streak', () => {
    const state = richState()
    const result = claimDailyFromServer(ctxFor(state), { day: dayKey(T0), streak: DAILY_CYCLE_DAYS })
    expect(result.error).toBeUndefined()
    expect(types(result.events)).toEqual(['daily', 'xp'])
    expect(result.events[1]).toEqual({ type: 'xp', amount: dailyXp(DAILY_CYCLE_DAYS), source: 'daily' })
    expect(state.stats.xpBy.daily).toBe(dailyXp(DAILY_CYCLE_DAYS))
    // Already claimed: nothing more.
    expect(claimDailyFromServer(ctxFor(state), { day: dayKey(T0), streak: 8 }).error).toBeDefined()
    expect(state.stats.xpBy.daily).toBe(dailyXp(DAILY_CYCLE_DAYS))
  })
})

describe('the season', () => {
  it('rebrand pays XP_REBRAND and the ledger survives the reset', () => {
    const state = richState()
    state.hardware['aws-p5'] = 1
    state.seasonCredits = 1e8
    state.stats.xpBy = { post: 21 }
    const result = rebrand(ctxFor(state))
    expect(result.error).toBeUndefined()
    expect(types(result.events)).toEqual(['rebrand', 'xp'])
    expect(result.events[1]).toEqual({ type: 'xp', amount: XP_REBRAND, source: 'rebrand' })
    expect(state.stats.xpBy).toEqual({ post: 21, rebrand: XP_REBRAND })
    expect(state.hardware['aws-p5']).toBeUndefined()
  })
})

describe('the engine', () => {
  it('tick pays XP_MILESTONE per crossed power of ten, right behind the milestone', () => {
    const state = createInitialState(T0, 'guest')
    resetTickMemo(state)
    const rng = mulberry32(1)
    const events = tick(state, derivedWith({ cps: 10 }), QUIET, 1, T0 + 1_000, rng)
    const at = events.findIndex((e) => e.type === 'milestone')
    expect(events[at]).toEqual({ type: 'milestone', cps: 10 })
    expect(events[at + 1]).toEqual({ type: 'xp', amount: XP_MILESTONE, source: 'milestone' })
    expect(state.stats.xpBy.milestone).toBe(XP_MILESTONE)

    // Two powers at once pay twice; the same power again pays nothing.
    const again = tick(state, derivedWith({ cps: 1_000 }), QUIET, 1, T0 + 2_000, rng)
    expect(again.filter((e) => e.type === 'milestone')).toHaveLength(2)
    expect(xpEvents(again).filter((e) => e.type === 'xp' && e.source === 'milestone')).toHaveLength(2)
    expect(state.stats.xpBy.milestone).toBe(3 * XP_MILESTONE)
    const quiet = tick(state, derivedWith({ cps: 1_000 }), QUIET, 1, T0 + 3_000, rng)
    expect(quiet.filter((e) => e.type === 'milestone')).toEqual([])
    expect(state.stats.xpBy.milestone).toBe(3 * XP_MILESTONE)
  })

  it('checkAchievements pays XP_ACHIEVEMENT right behind each grant', () => {
    const state = richState(0)
    state.totalClicks = 1
    const events = checkAchievements(state, computeDerived(state, CATALOG), CATALOG)
    expect(events).toEqual([
      { type: 'achievement', id: 'first-click', reward: 0 },
      { type: 'xp', amount: XP_ACHIEVEMENT, source: 'achievement' },
    ])
    expect(state.stats.xpBy.achievement).toBe(XP_ACHIEVEMENT)
    expect(checkAchievements(state, computeDerived(state, CATALOG), CATALOG)).toEqual([])
    expect(state.stats.xpBy.achievement).toBe(XP_ACHIEVEMENT)
  })

  it('settlePosts pays a landed post once, a viral one double, a ratioed one nothing', () => {
    const state = richState()
    const derived = computeDerived(state, CATALOG)
    state.posts = [
      makePost({ id: 'plain' }),
      makePost({ id: 'big', modelId: 'flux-dev', viral: true }),
      makePost({ id: 'ratio', ratioed: true, flop: true, mismatchedTags: ['videogen'] }),
    ]
    const events = settlePosts(state, derived, CATALOG, T0)
    const resolved = events.map((e) => e.type)
    expect(resolved.filter((t) => t === 'postResolved')).toHaveLength(3)
    expect(xpEvents(events)).toEqual([
      { type: 'xp', amount: postXp(model('sd15'), false), source: 'post' },
      { type: 'xp', amount: postXp(model('flux-dev'), true), source: 'viral' },
    ])
    // Each grant follows the post it came from.
    for (let i = 0; i < events.length; i++) {
      if (events[i]?.type === 'xp') expect(events[i - 1]?.type).toBe('postResolved')
    }
    expect(state.stats.xpBy).toEqual({
      post: postXp(model('sd15'), false),
      viral: postXp(model('flux-dev'), true),
    })
    expect(postXp(model('flux-dev'), true)).toBe(2 * postXp(model('flux-dev'), false))

    // Settling again grants nothing: every post is already granted.
    expect(xpEvents(settlePosts(state, derived, CATALOG, T0 + 1_000))).toEqual([])
    expect(activityXp(state)).toBe(postXp(model('sd15'), false) + postXp(model('flux-dev'), true))
  })
})

describe('what never pays', () => {
  it('a click, the wheel and the coin leave the ledger alone', () => {
    const state = richState(10_000)
    state.stats.levelSeen = LOUNGE_MIN_LEVEL
    const clicked = click(ctxFor(state, { rng: () => 1 }))
    expect(types(clicked.events)).toEqual(['click'])
    const spun = spin(ctxFor(state, { rng: () => 0 }), 50)
    expect(spun.error).toBeUndefined()
    expect(types(spun.events)).toEqual(['spin'])
    const flipped = flip(ctxFor(state, { rng: () => 0 }), 50)
    expect(flipped.error).toBeUndefined()
    expect(types(flipped.events)).toEqual(['flip'])
    expect(state.stats.xpBy).toEqual({})
    expect(activityXp(state)).toBe(0)
  })
})
