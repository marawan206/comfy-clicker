/**
 * Framework-agnostic game store. Owns the GameState, the cached Derived,
 * the fixed-step loop, autosave and an event bus for the FX layer.
 * React binds to it through the hooks in `./useGame.ts`.
 */
import { CATALOG } from '@/data'
import type { Catalog, Derived, GameEvent, GameState } from '@/game/types'
import { computeDerived } from '@/game/derived'
import { needsDerived, tick } from '@/game/engine'
import * as actions from '@/game/actions'
import type { ActionContext, ActionResult, BuyCount, QueueJobInput } from '@/game/actions'
import { createInitialState } from '@/game/state'
import { loadSave, serialize, SAVE_CORRUPT_KEY } from '@/game/save'
import { applyOffline } from '@/game/offline'
import { startLoop } from '@/game/loop'
import { AUTOSAVE_MS, SAVE_KEY } from '@/game/constants'
import * as cloud from '@/state/cloudActions'

export type { ActionResult } from '@/game/actions'
/** An action bound to a context snapshot; see `GameStore.run`. */
type ActionFn = (ctx: ActionContext) => ActionResult

export interface OfflineReport {
  elapsedSec: number
  gain: number
}

type Listener = () => void
type EventListener = (event: GameEvent) => void

export class GameStore {
  state: GameState
  derived: Derived
  readonly catalog: Catalog
  /** Monotonic counter bumped on every state change; React snapshots this. */
  version = 0
  offlineReport: OfflineReport | null = null
  started = false

  private listeners = new Set<Listener>()
  private eventListeners = new Set<EventListener>()
  private stopLoop: (() => void) | null = null
  private lastSaveAt = 0
  private notifyScheduled = false

  constructor(catalog: Catalog = CATALOG) {
    this.catalog = catalog
    this.state = createInitialState(Date.now(), guestId())
    this.derived = computeDerived(this.state, catalog)
  }

  // ---- subscription -------------------------------------------------------
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  onEvent = (listener: EventListener): (() => void) => {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }
  getVersion = (): number => this.version

  private notify(): void {
    if (this.notifyScheduled) return
    this.notifyScheduled = true
    queueMicrotask(() => {
      this.notifyScheduled = false
      this.version++
      for (const l of this.listeners) l()
    })
  }

  private emit(events: GameEvent[]): void {
    for (const e of events) for (const l of this.eventListeners) l(e)
  }

  // ---- lifecycle ----------------------------------------------------------
  /** Load the local save, apply offline progress and start the loop. Browser only. */
  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    const now = Date.now()
    const raw = safeStorageGet(SAVE_KEY)
    if (raw) {
      const { state, corrupt } = loadSave(raw, now, guestId())
      if (corrupt) safeStorageSet(SAVE_CORRUPT_KEY, raw)
      this.state = state
    }
    this.derived = computeDerived(this.state, this.catalog)
    const report = applyOffline(this.state, this.derived, this.catalog, now)
    if (report.elapsedSec >= 60 && report.gain > 0) this.offlineReport = { elapsedSec: report.elapsedSec, gain: report.gain }
    this.emit(report.events)
    this.recompute()

    this.stopLoop = startLoop({
      tick: (dt, now) => this.tick(dt, now),
      render: () => {},
      onLongGap: (_elapsed, now) => {
        const r = applyOffline(this.state, this.derived, this.catalog, now)
        if (r.elapsedSec >= 60 && r.gain > 0) this.offlineReport = { elapsedSec: r.elapsedSec, gain: r.gain }
        this.emit(r.events)
        this.recompute()
      },
    })
    window.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pagehide', this.save)
    this.notify()
  }

  stop(): void {
    this.stopLoop?.()
    this.stopLoop = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('visibilitychange', this.onVisibility)
      window.removeEventListener('pagehide', this.save)
    }
    this.started = false
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.save()
  }

  private tick(dt: number, now: number): void {
    const events = tick(this.state, this.derived, this.catalog, dt, now, Math.random)
    if (events.length) {
      this.emit(events)
      if (needsDerived(events)) this.derived = computeDerived(this.state, this.catalog)
    }
    if (now - this.lastSaveAt > AUTOSAVE_MS) this.save()
    this.notify()
  }

  // ---- persistence --------------------------------------------------------
  save = (): void => {
    this.state.meta.lastSavedAt = Date.now()
    this.lastSaveAt = this.state.meta.lastSavedAt
    safeStorageSet(SAVE_KEY, serialize(this.state))
  }

  /** Replace the whole state (import / cloud load / hard reset). */
  replaceState(next: GameState): void {
    this.state = next
    this.recompute()
    this.save()
  }

  hardReset(): void {
    this.replaceState(createInitialState(Date.now(), guestId()))
  }

  dismissOffline(): void {
    this.offlineReport = null
    this.notify()
  }

  // ---- actions ------------------------------------------------------------
  recompute(): void {
    this.derived = computeDerived(this.state, this.catalog)
    this.notify()
  }

  /** Everything an action needs, snapshotted once per call so `now` and `rng` are consistent within it. */
  private context(): ActionContext {
    return { state: this.state, derived: this.derived, catalog: this.catalog, now: Date.now(), rng: Math.random }
  }

  run(fn: ActionFn): ActionResult {
    const result = fn(this.context())
    if (result.events.length) this.emit(result.events)
    if (result.dirty) this.derived = computeDerived(this.state, this.catalog)
    this.notify()
    return result
  }

  click = (): ActionResult => this.run((ctx) => actions.click(ctx))
  buyHardware = (id: string, n: BuyCount = 1): ActionResult => this.run((ctx) => actions.buyHardware(ctx, id, n))
  buyUpgrade = (id: string): ActionResult => this.run((ctx) => actions.buyUpgrade(ctx, id))
  unlockMapNode = (id: string): ActionResult => this.run((ctx) => actions.unlockMapNode(ctx, id))
  quantize = (modelId: string, precision: 'fp8' | 'q4'): ActionResult => this.run((ctx) => actions.quantize(ctx, modelId, precision))
  setupModel = (modelId: string): ActionResult => this.run((ctx) => actions.setupModel(ctx, modelId))
  trainLora = (tagId: string): ActionResult => this.run((ctx) => actions.trainLora(ctx, tagId))
  queueJob = (input: QueueJobInput): ActionResult => this.run((ctx) => actions.queueJob(ctx, input))
  claimContract = (index: number): ActionResult => this.run((ctx) => actions.claimContract(ctx, index))
  claimDaily = (): ActionResult => this.run((ctx) => actions.claimDaily(ctx))
  rebrand = (): ActionResult => this.run((ctx) => actions.rebrand(ctx))
  resolveEvent = (defId: string): ActionResult => this.run((ctx) => actions.resolveEvent(ctx, defId))
  upscalePost = (postId: string): ActionResult => this.run((ctx) => actions.upscalePost(ctx, postId))
  toggleSetting = (key: keyof GameState['settings'], value?: boolean): ActionResult =>
    this.run((ctx) => actions.toggleSetting(ctx, key, value))
  setFlag = (key: string): ActionResult => this.run((ctx) => actions.setFlag(ctx, key))
  // Server-driven actions (src/state/cloudActions.ts): the daily calendar on the server clock and ComfyHub bookkeeping.
  claimDailyFromServer = (claim: cloud.ServerDailyClaim): ActionResult => this.run((ctx) => cloud.claimDailyFromServer(ctx, claim))
  markDailyClaimed = (claim: cloud.ServerDailyClaim): ActionResult => this.run((ctx) => cloud.markDailyClaimed(ctx, claim))
  recordHubPublish = (): ActionResult => this.run((ctx) => cloud.recordHubPublish(ctx))
  applyHubRoyalties = (grant: cloud.HubRoyaltyGrant): ActionResult => this.run((ctx) => cloud.applyHubRoyalties(ctx, grant))
  setWeekOverride = (week: number | null): void => {
    this.state.weekOverride = week
    this.recompute()
  }
  setLiveTrending = (tags: string[]): void => {
    this.state.liveTrending = { tags, fetchedAt: Date.now() }
    this.notify()
  }
}

// ---- helpers ----------------------------------------------------------------
function guestId(): string {
  if (typeof window === 'undefined') return 'ssr'
  const key = 'comfy-clicker:guest'
  let id = safeStorageGet(key)
  if (!id) {
    id = `g_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
    safeStorageSet(key, id)
  }
  return id
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable (private mode, quota) — keep playing in memory */
  }
}

let singleton: GameStore | null = null
/** Module singleton; created lazily so SSR never touches storage. */
export function getGameStore(): GameStore {
  if (!singleton) singleton = new GameStore()
  return singleton
}
