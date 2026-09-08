/**
 * YouTube channel uploads via the public Atom feed (no API key). Two channel ids: the @comfyui handle
 * (currently no uploads) and the "ComfyUI" channel behind @ComfyOrg where the videos actually live.
 */
import { isOfficialHandle } from '@/server/feed/normalize'
import type { FeedItem, SourceResult } from '@/server/feed/types'
import {
  clampText,
  collapseWhitespace,
  entryLink,
  errorMessage,
  fetchText,
  parseCount,
  xmlEntries,
  xmlTag,
  xmlTagAttr,
} from '@/server/feed/util'

export const YOUTUBE_CHANNEL_IDS: readonly string[] = ['UCaVhziQbXkTLiERYTak95Qw', 'UCsOXR1n2MR15vuK2htE5EkQ']

export function youtubeFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
}

export function parseYoutubeAtom(xml: string, now = Date.now()): FeedItem[] {
  const fallbackDate = new Date(now).toISOString()
  const head = xml.slice(0, xml.indexOf('<entry') === -1 ? xml.length : xml.indexOf('<entry'))
  const channelTitle = xmlTag(head, 'title')
  const items: FeedItem[] = []
  for (const entry of xmlEntries(xml)) {
    const videoId = xmlTag(entry, 'yt:videoId') ?? xmlTag(entry, 'id')?.replace(/^yt:video:/, '')
    const title = xmlTag(entry, 'title')
    if (!videoId || !title) continue
    const author = xmlTag(entry, 'name') ?? channelTitle ?? 'ComfyUI'
    const handle = (channelTitle ?? author).toLowerCase().replace(/\s+/g, '')
    const description = xmlTag(entry, 'media:description')
    const thumb = xmlTagAttr(entry, 'media:thumbnail', 'url')
    const views = parseCount(xmlTagAttr(entry, 'media:statistics', 'views'))
    const ratings = parseCount(xmlTagAttr(entry, 'media:starRating', 'count'))
    const published = xmlTag(entry, 'published') ?? xmlTag(entry, 'updated')
    const date = published ? new Date(published) : null

    const item: FeedItem = {
      id: `youtube:${videoId}`,
      source: 'youtube',
      author,
      handle,
      url: entryLink(entry) ?? `https://www.youtube.com/watch?v=${videoId}`,
      text: description ? `${title}\n${clampText(collapseWhitespace(description), 200)}` : title,
      date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : fallbackDate,
      // The feed exposes the rating count, which for modern YouTube is the like count.
      likes: ratings,
      tags: [],
      verified: isOfficialHandle(handle),
    }
    if (thumb) item.mediaUrl = thumb
    if (views !== null) item.stats = { views }
    items.push(item)
  }
  return items
}

export async function fetchYoutube(): Promise<SourceResult> {
  const failures: string[] = []
  const items: FeedItem[] = []
  await Promise.all(
    YOUTUBE_CHANNEL_IDS.map(async (channelId) => {
      try {
        const xml = await fetchText(youtubeFeedUrl(channelId), { headers: { accept: 'application/atom+xml, application/xml' } })
        items.push(...parseYoutubeAtom(xml))
      } catch (err) {
        failures.push(`${channelId}: ${errorMessage(err)}`)
      }
    }),
  )
  if (failures.length === 0) return items.length ? { items } : { items, error: 'no videos in feeds' }
  return { items, error: failures.join('; ') }
}
