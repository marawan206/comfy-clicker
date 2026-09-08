import { describe, expect, it } from 'vitest'

import { CATALOG } from '@/data'
import { buildIndex } from '@/game/catalog'
import {
  API_COST_MULT,
  AUDIENCE_REF_DIVISOR,
  FLOP_CHANCE_BASE,
  FOLLOW_RATE_BASE,
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POST_WINDOW_MS,
  POWER_BUDGET_BASE,
  REPOST_PENALTY,
  SIGNUP_THRESHOLDS,
  VIRAL_CHANCE_BASE,
  VIRAL_FOLLOW_MULT,
} from '@/game/constants'
import { currentTrending } from '@/game/hashtags'
import { hashString, mulberry32 } from '@/game/rng'
import { addFollowers, audienceMult, nextSignupAt, signupThreshold } from '@/game/social'
import { createInitialState } from '@/game/state'
import type { Derived, GameState, Job, ModelDef, Post, Rng } from '@/game/types'
import {
  FAMILY_AFFINITY_BONUS,
  FLOP_ROLL,
  FOUNDER_BOOST_MULT,
  FOUNDER_MENTION_FLAG,
  NORMAL_ROLL,
  VIRAL_ROLL,
  likesAt,
  mentionsFounder,
  pickThumbTag,
  postProgress,
  repostKey,
  rollPost,
  settlePosts,
} from '@/game/virality'

const T0 = 1_757_800_000_000
const { modelById, hashtagById } = buildIndex(CATALOG)
const model = (id: string): ModelDef => modelById[id] as ModelDef

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

function makeJob(modelId: string, over: Partial<Job> = {}): Job {
  return {
    id: `j-${modelId}`,
    modelId,
    precision: 'native',
    prompt: 'untitled',
    tags: [],
    hardwareId: 'pc-4c8t',
    cost: model(modelId).baseCost,
    durationMs: 4000,
    createdAt: T0 - 4000,
    startedAt: T0 - 4000,
    endsAt: T0,
    clickBonusMs: 0,
    ...over,
  }
}

function freshState(): GameState {
  return createInitialState(T0, 'guest')
}

/** An rng that never rolls viral, flop or founder: M = 0.85 + 0.5 × 0.99, deterministic. */
const calm: Rng = () => 0.99
const CALM_ROLL = NORMAL_ROLL[0] + (NORMAL_ROLL[1] - NORMAL_ROLL[0]) * 0.99

/**
 * E[M] for the contract's roll bands. Credits follow the roll alone — the founder boost (like
 * every other reach multiplier) moves likes, not payout — so the founder chance is not in here.
 */
const EXPECTED_MULT = (() => {
  const mean = (r: readonly [number, number]) => (r[0] + r[1]) / 2
  const v = VIRAL_CHANCE_BASE
  const f = FLOP_CHANCE_BASE
  return v * mean(VIRAL_ROLL) + (1 - v) * (f * mean(FLOP_ROLL) + (1 - f) * mean(NORMAL_ROLL))
})()
/** Expected credits per credit spent, net of the API surcharge for API models. */
const expectedEv = (m: ModelDef): number => (EXPECTED_MULT * m.payoutRatio) / (m.api ? API_COST_MULT : 1)

// ---------------------------------------------------------------------------
// EV bands
// ---------------------------------------------------------------------------
describe('rollPost expected value (20k rolls, untagged native)', () => {
  const ROLLS = 20_000
  /** The contract band for local models (see the balance notes in models.ts). */
  const BAND: readonly [number, number] = [1.05, 1.6]
  /** API models pay the surcharge as a fee: roughly break-even, rented for reach and convenience. */
  const API_BAND: readonly [number, number] = [0.95, 1.1]
  const bandFor = (m: ModelDef) => (m.api ? API_BAND : BAND)

  for (const id of ['sd15', 'flux-dev', 'wan22-5b', 'wan22-14b', 'kling']) {
    it(`${id}: EV/cost in band, viral rate 4–6%`, () => {
      const m = model(id)
      const state = freshState()
      const derived = makeDerived({ apiNodes: true })
      const rng = mulberry32(hashString(id))
      // Job cost as `jobCost` would charge it: API models carry the surcharge.
      const job = makeJob(id, { cost: m.baseCost * (m.api ? API_COST_MULT : 1) })
      let credits = 0
      let virals = 0
      let flops = 0
      for (let i = 0; i < ROLLS; i++) {
        state.stats.lastPostKey = '' // each roll is a fresh post, not a repost
        const post = rollPost(job, state, derived, CATALOG, T0, rng)
        credits += post.targetLikes * post.creditsPerLike
        if (post.viral) virals += 1
        if (post.flop) flops += 1
        expect(post.viral && post.flop).toBe(false)
      }
      const ev = credits / (ROLLS * job.cost)
      const [lo, hi] = bandFor(m)
      expect(ev, `${id} EV/cost ${ev.toFixed(3)}`).toBeGreaterThanOrEqual(lo)
      expect(ev, `${id} EV/cost ${ev.toFixed(3)}`).toBeLessThanOrEqual(hi)
      // Identity: EV/cost = E[M] × payoutRatio (÷ surcharge for API), within sampling noise.
      expect(ev / expectedEv(m)).toBeGreaterThan(0.97)
      expect(ev / expectedEv(m)).toBeLessThan(1.03)
      const viralRate = virals / ROLLS
      expect(viralRate).toBeGreaterThanOrEqual(0.04)
      expect(viralRate).toBeLessThanOrEqual(0.06)
      const flopRate = flops / ROLLS
      expect(flopRate).toBeGreaterThan(0.12)
      expect(flopRate).toBeLessThan(0.16)
    })
  }

  it('every model — image, video, 3d, audio and API — stays inside its band analytically', () => {
    expect(CATALOG.models.some((m) => m.kind === 'video')).toBe(true)
    expect(CATALOG.models.some((m) => m.api)).toBe(true)
    for (const m of CATALOG.models) {
      const ev = expectedEv(m)
      const [lo, hi] = bandFor(m)
      expect(ev, `${m.id} EV/cost ${ev.toFixed(3)}`).toBeGreaterThanOrEqual(lo)
      expect(ev, `${m.id} EV/cost ${ev.toFixed(3)}`).toBeLessThanOrEqual(hi)
    }
  })

  it('reach multipliers move likes, never credits, so the band survives every upgrade', () => {
    const state = freshState()
    state.weekOverride = 3
    const trending = currentTrending(state, T0, CATALOG, 1)
    const tag = trending.find((id) => hashtagById[id]?.kind === undefined) as string
    const plain = rollPost(makeJob('sd15', { cost: 500 }), state, makeDerived(), CATALOG, T0, calm)
    const credits = plain.targetLikes * plain.creditsPerLike
    expect(credits).toBeCloseTo(model('sd15').payoutRatio * 500 * CALM_ROLL, 6)
    // Trending tag ×2, likesMult ×5, followers, a founder repost and a caught spark: 60× the likes…
    state.stats.lastPostKey = ''
    state.followers = 9 * AUDIENCE_REF_DIVISOR
    state.flags.sparkNext = true
    state.events.active.push({ defId: 'ev-founder-repost', kind: 'founderRepost', startedAt: T0 - 1, endsAt: T0 + 60_000 })
    const stacked = rollPost(makeJob('sd15', { cost: 500, tags: [tag] }), state, makeDerived({ likesMult: 5 }), CATALOG, T0, calm)
    expect(stacked.targetLikes).toBeGreaterThan(plain.targetLikes * 50)
    // …and exactly the same credits (up to the rounding of likes).
    expect(stacked.targetLikes * stacked.creditsPerLike).toBeCloseTo(credits, 6)
    // A payout bonus and the precision still move credits: they are the payout side.
    state.stats.lastPostKey = ''
    state.events.active.length = 0
    state.followers = 0
    const bonus = rollPost(makeJob('sd15', { cost: 500 }), state, makeDerived({ payoutBonus: 0.5 }), CATALOG, T0, calm)
    expect(bonus.targetLikes * bonus.creditsPerLike).toBeCloseTo((model('sd15').payoutRatio + 0.5) * 500 * CALM_ROLL, 6)
  })

  it('pays API models on the pre-surcharge cost', () => {
    const state = freshState()
    const kling = model('kling')
    const post = rollPost(makeJob('kling', { cost: 1500 }), state, makeDerived({ apiNodes: true }), CATALOG, T0, calm)
    expect(post.targetLikes * post.creditsPerLike).toBeCloseTo((kling.payoutRatio * 1500 * CALM_ROLL) / API_COST_MULT, 6)
    expect(post.cost).toBe(1500)
  })
})

// ---------------------------------------------------------------------------
// The multiplier stack
// ---------------------------------------------------------------------------
describe('rollPost multipliers', () => {
  it('snapshots the roll and pays likes × cpl = payoutRatio × cost', () => {
    const state = freshState()
    const job = makeJob('sd15', { cost: 500 })
    const post = rollPost(job, state, makeDerived(), CATALOG, T0, calm)
    expect(post.roll).toBeCloseTo(CALM_ROLL, 10)
    expect(post.trendMult).toBe(1)
    expect(post.viral).toBe(false)
    expect(post.flop).toBe(false)
    expect(post.founderBoost).toBe(false)
    expect(post.targetLikes).toBe(Math.round(CALM_ROLL * model('sd15').baseLikes))
    // Credits = payoutRatio × cost × roll, spread evenly over the likes.
    expect(post.creditsPerLike).toBeCloseTo((model('sd15').payoutRatio * 500 * CALM_ROLL) / post.targetLikes, 10)
    expect(post.cost).toBe(500)
    expect(post.windowMs).toBe(POST_WINDOW_MS)
    expect(post.createdAt).toBe(T0)
    expect(post.id).toBe(`post-${job.id}`)
    expect(post.matchedTrending).toEqual([])
    expect(post.granted).toBe(false)
    expect(post.likes).toBe(0)
    expect(post.creditsPaid).toBe(0)
    expect(state.stats.lastPostKey).toBe('sd15||untitled')
  })

  it('repostKey is model | sorted matched tags | normalised prompt', () => {
    expect(repostKey('sd15', [], 'untitled')).toBe('sd15||untitled')
    expect(repostKey('sd15', ['comfyui', 'cats'], '  A Cat!!  ')).toBe('sd15|cats,comfyui|a cat')
    expect(repostKey('sd15', [], '')).toBe('sd15||')
  })

  it('applies the repost penalty to the same model + tags + prompt, and lifts it when any of them changes', () => {
    const state = freshState()
    const d = makeDerived()
    const a = rollPost(makeJob('sd15'), state, d, CATALOG, T0, calm)
    const b = rollPost(makeJob('sd15'), state, d, CATALOG, T0, calm)
    expect(a.trendMult).toBe(1)
    expect(b.trendMult).toBeCloseTo(REPOST_PENALTY, 10)
    expect(b.targetLikes).toBe(Math.round(a.targetLikes * REPOST_PENALTY))
    expect(state.stats.lastPostKey).toBe(repostKey('sd15', [], 'untitled'))

    // A new prompt is a new post, even with the same (empty) tag set — untagged posts on one
    // model are not all reposts of each other.
    const c = rollPost(makeJob('sd15', { prompt: 'a cat' }), state, d, CATALOG, T0, calm)
    expect(c.trendMult).toBeCloseTo(1 + 0.1, 10) // 'cat' is one keyword hit
    // Same tag set (#cats) but a different prompt: still a new post.
    const e = rollPost(makeJob('sd15', { prompt: 'a kitten' }), state, d, CATALOG, T0, calm)
    expect(e.trendMult).toBeCloseTo(1 + 0.1, 10)
    // Word-for-word repost, however capitalised or punctuated: penalised.
    const g = rollPost(makeJob('sd15', { prompt: 'A kitten!!' }), state, d, CATALOG, T0, calm)
    expect(g.trendMult).toBeCloseTo((1 + 0.1) * REPOST_PENALTY, 10)
    expect(state.stats.lastPostKey).toBe('sd15|cats|a kitten')

    // Same prompt with one more selected tag: the tag set changed, so it is not a repost. The
    // spare tag is chosen off this week's trending board so it cannot move trendMult itself.
    const trending = new Set(currentTrending(state, T0, CATALOG, 1))
    const spare = CATALOG.hashtags.find((h) => h.kind === undefined && h.id !== 'cats' && !trending.has(h.id))
    expect(spare).toBeDefined()
    const h = rollPost(makeJob('sd15', { prompt: 'a kitten', tags: [spare!.id] }), state, d, CATALOG, T0, calm)
    expect(h.trendMult).toBeCloseTo(1 + 0.1, 10)
    expect(state.stats.lastPostKey).toBe(repostKey('sd15', ['cats', spare!.id], 'a kitten'))
    // Same prompt and tags on another model: not a repost either.
    const i = rollPost(makeJob('sdxl', { prompt: 'a kitten', tags: [spare!.id] }), state, d, CATALOG, T0, calm)
    expect(i.trendMult).toBeCloseTo(1 + 0.1, 10)
    // Back to the untagged default prompt: a fresh key again.
    const f = rollPost(makeJob('sd15'), state, d, CATALOG, T0, calm)
    expect(f.trendMult).toBe(1)
  })

  it('rides the trending board: one matched trending tag doubles reach', () => {
    const state = freshState()
    state.weekOverride = 3
    const trending = currentTrending(state, T0, CATALOG, 1)
    const tag = trending.find((id) => hashtagById[id]?.kind === undefined) as string
    expect(tag).toBeDefined()
    const plain = rollPost(makeJob('sd15'), state, makeDerived(), CATALOG, T0, calm)
    const tagged = rollPost(makeJob('sd15', { tags: [tag] }), state, makeDerived(), CATALOG, T0, calm)
    expect(tagged.trendMult).toBeCloseTo(2, 10)
    expect(tagged.matchedTrending).toEqual([tag])
    expect(tagged.targetLikes).toBe(Math.round(plain.targetLikes * 2))
    expect(tagged.tags).toEqual([tag])
  })

  it('multiplies quality, audience, likesMult, tagLikes, family affinity and events', () => {
    const state = freshState()
    const basePost = rollPost(makeJob('sd15'), state, makeDerived(), CATALOG, T0, calm)
    const base = basePost.targetLikes
    const sd15 = model('sd15')

    state.stats.lastPostKey = ''
    const fp8 = rollPost(makeJob('sd15', { precision: 'fp8' }), state, makeDerived(), CATALOG, T0, calm)
    expect(fp8.targetLikes).toBe(Math.round(CALM_ROLL * sd15.baseLikes * CATALOG.precisions.fp8.qualityMult))
    expect(fp8.precision).toBe('fp8')

    state.stats.lastPostKey = ''
    const liked = rollPost(makeJob('sd15'), state, makeDerived({ likesMult: 1.5 }), CATALOG, T0, calm)
    expect(liked.targetLikes).toBe(Math.round(CALM_ROLL * sd15.baseLikes * 1.5))

    // Audience scales likes up and credits-per-like down: credits are unchanged.
    state.stats.lastPostKey = ''
    state.followers = 9 * AUDIENCE_REF_DIVISOR // audience = 1 + log10(10) = 2
    const reach = rollPost(makeJob('sd15'), state, makeDerived(), CATALOG, T0, calm)
    expect(audienceMult(state.followers)).toBeCloseTo(2, 10)
    expect(reach.targetLikes).toBe(Math.round(CALM_ROLL * sd15.baseLikes * 2))
    expect(reach.targetLikes * reach.creditsPerLike).toBeCloseTo(basePost.targetLikes * basePost.creditsPerLike, 6)
    state.followers = 0

    // tagLikes (a trained LoRA on #cats) and the sd family affinity of #sd15forever.
    state.stats.lastPostKey = ''
    const lora = rollPost(makeJob('sd15', { prompt: 'a cat' }), state, makeDerived({ tagLikes: { cats: 0.25 } }), CATALOG, T0, calm)
    expect(lora.targetLikes).toBe(Math.round(CALM_ROLL * 1.1 * sd15.baseLikes * 1.25))
    state.stats.lastPostKey = ''
    const affinity = rollPost(makeJob('sd15', { tags: ['sd15forever'] }), state, makeDerived(), CATALOG, T0, calm)
    expect(hashtagById.sd15forever?.family).toBe(sd15.family)
    expect(affinity.targetLikes).toBe(Math.round(CALM_ROLL * sd15.baseLikes * (1 + FAMILY_AFFINITY_BONUS)))

    // A founder repost window triples likes and marks the card.
    state.stats.lastPostKey = ''
    state.events.active.push({ defId: 'ev-founder-repost', kind: 'founderRepost', startedAt: T0 - 1, endsAt: T0 + 60_000 })
    const reposted = rollPost(makeJob('sd15'), state, makeDerived(), CATALOG, T0, calm)
    expect(reposted.targetLikes).toBe(Math.round(CALM_ROLL * sd15.baseLikes * 3))
    expect(reposted.founderBoost).toBe(true)
    state.events.active.length = 0

    // A caught trending spark is a one-shot ×3.
    state.stats.lastPostKey = ''
    state.flags.sparkNext = true
    const spark = rollPost(makeJob('sd15'), state, makeDerived(), CATALOG, T0, calm)
    expect(spark.targetLikes).toBe(Math.round(CALM_ROLL * sd15.baseLikes * 3))
    expect(spark.founderBoost).toBe(false)
    expect(state.flags.sparkNext).toBeUndefined()
    state.stats.lastPostKey = ''
    expect(rollPost(makeJob('sd15'), state, makeDerived(), CATALOG, T0, calm).targetLikes).toBe(base)
  })

  it('name-dropping a founder works exactly once', () => {
    const state = freshState()
    const d = makeDerived()
    expect(mentionsFounder('thanks Yoland!')).toBe(true)
    expect(mentionsFounder('robin made this')).toBe(true)
    expect(mentionsFounder('a robins nest')).toBe(false)
    const first = rollPost(makeJob('sd15', { prompt: 'cc @yoland' }), state, d, CATALOG, T0, calm)
    expect(first.founderBoost).toBe(true)
    expect(first.targetLikes).toBe(Math.round(CALM_ROLL * model('sd15').baseLikes * FOUNDER_BOOST_MULT))
    expect(state.flags[FOUNDER_MENTION_FLAG]).toBe(true)
    state.stats.lastPostKey = ''
    const second = rollPost(makeJob('sd15', { prompt: 'cc @yoland' }), state, d, CATALOG, T0, calm)
    expect(second.founderBoost).toBe(false)
    expect(second.targetLikes).toBe(Math.round(CALM_ROLL * model('sd15').baseLikes))
  })

  it('applies the payout bonus to credits per like and keeps hubWorkflowId', () => {
    const state = freshState()
    const post = rollPost(makeJob('sd15', { cost: 100, hubWorkflowId: 'wf' }), state, makeDerived({ payoutBonus: 0.2 }), CATALOG, T0, calm)
    expect(post.creditsPerLike).toBeCloseTo(((model('sd15').payoutRatio + 0.2) * 100 * CALM_ROLL) / post.targetLikes, 10)
    expect(post.hubWorkflowId).toBe('wf')
    expect(post.kind).toBe('image')
  })

  it('pickThumbTag prefers a prompt word from the pool, else a stable hash pick', () => {
    const flux = model('flux-dev')
    expect(pickThumbTag(flux, 'a CAT in a neon city')).toBe('cat')
    expect(pickThumbTag(flux, 'robot vs castle')).toBe('robot')
    const fallback = pickThumbTag(flux, 'nothing here matches')
    expect(flux.thumbTags).toContain(fallback)
    expect(pickThumbTag(flux, 'nothing here matches')).toBe(fallback)
    expect(pickThumbTag(flux, 'catalog')).not.toBe('cat')
    expect(pickThumbTag({ ...flux, thumbTags: [] }, 'x')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------
describe('likesAt / settlePosts', () => {
  function post(over: Partial<Post> = {}): Post {
    return {
      id: 'p',
      createdAt: T0,
      modelId: 'sd15',
      kind: 'image',
      precision: 'native',
      prompt: '',
      tags: [],
      matchedTrending: [],
      thumb: '',
      cost: 100,
      targetLikes: 1000,
      likes: 0,
      creditsPerLike: 0.37,
      creditsPaid: 0,
      windowMs: POST_WINDOW_MS,
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

  it('likesAt is monotone from 0 to targetLikes over the window (ease-out)', () => {
    const p = post()
    let prev = -1
    for (let ms = -100; ms <= POST_WINDOW_MS + 100; ms += 50) {
      const likes = likesAt(p, T0 + ms)
      expect(likes).toBeGreaterThanOrEqual(prev)
      expect(likes).toBeLessThanOrEqual(p.targetLikes)
      prev = likes
    }
    expect(likesAt(p, T0)).toBe(0)
    expect(likesAt(p, T0 - 5)).toBe(0)
    expect(likesAt(p, T0 + POST_WINDOW_MS)).toBe(1000)
    expect(likesAt(p, T0 + POST_WINDOW_MS * 10)).toBe(1000)
    expect(likesAt(p, T0 + POST_WINDOW_MS / 2)).toBe(875) // 1 − 0.5³
    expect(postProgress(p, T0 + POST_WINDOW_MS / 4)).toBe(0.25)
    // Front-loaded: more than half the likes land in the first quarter.
    expect(likesAt(p, T0 + POST_WINDOW_MS / 4)).toBeGreaterThan(500)
  })

  it('pays likes × cpl in increments that sum to targetLikes × cpl, then grants once', () => {
    const state = freshState()
    const derived = makeDerived()
    const p = post({ targetLikes: 1234, creditsPerLike: 0.37 })
    state.posts.push(p)
    let paid = 0
    let resolved = 0
    for (let ms = 0; ms <= POST_WINDOW_MS + 1000; ms += 33) {
      const before = state.credits
      const events = settlePosts(state, derived, CATALOG, T0 + ms)
      paid += state.credits - before
      resolved += events.filter((e) => e.type === 'postResolved').length
      expect(state.credits).toBeCloseTo(p.likes * p.creditsPerLike, 6)
    }
    expect(p.likes).toBe(1234)
    expect(paid).toBeCloseTo(1234 * 0.37, 6)
    expect(p.creditsPaid).toBeCloseTo(1234 * 0.37, 6)
    expect(state.credits).toBeCloseTo(1234 * 0.37, 6)
    expect(state.lifetimeCredits).toBeCloseTo(1234 * 0.37, 6)
    expect(state.seasonCredits).toBeCloseTo(1234 * 0.37, 6)
    expect(state.lifetimeLikes).toBe(1234)
    expect(p.granted).toBe(true)
    expect(resolved).toBe(1)
    expect(state.stats.bestPostLikes).toBe(1234)
    // Followers: targetLikes × followRate, banked whole.
    expect(state.followers).toBe(Math.floor(1234 * FOLLOW_RATE_BASE))
    expect(p.followersGained).toBe(state.followers)
    expect(state.signups).toBe(1) // the first follower signs up
    expect(state.rp).toBe(1)
    // Settling again is a no-op.
    expect(settlePosts(state, derived, CATALOG, T0 + 60_000)).toEqual([])
    expect(state.credits).toBeCloseTo(1234 * 0.37, 6)
  })

  it('settles everything at once after a long gap and counts videos, flops and virals', () => {
    const state = freshState()
    const derived = makeDerived()
    state.posts.push(
      post({ id: 'v', kind: 'video', viral: true, targetLikes: 100, creditsPerLike: 1 }),
      post({ id: 'f', flop: true, targetLikes: 10, creditsPerLike: 1 }),
      post({ id: 'done', granted: true, likes: 5, targetLikes: 5, creditsPerLike: 1 }),
    )
    const events = settlePosts(state, derived, CATALOG, T0 + 60_000)
    const resolved = events.filter((e) => e.type === 'postResolved')
    expect(resolved).toEqual([
      { type: 'postResolved', postId: 'v', viral: true, flop: false },
      { type: 'postResolved', postId: 'f', viral: false, flop: true },
    ])
    expect(state.credits).toBe(110)
    expect(state.stats.videos).toBe(1)
    expect(state.stats.virals).toBe(1)
    expect(state.stats.flops).toBe(1)
    expect(state.stats.bestPostLikes).toBe(100)
    // Viral posts pull VIRAL_FOLLOW_MULT× the followers.
    const expectedFollowers = Math.floor(100 * FOLLOW_RATE_BASE * VIRAL_FOLLOW_MULT + 10 * FOLLOW_RATE_BASE)
    expect(state.followers).toBe(expectedFollowers)
  })

  it('keeps paying a granted post whose target was raised (upscale) without re-granting', () => {
    const state = freshState()
    const p = post({ granted: true, likes: 100, targetLikes: 100, creditsPerLike: 2, creditsPaid: 200 })
    state.posts.push(p)
    p.targetLikes = 140
    const events = settlePosts(state, makeDerived(), CATALOG, T0 + POST_WINDOW_MS)
    expect(events).toEqual([])
    expect(p.likes).toBe(140)
    expect(state.credits).toBe(80)
    expect(p.creditsPaid).toBe(280)
  })

  it('rollPost → settlePosts round trip pays exactly targetLikes × cpl', () => {
    const state = freshState()
    const derived = makeDerived()
    const p = rollPost(makeJob('wan22-5b', { cost: 1000 }), state, derived, CATALOG, T0, mulberry32(4))
    state.posts.push(p)
    for (let ms = 0; ms <= POST_WINDOW_MS; ms += 50) settlePosts(state, derived, CATALOG, T0 + ms)
    expect(state.credits).toBeCloseTo(p.targetLikes * p.creditsPerLike, 6)
    expect(state.stats.videos).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------
describe('social', () => {
  it('signup thresholds follow the table then double', () => {
    SIGNUP_THRESHOLDS.forEach((t, i) => expect(signupThreshold(i)).toBe(t))
    const n = SIGNUP_THRESHOLDS.length
    const last = SIGNUP_THRESHOLDS[n - 1] as number
    expect(signupThreshold(n)).toBe(last * 2)
    expect(signupThreshold(n + 2)).toBe(last * 8)
  })

  it('addFollowers banks fractions, grants signups at thresholds, and pays rp', () => {
    const state = freshState()
    expect(addFollowers(state, 0.4)).toEqual([])
    expect(state.followers).toBe(0)
    expect(state.followersFrac).toBeCloseTo(0.4, 10)
    expect(addFollowers(state, 0.6)).toEqual([{ type: 'signup', total: 1 }]) // first follower signs up
    expect(state.followers).toBe(1)
    expect(state.lifetimeFollowers).toBe(1)
    expect(state.followersFrac).toBeCloseTo(0, 10)
    expect(state.signups).toBe(1)
    expect(state.rp).toBe(1)
    expect(nextSignupAt(state)).toBe(100)

    expect(addFollowers(state, 98)).toEqual([])
    expect(state.signups).toBe(1)
    expect(addFollowers(state, 1)).toEqual([{ type: 'signup', total: 2 }])
    expect(state.lifetimeFollowers).toBe(100)
    expect(state.rp).toBe(2)

    // One big jump crosses several thresholds at once: 250, 500, 1000, 2500.
    const events = addFollowers(state, 2400)
    expect(events.map((e) => (e.type === 'signup' ? e.total : -1))).toEqual([3, 4, 5, 6])
    expect(state.signups).toBe(6)
    expect(state.rp).toBe(6)
    expect(nextSignupAt(state)).toBe(5000)

    // Followers lost (unfollows elsewhere) do not undo lifetime progress.
    state.followers = 0
    expect(addFollowers(state, 2500)).toEqual([{ type: 'signup', total: 7 }])
    expect(state.lifetimeFollowers).toBe(5000)

    // Garbage in, nothing out.
    expect(addFollowers(state, -5)).toEqual([])
    expect(addFollowers(state, Number.NaN)).toEqual([])
    expect(state.followers).toBe(2500)
  })

  it('audienceMult is 1 at zero followers and grows logarithmically', () => {
    expect(audienceMult(0)).toBe(1)
    expect(audienceMult(AUDIENCE_REF_DIVISOR * 9)).toBeCloseTo(2, 10)
    expect(audienceMult(AUDIENCE_REF_DIVISOR * 99)).toBeCloseTo(3, 10)
    expect(audienceMult(-10)).toBe(1)
  })
})
