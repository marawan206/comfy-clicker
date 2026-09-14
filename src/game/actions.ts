/**
 * Player actions. Every action validates, mutates `ctx.state` in place and returns
 * `{ events, dirty }`. `dirty` tells the caller to recompute `Derived`. Validation failures
 * return `{ events: [], dirty: false, error }` and leave the state untouched.
 *
 * Actions take an `ActionContext` first so the store can bind it once per frame:
 * `click({ state, derived, catalog, now, rng })`, `buyHardware(ctx, 'rtx-4090', 10)`, …
 */
import type { Catalog } from '@/data'
import { GIFTS } from '@/data/gifts'
import { checkAchievements } from '@/game/achievements'
import { buildIndex } from '@/game/catalog'
import { evaluateClick } from '@/game/clickGuard'
import { LUCKY_CLICK_CHANCE, LUCKY_CLICK_MULT, POST_WINDOW_MS } from '@/game/constants'
import { claimContract as payContract, progressContracts } from '@/game/contracts'
import { canClaim, claimDaily as payDaily } from '@/game/daily'
import { maxAffordable } from '@/game/economy'
import { addCredits, pushEvents } from '@/game/engine'
import { RESOLVABLE_KINDS, resolveEvent as resolveActiveEvent } from '@/game/events'
import { applyFlip, applySpin, canBet } from '@/game/gamble'
import { applyPurchase, canBuy } from '@/game/hardware'
import { modelLevelLock } from '@/game/level'
import { canAffordNode, currencyBalance, isNodeUnlocked, mapNodeAvailable, unlockNode } from '@/game/map'
import { canRebrand, rebrand as applyRebrand } from '@/game/prestige'
import { applyQuantize, canQuantize, quantFee, setupFee } from '@/game/quantize'
import { chance } from '@/game/rng'
import { CREATE_JOB_FLAGS, advanceQueue, applyClickToJobs, createJob, jobCost, type JobInput } from '@/game/studio'
import type {
  Currency,
  Derived,
  GameEvent,
  GameSettings,
  GameState,
  GiftKind,
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
/** Raised by the first lucky click. Drives the visible achievement "Lucky Seed". */
export const LUCKY_SEED_FLAG = 'luckySeed'
/** "Has been taught". Set by `completeTutorial`, never by `setFlag`: the tour is not a discovery. */
export const TUTORIAL_FLAG = 'tutorial-done'
/** Suffix on a gift's flag when the offer was turned down, so it is never offered twice. */
export const GIFT_DECLINED_SUFFIX = ':declined'
/**
 * Flags only the UI can discover (a ticker line clicked seven times, the Konami code, seed 42
 * typed into the seed box, the rickroll, the wordmark clicked 25 times, every panel opened in one
 * session, a 3 a.m. click, Ctrl+Enter in the prompt box). The UI raises them through `setFlag`,
 * which announces the `easterEgg` event; src/data/mapNodes.ts (hidden lane) and achievements.ts
 * key off them. Other flag keys are still accepted; this list documents the ones nothing in
 * src/game sets.
 */
export const UI_FLAGS = [
  'konami',
  'ticker-seven',
  'seed42',
  'rickroll',
  'title-25',
  'grand-tour',
  'night-shift',
  'ctrl-enter',
] as const
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

/**
 * Generate: earn `clickValue`, shave time off the running job, count the click.
 *
 * One click in `1 / LUCKY_CLICK_CHANCE` pays `LUCKY_CLICK_MULT` times over and raises
 * `LUCKY_SEED_FLAG` (the "Lucky Seed" achievement keys off it). The roll happens on accepted
 * clicks only, so a refused one cannot burn the lucky seed.
 *
 * **Deliberate deviation from the contract.** Every other action answers a validation failure with
 * `{ events: [], dirty: false, error }`. A click refused by the auto-clicker guard instead returns
 * a single `clickBlocked` event and no error: the button has to be able to say why it went quiet,
 * and a toast is the only place to say it. What it must never do is move anything. No credits, no
 * `totalClicks`, no `recordClick`, no `applyClickToJobs` and above all no `click` event, so
 * contracts, the combo meter and the click-frenzy egg all see a click that never happened. The
 * one thing a refusal writes is `flags.clickGuard`, raised by the guard itself behind the hidden
 * achievement "Rate Limited". The only reason left is `rate`: the cap on accepted clicks per
 * second is the whole guard now that the cadence detector is gone.
 */
export function click(ctx: ActionContext): ActionResult {
  const { state, derived, catalog, now, rng } = ctx
  const verdict = evaluateClick(state, now)
  if (!verdict.ok) {
    return { events: [{ type: 'clickBlocked', reason: verdict.reason, until: verdict.until }], dirty: false }
  }

  const lucky = chance(rng, LUCKY_CLICK_CHANCE)
  const value = Math.max(0, derived.clickValue) * (lucky ? LUCKY_CLICK_MULT : 1)
  addCredits(state, value)
  state.totalClicks += 1
  if (lucky) {
    state.stats.luckyClicks += 1
    state.flags[LUCKY_SEED_FLAG] = true
  }
  recordClick(state, now)
  applyClickToJobs(state, now)
  const events: GameEvent[] = [lucky ? { type: 'click', value, lucky: true } : { type: 'click', value }]
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
 *
 * The player level is the first gate after "already set up", and it is the only place the level is
 * checked: `createJob` deliberately does not, so a model that is already installed stays usable
 * even if the `minLevel` table moves under it. The wording matches `lockReason` in hardware.ts.
 */
export function setupModel(ctx: ActionContext, modelId: string): ActionResult {
  const { state, derived, catalog } = ctx
  const model = buildIndex(catalog).modelById[modelId]
  if (!model) return fail(`Unknown model: ${modelId}`)
  const existing = state.models[modelId]
  if (existing?.setup) return fail(`${model.name} is already set up`)
  const levelLock = modelLevelLock(model, state)
  if (levelLock) return fail(`Needs level ${levelLock.need} · you are level ${levelLock.have}`)
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
  const had = CREATE_JOB_FLAGS.filter((flag) => state.flags[flag] === true)
  const result = createJob(state, derived, catalog, input, now, rng)
  if (!result.ok) return fail(result.reason)
  noteSpend(state)
  const events: GameEvent[] = []
  // createJob raises a hidden flag for every egg the prompt (or the rig) tripped: spaghetti, bad
  // hands, the masterpiece incantation, SD 1.5 on a region. Announce each one the first time only.
  for (const flag of CREATE_JOB_FLAGS) {
    if (state.flags[flag] === true && !had.includes(flag)) events.push({ type: 'easterEgg', id: flag })
  }
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

/**
 * The Latent Lounge, wheel table: bet credits (or take the daily house spin with `'free'`).
 *
 * `canBet` owns every rule and every rejection string (the level gate, the floor, the balance, the
 * daily free spin); `applySpin` owns the roll, the pity meter, the hot streak and the pot.
 * `dirty` is false: a bet moves the spendable balance and some counters, and nothing in `Derived`
 * reads any of them.
 *
 * Two things this must never become. It is not reachable from the click path or a hotkey, so a
 * wager is always a deliberate press. And neither it nor `flip` calls `noteSpend`: the wheel
 * keeps a quarter, so it cannot land the bank on zero on its own, and a bank that lands on zero
 * because a coin came up Comfy is not "Out Of Credits, Not Ideas".
 */
export function spin(ctx: ActionContext, wager: number | 'free'): ActionResult {
  const { state, derived, catalog, now, rng } = ctx
  const check = canBet(state, derived, now, wager)
  if (!check.ok) return fail(check.reason)
  const events = applySpin(state, derived, catalog, now, rng, wager)
  if (events.length === 0) return fail('The sampler has no seeds to give')
  return ok(events, false)
}

/**
 * The Latent Lounge, coin table: one flip, your side pays double. Same validation and the same
 * credits-only rule as `spin`; there is no free flip, so `'free'` is not accepted here.
 */
export function flip(ctx: ActionContext, wager: number): ActionResult {
  const { state, derived, now, rng } = ctx
  const check = canBet(state, derived, now, wager)
  if (!check.ok) return fail(check.reason)
  const events = applyFlip(state, derived, now, rng, wager)
  if (events.length === 0) return fail('The coin would not come down')
  return ok(events, false)
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
 *
 * Achievements are checked right here rather than left to the tick, so the egg, the achievement it
 * unlocks and the credits that achievement pays all land on the same click instead of up to a
 * second later. A grant moves the global multiplier (and may have paid credits), so `dirty` is
 * true exactly when something was granted.
 *
 * This is for discovery flags only. `tutorial-done` and the gift flags are bookkeeping and have
 * their own actions; sending them through here would announce an easter egg that is not one.
 */
export function setFlag(ctx: ActionContext, key: string): ActionResult {
  const { state, derived, catalog } = ctx
  if (typeof key !== 'string' || key.trim() === '') return fail('Unknown flag')
  if (state.flags[key] === true) return fail('Already discovered')
  state.flags[key] = true
  const events: GameEvent[] = [{ type: 'easterEgg', id: key }]
  const granted = checkAchievements(state, derived, catalog)
  pushEvents(events, granted)
  return ok(events, granted.length > 0)
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
  // A ratio is checked before the flop it also is: the specific reason is the useful one.
  if (post.ratioed) return fail('Nobody upscales a ratio · tag the kind you actually posted')
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

/**
 * Hand over a welcome gift (`src/data/gifts.ts`). Everything in it is free: the card lands in the
 * rack without `applyPurchase` touching the bank, the PSU that keeps it off the breaker is pushed
 * straight onto `upgrades`, and credits go through `addCredits` so they count as earned.
 *
 * The gift's flag is what makes the offer happen exactly once, so a second call is a refusal.
 * Every id is resolved before anything is written: a gift naming hardware the catalog dropped must
 * leave the state exactly as it found it.
 *
 * It emits a `purchase` as well as its `reward` so contracts see the hardware arrive, the same way
 * a bought unit would.
 */
export function grantGift(ctx: ActionContext, kind: GiftKind): ActionResult {
  const { state, catalog } = ctx
  const def = GIFTS[kind]
  if (!def) return fail(`Unknown gift: ${String(kind)}`)
  if (state.flags[def.flag] === true) return fail('That gift has already been claimed')

  const { hardwareById, upgradeById } = buildIndex(catalog)
  const wanted = def.hardware
  const hardware = wanted ? hardwareById[wanted.id] : undefined
  if (wanted && !hardware) return fail(`Unknown hardware: ${wanted.id}`)
  const upgrades = def.upgrades ?? []
  for (const id of upgrades) if (!upgradeById[id]) return fail(`Unknown upgrade: ${id}`)

  const events: GameEvent[] = []
  if (wanted && hardware) {
    const owned = state.hardware[hardware.id] ?? 0
    const room = hardware.max === undefined ? Infinity : Math.max(0, hardware.max - owned)
    const count = Math.min(room, Math.max(0, Math.floor(wanted.count)))
    if (count > 0) {
      state.hardware[hardware.id] = owned + count
      events.push({ type: 'purchase', hardwareId: hardware.id, count })
    }
  }
  for (const id of upgrades) if (!hasUpgrade(state, id)) state.upgrades.push(id)
  const credits = Math.max(0, Math.floor(def.credits ?? 0))
  if (credits > 0) addCredits(state, credits)

  state.flags[def.flag] = true
  events.push({ type: 'reward', id: kind, credits })
  pushEvents(events, progressContracts(state, events, catalog))
  return ok(events, true)
}

/**
 * Turn a welcome gift down. Sets `gift:<kind>:declined` so the modal never asks again, and that is
 * all: no events, nothing to recompute. Idempotent, because Esc, the backdrop and the ghost button
 * all count as the same answer.
 */
export function declineGift(ctx: ActionContext, kind: GiftKind): ActionResult {
  const { state } = ctx
  const def = GIFTS[kind]
  if (!def) return fail(`Unknown gift: ${String(kind)}`)
  state.flags[`${def.flag}${GIFT_DECLINED_SUFFIX}`] = true
  return ok([], false)
}

/**
 * Mark the tutorial as taught. Idempotent, silent and not dirty: it emits nothing because finishing
 * (or skipping) a tour is not a discovery, and a veteran save that never saw it gets the flag set
 * quietly on boot, which must not fire a toast.
 *
 * Deliberately not `setFlag`: that one is for discovery flags and announces an `easterEgg`.
 */
export function completeTutorial(ctx: ActionContext): ActionResult {
  ctx.state.flags[TUTORIAL_FLAG] = true
  return ok([], false)
}
