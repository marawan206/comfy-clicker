/**
 * Framework-agnostic game store. Owns the GameState, the cached Derived,
 * the fixed-step loop, autosave and an event bus for the FX layer.
 * React binds to it through the hooks in `./useGame.ts`.
 */
import { CATALOG } from '@/data'
import type { Catalog, Derived, GameEvent, GameState } from '@/game/types'
import { computeDerived } from '@/game/derived'
import { tick } from '@/game/engine'
import * as actions from '@/game/actions'
import { createInitialState } from '@/game/state'
import { deserialize, serialize } from '@/game/save'
import { applyOffline } from '@/game/offline'
import { startLoop } from '@/game/loop'
import { AUTOSAVE_MS, SAVE_KEY } from '@/game/constants'

export type ActionResult = { events: GameEvent[]; dirty: boolean; error?: string }
type ActionFn = (state: GameState, derived: Derived, catalog: Catalog, now: number, rng: () => number) => ActionResult

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
      const loaded = deserialize(raw, now, guestId())
      if (!loaded) safeStorageSet(`${SAVE_KEY}.corrupt`, raw)
      this.state = loaded ?? createInitialState(now, guestId())
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
      if (events.some(e => e.type === 'achievement' || e.type === 'eventStart' || e.type === 'eventEnd' || e.type === 'contractDone' || e.type === 'signup' || e.type === 'postResolved')) {
        this.derived = computeDerived(this.state, this.catalog)
      }
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

  run(fn: ActionFn): ActionResult {
    const result = fn(this.state, this.derived, this.catalog, Date.now(), Math.random)
    if (result.events.length) this.emit(result.events)
    if (result.dirty) this.derived = computeDerived(this.state, this.catalog)
    this.notify()
    return result
  }

  click = (): ActionResult => this.run((s, d, c, now, rng) => actions.click(s, d, c, now, rng))
  buyHardware = (id: string, n: number | 'max' = 1): ActionResult => this.run((s, d, c, now, rng) => actions.buyHardware(s, d, c, id, n, now, rng))
  buyUpgrade = (id: string): ActionResult => this.run((s, d, c, now, rng) => actions.buyUpgrade(s, d, c, id, now, rng))
  unlockMapNode = (id: string): ActionResult => this.run((s, d, c, now, rng) => actions.unlockMapNode(s, d, c, id, now, rng))
  quantize = (modelId: string, precision: 'fp8' | 'q4'): ActionResult => this.run((s, d, c, now, rng) => actions.quantize(s, d, c, modelId, precision, now, rng))
  setupModel = (modelId: string): ActionResult => this.run((s, d, c, now, rng) => actions.setupModel(s, d, c, modelId, now, rng))
  trainLora = (tagId: string): ActionResult => this.run((s, d, c, now, rng) => actions.trainLora(s, d, c, tagId, now, rng))
  queueJob = (input: actions.QueueJobInput): ActionResult => this.run((s, d, c, now, rng) => actions.queueJob(s, d, c, input, now, rng))
  claimContract = (index: number): ActionResult => this.run((s, d, c, now, rng) => actions.claimContract(s, d, c, index, now, rng))
  claimDaily = (): ActionResult => this.run((s, d, c, now, rng) => actions.claimDaily(s, d, c, now, rng))
  rebrand = (): ActionResult => this.run((s, d, c, now, rng) => actions.rebrand(s, d, c, now, rng))
  resolveEvent = (defId: string): ActionResult => this.run((s, d, c, now, rng) => actions.resolveEvent(s, d, c, defId, now, rng))
  upscalePost = (postId: string): ActionResult => this.run((s, d, c, now, rng) => actions.upscalePost(s, d, c, postId, now, rng))
  toggleSetting = (key: keyof GameState['settings']): ActionResult => this.run((s, d, c, now, rng) => actions.toggleSetting(s, d, c, key, now, rng))
  setFlag = (key: string): void => {
    if (this.state.flags[key]) return
    this.state.flags[key] = true
    this.emit([{ type: 'easterEgg', id: key }])
    this.recompute()
  }
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
