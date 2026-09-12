/**
 * Turns raw source items into clean `FeedItem`s: hashtag tagging by keyword, dedupe, date/text
 * hygiene, official-account flag, newest first.
 */
import { HASHTAGS } from '@/data/hashtags'
import type { FeedItem, FeedVocabEntry } from '@/server/feed/types'
import { clampText, collapseWhitespace, escapeRegExp, toIso } from '@/server/feed/util'

export const MAX_TEXT_CHARS = 600
export const MAX_TAGS_PER_ITEM = 6
/** A single text can't count a tag more than this many times (keeps spammy posts from dominating trending). */
export const MAX_HITS_PER_TAG = 5

/** Founder / official Comfy accounts across platforms (lowercase, no `@`). */
export const OFFICIAL_HANDLES: ReadonlySet<string> = new Set([
  'yoland_yan',
  'yolandyan',
  'yoland68',
  'robinjhuang',
  'robinken',
  'comfyanonymous',
  'comfyui',
  'comfyorg',
  'comfy-org',
  'comfy-org/comfyui',
  'blog.comfy.org',
])

export function isOfficialHandle(handle: string | null | undefined): boolean {
  if (!handle) return false
  return OFFICIAL_HANDLES.has(handle.replace(/^@/, '').trim().toLowerCase())
}

/**
 * Mirror of the game hashtag vocabulary (`src/data/hashtags.ts`). Ids must stay in sync with the
 * catalog; keywords here only need to be good enough to tag real-world posts. Pass the real
 * `CATALOG.hashtags` to `collectFeed({ hashtags })` to use the game's keyword lists instead.
 */
export const FEED_VOCAB_FALLBACK: FeedVocabEntry[] = [
  { id: 'comfyui', keywords: ['comfyui', 'comfy ui', 'comfy', 'comfy org', 'comfy-org', 'workflow', 'workflows'] },
  { id: 'wan22', keywords: ['wan', 'wan2', 'wan2.1', 'wan2.2', 'wan 2.2', 'wan22', 'wan3', 'wan-3', 'alibaba'] },
  { id: 'ltx2', keywords: ['ltx', 'ltx2', 'ltx-2', 'ltx 2', 'ltxv', 'ltx video', 'lightricks'] },
  { id: 'fluxkontext', keywords: ['flux', 'kontext', 'flux kontext', 'flux.1', 'black forest labs', 'bfl'] },
  { id: 'qwenimage', keywords: ['qwen', 'qwen image', 'qwen-image', 'qwen-image-edit'] },
  { id: 'sd15forever', keywords: ['sd1.5', 'sd 1.5', 'sd15', 'stable diffusion 1.5', 'v1-5', 'sd1'] },
  { id: 'sdxl', keywords: ['sdxl', 'sdxl turbo', 'juggernaut', 'illustrious'] },
  { id: 'nodegraph', keywords: ['node graph', 'nodegraph', 'spaghetti', 'noodle', 'noodles', 'subgraph', 'subgraphs', 'litegraph', 'reroute', 'bypass', 'new ui', 'ui update', 'frontend'] },
  { id: 'customnodes', keywords: ['custom node', 'custom nodes', 'customnodes', 'nodes', 'node pack', 'node suite', 'comfyui-manager', 'manager', 'registry', 'extension', 'extensions'] },
  { id: 'comfycloud', keywords: ['comfy cloud', 'comfycloud', 'cloud', 'cloud credits', 'hosted', 'managed'] },
  { id: 'appmode', keywords: ['app mode', 'appmode', 'linear mode', 'app builder', 'apps'] },
  { id: 'comfyhub', keywords: ['comfyhub', 'hub', 'template', 'templates', 'share workflow', 'shared workflow'] },
  { id: 'loratuesday', keywords: ['lora', 'loras', 'lora training', 'fine-tune', 'finetune', 'fine tune', 'dreambooth', 'training'] },
  {
    id: 'videogen',
    kind: 'video',
    keywords: ['video', 'videos', 'i2v', 't2v', 'image to video', 'text to video', 'reel', 'reels', 'clip', 'animation', 'animate', 'minimax', 'hailuo', 'kling', 'seedance', 'veo', 'sora', 'hunyuan video', 'camera', 'film', 'ad', 'super bowl'],
  },
  { id: '3dgen', kind: '3d', keywords: ['3d', 'mesh', 'meshes', 'glb', 'hunyuan3d', 'tripo', 'meshy', 'nerf', 'gaussian', 'splat', 'splats', 'texture'] },
  { id: 'musicgen', kind: 'audio', keywords: ['music', 'audio', 'song', 'songs', 'ace-step', 'acestep', 'stable audio', 'tts', 'voice', 'elevenlabs', 'sound', 'soundtrack'] },
  { id: 'cyberpunk', keywords: ['cyberpunk', 'neon', 'dystopia', 'dystopian', 'blade runner', 'synthwave', 'megacity'] },
  { id: 'cozy', keywords: ['cozy', 'cosy', 'warm', 'cottage', 'hygge', 'fireplace', 'comfy vibes', 'rainy'] },
  { id: 'cats', keywords: ['cat', 'cats', 'kitten', 'kittens', 'kitty', 'feline', 'meow'] },
  { id: 'dragons', keywords: ['dragon', 'dragons', 'wyvern', 'drake'] },
  { id: 'anime', keywords: ['anime', 'manga', 'waifu', 'noobai', 'ghibli', 'chibi'] },
  { id: 'retro', keywords: ['retro', 'vhs', 'ntsc', '60s', '70s', '80s', '90s', 'vintage', 'pixel art', 'crt', 'film grain', 'polaroid', 'another era', 'nostalgic', 'rewind'] },
  { id: 'space', keywords: ['space', 'galaxy', 'nebula', 'astronaut', 'planet', 'planets', 'cosmos', 'rocket', 'mars', 'orbit', 'moon'] },
  { id: 'underwater', keywords: ['underwater', 'ocean', 'sea', 'diver', 'coral', 'reef', 'submarine', 'deep sea', 'aquatic'] },
  { id: 'portrait', keywords: ['portrait', 'portraits', 'headshot', 'face', 'faces', 'selfie', 'talking head', 'talking-head', 'character', 'identity', 'identities', 'consistent character'] },
  { id: 'foodporn', keywords: ['food', 'foodporn', 'recipe', 'ramen', 'pizza', 'sushi', 'burger', 'dessert', 'chef', 'cooking'] },
  { id: 'architecture', keywords: ['architecture', 'architectural', 'building', 'buildings', 'interior', 'house', 'skyscraper', 'brutalist', 'archviz'] },
  { id: 'robots', keywords: ['robot', 'robots', 'mech', 'mecha', 'android', 'cyborg', 'droid'] },
  { id: 'glitch', keywords: ['glitch', 'glitchy', 'datamosh', 'corrupted', 'distortion', 'artifacts', 'noise'] },
  { id: 'hackathon', keywords: ['hackathon', 'challenge', 'contest', 'competition', 'giveaway', 'prize', 'prizes', 'submissions', 'credits to celebrate'] },
]

/**
 * Feed vocabulary = catalog ids/kinds/families with feed-tuned keywords. The game's keyword lists are
 * written for player prompts ("app", "dev", "night", "pack"…) and over-tag real-world posts, so the
 * fallback list's keywords win where both know an id; catalog-only ids keep the catalog keywords.
 */
export function buildFeedVocabulary(
  catalog: FeedVocabEntry[] = HASHTAGS,
  tuned: FeedVocabEntry[] = FEED_VOCAB_FALLBACK,
): FeedVocabEntry[] {
  if (!catalog.length) return tuned
  const byId = new Map(tuned.map((entry) => [entry.id, entry]))
  return catalog.map((entry) => {
    const feed = byId.get(entry.id)
    const out: FeedVocabEntry = { id: entry.id, tag: entry.tag ?? entry.id, keywords: feed?.keywords ?? entry.keywords }
    if (entry.kind) out.kind = entry.kind
    if (entry.family) out.family = entry.family
    return out
  })
}

/** Default vocabulary for `collectFeed` when no `hashtags` option is passed. */
export const FEED_VOCAB: FeedVocabEntry[] = buildFeedVocabulary()

interface CompiledEntry {
  id: string
  kind?: string
  re: RegExp
}

const compiledCache = new WeakMap<FeedVocabEntry[], CompiledEntry[]>()

/** Word-bounded pattern for one keyword; boundaries only where the keyword edge is a word char (so `#tag` / `c++` still work). */
function keywordPattern(keyword: string): string | null {
  const k = keyword.trim().toLowerCase()
  if (!k) return null
  const lead = /^[a-z0-9_]/.test(k) ? '\\b' : ''
  const trail = /[a-z0-9_]$/.test(k) ? '\\b' : ''
  return `${lead}${escapeRegExp(k)}${trail}`
}

/** One global regex per vocabulary entry (keywords + literal `#tag`), memoised per vocabulary array. */
export function compileVocabulary(vocab: FeedVocabEntry[]): CompiledEntry[] {
  const cached = compiledCache.get(vocab)
  if (cached) return cached
  const compiled: CompiledEntry[] = []
  for (const entry of vocab) {
    const tag = (entry.tag ?? entry.id).toLowerCase()
    const parts = new Set<string>([`(?:^|[^\\w#])#${escapeRegExp(tag)}\\b`])
    for (const keyword of entry.keywords) {
      const p = keywordPattern(keyword)
      if (p) parts.add(p)
    }
    compiled.push({ id: entry.id, kind: entry.kind, re: new RegExp([...parts].join('|'), 'g') })
  }
  compiledCache.set(vocab, compiled)
  return compiled
}

/** Keyword hit count per vocabulary id (case-insensitive, word-bounded, capped at MAX_HITS_PER_TAG). */
export function matchVocabTags(text: string, vocab: FeedVocabEntry[]): Record<string, number> {
  const hits: Record<string, number> = {}
  const lower = text.toLowerCase()
  for (const { id, re } of compileVocabulary(vocab)) {
    re.lastIndex = 0
    const n = lower.match(re)?.length ?? 0
    if (n > 0) hits[id] = Math.min(n, MAX_HITS_PER_TAG)
  }
  return hits
}

/** Vocabulary ids for a text, most-hit first (ties keep vocabulary order), capped at MAX_TAGS_PER_ITEM. */
export function tagsFor(text: string, vocab: FeedVocabEntry[]): string[] {
  const hits = matchVocabTags(text, vocab)
  return Object.keys(hits)
    .sort((a, b) => hits[b] - hits[a])
    .slice(0, MAX_TAGS_PER_ITEM)
}

/** The feed renders inside a game; adult-content posts (r/comfyui has them) are dropped outright. */
const UNSAFE_TEXT_RE = /\b(nsfw|porn|nudes?|nudity|hentai|xxx)\b/i

export function isSafeText(text: string): boolean {
  return !UNSAFE_TEXT_RE.test(text)
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))]
}

function httpUrl(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

/**
 * Clean, tag, dedupe (by id, first wins; callers put live items before seed fallbacks) and sort newest first.
 * Items with no id/url/text or with adult-content text are dropped; unparsable dates fall back to `now`.
 */
export function normalizeItems(items: FeedItem[], vocab: FeedVocabEntry[], now = Date.now()): FeedItem[] {
  const fallbackDate = new Date(now).toISOString()
  const seen = new Set<string>()
  const out: FeedItem[] = []
  for (const raw of items) {
    if (!raw || !raw.id || !raw.url) continue
    const key = raw.id.toLowerCase()
    if (seen.has(key)) continue
    const text = clampText(collapseWhitespace(raw.text ?? ''), MAX_TEXT_CHARS)
    if (!text || !isSafeText(text)) continue
    seen.add(key)
    const handle = (raw.handle ?? '').replace(/^@/, '').trim()
    const likes = typeof raw.likes === 'number' && Number.isFinite(raw.likes) ? Math.max(0, Math.round(raw.likes)) : null
    const item: FeedItem = {
      ...raw,
      author: collapseWhitespace(raw.author || handle || 'unknown'),
      handle,
      text,
      date: toIso(raw.date) ?? fallbackDate,
      likes,
      tags: uniq(raw.tags?.length ? raw.tags : tagsFor(text, vocab)),
      verified: raw.verified || isOfficialHandle(handle),
    }
    const avatarUrl = httpUrl(raw.avatarUrl)
    const mediaUrl = httpUrl(raw.mediaUrl)
    if (avatarUrl) item.avatarUrl = avatarUrl
    else delete item.avatarUrl
    if (mediaUrl) item.mediaUrl = mediaUrl
    else delete item.mediaUrl
    if (!raw.stats || Object.keys(raw.stats).length === 0) delete item.stats
    out.push(item)
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return out
}
