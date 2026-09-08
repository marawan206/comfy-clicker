/**
 * X / Twitter via two keyless endpoints: fxtwitter's JSON API (rich: media, avatar, counts) with the
 * Twitter syndication CDN as fallback. Curated status ids come from the founder seed.
 */
import { realPostsSeed } from '@/data/realPostsSeed'
import { isOfficialHandle } from '@/server/feed/normalize'
import type { FeedItem, FeedItemStats, SourceResult, XProfile } from '@/server/feed/types'
import { errorMessage, fetchJson, getNumber, getPath, getString, isRecord, mapLimit, toIso } from '@/server/feed/util'

export const X_OFFICIAL_HANDLE = 'ComfyUI'
const FX_API = 'https://api.fxtwitter.com'
const SYNDICATION_API = 'https://cdn.syndication.twimg.com/tweet-result'
/** Snowflake epoch: ms offset added to `id >> 22`. */
const TWITTER_EPOCH_MS = 1288834974657
const CONCURRENCY = 4

export interface XTarget {
  user: string
  id: string
  url: string
}

/** `{ user, id }` from an x.com / twitter.com status URL. */
export function tweetRef(url: string): { user: string; id: string } | null {
  const m = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/.exec(url)
  return m ? { user: m[1], id: m[2] } : null
}

/** Creation time from a snowflake id: the top 42 bits are ms since the Twitter epoch. */
export function tweetDate(id: string): string {
  return new Date(Number((BigInt(id) >> BigInt(22)) + BigInt(TWITTER_EPOCH_MS))).toISOString()
}

export function curatedTweets(): XTarget[] {
  const out: XTarget[] = []
  for (const post of realPostsSeed) {
    if (post.platform !== 'x') continue
    const ref = tweetRef(post.url)
    if (ref) out.push({ ...ref, url: post.url })
  }
  return out
}

/** Twitter serves `_normal` (48px) avatars by default; ask for the 400px rendition. */
export function upscaleTwitterAvatar(url: string | null): string | null {
  return url ? url.replace(/_(normal|bigger|mini)(\.\w+)$/, '_400x400$2') : null
}

function statsOf(values: Partial<Record<keyof FeedItemStats, number | null>>): FeedItemStats | undefined {
  const stats: FeedItemStats = {}
  for (const [k, v] of Object.entries(values)) if (typeof v === 'number') stats[k as keyof FeedItemStats] = v
  return Object.keys(stats).length ? stats : undefined
}

/** Parse an fxtwitter `/user/status/id` response. */
export function parseFxTweet(json: unknown, target: { user: string; id: string }): FeedItem | null {
  const tweet = getPath(json, 'tweet')
  if (!isRecord(tweet)) return null
  const text = getString(tweet, 'text')
  if (!text) return null
  const id = getString(tweet, 'id') ?? target.id
  const handle = getString(tweet, 'author.screen_name') ?? target.user
  const createdTs = getNumber(tweet, 'created_timestamp')
  const date = (createdTs ? toIso(createdTs * 1000) : null) ?? toIso(getString(tweet, 'created_at')) ?? tweetDate(id)
  const media =
    getString(tweet, 'media.photos.0.url') ??
    getString(tweet, 'media.videos.0.thumbnail_url') ??
    getString(tweet, 'media.all.0.thumbnail_url') ??
    getString(tweet, 'media.all.0.url')
  const avatar = upscaleTwitterAvatar(getString(tweet, 'author.avatar_url'))

  const item: FeedItem = {
    id: `x:${id}`,
    source: 'x',
    author: getString(tweet, 'author.name') ?? handle,
    handle,
    url: getString(tweet, 'url') ?? `https://x.com/${handle}/status/${id}`,
    text,
    date,
    likes: getNumber(tweet, 'likes'),
    tags: [],
    verified: getPath(tweet, 'author.verification.verified') === true || isOfficialHandle(handle),
  }
  if (avatar) item.avatarUrl = avatar
  if (media) item.mediaUrl = media
  const stats = statsOf({
    comments: getNumber(tweet, 'replies'),
    reposts: getNumber(tweet, 'retweets'),
    views: getNumber(tweet, 'views'),
  })
  if (stats) item.stats = stats
  return item
}

/** Parse a `cdn.syndication.twimg.com/tweet-result` response (text is truncated for long tweets). */
export function parseSyndicationTweet(json: unknown, target: { user: string; id: string }): FeedItem | null {
  if (!isRecord(json)) return null
  const rawText = getString(json, 'text')
  if (!rawText) return null
  const id = getString(json, 'id_str') ?? target.id
  const handle = getString(json, 'user.screen_name') ?? target.user
  // Long tweets end with a t.co media/self link that is noise in a feed card.
  const text = rawText.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '').trim()
  const media = getString(json, 'photos.0.url') ?? getString(json, 'mediaDetails.0.media_url_https') ?? getString(json, 'video.poster')
  const avatar = upscaleTwitterAvatar(getString(json, 'user.profile_image_url_https'))

  const item: FeedItem = {
    id: `x:${id}`,
    source: 'x',
    author: getString(json, 'user.name') ?? handle,
    handle,
    url: `https://x.com/${handle}/status/${id}`,
    text,
    date: toIso(getString(json, 'created_at')) ?? tweetDate(id),
    likes: getNumber(json, 'favorite_count'),
    tags: [],
    verified:
      getPath(json, 'user.verified') === true || getPath(json, 'user.is_blue_verified') === true || isOfficialHandle(handle),
  }
  if (avatar) item.avatarUrl = avatar
  if (media) item.mediaUrl = media
  const stats = statsOf({ comments: getNumber(json, 'conversation_count') })
  if (stats) item.stats = stats
  return item
}

/** Parse an fxtwitter `/user` profile response. */
export function parseFxProfile(json: unknown): XProfile | null {
  const user = getPath(json, 'user')
  if (!isRecord(user)) return null
  const handle = getString(user, 'screen_name')
  if (!handle) return null
  const avatar = upscaleTwitterAvatar(getString(user, 'avatar_url'))
  const profile: XProfile = {
    name: getString(user, 'name') ?? handle,
    handle,
    url: getString(user, 'url') ?? `https://x.com/${handle}`,
    followers: getNumber(user, 'followers'),
    verified: getPath(user, 'verification.verified') === true || isOfficialHandle(handle),
  }
  if (avatar) profile.avatarUrl = avatar
  return profile
}

/** fxtwitter first, syndication CDN second; throws with both reasons when neither yields a tweet. */
export async function fetchTweet(target: XTarget): Promise<FeedItem> {
  const reasons: string[] = []
  try {
    const json = await fetchJson(`${FX_API}/${target.user}/status/${target.id}`)
    const item = parseFxTweet(json, target)
    if (item) return item
    reasons.push(`fxtwitter code ${getNumber(json, 'code') ?? '?'}`)
  } catch (err) {
    reasons.push(`fxtwitter: ${errorMessage(err)}`)
  }
  try {
    const json = await fetchJson(`${SYNDICATION_API}?id=${target.id}&token=x`)
    const item = parseSyndicationTweet(json, target)
    if (item) return item
    reasons.push('syndication: no tweet text')
  } catch (err) {
    reasons.push(`syndication: ${errorMessage(err)}`)
  }
  throw new Error(reasons.join('; '))
}

/** Official account profile (avatar for org-authored items). Never throws. */
export async function fetchXProfile(handle = X_OFFICIAL_HANDLE): Promise<XProfile | null> {
  try {
    return parseFxProfile(await fetchJson(`${FX_API}/${handle}`))
  } catch {
    return null
  }
}

export async function fetchX(): Promise<SourceResult> {
  const targets = curatedTweets()
  const failures: string[] = []
  const fetched = await mapLimit(targets, CONCURRENCY, async (target) => {
    try {
      return await fetchTweet(target)
    } catch (err) {
      failures.push(errorMessage(err))
      return null
    }
  })
  const items = fetched.filter((it): it is FeedItem => it !== null)
  if (failures.length === 0) return { items }
  return { items, error: `${failures.length}/${targets.length} tweets failed: ${failures[0]}` }
}
