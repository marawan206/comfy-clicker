/**
 * Static geometry for The Graph: node boxes on the 260×140 grid `src/data/mapNodes.ts` already
 * lays out, one ComfyUI-style "group" band per branch (lane label + tinted backdrop) and the
 * parent → child edges. Nothing here reads game state; `GraphMap` merges the live sets in.
 */
import type { Edge, Node } from '@xyflow/react'
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { MAP_BRANCHES, mapNodeCost } from '@/game/map'
import { describeUnlock } from '@/game/unlock'
import type { Currency, MapBranch, MapNodeDef } from '@/game/types'
import type { Stripe } from '@/components/common/Panel'

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** Node box size; leaves a 40 × 36 px gutter on the grid for noodles and group padding. */
export const NODE_W = 220
export const NODE_H = 104
/** Group band padding: the header eats the gutter above a lane's first row. */
const GROUP_PAD_X = 20
const GROUP_PAD_TOP = 28
const GROUP_PAD_BOTTOM = 8
/** Lanes that touch vertically share a gutter; the numbers above make their bands meet exactly. */
export const GROUP_HEADER_H = GROUP_PAD_TOP

// ---------------------------------------------------------------------------
// Branch palette (ComfyUI slot colours; mirrors the Panel stripe table)
// ---------------------------------------------------------------------------

export interface BranchMeta {
  label: string
  /** Hex colour used for title bars, noodles and the minimap. */
  color: string
  stripe: Stripe
  /** Asset id for the lane glyph, or null when the lane has no generated art (core uses an icon). */
  art: string | null
  /** One dry line under the lane title. */
  blurb: string
}

export const BRANCH_META: Record<MapBranch, BranchMeta> = {
  core: { label: 'Core', color: '#f0ff41', stripe: 'electric', art: null, blurb: 'The trunk. Everything forks from here.' },
  hardware: { label: 'Hardware', color: '#64b5f6', stripe: 'image', art: 'map-hardware', blurb: 'Per-family output. Own the class first.' },
  models: { label: 'Models', color: '#ff9cf9', stripe: 'latent', art: 'map-models', blurb: 'Loaders and adapters. Better posts.' },
  techniques: { label: 'Techniques', color: '#ffa931', stripe: 'cond', art: 'map-techniques', blurb: 'Speed, quantization, ROCm, distillation.' },
  infra: { label: 'Infra', color: '#ff6e6e', stripe: 'vae', art: 'map-infra', blurb: 'Power, cooling, ops. Breakers included.' },
  social: { label: 'Social', color: '#81c784', stripe: 'mask', art: 'map-social', blurb: 'Paid in Research Points. Signups are RP.' },
  regions: { label: 'Regions', color: '#ffd500', stripe: 'clip', art: 'map-regions', blurb: 'Planetary scale, then orbit.' },
  api: { label: 'API', color: '#b39ddb', stripe: 'model', art: 'map-api', blurb: 'Rent other people’s models. Pay the surcharge.' },
  prestige: { label: 'Prestige', color: '#7f8dff', stripe: 'sapphire', art: 'map-prestige', blurb: 'Comfy Points. Survives every rebrand.' },
  hidden: { label: 'Hidden', color: '#f3f3f3', stripe: 'none', art: 'map-hidden', blurb: 'Found, not bought. Well, found, then bought.' },
}

export const CURRENCY_LABEL: Record<Currency, string> = { credits: 'credits', rp: 'RP', cp: 'CP' }

// ---------------------------------------------------------------------------
// Node data shapes
// ---------------------------------------------------------------------------

export type NodeStatus = 'owned' | 'available' | 'locked'

export interface MapNodeData extends Record<string, unknown> {
  def: MapNodeDef
  status: NodeStatus
  /** Available and the balance covers the cost. */
  affordable: boolean
  selected: boolean
  /** Search active and this node does not match. */
  dimmed: boolean
  /** Why a locked node is locked (missing parents or its unlock condition); empty otherwise. */
  reason: string
}

export interface LaneGroupData extends Record<string, unknown> {
  branch: MapBranch
  label: string
  blurb: string
  color: string
  width: number
  height: number
  /** The prestige lane carries the Rebrand call to action in its header. */
  rebrandCta: boolean
}

export type MapFlowNode = Node<MapNodeData, 'mapNode'>
export type LaneGroupNode = Node<LaneGroupData, 'laneGroup'>
export type GraphNode = MapFlowNode | LaneGroupNode

export type EdgeState = 'owned' | 'available' | 'locked'

export interface MapEdgeData extends Record<string, unknown> {
  state: EdgeState
  color: string
  dimmed: boolean
}

export type MapFlowEdge = Edge<MapEdgeData, 'noodle'>

// ---------------------------------------------------------------------------
// Static layout
// ---------------------------------------------------------------------------

export interface LaneGeometry {
  branch: MapBranch
  x: number
  y: number
  width: number
  height: number
  nodeIds: string[]
}

export interface StaticLayout {
  /** Every map node in catalog order (hidden ones included; the caller filters by visibility). */
  nodes: MapNodeDef[]
  lanes: LaneGeometry[]
  /** Parent → child pairs in catalog order. */
  edges: Array<{ from: string; to: string }>
  byId: Record<string, MapNodeDef>
  /** Children per node id, for the "leads to" list. */
  children: Record<string, string[]>
  /** Extent of every lane band, for the initial fit. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const layoutCache = new WeakMap<Catalog, StaticLayout>()

/** Geometry for the whole graph, memoised per catalog object. */
export function buildStaticLayout(catalog: Catalog): StaticLayout {
  const cached = layoutCache.get(catalog)
  if (cached) return cached

  const nodes = catalog.mapNodes
  const byId = buildIndex(catalog).mapNodeById
  const children: Record<string, string[]> = {}
  const edges: Array<{ from: string; to: string }> = []
  for (const node of nodes) {
    for (const from of node.parents) {
      edges.push({ from, to: node.id })
      ;(children[from] ??= []).push(node.id)
    }
  }

  const lanes: LaneGeometry[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const branch of MAP_BRANCHES) {
    const members = nodes.filter((n) => n.branch === branch)
    if (members.length === 0) continue
    let lx = Infinity
    let ly = Infinity
    let rx = -Infinity
    let ry = -Infinity
    for (const n of members) {
      lx = Math.min(lx, n.position.x)
      ly = Math.min(ly, n.position.y)
      rx = Math.max(rx, n.position.x + NODE_W)
      ry = Math.max(ry, n.position.y + NODE_H)
    }
    const x = lx - GROUP_PAD_X
    const y = ly - GROUP_PAD_TOP
    const width = rx + GROUP_PAD_X - x
    const height = ry + GROUP_PAD_BOTTOM - y
    lanes.push({ branch, x, y, width, height, nodeIds: members.map((n) => n.id) })
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  const layout: StaticLayout = { nodes, lanes, edges, byId, children, bounds: { minX, minY, maxX, maxY } }
  layoutCache.set(catalog, layout)
  return layout
}

// ---------------------------------------------------------------------------
// Live merge
// ---------------------------------------------------------------------------

export interface MapSets {
  owned: ReadonlySet<string>
  available: ReadonlySet<string>
  affordable: ReadonlySet<string>
  /** Hidden nodes whose flag is raised (or that are already owned). Non-hidden nodes are always visible. */
  surfaced: ReadonlySet<string>
}

export function isNodeVisible(def: MapNodeDef, sets: MapSets): boolean {
  return !def.hidden || sets.surfaced.has(def.id)
}

export function statusOf(id: string, sets: MapSets): NodeStatus {
  if (sets.owned.has(id)) return 'owned'
  if (sets.available.has(id)) return 'available'
  return 'locked'
}

/**
 * Short reason a node cannot be unlocked yet: the parents still missing, else its unlock
 * condition in the same words the store's tooltips use. Empty for owned/available nodes.
 */
export function lockReason(def: MapNodeDef, sets: MapSets, catalog: Catalog): string {
  if (sets.owned.has(def.id) || sets.available.has(def.id)) return ''
  const { mapNodeById } = buildIndex(catalog)
  const missing = def.parents.filter((p) => !sets.owned.has(p)).map((p) => mapNodeById[p]?.title ?? p)
  if (missing.length > 0) return `Needs ${missing.join(' and ')}`
  const cond = describeUnlock(def.unlock, catalog)
  return cond || 'Locked'
}

export function edgeStateOf(from: string, to: string, sets: MapSets): EdgeState {
  if (sets.owned.has(to)) return 'owned'
  if (sets.owned.has(from) && sets.available.has(to)) return 'available'
  return 'locked'
}

/** Case-insensitive title/desc/branch match for the search box; an empty query matches everything. */
export function matchesQuery(def: MapNodeDef, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return def.title.toLowerCase().includes(q) || def.desc.toLowerCase().includes(q) || BRANCH_META[def.branch].label.toLowerCase().includes(q)
}

export interface BuildGraphInput {
  layout: StaticLayout
  catalog: Catalog
  sets: MapSets
  selectedId: string | null
  query: string
  /** The previous build; unchanged nodes and edges keep their object identity so memoised components skip. */
  prev?: GraphOutput
}

export interface GraphOutput {
  nodes: GraphNode[]
  edges: MapFlowEdge[]
}

function sameNodeData(a: MapNodeData, b: MapNodeData): boolean {
  return a.def === b.def && a.status === b.status && a.affordable === b.affordable && a.selected === b.selected && a.dimmed === b.dimmed && a.reason === b.reason
}

function sameEdgeData(a: MapEdgeData, b: MapEdgeData): boolean {
  return a.state === b.state && a.color === b.color && a.dimmed === b.dimmed
}

/** Flow nodes (lane groups first so they paint underneath) and edges for the current state. */
export function buildGraph({ layout, catalog, sets, selectedId, query, prev }: BuildGraphInput): GraphOutput {
  const q = query.trim()
  const visible = new Set<string>()
  const nodes: GraphNode[] = []
  const prevNodes = new Map<string, GraphNode>()
  const prevEdges = new Map<string, MapFlowEdge>()
  if (prev) {
    for (const n of prev.nodes) prevNodes.set(n.id, n)
    for (const e of prev.edges) prevEdges.set(e.id, e)
  }

  for (const lane of layout.lanes) {
    if (!lane.nodeIds.some((id) => isNodeVisible(layout.byId[id] as MapNodeDef, sets))) continue
    const id = `lane:${lane.branch}`
    const kept = prevNodes.get(id)
    if (kept) {
      nodes.push(kept)
      continue
    }
    const meta = BRANCH_META[lane.branch]
    nodes.push({
      id,
      type: 'laneGroup',
      position: { x: lane.x, y: lane.y },
      width: lane.width,
      height: lane.height,
      selectable: false,
      draggable: false,
      focusable: false,
      connectable: false,
      zIndex: -1,
      data: {
        branch: lane.branch,
        label: meta.label,
        blurb: meta.blurb,
        color: meta.color,
        width: lane.width,
        height: lane.height,
        rebrandCta: lane.branch === 'prestige',
      },
    })
  }

  for (const def of layout.nodes) {
    if (!isNodeVisible(def, sets)) continue
    visible.add(def.id)
    const status = statusOf(def.id, sets)
    const data: MapNodeData = {
      def,
      status,
      affordable: status === 'available' && sets.affordable.has(def.id),
      selected: def.id === selectedId,
      dimmed: q !== '' && !matchesQuery(def, q),
      reason: lockReason(def, sets, catalog),
    }
    const kept = prevNodes.get(def.id)
    if (kept && kept.type === 'mapNode' && sameNodeData(kept.data, data)) {
      nodes.push(kept)
      continue
    }
    nodes.push({
      id: def.id,
      type: 'mapNode',
      position: def.position,
      width: NODE_W,
      height: NODE_H,
      selectable: false,
      draggable: false,
      focusable: false,
      connectable: false,
      data,
    })
  }

  const edges: MapFlowEdge[] = []
  for (const { from, to } of layout.edges) {
    if (!visible.has(from) || !visible.has(to)) continue
    const target = layout.byId[to] as MapNodeDef
    const state = edgeStateOf(from, to, sets)
    const id = `${from}->${to}`
    const data: MapEdgeData = {
      state,
      color: BRANCH_META[target.branch].color,
      dimmed: q !== '' && !(matchesQuery(target, q) || matchesQuery(layout.byId[from] as MapNodeDef, q)),
    }
    const kept = prevEdges.get(id)
    if (kept && kept.data && sameEdgeData(kept.data, data)) {
      edges.push(kept)
      continue
    }
    edges.push({
      id,
      type: 'noodle',
      source: from,
      target: to,
      selectable: false,
      focusable: false,
      zIndex: state === 'available' ? 1 : 0,
      data,
    })
  }

  return { nodes, edges }
}

/** Formatted price for a node with its currency word, e.g. `2,500 credits` or `12 RP`. */
export function priceLabel(def: MapNodeDef, format: (n: number) => string): string {
  return `${format(mapNodeCost(def))} ${CURRENCY_LABEL[def.currency]}`
}
