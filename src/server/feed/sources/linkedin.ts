/**
 * LinkedIn public post pages. No API: we fetch the guest-visible page with a desktop browser UA and
 * read the `description` meta (post text), `data-num-reactions`, `datePublished` and `og:image`.
 * Curated activity ids come from the founder seed; profile pages optionally surface newer ids.
 */
import { realPostsSeed } from '@/data/realPostsSeed'
import { isOfficialHandle } from '@/server/feed/normalize'
import type { FeedItem, SourceResult } from '@/server/feed/types'
import {
  DESKTOP_USER_AGENT,
  clampText,
  collapseWhitespace,
  decodeEntities,
  errorMessage,
  extractAttr,
  extractMeta,
  extractTitle,
  fetchText,
  mapLimit,
  parseCount,
  toIso,
} from '@/server/feed/util'

export const LINKEDIN_PROFILES: readonly string[] = ['robinjhuang', 'yolandyan']
/** Newest non-curated posts to pull per profile when discovery works (LinkedIn often answers 999). */
export const MAX_DISCOVERED_PER_PROFILE = 2
const CONCURRENCY = 4

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': DESKTOP_USER_AGENT,
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
}

export interface LinkedInTarget {
  /** 19-digit activity id. */
  id: string
  url: string
  /** Profile slug hint, used when the page doesn't reveal the author link. */
  handle?: string
}

/** Activity id from any LinkedIn post URL form (`…-activity-<id>-xxxx` or `urn:li:activity:<id>`). */
export function linkedInActivityId(url: string): string | null {
  const m = /activity[-:](\d{19})/.exec(url)
  return m ? m[1] : null
}

/**
 * Activity ids are 63-bit; their top 41 bits are the creation time in ms since the Unix epoch,
 * so drop the low 22 bits. (Verified against `datePublished` on the seed posts.)
 */
export function linkedInActivityDate(id: string): string {
  return new Date(Number(BigInt(id) >> BigInt(22))).toISOString()
}

export function linkedInPostUrl(id: string): string {
  return `https://www.linkedin.com/feed/update/urn:li:activity:${id}`
}

/** Profile slug from `/in/<slug>` or `/posts/<slug>_…` URLs. */
export function linkedInProfileSlug(url: string): string | null {
  const m = /linkedin\.com\/(?:posts|in)\/([A-Za-z0-9-]+)/.exec(url)
  return m ? m[1] : null
}

export function curatedLinkedInTargets(): LinkedInTarget[] {
  const out: LinkedInTarget[] = []
  for (const post of realPostsSeed) {
    if (post.platform !== 'linkedin') continue
    const id = linkedInActivityId(post.url)
    if (id) out.push({ id, url: post.url, handle: post.handle })
  }
  return out
}

function authorFromTitle(title: string | null): string | null {
  if (!title) return null
  // "… | Robin Huang posted on the topic | LinkedIn"  /  "Robin Huang on LinkedIn: …"
  const m = /\|\s*([^|]+?)\s+posted on the topic/i.exec(title) ?? /^(.+?) on LinkedIn:/i.exec(title)
  return m ? m[1].trim() : null
}

/** LinkedIn swaps the post text for a generic prompt when it decides to gate the page (reaction markup stays). */
const AUTH_WALL_RE = /^(sign in or join now|sign in to linkedin|join linkedin|log in to linkedin)\b/i

/** Parse a public post page; null when the page carries no post (auth wall, 999 block, removed post). */
export function parseLinkedInPost(html: string, target: LinkedInTarget): FeedItem | null {
  const description = extractMeta(html, 'description')
  const text = description ? collapseWhitespace(description) : ''
  if (!text || AUTH_WALL_RE.test(text)) return null

  const author =
    /aria-label="View profile for ([^"]+)"/.exec(html)?.[1] ??
    authorFromTitle(extractTitle(html)) ??
    target.handle ??
    'LinkedIn'
  const handle =
    /linkedin\.com\/in\/([A-Za-z0-9-]+)\?trk=public_post_feed-actor-name/.exec(html)?.[1] ??
    target.handle ??
    linkedInProfileSlug(target.url) ??
    'linkedin'
  const likes = parseCount(extractAttr(html, 'data-num-reactions'))
  const comments = parseCount(extractAttr(html, 'data-num-comments'))
  const date = toIso(/"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1]) ?? linkedInActivityDate(target.id)
  const avatarRaw = /data-delayed-url="([^"]*profile-displayphoto[^"]*)"/.exec(html)?.[1]
  const media = extractMeta(html, 'og:image')

  const item: FeedItem = {
    id: `linkedin:${target.id}`,
    source: 'linkedin',
    author: decodeEntities(author).trim(),
    handle,
    url: target.url,
    text: clampText(text, 600),
    date,
    likes,
    tags: [],
    verified: isOfficialHandle(handle),
  }
  if (avatarRaw) item.avatarUrl = decodeEntities(avatarRaw)
  if (media) item.mediaUrl = media
  if (comments !== null) item.stats = { comments }
  return item
}

export async function fetchLinkedInPost(target: LinkedInTarget): Promise<FeedItem> {
  const html = await fetchText(target.url, { headers: BROWSER_HEADERS })
  const item = parseLinkedInPost(html, target)
  if (!item) throw new Error(`no post data in page (auth wall?) ${target.url}`)
  return item
}

/** Activity ids visible on a public profile page, newest first. Empty on any failure — discovery is optional. */
export async function discoverLinkedInActivityIds(slug: string): Promise<string[]> {
  try {
    const html = await fetchText(`https://www.linkedin.com/in/${slug}`, { headers: BROWSER_HEADERS })
    const ids = new Set<string>()
    const re = /activity[-:](\d{19})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) ids.add(m[1])
    // Same-length numeric strings: lexical desc == numeric desc == newest first.
    return [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  } catch {
    return []
  }
}

export async function fetchLinkedIn(): Promise<SourceResult> {
  const curated = curatedLinkedInTargets()
  const known = new Set(curated.map((t) => t.id))
  const discovered: LinkedInTarget[] = []
  const perProfile = await Promise.all(
    LINKEDIN_PROFILES.map(async (slug) => ({ slug, ids: await discoverLinkedInActivityIds(slug) })),
  )
  for (const { slug, ids } of perProfile) {
    let taken = 0
    for (const id of ids) {
      if (known.has(id) || taken >= MAX_DISCOVERED_PER_PROFILE) continue
      known.add(id)
      taken += 1
      discovered.push({ id, url: linkedInPostUrl(id), handle: slug })
    }
  }

  const targets = [...curated, ...discovered]
  const curatedIds = new Set(curated.map((t) => t.id))
  const failures: string[] = []
  const fetched = await mapLimit(targets, CONCURRENCY, async (target) => {
    try {
      const item = await fetchLinkedInPost(target)
      // Profile activity includes posts by other people the founders engaged with; keep only Comfy-related ones.
      if (!curatedIds.has(target.id) && !/comfy/i.test(item.text)) return null
      return item
    } catch (err) {
      // Discovery is best-effort: a gated discovered post is not a source failure.
      if (curatedIds.has(target.id)) failures.push(errorMessage(err))
      return null
    }
  })
  const items = fetched.filter((it): it is FeedItem => it !== null)
  if (failures.length === 0) return { items }
  return { items, error: `${failures.length}/${curated.length} curated posts failed: ${failures[0]}` }
}
