/**
 * Deterministic randomness. Everything that rolls dice in the game core takes an `Rng`
 * so tests (and the trending-hashtag schedule) can be replayed exactly.
 */
import type { Rng } from '@/game/types'

/**
 * mulberry32: small, fast 32-bit PRNG with a full 2^32 period.
 * Same seed → same sequence, on every engine, forever.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit string hash → uint32. Used to seed per-prompt picks (thumbnails, etc.). */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Uniform float in [a, b). */
export function uniform(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng()
}

/** Uniform element from a non-empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new RangeError('pick: empty array')
  const i = Math.min(arr.length - 1, Math.floor(rng() * arr.length))
  return arr[i] as T
}

/**
 * Weighted element from a non-empty array. Entries with a non-positive or non-finite
 * `weight` can never be drawn; if nothing has positive weight, falls back to `pick`.
 */
export function weightedPick<T extends { weight: number }>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new RangeError('weightedPick: empty array')
  let total = 0
  for (const item of arr) {
    if (Number.isFinite(item.weight) && item.weight > 0) total += item.weight
  }
  if (total <= 0) return pick(rng, arr)

  let r = rng() * total
  let last: T | undefined
  for (const item of arr) {
    if (!(Number.isFinite(item.weight) && item.weight > 0)) continue
    last = item
    r -= item.weight
    if (r < 0) return item
  }
  // Floating-point slop on the final subtraction: return the last eligible entry.
  return last as T
}

/** True with probability `p` (clamped to [0, 1]). */
export function chance(rng: Rng, p: number): boolean {
  if (!(p > 0)) return false
  if (p >= 1) return true
  return rng() < p
}
