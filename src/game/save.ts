/**
 * Save serialization. The on-disk shape is `GameState` as JSON, validated on the way back in
 * with a deliberately forgiving schema: unknown keys are stripped, a field that fails validation
 * falls back to its fresh-state value, records/arrays drop only the entries that are broken, and
 * ids that no longer exist in the catalog are dropped. Only an unparseable blob (or one whose root
 * is not an object) counts as corrupt and yields a fresh state. The store keeps that blob under
 * `SAVE_CORRUPT_KEY` for forensics.
 *
 * Versioning: `MIGRATIONS[n]` upgrades a save at version `n` to `n + 1`; saves without a version
 * are treated as version 0. Saves from a newer client are accepted as-is (forward-compat) and
 * re-stamped with `SAVE_VERSION`.
 */
import { z } from 'zod'
import { CATALOG, type Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import {
  CITIZEN_TREND_MS,
  CLICK_JOB_BONUS_CAP,
  CONTRACT_ROTATE_MS,
  EVENT_MAX_GAP_MS,
  POST_WINDOW_MS,
  SAVE_KEY,
  SAVE_VERSION,
  TIER_UPGRADE_THRESHOLDS,
} from '@/game/constants'
import { DAILY_CLAIMED_KEEP } from '@/game/daily'
import { playerLevel } from '@/game/level'
import { STARTER_HARDWARE_ID, STARTER_MODEL_ID, createInitialState } from '@/game/state'
import type { ActiveContract, ActiveEvent, CitizenDrop, CitizenVisit, GameState, Job, Post, Precision } from '@/game/types'

export const SAVE_CORRUPT_KEY = `${SAVE_KEY}.corrupt`
/** Export codes start with this so a pasted string can be recognised. */
export const EXPORT_PREFIX = 'CC1|'
const MAX_TIER = TIER_UPGRADE_THRESHOLDS.length

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------
/** `MIGRATIONS[n]` migrates a save from version `n` to `n + 1`. Mutable so tests can hook it. */
export const MIGRATIONS: Record<number, (s: unknown) => unknown> = {
  // Pre-versioning saves carried no `v`; nothing else changed shape.
  0: (s) => ({ ...(s as Record<string, unknown>), v: 1 }),
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Run migrations from the save's version up to SAVE_VERSION. Throws if a migration throws. */
export function migrateSave(save: Record<string, unknown>): { data: Record<string, unknown>; from: number } {
  const from = typeof save.v === 'number' && Number.isInteger(save.v) && save.v >= 0 ? save.v : 0
  let data: unknown = save
  for (let v = from; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) break
    data = step(data)
    if (!isPlainObject(data)) throw new Error(`migration ${v} → ${v + 1} did not return an object`)
    data.v = v + 1
  }
  return { data: data as Record<string, unknown>, from }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const PRECISIONS: readonly Precision[] = ['native', 'fp8', 'q4']
const precisionSchema = z.enum(['native', 'fp8', 'q4'])
const kindSchema = z.enum(['image', 'video', '3d', 'audio'])
const eventKindSchema = z.enum([
  'modelDrop',
  'nodeBroke',
  'founderRepost',
  'spotReclaim',
  'powerSurge',
  'trendingSpark',
  'cloudPromo',
])

/** Field that falls back to the fresh-state value when missing or invalid. */
const fallback = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

const count = z.number().int().min(0)
const money = z.number().min(0)

/** Arrays keep only the entries that validate; a non-array is treated as empty. */
const arrayOf = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((arr) => arr.flatMap((x) => {
      const r = item.safeParse(x)
      return r.success ? [r.data as z.output<T>] : []
    }))

const stringArray = arrayOf(z.string())
const uniqueStrings = stringArray.transform((arr) => Array.from(new Set(arr)))

/**
 * Records keep only the entries whose value validates. A value that is not a record at all fails
 * the field, so the outer `fallback` restores the fresh-state default (the starter PC and SD 1.5)
 * instead of an empty record wiping it.
 */
const recordOf = <T extends z.ZodType>(value: T) =>
  z
    .record(z.string(), z.unknown())
    .transform((rec) => {
      const out: Record<string, z.output<T>> = {}
      for (const [k, v] of Object.entries(rec)) {
        const r = value.safeParse(v)
        if (r.success) out[k] = r.data as z.output<T>
      }
      return out
    })

const modelEntrySchema = z.object({
  precisions: arrayOf(precisionSchema).transform((list) => {
    const uniq = PRECISIONS.filter((p) => list.includes(p))
    return uniq.length > 0 ? uniq : (['native'] as Precision[])
  }),
  setup: z.boolean().catch(true),
})

const postSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  modelId: z.string().min(1),
  kind: kindSchema,
  precision: precisionSchema,
  prompt: z.string().catch(''),
  tags: stringArray,
  matchedTrending: stringArray,
  thumb: z.string().catch(''),
  cost: money.catch(0),
  targetLikes: money.catch(0),
  likes: money.catch(0),
  creditsPerLike: money.catch(0),
  creditsPaid: money.catch(0),
  windowMs: z.number().positive().catch(POST_WINDOW_MS),
  viral: z.boolean().catch(false),
  flop: z.boolean().catch(false),
  founderBoost: z.boolean().catch(false),
  // A ratioed post loses followers, so this one is signed.
  followersGained: z.number().catch(0),
  granted: z.boolean().catch(false),
  ratioed: z.boolean().optional().catch(undefined),
  mismatchedTags: stringArray.optional().catch(undefined),
  nearViral: z.boolean().optional().catch(undefined),
  upscaled: z.boolean().optional().catch(undefined),
  hubWorkflowId: z.string().optional().catch(undefined),
  roll: z.number().catch(1),
  trendMult: z.number().catch(1),
})

const jobSchema = z.object({
  id: z.string().min(1),
  modelId: z.string().min(1),
  precision: precisionSchema,
  prompt: z.string().catch(''),
  tags: stringArray,
  hardwareId: z.string().min(1),
  cost: money.catch(0),
  durationMs: z.number().positive(),
  createdAt: z.number(),
  startedAt: z.number().nullable().catch(null),
  endsAt: z.number().nullable().catch(null),
  clickBonusMs: money.catch(0),
  hubWorkflowId: z.string().optional().catch(undefined),
})

const activeContractSchema = z.object({
  defId: z.string().min(1),
  acceptedAt: z.number(),
  progress: money.catch(0),
  target: money.catch(0),
  rewardCredits: money.catch(0),
  done: z.boolean().catch(false),
  claimed: z.boolean().catch(false),
})

const activeEventSchema = z.object({
  defId: z.string().min(1),
  kind: eventKindSchema,
  startedAt: z.number(),
  endsAt: z.number(),
  payload: z.string().optional().catch(undefined),
  resolved: z.boolean().optional().catch(undefined),
})

const metaSchema = z.object({
  createdAt: fallback(z.number()),
  lastTickAt: fallback(z.number()),
  lastSavedAt: fallback(z.number()),
  playedSec: fallback(money),
  guestId: fallback(z.string()),
  season: fallback(z.number().int().min(1)),
})

const dailySchema = z.object({
  lastClaimDay: fallback(z.string().nullable()),
  streak: fallback(count),
  claimed: fallback(stringArray),
})

const statsSchema = z.object({
  posts: fallback(count),
  videos: fallback(count),
  flops: fallback(count),
  virals: fallback(count),
  quantizations: fallback(count),
  offlineClaims: fallback(count),
  rebrands: fallback(count),
  contractsDone: fallback(count),
  hubPublished: fallback(count),
  hubRuns: fallback(count),
  lorasTrained: fallback(count),
  bestPostLikes: fallback(money),
  lastPrompt: fallback(z.string()),
  lastPostKey: fallback(z.string()),
  bestCps: fallback(money),
  clicksWindow: fallback(arrayOf(z.number())),
  levelSeen: fallback(z.number().int().min(1)),
  ratioed: fallback(count),
  dislikes: fallback(money),
  spins: fallback(count),
  flips: fallback(count),
  // Roulette profit is signed.
  spinNet: fallback(z.number()),
  clickLockUntil: fallback(money),
  clickStrikes: fallback(count),
  clickStrikeAt: fallback(money),
  luckyClicks: fallback(count),
  landedStreak: fallback(count),
  bestLandedStreak: fallback(count),
})

const gambleSchema = z.object({
  freeSpinDay: fallback(z.string().nullable()),
  winStreak: fallback(count),
  dryStreak: fallback(count),
  coinStreak: fallback(count),
  pot: fallback(money),
})

/** One workflow on the citizens' board. A drop whose heat is unreadable falls back to cold. */
const citizenDropSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  publishedAt: z.number(),
  runs: count.catch(0),
  royalties: money.catch(0),
  heat: z.number().min(0).max(1).catch(0),
  nextRunAt: z.number().catch(0),
  cold: z.boolean().catch(true),
})

const citizenVisitSchema = z.object({
  id: z.string().min(1),
  at: z.number(),
  handle: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  credits: money.catch(0),
})

const settingsSchema = z.object({
  sfx: fallback(z.boolean()),
  particles: fallback(z.boolean()),
  reducedMotion: fallback(z.boolean()),
  projector: fallback(z.boolean()),
  autosave: fallback(z.boolean()),
})

/** Permissive mirror of `GameState`. Every field is optional; invalid values become `undefined`. */
export const saveSchema = z.object({
  v: fallback(z.number()),
  meta: fallback(metaSchema),
  credits: fallback(money),
  lifetimeCredits: fallback(money),
  seasonCredits: fallback(money),
  totalClicks: fallback(count),
  hardware: fallback(recordOf(count)),
  hardwareTiers: fallback(recordOf(z.number().int().min(0).max(MAX_TIER))),
  upgrades: fallback(uniqueStrings),
  models: fallback(recordOf(modelEntrySchema)),
  loras: fallback(uniqueStrings),
  mapNodes: fallback(uniqueStrings),
  achievements: fallback(uniqueStrings),
  posts: fallback(arrayOf(postSchema)),
  queue: fallback(arrayOf(jobSchema)),
  followers: fallback(money),
  followersFrac: fallback(money),
  lifetimeFollowers: fallback(money),
  lifetimeLikes: fallback(money),
  signups: fallback(count),
  rp: fallback(money),
  cp: fallback(money),
  cpSpent: fallback(money),
  hubRep: fallback(z.number()),
  contracts: fallback(
    z.object({
      active: fallback(arrayOf(activeContractSchema)),
      nextRotateAt: fallback(z.number()),
    }),
  ),
  events: fallback(
    z.object({
      active: fallback(arrayOf(activeEventSchema)),
      nextAt: fallback(z.number()),
    }),
  ),
  daily: fallback(dailySchema),
  gamble: fallback(gambleSchema),
  citizens: fallback(
    z.object({
      drops: fallback(arrayOf(citizenDropSchema)),
      feed: fallback(arrayOf(citizenVisitSchema)),
    }),
  ),
  stats: fallback(statsSchema),
  settings: fallback(settingsSchema),
  flags: fallback(recordOf(z.boolean())),
  weekOverride: fallback(z.number().int().nullable()),
  liveTrending: fallback(
    z
      .object({
        tags: stringArray,
        fetchedAt: z.number(),
      })
      .nullable(),
  ),
})

export type SaveData = z.output<typeof saveSchema>

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------
/** Copy only the defined fields of `partial` over `target`. */
function fill<T extends object>(target: T, partial: Partial<T> | undefined): T {
  if (!partial) return target
  for (const key of Object.keys(partial) as (keyof T)[]) {
    const value = partial[key]
    if (value !== undefined) target[key] = value as T[keyof T]
  }
  return target
}

function knownKeys<V>(rec: Record<string, V>, known: Record<string, unknown>): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [k, v] of Object.entries(rec)) if (k in known) out[k] = v
  return out
}

function knownIds(ids: string[], known: Record<string, unknown>): string[] {
  return ids.filter((id) => id in known)
}

/**
 * A post from a clock that ran ahead of ours (cloud saves cross devices) would pay nothing until
 * its `createdAt` comes round; shift it so its window starts now at the latest.
 */
function shiftPostToPresent(post: Post, now: number): Post {
  const shift = Math.max(0, post.createdAt - now)
  return shift > 0 ? { ...post, createdAt: post.createdAt - shift } : post
}

/**
 * Normalise a queued job: a running job always has an `endsAt` (`startedAt + durationMs`), a
 * pending one never does, the click bonus never exceeds its cap, and timestamps from a clock
 * ahead of ours are shifted back so the job neither waits nor runs in the future.
 */
function normaliseJob(job: Job, now: number): Job {
  const out: Job = { ...job }
  if (out.startedAt === null) out.endsAt = null
  else if (out.endsAt === null) out.endsAt = out.startedAt + out.durationMs
  out.clickBonusMs = Math.min(out.clickBonusMs, CLICK_JOB_BONUS_CAP * out.durationMs)
  const ahead = Math.max(out.createdAt, out.startedAt ?? -Infinity) - now
  if (ahead > 0) {
    out.createdAt -= ahead
    if (out.startedAt !== null) out.startedAt -= ahead
    if (out.endsAt !== null) out.endsAt -= ahead
  }
  return out
}

/** Build a full `GameState` from validated save data, dropping ids the catalog no longer has. */
function hydrate(data: SaveData, now: number, guestId: string, catalog: Catalog): GameState {
  const idx = buildIndex(catalog)
  const state = createInitialState(now, guestId)
  const { meta, contracts, events, daily, gamble, citizens, stats, settings, ...top } = data
  fill(state, top as Partial<GameState>)
  fill(state.meta, meta)
  fill(state.daily, daily)
  fill(state.gamble, gamble)
  if (citizens) {
    if (citizens.drops) state.citizens.drops = citizens.drops as CitizenDrop[]
    if (citizens.feed) state.citizens.feed = citizens.feed as CitizenVisit[]
  }
  fill(state.stats, stats)
  fill(state.settings, settings)
  if (contracts) {
    if (contracts.active) state.contracts.active = contracts.active as ActiveContract[]
    if (contracts.nextRotateAt !== undefined) state.contracts.nextRotateAt = contracts.nextRotateAt
  }
  if (events) {
    if (events.active) state.events.active = events.active as ActiveEvent[]
    if (events.nextAt !== undefined) state.events.nextAt = events.nextAt
  }

  state.v = SAVE_VERSION
  if (!state.meta.guestId) state.meta.guestId = guestId
  // A save written by a clock ahead of ours would otherwise report negative offline time, sleep
  // through random events for as long as it ran ahead, or freeze the contract board.
  if (state.meta.lastTickAt > now) state.meta.lastTickAt = now
  state.events.nextAt = Math.min(state.events.nextAt, now + EVENT_MAX_GAP_MS)
  state.contracts.nextRotateAt = Math.min(state.contracts.nextRotateAt, now + CONTRACT_ROTATE_MS)
  // A citizen run scheduled by a clock that ran ahead would otherwise never come due.
  for (const drop of state.citizens.drops) {
    if (drop.nextRunAt > now + CITIZEN_TREND_MS) drop.nextRunAt = now + CITIZEN_TREND_MS
  }
  // The cadence lockout is gone, so a lock a pre-cap save is still serving collapses to nothing.
  state.stats.clickLockUntil = 0
  // A save from before levels: award the level the stats already earned, without paying for it.
  if (stats?.levelSeen === undefined) state.stats.levelSeen = playerLevel(state)

  // Drop ids the catalog no longer knows.
  state.hardware = knownKeys(state.hardware, idx.hardwareById)
  state.hardwareTiers = knownKeys(state.hardwareTiers, idx.hardwareById)
  // Tier upgrades live in hardwareTiers; a stray `tier:` id in the list is legacy and dropped with the unknowns.
  state.upgrades = knownIds(state.upgrades, idx.upgradeById).filter((id) => !id.startsWith('tier:'))
  state.models = knownKeys(state.models, idx.modelById)
  state.loras = knownIds(state.loras, idx.hashtagById)
  state.mapNodes = knownIds(state.mapNodes, idx.mapNodeById)
  state.achievements = knownIds(state.achievements, achievementIndex(catalog))
  state.posts = (state.posts as Post[])
    .filter((p) => p.modelId in idx.modelById)
    .map((p) =>
      shiftPostToPresent(
        {
          ...p,
          tags: knownIds(p.tags, idx.hashtagById),
          matchedTrending: knownIds(p.matchedTrending, idx.hashtagById),
        },
        now,
      ),
    )
  state.queue = (state.queue as Job[])
    .filter((j) => j.modelId in idx.modelById && j.hardwareId in idx.hardwareById)
    .map((j) => normaliseJob({ ...j, tags: knownIds(j.tags, idx.hashtagById) }, now))
  state.contracts.active = state.contracts.active.filter((c) => c.defId in idx.contractById)
  state.events.active = state.events.active
    .filter((e) => e.defId in idx.eventById)
    .map((e) => {
      const def = idx.eventById[e.defId]
      const startedAt = Math.min(e.startedAt, now)
      const endsAt = def ? Math.min(e.endsAt, startedAt + def.durationSec * 1000) : e.endsAt
      return { ...e, kind: def?.kind ?? e.kind, startedAt, endsAt }
    })
  state.daily.claimed = state.daily.claimed.slice(-DAILY_CLAIMED_KEEP)
  if (state.liveTrending) {
    const tags = knownIds(state.liveTrending.tags, idx.hashtagById)
    state.liveTrending =
      tags.length > 0 ? { tags, fetchedAt: Math.min(state.liveTrending.fetchedAt, now) } : null
  }

  // Whatever the blob said, the player owns the starter box and SD 1.5 (when the catalog ships them):
  // without them there is no income and nothing to queue.
  if (STARTER_HARDWARE_ID in idx.hardwareById) {
    state.hardware[STARTER_HARDWARE_ID] = Math.max(1, state.hardware[STARTER_HARDWARE_ID] ?? 0)
  }
  if (STARTER_MODEL_ID in idx.modelById) {
    const starter = state.models[STARTER_MODEL_ID]
    if (!starter) state.models[STARTER_MODEL_ID] = { precisions: ['native'], setup: true }
    else starter.setup = true
  }
  return state
}

/** Achievements are not part of `CatalogIndex`; index them here. */
function achievementIndex(catalog: Catalog): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const a of catalog.achievements) out[a.id] = a
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/** JSON for storage. Pure: stamp `meta.lastSavedAt` before calling if you want it in the blob. */
export function serialize(state: GameState): string {
  return JSON.stringify({ ...state, v: SAVE_VERSION })
}

export interface LoadResult {
  state: GameState
  /** The blob could not be parsed at all; `state` is fresh and the caller should stash the blob. */
  corrupt: boolean
  /** Save version the blob carried, or null when there was no usable blob. */
  migratedFrom: number | null
}

/** `deserialize` with diagnostics. */
export function loadSave(raw: string | null, now: number, guestId: string, catalog: Catalog = CATALOG): LoadResult {
  if (raw === null || raw.trim() === '') return { state: createInitialState(now, guestId), corrupt: false, migratedFrom: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: createInitialState(now, guestId), corrupt: true, migratedFrom: null }
  }
  if (!isPlainObject(parsed)) return { state: createInitialState(now, guestId), corrupt: true, migratedFrom: null }
  let migrated: { data: Record<string, unknown>; from: number }
  try {
    migrated = migrateSave(parsed)
  } catch {
    return { state: createInitialState(now, guestId), corrupt: true, migratedFrom: null }
  }
  const result = saveSchema.safeParse(migrated.data)
  if (!result.success) return { state: createInitialState(now, guestId), corrupt: true, migratedFrom: migrated.from }
  return { state: hydrate(result.data, now, guestId, catalog), corrupt: false, migratedFrom: migrated.from }
}

/**
 * Parse a stored blob into a full `GameState`. `null`, empty, unparseable or non-object input
 * yields a fresh state; anything else is validated field by field and filled from the fresh state.
 * `catalog` defaults to the shipped data; tests pass fixtures.
 */
export function deserialize(raw: string | null, now: number, guestId: string, catalog: Catalog = CATALOG): GameState {
  return loadSave(raw, now, guestId, catalog).state
}

// ---------------------------------------------------------------------------
// Export / import codes
// ---------------------------------------------------------------------------
const B64_CHUNK = 0x8000

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') return Buffer.from(bytes).toString('base64')
  let bin = ''
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    // 32 KiB per call keeps `apply` well under the argument limit on every engine.
    const chunk = bytes.subarray(i, i + B64_CHUNK)
    bin += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'function') return new Uint8Array(Buffer.from(b64, 'base64'))
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** `'CC1|' + base64(utf8 json)`, safe to paste anywhere. */
export function exportString(state: GameState): string {
  return EXPORT_PREFIX + bytesToBase64(new TextEncoder().encode(serialize(state)))
}

/**
 * Inverse of `exportString`. Also accepts a raw JSON save. Returns null when the code is not a
 * save at all; a recognised but partially broken save is repaired like any other load.
 */
export function importString(s: string, now: number = Date.now(), guestId = '', catalog: Catalog = CATALOG): GameState | null {
  const text = s.trim()
  let json: string
  if (text.startsWith(EXPORT_PREFIX)) {
    try {
      json = new TextDecoder().decode(base64ToBytes(text.slice(EXPORT_PREFIX.length).replace(/\s+/g, '')))
    } catch {
      return null
    }
  } else if (text.startsWith('{')) {
    json = text
  } else {
    return null
  }
  const result = loadSave(json, now, guestId, catalog)
  return result.corrupt ? null : result.state
}
