import { describe, expect, it } from 'vitest'

import { CATALOG } from '@/data'
import { buildIndex } from '@/game/catalog'
import {
  CLICK_JOB_BONUS_CAP,
  CLICK_JOB_BONUS_MS,
  FLOP_CHANCE_BASE,
  FOLLOW_RATE_BASE,
  MAX_POSTS,
  MAX_QUEUE,
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POWER_BUDGET_BASE,
  VIRAL_CHANCE_BASE,
} from '@/game/constants'
import { genTimeMs } from '@/game/hardware'
import { mulberry32 } from '@/game/rng'
import { createInitialState } from '@/game/state'
import {
  API_COST_MULT,
  MAX_PROMPT_CHARS,
  SPAGHETTI_FLAG,
  advanceQueue,
  applyClickToJobs,
  createJob,
  jobCost,
  jobDue,
  jobProgress,
} from '@/game/studio'
import type { Derived, GameState, Job, ModelDef, Post } from '@/game/types'

const T0 = 1_757_800_000_000
const { modelById, hardwareById } = buildIndex(CATALOG)
const model = (id: string): ModelDef => modelById[id] as ModelDef

/** A Derived built by hand — the studio only reads a handful of fields. */
function makeDerived(over: Partial<Derived> = {}): Derived {
  return {
    cps: 1,
    rawCps: 1,
    clickValue: 1,
    bestVram: 8,
    bestTier: 1,
    bestHardwareId: 'pc-4c8t',
    hasGpu: false,
    powerDraw: 65,
    powerBudget: POWER_BUDGET_BASE,
    throttled: false,
    concurrency: 1,
    speedMult: 1,
    likesMult: 1,
    payoutBonus: 0,
    followRate: FOLLOW_RATE_BASE,
    viralChance: VIRAL_CHANCE_BASE,
    flopChance: FLOP_CHANCE_BASE,
    offlineCapHours: OFFLINE_CAP_HOURS_BASE,
    offlineEfficiency: OFFLINE_EFFICIENCY,
    globalMult: 1,
    cpMult: 1,
    familyMult: {},
    rigMult: {},
    familyGenTime: {},
    coolingTier: {},
    tagLikes: {},
    unlockedFamilies: ['cpu', 'apple', 'nvidia-consumer', 'workstation', 'datacenter', 'cloud-node', 'region'],
    zluda: false,
    apiNodes: false,
    hashtagResearch: false,
    streakGrace: false,
    reservedCapacity: false,
    weekSpeed: 1,
    ...over,
  }
}

function freshState(credits = 1_000): GameState {
  const s = createInitialState(T0, 'guest')
  s.credits = credits
  return s
}

const sd15Input = (prompt = 'a cat', tags: string[] = []) => ({
  modelId: 'sd15',
  precision: 'native' as const,
  prompt,
  tags,
})

describe('jobCost', () => {
  const d = makeDerived({ cps: 100 })

  it('is max(baseCost, costSecs × cps) at native', () => {
    // sd15: baseCost 10, costSecs 4
    expect(jobCost(model('sd15'), 'native', makeDerived({ cps: 1 }), CATALOG)).toBe(10)
    expect(jobCost(model('sd15'), 'native', d, CATALOG)).toBe(400)
    expect(jobCost(model('flux-dev'), 'native', makeDerived({ cps: 0 }), CATALOG)).toBe(model('flux-dev').baseCost)
  })

  it('applies the precision cost multiplier', () => {
    expect(jobCost(model('sd15'), 'fp8', d, CATALOG)).toBe(Math.round(400 * CATALOG.precisions.fp8.costMult))
    expect(jobCost(model('sd15'), 'q4', d, CATALOG)).toBe(Math.round(400 * CATALOG.precisions.q4.costMult))
    expect(jobCost(model('sd15'), 'q4', d, CATALOG)).toBeLessThan(jobCost(model('sd15'), 'fp8', d, CATALOG))
  })

  it('charges API models the surcharge', () => {
    const kling = model('kling') // baseCost 1500, costSecs 12
    expect(kling.api).toBe(true)
    expect(jobCost(kling, 'native', makeDerived({ cps: 10 }), CATALOG)).toBe(Math.round(1500 * API_COST_MULT))
    expect(jobCost(kling, 'native', makeDerived({ cps: 1000 }), CATALOG)).toBe(Math.round(12_000 * API_COST_MULT))
  })
})

describe('createJob', () => {
  const rng = mulberry32(7)

  it('rejects unknown, unowned, un-set-up models and locked precisions', () => {
    const s = freshState()
    const d = makeDerived()
    expect(createJob(s, d, CATALOG, { ...sd15Input(), modelId: 'nope' }, T0, rng)).toEqual({ ok: false, reason: 'Unknown model' })
    expect(createJob(s, d, CATALOG, { ...sd15Input(), modelId: 'sdxl' }, T0, rng).ok).toBe(false)
    s.models.sdxl = { precisions: ['native'], setup: false }
    const r = createJob(s, d, CATALOG, { ...sd15Input(), modelId: 'sdxl' }, T0, rng)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not set up/)
    const p = createJob(s, d, CATALOG, { ...sd15Input(), precision: 'fp8' }, T0, rng)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toMatch(/FP8/)
    expect(s.queue).toHaveLength(0)
    expect(s.credits).toBe(1_000)
  })

  it('rejects models nothing owned can run', () => {
    const s = freshState(1e9)
    s.models['flux-dev'] = { precisions: ['native'], setup: true }
    const r = createJob(s, makeDerived(), CATALOG, { ...sd15Input(), modelId: 'flux-dev' }, T0, rng)
    expect(r).toEqual({ ok: false, reason: 'Nothing you own can run this' })
    // With a 4090 in the rack it runs (and on the 4090, not the CPU box).
    s.hardware['rtx-4090'] = 1
    const ok = createJob(s, makeDerived(), CATALOG, { ...sd15Input(), modelId: 'flux-dev' }, T0, rng)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.job.hardwareId).toBe('rtx-4090')
  })

  it('rejects when credits are short and when the queue is full', () => {
    const s = freshState(5)
    const d = makeDerived({ cps: 1 }) // sd15 costs 10
    expect(createJob(s, d, CATALOG, sd15Input(), T0, rng)).toEqual({ ok: false, reason: 'Not enough credits' })
    s.credits = 1_000
    for (let i = 0; i < MAX_QUEUE; i++) expect(createJob(s, d, CATALOG, sd15Input(), T0, rng).ok).toBe(true)
    const full = createJob(s, d, CATALOG, sd15Input(), T0, rng)
    expect(full.ok).toBe(false)
    if (!full.ok) expect(full.reason).toMatch(/Queue full/)
    expect(s.queue).toHaveLength(MAX_QUEUE)
    expect(s.credits).toBe(1_000 - MAX_QUEUE * 10)
  })

  it('deducts the cost and enqueues a pending job with the best-runnable duration', () => {
    const s = freshState(100)
    const d = makeDerived({ cps: 1 })
    const r = createJob(s, d, CATALOG, sd15Input('  a cat #cats  ', ['space', 'space', 'bogus']), T0, rng)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(s.credits).toBe(90)
    expect(s.queue).toEqual([r.job])
    expect(r.job).toMatchObject({
      modelId: 'sd15',
      precision: 'native',
      prompt: 'a cat #cats',
      tags: ['space'],
      hardwareId: 'pc-4c8t',
      cost: 10,
      createdAt: T0,
      startedAt: null,
      endsAt: null,
      clickBonusMs: 0,
    })
    expect(r.job.hubWorkflowId).toBeUndefined()
    expect(r.job.durationMs).toBeGreaterThan(0)
    expect(r.job.durationMs).toBe(genTimeMs(model('sd15'), 'native', hardwareById['pc-4c8t'] as never, d, CATALOG))
    expect(s.stats.lastPrompt).toBe('a cat #cats')
    // Ids are unique across the queue.
    const r2 = createJob(s, d, CATALOG, sd15Input(), T0, rng)
    if (r2.ok) expect(r2.job.id).not.toBe(r.job.id)
  })

  it('trims long prompts, keeps hubWorkflowId, and flags spaghetti', () => {
    const s = freshState(100)
    const r = createJob(
      s,
      makeDerived(),
      CATALOG,
      { ...sd15Input('a bowl of spaghetti '.repeat(40)), hubWorkflowId: 'wf-1' },
      T0,
      rng,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.job.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
    expect(r.job.hubWorkflowId).toBe('wf-1')
    expect(s.flags[SPAGHETTI_FLAG]).toBe(true)
  })
})

describe('advanceQueue', () => {
  function queued(n: number, credits = 10_000): { s: GameState; d: Derived; jobs: Job[] } {
    const s = freshState(credits)
    const d = makeDerived({ cps: 1 })
    const rng = mulberry32(3)
    const jobs: Job[] = []
    for (let i = 0; i < n; i++) {
      const r = createJob(s, d, CATALOG, sd15Input(`render ${i}`), T0, rng)
      if (r.ok) jobs.push(r.job)
    }
    expect(jobs).toHaveLength(n)
    return { s, d, jobs }
  }

  it('starts pending jobs up to concurrency, in order', () => {
    const { s, d, jobs } = queued(3)
    const rng = mulberry32(9)
    expect(advanceQueue(s, d, CATALOG, T0, rng)).toEqual([{ type: 'jobStarted', jobId: jobs[0]?.id }])
    expect(jobs[0]?.startedAt).toBe(T0)
    expect(jobs[0]?.endsAt).toBe(T0 + (jobs[0]?.durationMs ?? 0))
    expect(jobs[1]?.startedAt).toBeNull()
    // Nothing new while the slot is busy.
    expect(advanceQueue(s, d, CATALOG, T0 + 10, rng)).toEqual([])

    const wide = queued(3)
    const events = advanceQueue(wide.s, { ...wide.d, concurrency: 2 }, CATALOG, T0, rng)
    expect(events.map((e) => e.type)).toEqual(['jobStarted', 'jobStarted'])
    expect(wide.jobs[2]?.startedAt).toBeNull()
  })

  it('finishes due jobs into posts and reuses the freed slot in the same tick', () => {
    const { s, d, jobs } = queued(2)
    const rng = mulberry32(11)
    advanceQueue(s, d, CATALOG, T0, rng)
    const first = jobs[0] as Job
    const before = first.endsAt as number
    expect(advanceQueue(s, d, CATALOG, before - 1, rng)).toEqual([])
    expect(s.posts).toHaveLength(0)

    const events = advanceQueue(s, d, CATALOG, before, rng)
    expect(events.map((e) => e.type)).toEqual(['postCreated', 'jobStarted'])
    expect(s.queue).toEqual([jobs[1]])
    expect(jobs[1]?.startedAt).toBe(before)
    expect(s.posts).toHaveLength(1)
    expect(s.stats.posts).toBe(1)
    const post = s.posts[0] as Post
    expect(post).toMatchObject({
      id: `post-${first.id}`,
      modelId: 'sd15',
      kind: 'image',
      prompt: 'render 0',
      createdAt: before,
      likes: 0,
      granted: false,
    })
    expect(post.targetLikes).toBeGreaterThanOrEqual(0)
  })

  it('caps the feed at MAX_POSTS by dropping only granted posts', () => {
    const { s, d } = queued(1)
    const rng = mulberry32(5)
    const filler = (i: number, granted: boolean): Post => ({
      id: `old-${i}`,
      createdAt: T0 - i,
      modelId: 'sd15',
      kind: 'image',
      precision: 'native',
      prompt: '',
      tags: [],
      matchedTrending: [],
      thumb: '',
      cost: 10,
      targetLikes: 1,
      likes: 1,
      creditsPerLike: 0,
      creditsPaid: 0,
      windowMs: 1,
      viral: false,
      flop: false,
      founderBoost: false,
      followersGained: 0,
      granted,
      roll: 1,
      trendMult: 1,
    })
    for (let i = 0; i < MAX_POSTS; i++) s.posts.push(filler(i, i !== 0))
    advanceQueue(s, d, CATALOG, T0, rng)
    advanceQueue(s, d, CATALOG, T0 + 60_000, rng)
    expect(s.posts).toHaveLength(MAX_POSTS)
    expect(s.posts[0]?.id).toMatch(/^post-/)
    expect(s.posts.some((p) => p.id === 'old-0')).toBe(true) // ungranted survives
    expect(s.posts.some((p) => p.id === `old-${MAX_POSTS - 1}`)).toBe(false) // oldest granted dropped

    // A feed of live posts is never trimmed below its live count.
    const live = queued(1)
    for (let i = 0; i < MAX_POSTS; i++) live.s.posts.push(filler(i, false))
    advanceQueue(live.s, live.d, CATALOG, T0, rng)
    advanceQueue(live.s, live.d, CATALOG, T0 + 60_000, rng)
    expect(live.s.posts).toHaveLength(MAX_POSTS + 1)
  })

  it('refunds and drops a job whose model left the catalog', () => {
    const { s, d, jobs } = queued(1)
    const rng = mulberry32(1)
    advanceQueue(s, d, CATALOG, T0, rng)
    const credits = s.credits
    ;(jobs[0] as Job).modelId = 'vanished'
    expect(advanceQueue(s, d, CATALOG, T0 + 60_000, rng)).toEqual([])
    expect(s.queue).toHaveLength(0)
    expect(s.posts).toHaveLength(0)
    expect(s.credits).toBe(credits + (jobs[0]?.cost ?? 0))
  })
})

describe('applyClickToJobs', () => {
  it('does nothing without a running job', () => {
    const s = freshState()
    expect(applyClickToJobs(s, T0)).toBe(false)
    createJob(s, makeDerived(), CATALOG, sd15Input(), T0, mulberry32(1))
    expect(applyClickToJobs(s, T0)).toBe(false) // pending, not running
  })

  it('shaves CLICK_JOB_BONUS_MS off the earliest running job, capped at half its duration', () => {
    const s = freshState()
    const d = makeDerived({ concurrency: 2 })
    const rng = mulberry32(2)
    createJob(s, d, CATALOG, sd15Input('first'), T0, rng)
    createJob(s, d, CATALOG, sd15Input('second'), T0, rng)
    advanceQueue(s, d, CATALOG, T0, rng)
    const [a, b] = s.queue as [Job, Job]
    a.durationMs = 10_000
    a.endsAt = T0 + 10_000
    b.startedAt = T0 + 1 // later start → 'a' is the earliest
    b.durationMs = 20_000
    b.endsAt = T0 + 20_001

    const cap = CLICK_JOB_BONUS_CAP * a.durationMs
    let clicks = 0
    while (applyClickToJobs(s, T0 + 100)) clicks += 1
    expect(a.clickBonusMs).toBe(cap)
    expect(b.clickBonusMs).toBe(0)
    expect(clicks).toBe(Math.ceil(cap / CLICK_JOB_BONUS_MS))
    expect(jobDue(a, T0 + 10_000 - cap)).toBe(true)
    expect(jobDue(a, T0 + 10_000 - cap - 1)).toBe(false)
    expect(jobProgress(a, T0 + 1_000)).toBeCloseTo((1_000 + cap) / 10_000, 10)
    // A job that is already due is skipped in favour of the next running one.
    expect(applyClickToJobs(s, T0 + 10_000)).toBe(true)
    expect(b.clickBonusMs).toBe(CLICK_JOB_BONUS_MS)
  })
})
