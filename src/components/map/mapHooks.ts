'use client'
/**
 * Map-side selectors and the unlock action. The loop bumps the store ≈20×/s, so every hook here
 * selects primitives or `|`-joined id strings and derives Sets/objects with `useMemo` only when a
 * key changes. Node components never subscribe to the store themselves: `GraphMap` selects the
 * four id sets once and pushes status into node data.
 */
import { createContext, useCallback, useContext, useMemo } from 'react'
import { fx } from '@/components/fx/fxBus'
import { toast } from '@/components/overlays/useToasts'
import { canAffordNode, cpAvailable, mapNodeAvailable, mapNodeVisible, rpAvailable } from '@/game/map'
import type { Derived, GameState, MapNodeDef } from '@/game/types'
import type { GameStore } from '@/state/store'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'
import { BRANCH_META, lockReason, statusOf, type MapSets, type NodeStatus } from './mapLayout'

export { useReducedMotionPref } from '@/components/overlays/ModalBase'

/** Split a `|`-joined key into a Set, memoised by the caller on the key. */
function toSet(key: string): ReadonlySet<string> {
  return new Set(key ? key.split('|') : [])
}

interface SetKeys extends Record<string, string> {
  owned: string
  available: string
  affordable: string
  surfaced: string
}

function selectSetKeys(s: GameState, d: Derived, store: GameStore): SetKeys {
  const catalog = store.catalog
  let available = ''
  let affordable = ''
  let surfaced = ''
  for (const node of catalog.mapNodes) {
    if (node.hidden && mapNodeVisible(node, s, d, catalog)) surfaced += (surfaced ? '|' : '') + node.id
    if (!mapNodeAvailable(node, s, d, catalog)) continue
    available += (available ? '|' : '') + node.id
    if (canAffordNode(node, s, catalog)) affordable += (affordable ? '|' : '') + node.id
  }
  return { owned: s.mapNodes.join('|'), available, affordable, surfaced }
}

/** The four id sets the canvas needs; identity is stable until one of them changes. */
export function useMapSets(): MapSets {
  const keys = useGameShallow(selectSetKeys)
  const owned = useMemo(() => toSet(keys.owned), [keys.owned])
  const available = useMemo(() => toSet(keys.available), [keys.available])
  const affordable = useMemo(() => toSet(keys.affordable), [keys.affordable])
  const surfaced = useMemo(() => toSet(keys.surfaced), [keys.surfaced])
  return useMemo(() => ({ owned, available, affordable, surfaced }), [owned, available, affordable, surfaced])
}

export interface MapBalances {
  credits: number
  rp: number
  cp: number
  /** Nodes unlocked so far. */
  unlocked: number
  /** Nodes drawn on the canvas (hidden ones count once surfaced). */
  total: number
  season: number
}

/** Header counters. Credits are floored so the slice only changes once per whole credit. */
export function useMapBalances(): MapBalances {
  return useGameShallow((s, d, store) => {
    let total = 0
    for (const node of store.catalog.mapNodes) if (mapNodeVisible(node, s, d, store.catalog)) total += 1
    return {
      credits: Math.floor(s.credits),
      rp: rpAvailable(s, store.catalog),
      cp: cpAvailable(s),
      unlocked: s.mapNodes.length,
      total,
      season: s.meta.season,
    }
  })
}

export interface NodeStatusSlice {
  status: NodeStatus
  affordable: boolean
  reason: string
  /** Spendable balance in the node's currency. */
  balance: number
  /** Parent ids that are still locked. */
  missing: string
}

/** Everything the details panel shows for one node, as a small flat slice. */
export function useNodeStatus(def: MapNodeDef | null): NodeStatusSlice {
  const selector = useCallback(
    (s: GameState, d: Derived, store: GameStore): NodeStatusSlice => {
      if (!def) return { status: 'locked', affordable: false, reason: '', balance: 0, missing: '' }
      const catalog = store.catalog
      const owned = new Set(s.mapNodes)
      const available = new Set<string>()
      if (mapNodeAvailable(def, s, d, catalog)) available.add(def.id)
      const sets: MapSets = { owned, available, affordable: new Set(), surfaced: new Set() }
      const status = statusOf(def.id, sets)
      const balance = def.currency === 'credits' ? Math.floor(s.credits) : def.currency === 'rp' ? rpAvailable(s, catalog) : cpAvailable(s)
      return {
        status,
        affordable: status === 'available' && canAffordNode(def, s, catalog),
        reason: lockReason(def, sets, catalog),
        balance,
        missing: def.parents.filter((p) => !owned.has(p)).join('|'),
      }
    },
    [def],
  )
  return useGame(
    selector,
    (a, b) => a.status === b.status && a.affordable === b.affordable && a.reason === b.reason && a.balance === b.balance && a.missing === b.missing,
  )
}

/** Owned / visible counts per branch for the legend, as one string key → memoised record. */
export function useBranchCounts(): Record<string, { owned: number; total: number }> {
  const key = useGame((s, d, store) => {
    const counts: Record<string, [number, number]> = {}
    for (const node of store.catalog.mapNodes) {
      if (!mapNodeVisible(node, s, d, store.catalog)) continue
      const row = (counts[node.branch] ??= [0, 0])
      row[1] += 1
      if (s.mapNodes.includes(node.id)) row[0] += 1
    }
    return Object.entries(counts)
      .map(([b, [o, t]]) => `${b}:${o}/${t}`)
      .join('|')
  })
  return useMemo(() => {
    const out: Record<string, { owned: number; total: number }> = {}
    for (const part of key ? key.split('|') : []) {
      const [branch, nums] = part.split(':')
      const [o, t] = (nums ?? '0/0').split('/')
      if (branch) out[branch] = { owned: Number(o), total: Number(t) }
    }
    return out
  }, [key])
}

/**
 * Unlock a node through the store. On success: a credit burst at `point` (viewport px), a short
 * toast in the branch colour; on refusal: the store's reason as a danger toast. Returns whether
 * it went through so the caller can pop the button.
 */
export function useUnlockNode(): (def: MapNodeDef, point?: { x: number; y: number }) => boolean {
  const store = useGameStore()
  return useCallback(
    (def, point) => {
      const result = store.unlockMapNode(def.id)
      if (result.error) {
        toast(result.error, { title: 'The Graph', tone: 'danger', key: `map:${def.id}` })
        return false
      }
      if (point) fx.burst(point.x, point.y, def.currency === 'credits' ? 10 : 16)
      if (def.branch === 'prestige' || def.currency === 'cp') fx.flash()
      toast(def.title, {
        title: `${BRANCH_META[def.branch].label} · unlocked`,
        description: def.desc,
        tone: def.branch === 'prestige' ? 'sapphire' : 'electric',
        key: `map:${def.id}`,
        durationMs: 3500,
      })
      return true
    },
    [store],
  )
}

// ---------------------------------------------------------------------------
// Canvas interaction context (stable callbacks so node components stay memoised)
// ---------------------------------------------------------------------------

export interface MapInteraction {
  select: (id: string | null) => void
  /** Unlock straight from a node's button; `point` is where the burst should start. */
  unlock: (def: MapNodeDef, point?: { x: number; y: number }) => void
}

const noop = (): void => {}
export const MapInteractionContext = createContext<MapInteraction>({ select: noop, unlock: noop })

export function useMapInteraction(): MapInteraction {
  return useContext(MapInteractionContext)
}
