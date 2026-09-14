import { beforeEach, describe, expect, it } from 'vitest'
import { CATALOG, createCatalog, type Catalog } from '@/data'
import { HARDWARE } from '@/data/hardware'
import { HASHTAGS } from '@/data/hashtags'
import { MODELS } from '@/data/models'
import {
  buyHardware,
  buyUpgrade,
  claimContract,
  claimDaily,
  click,
  loraCost,
  quantize,
  queueJob,
  rebrand,
  resolveEvent,
  setFlag,
  setupModel,
  toggleSetting,
  trainLora,
  unlockMapNode,
  upscalePost,
  type ActionContext,
} from '@/game/actions'
import {
  CONTRACT_SLOTS,
  POST_WINDOW_MS,
  SETUP_FEE_MULT,
  STEP_S,
  TIER_UPGRADE_THRESHOLDS,
  TRENDING_COUNT,
  WEEK_MS,
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_LORA,
  XP_MAP_NODE,
  XP_QUANTIZE,
  XP_UPGRADE,
} from '@/game/constants'
import { CONTRACTS } from '@/data/contracts'
import { acceptContract } from '@/game/contracts'
import { addDrop } from '@/game/citizens'
import { computeDerived, createEmptyDerived } from '@/game/derived'
import { bulkCost, maxAffordable } from '@/game/economy'
import { crossedMilestones, needsDerived, resetTickMemo, tick } from '@/game/engine'
import { trendingForWeek } from '@/game/hashtags'
import { MAX_CATCHUP_S, startLoop } from '@/game/loop'
import { quantFee } from '@/game/quantize'
import { mulberry32 } from '@/game/rng'
import { createInitialState } from '@/game/state'
import { likesAt, settlePosts } from '@/game/virality'
import type { Derived, GameEvent, GameState, HardwareDef, ModelDef, Post } from '@/game/types'

const T0 = 1_700_000_000_000
const GUEST = 'guest-test'

const hw = (id: string): HardwareDef => HARDWARE.find((h) => h.id === id) as HardwareDef
const model = (id: string): ModelDef => MODELS.find((m) => m.id === id) as ModelDef

/** Real ladder + hashtags, but no contracts/events/achievements so ticks are quiet. */
const QUIET: Catalog = createCatalog({
  hardware: HARDWARE,
  models: MODELS,
  hashtags: HASHTAGS,
})

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

function ctxFor(state: GameState, catalog: Catalog = CATALOG, derived?: Derived, now = T0): ActionContext {
  return { state, derived: derived ?? computeDerived(state, catalog), catalog, now, rng: mulberry32(7) }
}

const ofType = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)

describe('tick', () => {
  let state: GameState
  beforeEach(() => {
    state = createInitialState(T0, GUEST)
  })

  it('accrues cps × dt into credits, lifetime and season, and advances play time', () => {
    const rng = mulberry32(1)
    tick(state, derivedWith({ cps: 10 }), QUIET, 0.5, T0 + 500, rng)
    expect(state.credits).toBeCloseTo(5, 9)
    expect(state.lifetimeCredits).toBeCloseTo(5, 9)
    expect(state.seasonCredits).toBeCloseTo(5, 9)
    expect(state.meta.playedSec).toBeCloseTo(0.5, 9)
    expect(state.meta.lastTickAt).toBe(T0 + 500)

    tick(state, derivedWith({ cps: 10 }), QUIET, 0.05, T0 + 550, rng)
    expect(state.credits).toBeCloseTo(5.5, 9)
  })

  it('ignores a zero, negative or NaN dt', () => {
    const rng = mulberry32(1)
    for (const dt of [0, -1, NaN]) tick(state, derivedWith({ cps: 10 }), QUIET, dt, T0 + 50, rng)
    expect(state.credits).toBe(0)
    expect(state.meta.playedSec).toBe(0)
  })

  it('emits a milestone the first time cps crosses a power of ten', () => {
    const rng = mulberry32(1)
    expect(ofType(tick(state, derivedWith({ cps: 4 }), QUIET, 0.05, T0, rng), 'milestone')).toEqual([])
    const crossed = tick(state, derivedWith({ cps: 12 }), QUIET, 0.05, T0 + 50, rng)
    expect(ofType(crossed, 'milestone')).toEqual([{ type: 'milestone', cps: 10 }])
    // Not again while hovering above it…
    expect(ofType(tick(state, derivedWith({ cps: 15 }), QUIET, 0.05, T0 + 100, rng), 'milestone')).toEqual([])
    // …and a big jump announces every power crossed.
    const jump = tick(state, derivedWith({ cps: 2500 }), QUIET, 0.05, T0 + 150, rng)
    expect(ofType(jump, 'milestone').map((e) => e.cps)).toEqual([100, 1000])
    expect(state.stats.bestCps).toBe(2500)
  })

  it('detects a trending-week rollover when weekOverride changes', () => {
    const rng = mulberry32(1)
    state.weekOverride = 5
    expect(ofType(tick(state, derivedWith(), QUIET, 0.05, T0, rng), 'weekRollover')).toEqual([])
    state.weekOverride = 6
    const rolled = ofType(tick(state, derivedWith(), QUIET, 0.05, T0 + 50, rng), 'weekRollover')
    expect(rolled).toHaveLength(1)
    expect(rolled[0]?.tags).toEqual(trendingForWeek(6, QUIET))
    expect(rolled[0]?.tags).toHaveLength(TRENDING_COUNT)
    // Same week again: quiet.
    expect(ofType(tick(state, derivedWith(), QUIET, 0.05, T0 + 100, rng), 'weekRollover')).toEqual([])
  })

  it('detects a wall-clock rollover and seeds the previous week from lastTickAt', () => {
    const rng = mulberry32(1)
    const start = Math.floor(T0 / WEEK_MS) * WEEK_MS + 1000
    state.meta.lastTickAt = start
    expect(ofType(tick(state, derivedWith(), QUIET, 0.05, start + 50, rng), 'weekRollover')).toEqual([])
    const rolled = ofType(tick(state, derivedWith(), QUIET, 0.05, start + WEEK_MS, rng), 'weekRollover')
    expect(rolled).toHaveLength(1)
    expect(rolled[0]?.tags).toEqual(trendingForWeek(Math.floor((start + WEEK_MS) / WEEK_MS), QUIET))
  })

  it('checks achievements at most once per played second', () => {
    const rng = mulberry32(1)
    state.totalClicks = 1 // satisfies the real "first-click" achievement
    const events: GameEvent[] = []
    for (let i = 0; i < 19; i++) events.push(...tick(state, derivedWith(), CATALOG, 0.05, T0 + i * 50, rng))
    expect(ofType(events, 'achievement')).toEqual([])
    const crossing = tick(state, derivedWith(), CATALOG, 0.05, T0 + 19 * 50, rng)
    expect(ofType(crossing, 'achievement').map((e) => e.id)).toContain('first-click')
    expect(state.achievements).toContain('first-click')
  })

  it('refills contract slots when due and progresses them from tick events', () => {
    const rng = mulberry32(3)
    expect(state.contracts.active).toEqual([])
    tick(state, derivedWith({ bestTier: 1 }), CATALOG, 0.05, T0, rng)
    expect(state.contracts.active).toHaveLength(CONTRACT_SLOTS)
    expect(state.contracts.nextRotateAt).toBeGreaterThan(T0)
  })

  it('announces breaker flips once per change', () => {
    const rng = mulberry32(1)
    tick(state, derivedWith({ throttled: false }), QUIET, 0.05, T0, rng)
    expect(ofType(tick(state, derivedWith({ throttled: true }), QUIET, 0.05, T0 + 50, rng), 'powerThrottle')).toEqual([
      { type: 'powerThrottle', on: true },
    ])
    expect(ofType(tick(state, derivedWith({ throttled: true }), QUIET, 0.05, T0 + 100, rng), 'powerThrottle')).toEqual([])
    expect(ofType(tick(state, derivedWith({ throttled: false }), QUIET, 0.05, T0 + 150, rng), 'powerThrottle')).toEqual([
      { type: 'powerThrottle', on: false },
    ])
  })

  it('finishes a queued job into a post and settles it over the like window', () => {
    const rng = mulberry32(11)
    state.credits = 1_000
    const ctx = ctxFor(state, CATALOG, undefined, T0)
    const queued = queueJob(ctx, { modelId: 'sd15', precision: 'native', prompt: 'a cat', tags: [] })
    expect(queued.error).toBeUndefined()
    expect(ofType(queued.events, 'jobStarted')).toHaveLength(1)
    const job = state.queue[0]
    expect(job?.endsAt).not.toBeNull()

    const done = tick(state, ctx.derived, CATALOG, 0.05, (job?.endsAt as number) + 1, rng)
    expect(ofType(done, 'postCreated')).toHaveLength(1)
    expect(state.queue).toEqual([])
    expect(state.posts).toHaveLength(1)

    const settled = tick(state, ctx.derived, CATALOG, 0.05, (job?.endsAt as number) + POST_WINDOW_MS + 100, rng)
    expect(ofType(settled, 'postResolved')).toHaveLength(1)
    expect(state.posts[0]?.granted).toBe(true)
    expect(state.posts[0]?.likes).toBe(state.posts[0]?.targetLikes)
  })
})

describe('tick: citizens', () => {
  it('runs a published workflow, pays the royalty into credits and cools off', () => {
    const state = createInitialState(T0, GUEST)
    const rng = mulberry32(3)
    addDrop(state, T0, rng, 'w1', 'Hands, fixed')
    const due = state.citizens.drops[0]!.nextRunAt
    const derived = derivedWith({ cps: 100 })

    // Nothing before the run is due.
    expect(ofType(tick(state, derived, CATALOG, STEP_S, T0, rng), 'citizenRun')).toEqual([])

    const events = ofType(tick(state, derived, CATALOG, STEP_S, due, rng), 'citizenRun')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ workflowName: 'Hands, fixed' })
    expect(state.credits).toBeGreaterThan(0)
    expect(state.stats.hubRuns).toBe(1)
    expect(state.citizens.feed).toHaveLength(1)

    // One run per drop per tick, whatever the gap: an hour later the workflow has stopped
    // trending, so the tick marks it cold instead of paying out the backlog.
    expect(ofType(tick(state, derived, CATALOG, STEP_S, due + 3_600_000, rng), 'citizenRun')).toEqual([])
    expect(state.citizens.drops[0]!.cold).toBe(true)
    expect(state.stats.hubRuns).toBe(1)
  })
})

describe('crossedMilestones / needsDerived', () => {
  it('lists powers of ten strictly above prev and at most cur', () => {
    expect(crossedMilestones(0, 9.99)).toEqual([])
    expect(crossedMilestones(0, 10)).toEqual([10])
    expect(crossedMilestones(10, 10)).toEqual([])
    expect(crossedMilestones(99, 100)).toEqual([100])
    expect(crossedMilestones(100, 100)).toEqual([])
    expect(crossedMilestones(5, 12_000)).toEqual([10, 100, 1_000, 10_000])
    expect(crossedMilestones(1e6, 1e9)).toEqual([1e7, 1e8, 1e9])
    expect(crossedMilestones(50, 40)).toEqual([])
  })

  it('flags batches that change what computeDerived reads', () => {
    expect(needsDerived([{ type: 'click', value: 1 }])).toBe(false)
    expect(needsDerived([{ type: 'click', value: 1 }, { type: 'purchase', hardwareId: 'x', count: 1 }])).toBe(true)
    expect(needsDerived([{ type: 'signup', total: 1 }])).toBe(true)
    expect(needsDerived([])).toBe(false)
  })

  it('resetTickMemo forgets a state without throwing', () => {
    const state = createInitialState(T0, GUEST)
    tick(state, derivedWith(), QUIET, 0.05, T0, mulberry32(1))
    expect(() => resetTickMemo(state)).not.toThrow()
  })
})

describe('startLoop', () => {
  /** Manual frame scheduler: `pump(ms)` advances the clock and runs the pending frame. */
  function harness() {
    let clock = T0
    let pending: (() => void) | null = null
    const ticks: Array<[number, number]> = []
    const renders: Array<[number, number]> = []
    const gaps: Array<[number, number]> = []
    const stop = startLoop({
      tick: (dt, now) => ticks.push([dt, now]),
      render: (now, alpha) => renders.push([now, alpha]),
      onLongGap: (elapsed, now) => gaps.push([elapsed, now]),
      now: () => clock,
      requestFrame: (cb) => {
        pending = cb
        return 1
      },
      cancelFrame: () => {
        pending = null
      },
    })
    const pump = (ms: number) => {
      clock += ms
      const frame = pending
      pending = null
      frame?.()
    }
    return { ticks, renders, gaps, pump, stop, hasPending: () => pending !== null }
  }

  it('drains whole STEP_S slices and renders once per frame with the leftover as alpha', () => {
    const h = harness()
    expect(h.hasPending()).toBe(true)
    h.pump(STEP_S * 1000 * 2.5) // 125 ms → two steps, 25 ms left over
    expect(h.ticks.map(([dt]) => dt)).toEqual([STEP_S, STEP_S])
    expect(h.ticks.map(([, now]) => now)).toEqual([T0 + 125 - 75, T0 + 125 - 25])
    expect(h.renders).toHaveLength(1)
    expect(h.renders[0]?.[1]).toBeCloseTo(0.5, 6)
    h.pump(25) // leftover now completes a third step
    expect(h.ticks).toHaveLength(3)
    expect(h.renders[1]?.[1]).toBeCloseTo(0, 6)
  })

  it('hands long gaps to onLongGap instead of simulating them, and stop() ends the loop', () => {
    const h = harness()
    h.pump((MAX_CATCHUP_S + 1) * 1000)
    expect(h.ticks).toEqual([])
    expect(h.gaps).toEqual([[MAX_CATCHUP_S + 1, T0 + (MAX_CATCHUP_S + 1) * 1000]])
    expect(h.renders).toHaveLength(1)
    h.stop()
    expect(h.hasPending()).toBe(false)
    h.pump(1000)
    expect(h.ticks).toEqual([])
    expect(h.renders).toHaveLength(1)
  })

  it('is a no-op outside a browser', () => {
    const stop = startLoop({ tick: () => {}, render: () => {} })
    expect(typeof stop).toBe('function')
    expect(() => stop()).not.toThrow()
  })
})

describe('actions', () => {
  let state: GameState
  beforeEach(() => {
    state = createInitialState(T0, GUEST)
  })

  it('click earns clickValue, counts the click and returns a click event', () => {
    const result = click(ctxFor(state, CATALOG, derivedWith({ clickValue: 2.5 })))
    expect(result.error).toBeUndefined()
    expect(result.dirty).toBe(false)
    expect(result.events).toEqual([{ type: 'click', value: 2.5 }])
    expect(state.credits).toBe(2.5)
    expect(state.lifetimeCredits).toBe(2.5)
    expect(state.seasonCredits).toBe(2.5)
    expect(state.totalClicks).toBe(1)
    expect(state.stats.clicksWindow).toEqual([T0])
  })

  describe('buyHardware', () => {
    const cpu = hw('pc-8c16t')

    it("'max' buys exactly maxAffordable units", () => {
      state.credits = bulkCost(cpu, 0, 5) + 3
      const expected = maxAffordable(cpu, 0, state.credits)
      expect(expected).toBe(5)
      const result = buyHardware(ctxFor(state), cpu.id, 'max')
      expect(result.error).toBeUndefined()
      expect(result.dirty).toBe(true)
      expect(result.events[0]).toEqual({ type: 'purchase', hardwareId: cpu.id, count: 5 })
      expect(state.hardware[cpu.id]).toBe(5)
      expect(state.credits).toBe(3)
    })

    it('buys a single unit and refuses bulk buys it cannot afford in full', () => {
      state.credits = bulkCost(cpu, 0, 3)
      const ten = buyHardware(ctxFor(state), cpu.id, 10)
      expect(ten.error).toBeDefined()
      expect(state.hardware[cpu.id]).toBeUndefined()
      const one = buyHardware(ctxFor(state), cpu.id, 1)
      expect(one.error).toBeUndefined()
      expect(state.hardware[cpu.id]).toBe(1)
      expect(state.credits).toBe(bulkCost(cpu, 0, 3) - cpu.baseCost)
    })

    it("fails with the lock reason, 'not enough credits', or unknown id", () => {
      state.credits = 1e9
      expect(buyHardware(ctxFor(state), 'rtx-3060', 1).error).toMatch(/Locked/)
      state.credits = 0
      expect(buyHardware(ctxFor(state), cpu.id, 'max').error).toBeDefined()
      expect(buyHardware(ctxFor(state), 'rtx-9999', 1).error).toMatch(/Unknown/)
      expect(state.hardware).toEqual({ 'pc-4c8t': 1 })
    })

    it("raises the hidden-achievement flags: 'brokeAtZero' on an exact spend, 'speedrun' on an early cloud node", () => {
      state.credits = cpu.baseCost
      expect(buyHardware(ctxFor(state), cpu.id, 1).error).toBeUndefined()
      expect(state.credits).toBe(0)
      expect(state.flags.brokeAtZero).toBe(true)

      const node = hw('aws-p4d')
      state.hardware['a100-80'] = 1 // aws-p4d's unlock
      state.stats.levelSeen = node.minLevel ?? 1 // and the level it needs
      state.credits = node.baseCost + 1
      state.meta.playedSec = 25 * 60
      expect(buyHardware(ctxFor(state), node.id, 1).error).toBeUndefined()
      expect(state.flags.speedrun).toBeUndefined()
      state.credits = 1e9
      state.meta.playedSec = 25 * 60 - 1
      expect(buyHardware(ctxFor(state), node.id, 1).error).toBeUndefined()
      expect(state.flags.speedrun).toBe(true)
    })
  })

  describe('buyUpgrade', () => {
    it('buys a named upgrade once its unlock is met and it is affordable', () => {
      state.credits = 100
      expect(buyUpgrade(ctxFor(state), 'better-prompts').error).toMatch(/clicks/)
      state.totalClicks = 10
      const result = buyUpgrade(ctxFor(state), 'better-prompts')
      expect(result).toEqual({
        events: [
          { type: 'upgrade', id: 'better-prompts' },
          { type: 'xp', amount: XP_UPGRADE, source: 'upgrade' },
        ],
        dirty: true,
      })
      expect(state.upgrades).toEqual(['better-prompts'])
      expect(state.credits).toBe(0)
      expect(buyUpgrade(ctxFor(state), 'better-prompts').error).toMatch(/already/i)
    })

    it('buys tier upgrades in order into hardwareTiers, once enough units are owned', () => {
      state.credits = 10_000
      expect(buyUpgrade(ctxFor(state), 'tier:pc-4c8t:2').error).toMatch(/tier 1 first/)
      // Tier 1 waits for TIER_UPGRADE_THRESHOLDS[0] owned: at one unit it would be a 10× trap.
      expect(buyUpgrade(ctxFor(state), 'tier:pc-4c8t:1').error).toMatch(/Own 5/)
      state.hardware['pc-4c8t'] = TIER_UPGRADE_THRESHOLDS[0]
      expect(buyUpgrade(ctxFor(state), 'tier:pc-4c8t:1').error).toBeUndefined()
      expect(state.hardwareTiers).toEqual({ 'pc-4c8t': 1 })
      expect(state.upgrades).toEqual([])
      expect(state.credits).toBe(10_000 - 150)
      expect(buyUpgrade(ctxFor(state), 'tier:pc-4c8t:1').error).toMatch(/already/i)
      expect(buyUpgrade(ctxFor(state), 'tier:pc-4c8t:2').error).toMatch(/Own 10/)
    })
  })

  it('unlockMapNode walks the graph from the root and charges the node cost', () => {
    state.credits = 500
    expect(unlockMapNode(ctxFor(state), 'core-manager').error).toMatch(/first/)
    expect(unlockMapNode(ctxFor(state), 'core-root')).toEqual({
      events: [
        { type: 'mapUnlock', id: 'core-root' },
        { type: 'xp', amount: XP_MAP_NODE, source: 'mapNode' },
      ],
      dirty: true,
    })
    expect(unlockMapNode(ctxFor(state), 'core-root').error).toMatch(/already/i)
    expect(unlockMapNode(ctxFor(state), 'core-manager').error).toBeUndefined()
    expect(state.mapNodes).toEqual(['core-root', 'core-manager'])
    expect(state.credits).toBe(0)
    expect(unlockMapNode(ctxFor(state), 'tech-sage').error).toMatch(/credits/)
    expect(unlockMapNode(ctxFor(state), 'nope').error).toMatch(/Unknown/)
  })

  it('setupModel installs for free when it fits, else charges the setup fee', () => {
    // The level gate is its own test (actions-new.test.ts); stand above it so the fee is the subject.
    state.stats.levelSeen = 4
    // sd15 is preinstalled; sdxl (8 GB) fits the 8 GB office PC → free.
    expect(setupModel(ctxFor(state), 'sdxl').error).toBeUndefined()
    expect(state.models.sdxl).toEqual({ precisions: ['native'], setup: true })
    expect(setupModel(ctxFor(state), 'sdxl').error).toMatch(/already/i)
    // flux-dev does not fit → 5× baseCost.
    const flux = model('flux-dev')
    expect(setupModel(ctxFor(state), 'flux-dev').error).toMatch(/credits/)
    state.credits = SETUP_FEE_MULT * flux.baseCost
    expect(setupModel(ctxFor(state), 'flux-dev').error).toBeUndefined()
    expect(state.credits).toBe(0)
    expect(state.models['flux-dev']?.setup).toBe(true)
  })

  it('quantize needs the model, the Graph node and the fee', () => {
    const sdxl = model('sdxl')
    const fee = quantFee(sdxl, 'fp8', CATALOG)
    state.credits = fee
    expect(quantize(ctxFor(state), 'sdxl', 'fp8').error).toMatch(/Set up/)
    state.models.sdxl = { precisions: ['native'], setup: true }
    expect(quantize(ctxFor(state), 'sdxl', 'fp8').error).toMatch(/Unlock/)
    state.mapNodes.push('quant-fp8')
    expect(quantize(ctxFor(state), 'sdxl', 'fp8')).toEqual({
      events: [{ type: 'xp', amount: XP_QUANTIZE, source: 'quantize' }],
      dirty: false,
    })
    expect(state.models.sdxl?.precisions).toEqual(['native', 'fp8'])
    expect(state.credits).toBe(0)
    expect(state.stats.quantizations).toBe(1)
    expect(quantize(ctxFor(state), 'sdxl', 'fp8').error).toMatch(/Already/)
    expect(quantize(ctxFor(state), 'sd15', 'fp8').error).toBeDefined()
  })

  it('trainLora costs max(500, 1200 × cps) and needs the LoRA Training node', () => {
    const slow = derivedWith({ cps: 0.1 })
    expect(loraCost(slow)).toBe(500)
    expect(loraCost(derivedWith({ cps: 2 }))).toBe(2_400)
    state.credits = 500
    expect(trainLora(ctxFor(state, CATALOG, slow), 'comfyui').error).toMatch(/LoRA Training/)
    state.mapNodes.push('lora-training')
    expect(trainLora(ctxFor(state, CATALOG, slow), 'nope').error).toMatch(/Unknown/)
    expect(trainLora(ctxFor(state, CATALOG, slow), 'comfyui')).toEqual({
      events: [{ type: 'xp', amount: XP_LORA, source: 'lora' }],
      dirty: true,
    })
    expect(state.loras).toEqual(['comfyui'])
    expect(state.stats.lorasTrained).toBe(1)
    expect(state.credits).toBe(0)
    expect(trainLora(ctxFor(state, CATALOG, slow), 'comfyui').error).toMatch(/already/)
  })

  it('queueJob credits a job it finishes on the way in toward contracts', () => {
    state.credits = 1_000
    const wedding = CONTRACTS.find((c) => c.id === 'c-cousin-wedding')!
    state.contracts.active = [acceptContract(wedding, state, computeDerived(state, CATALOG), T0)]
    const first = queueJob(ctxFor(state), { modelId: 'sd15', precision: 'native', prompt: 'a cat', tags: [] })
    expect(first.error).toBeUndefined()
    const endsAt = state.queue[0]?.endsAt as number
    // Queueing again just after the first job came due finishes it inside the action…
    const second = queueJob(ctxFor(state, CATALOG, undefined, endsAt + 10), { modelId: 'sd15', precision: 'native', prompt: 'a dog', tags: [] })
    expect(ofType(second.events, 'postCreated')).toHaveLength(1)
    // …and the contract sees that post even though no tick ever will.
    expect(state.contracts.active[0]?.progress).toBe(1)
  })

  it('setFlag raises a UI discovery flag once and announces it', () => {
    // The flag, the achievement it unlocks and its credits all land on the same call, so `dirty`
    // is true: an achievement moves the global multiplier.
    expect(setFlag(ctxFor(state), 'konami')).toEqual({
      events: [
        { type: 'easterEgg', id: 'konami' },
        { type: 'achievement', id: 'konami', reward: 0 },
        { type: 'xp', amount: XP_ACHIEVEMENT, source: 'achievement' },
      ],
      dirty: true,
    })
    expect(state.flags.konami).toBe(true)
    expect(setFlag(ctxFor(state), 'konami').error).toMatch(/Already/)
    expect(setFlag(ctxFor(state), '').error).toBeDefined()
    expect(Object.keys(state.flags)).toEqual(['konami'])
  })

  it('queueJob validates through createJob and flags spaghetti prompts once', () => {
    expect(queueJob(ctxFor(state), { modelId: 'nope', precision: 'native', prompt: 'x', tags: [] }).error).toBeDefined()
    expect(queueJob(ctxFor(state), { modelId: 'sd15', precision: 'native', prompt: 'x', tags: [] }).error).toMatch(/credits/)
    state.credits = 1_000
    const first = queueJob(ctxFor(state), { modelId: 'sd15', precision: 'native', prompt: 'node spaghetti at 3am', tags: [] })
    expect(first.error).toBeUndefined()
    expect(ofType(first.events, 'easterEgg')).toEqual([{ type: 'easterEgg', id: 'spaghetti' }])
    expect(state.flags.spaghetti).toBe(true)
    const second = queueJob(ctxFor(state), { modelId: 'sd15', precision: 'native', prompt: 'more spaghetti', tags: [] })
    expect(ofType(second.events, 'easterEgg')).toEqual([])
    expect(state.queue).toHaveLength(2)
  })

  it('claimContract pays only finished, unclaimed contracts and frees the slot', () => {
    expect(claimContract(ctxFor(state), 0).error).toMatch(/No such/)
    state.contracts.active.push({
      defId: 'c-cousin-wedding',
      acceptedAt: T0,
      progress: 5,
      target: 5,
      rewardCredits: 300,
      done: false,
      claimed: false,
    })
    expect(claimContract(ctxFor(state), 0).error).toMatch(/not finished/i)
    ;(state.contracts.active[0] as { done: boolean }).done = true
    expect(claimContract(ctxFor(state), 0)).toEqual({
      events: [{ type: 'xp', amount: XP_CONTRACT, source: 'contract' }],
      dirty: false,
    })
    expect(state.credits).toBe(300)
    expect(state.stats.contractsDone).toBe(1)
    expect(state.contracts.active).toEqual([])
  })

  it('claimDaily claims once per UTC day', () => {
    const result = claimDaily(ctxFor(state, CATALOG, derivedWith({ cps: 1 })))
    expect(result.error).toBeUndefined()
    expect(ofType(result.events, 'daily')).toHaveLength(1)
    expect(state.daily.streak).toBe(1)
    expect(state.credits).toBeGreaterThan(0)
    expect(claimDaily(ctxFor(state)).error).toMatch(/Already/)
  })

  it('rebrand needs a cloud node or region and bumps the season', () => {
    expect(rebrand(ctxFor(state)).error).toMatch(/cloud node/)
    state.hardware['aws-p4d'] = 1
    state.seasonCredits = 1e8
    const result = rebrand(ctxFor(state))
    expect(result.error).toBeUndefined()
    expect(result.dirty).toBe(true)
    expect(state.meta.season).toBe(2)
    expect(state.stats.rebrands).toBe(1)
    expect(state.credits).toBe(0)
  })

  it('resolveEvent fixes a broken node but not a promo', () => {
    expect(resolveEvent(ctxFor(state), 'ev-node-broke-import').error).toMatch(/Nothing/)
    state.events.active.push({ defId: 'ev-node-broke-import', kind: 'nodeBroke', startedAt: T0, endsAt: T0 + 120_000 })
    state.events.active.push({ defId: 'ev-cloud-promo', kind: 'cloudPromo', startedAt: T0, endsAt: T0 + 77_000 })
    expect(resolveEvent(ctxFor(state), 'ev-cloud-promo').error).toMatch(/its course/)
    const fixed = resolveEvent(ctxFor(state), 'ev-node-broke-import')
    expect(fixed.error).toBeUndefined()
    expect(fixed.dirty).toBe(true)
    expect(ofType(fixed.events, 'eventEnd')).toEqual([{ type: 'eventEnd', defId: 'ev-node-broke-import', kind: 'nodeBroke' }])
    expect(state.flags.fixedNode).toBe(true)
    expect(state.events.active.map((e) => e.defId)).toEqual(['ev-cloud-promo'])
  })

  it('toggleSetting flips or sets a boolean setting', () => {
    expect(toggleSetting(ctxFor(state), 'sfx')).toEqual({ events: [], dirty: false })
    expect(state.settings.sfx).toBe(false)
    toggleSetting(ctxFor(state), 'sfx', true)
    expect(state.settings.sfx).toBe(true)
    expect(toggleSetting(ctxFor(state), 'nope' as 'sfx').error).toMatch(/Unknown/)
  })

  describe('upscalePost', () => {
    function grantedPost(): Post {
      return {
        id: 'p1',
        createdAt: T0 - 60_000,
        modelId: 'sd15',
        kind: 'image',
        precision: 'native',
        prompt: 'a cat',
        tags: [],
        matchedTrending: [],
        thumb: 'cat',
        cost: 100,
        targetLikes: 100,
        likes: 100,
        creditsPerLike: 2,
        creditsPaid: 200,
        windowMs: POST_WINDOW_MS,
        viral: false,
        flop: false,
        founderBoost: false,
        followersGained: 5,
        granted: true,
        roll: 1,
        trendMult: 1,
      }
    }

    it('adds a 40% second wave that settles over a fresh window without a jump or double grant', () => {
      state.posts.push(grantedPost())
      state.credits = 1_000
      const before = state.credits
      const result = upscalePost(ctxFor(state), 'p1')
      expect(result).toEqual({ events: [], dirty: false })
      expect(state.credits).toBeLessThan(before)
      const post = state.posts[0] as Post
      expect(post.upscaled).toBe(true)
      expect(post.targetLikes).toBe(140)
      // Continuous at the moment of upscaling…
      expect(likesAt(post, T0)).toBe(post.likes)
      expect(post.likes).toBeGreaterThanOrEqual(99)
      // …and complete one window later.
      expect(likesAt(post, T0 + POST_WINDOW_MS)).toBe(140)

      const creditsBefore = state.credits
      const followersBefore = state.followers
      const events = settlePosts(state, derivedWith(), CATALOG, T0 + POST_WINDOW_MS + 1)
      expect(post.likes).toBe(140)
      expect(state.credits - creditsBefore).toBeCloseTo((140 - 100) * 2, 6)
      expect(events).toEqual([])
      expect(state.followers).toBe(followersBefore)
      expect(upscalePost(ctxFor(state), 'p1').error).toMatch(/Already/)
    })

    it('rejects unknown posts, tiny posts, flops and empty wallets', () => {
      expect(upscalePost(ctxFor(state), 'nope').error).toMatch(/No such/)
      state.posts.push({ ...grantedPost(), id: 'tiny', targetLikes: 1, likes: 1 })
      expect(upscalePost(ctxFor(state), 'tiny').error).toMatch(/likes/)
      state.posts.push({ ...grantedPost(), id: 'flop', flop: true })
      state.credits = 1_000
      expect(upscalePost(ctxFor(state), 'flop').error).toMatch(/flop/)
      state.posts.push(grantedPost())
      state.credits = 0
      expect(upscalePost(ctxFor(state), 'p1').error).toMatch(/credits/)
    })

    it('prices the upscale off the job’s original cost, so it stays worth it after cps has grown', () => {
      // An average post: cost 100, payout 1.1 × 100 × roll 1.1 = 121 credits over 100 likes.
      const post = { ...grantedPost(), creditsPerLike: 1.21, creditsPaid: 121, roll: 1.1 }
      state.posts.push(post)
      state.credits = 1_000
      // cps is now 5× what it was when the post was made; the price does not follow it.
      const rich = derivedWith({ cps: 5 * 25 })
      const before = state.credits
      expect(upscalePost(ctxFor(state, CATALOG, rich), 'p1').error).toBeUndefined()
      const paid = before - state.credits
      expect(paid).toBe(Math.round(0.3 * 100))
      // The second wave pays 40 % more likes at the post's own rate: ≥ break-even for any landed roll.
      const wave = (post.targetLikes - 100) * post.creditsPerLike
      expect(wave).toBeGreaterThanOrEqual(paid)
      // A post saved before `cost` existed falls back to today's job cost.
      state.posts.push({ ...grantedPost(), id: 'legacy', cost: 0 })
      const legacyBefore = state.credits
      expect(upscalePost(ctxFor(state, CATALOG, rich), 'legacy').error).toBeUndefined()
      expect(legacyBefore - state.credits).toBeGreaterThan(paid)
    })
  })
})
