/**
 * Hacker News stories mentioning ComfyUI via the Algolia search API.
 */
import type { FeedItem, SourceResult } from '@/server/feed/types'
import { clampText, errorMessage, fetchJson, getArray, getNumber, getString, stripHtml, toIso } from '@/server/feed/util'

export const HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search?query=comfyui&tags=story&hitsPerPage=10'

export function parseHnSearch(json: unknown, now = Date.now()): FeedItem[] {
  const fallbackDate = new Date(now).toISOString()
  const items: FeedItem[] = []
  for (const hit of getArray(json, 'hits')) {
    const title = getString(hit, 'title')
    const objectID = getString(hit, 'objectID')
    if (!title || !objectID) continue
    const discussion = `https://news.ycombinator.com/item?id=${objectID}`
    const url = getString(hit, 'url') ?? discussion
    // Algolia also matches comment bodies; keep only stories that are visibly about Comfy.
    if (!/comfy/i.test(`${title} ${url}`)) continue
    const author = getString(hit, 'author') ?? 'hn'
    const storyText = getString(hit, 'story_text')
    const createdAtI = getNumber(hit, 'created_at_i')
    const item: FeedItem = {
      id: `hn:${objectID}`,
      source: 'hn',
      author,
      handle: author,
      url,
      text: storyText ? `${title}\n${clampText(stripHtml(storyText), 240)}` : title,
      date: toIso(getString(hit, 'created_at')) ?? (createdAtI ? toIso(createdAtI * 1000) : null) ?? fallbackDate,
      likes: getNumber(hit, 'points'),
      tags: [],
      verified: false,
    }
    const comments = getNumber(hit, 'num_comments')
    if (comments !== null) item.stats = { comments }
    items.push(item)
  }
  return items
}

export async function fetchHn(): Promise<SourceResult> {
  try {
    const items = parseHnSearch(await fetchJson(HN_SEARCH_URL))
    return items.length ? { items } : { items, error: 'no matching stories' }
  } catch (err) {
    return { items: [], error: errorMessage(err) }
  }
}
