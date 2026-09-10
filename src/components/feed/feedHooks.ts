'use client'
/**
 * Feed-side selectors and pure helpers. The store bumps its version ≈20 times a second, so every
 * hook here selects a primitive, a short key string, or a flat object compared shallowly; cards
 * subscribe to their own tiny slice by post id.
 */
import { createContext, useCallback, useContext, useMemo } from 'react'
import { useReducedMotion } from 'motion/react'
import { useGame } from '@/state/useGame'
import type { GameStore } from '@/state/store'
import { buildIndex } from '@/game/catalog'
import { upscaleCost } from '@/game/actions'
import { currentTrending, LIVE_TRENDING_TTL_MS } from '@/game/hashtags'
import { hashString } from '@/game/rng'
import type { Catalog } from '@/data'
import type { Derived, GameState, ModelKind, Post, Precision } from '@/game/types'
import { pickThumb, thumbFamilyFor } from '@/data/assetManifest'

/** True when either the OS or the in-game setting asks for calmer motion. */
export function useReducedMotionPref(): boolean {
  const system = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  return Boolean(system) || setting
}

/** Player post ids, newest first; the array identity is stable until a post is added or dropped. */
export function usePostIds(): string[] {
  const key = useGame((s) => {
    let out = ''
    for (const p of s.posts) out += (out ? '|' : '') + p.id
    return out
  })
  return useMemo(() => (key ? key.split('|') : []), [key])
}

export function usePostCount(): number {
  return useGame((s) => s.posts.length)
}

/**
 * The post object itself. The engine mutates posts in place, so the reference is stable for the
 * life of the post and this re-renders only when the post is dropped. Pair with `usePostLive`.
 */
export function usePostRef(id: string): Post | undefined {
  const selector = useCallback((s: GameState) => s.posts.find((p) => p.id === id), [id])
  return useGame(selector)
}

export interface PostLive {
  likes: number
  creditsPaid: number
  targetLikes: number
  granted: boolean
  upscaled: boolean
  /** Upscale price, or null when the post cannot be upscaled (flop, already upscaled, unknown model). */
  upscaleCost: number | null
  upscaleAffordable: boolean
}

const MISSING: PostLive = { likes: 0, creditsPaid: 0, targetLikes: 0, granted: false, upscaled: false, upscaleCost: null, upscaleAffordable: false }

/** The mutable fields of a post as a flat object, so the card re-renders only when one of them changes. */
export function usePostLive(id: string): PostLive {
  const selector = useCallback(
    (s: GameState, d: Derived, store: GameStore): PostLive => {
      const post = s.posts.find((p) => p.id === id)
      if (!post) return MISSING
      const upscaled = post.upscaled === true
      const cost = post.granted && !upscaled && !post.flop ? upscaleCost(post, { derived: d, catalog: store.catalog }) : null
      return {
        likes: post.likes,
        creditsPaid: post.creditsPaid,
        targetLikes: post.targetLikes,
        granted: post.granted,
        upscaled,
        upscaleCost: cost,
        upscaleAffordable: cost !== null && s.credits >= cost,
      }
    },
    [id],
  )
  return useGame(selector, shallowLive)
}

function shallowLive(a: PostLive, b: PostLive): boolean {
  return (
    a.likes === b.likes &&
    a.creditsPaid === b.creditsPaid &&
    a.targetLikes === b.targetLikes &&
    a.granted === b.granted &&
    a.upscaled === b.upscaled &&
    a.upscaleCost === b.upscaleCost &&
    a.upscaleAffordable === b.upscaleAffordable
  )
}

export interface TrendingBoard {
  /** Hashtag ids, hottest first. */
  ids: string[]
  /** True when the trio comes from the server feed rather than the seeded week. */
  live: boolean
  weekSpeed: number
}

/**
 * What is trending right now. Uses the store's own clock (`meta.lastTickAt`) instead of
 * `Date.now()` so the selector is pure; the board only changes on rollover or a live fetch.
 */
export function useTrendingBoard(): TrendingBoard {
  const key = useGame((s, d, store) => {
    const now = s.meta.lastTickAt
    const ids = currentTrending(s, now, store.catalog, d.weekSpeed)
    const live = isLiveBoard(s, now, store.catalog)
    return `${ids.join('|')}#${live ? 1 : 0}#${d.weekSpeed}`
  })
  return useMemo<TrendingBoard>(() => {
    const [ids = '', live = '0', speed = '1'] = key.split('#')
    return { ids: ids ? ids.split('|') : [], live: live === '1', weekSpeed: Number(speed) || 1 }
  }, [key])
}

function isLiveBoard(s: GameState, now: number, catalog: Catalog): boolean {
  const live = s.liveTrending
  if (!live || now - live.fetchedAt >= LIVE_TRENDING_TTL_MS) return false
  const { hashtagById } = buildIndex(catalog)
  return live.tags.some((t) => hashtagById[t] !== undefined)
}

/** Whether the current in-game week is pinned for a demo. */
export function useWeekPinned(): boolean {
  return useGame((s) => s.weekOverride !== null)
}

// ---------------------------------------------------------------------------
// Pure helpers (catalog lookups and formatting the cards share)
// ---------------------------------------------------------------------------

/** `#tag` label for a hashtag id (falls back to the id). */
export function tagLabel(catalog: Catalog, id: string): string {
  return `#${buildIndex(catalog).hashtagById[id]?.tag ?? id}`
}

export interface ModelInfo {
  name: string
  vendorIcon: string
  kind: ModelKind
}

export function modelInfo(catalog: Catalog, modelId: string): ModelInfo | null {
  const def = buildIndex(catalog).modelById[modelId]
  return def ? { name: def.name, vendorIcon: def.vendorIcon, kind: def.kind } : null
}

/** Resolve a post's thumbnail keyword to an asset id for `<Art>`. */
export function thumbAssetFor(post: Pick<Post, 'modelId' | 'kind' | 'prompt'>): string {
  return pickThumb(thumbFamilyFor(post.modelId, post.kind), post.prompt, hashString(post.prompt))
}

export const PRECISION_CHIP: Record<Precision, string | null> = { native: null, fp8: 'FP8', q4: 'Q4' }

/** Deterministic pick from a pool by seed string (so a card keeps its quip across renders). */
export function pickBySeed<T>(pool: readonly T[], seed: string): T {
  return pool[hashString(seed) % pool.length] as T
}

/** `12s ago`, `4m ago`, `2h ago`, `3d ago`. */
export function timeAgo(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Credits-per-like for the breakdown line: two decimals below 10, compact above. */
export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n < 10) return n.toFixed(2)
  if (n < 1000) return n.toFixed(1)
  return String(Math.round(n))
}

/** Initials for an avatar tile: `Yoland Yan` → `YY`, `comfyanonymous` → `C`. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] as string).slice(0, 1).toUpperCase()
  return ((parts[0] as string)[0] + (parts[parts.length - 1] as string)[0]).toUpperCase()
}

/** Dispatched when a trending chip is clicked so the Studio's hashtag picker can adopt the tag. */
export const PICK_HASHTAG_EVENT = 'comfy:pick-hashtag'
export function pickHashtag(id: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<string>(PICK_HASHTAG_EVENT, { detail: id }))
}

// ---------------------------------------------------------------------------
// Shared feed clock
// ---------------------------------------------------------------------------
/** Fast (250 ms) clock published by FeedPanel so live cards share one interval. */
export const FeedClockContext = createContext(0)
/** Slow (2 s) clock derived from the fast one, for "3 s ago" labels. */
export const FeedSlowClockContext = createContext(0)

/** Tick shared by every settling card (likes, payout ring); 0 outside FeedPanel. */
export function useFeedNow(): number {
  return useContext(FeedClockContext)
}

/** Coarser tick for relative timestamps; 0 outside FeedPanel. */
export function useFeedSlowNow(): number {
  return useContext(FeedSlowClockContext)
}
