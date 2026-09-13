/**
 * Shared helpers for the feed fetchers: a guarded `fetch`, HTML-entity decoding and tiny
 * regex-based HTML/XML extraction. Deliberately parser-free; the payloads are small and the
 * shapes are stable, so a full DOM/XML dependency is not worth it.
 */

export const FEED_USER_AGENT = 'comfy-clicker-feed/0.1 (+https://github.com/marawan206/comfy-clicker)'
/** LinkedIn only serves the public post page to browser-looking clients. */
export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
export const FETCH_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** `fetch` with an AbortController timeout and the polite feed User-Agent by default. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init.headers)
  if (!headers.has('user-agent')) headers.set('user-agent', FEED_USER_AGENT)
  try {
    return await fetch(url, { redirect: 'follow', ...init, headers, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`timeout after ${timeoutMs} ms: ${url}`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GET a text body; throws on non-2xx so callers can record the status.
 *
 * The timeout covers the body, not only the headers. `fetchWithTimeout` clears its timer the
 * moment `fetch` resolves, which is when the response headers arrive, so a host that sends
 * headers and then stalls the body left `res.text()` with no deadline and no live signal: the
 * read never settled, the `mapLimit` worker awaiting it froze, and the source's whole 25 s
 * deadline expired, discarding every item that source had already fetched.
 */
export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init.headers)
  if (!headers.has('user-agent')) headers.set('user-agent', FEED_USER_AGENT)
  try {
    const res = await fetch(url, { redirect: 'follow', ...init, headers, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
    return await res.text()
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`timeout after ${timeoutMs} ms: ${url}`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** GET + JSON.parse; the parse error names the URL instead of "Unexpected token". */
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<unknown> {
  const headers = new Headers(init.headers)
  if (!headers.has('accept')) headers.set('accept', 'application/json')
  const text = await fetchText(url, { ...init, headers }, timeoutMs)
  return parseJson(text, url)
}

export function parseJson(text: string, label = 'json'): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`invalid JSON from ${label}`)
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : String(err)
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// JSON access guards
// ---------------------------------------------------------------------------

export type JsonRecord = Record<string, unknown>

export function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Walk a dotted path (`'author.avatar_url'`) through nested records/arrays; undefined if any hop is missing. */
export function getPath(v: unknown, path: string): unknown {
  let cur: unknown = v
  for (const key of path.split('.')) {
    if (Array.isArray(cur)) {
      const idx = Number(key)
      if (!Number.isInteger(idx)) return undefined
      cur = cur[idx]
    } else if (isRecord(cur)) {
      cur = cur[key]
    } else {
      return undefined
    }
  }
  return cur
}

export function getString(v: unknown, path: string): string | null {
  const x = getPath(v, path)
  return typeof x === 'string' && x.length > 0 ? x : null
}

export function getNumber(v: unknown, path: string): number | null {
  const x = getPath(v, path)
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && /^\d+$/.test(x)) return Number(x)
  return null
}

export function getArray(v: unknown, path: string): unknown[] {
  const x = getPath(v, path)
  return Array.isArray(x) ? x : []
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '\u2014',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
}

/** Decode numeric (`&#39;`, `&#x1F600;`) and common named HTML entities. Unknown entities are kept verbatim. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return match
      try {
        return String.fromCodePoint(cp)
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/** Collapse runs of spaces, trim line edges, cap blank lines at one. */
export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0\u200b]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Drop tags/comments/scripts, keep paragraph breaks as newlines, decode entities, tidy whitespace. */
export function stripHtml(html: string): string {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return collapseWhitespace(decodeEntities(s))
}

/** Light markdown → text for release notes: headings, emphasis, links, bullets, PR urls. */
export function markdownToText(md: string): string {
  const s = md
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g, '#$1')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/`/g, '')
  return collapseWhitespace(s)
}

/** Cut at a word boundary and add an ellipsis when longer than `max` characters. */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\u2014-]+$/, '') + '…'
}

/** `"1,234"` → 1234; null when not a number. */
export function parseCount(s: string | null | undefined): number | null {
  if (!s) return null
  const n = Number(s.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Parse anything `Date` understands (ISO, RFC 2822, Twitter's `Tue Jun 18 16:38:14 +0000 2024`) into ISO; null if invalid. */
export function toIso(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined || input === '') return null
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// HTML extraction
// ---------------------------------------------------------------------------

/** Value of `attr="…"` / `attr='…'` inside a single tag string, entity-decoded. */
export function attrValue(tag: string, attr: string): string | null {
  const m = new RegExp(`[\\s"']${escapeRegExp(attr)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  if (!m) return null
  return decodeEntities(m[1] ?? m[2] ?? '')
}

/** First `<meta name|property="key" content="…">` (either attribute order), decoded. */
export function extractMeta(html: string, key: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*?(?:name|property)\\s*=\\s*["']${escapeRegExp(key)}["'][^>]*>`, 'i')
  const m = re.exec(html)
  return m ? attrValue(m[0], 'content') : null
}

/** First occurrence of `attr="…"` anywhere in the document (e.g. `data-num-reactions`). */
export function extractAttr(html: string, attr: string): string | null {
  const m = new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(html)
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : null
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? collapseWhitespace(decodeEntities(m[1])) : null
}

/** First `<img>` src (or LinkedIn's lazy `data-delayed-url`) that is an http(s) URL. */
export function firstImageUrl(html: string): string | null {
  const re = /<img\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const src = attrValue(m[0], 'src') ?? attrValue(m[0], 'data-delayed-url')
    if (src && /^https?:\/\//i.test(src)) return src
  }
  return null
}

// ---------------------------------------------------------------------------
// XML (Atom / RSS) extraction
// ---------------------------------------------------------------------------

/** Inner markup of every Atom `<entry>` or RSS `<item>`, in document order. */
export function xmlEntries(xml: string): string[] {
  const out: string[] = []
  const re = /<(entry|item)\b[^>]*>([\s\S]*?)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(m[2])
  return out
}

/** Text content of a node: CDATA verbatim, otherwise entity-decoded. */
export function xmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  return (cdata ? cdata[1] : decodeEntities(raw)).trim()
}

/** Text of the first `<tag>…</tag>` (namespaced names like `media:description` are fine); null if absent. */
export function xmlTag(xml: string, tag: string): string | null {
  const t = escapeRegExp(tag)
  const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i').exec(xml)
  return m ? xmlText(m[1]) : null
}

/** Attribute of the first `<tag …>` opening tag (works for self-closing tags). */
export function xmlTagAttr(xml: string, tag: string, attr: string): string | null {
  const m = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>`, 'i').exec(xml)
  return m ? attrValue(m[0], attr) : null
}

/** Best link of an entry: Atom `rel="alternate"` href, else the first href, else RSS `<link>text</link>`. */
export function entryLink(entry: string): string | null {
  const tags = entry.match(/<link\b[^>]*>/gi) ?? []
  let first: string | null = null
  for (const tag of tags) {
    const href = attrValue(tag, 'href')
    if (!href) continue
    if (attrValue(tag, 'rel') === 'alternate') return href
    first ??= href
  }
  if (first) return first
  const text = xmlTag(entry, 'link')
  return text && /^https?:\/\//i.test(text) ? text : null
}

/** Feed-format-agnostic view of an Atom entry / RSS item. */
export interface ParsedEntry {
  id: string | null
  title: string | null
  link: string | null
  /** ISO timestamp from published/pubDate/updated. */
  date: string | null
  author: string | null
  /** Plain-text summary (`<summary>`, `<description>`), HTML stripped. */
  summary: string | null
  /** Raw HTML body (`<content>`, `<content:encoded>`), entity-decoded once. */
  html: string | null
  /** `media:thumbnail`, `enclosure`, or the first `<img>` of the body. */
  image: string | null
}

export function parseEntry(entry: string): ParsedEntry {
  const html = xmlTag(entry, 'content:encoded') ?? xmlTag(entry, 'content')
  const summaryRaw = xmlTag(entry, 'summary') ?? xmlTag(entry, 'description')
  const image =
    xmlTagAttr(entry, 'media:thumbnail', 'url') ??
    xmlTagAttr(entry, 'enclosure', 'url') ??
    (html ? firstImageUrl(html) : null)
  return {
    id: xmlTag(entry, 'id') ?? xmlTag(entry, 'guid'),
    title: xmlTag(entry, 'title'),
    link: entryLink(entry),
    date: toIso(xmlTag(entry, 'published') ?? xmlTag(entry, 'pubDate') ?? xmlTag(entry, 'updated')),
    author: xmlTag(entry, 'dc:creator') ?? xmlTag(entry, 'name'),
    summary: summaryRaw ? stripHtml(summaryRaw) : null,
    html,
    image,
  }
}
