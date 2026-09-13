'use client'
/**
 * Store-side selectors. The game loop bumps the store version ≈20 times a second, so every hook
 * here selects either a primitive or a short "key" string and derives the array/objects with
 * `useMemo` only when that key changes. Rows subscribe to their own tiny slice by id.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import { useGame, useGameStore } from '@/state/useGame'
import type { GameStore } from '@/state/store'
import { buildIndex } from '@/game/catalog'
import { bulkCost, maxAffordable, unitCost } from '@/game/economy'
import { saveTarget } from '@/game/goals'
import { explainBuy } from '@/game/guidance'
import { canBuy } from '@/game/hardware'
import { currencyBalance } from '@/game/map'
import { hasUpgrade, isUnlocked } from '@/game/unlock'
import type { Derived, Effect, GameState, HardwareDef, HardwareFamily, UpgradeCategory, UpgradeDef } from '@/game/types'
import type { BuyCount } from '@/game/actions'
import type { Catalog } from '@/data'
import { formatCps, formatNum, formatPct, formatWatts } from '@/game/format'
import { FAMILY_LABELS } from '@/game/state'

type Selector<T> = (state: GameState, derived: Derived, store: GameStore) => T

export const STORE_TAB_EVENT = 'comfy:store-tab'
export type StoreTab = 'hardware' | 'upgrades' | 'models' | 'power'
export const STORE_TABS: readonly StoreTab[] = ['hardware', 'upgrades', 'models', 'power']
export const ROCM_UPGRADE_ID = 'rocm-setup'

/**
 * Payload of the `comfy:store-tab` CustomEvent: a tab id, optionally a hardware family to show and
 * the id of a row to scroll to and ring (`focusId`, matched against a row's `data-id`).
 */
export interface StoreTabEventDetail {
  tab: StoreTab
  family?: HardwareFamily
  focusId?: string
}

/**
 * Ask the store panel to switch tabs. Takes either form:
 *   `openStoreTab('upgrades')`
 *   `openStoreTab({ tab: 'hardware', family: 'nvidia-consumer', focusId: 'rtx-3090' })`
 */
export function openStoreTab(target: StoreTab | StoreTabEventDetail, family?: HardwareFamily): void {
  if (typeof window === 'undefined') return
  const detail: StoreTabEventDetail = typeof target === 'string' ? { tab: target } : { ...target }
  if (family) detail.family = family
  window.dispatchEvent(new CustomEvent<StoreTabEventDetail>(STORE_TAB_EVENT, { detail }))
}

/** How long a highlighted row keeps its electric ring. */
const HIGHLIGHT_MS = 1200
/** The row may not exist for a few frames: the tab, the family chip and the list all swap first. */
const HIGHLIGHT_RETRY_MS = 40
const HIGHLIGHT_TRIES = 25
const HIGHLIGHT_CLASSES = ['ring-2', 'ring-electric-400', 'ring-offset-2', 'ring-offset-charcoal-600', 'z-10'] as const

/**
 * Ring an element electric for about a second. Written straight to the DOM: the row that is being
 * pointed at is usually a memoised child that must not re-render for a decoration.
 */
export function highlightElement(el: HTMLElement | null, ms = HIGHLIGHT_MS): void {
  if (!el) return
  el.classList.add(...HIGHLIGHT_CLASSES)
  window.setTimeout(() => el.classList.remove(...HIGHLIGHT_CLASSES), ms)
}

/**
 * Watches `comfy:store-tab` for a `focusId` and, once the tab has rendered, scrolls that row into
 * view and rings it. Mount it on the scroller that holds the rows; rows carry `data-id`.
 *
 * The row may not exist on the first frame (the tab, the family chip and the list all swap first),
 * so it retries for a few frames before giving up.
 */
export function useHighlight(scope: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let timer = 0
    let tries = 0
    // A timer, not rAF: a store tab can be asked to focus a row while the tab is in the background
    // (a cross-route hand-off lands before the page is looked at), and rAF does not run there.
    const find = (id: string) => {
      const root = scope.current ?? document
      const el = root.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        highlightElement(el)
        return
      }
      if (tries++ > HIGHLIGHT_TRIES) return
      timer = window.setTimeout(() => find(id), HIGHLIGHT_RETRY_MS)
    }
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<StoreTabEventDetail | string>).detail
      const id = typeof detail === 'object' && detail ? detail.focusId : undefined
      if (!id) return
      tries = 0
      window.clearTimeout(timer)
      timer = window.setTimeout(() => find(id), 0)
    }
    window.addEventListener(STORE_TAB_EVENT, onTab)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(STORE_TAB_EVENT, onTab)
    }
  }, [scope])
}

/** True when either the OS or the in-game setting asks for calmer motion. */
export function useReducedMotionPref(): boolean {
  const system = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  return Boolean(system) || setting
}

/**
 * Subscribe to a cheap string key and recompute a heavier value only when that key changes.
 * The key must encode every input the computation reads.
 */
export function useGameKeyed<T>(keyOf: Selector<string>, compute: Selector<T>): T {
  const store = useGameStore()
  const key = useGame(keyOf)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `compute` is a pure function of the store; `key` encodes every input it reads
  return useMemo(() => compute(store.state, store.derived, store), [key, store])
}

/** Split a `|`-joined key into ids, memoised on the key. */
function splitIds(key: string): string[] {
  return key ? key.split('|') : []
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

/** Units whose store unlock condition passes (family locks like ROCm still show, as locked rows). */
function visibleHardware(state: GameState, derived: Derived, catalog: Catalog): HardwareDef[] {
  const out: HardwareDef[] = []
  for (const def of catalog.hardware) if (isUnlocked(def.unlock, state, derived, catalog)) out.push(def)
  return out
}

/** Ids of visible hardware units in catalog (price) order; the array identity is stable until the set changes. */
export function useVisibleHardware(): string[] {
  const key = useGame((s, d, store) => visibleHardware(s, d, store.catalog).map((h) => h.id).join('|'))
  return useMemo(() => splitIds(key), [key])
}

/** Ids of owned units (count > 0) in catalog order. */
export function useOwnedHardware(): string[] {
  const key = useGame((s, _d, store) => {
    let out = ''
    for (const def of store.catalog.hardware) if ((s.hardware[def.id] ?? 0) > 0) out += (out ? '|' : '') + def.id
    return out
  })
  return useMemo(() => splitIds(key), [key])
}

/** Families that have at least one visible unit, in `HARDWARE_FAMILIES` order. */
export function useVisibleFamilies(order: readonly HardwareFamily[]): HardwareFamily[] {
  const key = useGame((s, d, store) => {
    const present = new Set<HardwareFamily>()
    for (const def of visibleHardware(s, d, store.catalog)) present.add(def.family)
    return order.filter((f) => present.has(f)).join('|')
  })
  return useMemo(() => splitIds(key) as HardwareFamily[], [key])
}

/** Whether a hardware family is buyable at all (AMD needs ROCm Setup). */
export function useFamilyUnlocked(family: HardwareFamily): boolean {
  return useGame((_s, d) => d.unlockedFamilies.includes(family))
}

export interface HardwareRowState {
  owned: number
  /** Units the current buy amount would purchase (0 when nothing is affordable at 'max'). */
  count: number
  /** Price of `count` units, or of the next single unit when `count` is 0. */
  cost: number
  affordable: boolean
  /** Non-credit lock (family, unlock condition, cap); null when the only blocker could be credits. */
  lockReason: string | null
  /** Effective credits/s one unit produces right now (rig × family × global multipliers). */
  cpsEach: number
  paybackSec: number
  /** Reached tier (0..4). */
  tier: number
  /** True when this purchase would trip the breaker that is currently off. */
  tripsBreaker: boolean
  /** Units still purchasable under `def.max` (Infinity when uncapped). */
  room: number
}

/** Per-unit rate matching `paybackSec`'s denominator. */
export function unitRate(def: HardwareDef, derived: Derived): number {
  return def.baseCps * (derived.rigMult[def.id] ?? 1) * (derived.familyMult[def.family] ?? 1) * derived.globalMult
}

/**
 * Why a unit cannot be bought regardless of credits, or null. The engine's own words (`canBuy`
 * minus the credits check), so the row, the tooltip and the guidance popover all say the same
 * thing: `Locked · own an 8-core PC` rather than a bare `Locked`.
 */
export function nonCreditLock(def: HardwareDef, state: GameState, derived: Derived, catalog: Catalog): string | null {
  // Credits are always the last cause, so a first cause of anything else is a real lock. The
  // unlocked rows (the common case, run per row per frame) stop after that one pass.
  const cause = explainBuy(def, state, derived, catalog)[0]
  if (!cause || cause.kind === 'credits') return null
  return canBuy(def, state, derived, catalog).reason ?? 'Locked'
}

/** Everything a hardware row renders, selected as a small flat object so it only re-renders on change. */
export function useHardwareRow(id: string, amount: BuyCount): HardwareRowState {
  const selector = useCallback(
    (s: GameState, d: Derived, store: GameStore): HardwareRowState => {
      const def = buildIndex(store.catalog).hardwareById[id]
      if (!def) {
        return { owned: 0, count: 0, cost: 0, affordable: false, lockReason: 'Unknown unit', cpsEach: 0, paybackSec: Infinity, tier: 0, tripsBreaker: false, room: 0 }
      }
      const owned = s.hardware[id] ?? 0
      const room = def.max === undefined ? Infinity : Math.max(0, def.max - owned)
      const lockReason = nonCreditLock(def, s, d, store.catalog)
      let count: number
      if (amount === 'max') count = Math.min(room, maxAffordable(def, owned, s.credits))
      else count = Math.min(room, amount)
      const cost = count > 0 ? bulkCost(def, owned, count) : unitCost(def, owned)
      const affordable = lockReason === null && count > 0 && s.credits >= cost
      const rate = unitRate(def, d)
      const projectedDraw = d.powerDraw + Math.max(1, count) * def.watts
      return {
        owned,
        count,
        cost,
        affordable,
        lockReason,
        cpsEach: rate,
        paybackSec: rate > 0 ? unitCost(def, owned) / rate : Infinity,
        tier: s.hardwareTiers[id] ?? 0,
        tripsBreaker: !d.throttled && projectedDraw > d.powerBudget,
        room,
      }
    },
    [id, amount],
  )
  return useGame(selector, shallowRow)
}

function shallowRow(a: HardwareRowState, b: HardwareRowState): boolean {
  return (
    a.owned === b.owned &&
    a.count === b.count &&
    a.cost === b.cost &&
    a.affordable === b.affordable &&
    a.lockReason === b.lockReason &&
    a.cpsEach === b.cpsEach &&
    a.paybackSec === b.paybackSec &&
    a.tier === b.tier &&
    a.tripsBreaker === b.tripsBreaker &&
    a.room === b.room
  )
}

export interface SaveTarget {
  id: string
  name: string
  family: HardwareFamily
  cost: number
  /** 0..100 integer so the bar re-renders at most a hundred times per target. */
  pct: number
  /** Whole seconds until affordable at the current rate; Infinity when cps is 0. */
  etaSec: number
}

/**
 * The cheapest visible, purchasable-but-unaffordable unit: what the player is implicitly saving for.
 * Null when everything visible is affordable (or locked).
 *
 * A thin wrapper over `saveTarget` in `@/game/goals`, which the Next up panel reads too, so the
 * save-for bar and the goal row can never quote different numbers (a test pins that they match).
 */
export function useSaveTarget(): SaveTarget | null {
  return useGame(
    (s, d, store): SaveTarget | null => {
      const target = saveTarget(s, d, store.catalog)
      if (!target) return null
      return {
        id: target.def.id,
        name: target.def.name,
        family: target.def.family,
        cost: target.cost,
        pct: target.pct,
        etaSec: target.etaSec,
      }
    },
    (a, b) => (a === null && b === null) || (a !== null && b !== null && a.id === b.id && a.cost === b.cost && a.pct === b.pct && a.etaSec === b.etaSec),
  )
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

const TIER_PREFIX = 'tier:'

/** `tier:<hardwareId>:<n>` → { hardwareId, tier } or null for a named upgrade. */
export function parseTierId(id: string): { hardwareId: string; tier: number } | null {
  if (!id.startsWith(TIER_PREFIX)) return null
  const lastColon = id.lastIndexOf(':')
  const hardwareId = id.slice(TIER_PREFIX.length, lastColon)
  const tier = Number(id.slice(lastColon + 1))
  if (!hardwareId || !Number.isInteger(tier) || tier < 1) return null
  return { hardwareId, tier }
}

/**
 * Upgrades the player can see in the store: unlock passes, not owned, and for hardware tiers only
 * the next tier in sequence (buying tier 2 before tier 1 is refused by the game).
 */
export function visibleUpgrades(state: GameState, derived: Derived, catalog: Catalog): UpgradeDef[] {
  const out: UpgradeDef[] = []
  for (const def of catalog.upgrades) {
    if (hasUpgrade(state, def.id)) continue
    const tier = parseTierId(def.id)
    if (tier && tier.tier !== (state.hardwareTiers[tier.hardwareId] ?? 0) + 1) continue
    if (!isUnlocked(def.unlock, state, derived, catalog)) continue
    out.push(def)
  }
  return out
}

/** Ids of visible upgrades in catalog order (named first, then tiers), stable until the set changes. */
export function useVisibleUpgrades(category?: UpgradeCategory): string[] {
  const key = useGame((s, d, store) =>
    visibleUpgrades(s, d, store.catalog)
      .filter((u) => category === undefined || u.category === category)
      .map((u) => u.id)
      .join('|'),
  )
  return useMemo(() => splitIds(key), [key])
}

export interface UpgradeRowState {
  affordable: boolean
  cost: number
  currency: 'credits' | 'rp' | 'cp'
  /** Owned count of the hardware a tier upgrade multiplies (0 for named upgrades). */
  ownedHw: number
}

export function useUpgradeRow(id: string): UpgradeRowState {
  const selector = useCallback(
    (s: GameState, _d: Derived, store: GameStore): UpgradeRowState => {
      const def = buildIndex(store.catalog).upgradeById[id]
      if (!def) return { affordable: false, cost: 0, currency: 'credits', ownedHw: 0 }
      const currency = def.currency ?? 'credits'
      const cost = Math.max(0, Math.ceil(def.cost))
      const tier = parseTierId(id)
      return {
        affordable: currencyBalance(s, currency, store.catalog) >= cost,
        cost,
        currency,
        ownedHw: tier ? (s.hardware[tier.hardwareId] ?? 0) : 0,
      }
    },
    [id],
  )
  return useGame(selector, (a, b) => a.affordable === b.affordable && a.cost === b.cost && a.currency === b.currency && a.ownedHw === b.ownedHw)
}

export interface AffordableCounts {
  hardware: number
  upgrades: number
}

/** How many visible hardware units (one each) and upgrades are affordable right now. Drives tab badges. */
export function useAffordableCounts(): AffordableCounts {
  return useGame(
    (s, d, store): AffordableCounts => {
      let hardware = 0
      for (const def of visibleHardware(s, d, store.catalog)) {
        if (nonCreditLock(def, s, d, store.catalog)) continue
        if (unitCost(def, s.hardware[def.id] ?? 0) <= s.credits) hardware += 1
      }
      let upgrades = 0
      for (const def of visibleUpgrades(s, d, store.catalog)) {
        const currency = def.currency ?? 'credits'
        if (currencyBalance(s, currency, store.catalog) >= Math.ceil(def.cost)) upgrades += 1
      }
      return { hardware, upgrades }
    },
    (a, b) => a.hardware === b.hardware && a.upgrades === b.upgrades,
  )
}

/** Human-readable order and labels for upgrade groups. */
export const UPGRADE_CATEGORIES: readonly { id: UpgradeCategory; label: string; blurb: string }[] = [
  { id: 'click', label: 'Clicking', blurb: 'Make every Generate count.' },
  { id: 'power', label: 'Power & cooling', blurb: 'Bigger breakers, faster tiers.' },
  { id: 'hardware', label: 'Hardware tiers', blurb: 'Double a unit once you own enough of them.' },
  { id: 'global', label: 'Production', blurb: 'Everything earns more.' },
  { id: 'studio', label: 'Studio', blurb: 'Faster queues, fewer flops.' },
  { id: 'social', label: 'Social', blurb: 'Reach, likes and payouts.' },
  { id: 'rocm', label: 'ROCm', blurb: 'Compiles for forty minutes. Unlocks Radeons.' },
  { id: 'offline', label: 'Offline', blurb: 'The queue keeps running while you sleep.' },
]

/** One-line effect summary for an upgrade row, e.g. `+10% all production · +4 h offline cap`. */
export function summarizeEffects(effects: readonly Effect[], catalog: Catalog): string {
  const { hardwareById } = buildIndex(catalog)
  const parts: string[] = []
  for (const e of effects) {
    switch (e.kind) {
      case 'clickFlat':
        parts.push(`+${formatNum(e.value)} per click`)
        break
      case 'clickMult':
        parts.push(`clicks ×${e.value}`)
        break
      case 'clickCpsPct':
        parts.push(`clicks +${Math.round(e.value * 100)}% of cps`)
        break
      case 'rigMult':
        parts.push(`${hardwareById[e.hardwareId]?.short ?? e.hardwareId} ×${e.value}`)
        break
      case 'familyMult':
        parts.push(`${FAMILY_LABELS[e.family]} ×${e.value}`)
        break
      case 'globalMult':
        parts.push(`${formatPct(e.value)} all production`)
        break
      case 'likesMult':
        parts.push(`likes ×${e.value}`)
        break
      case 'speedMult':
        parts.push(`gen time ×${e.value}`)
        break
      case 'concurrency':
        parts.push(`+${e.value} concurrent job${e.value === 1 ? '' : 's'}`)
        break
      case 'offlineCapHours':
        parts.push(`+${e.value} h offline cap`)
        break
      case 'offlineEfficiency':
        parts.push(`offline at ${Math.round(e.value * 100)}%`)
        break
      case 'powerBudget':
        parts.push(`+${formatWatts(e.value)} budget`)
        break
      case 'payoutRatio':
        parts.push(`${formatPct(e.value)} payout`)
        break
      case 'followRate':
        parts.push(`followers ×${e.value}`)
        break
      case 'viralChance':
        parts.push(`${formatPct(e.value)} viral`)
        break
      case 'flopChance':
        parts.push(`${formatPct(-e.value)} flop`)
        break
      case 'unlockFamily':
        parts.push(`unlocks ${FAMILY_LABELS[e.family]} cards`)
        break
      case 'zluda':
        parts.push('ZLUDA on AMD')
        break
      case 'apiNodes':
        parts.push('API Nodes')
        break
      case 'hashtagResearch':
        parts.push('reveals trending tags')
        break
      case 'streakGrace':
        parts.push('streak grace day')
        break
      case 'reservedCapacity':
        parts.push('spot-proof capacity')
        break
      case 'coolingTier':
        parts.push(`${FAMILY_LABELS[e.family]} +${e.value} speed tier`)
        break
      case 'tagLikes':
        parts.push(`#${e.tag} likes ${formatPct(e.value)}`)
        break
      case 'familyGenTime':
        parts.push(`${e.family} gen time ×${e.value}`)
        break
      case 'weekSpeed':
        parts.push(`weeks ×${e.value} faster`)
        break
      case 'startHardware':
        parts.push(`start with ${e.count}× ${hardwareById[e.hardwareId]?.short ?? e.hardwareId}`)
        break
      case 'cpMult':
        parts.push(`CP bonus ×${e.value}`)
        break
      default: {
        const never: never = e
        return never
      }
    }
  }
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Rack
// ---------------------------------------------------------------------------

export interface RigRowState {
  count: number
  tier: number
  /** Effective credits/s per unit right now. */
  cpsEach: number
  /** Rig multiplier from tiers/events (0 when a spot instance was reclaimed). */
  rigMult: number
  /** Next tier threshold, or null when all four tiers are reached. */
  nextTierAt: number | null
  /** True when the next tier upgrade can be bought right now (unlock passes, credits aside). */
  nextTierReady: boolean
}

export function useRigRow(id: string): RigRowState {
  const selector = useCallback(
    (s: GameState, d: Derived, store: GameStore): RigRowState => {
      const def = buildIndex(store.catalog).hardwareById[id]
      const count = s.hardware[id] ?? 0
      const tier = s.hardwareTiers[id] ?? 0
      if (!def) return { count, tier, cpsEach: 0, rigMult: 1, nextTierAt: null, nextTierReady: false }
      const nextDef = buildIndex(store.catalog).upgradeById[`tier:${id}:${tier + 1}`]
      const nextCond = nextDef?.unlock
      const nextTierAt = nextCond && nextCond.type === 'ownHardware' ? (nextCond.count ?? 1) : null
      return {
        count,
        tier,
        cpsEach: unitRate(def, d),
        rigMult: d.rigMult[id] ?? 1,
        nextTierAt,
        nextTierReady: nextDef !== undefined && isUnlocked(nextDef.unlock, s, d, store.catalog),
      }
    },
    [id],
  )
  return useGame(
    selector,
    (a, b) =>
      a.count === b.count &&
      a.tier === b.tier &&
      a.cpsEach === b.cpsEach &&
      a.rigMult === b.rigMult &&
      a.nextTierAt === b.nextTierAt &&
      a.nextTierReady === b.nextTierReady,
  )
}

export interface FamilyDraw {
  family: HardwareFamily
  units: number
  watts: number
  /** Share of total draw, 0..1. */
  share: number
  cps: number
}

/** Watts and cps per hardware family for the power breakdown; recomputed only when counts change. */
export function useFamilyDraw(): FamilyDraw[] {
  return useGameKeyed(
    (s, d, store) => {
      let key = ''
      for (const def of store.catalog.hardware) {
        const n = s.hardware[def.id] ?? 0
        if (n > 0) key += `${def.id}:${n}|`
      }
      return `${key}#${d.globalMult}#${Object.values(d.rigMult).join(',')}`
    },
    (s, d, store) => {
      const map = new Map<HardwareFamily, FamilyDraw>()
      let total = 0
      for (const def of store.catalog.hardware) {
        const n = s.hardware[def.id] ?? 0
        if (n <= 0) continue
        const row = map.get(def.family) ?? { family: def.family, units: 0, watts: 0, share: 0, cps: 0 }
        row.units += n
        row.watts += n * def.watts
        row.cps += n * unitRate(def, d)
        total += n * def.watts
        map.set(def.family, row)
      }
      const rows = [...map.values()]
      for (const r of rows) r.share = total > 0 ? r.watts / total : 0
      rows.sort((a, b) => b.watts - a.watts)
      return rows
    },
  )
}

/** Formatted per-unit rate for row copy, e.g. `+12.5/s`. */
export function formatEach(cps: number): string {
  return `+${formatCps(cps)}`
}

// ---------------------------------------------------------------------------
// Local persistence (per-browser conveniences; never game state)
// ---------------------------------------------------------------------------

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode / quota: the preference just does not stick */
  }
}

/*
 * A tiny external store over localStorage so components can read it with `useSyncExternalStore`
 * (SSR renders the default, the client swaps in the stored value on hydration, no effects needed).
 * Values are mirrored in memory so a blocked localStorage still behaves like state for the session.
 */
const localMemory = new Map<string, string | null>()
const localSubs = new Map<string, Set<() => void>>()

function localGet(key: string): string | null {
  const cached = localMemory.get(key)
  if (cached !== undefined) return cached
  const value = readLocal(key)
  localMemory.set(key, value)
  return value
}

function localSet(key: string, value: string): void {
  localMemory.set(key, value)
  writeLocal(key, value)
  localSubs.get(key)?.forEach((cb) => cb())
}

function localSubscribe(key: string, cb: () => void): () => void {
  let subs = localSubs.get(key)
  if (!subs) {
    subs = new Set()
    localSubs.set(key, subs)
  }
  subs.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== key) return
    localMemory.delete(key)
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    subs.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

const getNull = (): null => null

/** Raw stored string for `key` (null when unset); `null` during SSR and hydration. */
function useLocalRaw(key: string): string | null {
  const subscribe = useCallback((cb: () => void) => localSubscribe(key, cb), [key])
  const getSnapshot = useCallback(() => localGet(key), [key])
  return useSyncExternalStore(subscribe, getSnapshot, getNull)
}

/** A string preference mirrored to localStorage; the server and first client render both show `initial`. */
export function useLocalState<T extends string>(key: string, initial: T, valid?: readonly T[]): [T, (next: T) => void] {
  const raw = useLocalRaw(key)
  const value = raw !== null && (!valid || (valid as readonly string[]).includes(raw)) ? (raw as T) : initial
  const set = useCallback((next: T) => localSet(key, next), [key])
  return [value, set]
}

/**
 * Tracks which ids the player has already seen so a row can pulse "new!" the first time it shows up.
 * On the very first visit every currently visible id is marked seen silently (no wall of badges).
 */
export function useNewIds(visible: readonly string[], storageKey: string): { isNew: (id: string) => boolean; markSeen: (id: string) => void } {
  const raw = useLocalRaw(storageKey)
  const seen = useMemo(() => (raw === null ? null : new Set(raw ? raw.split('|') : [])), [raw])

  // First visit: baseline the current shelf so the player is not greeted by a wall of badges.
  useEffect(() => {
    if (localGet(storageKey) === null) localSet(storageKey, visible.join('|'))
  }, [visible, storageKey])

  const isNew = useCallback((id: string) => seen !== null && !seen.has(id), [seen])
  const markSeen = useCallback(
    (id: string) => {
      const current = localGet(storageKey)
      const set = new Set(current ? current.split('|') : [])
      if (set.has(id)) return
      set.add(id)
      localSet(storageKey, [...set].join('|'))
    },
    [storageKey],
  )
  return { isNew, markSeen }
}
