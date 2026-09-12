/**
 * Player actions. Every action validates, mutates `ctx.state` in place and returns
 * `{ events, dirty }`. `dirty` tells the caller to recompute `Derived`. Validation failures
 * return `{ events: [], dirty: false, error }` and leave the state untouched.
 *
 * Actions take an `ActionContext` first so the store can bind it once per frame:
 * `click({ state, derived, catalog, now, rng })`, `buyHardware(ctx, 'rtx-4090', 10)`, …
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { POST_WINDOW_MS } from '@/game/constants'
import { claimContract as payContract, progressContracts } from '@/game/contracts'
import { canClaim, claimDaily as payDaily } from '@/game/daily'
import { maxAffordable } from '@/game/economy'
import { addCredits, pushEvents } from '@/game/engine'
import { RESOLVABLE_KINDS, resolveEvent as resolveActiveEvent } from '@/game/events'
import { applyPurchase, canBuy } from '@/game/hardware'
import { canAffordNode, currencyBalance, isNodeUnlocked, mapNodeAvailable, unlockNode } from '@/game/map'
import { canRebrand, rebrand as applyRebrand } from '@/game/prestige'
import { applyQuantize, canQuantize, quantFee, setupFee } from '@/game/quantize'
import { SPAGHETTI_FLAG, advanceQueue, applyClickToJobs, createJob, jobCost, type JobInput } from '@/game/studio'
import type {
  Currency,
  Derived,
  GameEvent,
  GameSettings,
  GameState,
  Post,
  Precision,
  Rng,
  UpgradeDef,
} from '@/game/types'
import { describeUnlock, hasUpgrade, isUnlocked } from '@/game/unlock'

export type { JobInput, JobInput as QueueJobInput } from '@/game/studio'

// ---------------------------------------------------------------------------
// Types & tunables
// ---------------------------------------------------------------------------
export interface ActionContext {
  state: GameState
  derived: Derived
  catalog: Catalog
  now: number
  rng: Rng
}

export interface ActionResult {
  events: GameEvent[]
  /** True when `Derived` must be recomputed before the next render/action. */
  dirty: boolean
  error?: string
}

export type BuyCount = 1 | 10 | 100 | 'max'

/** A LoRA costs 20 minutes of income, never less than 500 credits. */
export const LORA_COST_SECS = 1200
export const LORA_MIN_COST = 500
/** Map node that unlocks the LoRA trainer. */
export const LORA_MAP_NODE = 'lora-training'
/**
 * Upscaling reruns the job at 30% of what it *originally* cost (`Post.cost`, so a post from an
 * hour ago is not repriced at today's cps) for a second wave of 40% more likes at the post's own
 * credits-per-like. Flops are refused: 0.4 × a flop roll never covers 0.3. For any landed roll
 * (M ≥ 0.85) it is at worst break-even at Q4 and comfortably positive at native.
 */
export const UPSCALE_COST_FRACTION = 0.3
export const UPSCALE_LIKES_FRACTION = 0.4
/** Sliding window used for the clicks/s readout. */
export const CLICK_WINDOW_MS = 2_000
const CLICK_WINDOW_MAX = 64
/** Hidden-achievement flags raised here (see src/data/achievements.ts). */
export const SPEEDRUN_FLAG = 'speedrun'
export const BROKE_AT_ZERO_FLAG = 'brokeAtZero'
/**
 * Flags only the UI can discover (a ticker line clicked seven times, the Konami code, seed 42
 * typed into the seed box, the rickroll). The UI raises them through `setFlag`, which announces
 * the `easterEgg` event; src/data/mapNodes.ts (hidden lane) and achievements.ts key off them.
 * Other flag keys are still accepted; this list documents the ones nothing in src/game sets.
 */
export const UI_FLAGS = ['konami', 'ticker-seven', 'seed42', 'rickroll'] as const
/** "Speedrun": the first cloud node bought inside this much play time. */
export const SPEEDRUN_SECS = 25 * 60
/** Float slack for "exactly zero" credits after a purchase. */
const ZERO_EPSILON = 1e-6

const CURRENCY_LABEL: Record<Currency, string> = { credits: 'credits', rp: 'RP', cp: 'CP' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fail(error: string): ActionResult {
  return { events: [], dirty: false, error }
}

function ok(events: GameEvent[], dirty: boolean): ActionResult {
  return { events, dirty }
}

/**
 * Pay in a currency. Credits leave the bank; CP is tracked through `cpSpent` (map.ts convention,
 * so the prestige multiplier keeps reading `state.cp`); RP has no spent counter outside the map,
 * so an RP-priced upgrade really deducts it.
 */
function spend(state: GameState, currency: Currency, cost: number): void {
  switch (currency) {
    case 'credits':
      state.credits -= cost
      break
    case 'cp':
      state.cpSpent += cost
      break
    case 'rp':
      state.rp -= cost
      break
  }
}

/** After a credits purchase: "Out Of Credits, Not Ideas" fires when the bank lands on exactly zero. */
function noteSpend(state: GameState): void {
  if (Math.abs(state.credits) < ZERO_EPSILON) state.flags[BROKE_AT_ZERO_FLAG] = true
}

/** `tier:<hardwareId>:<n>` → `{ hardwareId, tier }`, or null for a named upgrade. */
function parseTierUpgradeId(id: string): { hardwareId: string; tier: number } | null {
  if (!id.startsWith('tier:')) return null
  const lastColon = id.lastIndexOf(':')
  const hardwareId = id.slice(5, lastColon)
  const tier = Number(id.slice(lastColon + 1))
  if (!hardwareId || !Number.isInteger(tier) || tier < 1) return null
  return { hardwareId, tier }
}

function findUpgrade(catalog: Catalog, id: string): UpgradeDef | undefined {
  return buildIndex(catalog).upgradeById[id]
}

/** Keep the last couple of seconds of click timestamps for the clicks/s readout. */
function recordClick(state: GameState, now: number): void {
  const w = state.stats.clicksWindow
  w.push(now)
  const cutoff = now - CLICK_WINDOW_MS
  let drop = 0
  while (drop < w.length && (w[drop] as number) < cutoff) drop++
  if (drop > 0 || w.length > CLICK_WINDOW_MAX) w.splice(0, Math.max(drop, w.length - CLICK_WINDOW_MAX))
}

/** Clicks per second over the sliding window. */
export function clickRate(state: GameState, now: number): number {
  const cutoff = now - CLICK_WINDOW_MS
  let n = 0
  for (const t of state.stats.clicksWindow) if (t >= cutoff && t <= now) n++
  return n / (CLICK_WINDOW_MS / 1000)
}

/** Cost of training a LoRA right now. */
export function loraCost(derived: Derived): number {
  return Math.max(LORA_MIN_COST, Math.round(LORA_COST_SECS * derived.cps))
}

/**
 * Cost of upscaling a post: UPSCALE_COST_FRACTION of the job's original cost, or null when its
 * model is no longer in the catalog. A post saved before `Post.cost` existed (cost 0) is priced
 * off today's job cost instead.
 */
export function upscaleCost(post: Post, ctx: Pick<ActionContext, 'derived' | 'catalog'>): number | null {
  const model = buildIndex(ctx.catalog).modelById[post.modelId]
  if (!model) return null
  const original = post.cost > 0 ? post.cost : jobCost(model, post.precision, ctx.derived, ctx.catalog)
  return Math.max(1, Math.round(UPSCALE_COST_FRACTION * original))
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Generate: earn `clickValue`, shave time off the running job, count the click. */
export function click(ctx: ActionContext): ActionResult {
  const { state, derived, catalog, now } = ctx
  const value = Math.max(0, derived.clickValue)
  addCredits(state, value)
  state.totalClicks += 1
  recordClick(state, now)
  applyClickToJobs(state, now)
  const events: GameEvent[] = [{ type: 'click', value }]
  pushEvents(events, progressContracts(state, events, catalog))
  return ok(events, false)
}

/**
 * Buy `n` units (1/10/100) or as many as the bank allows ('max'). Numeric counts are clamped to
 * the unit cap and must be affordable in full; 'max' buys at least one or fails.
 */
export function buyHardware(ctx: ActionContext, id: string, n: BuyCount = 1): ActionResult {
  const { state, derived, catalog } = ctx
  const def = buildIndex(catalog).hardwareById[id]
  if (!def) return fail(`Unknown hardware: ${id}`)
  const owned = state.hardware[id] ?? 0
  const room = def.max === undefined ? Infinity : def.max - owned
  if (room <= 0) return fail(`You already own the maximum ${def.max} × ${def.name}`)

  // Gate on a single unit first so lock reasons (ROCm, unlock condition) beat "not enough credits".
  const gate = canBuy(def, state, derived, catalog, 1)
  if (!gate.ok) return fail(gate.reason ?? `${def.name} is locked`)

  const count = n === 'max' ? Math.min(room, maxAffordable(def, owned, state.credits)) : Math.min(room, n)
  if (count < 1) return fail('Not enough credits')
  if (count > 1) {
    const bulk = canBuy(def, state, derived, catalog, count)
    if (!bulk.ok) return fail(bulk.reason ?? 'Not enough credits')
  }

  applyPurchase(state, def, count)
  noteSpend(state)
  if (def.family === 'cloud-node' && state.meta.playedSec < SPEEDRUN_SECS) state.flags[SPEEDRUN_FLAG] = true
  const events: GameEvent[] = [{ type: 'purchase', hardwareId: id, count }]
  pushEvents(events, progressContracts(state, events, catalog))
  return ok(events, true)
}

/** Buy a named upgrade or a virtual `tier:<hardwareId>:<n>` upgrade (tiers must be bought in order). */
export function buyUpgrade(ctx: ActionContext, id: string): ActionResult {
  const { state, derived, catalog } = ctx
  const def = findUpgrade(catalog, id)
  if (!def) return fail(`Unknown upgrade: ${id}`)
  if (hasUpgrade(state, id)) return fail(`${def.name} is already owned`)
  const tier = parseTierUpgradeId(id)
  if (tier) {
    const current = state.hardwareTiers[tier.hardwareId] ?? 0
    if (tier.tier !== current + 1) return fail(`Buy tier ${current + 1} first`)
  }
  if (!isUnlocked(def.unlock, state, derived, catalog)) {
    return fail(describeUnlock(def.unlock, catalog) || `${def.name} is locked`)
  }
  const currency = def.currency ?? 'credits'
  const cost = Math.max(0, Math.ceil(def.cost))
  if (currencyBalance(state, currency, catalog) < cost) return fail(`Not enough ${CURRENCY_LABEL[currency]}`)

  spend(state, currency, cost)
  if (currency === 'credits') noteSpend(state)
  if (tier) state.hardwareTiers[tier.hardwareId] = tier.tier
  else state.upgrades.push(id)
  return ok([{ type: 'upgrade', id }], true)
}

/** Unlock a node on the Graph. Parents, unlock condition and balance are all checked. */
export function unlockMapNode(ctx: ActionContext, id: string): ActionResult {
  const { state, derived, catalog } = ctx
  const node = buildIndex(catalog).mapNodeById[id]
  if (!node) return fail(`Unknown map node: ${id}`)
  if (isNodeUnlocked(state, id)) return fail(`${node.title} is already unlocked`)
  if (!mapNodeAvailable(node, state, derived, catalog)) {
    const missingParent = node.parents.find((p) => !isNodeUnlocked(state, p))
    if (missingParent) {
      const parent = buildIndex(catalog).mapNodeById[missingParent]
      return fail(`Unlock ${parent?.title ?? missingParent} first`)
    }
    return fail(describeUnlock(node.unlock, catalog) || `${node.title} is locked`)
  }
  if (!canAffordNode(node, state, catalog)) return fail(`Not enough ${CURRENCY_LABEL[node.currency]}`)
  if (!unlockNode(state, node, catalog)) return fail(`Could not unlock ${node.title}`)
  if (node.currency === 'credits') noteSpend(state)
  return ok([{ type: 'mapUnlock', id }], true)
}

/**
 * Quantize an installed model to fp8/q4 for a fee. `canQuantize` owns the rules (model owned,
 * quantizable, matching Graph node, fee affordable) and the reasons.
 */
export function quantize(ctx: ActionContext, modelId: string, precision: Precision): ActionResult {
  const { state, catalog } = ctx
  const model = buildIndex(catalog).modelById[modelId]
  if (!model) return fail(`Unknown model: ${modelId}`)
  const check = canQuantize(model, precision, state, catalog)
  if (!check.ok) return fail(check.reason ?? `${model.name} can’t be quantized right now`)
  applyQuantize(state, modelId, precision, quantFee(model, precision, catalog))
  noteSpend(state)
  return ok([], false)
}

/**
 * Install a model. Free when it fits your best card; otherwise `setupFee` (the "download it
 * anyway and quantize later" path). API models need the API Nodes map node.
 */
export function setupModel(ctx: ActionContext, modelId: string): ActionResult {
  const { state, derived, catalog } = ctx
  const model = buildIndex(catalog).modelById[modelId]
  if (!model) return fail(`Unknown model: ${modelId}`)
  const existing = state.models[modelId]
  if (existing?.setup) return fail(`${model.name} is already set up`)
  if (!isUnlocked(model.unlock, state, derived, catalog)) {
    return fail(describeUnlock(model.unlock, catalog) || `${model.name} is locked`)
  }
  if (model.api && !derived.apiNodes) return fail('Unlock API Nodes on the Graph first')
  const fee = setupFee(model, derived, catalog)
  if (state.credits < fee) return fail('Not enough credits')
  state.credits -= fee
  if (fee > 0) noteSpend(state)
  if (existing) existing.setup = true
  else state.models[modelId] = { precisions: ['native'], setup: true }
  return ok([], false)
}

/** Train a style LoRA for a hashtag (permanent likes bonus on it, applied in derived.ts). */
export function trainLora(ctx: ActionContext, tagId: string): ActionResult {
  const { state, derived, catalog } = ctx
  const tag = buildIndex(catalog).hashtagById[tagId]
  if (!tag) return fail(`Unknown hashtag: ${tagId}`)
  if (!state.mapNodes.includes(LORA_MAP_NODE)) return fail('Unlock LoRA Training on the Graph first')
  if (state.loras.includes(tagId)) return fail(`#${tag.tag} already has a LoRA`)
  const cost = loraCost(derived)
  if (state.credits < cost) return fail('Not enough credits')
  state.credits -= cost
  noteSpend(state)
  state.loras.push(tagId)
  state.stats.lorasTrained += 1
  return ok([], true)
}

/** Queue a generation. Starts it immediately when a slot is free. */
export function queueJob(ctx: ActionContext, input: JobInput): ActionResult {
  const { state, derived, catalog, now, rng } = ctx
  const hadSpaghetti = state.flags[SPAGHETTI_FLAG] === true
  const result = createJob(state, derived, catalog, input, now, rng)
  if (!result.ok) return fail(result.reason)
  noteSpend(state)
  const events: GameEvent[] = []
  // createJob raises the flag when the prompt mentions spaghetti; announce it the first time.
  if (!hadSpaghetti && state.flags[SPAGHETTI_FLAG] === true) events.push({ type: 'easterEgg', id: SPAGHETTI_FLAG })
  pushEvents(events, advanceQueue(state, derived, catalog, now, rng))
  // advanceQueue may also have finished a job that came due since the last tick; the tick never
  // sees that `postCreated`, so contracts must be progressed here (as `click` does).
  pushEvents(events, progressContracts(state, events, catalog))
  return ok(events, false)
}

/** Collect a finished contract's reward. RP/CP rewards change the global multiplier. */
export function claimContract(ctx: ActionContext, index: number): ActionResult {
  const { state } = ctx
  const contract = state.contracts.active[index]
  if (!contract) return fail('No such contract')
  if (contract.claimed) return fail('Already claimed')
  if (!contract.done) return fail('Contract not finished yet')
  const { rp, cp } = state
  const events: GameEvent[] = []
  pushEvents(events, payContract(state, index, ctx.catalog))
  return ok(events, state.rp !== rp || state.cp !== cp)
}

/** Daily login reward. */
export function claimDaily(ctx: ActionContext): ActionResult {
  const { state, derived, now } = ctx
  if (!canClaim(state, now)) return fail('Already claimed today')
  const { rp, cp } = state
  const events: GameEvent[] = []
  pushEvents(events, payDaily(state, derived, now))
  return ok(events, state.rp !== rp || state.cp !== cp)
}

/** Prestige: reset the season for CP. */
export function rebrand(ctx: ActionContext): ActionResult {
  const { state, catalog, now } = ctx
  if (!canRebrand(state, catalog)) return fail('Own a cloud node or a region before rebranding')
  const events: GameEvent[] = []
  pushEvents(events, applyRebrand(state, catalog, now))
  return ok(events, true)
}

/** Interact with an active event (fix the broken node, catch the trending spark). */
export function resolveEvent(ctx: ActionContext, defId: string): ActionResult {
  const { state, now } = ctx
  const active = state.events.active.find((e) => e.defId === defId && !e.resolved)
  if (!active) return fail('Nothing to resolve')
  if (!RESOLVABLE_KINDS.has(active.kind)) return fail('This event runs its course on its own')
  const events = resolveActiveEvent(state, defId, now)
  if (events.length === 0) return fail('Too late, it already ended')
  return ok(events, true)
}

/** Flip (or set) a boolean setting. */
export function toggleSetting(ctx: ActionContext, key: keyof GameSettings, value?: boolean): ActionResult {
  const { state } = ctx
  if (!(key in state.settings)) return fail(`Unknown setting: ${String(key)}`)
  state.settings[key] = value ?? !state.settings[key]
  return ok([], false)
}

/**
 * Raise a discovery flag from the UI (see `UI_FLAGS`). Idempotent: the first call sets the flag
 * and announces an `easterEgg`; a repeat is a validation failure so nothing is announced twice.
 * `dirty` is false: flags gate hidden map nodes and achievements, which the tick re-checks on
 * its own; nothing in `Derived` reads them.
 */
export function setFlag(ctx: ActionContext, key: string): ActionResult {
  const { state } = ctx
  if (typeof key !== 'string' || key.trim() === '') return fail('Unknown flag')
  if (state.flags[key] === true) return fail('Already discovered')
  state.flags[key] = true
  return ok([{ type: 'easterEgg', id: key }], false)
}

/**
 * Upscale a post: pay 30% of what the job originally cost and the post's like target grows by
 * 40%, delivered as a second wave over a fresh window at the post's own credits-per-like. The
 * like curve `likesAt` is remapped so it continues from the current count (no jump, no refund)
 * and reaches the new target one `POST_WINDOW_MS` from now; `settlePosts` then pays the extra
 * likes as they land (its `max(post.likes, likesAt)` guarantees no negative delta even if the
 * floored curve sits a like below the paid count). The post stays `granted`, so followers and
 * stats are not counted twice. Flops are refused, a second wave of nothing is still nothing.
 */
export function upscalePost(ctx: ActionContext, postId: string): ActionResult {
  const { state, now } = ctx
  const post = state.posts.find((p) => p.id === postId)
  if (!post) return fail('No such post')
  if (post.upscaled) return fail('Already upscaled')
  if (post.flop) return fail('Nobody upscales a flop · pick a post that landed')
  const extra = Math.round(post.targetLikes * UPSCALE_LIKES_FRACTION)
  if (extra < 1) return fail('Not enough likes to upscale')
  const cost = upscaleCost(post, ctx)
  if (cost === null) return fail('This model is no longer available')
  if (state.credits < cost) return fail('Not enough credits')

  state.credits -= cost
  noteSpend(state)
  const target = post.targetLikes + extra
  // Invert likesAt: find the curve position p where target × (1 − (1 − p)³) equals the current likes.
  const done = Math.min(post.likes, target) / target
  const p = 1 - Math.cbrt(1 - done)
  const windowMs = POST_WINDOW_MS / Math.max(1e-6, 1 - p)
  post.targetLikes = target
  post.windowMs = windowMs
  post.createdAt = now - p * windowMs
  post.upscaled = true
  return ok([], false)
}
