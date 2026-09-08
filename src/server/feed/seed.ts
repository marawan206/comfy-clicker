/**
 * The founder seed (`src/data/realPostsSeed.ts`) as `FeedItem`s. Ids and precise timestamps are derived
 * from the post URLs so live copies of the same post dedupe against these.
 */
import { realPostsSeed, type RealPost } from '@/data/realPostsSeed'
import { linkedInActivityDate, linkedInActivityId } from '@/server/feed/sources/linkedin'
import { tweetDate, tweetRef } from '@/server/feed/sources/x'
import type { FeedItem } from '@/server/feed/types'

export { realPostsSeed }
export type { RealPost }

export function realPostToFeedItem(post: RealPost): FeedItem {
  let id = `${post.platform}:${post.id}`
  let date = `${post.date}T00:00:00.000Z`
  if (post.platform === 'x') {
    const ref = tweetRef(post.url)
    if (ref) {
      id = `x:${ref.id}`
      date = tweetDate(ref.id)
    }
  } else {
    const activityId = linkedInActivityId(post.url)
    if (activityId) {
      id = `linkedin:${activityId}`
      date = linkedInActivityDate(activityId)
    }
  }
  return {
    id,
    source: post.platform,
    author: post.author,
    handle: post.handle,
    url: post.url,
    text: post.text,
    date,
    likes: post.likes,
    tags: [...post.tags],
    verified: true,
  }
}

export const SEED_FEED_ITEMS: readonly FeedItem[] = realPostsSeed.map(realPostToFeedItem)

/** Fresh copies (safe to mutate), newest first. */
export function seedFeedItems(): FeedItem[] {
  return SEED_FEED_ITEMS.map((item) => ({ ...item, tags: [...item.tags] })).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )
}
