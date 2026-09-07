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
 * models — the surcharge is a fee, not a bigger bet). Credits depend on the roll and the
 * precision only: reach (trend, audience, likesMult, tag bonuses, events, founder) moves likes,
 * and likes move followers, signups and contracts — never the payout. A native post therefore
 * returns E[M] ≈ 1.23 × payoutRatio of its cost whatever the player has unlocked, and the Studio
 * stays a side income next to the rack instead of replacing it.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import {
  API_COST_MULT,
  FOUNDER_BOOST_CHANCE,
  POST_WINDOW_MS,
  REPOST_PENALTY,
  VIRAL_FOLLOW_MULT,
} from '@/game/constants'
import { eventLikesBoost, isEventActive } from '@/game/events'
import { currentTrending, matchTags, matchedTrending, normalizePromptText, trendMult } from '@/game/hashtags'
import { chance, hashString, uniform } from '@/game/rng'
import { addFollowers, audienceMult } from '@/game/social'
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

const FOUNDER_RE = /(^| )(yoland[a-z]*|robin|robinjhuang|comfyanonymous)( |$)/

/** Does the prompt name-drop a founder? Word-boundary, case-insensitive. */
export function mentionsFounder(prompt: string): boolean {
  return FOUNDER_RE.test(normalizePromptText(prompt))
}

/**
 * Thumbnail keyword for a post (`Post.thumb`): the first prompt word that is one of the model's
 * `thumbTags`, else a stable pick from the pool by prompt hash. This is a *keyword*, not an asset
 * id — the UI resolves it with the asset manifest:
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

  // The roll: viral, flop, or an honest day's work.
  let roll: number
  let viral = false
  let flop = false
  if (chance(rng, derived.viralChance)) {
    viral = true
    roll = uniform(rng, VIRAL_ROLL[0], VIRAL_ROLL[1])
  } else if (chance(rng, derived.flopChance)) {
    flop = true
    roll = uniform(rng, FLOP_ROLL[0], FLOP_ROLL[1])
  } else {
    roll = uniform(rng, NORMAL_ROLL[0], NORMAL_ROLL[1])
  }

  // Tags and trend.
  const { matched, keywordHits } = matchTags(job.prompt, job.tags, catalog)
  const trending = currentTrending(state, now, catalog, derived.weekSpeed)
  let trend = trendMult(matched, trending, keywordHits, model.kind, catalog)
  // Same model, tag set and prompt as the previous post reads as a repost; reach is halved. A new
  // prompt with the same tags is a new post (otherwise every untagged post on one model would be
  // a repost of the last).
  const postKey = repostKey(job.modelId, matched, job.prompt)
  if (state.stats.lastPostKey === postKey) trend *= REPOST_PENALTY
  state.stats.lastPostKey = postKey

  // Audience, tag bonuses, events, founder.
  const quality = precision.qualityMult
  const audience = audienceMult(state.followers)
  let tagBonus = 1
  for (const id of matched) {
    tagBonus *= 1 + (derived.tagLikes[id] ?? 0)
    if (hashtagById[id]?.family === model.family) tagBonus *= 1 + FAMILY_AFFINITY_BONUS
  }
  // Founder repost window and a caught trending spark (events.ts owns both; consumes the spark).
  const founderRepost = isEventActive(state, 'founderRepost')
  const eventBoost = eventLikesBoost(state)
  let founder = chance(rng, FOUNDER_BOOST_CHANCE)
  if (!founder && state.flags[FOUNDER_MENTION_FLAG] !== true && mentionsFounder(job.prompt)) {
    // Name-dropping works exactly once. They saw it.
    state.flags[FOUNDER_MENTION_FLAG] = true
    founder = true
  }
  const founderMult = founder ? FOUNDER_BOOST_MULT : 1

  // Even a flop gets one like (the alt account). Also keeps credits/like finite.
  const targetLikes = Math.max(
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
        founderMult,
    ),
  )
  // Payout: roll and precision only (see the header). The API surcharge is a fee on top of the bet.
  const paid = model.api ? job.cost / API_COST_MULT : job.cost
  const credits = Math.max(0, (model.payoutRatio + derived.payoutBonus) * paid * roll * quality)
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
  return post
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
    const likes = Math.max(post.likes, likesAt(post, now))
    if (likes > post.likes) {
      const delta = likes - post.likes
      const pay = delta * post.creditsPerLike
      post.likes = likes
      post.creditsPaid += pay
      state.credits += pay
      state.lifetimeCredits += pay
      state.seasonCredits += pay
      state.lifetimeLikes += delta
    }
    if (!post.granted && postProgress(post, now) >= 1) {
      const gain = post.targetLikes * derived.followRate * (post.viral ? VIRAL_FOLLOW_MULT : 1)
      const before = state.followers
      events.push(...addFollowers(state, gain))
      post.followersGained = state.followers - before
      if (post.kind === 'video') state.stats.videos += 1
      if (post.flop) state.stats.flops += 1
      if (post.viral) state.stats.virals += 1
      if (post.targetLikes > state.stats.bestPostLikes) state.stats.bestPostLikes = post.targetLikes
      post.granted = true
      events.push({ type: 'postResolved', postId: post.id, viral: post.viral, flop: post.flop })
    }
  }
  return events
}
