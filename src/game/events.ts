/**
 * Random events — the timeline's weather. One rolls every uniform(EVENT_MIN_GAP_MS,
 * EVENT_MAX_GAP_MS), weighted by `weight` among defs whose `minTier` the rig has reached and
 * whose kind is not already running.
 *
 * Kind → effect (consumed by derived.ts through `eventEffects`):
 *   modelDrop      tagLikes +1.0 on the payload hashtag (double likes on that tag)
 *   cloudPromo     globalMult +1 → ×2 income (derived multiplies Π(1 + v))
 *   powerSurge     powerBudget −POWER_SURGE_BUDGET_FRACTION × the rig's own budget (base circuit
 *                  plus every owned upgrade/map-node `powerBudget`), i.e. a real 40 % brownout
 *                  at any stage of the game, not a flat −260 W
 *   nodeBroke      globalMult −0.5 → income halved until the player clicks the node
 *   spotReclaim    rigMult 0 on the payload cloud node, i.e. it goes dark. Events cannot read
 *                  `derived`, so the effect is emitted unless the state itself owns a
 *                  `reservedCapacity` effect (upgrade or map node); derived.ts may additionally
 *                  skip `rigMult` effects with value 0 when `derived.reservedCapacity` is set.
 *   founderRepost  no Effect — `eventLikesBoost` returns ×3 while it runs
 *   trendingSpark  no Effect — catching it (resolveEvent) arms `flags.sparkNext`, which
 *                  `eventLikesBoost` cashes in (×3) on the next post and clears
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { EVENT_MAX_GAP_MS, EVENT_MIN_GAP_MS } from '@/game/constants'
import { powerBudget } from '@/game/power'
import { pick, uniform, weightedPick } from '@/game/rng'
import type { ActiveEvent, Derived, Effect, EventDef, EventKind, GameEvent, GameState, Rng } from '@/game/types'

export const POWER_SURGE_BUDGET_FRACTION = 0.4
export const NODE_BROKE_INCOME_MULT = 0.5
export const CLOUD_PROMO_MULT = 2
export const MODEL_DROP_TAG_LIKES = 1.0
/** Likes multiplier for a founder repost window and for a caught trending spark. */
export const EVENT_LIKES_BOOST = 3
/** Armed by catching a spark; consumed by the next post. */
export const SPARK_FLAG = 'sparkNext'
/** Permanent record that a spark was ever caught (for achievements, survives the consume). */
export const SPARK_CAUGHT_FLAG = 'sparkCaught'
/** Set when a broken node is fixed by clicking. */
export const FIXED_NODE_FLAG = 'fixedNode'

/** Kinds the player can act on (everything else just runs out). */
export const RESOLVABLE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>(['nodeBroke', 'trendingSpark'])

export function activeEvent(state: GameState, defId: string): ActiveEvent | undefined {
  return state.events.active.find((e) => e.defId === defId && !e.resolved)
}

export function isEventActive(state: GameState, kind: EventKind): boolean {
  return state.events.active.some((e) => e.kind === kind && !e.resolved)
}

/** Owned hardware ids in the cloud-node family (spot reclaim targets). */
export function ownedCloudNodes(state: GameState, catalog: Catalog): string[] {
  const { hardwareById } = buildIndex(catalog)
  const out: string[] = []
  for (const id in state.hardware) {
    if ((state.hardware[id] ?? 0) > 0 && hardwareById[id]?.family === 'cloud-node') out.push(id)
  }
  return out
}

/** Effects the state owns outright (upgrades and map nodes) — events cannot read `derived`. */
function ownedEffects(state: GameState, catalog: Catalog): Effect[] {
  const { upgradeById, mapNodeById } = buildIndex(catalog)
  const out: Effect[] = []
  for (const id of state.upgrades) for (const e of upgradeById[id]?.effects ?? []) out.push(e)
  for (const id of state.mapNodes) for (const e of mapNodeById[id]?.effects ?? []) out.push(e)
  return out
}

/** Whether the state owns a `reservedCapacity` effect through an upgrade or a map node. */
export function hasReservedCapacity(state: GameState, catalog: Catalog): boolean {
  return ownedEffects(state, catalog).some((e) => e.kind === 'reservedCapacity')
}

/** The rig's own power budget (base circuit + owned upgrades/map nodes), before any event. */
export function ownedPowerBudget(state: GameState, catalog: Catalog): number {
  return powerBudget(ownedEffects(state, catalog))
}

/** Kind-level preconditions beyond `minTier` (a spot reclaim needs a cloud node to reclaim). */
function kindAvailable(kind: EventKind, state: GameState, catalog: Catalog): boolean {
  switch (kind) {
    case 'spotReclaim':
      return ownedCloudNodes(state, catalog).length > 0
    case 'modelDrop':
      return catalog.hashtags.length > 0
    default:
      return true
  }
}

function rollPayload(kind: EventKind, state: GameState, catalog: Catalog, rng: Rng): string | undefined {
  switch (kind) {
    case 'modelDrop': {
      // Prefer subject tags; a "double likes on #videogen" drop is less of a story.
      const subjects = catalog.hashtags.filter((h) => !h.kind)
      return pick(rng, subjects.length > 0 ? subjects : catalog.hashtags).id
    }
    case 'spotReclaim':
      return pick(rng, ownedCloudNodes(state, catalog))
    default:
      return undefined
  }
}

/** Defs that could start right now. */
export function eligibleEvents(state: GameState, derived: Derived, catalog: Catalog): EventDef[] {
  const running = new Set(state.events.active.filter((e) => !e.resolved).map((e) => e.kind))
  return catalog.events.filter(
    (def) => def.minTier <= derived.bestTier && !running.has(def.kind) && kindAvailable(def.kind, state, catalog),
  )
}

/**
 * Starts one event once `events.nextAt` has passed and schedules the next roll. When nothing is
 * eligible the roll is retried after the minimum gap.
 */
export function maybeStartEvent(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  now: number,
  rng: Rng,
): GameEvent[] {
  if (now < state.events.nextAt) return []
  const pool = eligibleEvents(state, derived, catalog)
  if (pool.length === 0) {
    state.events.nextAt = now + EVENT_MIN_GAP_MS
    return []
  }
  const def = weightedPick(rng, pool)
  const payload = rollPayload(def.kind, state, catalog, rng)
  const active: ActiveEvent = {
    defId: def.id,
    kind: def.kind,
    startedAt: now,
    endsAt: now + def.durationSec * 1000,
  }
  if (payload !== undefined) active.payload = payload
  state.events.active.push(active)
  state.events.nextAt = now + Math.round(uniform(rng, EVENT_MIN_GAP_MS, EVENT_MAX_GAP_MS))
  return [{ type: 'eventStart', defId: def.id, kind: def.kind }]
}

/** Drops events that ran out (or were resolved and not yet removed), emitting `eventEnd` each. */
export function expireEvents(state: GameState, now: number): GameEvent[] {
  const out: GameEvent[] = []
  const keep: ActiveEvent[] = []
  for (const e of state.events.active) {
    if (e.resolved || e.endsAt <= now) out.push({ type: 'eventEnd', defId: e.defId, kind: e.kind })
    else keep.push(e)
  }
  if (out.length > 0) state.events.active = keep
  return out
}

/** Effects contributed by running events (see the module comment for the per-kind encoding). */
export function eventEffects(state: GameState, catalog: Catalog): Effect[] {
  const out: Effect[] = []
  let reserved: boolean | null = null
  let budget: number | null = null
  for (const e of state.events.active) {
    if (e.resolved) continue
    switch (e.kind) {
      case 'modelDrop':
        if (e.payload) out.push({ kind: 'tagLikes', tag: e.payload, value: MODEL_DROP_TAG_LIKES })
        break
      case 'cloudPromo':
        out.push({ kind: 'globalMult', value: CLOUD_PROMO_MULT - 1 })
        break
      case 'powerSurge':
        // A brownout of the *current* budget: the copy promises "budget drops 40%", at every stage.
        budget ??= ownedPowerBudget(state, catalog)
        out.push({ kind: 'powerBudget', value: -POWER_SURGE_BUDGET_FRACTION * budget })
        break
      case 'nodeBroke':
        out.push({ kind: 'globalMult', value: NODE_BROKE_INCOME_MULT - 1 })
        break
      case 'spotReclaim':
        if (!e.payload) break
        reserved ??= hasReservedCapacity(state, catalog)
        if (!reserved) out.push({ kind: 'rigMult', hardwareId: e.payload, value: 0 })
        break
      case 'founderRepost':
      case 'trendingSpark':
        break
      default: {
        const never: never = e.kind
        return never
      }
    }
  }
  return out
}

/**
 * Likes multiplier for the post being rolled right now: ×3 during a founder repost window, ×3 if a
 * caught spark is armed. Consumes the spark flag (one post only) — call it once per rollPost.
 */
export function eventLikesBoost(state: GameState): number {
  let mult = 1
  if (isEventActive(state, 'founderRepost')) mult *= EVENT_LIKES_BOOST
  if (state.flags[SPARK_FLAG] === true) {
    mult *= EVENT_LIKES_BOOST
    delete state.flags[SPARK_FLAG]
  }
  return mult
}

/**
 * Player interaction with a running event: clicking a broken node fixes it (`fixedNode`), catching
 * a spark inside its window arms `sparkNext`. The event ends immediately. Anything else — an
 * unknown def, a kind that cannot be resolved, or a click after `endsAt` — is a no-op.
 */
export function resolveEvent(state: GameState, defId: string, now: number): GameEvent[] {
  const idx = state.events.active.findIndex((e) => e.defId === defId && !e.resolved)
  if (idx < 0) return []
  const e = state.events.active[idx] as ActiveEvent
  if (!RESOLVABLE_KINDS.has(e.kind) || now > e.endsAt) return []
  e.resolved = true
  e.endsAt = now
  state.events.active.splice(idx, 1)
  if (e.kind === 'nodeBroke') state.flags[FIXED_NODE_FLAG] = true
  if (e.kind === 'trendingSpark') {
    state.flags[SPARK_FLAG] = true
    state.flags[SPARK_CAUGHT_FLAG] = true
  }
  return [{ type: 'eventEnd', defId: e.defId, kind: e.kind }]
}
