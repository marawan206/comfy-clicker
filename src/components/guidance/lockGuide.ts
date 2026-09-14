/**
 * Turning a `LockCause` into something the player can click.
 *
 * The engine says what is missing (`src/game/guidance.ts`); this says where it lives and which
 * button gets them there. Pure: no React, no DOM, no store mutation, so the copy is testable.
 *
 * One rule: a step that cannot be acted on (maxed out, a secret, a stat that only time fixes)
 * carries no action. A dead button is worse than no button.
 */
import { HARDWARE_FAMILIES } from '@/data/hardware'
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { unitCost } from '@/game/economy'
import { formatCps, formatDuration, formatInt, formatNum } from '@/game/format'
import { causeEta, describeCause, type LockCause } from '@/game/guidance'
import { withArticle } from '@/game/hardware'
import { levelProgress } from '@/game/level'
import { mapNodeCost } from '@/game/map'
import { setupFee } from '@/game/quantize'
import { FAMILY_LABELS } from '@/game/state'
import type { Currency, Derived, GameState, HardwareFamily, MapBranch, StatKey } from '@/game/types'
import type { CenterTab } from '@/components/studio/studioHooks'
import type { ModalId } from '@/components/overlays/Overlays'
import type { StoreTab } from '@/components/store/storeHooks'

/** Where a step's button goes. `act` is for callers that want to run something in place. */
export type GuideAction =
  | { type: 'store'; tab: StoreTab; family?: HardwareFamily; focusId?: string }
  | { type: 'map'; nodeId: string }
  | { type: 'center'; tab: CenterTab }
  | { type: 'modal'; id: ModalId }
  | { type: 'hero' }
  | { type: 'act'; label: string; run: () => void }

export interface GuideStep {
  /** The instruction, e.g. `Quantize FP8` or `Own an RTX 3090`. Never carries the price. */
  label: string
  /** Where it lives and what it costs, e.g. `1,200 credits in Hardware › NVIDIA`. */
  detail?: string
  /** Price in `currency`, rendered next to the label. */
  cost?: number
  currency?: Currency
  /** Seconds until the player can afford it at the current rate; omitted when waiting is no help. */
  etaSec?: number
  action?: GuideAction
  /** The other way out, shown as a link row under the step (quantize now, or buy the bigger card). */
  alt?: GuideStep
}

export interface GuideSpec {
  /** What was clicked: `FLUX.1 dev`, `RTX 3090`, `Comfy Manager`. */
  subject: string
  /** One line of why, ending in a period. */
  why: string
  /** At most three. The first with an action gets the primary button. */
  steps: GuideStep[]
}

/** The slice of `GameStore` the copy needs; the real store satisfies it. */
export interface GuideStore {
  catalog: Catalog
  state: GameState
  derived: Derived
}

const MAX_STEPS = 3

/** Lane words for a node's address on the Graph: `1,500 credits · techniques lane`. */
const BRANCH_WORDS: Record<MapBranch, string> = {
  core: 'core',
  hardware: 'hardware',
  models: 'models',
  techniques: 'techniques',
  infra: 'infra',
  social: 'social',
  regions: 'regions',
  api: 'API',
  prestige: 'prestige',
  hidden: 'hidden',
}

/** Stats you fix by clicking; everything else by posting. */
const CLICK_STATS: ReadonlySet<StatKey> = new Set<StatKey>(['clicks', 'lifetimeCredits', 'seasonCredits'])

const CURRENCY_WORD: Record<Currency, string> = { credits: 'credits', rp: 'RP', cp: 'CP' }

function familyLabel(family: HardwareFamily): string {
  return HARDWARE_FAMILIES.find((f) => f.id === family)?.label ?? FAMILY_LABELS[family]
}

/** `1,200 credits in Hardware › NVIDIA`. */
function storeAddress(cost: number, tab: 'Hardware' | 'Upgrades' | 'Models', section?: string): string {
  const where = section ? `${tab} › ${section}` : tab
  return cost > 0 ? `${formatNum(cost)} credits in ${where}` : `In ${where}`
}

/** `1,500 credits · techniques lane`, in whichever currency the node is priced in. */
function nodeAddress(nodeId: string, store: GuideStore): string {
  const def = buildIndex(store.catalog).mapNodeById[nodeId]
  if (!def) return 'On the Graph'
  const cost = mapNodeCost(def)
  const money = cost > 0 ? `${formatNum(cost)} ${CURRENCY_WORD[def.currency]} · ` : ''
  return `${money}${BRANCH_WORDS[def.branch]} lane`
}

/** `0:48 at your rate, or click Generate.` The player can always out-click the wait. */
function creditsDetail(need: number, have: number, derived: Derived): string {
  const eta = causeEta({ kind: 'credits', need, have }, derived)
  if (!Number.isFinite(eta)) return 'No income yet. Click Generate.'
  return `${formatDuration(eta)} at your rate, or click Generate.`
}

/** The step a missing hardware unit becomes: where it is, what it costs, and a button to the row. */
function hardwareStep(id: string, count: number, owned: number, store: GuideStore): GuideStep {
  const def = buildIndex(store.catalog).hardwareById[id]
  if (!def) return { label: `Own ${id}` }
  const cost = unitCost(def, store.state.hardware[id] ?? 0)
  const step: GuideStep = {
    label: count > 1 ? `Own ${count}× ${def.name} · ${owned} so far` : `Own ${withArticle(def.name)}`,
    detail: storeAddress(cost, 'Hardware', familyLabel(def.family)),
    cost,
    currency: 'credits',
    action: { type: 'store', tab: 'hardware', family: def.family, focusId: def.id },
  }
  const eta = causeEta({ kind: 'credits', need: cost, have: store.state.credits }, store.derived)
  if (Number.isFinite(eta) && eta > 0) step.etaSec = eta
  return step
}

/** The step a Graph node becomes, whether it is the thing itself or a parent in the way. */
function nodeStep(nodeId: string, store: GuideStore): GuideStep {
  const def = buildIndex(store.catalog).mapNodeById[nodeId]
  const title = def?.title ?? nodeId
  const step: GuideStep = {
    label: `Unlock ${title} on the Graph`,
    detail: nodeAddress(nodeId, store),
    action: { type: 'map', nodeId },
  }
  if (def) {
    step.cost = mapNodeCost(def)
    step.currency = def.currency
  }
  return step
}

/** One cause, one step. `null` never happens; an unactionable cause returns a step with no action. */
export function stepFor(cause: LockCause, store: GuideStore): GuideStep {
  const index = buildIndex(store.catalog)
  switch (cause.kind) {
    case 'credits': {
      const step: GuideStep = {
        label: describeCause(cause, store.catalog),
        detail: creditsDetail(cause.need, cause.have, store.derived),
        action: { type: 'hero' },
      }
      const eta = causeEta(cause, store.derived)
      if (Number.isFinite(eta) && eta > 0) step.etaSec = eta
      return step
    }
    case 'currency': {
      if (cause.currency === 'rp') {
        return {
          label: describeCause(cause, store.catalog),
          detail: 'Signups earn RP. Post, gain followers, cross a milestone.',
          action: { type: 'center', tab: 'studio' },
        }
      }
      const canRebrand = hasCloudNode(store)
      return canRebrand
        ? {
            label: describeCause(cause, store.catalog),
            detail: "Rebrand banks CP from this season's credits.",
            action: { type: 'modal', id: 'rebrand' },
          }
        : {
            label: describeCause(cause, store.catalog),
            detail: 'Own a cloud node first',
            action: { type: 'store', tab: 'hardware', family: 'cloud-node' },
          }
    }
    case 'ownHardware':
      return hardwareStep(cause.id, cause.count, cause.owned, store)
    case 'ownFamily': {
      const cheapest = cheapestInFamily(cause.family, store)
      const step: GuideStep = {
        label: describeCause(cause, store.catalog),
        action: { type: 'store', tab: 'hardware', family: cause.family },
      }
      if (cheapest) {
        step.detail = storeAddress(cheapest.cost, 'Hardware', familyLabel(cause.family))
        step.cost = cheapest.cost
        step.currency = 'credits'
        const action = step.action
        if (action?.type === 'store') action.focusId = cheapest.id
      }
      return step
    }
    case 'ownModel': {
      const model = index.modelById[cause.id]
      return {
        label: `Own ${model?.name ?? cause.id}`,
        detail: 'In Models',
        action: { type: 'store', tab: 'models', focusId: cause.id },
      }
    }
    case 'upgrade': {
      const def = index.upgradeById[cause.id]
      const step: GuideStep = {
        label: describeCause(cause, store.catalog),
        action: { type: 'store', tab: 'upgrades', focusId: cause.id },
      }
      if (def) {
        const cost = Math.max(0, Math.ceil(def.cost))
        step.detail = storeAddress(cost, 'Upgrades')
        step.cost = cost
        step.currency = def.currency ?? 'credits'
      }
      return step
    }
    case 'mapNode':
      return nodeStep(cause.id, store)
    case 'parent':
      return nodeStep(cause.id, store)
    case 'stat': {
      const step: GuideStep = {
        label: describeCause(cause, store.catalog),
        detail: `You are at ${formatInt(cause.have)}.`,
      }
      if (cause.key === 'level') {
        step.action = { type: 'modal', id: 'level' }
      } else if (CLICK_STATS.has(cause.key)) {
        step.action = { type: 'hero' }
      } else {
        step.action = { type: 'center', tab: 'studio' }
      }
      return step
    }
    case 'cps':
      return {
        label: `Reach ${formatCps(cause.need)}`,
        detail: `You make ${formatCps(cause.have)}. Buy hardware.`,
        action: { type: 'store', tab: 'hardware' },
      }
    case 'level':
      return {
        label: `Reach level ${cause.need}`,
        detail: `You are level ${cause.have}. ${formatInt(levelProgress(store.state).xpToGo)} XP to go: post, finish a contract, unlock a Graph node.`,
        action: { type: 'modal', id: 'level' },
      }
    case 'vram': {
      const steps = cause.fixes.map((fix) => {
        if (fix.kind === 'quantize') {
          const label = store.catalog.precisions[fix.precision]?.label ?? fix.precision
          return {
            label: `Quantize ${label}`,
            detail: `One-off fee on ${index.modelById[cause.modelId]?.name ?? cause.modelId}, then it fits.`,
            cost: fix.fee,
            currency: 'credits' as Currency,
            action: { type: 'store', tab: 'models', focusId: cause.modelId } as GuideAction,
          }
        }
        const def = index.hardwareById[fix.hardwareId]
        return {
          label: `Buy ${withArticle(def?.name ?? fix.hardwareId)}`,
          detail: def ? storeAddress(fix.cost, 'Hardware', familyLabel(def.family)) : undefined,
          cost: fix.cost,
          currency: 'credits' as Currency,
          action: {
            type: 'store',
            tab: 'hardware',
            ...(def ? { family: def.family } : {}),
            focusId: fix.hardwareId,
          } as GuideAction,
        }
      })
      const head = steps[0]
      if (!head) {
        return { label: 'Needs a bigger card', detail: 'Nothing on sale holds this one yet.' }
      }
      const alt = steps[1]
      return alt ? { ...head, alt } : head
    }
    case 'backend': {
      if (cause.reason === 'zluda' && cause.zludaNodeId) return nodeStep(cause.zludaNodeId, store)
      if (!cause.buy) {
        return { label: 'Needs a discrete GPU', detail: 'Nothing on sale runs this one yet.' }
      }
      const def = index.hardwareById[cause.buy.hardwareId]
      return {
        label: `Buy ${withArticle(def?.name ?? cause.buy.hardwareId)}`,
        detail: def ? storeAddress(cause.buy.cost, 'Hardware', familyLabel(def.family)) : undefined,
        cost: cause.buy.cost,
        currency: 'credits',
        action: {
          type: 'store',
          tab: 'hardware',
          ...(def ? { family: def.family } : {}),
          focusId: cause.buy.hardwareId,
        },
      }
    }
    case 'apiNodes':
      return cause.nodeId
        ? nodeStep(cause.nodeId, store)
        : { label: 'Unlock API Nodes on the Graph', action: { type: 'map', nodeId: 'api-nodes' } }
    case 'setup': {
      const model = index.modelById[cause.modelId]
      const fee = model ? setupFee(model, store.derived, store.catalog) : cause.fee
      const step: GuideStep = {
        label: `Set up ${model?.name ?? cause.modelId}`,
        detail: fee > 0 ? `${formatNum(fee)} credits, the --lowvram tax` : 'Free, it fits your best card',
        action: { type: 'store', tab: 'models', focusId: cause.modelId },
      }
      if (fee > 0) {
        step.cost = fee
        step.currency = 'credits'
      }
      return step
    }
    case 'precision': {
      if (cause.gateNodeId) return nodeStep(cause.gateNodeId, store)
      const label = store.catalog.precisions[cause.precision]?.label ?? cause.precision
      return {
        label: `Quantize ${label}`,
        detail: `One-off fee on ${index.modelById[cause.modelId]?.name ?? cause.modelId}, then it fits.`,
        cost: cause.fee,
        currency: 'credits',
        action: { type: 'store', tab: 'models', focusId: cause.modelId },
      }
    }
    case 'family': {
      const def = cause.upgradeId ? index.upgradeById[cause.upgradeId] : undefined
      if (!def) {
        return { label: `${familyLabel(cause.family)} hardware is not available yet`, detail: 'Keep climbing the ladder.' }
      }
      const cost = Math.max(0, Math.ceil(def.cost))
      return {
        label: `Install ${def.name}`,
        detail: `Upgrades › ROCm · ${formatNum(cost)}`,
        cost,
        currency: def.currency ?? 'credits',
        action: { type: 'store', tab: 'upgrades', focusId: def.id },
      }
    }
    case 'max':
      return { label: 'Maxed out', detail: `${cause.max} owned. That is all of them.` }
    case 'flag':
      return { label: 'Secret', detail: 'Found, not bought.' }
    default: {
      const never: never = cause
      return never
    }
  }
}

/** Whether a rebrand is on the table: the prestige gate is owning a cloud node or a region. */
function hasCloudNode(store: GuideStore): boolean {
  const { hardwareById } = buildIndex(store.catalog)
  for (const id in store.state.hardware) {
    if ((store.state.hardware[id] ?? 0) <= 0) continue
    const family = hardwareById[id]?.family
    if (family === 'cloud-node' || family === 'region') return true
  }
  return false
}

/** Cheapest unit of a family in the catalog, at what the player would pay for the next one. */
function cheapestInFamily(family: HardwareFamily, store: GuideStore): { id: string; cost: number } | null {
  let best: { id: string; cost: number } | null = null
  for (const def of store.catalog.hardware) {
    if (def.family !== family) continue
    const cost = unitCost(def, store.state.hardware[def.id] ?? 0)
    if (!best || cost < best.cost) best = { id: def.id, cost }
  }
  return best
}

/** The one-line "why", in the voice the lock reasons already use, ending in a period. */
export function whyLine(cause: LockCause, store: GuideStore): string {
  const index = buildIndex(store.catalog)
  switch (cause.kind) {
    case 'vram':
      return `Needs ${round1(cause.need)} GB. Your best card has ${round1(cause.have)} GB.`
    case 'backend': {
      const name = index.modelById[cause.modelId]?.name ?? cause.modelId
      switch (cause.reason) {
        case 'cpu':
          return `${name} will not run on a CPU box.`
        case 'mps':
          return 'Apple silicon runs images only.'
        case 'zluda':
          return `${name} needs ZLUDA to run on an AMD card.`
        case 'none':
          return `Nothing you own can run ${name}.`
      }
    }
    case 'level':
      return `Level ${cause.need} unlocks this. You are level ${cause.have}.`
    case 'credits':
      return `Costs ${formatNum(cause.need)} credits. You have ${formatNum(cause.have)}.`
    case 'currency':
      return `Costs ${formatNum(cause.need)} ${CURRENCY_WORD[cause.currency]}. You have ${formatNum(cause.have)}.`
    case 'family':
      return `${familyLabel(cause.family)} cards need a driver stack first.`
    case 'max':
      return 'You own every one of these.'
    case 'flag':
      return 'This one is found, not bought.'
    case 'apiNodes':
      return 'API models run on someone else’s GPU. That needs API Nodes.'
    case 'setup':
      return `${index.modelById[cause.modelId]?.name ?? cause.modelId} is not installed yet.`
    case 'mapNode':
    case 'parent':
      return `${index.mapNodeById[cause.id]?.title ?? cause.id} is not on your Graph yet.`
    case 'precision': {
      const name = index.modelById[cause.modelId]?.name ?? cause.modelId
      const label = store.catalog.precisions[cause.precision]?.label ?? cause.precision
      return `${name} has no ${label} weights yet.`
    }
    case 'upgrade':
      return `${index.upgradeById[cause.id]?.name ?? cause.id} is not installed.`
    default:
      return `${describeCause(cause, store.catalog)}.`
  }
}

const round1 = (gb: number): string => (Number.isFinite(gb) ? String(Math.round(gb * 10) / 10) : '∞')

/**
 * The whole popover: why it is locked and at most three steps out of it, in the order the engine
 * reported them. Duplicate steps (the same button twice) are dropped.
 */
export function stepsFor(causes: readonly LockCause[], store: GuideStore, subject = ''): GuideSpec {
  const head = causes[0]
  if (!head) return { subject, why: '', steps: [] }
  const steps: GuideStep[] = []
  const seen = new Set<string>()
  for (const cause of causes) {
    const step = stepFor(cause, store)
    const key = `${step.label}|${step.action?.type ?? 'none'}`
    if (seen.has(key)) continue
    seen.add(key)
    steps.push(step)
    if (steps.length >= MAX_STEPS) break
  }
  return { subject, why: whyLine(head, store), steps }
}
