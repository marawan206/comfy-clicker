/**
 * The actions added when levelling, the seed roulette, the click guard, the welcome gifts, the
 * tutorial flag and the new prompt eggs were wired in. The older actions keep their coverage in
 * `studio.test.ts`, `meta.test.ts` and `engine.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { CATALOG } from '@/data'
import { GIFTS } from '@/data/gifts'
import {
  type ActionContext,
  LUCKY_SEED_FLAG,
  TUTORIAL_FLAG,
  buyHardware,
  buyUpgrade,
  click,
  completeTutorial,
  declineGift,
  grantGift,
  queueJob,
  setFlag,
  flip,
  setupModel,
  spin,
  upscalePost,
} from '@/game/actions'
import { checkAchievements } from '@/game/achievements'
import { buildIndex } from '@/game/catalog'
import { CLICK_GUARD_FLAG, CLICK_RATE_WINDOW_MS } from '@/game/clickGuard'
import { BET_MIN, CLICK_CAP_PER_SEC, LOUNGE_MIN_LEVEL, LUCKY_CLICK_CHANCE, LUCKY_CLICK_MULT } from '@/game/constants'
import { computeDerived } from '@/game/derived'
import { mulberry32 } from '@/game/rng'
import { createInitialState } from '@/game/state'
import {
  BAD_HANDS_FLAG,
  MASTERPIECE_FLAG,
  SD15_FOREVER_FLAG,
  SD15_FOREVER_TIER,
  SPAGHETTI_FLAG,
} from '@/game/studio'
import type { Derived, GameEvent, GameState, GiftKind, Job, ModelDef, Post, Rng } from '@/game/types'

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)
const { modelById } = buildIndex(CATALOG)

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

/** A derived with one field bent, for the cases the catalog cannot reach cheaply. */
function derivedWith(state: GameState, over: Partial<Derived>): Derived {
  return { ...computeDerived(state, CATALOG), ...over }
}

const ids = (events: GameEvent[]): string[] => events.map((e) => e.type)
const eggs = (events: GameEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'easterEgg' ? [e.id] : []))

/** A job that is already running, so a click has something to shave. */
function runningJob(now: number): Job {
  return {
    id: 'job-1',
    modelId: 'sd15',
    precision: 'native',
    prompt: 'a cat',
    tags: [],
    hardwareId: 'pc-4c8t',
    cost: 10,
    durationMs: 60_000,
    createdAt: now,
    startedAt: now,
    endsAt: now + 60_000,
    clickBonusMs: 0,
  }
}

function makePost(over: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    createdAt: T0 - 60_000,
    modelId: 'sd15',
    kind: 'image',
    precision: 'native',
    prompt: 'a cat',
    tags: [],
    matchedTrending: [],
    thumb: 'cat',
    cost: 100,
    targetLikes: 400,
    likes: 400,
    creditsPerLike: 0.5,
    creditsPaid: 200,
    windowMs: 60_000,
    viral: false,
    flop: false,
    founderBoost: false,
    followersGained: 4,
    granted: true,
    roll: 1,
    trendMult: 1,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. Click guard
// ---------------------------------------------------------------------------
describe('click: the auto-clicker guard', () => {
  it('a blocked click moves nothing at all', () => {
    const state = richState(0)
    state.queue.push(runningJob(T0))
    // Fill the trailing second to the cap; every one of these pays.
    for (let i = 0; i < CLICK_CAP_PER_SEC; i++) {
      expect(ids(click(ctxFor(state, { rng: () => 1 })).events)).toEqual(['click'])
    }
    const before = {
      credits: state.credits,
      lifetime: state.lifetimeCredits,
      season: state.seasonCredits,
      clicks: state.totalClicks,
      window: state.stats.clicksWindow.length,
      bonus: (state.queue[0] as Job).clickBonusMs,
    }

    const result = click(ctxFor(state))

    expect(result.dirty).toBe(false)
    expect(result.events).toEqual([{ type: 'clickBlocked', reason: 'rate', until: T0 + CLICK_RATE_WINDOW_MS }])
    // The deliberate deviation is the event, not the bookkeeping: nothing else may move.
    expect(ids(result.events)).not.toContain('click')
    expect(state.credits).toBe(before.credits)
    expect(state.lifetimeCredits).toBe(before.lifetime)
    expect(state.seasonCredits).toBe(before.season)
    expect(state.totalClicks).toBe(before.clicks)
    expect(state.stats.clicksWindow.length).toBe(before.window)
    expect((state.queue[0] as Job).clickBonusMs).toBe(before.bonus)
    // The one thing a refusal writes: the flag behind the hidden achievement "Rate Limited".
    expect(state.flags[CLICK_GUARD_FLAG]).toBe(true)
  })

  it('an accepted click pays, counts and shaves as before', () => {
    const state = richState(0)
    state.queue.push(runningJob(T0))
    const result = click(ctxFor(state, { rng: () => 1 }))

    expect(ids(result.events)).toEqual(['click'])
    expect(state.totalClicks).toBe(1)
    expect(state.credits).toBeGreaterThan(0)
    expect((state.queue[0] as Job).clickBonusMs).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Lucky click
// ---------------------------------------------------------------------------
describe('click: the lucky seed', () => {
  const lucky: Rng = () => LUCKY_CLICK_CHANCE / 2
  const plain: Rng = () => 1

  it('multiplies the value, tags the event, counts the click and raises the flag', () => {
    const state = richState(0)
    const derived = computeDerived(state, CATALOG)
    const result = click(ctxFor(state, { rng: lucky }))

    const event = result.events[0]
    expect(event).toEqual({ type: 'click', value: derived.clickValue * LUCKY_CLICK_MULT, combo: 1, mult: 1, lucky: true })
    expect(state.credits).toBeCloseTo(derived.clickValue * LUCKY_CLICK_MULT, 6)
    expect(state.stats.luckyClicks).toBe(1)
    expect(state.flags[LUCKY_SEED_FLAG]).toBe(true)
  })

  it('an ordinary click is not lucky and does not raise the flag', () => {
    const state = richState(0)
    const derived = computeDerived(state, CATALOG)
    const result = click(ctxFor(state, { rng: plain }))

    expect(result.events[0]).toEqual({ type: 'click', value: derived.clickValue, combo: 1, mult: 1 })
    expect(state.stats.luckyClicks).toBe(0)
    expect(state.flags[LUCKY_SEED_FLAG]).toBeUndefined()
  })

  it('a refused click never burns the lucky roll', () => {
    const state = richState(0)
    for (let i = 0; i < CLICK_CAP_PER_SEC; i++) click(ctxFor(state, { rng: plain }))
    click(ctxFor(state, { rng: lucky }))
    expect(state.stats.luckyClicks).toBe(0)
    expect(state.flags[LUCKY_SEED_FLAG]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 3. Level gate on setup
// ---------------------------------------------------------------------------
describe('setupModel: the level gate', () => {
  it('refuses below minLevel with the exact string and succeeds at it', () => {
    const state = richState()
    const model = modelById['flux-dev']
    expect(model?.minLevel).toBe(4)

    state.stats.levelSeen = 3
    const refused = setupModel(ctxFor(state), 'flux-dev')
    expect(refused.error).toBe('Needs level 4 · you are level 3')
    expect(refused.events).toEqual([])
    expect(state.models['flux-dev']).toBeUndefined()

    state.stats.levelSeen = 4
    const allowed = setupModel(ctxFor(state), 'flux-dev')
    expect(allowed.error).toBeUndefined()
    expect(state.models['flux-dev']?.setup).toBe(true)
  })

  it('is checked after "already set up"', () => {
    const state = richState()
    const model = modelById['flux-dev'] as ModelDef
    state.stats.levelSeen = 1
    state.models['flux-dev'] = { precisions: ['native'], setup: true }
    expect(setupModel(ctxFor(state), 'flux-dev').error).toBe(`${model.name} is already set up`)
  })

  it('never fires for a level 1 model', () => {
    const state = richState()
    delete state.models['sd15']
    expect(setupModel(ctxFor(state), 'sd15').error).toBeUndefined()
  })
})

describe('queueJob: an installed model stays usable above your level', () => {
  it('queues an already-installed model the player could not set up today', () => {
    const state = richState()
    state.hardware['rtx-4090'] = 1
    state.stats.levelSeen = 1
    state.models['sdxl'] = { precisions: ['native'], setup: true }

    const result = queueJob(ctxFor(state), {
      modelId: 'sdxl',
      precision: 'native',
      prompt: 'a cat',
      tags: [],
    })

    expect(result.error).toBeUndefined()
    expect(state.queue).toHaveLength(1)
    // The gate lives in setupModel only, so the same model cannot be re-installed.
    state.models['sdxl'] = { precisions: ['native'], setup: false }
    expect(setupModel(ctxFor(state), 'sdxl').error).toBe('Needs level 2 · you are level 1')
  })
})

// ---------------------------------------------------------------------------
// 4. The Latent Lounge
// ---------------------------------------------------------------------------
describe('spin / flip', () => {
  function spinnable(): GameState {
    const state = richState(10_000)
    state.stats.levelSeen = LOUNGE_MIN_LEVEL
    return state
  }

  it('refuses below the level gate and touches nothing', () => {
    const state = richState(10_000)
    state.stats.levelSeen = 1
    const result = spin(ctxFor(state), 50)
    expect(result.error).toBe(`Unlocks at level ${LOUNGE_MIN_LEVEL}`)
    expect(result.events).toEqual([])
    expect(state.stats.spins).toBe(0)
    expect(state.credits).toBe(10_000)
  })

  it('takes a paid spin and emits one spin event', () => {
    const state = spinnable()
    const result = spin(ctxFor(state, { rng: () => 0 }), 50)

    expect(result.error).toBeUndefined()
    expect(ids(result.events)).toEqual(['spin'])
    expect(state.stats.spins).toBe(1)
    // A bet moves the spendable balance and nothing else.
    expect(state.lifetimeCredits).toBe(0)
    expect(state.seasonCredits).toBe(0)

    // No cooldown: the next one is legal immediately.
    const again = spin(ctxFor(state, { rng: () => 0 }), 50)
    expect(again.error).toBeUndefined()
    expect(state.stats.spins).toBe(2)
  })

  it('the free spin costs nothing and is gone for the day', () => {
    const state = spinnable()
    const result = spin(ctxFor(state, { rng: () => 0 }), 'free')

    expect(ids(result.events)).toEqual(['spin'])
    expect(state.gamble.freeSpinDay).not.toBeNull()
    expect(spin(ctxFor(state), 'free').error).toBe('Free spin already used today')
  })

  it('passes the bet rejection copy straight through', () => {
    const state = spinnable()
    expect(spin(ctxFor(state), 1).error).toBe(`Bet at least ${BET_MIN} credits`)
    expect(flip(ctxFor(state), 1).error).toBe(`Bet at least ${BET_MIN} credits`)
    expect(flip(ctxFor(state), 1e9).error).toBe('Not enough credits')
  })

  it('flips the coin and pays double on your side', () => {
    const state = spinnable()
    const credits = state.credits
    const result = flip(ctxFor(state, { rng: () => 0 }), 100)
    expect(ids(result.events)).toEqual(['flip'])
    expect(state.stats.flips).toBe(1)
    expect(state.credits).toBe(credits - 100 + 200)
    expect(state.lifetimeCredits).toBe(0)
  })

  it('refuses the free stake on the coin table', () => {
    const state = spinnable()
    expect(flip(ctxFor(state), Number.NaN).error).toBe(`Bet at least ${BET_MIN} credits`)
  })
})

// ---------------------------------------------------------------------------
// 5. Welcome gifts
// ---------------------------------------------------------------------------
describe('grantGift / declineGift', () => {
  it('racks the founder card free, installs the PSU and does not throttle', () => {
    const state = richState(0)
    const result = grantGift(ctxFor(state), 'founder')

    expect(result.error).toBeUndefined()
    expect(result.dirty).toBe(true)
    expect(ids(result.events)).toContain('purchase')
    expect(ids(result.events)).toContain('reward')
    expect(state.hardware['rtx-pro-6000']).toBe(1)
    expect(state.upgrades).toContain('psu-850')
    expect(state.flags[GIFTS.founder.flag]).toBe(true)
    // Free means free: no credit counter moves.
    expect(state.credits).toBe(0)
    expect(state.lifetimeCredits).toBe(0)
    expect(state.seasonCredits).toBe(0)
    expect(computeDerived(state, CATALOG).throttled).toBe(false)
  })

  it('is idempotent', () => {
    const state = richState(0)
    grantGift(ctxFor(state), 'founder')
    const second = grantGift(ctxFor(state), 'founder')

    expect(second.error).toBe('That gift has already been claimed')
    expect(second.events).toEqual([])
    expect(state.hardware['rtx-pro-6000']).toBe(1)
    expect(state.upgrades.filter((u) => u === 'psu-850')).toHaveLength(1)
  })

  it('the Sonam gift pays through the normal credit path', () => {
    const state = richState(0)
    const result = grantGift(ctxFor(state), 'sonam')

    expect(state.credits).toBe(50_000)
    expect(state.lifetimeCredits).toBe(50_000)
    expect(state.seasonCredits).toBe(50_000)
    expect(result.events).toContainEqual({ type: 'reward', id: 'sonam', credits: 50_000 })
  })

  it('refuses an unknown gift', () => {
    const state = richState(0)
    const result = grantGift(ctxFor(state), 'nobody' as GiftKind)
    expect(result.error).toBe('Unknown gift: nobody')
    expect(state.upgrades).toHaveLength(0)
  })

  it('declining sets its own flag, emits nothing and repeats safely', () => {
    const state = richState(0)
    const result = declineGift(ctxFor(state), 'founder')

    expect(result.events).toEqual([])
    expect(result.error).toBeUndefined()
    expect(state.flags['gift:founder:declined']).toBe(true)
    expect(state.flags[GIFTS.founder.flag]).toBeUndefined()
    expect(declineGift(ctxFor(state), 'founder').error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 6. Tutorial flag
// ---------------------------------------------------------------------------
describe('completeTutorial', () => {
  it('sets the flag, emits nothing and is idempotent', () => {
    const state = richState(0)
    const first = completeTutorial(ctxFor(state))

    expect(first.events).toEqual([])
    expect(first.dirty).toBe(false)
    expect(first.error).toBeUndefined()
    expect(state.flags[TUTORIAL_FLAG]).toBe(true)

    const second = completeTutorial(ctxFor(state))
    expect(second.events).toEqual([])
    expect(state.flags[TUTORIAL_FLAG]).toBe(true)
  })

  it('does not go through setFlag, so it never announces an easter egg', () => {
    const state = richState(0)
    expect(eggs(completeTutorial(ctxFor(state)).events)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 7. Achievement rewards on the same click
// ---------------------------------------------------------------------------
describe('setFlag: achievements land on the same click', () => {
  it('pays a rewarded achievement exactly once', () => {
    const state = richState(0)
    // Settle whatever a fresh state already earns, so the deltas below are this flag's alone.
    checkAchievements(state, computeDerived(state, CATALOG), CATALOG)
    const before = state.credits

    const result = setFlag(ctxFor(state), 'title-25')
    const granted = result.events.flatMap((e) => (e.type === 'achievement' ? [e] : []))
    const title = granted.find((e) => e.id === 'title-25')

    expect(eggs(result.events)).toEqual(['title-25'])
    expect(title?.reward).toBe(1000)
    expect(result.dirty).toBe(true)
    expect(state.achievements).toContain('title-25')

    const paid = granted.reduce((sum, e) => sum + e.reward, 0)
    expect(state.credits).toBe(before + paid)
    expect(state.lifetimeCredits).toBe(paid)

    // A second pass grants nothing and pays nothing.
    const again = checkAchievements(state, computeDerived(state, CATALOG), CATALOG)
    expect(again).toEqual([])
    expect(state.credits).toBe(before + paid)
    expect(setFlag(ctxFor(state), 'title-25').error).toBe('Already discovered')
    expect(state.credits).toBe(before + paid)
  })

  it('stays clean when the flag grants nothing', () => {
    const state = richState(0)
    checkAchievements(state, computeDerived(state, CATALOG), CATALOG)
    const result = setFlag(ctxFor(state), 'no-such-egg')

    expect(ids(result.events)).toEqual(['easterEgg'])
    expect(result.dirty).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 8. New engine easter eggs
// ---------------------------------------------------------------------------
describe('queueJob: prompt easter eggs', () => {
  // A stateful rng: `newJobId` retries until the id is free, so two jobs queued at the same `now`
  // from a constant rng would spin forever.
  const seq = mulberry32(20260914)

  /** Queue a job and report the easter eggs it announced. */
  function queue(state: GameState, prompt: string, over: Partial<ActionContext> = {}, modelId = 'sd15'): string[] {
    const result = queueJob(ctxFor(state, { rng: seq, ...over }), { modelId, precision: 'native', prompt, tags: [] })
    expect(result.error).toBeUndefined()
    return eggs(result.events)
  }

  it('bad hands fires once, and only for the phrase', () => {
    const state = richState()
    expect(queue(state, 'portrait, bad hands, 8k')).toEqual([BAD_HANDS_FLAG])
    expect(state.flags[BAD_HANDS_FLAG]).toBe(true)
    expect(queue(state, 'more bad hands please')).toEqual([])
  })

  it('bad hands ignores a near miss', () => {
    const state = richState()
    expect(queue(state, 'badhands and a bad handshake')).toEqual([])
    expect(state.flags[BAD_HANDS_FLAG]).toBeUndefined()
  })

  it('masterpiece fires only when the prompt starts with the phrase', () => {
    const start = richState()
    expect(queue(start, 'masterpiece best quality, 1girl')).toEqual([MASTERPIECE_FLAG])
    expect(queue(start, 'masterpiece best quality again')).toEqual([])

    const middle = richState()
    expect(queue(middle, 'a masterpiece best quality cat')).toEqual([])
    expect(middle.flags[MASTERPIECE_FLAG]).toBeUndefined()
  })

  it('sd15-forever needs SD 1.5 and a region-class rig', () => {
    const state = richState()
    const hot = { derived: derivedWith(state, { bestTier: SD15_FOREVER_TIER }) }
    expect(queue(state, 'a cat', hot)).toEqual([SD15_FOREVER_FLAG])
    expect(queue(state, 'a dog', hot)).toEqual([])
  })

  it('sd15-forever ignores a lesser rig and a different model', () => {
    const cold = richState()
    expect(queue(cold, 'a cat', { derived: derivedWith(cold, { bestTier: SD15_FOREVER_TIER - 1 }) })).toEqual([])
    expect(cold.flags[SD15_FOREVER_FLAG]).toBeUndefined()

    const other = richState()
    other.hardware['rtx-4090'] = 1
    other.models['sdxl'] = { precisions: ['native'], setup: true }
    expect(queue(other, 'a cat', { derived: derivedWith(other, { bestTier: SD15_FOREVER_TIER }) }, 'sdxl')).toEqual([])
    expect(other.flags[SD15_FOREVER_FLAG]).toBeUndefined()
  })

  it('still announces spaghetti, and announces two eggs from one prompt', () => {
    const state = richState()
    expect(queue(state, 'masterpiece best quality, spaghetti, bad hands').sort()).toEqual(
      [BAD_HANDS_FLAG, MASTERPIECE_FLAG, SPAGHETTI_FLAG].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// 9. Ratioed upscale refusal
// ---------------------------------------------------------------------------
describe('upscalePost', () => {
  it('refuses a ratioed post with its own reason', () => {
    const state = richState()
    state.posts.push(makePost({ ratioed: true, flop: true }))
    const result = upscalePost(ctxFor(state), 'post-1')

    expect(result.error).toBe('Nobody upscales a ratio · tag the kind you actually posted')
    expect(result.events).toEqual([])
    expect(state.posts[0]?.upscaled).toBeUndefined()
    expect(state.credits).toBe(1_000_000)
  })

  it('still upscales a post that landed', () => {
    const state = richState()
    state.posts.push(makePost())
    expect(upscalePost(ctxFor(state), 'post-1').error).toBeUndefined()
    expect(state.posts[0]?.upscaled).toBe(true)
  })
})

describe('buyHardware and the breaker', () => {
  it('refuses the unit that would trip it, and max stops at the units that fit', () => {
    const state = richState()
    // 650 W base budget with the 65 W starter box plugged in: four 120 W boxes fit, the fifth trips.
    const max = buyHardware(ctxFor(state), 'pc-8c16t', 'max')
    expect(max.error).toBeUndefined()
    expect(state.hardware['pc-8c16t']).toBe(4)
    const refused = buyHardware(ctxFor(state), 'pc-8c16t')
    expect(refused.error).toBe('Trips the breaker · 15 W over budget · install 850 W PSU first')
    expect(refused.events).toEqual([])
    expect(state.hardware['pc-8c16t']).toBe(4)
    // The PSU is the purchase that reopens the shelf.
    expect(buyUpgrade(ctxFor(state), 'psu-850').error).toBeUndefined()
    expect(buyHardware(ctxFor(state), 'pc-8c16t').error).toBeUndefined()
    expect(state.hardware['pc-8c16t']).toBe(5)
  })
})
