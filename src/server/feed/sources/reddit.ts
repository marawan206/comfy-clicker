/**
 * r/comfyui top posts of the week. Reddit's JSON endpoints answer 403 to non-browser clients but the
 * Atom feed is open. Atom carries no score, so `likes` is null.
 */
import type { FeedItem, SourceResult } from '@/server/feed/types'
import { clampText, errorMessage, fetchText, parseEntry, stripHtml, xmlEntries } from '@/server/feed/util'

export const REDDIT_FEED_URL = 'https://www.reddit.com/r/comfyui/top/.rss?t=week&limit=15'

export function parseRedditAtom(xml: string, now = Date.now()): FeedItem[] {
  const fallbackDate = new Date(now).toISOString()
  const items: FeedItem[] = []
  for (const entry of xmlEntries(xml)) {
    const e = parseEntry(entry)
    const nativeId = (e.id ?? (e.link ? /comments\/([a-z0-9]+)/i.exec(e.link)?.[1] : null) ?? '').replace(/^t3_/, '')
    if (!nativeId || !e.link || !e.title) continue
    const handle = (e.author ?? 'reddit').replace(/^\/?u\//, '')
    const html = e.html ?? ''
    // Self-text sits between Reddit's SC_OFF/SC_ON markers; the rest of the table is thumbnail + boilerplate.
    const selfHtml = /<!--\s*SC_OFF\s*-->([\s\S]*?)<!--\s*SC_ON\s*-->/.exec(html)?.[1]
    const body = selfHtml ? stripHtml(selfHtml) : ''
    const linkTarget = /<a href="([^"]+)">\s*\[link\]\s*<\/a>/.exec(html)?.[1]
    const media = e.image ?? (linkTarget && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(linkTarget) ? linkTarget : null)

    const item: FeedItem = {
      id: `reddit:${nativeId}`,
      source: 'reddit',
      author: `u/${handle}`,
      handle,
      url: e.link,
      text: body ? `${e.title}\n${clampText(body, 280)}` : e.title,
      date: e.date ?? fallbackDate,
      likes: null,
      tags: [],
      verified: false,
    }
    if (media) item.mediaUrl = media
    items.push(item)
  }
  return items
}

export async function fetchReddit(): Promise<SourceResult> {
  try {
    const xml = await fetchText(REDDIT_FEED_URL, { headers: { accept: 'application/atom+xml, application/xml' } })
    const items = parseRedditAtom(xml)
    return items.length ? { items } : { items, error: 'no entries in feed' }
  } catch (err) {
    return { items: [], error: errorMessage(err) }
  }
}
