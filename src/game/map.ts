/**
 * Node Map logic: availability, pricing, and unlocking of `MapNodeDef`s.
 *
 * Currency rules:
 *  - credits are deducted from `state.credits`
 *  - rp is never deducted: the RP income multiplier in derived.ts reads `state.rp`, so spending
 *    RP on nodes must not weaken it. Spent RP is instead derived from the unlocked RP nodes
 *    (`rpSpent`), and `rpAvailable = rp − rpSpent`.
 *  - cp works the same way via the explicit `state.cpSpent` counter (`cpAvailable = cp − cpSpent`).
 */
import type { Catalog } from '@/data'
import { MAP_NODES } from '@/data/mapNodes'
import type { Currency, Derived, GameState, MapBranch, MapNodeDef } from '@/game/types'
import { isUnlocked } from '@/game/unlock'

export const ROOT_NODE_ID = 'core-root'

/** The subset of the catalog the map module needs; a full `Catalog` satisfies it. */
export interface MapCatalog {
  mapNodes: MapNodeDef[]
}

export const MAP_BRANCHES: readonly MapBranch[] = [
  'core',
  'hardware',
  'models',
  'techniques',
  'infra',
  'social',
  'regions',
  'api',
  'prestige',
  'hidden',
]

/**
 * Nodes whose id is read directly by another module (store gating, quantize panel, LoRA trainer)
 * rather than through their `effects`. Their effects may be empty or purely decorative.
 */
export const MARKER_IDS: ReadonlySet<string> = new Set([
  'quant-fp8',
  'quant-q4',
  'lora-training',
  'regions-unlock',
  'orbital-unlock',
  'dyson-unlock',
])

export function isMarker(id: string): boolean {
  return MARKER_IDS.has(id)
}

export function isRootNode(node: MapNodeDef): boolean {
  return node.id === ROOT_NODE_ID || node.parents.length === 0
}

export function mapNodeCost(node: MapNodeDef): number {
  return Math.max(0, Math.ceil(node.cost))
}

export function isNodeUnlocked(state: GameState, id: string): boolean {
  return state.mapNodes.includes(id)
}

/** Sum of costs of every unlocked node priced in `currency`. */
function spentIn(state: GameState, currency: Currency, catalog: MapCatalog): number {
  let total = 0
  for (const node of catalog.mapNodes) {
    if (node.currency === currency && state.mapNodes.includes(node.id)) total += mapNodeCost(node)
  }
  return total
}

/** RP locked into unlocked map nodes. Never subtracted from `state.rp` itself. */
export function rpSpent(state: GameState, catalog: MapCatalog = { mapNodes: MAP_NODES }): number {
  return spentIn(state, 'rp', catalog)
}

export function rpAvailable(state: GameState, catalog: MapCatalog = { mapNodes: MAP_NODES }): number {
  return Math.max(0, state.rp - rpSpent(state, catalog))
}

export function cpAvailable(state: GameState): number {
  return Math.max(0, state.cp - state.cpSpent)
}

/** Spendable balance in a given currency. */
export function currencyBalance(
  state: GameState,
  currency: Currency,
  catalog: MapCatalog = { mapNodes: MAP_NODES },
): number {
  switch (currency) {
    case 'credits':
      return state.credits
    case 'rp':
      return rpAvailable(state, catalog)
    case 'cp':
      return cpAvailable(state)
  }
}

export function canAffordNode(
  node: MapNodeDef,
  state: GameState,
  catalog: MapCatalog = { mapNodes: MAP_NODES },
): boolean {
  return currencyBalance(state, node.currency, catalog) >= mapNodeCost(node)
}

/**
 * Whether `node` can be unlocked right now: not owned, every parent owned (root has none),
 * unlock condition met, and (for hidden nodes) its discovery flag set (hidden nodes without
 * a condition can never surface). Affordability is checked separately by `canAffordNode`.
 */
export function mapNodeAvailable(
  node: MapNodeDef,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): boolean {
  if (isNodeUnlocked(state, node.id)) return false
  if (!isRootNode(node) && !node.parents.every((p) => isNodeUnlocked(state, p))) return false
  if (node.hidden && !node.unlock) return false
  return isUnlocked(node.unlock, state, derived, catalog)
}

/**
 * Whether the UI should draw the node at all. Hidden nodes stay invisible until their flag is
 * set or they have been unlocked; everything else is always drawn (locked nodes just look locked).
 */
export function mapNodeVisible(node: MapNodeDef, state: GameState, derived: Derived, catalog: Catalog): boolean {
  if (!node.hidden) return true
  if (isNodeUnlocked(state, node.id)) return true
  return node.unlock !== undefined && isUnlocked(node.unlock, state, derived, catalog)
}

/**
 * Pays for and records the node. Returns false (and leaves state untouched) when it is already
 * owned or unaffordable. Graph/unlock prerequisites are the caller's job (`mapNodeAvailable`).
 */
export function unlockNode(state: GameState, node: MapNodeDef, catalog: MapCatalog = { mapNodes: MAP_NODES }): boolean {
  if (isNodeUnlocked(state, node.id)) return false
  if (!canAffordNode(node, state, catalog)) return false
  const cost = mapNodeCost(node)
  switch (node.currency) {
    case 'credits':
      state.credits -= cost
      break
    case 'cp':
      state.cpSpent += cost
      break
    case 'rp':
      // Intentionally no deduction: rpSpent() derives it from the unlocked node list.
      break
  }
  state.mapNodes.push(node.id)
  return true
}

/** Nodes grouped by branch, catalog order preserved; every branch is present (possibly empty). */
export function nodesByBranch(catalog: MapCatalog): Record<MapBranch, MapNodeDef[]> {
  const out = Object.fromEntries(MAP_BRANCHES.map((b) => [b, [] as MapNodeDef[]])) as Record<MapBranch, MapNodeDef[]>
  for (const node of catalog.mapNodes) out[node.branch].push(node)
  return out
}

/** Parent → child edges for rendering. */
export function mapEdges(catalog: MapCatalog): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = []
  for (const node of catalog.mapNodes) for (const from of node.parents) edges.push({ from, to: node.id })
  return edges
}

/** Direct children of `id`. */
export function childrenOf(id: string, catalog: MapCatalog): MapNodeDef[] {
  return catalog.mapNodes.filter((n) => n.parents.includes(id))
}
