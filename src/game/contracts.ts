/**
 * Client contracts: CONTRACT_SLOTS rotating gigs from the cousin, the Discord mods, DevRel and
 * friends. A slot is accepted the moment it is rolled; progress accrues from the engine's
 * GameEvents (posts, clicks, likes, followers, virals) or, for "own N of X" and "have N quantized
 * models" goals, from the live state. Done contracts wait for the player to claim them.
 *
 * Each contract lives CONTRACT_ROTATE_MS from acceptance: an unfinished one is swapped for a
 * fresh pick when its lifetime runs out, a done one waits to be claimed. `contracts.nextRotateAt`
 * is the earliest moment `rotateContracts` has something to do (an expiry, a retry for an
 * unfillable slot, or 0 right after a claim), so the engine can gate on `now >= nextRotateAt`.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { CONTRACT_ROTATE_MS, CONTRACT_SLOTS, XP_CONTRACT } from '@/game/constants'
import { grantXp } from '@/game/level'
import { weightedPick } from '@/game/rng'
import type {
  ActiveContract,
  ContractDef,
  ContractGoal,
  Derived,
  GameEvent,
  GameState,
  HashtagDef,
  Post,
  Rng,
} from '@/game/types'

/** Floor on the credit reward so an early-game slot is never worth 3 credits. */
export const MIN_CONTRACT_REWARD = 100

/** The catalog slice claiming needs; a full `Catalog` satisfies it. */
export interface ContractCatalog {
  contracts: ContractDef[]
  hashtags?: HashtagDef[]
}

/** Number of (model, non-native precision) pairs unlocked this season. */
export function quantizedCount(state: GameState): number {
  let n = 0
  for (const id in state.models) {
    for (const p of state.models[id]?.precisions ?? []) if (p !== 'native') n += 1
  }
  return n
}

/** Target the progress bar counts up to. */
export function goalTarget(goal: ContractGoal): number {
  return goal.type === 'ownHardware' ? goal.count : goal.value
}

/**
 * Current value for goals measured against the live state (absolute goals), or null for goals
 * that accrue from events since acceptance.
 */
export function absoluteProgress(goal: ContractGoal, state: GameState): number | null {
  switch (goal.type) {
    case 'ownHardware':
      return state.hardware[goal.id] ?? 0
    case 'quantize':
      return quantizedCount(state)
    default:
      return null
  }
}

/** Whether `def` may be rolled into a free slot right now. */
export function contractEligible(def: ContractDef, state: GameState, derived: Derived): boolean {
  if (def.minTier > derived.bestTier) return false
  if (state.contracts.active.some((c) => c.defId === def.id)) return false
  // An absolute goal the player already meets would be a free reward, so skip it.
  const current = absoluteProgress(def.goal, state)
  return current === null || current < goalTarget(def.goal)
}

/** Credits paid on completion: `rewardSecs` of income at acceptance, never below the floor. */
export function contractReward(def: ContractDef, derived: Derived): number {
  return Math.max(MIN_CONTRACT_REWARD, Math.round(def.rewardSecs * derived.cps))
}

export function acceptContract(def: ContractDef, state: GameState, derived: Derived, now: number): ActiveContract {
  return {
    defId: def.id,
    acceptedAt: now,
    progress: absoluteProgress(def.goal, state) ?? 0,
    target: goalTarget(def.goal),
    rewardCredits: contractReward(def, derived),
    done: false,
    claimed: false,
  }
}

/** Moment an unfinished contract is swapped out (UI countdown). */
export function contractExpiresAt(c: ActiveContract): number {
  return c.acceptedAt + CONTRACT_ROTATE_MS
}

/** How soon to retry filling a slot no eligible def could fill (tier too low, pool exhausted). */
export const CONTRACT_REFILL_RETRY_MS = 60_000

/** True when a slot is free, a contract expired, or a claim asked for a refill. */
export function contractsDue(state: GameState, now: number): boolean {
  const { active, nextRotateAt } = state.contracts
  return now >= nextRotateAt || active.length < CONTRACT_SLOTS || active.some((c) => c.claimed)
}

/** Earliest pending expiry, or a retry delay when a slot could not be filled. */
function nextRotationAt(active: ActiveContract[], now: number): number {
  let t = active.length < CONTRACT_SLOTS ? now + CONTRACT_REFILL_RETRY_MS : Infinity
  for (const c of active) if (!c.done) t = Math.min(t, contractExpiresAt(c))
  return Number.isFinite(t) ? t : now + CONTRACT_ROTATE_MS
}

/**
 * Keeps CONTRACT_SLOTS contracts active: drops claimed and expired-unfinished contracts (done ones
 * survive until claimed), refills free slots with weighted picks among eligible defs and schedules
 * `nextRotateAt`. Returns no events (there is no GameEvent for a rotation) but keeps the
 * `GameEvent[]` shape so callers can spread it. Safe to call every tick.
 */
export function rotateContracts(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  now: number,
  rng: Rng,
): GameEvent[] {
  const slots = state.contracts
  const kept = slots.active.filter((c) => !c.claimed && (c.done || contractExpiresAt(c) > now))
  if (kept.length !== slots.active.length) slots.active = kept
  while (slots.active.length < CONTRACT_SLOTS) {
    const pool = catalog.contracts.filter((def) => contractEligible(def, state, derived))
    if (pool.length === 0) break
    slots.active.push(acceptContract(weightedPick(rng, pool), state, derived, now))
  }
  slots.nextRotateAt = nextRotationAt(slots.active, now)
  return []
}

const WORD_CACHE = new Map<string, RegExp>()

function wordRegex(keyword: string): RegExp {
  let re = WORD_CACHE.get(keyword)
  if (!re) {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u')
    WORD_CACHE.set(keyword, re)
  }
  return re
}

/**
 * Whether a post counts as "tagged" `tag`: explicitly selected, matched as trending, written as a
 * literal `#tag`, or hit through the hashtag's keywords on a word boundary.
 */
export function postHasTag(post: Post, tag: string, catalog: ContractCatalog): boolean {
  if (post.tags.includes(tag) || post.matchedTrending.includes(tag)) return true
  const prompt = post.prompt.toLowerCase()
  if (wordRegex(`#${tag}`).test(prompt)) return true
  const def = catalog.hashtags?.find((h) => h.id === tag)
  if (!def) return false
  return def.keywords.some((k) => wordRegex(k).test(prompt))
}

/** Progress contributed by one tick's events to an event-driven goal. */
function eventProgress(goal: ContractGoal, events: GameEvent[], postsById: Map<string, Post>, catalog: Catalog): number {
  let n = 0
  for (const ev of events) {
    switch (goal.type) {
      case 'clicks':
        if (ev.type === 'click') n += 1
        break
      case 'posts': {
        if (ev.type !== 'postCreated') break
        const post = postsById.get(ev.postId)
        if (!post) {
          // Already evicted from the feed: count it only for unfiltered goals.
          if (!goal.kind && !goal.tag) n += 1
          break
        }
        if (goal.kind && post.kind !== goal.kind) break
        if (goal.tag && !postHasTag(post, goal.tag, catalog)) break
        n += 1
        break
      }
      case 'likes': {
        if (ev.type !== 'postResolved') break
        const post = postsById.get(ev.postId)
        if (post) n += post.likes > 0 ? post.likes : post.targetLikes
        break
      }
      case 'followers': {
        if (ev.type !== 'postResolved') break
        const post = postsById.get(ev.postId)
        if (post) n += post.followersGained
        break
      }
      case 'virals':
        if (ev.type === 'postResolved' && ev.viral) n += 1
        break
      case 'ownHardware':
      case 'quantize':
        break
      default: {
        const never: never = goal
        return never
      }
    }
  }
  return n
}

/**
 * Advances every open contract from this tick's events (and the live state for absolute goals).
 * Emits `contractDone` the moment a contract completes so the UI can nudge the player to claim.
 */
export function progressContracts(state: GameState, events: GameEvent[], catalog: Catalog): GameEvent[] {
  const out: GameEvent[] = []
  const open = state.contracts.active.filter((c) => !c.done && !c.claimed)
  if (open.length === 0) return out
  const { contractById } = buildIndex(catalog)
  let postsById: Map<string, Post> | null = null
  for (const c of open) {
    const def = contractById[c.defId]
    if (!def) continue
    const absolute = absoluteProgress(def.goal, state)
    if (absolute !== null) {
      c.progress = absolute
    } else if (events.length > 0) {
      postsById ??= new Map(state.posts.map((p) => [p.id, p]))
      c.progress += eventProgress(def.goal, events, postsById, catalog)
    }
    if (c.progress >= c.target) {
      c.progress = c.target
      c.done = true
      out.push({ type: 'contractDone', defId: c.defId })
    }
  }
  return out
}

/**
 * Pays out a done contract at `idx` (credits + optional RP/CP), bumps `stats.contractsDone`, banks
 * XP_CONTRACT of XP, frees the slot and sets `nextRotateAt = 0` so the next `rotateContracts`
 * refills it. Returns the `xp` event on a successful claim (the completion itself was already
 * announced by `progressContracts`) and `[]` when there was nothing to claim.
 */
export function claimContract(state: GameState, idx: number, catalog: ContractCatalog): GameEvent[] {
  const c = state.contracts.active[idx]
  if (!c || !c.done || c.claimed) return []
  const def = catalog.contracts.find((d) => d.id === c.defId)
  c.claimed = true
  state.credits += c.rewardCredits
  state.lifetimeCredits += c.rewardCredits
  state.seasonCredits += c.rewardCredits
  if (def?.rewardRp) state.rp += def.rewardRp
  if (def?.rewardCp) state.cp += def.rewardCp
  state.stats.contractsDone += 1
  state.contracts.active.splice(idx, 1)
  state.contracts.nextRotateAt = 0
  const xp = grantXp(state, XP_CONTRACT, 'contract')
  return xp ? [xp] : []
}
