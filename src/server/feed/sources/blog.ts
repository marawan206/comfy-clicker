/**
 * blog.comfy.org (Substack). The feed is RSS 2.0 with CDATA bodies, but the parser accepts Atom too.
 */
import type { FeedItem, SourceResult } from '@/server/feed/types'
import { clampText, errorMessage, fetchText, parseEntry, stripHtml, xmlEntries } from '@/server/feed/util'

export const BLOG_FEED_URL = 'https://blog.comfy.org/feed'
export const BLOG_HANDLE = 'blog.comfy.org'

export function parseBlogFeed(xml: string, now = Date.now()): FeedItem[] {
  const fallbackDate = new Date(now).toISOString()
  const items: FeedItem[] = []
  for (const entry of xmlEntries(xml)) {
    const e = parseEntry(entry)
    if (!e.title || !e.link) continue
    const slug = e.link.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || e.id || e.link
    const summary = e.summary ?? (e.html ? clampText(stripHtml(e.html), 240) : '')
    const item: FeedItem = {
      id: `blog:${slug}`,
      source: 'blog',
      author: e.author ?? 'Comfy Org',
      handle: BLOG_HANDLE,
      url: e.link,
      text: summary ? `${e.title} — ${summary}` : e.title,
      date: e.date ?? fallbackDate,
      likes: null,
      tags: [],
      verified: true,
    }
    if (e.image) item.mediaUrl = e.image
    items.push(item)
  }
  return items
}

export async function fetchBlog(): Promise<SourceResult> {
  try {
    const xml = await fetchText(BLOG_FEED_URL, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml' } })
    const items = parseBlogFeed(xml)
    return items.length ? { items } : { items, error: 'no entries in feed' }
  } catch (err) {
    return { items: [], error: errorMessage(err) }
  }
}
