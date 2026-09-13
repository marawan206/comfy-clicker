/**
 * Posting: a finished job becomes a Post whose likes trickle in over POST_WINDOW_MS and pay
 * credits at a fixed rate per like, so the card's `likes × credits/like = credits` always adds up.
 *
 *   targetLikes    = max(1, round(M × trend × quality × baseLikes × audience × likesMult × tagBonus
 *                                 × eventBoost × founder))
 *   credits        = (payoutRatio + payoutBonus) × paid × M × quality
 *   creditsPerLike = credits / targetLikes
 *
 * where `paid` is the job cost before the API surcharge (`job.cost / API_COST_MULT` for API
 * models, the surcharge is a fee, not a bigger bet). Credits depend on the roll and the
 * precision only: reach (trend, audience, likesMult, tag bonuses, events, founder) moves likes,
 * and likes move followers, signups and contracts, never the payout. A native post therefore
 * returns E[M] ≈ 1.23 × payoutRatio of its cost whatever the player has unlocked, and the Studio
 * stays a side income next to the rack instead of replacing it.
 *
 * One post breaks the sign, not the rule: a post whose *explicit* tags name a kind the model is
 * not (`#videogen` on SD 1.5) is **ratioed**. It rolls in the flop band with every reach
 * multiplier skipped, collects `RATIO_DISLIKE_MULT×` dislikes instead of likes, and each
 * dislike takes `creditsPerLike` out of the bank instead of paying it in. Nothing it does
 * touches `lifetimeLikes`, `lifetimeCredits`, `seasonCredits` or `lifetimeFollowers`, so XP,
 * achievements and the leaderboard never see it. Keyword hits are not explicit tags: "a cat in
 * motion" on an image model is prose, not a claim, and is never punished.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import {
  API_COST_MULT,
  FOUNDER_BOOST_CHANCE,
  POST_WINDOW_MS,
  RATIOED_FLAG,
  RATIO_DISLIKE_MULT,
  RATIO_LOSS_MULT,
  REPOST_PENALTY,
  VIRAL_FOLLOW_MULT, HUB_RUN_LIKES_BOOST } from '@/game/constants'
import { eventLikesBoost, isEventActive } from '@/game/events'
import {
  currentTrending,
  matchTags,
  matchedTrending,
  mismatchedTypeTags,
  normalizePromptText,
  trendMult,
} from '@/game/hashtags'
import { chance, hashString, uniform } from '@/game/rng'
import { addFollowers, audienceMult, removeFollowers } from '@/game/social'
import type { Derived, GameEvent, GameState, Job, ModelDef, Post, Rng } from '@/game/types'

/** Likes multiplier when a founder notices you (lucky roll or a name-drop). */
export const FOUNDER_BOOST_MULT = 3
/** A matched hashtag with `family` affinity for the post's model family adds this much. */
export const FAMILY_AFFINITY_BONUS = 0.1
/** Roll bands for the multiplier M: viral, flop, and everything in between. */
export const VIRAL_ROLL: readonly [number, number] = [3, 8]
export const FLOP_ROLL: readonly [number, number] = [0.3, 0.6]
export const NORMAL_ROLL: readonly [number, number] = [0.85, 1.35]
/** Set the first time a prompt name-drops a founder (the boost works once). */
export const FOUNDER_MENTION_FLAG = 'founderMention'
/** A roll under `NEAR_VIRAL_BAND × viralChance` missed the viral band by a hair. */
export const NEAR_VIRAL_BAND = 2
/** Each post landed in a row adds this to likes, capped at LANDED_STREAK_MAX. */
export const LANDED_STREAK_STEP = 0.025
export const LANDED_STREAK_MAX = 0.25

const FOUNDER_RE = /(^| )(yoland[a-z]*|robin|robinjhuang|comfyanonymous)( |$)/

/** Does the prompt name-drop a founder? Word-boundary, case-insensitive. */
export function mentionsFounder(prompt: string): boolean {
  return FOUNDER_RE.test(normalizePromptText(prompt))
}

/**
 * Thumbnail keyword for a post (`Post.thumb`): the first prompt word that is one of the model's
 * `thumbTags`, else a stable pick from the pool by prompt hash. This is a *keyword*, not an asset
 * id. The UI resolves it with the asset manifest:
 * `assetManifest.pickThumb(thumbFamilyFor(post.modelId, post.kind), post.prompt, hashString(post.prompt))`.
 */
export function pickThumbTag(model: ModelDef, prompt: string): string {
  const pool = model.thumbTags
  if (pool.length === 0) return ''
  const words = normalizePromptText(prompt).trim().split(' ')
  const tags = new Set(pool.map((t) => t.toLowerCase()))
  for (const word of words) if (word && tags.has(word)) return word
  return pool[hashString(prompt) % pool.length] as string
}

/**
 * Repost identity of a post, stored in `stats.lastPostKey`: model id, sorted matched hashtag ids
 * and the normalised prompt (lowercase, punctuation collapsed), so "A cat!" and "a cat" are the
 * same post while "a kitten" is not.
 */
export function repostKey(modelId: string, matched: readonly string[], prompt: string): string {
  return `${modelId}|${[...matched].sort().join(',')}|${normalizePromptText(prompt).trim()}`
}

/**
 * Turn a finished job into a Post. Mutates `state.stats.lastPostKey`, the one-shot
 * `founderMention` flag, and (through `eventLikesBoost`) consumes a caught trending spark.
 * A ratioed post consumes neither: the spark and the name-drop survive for the next honest post.
 */
export function rollPost(
  job: Job,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  now: number,
  rng: Rng,
): Post {
  const { modelById, hashtagById } = buildIndex(catalog)
  const model = modelById[job.modelId]
  if (!model) throw new Error(`rollPost: unknown model ${job.modelId}`)
  const precision = catalog.precisions[job.precision] ?? catalog.precisions.native

  // Tags first: an explicit type tag naming a kind this model does not make is a claim the post
  // cannot back up, and that decides the band before anything is drawn.
  const { matched, keywordHits, explicit } = matchTags(job.prompt, job.tags, catalog)
  const mismatched = mismatchedTypeTags(explicit, model.kind, catalog)
  const ratioed = mismatched.length > 0

  // The roll: viral, flop, or an honest day's work. One draw settles the viral band so a roll
  // that missed it by a hair is knowable (`nearViral`) instead of indistinguishable from a
  // normal day. A ratio skips the bands: it flops by construction.
  let roll: number
  let viral = false
  let flop = false
  let nearViral = false
  if (ratioed) {
    flop = true
    roll = uniform(rng, FLOP_ROLL[0], FLOP_ROLL[1])
  } else {
    const u = rng()
    if (u < derived.viralChance) {
      viral = true
      roll = uniform(rng, VIRAL_ROLL[0], VIRAL_ROLL[1])
    } else {
      nearViral = u < NEAR_VIRAL_BAND * derived.viralChance
      if (chance(rng, derived.flopChance)) {
        flop = true
        roll = uniform(rng, FLOP_ROLL[0], FLOP_ROLL[1])
      } else {
        roll = uniform(rng, NORMAL_ROLL[0], NORMAL_ROLL[1])
      }
    }
  }

  // Trend. A ratio rides nothing: trend is a flat 1, so the repost penalty is moot too.
  const trending = currentTrending(state, now, catalog, derived.weekSpeed)
  let trend = 1
  // Same model, tag set and prompt as the previous post reads as a repost; reach is halved. A new
  // prompt with the same tags is a new post (otherwise every untagged post on one model would be
  // a repost of the last).
  const postKey = repostKey(job.modelId, matched, job.prompt)
  if (!ratioed) {
    trend = trendMult(matched, trending, keywordHits, model.kind, catalog)
    if (state.stats.lastPostKey === postKey) trend *= REPOST_PENALTY
  }
  state.stats.lastPostKey = postKey

  // Audience, tag bonuses, events, founder.
  const quality = precision.qualityMult
  const audience = audienceMult(state.followers)
  // Payout: roll and precision only (see the header). The API surcharge is a fee on top of the bet.
  const paid = model.api ? job.cost / API_COST_MULT : job.cost

  let targetLikes: number
  let credits: number
  let founder = false
  let founderRepost = false
  if (ratioed) {
    // Dislikes, not likes: the mismatch travels further than the post would have. Audience and
    // likesMult still apply (a bigger account gets ratioed harder); nothing else does, and the
    // spark, the name-drop and the founder roll are all left alone for the next honest post.
    targetLikes = Math.max(1, Math.round(RATIO_DISLIKE_MULT * roll * model.baseLikes * audience * derived.likesMult))
    // Stored positive. The sign lives in `ratioed`, and `settlePosts` subtracts it.
    credits = RATIO_LOSS_MULT * paid * roll
  } else {
    let tagBonus = 1
    for (const id of matched) {
      tagBonus *= 1 + (derived.tagLikes[id] ?? 0)
      if (hashtagById[id]?.family === model.family) tagBonus *= 1 + FAMILY_AFFINITY_BONUS
    }
    // Founder repost window and a caught trending spark (events.ts owns both; consumes the spark).
    founderRepost = isEventActive(state, 'founderRepost')
    const eventBoost = eventLikesBoost(state)
    founder = chance(rng, FOUNDER_BOOST_CHANCE)
    if (!founder && state.flags[FOUNDER_MENTION_FLAG] !== true && mentionsFounder(job.prompt)) {
      // Name-dropping works exactly once. They saw it.
      state.flags[FOUNDER_MENTION_FLAG] = true
      founder = true
    }
    const founderMult = founder ? FOUNDER_BOOST_MULT : 1
    // Running somebody's ComfyHub workflow borrows their audience: a flat likes boost for the runner.
    const hubMult = job.hubWorkflowId !== undefined ? HUB_RUN_LIKES_BOOST : 1
    // Posts that keep landing compound, up to LANDED_STREAK_MAX. Likes only: the payout below
    // never sees it, so the EV bands are exactly what they were.
    const streakMult = 1 + Math.min(LANDED_STREAK_MAX, LANDED_STREAK_STEP * landedStreak(state))

    // Even a flop gets one like (the alt account). Also keeps credits/like finite.
    targetLikes = Math.max(
      1,
      Math.round(
        roll *
          trend *
          quality *
          model.baseLikes *
          audience *
          derived.likesMult *
          tagBonus *
          eventBoost *
          founderMult *
          hubMult *
          streakMult,
      ),
    )
    credits = Math.max(0, (model.payoutRatio + derived.payoutBonus) * paid * roll * quality)
  }
  const creditsPerLike = credits / targetLikes

  const post: Post = {
    id: `post-${job.id}`,
    createdAt: now,
    modelId: model.id,
    kind: model.kind,
    precision: job.precision,
    prompt: job.prompt,
    tags: [...job.tags],
    matchedTrending: matchedTrending(matched, trending, model.kind, catalog),
    thumb: pickThumbTag(model, job.prompt),
    cost: job.cost,
    targetLikes,
    likes: 0,
    creditsPerLike,
    creditsPaid: 0,
    windowMs: POST_WINDOW_MS,
    viral,
    flop,
    founderBoost: founder || founderRepost,
    followersGained: 0,
    granted: false,
    roll,
    trendMult: trend,
  }
  if (job.hubWorkflowId !== undefined) post.hubWorkflowId = job.hubWorkflowId
  if (nearViral) post.nearViral = true
  if (ratioed) {
    post.ratioed = true
    post.mismatchedTags = mismatched
    state.flags[RATIOED_FLAG] = true
  }
  return post
}

/** Consecutive posts that landed, sanitised (a corrupt save must not multiply likes by NaN). */
function landedStreak(state: GameState): number {
  const n = state.stats.landedStreak
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Fraction of the like window elapsed, clamped to [0, 1]. */
export function postProgress(post: Post, now: number): number {
  if (!(post.windowMs > 0)) return 1
  const p = (now - post.createdAt) / post.windowMs
  return p <= 0 ? 0 : p >= 1 ? 1 : p
}

/** Likes shown at `now`: ease-out cubic toward `targetLikes`, landing exactly on it. */
export function likesAt(post: Post, now: number): number {
  const p = postProgress(post, now)
  const q = 1 - p
  return Math.floor(post.targetLikes * (1 - q * q * q))
}

/**
 * Pay out newly arrived likes on every live post and grant completed ones once: followers,
 * stats, `granted`, and a `postResolved` event. A post whose target was raised after granting
 * (upscale) keeps paying its new likes but is not granted twice.
 *
 * A ratioed post runs the same clock with the sign flipped: its `targetLikes` are dislikes, each
 * one takes `creditsPerLike` out of the bank (floored at zero, `creditsPaid` still accumulating
 * the loss as a positive number so the card can render the minus), and on completion it drives
 * followers away. `lifetimeLikes`, `lifetimeCredits`, `seasonCredits`, `lifetimeFollowers` and
 * `bestPostLikes` never move for one: those feed XP, achievements and the leaderboard, and a
 * ratio is not an accomplishment.
 */
export function settlePosts(
  state: GameState,
  derived: Derived,
  // Contract signature; every lookup is snapshotted on the post at roll time.
  _catalog: Catalog,
  now: number,
): GameEvent[] {
  const events: GameEvent[] = []
  for (const post of state.posts) {
    if (post.granted && post.likes >= post.targetLikes) continue
    const ratioed = post.ratioed === true
    const likes = Math.max(post.likes, likesAt(post, now))
    if (likes > post.likes) {
      const delta = likes - post.likes
      const pay = delta * post.creditsPerLike
      post.likes = likes
      post.creditsPaid += pay
      if (ratioed) {
        state.credits = Math.max(0, state.credits - pay)
        state.stats.dislikes += delta
      } else {
        state.credits += pay
        state.lifetimeCredits += pay
        state.seasonCredits += pay
        state.lifetimeLikes += delta
      }
    }
    if (!post.granted && postProgress(post, now) >= 1) {
      const before = state.followers
      if (ratioed) {
        removeFollowers(state, Math.floor(post.targetLikes * derived.followRate))
      } else {
        const gain = post.targetLikes * derived.followRate * (post.viral ? VIRAL_FOLLOW_MULT : 1)
        events.push(...addFollowers(state, gain))
      }
      post.followersGained = state.followers - before
      if (post.kind === 'video') state.stats.videos += 1
      if (post.flop) state.stats.flops += 1
      if (post.viral) state.stats.virals += 1
      if (ratioed) state.stats.ratioed += 1
      if (!ratioed && post.targetLikes > state.stats.bestPostLikes) state.stats.bestPostLikes = post.targetLikes
      // The landed streak: every post that neither flopped nor got ratioed extends it.
      if (post.flop || ratioed) {
        state.stats.landedStreak = 0
      } else {
        state.stats.landedStreak += 1
        if (state.stats.landedStreak > state.stats.bestLandedStreak) {
          state.stats.bestLandedStreak = state.stats.landedStreak
        }
      }
      post.granted = true
      events.push({
        type: 'postResolved',
        postId: post.id,
        viral: post.viral,
        flop: post.flop,
        ratioed,
      })
    }
  }
  return events
}
