'use client'
/**
 * The Graph: a full-bleed React Flow canvas dressed as a ComfyUI workflow. Lane bands per branch,
 * node boxes on the data file's grid, bezier noodles between them, the litegraph dot grid behind
 * everything, a restyled minimap and controls, a search box with the branch legend top-left and
 * the details panel on the right.
 *
 * State: the four live id sets come from `useMapSets` (one shallow selector on `|`-joined ids);
 * nodes and edges are rebuilt only when those sets, the selection or the search change, and
 * unchanged nodes keep their identity so the memoised node components skip. Node components get
 * their callbacks through `MapInteractionContext`, never from the store.
 *
 * Keys: `/` focuses search · Enter jumps to the first match · Esc clears search, then the
 * selection · `+` `-` zoom · `0` fits everything · `F` fits the frontier (owned + available).
 */
import '@xyflow/react/dist/style.css'
import './map.css'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { Search, X } from 'lucide-react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel as FlowPanel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type CoordinateExtent,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react'
import { MAP_BRANCHES } from '@/game/map'
import type { MapBranch, MapNodeDef } from '@/game/types'
import { cn } from '@/lib/utils'
import { useGame, useGameStore } from '@/state/useGame'
import { isEditableTarget } from '@/hooks/useHotkeys'
import { MapEdge } from './MapEdge'
import { LaneGroup, MapNode } from './MapNode'
import { NodeDetails } from './NodeDetails'
import { MapInteractionContext, useBranchCounts, useMapSets, useReducedMotionPref, useUnlockNode, type MapInteraction } from './mapHooks'
import { BRANCH_META, buildGraph, buildStaticLayout, isNodeVisible, matchesQuery, NODE_H, NODE_W, type GraphNode, type GraphOutput, type StaticLayout } from './mapLayout'

const NODE_TYPES: NodeTypes = { mapNode: MapNode, laneGroup: LaneGroup }
const EDGE_TYPES: EdgeTypes = { noodle: MapEdge }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.75
/** The frontier fit never zooms out past this: node titles stay legible. */
const FRONTIER_MIN_ZOOM = 0.6
/** Graph-pixel radius around the anchor node that the frontier fit tries to keep on screen. */
const FRONTIER_RADIUS = 900
const FRONTIER_PADDING = 0.2
/** How far past the lane bands the viewport may pan, so the graph can never be lost off-screen. */
const EXTENT_MARGIN_X = 640
const EXTENT_MARGIN_Y = 420

const DOT_MINOR = '#3c3d42'
const DOT_MAJOR = '#55565e'

/**
 * The previous build per static layout, so `buildGraph` can hand back the same node and edge
 * objects when nothing about them changed and the memoised node components skip. One canvas
 * exists per catalog at a time, so a module-level cache is enough and keeps refs out of render.
 */
const lastGraph = new WeakMap<StaticLayout, GraphOutput>()

export function GraphMap({ className }: { className?: string }) {
  return (
    <ReactFlowProvider>
      <GraphMapInner className={className} />
    </ReactFlowProvider>
  )
}

function GraphMapInner({ className }: { className?: string }) {
  const store = useGameStore()
  const rf = useReactFlow<GraphNode>()
  const reduced = useReducedMotionPref()
  const layout = buildStaticLayout(store.catalog)
  const sets = useMapSets()
  const started = useGame((_s, _d, s) => s.started)
  const unlockNode = useUnlockNode()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Unchanged nodes and edges keep their identity between builds (see buildGraph's `prev`).
  const graph = useMemo(() => {
    const next = buildGraph({ layout, catalog: store.catalog, sets, selectedId, query, prev: lastGraph.get(layout) })
    lastGraph.set(layout, next)
    return next
  }, [layout, store.catalog, sets, selectedId, query])

  const selectedDef: MapNodeDef | null = selectedId ? (layout.byId[selectedId] ?? null) : null

  const translateExtent = useMemo<CoordinateExtent>(() => {
    const { minX, minY, maxX, maxY } = layout.bounds
    return [
      [minX - EXTENT_MARGIN_X, minY - EXTENT_MARGIN_Y],
      [maxX + EXTENT_MARGIN_X, maxY + EXTENT_MARGIN_Y],
    ]
  }, [layout])

  // ---- viewport helpers ----------------------------------------------------

  const frontierIds = useCallback((): string[] => {
    const ids: string[] = []
    for (const def of layout.nodes) if (sets.owned.has(def.id) || sets.available.has(def.id)) ids.push(def.id)
    return ids
  }, [layout, sets])

  const fitAll = useCallback(
    (duration = 500) => {
      void rf.fitView({ padding: 0.08, minZoom: MIN_ZOOM, maxZoom: 1, duration: reduced ? 0 : duration })
    },
    [rf, reduced],
  )

  /**
   * The frontier spans every lane once a few branches are open, and fitting all of it lands at
   * an unreadable zoom. Fit its densest cluster instead: the available node nearest the centre
   * of what is owned, plus every frontier node within FRONTIER_RADIUS of it, never below
   * FRONTIER_MIN_ZOOM.
   */
  const fitFrontier = useCallback(
    (duration = 500) => {
      const ids = frontierIds()
      if (ids.length === 0) {
        fitAll(duration)
        return
      }
      const centre = (id: string) => {
        const p = (layout.byId[id] as MapNodeDef).position
        return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }
      }
      const owned = ids.filter((id) => sets.owned.has(id))
      const pool = owned.length > 0 ? owned : ids
      const centroid = pool.reduce(
        (acc, id) => {
          const c = centre(id)
          return { x: acc.x + c.x / pool.length, y: acc.y + c.y / pool.length }
        },
        { x: 0, y: 0 },
      )
      const dist = (id: string) => {
        const c = centre(id)
        return Math.hypot(c.x - centroid.x, c.y - centroid.y)
      }
      const candidates = ids.filter((id) => sets.available.has(id))
      const anchor = (candidates.length > 0 ? candidates : ids).reduce((best, id) => (dist(id) < dist(best) ? id : best))
      const a = centre(anchor)
      // Nearest first; keep adding neighbours only while the whole set still fits at the floor zoom.
      const wrapper = wrapperRef.current
      const maxW = wrapper ? (wrapper.clientWidth / FRONTIER_MIN_ZOOM) * (1 - 2 * FRONTIER_PADDING) : Infinity
      const maxH = wrapper ? (wrapper.clientHeight / FRONTIER_MIN_ZOOM) * (1 - 2 * FRONTIER_PADDING) : Infinity
      const byDistance = ids
        .map((id) => ({ id, d: Math.hypot(centre(id).x - a.x, centre(id).y - a.y) }))
        .filter((n) => n.d <= FRONTIER_RADIUS)
        .sort((p, q) => p.d - q.d)
      const cluster: string[] = []
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const { id } of byDistance) {
        const p = (layout.byId[id] as MapNodeDef).position
        const nx0 = Math.min(minX, p.x)
        const ny0 = Math.min(minY, p.y)
        const nx1 = Math.max(maxX, p.x + NODE_W)
        const ny1 = Math.max(maxY, p.y + NODE_H)
        if (cluster.length > 0 && (nx1 - nx0 > maxW || ny1 - ny0 > maxH)) continue
        minX = nx0
        minY = ny0
        maxX = nx1
        maxY = ny1
        cluster.push(id)
      }
      void rf.fitView({ nodes: cluster.map((id) => ({ id })), padding: FRONTIER_PADDING, minZoom: FRONTIER_MIN_ZOOM, maxZoom: 1, duration: reduced ? 0 : duration })
    },
    [fitAll, frontierIds, layout, reduced, rf, sets],
  )

  const fitBranch = useCallback(
    (branch: MapBranch) => {
      const lane = layout.lanes.find((l) => l.branch === branch)
      if (!lane) return
      const ids = lane.nodeIds.filter((id) => isNodeVisible(layout.byId[id] as MapNodeDef, sets))
      if (ids.length === 0) return
      void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.2, minZoom: MIN_ZOOM, maxZoom: 1, duration: reduced ? 0 : 500 })
    },
    [layout, reduced, rf, sets],
  )

  /** Select a node and bring it into view (search, legend, parent/child chips). */
  const focusNode = useCallback(
    (id: string) => {
      const def = layout.byId[id]
      if (!def) return
      setSelectedId(id)
      const zoom = Math.max(rf.getZoom(), 0.9)
      void rf.setCenter(def.position.x + NODE_W / 2, def.position.y + NODE_H / 2, { zoom, duration: reduced ? 0 : 450 })
    },
    [layout, reduced, rf],
  )

  // First fit once the canvas is measured and the save is loaded: the frontier, which is where
  // the next decision is. (React Flow drops a fitView that lands before its pan/zoom exists.)
  const [ready, setReady] = useState(false)
  const onInit = useCallback(() => setReady(true), [])
  const fitted = useRef(false)
  useEffect(() => {
    if (!ready || !started || fitted.current) return
    fitted.current = true
    fitFrontier(0)
  }, [ready, started, fitFrontier])

  // ---- interaction context -------------------------------------------------

  const interaction = useMemo<MapInteraction>(
    () => ({
      select: (id) => setSelectedId(id),
      unlock: (def, point) => {
        unlockNode(def, point)
      },
    }),
    [unlockNode],
  )

  // ---- search ----------------------------------------------------------------

  const q = query.trim()
  const matches = useMemo(() => {
    if (!q) return []
    const out: MapNodeDef[] = []
    for (const def of layout.nodes) if (isNodeVisible(def, sets) && matchesQuery(def, q)) out.push(def)
    return out
  }, [layout, sets, q])

  const jumpToFirstMatch = useCallback(() => {
    const first = matches[0]
    if (first) focusNode(first.id)
  }, [matches, focusNode])

  // ---- keys ------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const inSearch = e.target === searchRef.current
      if (e.key === 'Escape') {
        // A modal on top (Rebrand, Settings) owns Escape; ModalBase closes it.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
        if (inSearch && query) {
          setQuery('')
          return
        }
        if (inSearch) searchRef.current?.blur()
        setSelectedId(null)
        return
      }
      if (isEditableTarget(e.target)) return
      switch (e.key) {
        case '/':
          e.preventDefault()
          searchRef.current?.focus()
          searchRef.current?.select()
          break
        case '+':
        case '=':
          e.preventDefault()
          void rf.zoomIn({ duration: reduced ? 0 : 200 })
          break
        case '-':
        case '_':
          e.preventDefault()
          void rf.zoomOut({ duration: reduced ? 0 : 200 })
          break
        case '0':
          e.preventDefault()
          fitAll()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          fitFrontier()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitAll, fitFrontier, query, reduced, rf])

  const onPaneClick = useCallback(() => setSelectedId(null), [])
  // React Flow only gives nodes pointer events when they are selectable, draggable, or the flow
  // has a node click handler; ours are neither, so this handler is what makes the boxes (and the
  // Unlock buttons inside them) clickable at all. MapNode already selects on its own click; the
  // lane bands are non-interactive and are pinned so in map.css.
  const onNodeClick = useCallback((_: ReactMouseEvent, node: GraphNode) => {
    if (node.type === 'mapNode') setSelectedId(node.id)
  }, [])

  const minimapColor = useCallback(
    (node: GraphNode): string => {
      if (node.type === 'laneGroup') return `${BRANCH_META[node.data.branch].color}14`
      if (sets.owned.has(node.id)) return BRANCH_META[node.data.def.branch].color
      if (sets.available.has(node.id)) return '#f0ff41'
      return '#3c3d42'
    },
    [sets],
  )
  const minimapStroke = useCallback((node: GraphNode): string => (node.type === 'laneGroup' ? `${BRANCH_META[node.data.branch].color}40` : 'transparent'), [])

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <MapInteractionContext.Provider value={interaction}>
        <div ref={wrapperRef} className={cn('cc-map', selectedDef && 'cc-map--details', className)} data-testid="graph-map">
          <ReactFlow<GraphNode>
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            colorMode="dark"
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            translateExtent={translateExtent}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            zoomOnPinch
            zoomOnScroll
            zoomOnDoubleClick={false}
            panOnDrag
            panOnScroll={false}
            preventScrolling
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            deleteKeyCode={null}
            onlyRenderVisibleElements
            onInit={onInit}
            onPaneClick={onPaneClick}
            onNodeClick={onNodeClick}
            nodeOrigin={[0, 0]}
            aria-label="The Graph: skill tree canvas"
          >
            {/* Litegraph grid: 24 px dots with every fifth one brighter. */}
            <Background id="cc-dots" variant={BackgroundVariant.Dots} gap={24} size={1.2} color={DOT_MINOR} bgColor="#171718" />
            <Background id="cc-dots-major" variant={BackgroundVariant.Dots} gap={120} size={2} color={DOT_MAJOR} />
            <div className="cc-map__vignette" aria-hidden="true" />

            <Controls
              showInteractive={false}
              position="bottom-left"
              fitViewOptions={{ padding: 0.08, minZoom: MIN_ZOOM, maxZoom: 1, duration: reduced ? 0 : 500 }}
              aria-label="Canvas controls"
            />
            <MiniMap<GraphNode>
              position="bottom-right"
              pannable
              zoomable
              nodeColor={minimapColor}
              nodeStrokeColor={minimapStroke}
              nodeStrokeWidth={1}
              nodeBorderRadius={4}
              bgColor="#202121"
              maskColor="rgba(23, 23, 24, 0.72)"
              maskStrokeColor="#f0ff41"
              maskStrokeWidth={2}
              ariaLabel="Minimap of The Graph"
            />

            <FlowPanel position="top-left" className="cc-map__hud">
              <SearchBox
                ref={searchRef}
                value={query}
                onChange={setQuery}
                onSubmit={jumpToFirstMatch}
                matches={q ? matches.length : null}
              />
              <Legend onPick={fitBranch} />
            </FlowPanel>
          </ReactFlow>

          <AnimatePresence>
            {selectedDef ? (
              <NodeDetails
                key="details"
                def={selectedDef}
                layout={layout}
                sets={sets}
                onClose={() => setSelectedId(null)}
                onSelect={focusNode}
              />
            ) : null}
          </AnimatePresence>
        </div>
      </MapInteractionContext.Provider>
    </MotionConfig>
  )
}

// ---------------------------------------------------------------------------
// HUD: search + legend
// ---------------------------------------------------------------------------

interface SearchBoxProps {
  ref: React.Ref<HTMLInputElement>
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  /** Match count while a query is active; null when the box is empty. */
  matches: number | null
}

function SearchBox({ ref, value, onChange, onSubmit, matches }: SearchBoxProps) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="flex h-9 items-center gap-2 rounded-xl border-2 border-charcoal-400 bg-charcoal-600 pr-1.5 pl-2.5 shadow-[0_4px_0_#0e0e0f] focus-within:border-electric-400/70"
    >
      <Search size={14} aria-hidden="true" className="shrink-0 text-smoke-800" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search nodes  ( / )"
        aria-label="Search the Graph"
        autoComplete="off"
        spellCheck={false}
        className="w-44 min-w-0 bg-transparent text-sm text-smoke-100 placeholder:text-smoke-800 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {matches !== null ? (
        <span className={cn('shrink-0 text-[10px] font-semibold tabular-nums', matches > 0 ? 'text-smoke-600' : 'text-slot-vae')} aria-live="polite">
          {matches === 0 ? 'no match' : `${matches} ${matches === 1 ? 'node' : 'nodes'}`}
        </span>
      ) : null}
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="grid size-6 shrink-0 place-items-center rounded-comfy text-smoke-800 transition-colors hover:bg-charcoal-500 hover:text-smoke-100"
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </form>
  )
}

/** Branch legend: colour, name and owned/total; clicking frames that lane. */
function Legend({ onPick }: { onPick: (branch: MapBranch) => void }) {
  const counts = useBranchCounts()
  return (
    <ul aria-label="Branches" className="flex max-w-[min(92vw,720px)] flex-wrap gap-1">
      {MAP_BRANCHES.map((branch) => {
        const c = counts[branch]
        if (!c || c.total === 0) return null
        const meta = BRANCH_META[branch]
        const done = c.owned === c.total
        return (
          <li key={branch}>
            <button
              type="button"
              onClick={() => onPick(branch)}
              title={`${meta.label}: ${c.owned} of ${c.total} unlocked. ${meta.blurb}`}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-comfy border bg-charcoal-600/90 px-2 text-[10px] font-semibold uppercase tracking-[0.06em] backdrop-blur-sm transition-colors hover:bg-charcoal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
                done ? 'border-electric-400/50 text-smoke-100' : 'border-charcoal-400 text-smoke-600 hover:text-smoke-100',
              )}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
              {meta.label}
              <span className="tabular-nums text-smoke-800">
                {c.owned}/{c.total}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
