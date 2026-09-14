/**
 * Guidance: the structured reason something is locked.
 *
 * Every "you can't do that yet" in the game used to be a hand-written sentence. This module turns
 * each one into a `LockCause` (what is missing, how much, and which id would fix it) and formats it
 * back with `describeCause`. `lockReason`, `canBuy().reason`, `canQuantize().reason` and the map
 * node checks are thin formatters over it, so the strings are unchanged and the UI gets the facts
 * it needs to build a "take me there" button instead of parsing prose.
 *
 * `describeCause` is the engine wording. Anything that reads differently in the UI (an article, a
 * cost, a lane name) is the caller's job: see `src/components/guidance/lockGuide.ts`.
 *
 * Pure TypeScript, catalog in, no DOM. `hardware.ts` and `quantize.ts` import back into this
 * module; every call happens inside a function body, never at module scope, so the cycle resolves.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { bulkCost, unitCost } from '@/game/economy'
import { formatNum } from '@/game/format'
import { cheapestPurchasable, ownedHardware, runsOn, withArticle } from '@/game/hardware'
import { hardwareLevelLock, modelLevelLock } from '@/game/level'
import { currencyBalance, isNodeUnlocked, mapNodeCost } from '@/game/map'
import { backendAllows, QUANT_NODE_IDS, quantFee, requiredVram, setupFee } from '@/game/quantize'
import { FAMILY_LABELS, statValue } from '@/game/state'
import { describeUnlock, isUnlocked, ownedInFamily } from '@/game/unlock'
import type {
  Derived,
  GameState,
  HardwareDef,
  HardwareFamily,
  MapNodeDef,
  ModelDef,
  Precision,
  StatKey,
  UnlockCond,
} from '@/game/types'

/** A single unmet requirement. `need`/`have` are in the requirement's own unit. */
export type LockCause =
  | { kind: 'credits'; need: number; have: number }
  | { kind: 'currency'; currency: 'rp' | 'cp'; need: number; have: number }
  | { kind: 'ownHardware'; id: string; count: number; owned: number }
  | { kind: 'ownFamily'; family: HardwareFamily; count: number; owned: number }
  | { kind: 'ownModel'; id: string }
  | { kind: 'upgrade'; id: string }
  | { kind: 'mapNode'; id: string }
  | { kind: 'parent'; id: string }
  | { kind: 'stat'; key: StatKey; need: number; have: number }
  | { kind: 'cps'; need: number; have: number }
  | { kind: 'level'; need: number; have: number }
  | {
      kind: 'vram'
      modelId: string
      precision: Precision
      need: number
      have: number
      fixes: LockFix[]
    }
  | {
      kind: 'backend'
      modelId: string
      reason: 'cpu' | 'mps' | 'zluda' | 'none'
      buy: BuyFix | null
      zludaNodeId: string | null
    }
  | { kind: 'apiNodes'; nodeId: string }
  | { kind: 'setup'; modelId: string; fee: number }
  | { kind: 'precision'; modelId: string; precision: 'fp8' | 'q4'; fee: number; gateNodeId: string | null }
  | { kind: 'family'; family: HardwareFamily; upgradeId: string | null }
  | { kind: 'max'; max: number }
  | { kind: 'flag' }

export interface BuyFix {
  kind: 'buy'
  hardwareId: string
  cost: number
}

export interface QuantizeFix {
  kind: 'quantize'
  precision: 'fp8' | 'q4'
  fee: number
}

/** The two ways out of a VRAM wall, cheapest-first as `lockReason` prints them. */
export type LockFix = QuantizeFix | BuyFix

const CURRENCY_LABEL: Record<'rp' | 'cp', string> = { rp: 'RP', cp: 'CP' }
const QUANT_TIERS: ReadonlyArray<'fp8' | 'q4'> = ['fp8', 'q4']

const GB = (gb: number): string => (Number.isFinite(gb) ? `${Math.round(gb * 10) / 10} GB` : '∞ GB')

const KIND_LABELS: Record<ModelDef['kind'], string> = {
  image: 'image models',
  video: 'video models',
  '3d': '3D models',
  audio: 'audio models',
}

// ---------------------------------------------------------------------------
// Catalog lookups that must never hard-code an id
// ---------------------------------------------------------------------------

/** The map node carrying an effect kind, e.g. the ZLUDA or API Nodes node. `''` when absent. */
function nodeWithEffect(catalog: Catalog, kind: 'zluda' | 'apiNodes'): string {
  for (const node of catalog.mapNodes) {
    for (const effect of node.effects) if (effect.kind === kind) return node.id
  }
  return ''
}

/** The upgrade that switches a hardware family on (ROCm Setup for Radeons), or null. */
function upgradeUnlocking(catalog: Catalog, family: HardwareFamily): string | null {
  for (const def of catalog.upgrades) {
    for (const effect of def.effects) if (effect.kind === 'unlockFamily' && effect.family === family) return def.id
  }
  return null
}

/** Cheapest unit in an unlocked family that would run the model, priced at what you would pay now. */
function buyFix(
  model: ModelDef,
  precision: Precision,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): BuyFix | null {
  const def = cheapestPurchasable(model, precision, derived, catalog)
  if (!def) return null
  return { kind: 'buy', hardwareId: def.id, cost: unitCost(def, state.hardware[def.id] ?? 0) }
}

/** The quantization tier gate node, when the catalog ships one and the player has not unlocked it. */
function missingQuantGate(state: GameState, precision: 'fp8' | 'q4', catalog: Catalog): string | null {
  const gate = buildIndex(catalog).mapNodeById[QUANT_NODE_IDS[precision]]
  if (!gate || isNodeUnlocked(state, gate.id)) return null
  return gate.id
}

// ---------------------------------------------------------------------------
// Unlock conditions
// ---------------------------------------------------------------------------

/** One leaf condition as a cause. Leaves are only built once the condition is known to be unmet. */
function leafCause(cond: UnlockCond, state: GameState, derived: Derived, catalog: Catalog): LockCause | null {
  switch (cond.type) {
    case 'always':
      return null
    case 'stat':
      return { kind: 'stat', key: cond.key, need: cond.value, have: statValue(state, cond.key, derived) }
    case 'cps':
      return { kind: 'cps', need: cond.value, have: derived.cps }
    case 'ownHardware':
      return { kind: 'ownHardware', id: cond.id, count: cond.count ?? 1, owned: state.hardware[cond.id] ?? 0 }
    case 'ownFamily':
      return {
        kind: 'ownFamily',
        family: cond.family,
        count: cond.count ?? 1,
        owned: ownedInFamily(state, cond.family, catalog),
      }
    case 'ownModel':
      return { kind: 'ownModel', id: cond.id }
    case 'precision': {
      if (cond.precision === 'native') return { kind: 'ownModel', id: cond.modelId }
      const model = buildIndex(catalog).modelById[cond.modelId]
      return {
        kind: 'precision',
        modelId: cond.modelId,
        precision: cond.precision,
        fee: model ? quantFee(model, cond.precision, catalog) : 0,
        gateNodeId: missingQuantGate(state, cond.precision, catalog),
      }
    }
    case 'mapNode':
      return { kind: 'mapNode', id: cond.id }
    case 'upgrade':
      return { kind: 'upgrade', id: cond.id }
    case 'flag':
      return { kind: 'flag' }
    default:
      return null
  }
}

/**
 * Every unmet leaf of a condition. `all` concatenates its unmet children; `any` returns the branch
 * with the fewest unmet leaves (the cheapest way in). A met condition returns nothing.
 */
export function explainUnlock(
  cond: UnlockCond | undefined,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): LockCause[] {
  if (!cond) return []
  if (isUnlocked(cond, state, derived, catalog)) return []
  if (cond.type === 'all') {
    const out: LockCause[] = []
    for (const child of cond.conds) out.push(...explainUnlock(child, state, derived, catalog))
    return out
  }
  if (cond.type === 'any') {
    let best: LockCause[] | null = null
    for (const child of cond.conds) {
      const causes = explainUnlock(child, state, derived, catalog)
      if (causes.length === 0) return []
      if (!best || causes.length < best.length) best = causes
    }
    return best ?? []
  }
  const leaf = leafCause(cond, state, derived, catalog)
  return leaf ? [leaf] : []
}

/** Unmet leaves, with a fallback so an unmet condition is never silent (an empty `any`). */
function unlockCauses(
  cond: UnlockCond | undefined,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): LockCause[] {
  if (isUnlocked(cond, state, derived, catalog)) return []
  const causes = explainUnlock(cond, state, derived, catalog)
  return causes.length > 0 ? causes : [{ kind: 'flag' }]
}

// ---------------------------------------------------------------------------
// Store, models, the Graph
// ---------------------------------------------------------------------------

/**
 * Why `n` units of `def` cannot be bought, in `canBuy`'s order: family, unlock condition, player
 * level, cap, credits. Every blocker is listed, so a guide can show the whole path; `canBuy`
 * formats the first. The level is a plain `minLevel` field, not an unlock condition, so a
 * level-locked unit stays on the shelf with its reason instead of vanishing.
 */
export function explainBuy(
  def: HardwareDef,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  n = 1,
): LockCause[] {
  const causes: LockCause[] = []
  if (!derived.unlockedFamilies.includes(def.family)) {
    causes.push({ kind: 'family', family: def.family, upgradeId: upgradeUnlocking(catalog, def.family) })
  }
  causes.push(...unlockCauses(def.unlock, state, derived, catalog))
  const level = hardwareLevelLock(def, state)
  if (level) causes.push({ kind: 'level', need: level.need, have: level.have })
  const owned = state.hardware[def.id] ?? 0
  const count = Number.isInteger(n) && n > 0 ? n : 1
  if (def.max !== undefined && owned + count > def.max) causes.push({ kind: 'max', max: def.max })
  const cost = bulkCost(def, owned, count)
  if (state.credits < cost) causes.push({ kind: 'credits', need: cost, have: state.credits })
  return causes
}

/**
 * Why nothing owned can run `model` at `precision`, in `lockReason`'s order: player level, API
 * Nodes, the backend (CPU / Apple / ZLUDA), then VRAM. Null when it runs.
 */
export function explainRun(
  model: ModelDef,
  precision: Precision,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): LockCause | null {
  const level = modelLevelLock(model, state)
  if (level) return { kind: 'level', need: level.need, have: level.have }
  if (model.api) return derived.apiNodes ? null : { kind: 'apiNodes', nodeId: nodeWithEffect(catalog, 'apiNodes') }

  const owned = ownedHardware(state, catalog).map((u) => u.def)
  if (owned.some((hw) => runsOn(model, precision, hw, derived, catalog))) return null

  const compatible = owned.filter((hw) => backendAllows(model, hw, derived.zluda))
  if (compatible.length === 0) {
    const gpus = owned.filter((hw) => !hw.cpuOnly)
    const buy = buyFix(model, precision, state, derived, catalog)
    const backend = (reason: 'cpu' | 'mps' | 'zluda' | 'none', zludaNodeId: string | null = null): LockCause => ({
      kind: 'backend',
      modelId: model.id,
      reason,
      buy,
      zludaNodeId,
    })
    if (gpus.length === 0) return backend('cpu')
    if (model.needsZluda && !derived.zluda && gpus.some((hw) => hw.rocm)) {
      return backend('zluda', nodeWithEffect(catalog, 'zluda') || null)
    }
    if (gpus.every((hw) => hw.mps)) return backend('mps')
    return backend('none')
  }

  const need = requiredVram(model, precision, catalog)
  const have = Math.max(...compatible.map((hw) => hw.vram))
  const fixes: LockFix[] = []
  if (precision === 'native' && model.quantizable !== false) {
    for (const tier of QUANT_TIERS) {
      if (!catalog.precisions[tier]) continue
      if (compatible.some((hw) => hw.vram >= requiredVram(model, tier, catalog))) {
        fixes.push({ kind: 'quantize', precision: tier, fee: quantFee(model, tier, catalog) })
        break
      }
    }
  }
  const buy = buyFix(model, precision, state, derived, catalog)
  if (buy) fixes.push(buy)
  return { kind: 'vram', modelId: model.id, precision, need, have, fixes }
}

/**
 * Why `model` cannot be quantized to `precision` right now: not installed, the tier's Graph node,
 * then the fee. Null when the quantization would go through (or the tier makes no sense, which
 * `canQuantize` reports in its own words).
 */
export function explainQuantize(
  model: ModelDef,
  precision: Precision,
  state: GameState,
  catalog: Catalog,
): LockCause | null {
  if (precision === 'native' || model.api || model.quantizable === false) return null
  const entry = state.models[model.id]
  if (!entry) return { kind: 'setup', modelId: model.id, fee: 0 }
  if (entry.precisions.includes(precision)) return null
  const gate = missingQuantGate(state, precision, catalog)
  const fee = quantFee(model, precision, catalog)
  if (gate) return { kind: 'precision', modelId: model.id, precision, fee, gateNodeId: gate }
  if (state.credits < fee) return { kind: 'credits', need: fee, have: state.credits }
  return null
}

/** The "install this model" step, with the --lowvram tax priced against your best card. */
export function setupCause(model: ModelDef, derived: Derived, catalog: Catalog): LockCause {
  return { kind: 'setup', modelId: model.id, fee: setupFee(model, derived, catalog) }
}

/**
 * Why `setupModel` would be refused: level, the model's own unlock condition, API Nodes, the fee.
 * Null when it would go through or the model is already installed.
 */
export function explainSetup(
  model: ModelDef,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): LockCause | null {
  if (state.models[model.id]?.setup) return null
  const level = modelLevelLock(model, state)
  if (level) return { kind: 'level', need: level.need, have: level.have }
  const unlock = unlockCauses(model.unlock, state, derived, catalog)[0]
  if (unlock) return unlock
  if (model.api && !derived.apiNodes) return { kind: 'apiNodes', nodeId: nodeWithEffect(catalog, 'apiNodes') }
  const fee = setupFee(model, derived, catalog)
  if (state.credits < fee) return { kind: 'credits', need: fee, have: state.credits }
  return null
}

/**
 * Why a Graph node cannot be unlocked: locked parents first (walk the noodles back), then its own
 * unlock condition, then the price in its currency. Empty when it is ready to buy or already owned.
 */
export function explainMapNode(
  def: MapNodeDef,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): LockCause[] {
  if (isNodeUnlocked(state, def.id)) return []
  const causes: LockCause[] = []
  for (const parent of def.parents) if (!isNodeUnlocked(state, parent)) causes.push({ kind: 'parent', id: parent })
  causes.push(...unlockCauses(def.unlock, state, derived, catalog))
  const cost = mapNodeCost(def)
  const have = currencyBalance(state, def.currency, catalog)
  if (have < cost) {
    causes.push(
      def.currency === 'credits'
        ? { kind: 'credits', need: cost, have }
        : { kind: 'currency', currency: def.currency, need: cost, have },
    )
  }
  return causes
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/**
 * The engine sentence for a cause. Conditions delegate to `describeUnlock`, so a cause and the
 * tooltip that describes the same requirement can never drift apart.
 *
 * Two fragments read as tails rather than sentences, because that is how the store prints them:
 * `family` follows `Locked · ` and `max` is the whole line.
 */
export function describeCause(cause: LockCause, catalog: Catalog): string {
  const index = buildIndex(catalog)
  switch (cause.kind) {
    case 'credits':
      return `Need ${formatNum(cause.need)} credits · have ${formatNum(cause.have)}`
    case 'currency':
      return `Need ${formatNum(cause.need)} ${CURRENCY_LABEL[cause.currency]} · have ${formatNum(cause.have)}`
    case 'ownHardware':
      return describeUnlock({ type: 'ownHardware', id: cause.id, count: cause.count }, catalog)
    case 'ownFamily':
      return describeUnlock({ type: 'ownFamily', family: cause.family, count: cause.count }, catalog)
    case 'ownModel':
      return describeUnlock({ type: 'ownModel', id: cause.id }, catalog)
    case 'upgrade':
      return describeUnlock({ type: 'upgrade', id: cause.id }, catalog)
    case 'mapNode':
      return describeUnlock({ type: 'mapNode', id: cause.id }, catalog)
    case 'parent':
      return `Unlock ${index.mapNodeById[cause.id]?.title ?? cause.id} on the Graph`
    case 'stat':
      return describeUnlock({ type: 'stat', key: cause.key, value: cause.need }, catalog)
    case 'cps':
      return describeUnlock({ type: 'cps', value: cause.need }, catalog)
    case 'level':
      return `Needs level ${cause.need} · you are level ${cause.have}`
    case 'vram': {
      const parts = [`Needs ${GB(cause.need)}`, `your best card has ${GB(cause.have)}`]
      const fixes = cause.fixes.map((fix) =>
        fix.kind === 'quantize'
          ? `quantize ${catalog.precisions[fix.precision]?.label ?? fix.precision} for ${formatNum(fix.fee)}`
          : `buy ${withArticle(index.hardwareById[fix.hardwareId]?.name ?? fix.hardwareId)}`,
      )
      if (fixes.length > 0) parts.push(fixes.join(' or '))
      return parts.join(' · ')
    }
    case 'backend': {
      const model = index.modelById[cause.modelId]
      const name = model?.name ?? cause.modelId
      switch (cause.reason) {
        case 'cpu':
          return `Needs a GPU · ${name} won't run on a CPU box`
        case 'zluda':
          return 'Needs ZLUDA to run on AMD cards · unlock it on the Graph'
        case 'mps':
          return model && model.kind !== 'image'
            ? `Apple silicon runs images only · ${KIND_LABELS[model.kind]} need a discrete GPU`
            : `${name} is not supported on Apple silicon · needs a discrete GPU`
        case 'none':
          return `No owned hardware can run ${name}`
      }
    }
    case 'apiNodes':
      return 'Needs API Nodes · unlock it on the Graph'
    case 'setup':
      return `Set up ${index.modelById[cause.modelId]?.name ?? cause.modelId}`
    case 'precision':
      return cause.gateNodeId
        ? `Unlock ${index.mapNodeById[cause.gateNodeId]?.title ?? cause.gateNodeId} on the Graph`
        : describeUnlock({ type: 'precision', modelId: cause.modelId, precision: cause.precision }, catalog)
    case 'family':
      return cause.family === 'amd-consumer'
        ? 'install the ROCm Setup upgrade to buy AMD cards'
        : `${FAMILY_LABELS[cause.family]} hardware is not available yet`
    case 'max':
      return `Maxed out · ${cause.max} owned`
    case 'flag':
      return describeUnlock({ type: 'flag', key: '' }, catalog)
    default: {
      const never: never = cause
      return never
    }
  }
}

/**
 * Whole seconds until a cause clears on its own at the current rate. Only money accrues while you
 * watch, so everything else is `Infinity`: the player has to go and do something, which is exactly
 * what the guidance popover then asks them to do.
 */
export function causeEta(cause: LockCause, derived: Derived): number {
  if (cause.kind !== 'credits') return Infinity
  const short = cause.need - cause.have
  if (short <= 0) return 0
  return derived.cps > 0 ? Math.ceil(short / derived.cps) : Infinity
}
