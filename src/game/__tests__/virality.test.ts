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
  RATIOED_FLAG,
  RATIO_DISLIKE_MULT,
  RATIO_LOSS_MULT,
  REPOST_PENALTY,
  SIGNUP_THRESHOLDS,
  VIRAL_CHANCE_BASE,
  VIRAL_FOLLOW_MULT, HUB_RUN_LIKES_BOOST } from '@/game/constants'
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
  LANDED_STREAK_MAX,
  LANDED_STREAK_STEP,
  NEAR_VIRAL_BAND,
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
/** What `calm` draws inside the flop band, which is where a ratio is forced. */
const RATIO_ROLL = FLOP_ROLL[0] + (FLOP_ROLL[1] - FLOP_ROLL[0]) * 0.99

/**
 * E[M] for the contract's roll bands. Credits follow the roll alone. The founder boost (like
 * every other reach multiplier) moves likes, not payout, so the founder chance is not in here.
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

  it('every model (image, video, 3d, audio and API) stays inside its band analytically', () => {
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

  it('a correctly typed tag pays exactly what an untagged post pays', () => {
    // The penalty fires on a mismatch and on nothing else: #videogen on a video model is an
    // honest label, so the EV bands above apply to it unchanged.
    const wan = model('wan22-5b')
    const state = freshState()
    const d = makeDerived()
    const plain = rollPost(makeJob('wan22-5b', { cost: 1000 }), state, d, CATALOG, T0, calm)
    state.stats.lastPostKey = ''
    const tagged = rollPost(makeJob('wan22-5b', { cost: 1000, tags: ['videogen'] }), state, d, CATALOG, T0, calm)
    expect(tagged.ratioed).toBeUndefined()
    expect(tagged.flop).toBe(false)
    expect(tagged.mismatchedTags).toBeUndefined()
    expect(tagged.targetLikes * tagged.creditsPerLike).toBeCloseTo(plain.targetLikes * plain.creditsPerLike, 6)
    expect(tagged.targetLikes * tagged.creditsPerLike).toBeCloseTo(wan.payoutRatio * 1000 * CALM_ROLL, 6)
    expect(state.flags[RATIOED_FLAG]).toBeUndefined()

    // And over the whole distribution: same seed, same draws, same credits to the last bit.
    const evFor = (tags: string[]): number => {
      const st = freshState()
      const rng = mulberry32(hashString('typed-tag'))
      const job = makeJob('wan22-5b', { cost: 1000, tags })
      let credits = 0
      for (let i = 0; i < 5_000; i++) {
        st.stats.lastPostKey = ''
        const post = rollPost(job, st, makeDerived(), CATALOG, T0, rng)
        credits += post.targetLikes * post.creditsPerLike
      }
      return credits / (5_000 * 1000)
    }
    const untaggedEv = evFor([])
    expect(evFor(['videogen'])).toBe(untaggedEv)
    expect(untaggedEv / expectedEv(wan)).toBeGreaterThan(0.94)
    expect(untaggedEv / expectedEv(wan)).toBeLessThan(1.06)
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

    // A new prompt is a new post, even with the same (empty) tag set; untagged posts on one
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
      { type: 'postResolved', postId: 'v', viral: true, flop: false, ratioed: false },
      { type: 'postResolved', postId: 'f', viral: false, flop: true, ratioed: false },
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

  it('a job run from a ComfyHub workflow earns the runner a flat likes boost, never extra credits', () => {
    const state = freshState()
    state.weekOverride = 3
    const plain = rollPost(makeJob('sd15', { cost: 500 }), state, makeDerived(), CATALOG, T0, calm)
    state.stats.lastPostKey = ''
    const fromHub = rollPost(makeJob('sd15', { cost: 500, hubWorkflowId: 'wf-1' }), state, makeDerived(), CATALOG, T0, calm)
    expect(fromHub.targetLikes).toBe(Math.max(1, Math.round(plain.targetLikes * HUB_RUN_LIKES_BOOST)))
    expect(fromHub.targetLikes * fromHub.creditsPerLike).toBeCloseTo(plain.targetLikes * plain.creditsPerLike, 6)
    expect(fromHub.hubWorkflowId).toBe('wf-1')
  })

})

// ---------------------------------------------------------------------------
// Ratioed: an explicit type tag the model cannot back up
// ---------------------------------------------------------------------------
describe('rollPost ratioed', () => {
  const sd15 = model('sd15')
  /** #videogen on SD 1.5: the tag says video, the pixels do not move. */
  const ratioJob = (over: Partial<Job> = {}): Job => makeJob('sd15', { cost: 500, tags: ['videogen'], ...over })

  it('forces the flop band, kills the trend, and collects dislikes instead of likes', () => {
    const state = freshState()
    const post = rollPost(ratioJob(), state, makeDerived(), CATALOG, T0, calm)
    expect(post.ratioed).toBe(true)
    expect(post.mismatchedTags).toEqual(['videogen'])
    expect(post.viral).toBe(false)
    expect(post.flop).toBe(true)
    expect(post.nearViral).toBeUndefined()
    expect(post.roll).toBeCloseTo(RATIO_ROLL, 10)
    expect(post.roll).toBeGreaterThanOrEqual(FLOP_ROLL[0])
    expect(post.roll).toBeLessThanOrEqual(FLOP_ROLL[1])
    expect(post.trendMult).toBe(1)
    expect(post.founderBoost).toBe(false)
    expect(state.flags[RATIOED_FLAG]).toBe(true)

    // Dislikes: RATIO_DISLIKE_MULT × what the roll would have earned.
    expect(post.targetLikes).toBe(Math.round(RATIO_DISLIKE_MULT * RATIO_ROLL * sd15.baseLikes))
    // The bill, stored positive. The sign lives in `ratioed`.
    const loss = RATIO_LOSS_MULT * 500 * RATIO_ROLL
    expect(post.targetLikes * post.creditsPerLike).toBeCloseTo(loss, 6)
    expect(post.creditsPerLike).toBeGreaterThan(0)
  })

  it('skips every reach multiplier and consumes neither the spark nor the name-drop', () => {
    const state = freshState()
    state.weekOverride = 3
    state.flags.sparkNext = true
    state.events.active.push({ defId: 'ev-founder-repost', kind: 'founderRepost', startedAt: T0 - 1, endsAt: T0 + 60_000 })
    const trending = currentTrending(state, T0, CATALOG, 1)
    const tag = trending.find((id) => hashtagById[id]?.kind === undefined) as string
    const post = rollPost(
      ratioJob({ prompt: 'cc @yoland', tags: ['videogen', tag] }),
      state,
      makeDerived({ tagLikes: { [tag]: 2 } }),
      CATALOG,
      T0,
      calm,
    )
    // No trending ride, no tagLikes, no event boost, no founder, no hub boost.
    expect(post.trendMult).toBe(1)
    expect(post.founderBoost).toBe(false)
    expect(post.targetLikes).toBe(Math.round(RATIO_DISLIKE_MULT * RATIO_ROLL * sd15.baseLikes))
    // Both one-shots survive for the next honest post. That is the whole point.
    expect(state.flags.sparkNext).toBe(true)
    expect(state.flags[FOUNDER_MENTION_FLAG]).toBeUndefined()
    // A hub run gets no borrowed audience either.
    state.stats.lastPostKey = ''
    const hub = rollPost(ratioJob({ hubWorkflowId: 'wf-1' }), state, makeDerived(), CATALOG, T0, calm)
    expect(hub.targetLikes).toBe(post.targetLikes)
  })

  it('still scales with audience and likesMult: a bigger account gets ratioed harder', () => {
    const state = freshState()
    state.followers = 9 * AUDIENCE_REF_DIVISOR // audience = 2
    const post = rollPost(ratioJob(), state, makeDerived({ likesMult: 1.5 }), CATALOG, T0, calm)
    expect(post.targetLikes).toBe(Math.round(RATIO_DISLIKE_MULT * RATIO_ROLL * sd15.baseLikes * 2 * 1.5))
    // The bill is unchanged: reach moves dislikes, the roll moves credits, same as always.
    expect(post.targetLikes * post.creditsPerLike).toBeCloseTo(RATIO_LOSS_MULT * 500 * RATIO_ROLL, 6)
  })

  it('a keyword hit never ratios a post, only a tag the player put there', () => {
    const state = freshState()
    // 'motion' is a #videogen keyword. On an image model that is prose, not a claim.
    const prose = rollPost(makeJob('sd15', { cost: 500, prompt: 'a cat in motion' }), state, makeDerived(), CATALOG, T0, calm)
    expect(prose.ratioed).toBeUndefined()
    expect(prose.flop).toBe(false)
    expect(state.flags[RATIOED_FLAG]).toBeUndefined()
    // The same word typed as a literal tag is a claim, and it costs.
    state.stats.lastPostKey = ''
    const literal = rollPost(makeJob('sd15', { cost: 500, prompt: 'a cat #videogen' }), state, makeDerived(), CATALOG, T0, calm)
    expect(literal.ratioed).toBe(true)
    expect(literal.mismatchedTags).toEqual(['videogen'])
  })

  it('lists several mismatches in catalog order and leaves honest tags alone', () => {
    const state = freshState()
    const post = rollPost(
      makeJob('sd15', { cost: 500, prompt: '#musicgen art', tags: ['3dgen', 'cats'] }),
      state,
      makeDerived(),
      CATALOG,
      T0,
      calm,
    )
    expect(post.mismatchedTags).toEqual(['3dgen', 'musicgen'])
    // A 3D model posting #3dgen is telling the truth, whatever else is on the post.
    state.stats.lastPostKey = ''
    const honest = rollPost(makeJob('hunyuan3d-21', { cost: 500, tags: ['3dgen'] }), state, makeDerived(), CATALOG, T0, calm)
    expect(honest.ratioed).toBeUndefined()
  })

  it('the damage is 130 to 160 % of one job: the sunk cost plus the bill', () => {
    const state = freshState()
    const rng = mulberry32(hashString('ratio-damage'))
    const cost = 500
    for (let i = 0; i < 2_000; i++) {
      state.stats.lastPostKey = ''
      const post = rollPost(ratioJob({ cost }), state, makeDerived(), CATALOG, T0, rng)
      const swing = (cost + post.targetLikes * post.creditsPerLike) / cost
      expect(swing).toBeGreaterThanOrEqual(1.3)
      expect(swing).toBeLessThanOrEqual(1.6)
    }
  })
})

describe('settlePosts on a ratioed post', () => {
  function ratioPost(over: Partial<Post> = {}): Post {
    return {
      id: 'r',
      createdAt: T0,
      modelId: 'sd15',
      kind: 'image',
      precision: 'native',
      prompt: 'a cat',
      tags: ['videogen'],
      matchedTrending: [],
      thumb: '',
      cost: 500,
      targetLikes: 1000,
      likes: 0,
      creditsPerLike: 0.31,
      creditsPaid: 0,
      windowMs: POST_WINDOW_MS,
      viral: false,
      flop: true,
      founderBoost: false,
      followersGained: 0,
      granted: false,
      ratioed: true,
      mismatchedTags: ['videogen'],
      roll: 0.5,
      trendMult: 1,
      ...over,
    }
  }

  it('drains the bank, banks the dislikes, and leaves every lifetime counter alone', () => {
    const state = freshState()
    state.credits = 1000
    state.lifetimeCredits = 5000
    state.seasonCredits = 4000
    state.lifetimeLikes = 77
    const p = ratioPost()
    state.posts.push(p)
    for (let ms = 0; ms <= POST_WINDOW_MS + 1000; ms += 33) settlePosts(state, makeDerived(), CATALOG, T0 + ms)
    expect(p.likes).toBe(1000)
    expect(state.credits).toBeCloseTo(1000 - 310, 6)
    // `creditsPaid` is the loss, positive; the card renders the minus.
    expect(p.creditsPaid).toBeCloseTo(310, 6)
    expect(state.stats.dislikes).toBe(1000)
    // XP, achievements and the leaderboard never see a ratio.
    expect(state.lifetimeCredits).toBe(5000)
    expect(state.seasonCredits).toBe(4000)
    expect(state.lifetimeLikes).toBe(77)
    expect(state.stats.bestPostLikes).toBe(0)
  })

  it('floors the bank at zero instead of going negative', () => {
    const state = freshState()
    state.credits = 50
    const p = ratioPost()
    state.posts.push(p)
    settlePosts(state, makeDerived(), CATALOG, T0 + POST_WINDOW_MS)
    expect(state.credits).toBe(0)
    expect(p.creditsPaid).toBeCloseTo(310, 6) // the whole bill, whether or not it could be paid
    expect(state.stats.dislikes).toBe(1000)
  })

  it('drives followers away, never below zero, and counts the flop and the ratio', () => {
    const state = freshState()
    state.credits = 1000
    state.followers = 100
    state.lifetimeFollowers = 900
    const p = ratioPost()
    state.posts.push(p)
    const events = settlePosts(state, makeDerived(), CATALOG, T0 + POST_WINDOW_MS)
    const lost = Math.floor(1000 * FOLLOW_RATE_BASE)
    expect(lost).toBeGreaterThan(0)
    expect(state.followers).toBe(100 - lost)
    expect(p.followersGained).toBe(-lost)
    expect(state.lifetimeFollowers).toBe(900) // signups already earned are never revoked
    expect(state.signups).toBe(0)
    expect(state.stats.flops).toBe(1)
    expect(state.stats.ratioed).toBe(1)
    expect(state.stats.virals).toBe(0)
    expect(events.filter((e) => e.type === 'postResolved')).toEqual([
      { type: 'postResolved', postId: 'r', viral: false, flop: true, ratioed: true },
    ])
    expect(p.granted).toBe(true)
    // Settling again is a no-op.
    expect(settlePosts(state, makeDerived(), CATALOG, T0 + POST_WINDOW_MS * 2)).toEqual([])
    expect(state.stats.ratioed).toBe(1)
  })

  it('takes the last followers without going negative', () => {
    const state = freshState()
    state.credits = 1000
    state.followers = 10
    state.posts.push(ratioPost())
    settlePosts(state, makeDerived(), CATALOG, T0 + POST_WINDOW_MS)
    expect(state.followers).toBe(0)
  })

  it('an ordinary post next door still pays normally', () => {
    const state = freshState()
    state.credits = 1000
    state.posts.push(
      ratioPost(),
      ratioPost({ id: 'ok', ratioed: false, flop: false, mismatchedTags: undefined, targetLikes: 100, creditsPerLike: 1 }),
    )
    settlePosts(state, makeDerived(), CATALOG, T0 + POST_WINDOW_MS)
    expect(state.credits).toBeCloseTo(1000 - 310 + 100, 6)
    expect(state.lifetimeCredits).toBeCloseTo(100, 6)
    expect(state.lifetimeLikes).toBe(100)
    expect(state.stats.dislikes).toBe(1000)
    expect(state.stats.ratioed).toBe(1)
  })

  it('round trips from rollPost: the bill charged equals the bill rolled', () => {
    const state = freshState()
    state.credits = 10_000
    const p = rollPost(makeJob('sd15', { cost: 500, tags: ['videogen'] }), state, makeDerived(), CATALOG, T0, mulberry32(9))
    state.posts.push(p)
    for (let ms = 0; ms <= POST_WINDOW_MS; ms += 50) settlePosts(state, makeDerived(), CATALOG, T0 + ms)
    expect(state.credits).toBeCloseTo(10_000 - p.targetLikes * p.creditsPerLike, 6)
    expect(state.stats.dislikes).toBe(p.targetLikes)
  })
})

// ---------------------------------------------------------------------------
// Near viral and the landed streak
// ---------------------------------------------------------------------------
describe('near viral', () => {
  it('fires at about the viral rate, never alongside viral, and never touches credits', () => {
    const ROLLS = 20_000
    const state = freshState()
    const derived = makeDerived()
    const rng = mulberry32(hashString('near-viral'))
    const job = makeJob('sd15', { cost: 500 })
    const sd15 = model('sd15')
    let near = 0
    let virals = 0
    let credits = 0
    for (let i = 0; i < ROLLS; i++) {
      state.stats.lastPostKey = ''
      const post = rollPost(job, state, derived, CATALOG, T0, rng)
      if (post.nearViral === true) {
        near += 1
        expect(post.viral).toBe(false)
        // A near miss is a near miss: no boost of its own, just a label. (The founder roll is
        // independent and still lands on about one post in a hundred.)
        const founder = post.founderBoost ? FOUNDER_BOOST_MULT : 1
        expect(post.targetLikes).toBe(Math.max(1, Math.round(post.roll * sd15.baseLikes * founder)))
      }
      if (post.viral) {
        virals += 1
        expect(post.nearViral).toBeUndefined()
      }
      credits += post.targetLikes * post.creditsPerLike
    }
    expect(NEAR_VIRAL_BAND).toBe(2)
    const rate = near / ROLLS
    expect(rate).toBeGreaterThan(derived.viralChance * 0.8)
    expect(rate).toBeLessThan(derived.viralChance * 1.2)
    expect(virals / ROLLS).toBeGreaterThan(0.04)
    // The EV is exactly the one the bands pin: near viral is cosmetic.
    const ev = credits / (ROLLS * 500)
    expect(ev / expectedEv(sd15)).toBeGreaterThan(0.97)
    expect(ev / expectedEv(sd15)).toBeLessThan(1.03)
  })
})

describe('landed streak', () => {
  const sd15 = model('sd15')

  it('multiplies likes by 1 + 0.025 per landed post, capped at +25%', () => {
    const state = freshState()
    const base = Math.round(CALM_ROLL * sd15.baseLikes)
    const likesAtStreak = (n: number): number => {
      state.stats.landedStreak = n
      state.stats.lastPostKey = ''
      return rollPost(makeJob('sd15', { cost: 500 }), state, makeDerived(), CATALOG, T0, calm).targetLikes
    }
    expect(likesAtStreak(0)).toBe(base)
    expect(likesAtStreak(4)).toBe(Math.round(CALM_ROLL * sd15.baseLikes * (1 + 4 * LANDED_STREAK_STEP)))
    expect(likesAtStreak(10)).toBe(Math.round(CALM_ROLL * sd15.baseLikes * (1 + LANDED_STREAK_MAX)))
    // Capped: streak 11 and streak 1000 pay the same.
    expect(likesAtStreak(11)).toBe(likesAtStreak(1_000))
    expect(likesAtStreak(1_000)).toBe(Math.round(CALM_ROLL * sd15.baseLikes * (1 + LANDED_STREAK_MAX)))
    // Garbage in a save cannot multiply likes by NaN.
    expect(likesAtStreak(Number.NaN)).toBe(base)
    expect(likesAtStreak(-5)).toBe(base)
  })

  it('leaves credits exactly where they were, so the EV bands are untouched', () => {
    const state = freshState()
    const expected = model('sd15').payoutRatio * 500 * CALM_ROLL
    for (const n of [0, 3, 10, 40]) {
      state.stats.landedStreak = n
      state.stats.lastPostKey = ''
      const post = rollPost(makeJob('sd15', { cost: 500 }), state, makeDerived(), CATALOG, T0, calm)
      expect(post.targetLikes * post.creditsPerLike, `streak ${n}`).toBeCloseTo(expected, 6)
    }
  })

  it('settlePosts extends it on a landing and zeroes it on a flop or a ratio', () => {
    const state = freshState()
    state.credits = 10_000
    const land = (over: Partial<Post>): void => {
      state.posts.length = 0
      state.posts.push({
        id: `p-${state.stats.posts++}`,
        createdAt: T0,
        modelId: 'sd15',
        kind: 'image',
        precision: 'native',
        prompt: '',
        tags: [],
        matchedTrending: [],
        thumb: '',
        cost: 100,
        targetLikes: 100,
        likes: 0,
        creditsPerLike: 0.1,
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
      })
      settlePosts(state, makeDerived(), CATALOG, T0 + POST_WINDOW_MS)
    }
    land({})
    land({})
    land({})
    expect(state.stats.landedStreak).toBe(3)
    expect(state.stats.bestLandedStreak).toBe(3)
    land({ flop: true })
    expect(state.stats.landedStreak).toBe(0)
    expect(state.stats.bestLandedStreak).toBe(3)
    land({})
    land({})
    expect(state.stats.landedStreak).toBe(2)
    land({ flop: true, ratioed: true })
    expect(state.stats.landedStreak).toBe(0)
    expect(state.stats.bestLandedStreak).toBe(3)
    // A viral post lands like any other.
    land({ viral: true })
    expect(state.stats.landedStreak).toBe(1)
  })
})
