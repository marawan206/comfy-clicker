/**
 * Framework-agnostic game store. Owns the GameState, the cached Derived,
 * the fixed-step loop, autosave and an event bus for the FX layer.
 * React binds to it through the hooks in `./useGame.ts`.
 */
import { CATALOG } from '@/data'
import type { Catalog, Derived, GameEvent, GameState, GiftKind } from '@/game/types'
import { computeDerived } from '@/game/derived'
import { needsDerived, tick } from '@/game/engine'
import * as actions from '@/game/actions'
import type { ActionContext, ActionResult, BuyCount, QueueJobInput } from '@/game/actions'
import { createInitialState } from '@/game/state'
import { loadSave, serialize, SAVE_CORRUPT_KEY } from '@/game/save'
import { applyOffline } from '@/game/offline'
import { startLoop } from '@/game/loop'
import { MANUAL_SAVE_COOLDOWN_MS, SAVE_KEY } from '@/game/constants'
import { autosaveDue, type SaveReason } from '@/state/autosave'
import * as cloud from '@/state/cloudActions'

export type { ActionResult } from '@/game/actions'
export type { SaveReason } from '@/state/autosave'
/** An action bound to a context snapshot; see `GameStore.run`. */
type ActionFn = (ctx: ActionContext) => ActionResult

/**
 * Per-action options. `save: true` means "this action is worth writing to disk", which is every
 * action except the two that fire many times a second: `click` (the interval write covers it, and
 * a click that is only worth a few credits is not worth a serialize) and `resolveEvent` (a click
 * on a broken node in disguise). The interval write still catches both within ten seconds.
 */
interface RunOptions {
  save?: boolean
}

export interface OfflineReport {
  elapsedSec: number
  gain: number
}

type Listener = () => void
type EventListener = (event: GameEvent) => void
type LeaderListener = (leader: boolean) => void

/** Shared literal so every action binding below reads the same. */
const SAVE: RunOptions = { save: true }

// ---- cross-tab leadership ---------------------------------------------------
/**
 * One tab per origin owns `SAVE_KEY`. The owner holds a heartbeat lock in localStorage and every
 * other tab is a follower: it plays normally but never writes the save, never starts cloud sync,
 * and mirrors the leader's blob through the `storage` event. Without a lock the last writer wins
 * unconditionally, so a hidden tab waking up stamps its hour-old state over the tab that was
 * actually being played, and for a signed-in player the two tabs fight over the cloud row.
 */
export const LEADER_KEY = 'comfy-clicker:leader'
/** The leader restamps the lock this often, from the tick: a frozen tab stops restamping by itself. */
export const LEADER_HEARTBEAT_MS = 2_000
/** A lock older than this belongs to a tab that is gone or frozen, so another tab may take it. */
export const LEADER_STALE_MS = 6_000
/** localStorage key naming the account the local save belongs to; absent for a guest run. */
export const SAVE_OWNER_KEY = 'comfy-clicker:save-owner'

interface Lock {
  id: string
  at: number
}

function readLock(): Lock | null {
  const raw = safeStorageGet(LEADER_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { id, at } = parsed as Partial<Lock>
    return typeof id === 'string' && typeof at === 'number' && Number.isFinite(at) ? { id, at } : null
  } catch {
    return null
  }
}

/**
 * Stamp the lock and confirm we still hold it. localStorage has no compare-and-swap, so two tabs
 * claiming in the same millisecond both write; re-reading tells each of them who landed last, and
 * the loser steps back on its next heartbeat. A storage that refuses the write is a storage no
 * other tab can be sharing either (private mode, full quota), so the tab keeps playing as leader
 * and the refused save surfaces through `saveError`.
 */
function stampLock(id: string, at: number): boolean {
  if (!safeStorageSet(LEADER_KEY, JSON.stringify({ id, at }))) return true
  const after = readLock()
  return after === null || after.id === id
}

/** Take the lock unless a live one belongs to another tab. */
function takeLock(id: string, now: number): boolean {
  const lock = readLock()
  if (lock && lock.id !== id && now - lock.at < LEADER_STALE_MS) return false
  return stampLock(id, now)
}

function newTabId(): string {
  return `t_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/**
 * The engine decides what counts as an absence: `applyOffline` emits an `offline` event only past
 * `SHORT_GAP_S`, which is also the only band paid at the idle rate. A shorter gap was a silent
 * full-rate catch-up, so reporting it would tell the player they earned at 50% up to 8 h when
 * they were in fact paid 100% with no cap.
 */
function offlineReportOf(events: GameEvent[]): OfflineReport | null {
  for (const e of events) {
    if (e.type === 'offline') return e.gain > 0 ? { elapsedSec: e.elapsedSec, gain: e.gain } : null
  }
  return null
}

export class GameStore {
  state: GameState
  derived: Derived
  readonly catalog: Catalog
  /** Monotonic counter bumped on every state change; React snapshots this. */
  version = 0
  offlineReport: OfflineReport | null = null
  started = false
  /** Epoch ms of the last successful write; 0 before the first one. */
  savedAt = 0
  /** Why that write happened, for the save-status chip. */
  saveReason: SaveReason | null = null
  /** True when the browser refused the last write (quota, private mode). Cleared by the next success. */
  saveError = false
  /**
   * True while this tab holds the writer lock. A follower plays normally but writes nothing and
   * runs no cloud sync; it mirrors the leader instead (see `onStorage`). Defaults to true so a
   * store that never calls `start()` (tests, SSR) behaves exactly as it did before the lock.
   */
  leader = true
  /** The account this save belongs to; null for a guest run. Set by cloud sync, cleared by `replaceState`. */
  saveOwner: string | null = null
  /** Epoch ms of the last save the player asked for by hand; 0 before the first one. */
  manualSavedAt = 0

  private listeners = new Set<Listener>()
  private eventListeners = new Set<EventListener>()
  private leaderListeners = new Set<LeaderListener>()
  private stopLoop: (() => void) | null = null
  private lastSaveAt = 0
  /** When the state first became unsaved since the last write; null when nothing is pending. */
  private dirtyAt: number | null = null
  private notifyScheduled = false
  /** Identity this tab writes into the lock. */
  private readonly tabId = newTabId()
  private leaderCheckedAt = 0
  /**
   * The tab is going away: keep writing (the cloud flush on `pagehide` asks for one more save)
   * but stop re-stamping the lock we just handed back. Cleared by the next tick, so a page that
   * comes back from the bfcache takes the lock again as soon as it resumes.
   */
  private closing = false

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
  /** Notified whenever this tab takes or loses the writer lock. */
  onLeaderChange = (listener: LeaderListener): (() => void) => {
    this.leaderListeners.add(listener)
    return () => this.leaderListeners.delete(listener)
  }

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

  /**
   * Fan out a settlement produced outside the store. `adoptCloud` runs `applyOffline` on the cloud
   * state before handing it over, and those events are the only trigger for work that lives outside
   * the store: the ComfyHub bridge pays the workflow author on `postResolved`, and every
   * achievement, level-up and milestone toast rides on them.
   */
  emitEvents(events: GameEvent[]): void {
    if (events.length) this.emit(events)
  }

  // ---- lifecycle ----------------------------------------------------------
  /** Load the local save, apply offline progress and start the loop. Browser only. */
  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    const now = Date.now()
    this.setLeader(takeLock(this.tabId, now))
    this.leaderCheckedAt = now
    this.saveOwner = safeStorageGet(SAVE_OWNER_KEY)
    const raw = safeStorageGet(SAVE_KEY)
    if (raw) {
      const { state, corrupt } = loadSave(raw, now, guestId())
      if (corrupt) safeStorageSet(SAVE_CORRUPT_KEY, raw)
      this.state = state
    }
    this.derived = computeDerived(this.state, this.catalog)
    const report = applyOffline(this.state, this.derived, this.catalog, now)
    this.offlineReport = offlineReportOf(report.events) ?? this.offlineReport
    this.emit(report.events)
    this.recompute()

    this.stopLoop = startLoop({
      tick: (dt, now) => this.tick(dt, now),
      render: () => {},
      onLongGap: (_elapsed, now) => {
        // A frozen tab stopped restamping its lock, so settle who owns the save before paying out.
        this.refreshLeader(now)
        const r = applyOffline(this.state, this.derived, this.catalog, now)
        this.offlineReport = offlineReportOf(r.events) ?? this.offlineReport
        this.emit(r.events)
        this.recompute()
      },
    })
    window.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pagehide', this.onHide)
    window.addEventListener('storage', this.onStorage)
    this.notify()
  }

  stop(): void {
    this.stopLoop?.()
    this.stopLoop = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('visibilitychange', this.onVisibility)
      window.removeEventListener('pagehide', this.onHide)
      window.removeEventListener('storage', this.onStorage)
      this.releaseLock()
    }
    this.started = false
  }

  // ---- cross-tab leadership -----------------------------------------------
  private setLeader(next: boolean): boolean {
    if (this.leader !== next) {
      this.leader = next
      for (const l of this.leaderListeners) l(next)
      this.notify()
    }
    return next
  }

  /** Re-take or re-stamp the lock. Called from the tick and before every write. */
  private refreshLeader(now: number): boolean {
    this.closing = false
    this.leaderCheckedAt = now
    return this.setLeader(takeLock(this.tabId, now))
  }

  /** Hand the lock back so the next tab does not have to wait out LEADER_STALE_MS. */
  private releaseLock(): void {
    const lock = readLock()
    if (lock && lock.id === this.tabId) safeStorageRemove(LEADER_KEY)
  }

  /**
   * Another tab wrote the shared save. A follower adopts it rather than drifting: the leader's
   * blob is the run, and a follower that kept its own copy would be telling the player they had
   * progress that is about to be overwritten.
   */
  private onStorage = (e: StorageEvent): void => {
    if (e.key === SAVE_OWNER_KEY) {
      this.saveOwner = e.newValue ?? safeStorageGet(SAVE_OWNER_KEY)
      return
    }
    if (e.key !== SAVE_KEY || this.leader) return
    const raw = e.newValue ?? safeStorageGet(SAVE_KEY)
    if (raw) this.adoptLocal(raw)
  }

  /** Replace this tab's state with the leader's newer blob. No-op for anything not newer. */
  private adoptLocal(raw: string): void {
    const now = Date.now()
    const { state, corrupt } = loadSave(raw, now, this.state.meta.guestId, this.catalog)
    if (corrupt || state.meta.lastSavedAt <= this.state.meta.lastSavedAt) return
    this.state = state
    this.dirtyAt = null
    this.lastSaveAt = state.meta.lastSavedAt
    this.savedAt = state.meta.lastSavedAt
    this.saveError = false
    this.recompute()
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.save('hide')
  }

  /**
   * The tab is going away. This write ignores `settings.autosave`: the setting is about background
   * cadence, and losing a whole session to it would be a bug, not a preference.
   */
  private onHide = (): void => {
    this.save('hide')
    this.releaseLock()
    this.closing = true
  }

  private tick(dt: number, now: number): void {
    const events = tick(this.state, this.derived, this.catalog, dt, now, Math.random)
    if (events.length) {
      this.emit(events)
      if (needsDerived(events)) this.derived = computeDerived(this.state, this.catalog)
    }
    // The 20 Hz tick is the only clock: no timers, no per-action setTimeout to cancel. The lock
    // rides on it too, so a tab whose frames are throttled stops claiming to be the writer.
    if (now - this.leaderCheckedAt >= LEADER_HEARTBEAT_MS) this.refreshLeader(now)
    const due = autosaveDue(now, this.lastSaveAt, this.dirtyAt, this.state.settings.autosave)
    if (due) this.save(due)
    this.notify()
  }

  // ---- persistence --------------------------------------------------------
  /**
   * Milliseconds left on the manual-save cooldown, 0 when a hand-written save is allowed.
   *
   * Holding S wrote the blob (and, signed in, queued a cloud upload) on every key repeat, which is
   * a lot of traffic for a game that already autosaves every ten seconds. The cooldown is on the
   * player's own writes only: the interval, the debounce after an action and the write on tab hide
   * are untouched, so nothing can be lost by pressing the key too often.
   */
  msUntilManualSave(now: number = Date.now()): number {
    if (this.manualSavedAt <= 0) return 0
    return Math.max(0, this.manualSavedAt + MANUAL_SAVE_COOLDOWN_MS - now)
  }

  /**
   * Write the save. Always writes, whatever `settings.autosave` says: the setting decides when the
   * tick asks (see `autosaveDue`), not whether an explicit write is allowed. A refused write is
   * surfaced through `saveError` rather than swallowed, because a player whose browser is quietly
   * dropping every save deserves to be told before they close the tab.
   *
   * Returns false when nothing was written because the manual cooldown is still running; every
   * other path returns true, the browser refusing the write included (that is `saveError`).
   */
  save = (reason: SaveReason = 'manual'): boolean => {
    const now = Date.now()
    if (reason === 'manual') {
      if (this.msUntilManualSave(now) > 0) return false
      this.manualSavedAt = now
    }
    if (!this.claimWrite(reason, now)) {
      // A follower never writes the shared save. Clearing the pending marks keeps the tick from
      // asking again every 50 ms; the leader's next write arrives through `onStorage`.
      this.lastSaveAt = now
      this.dirtyAt = null
      this.notify()
      return true
    }
    this.state.meta.lastSavedAt = now
    const written = safeStorageSet(SAVE_KEY, serialize(this.state))
    this.lastSaveAt = now
    this.dirtyAt = null
    this.saveError = !written
    if (written) {
      this.savedAt = now
      this.saveReason = reason
    }
    this.notify()
    return true
  }

  /**
   * May this tab write the save right now? Background writes need the lock. `manual` and `import`
   * are the player asking this tab specifically (Save now, a pasted code, a hard reset), so they
   * take the lock over; the other tab notices within a heartbeat and mirrors the new blob.
   */
  private claimWrite(reason: SaveReason, now: number): boolean {
    if (typeof window === 'undefined') return true
    // The lock is already handed back; the cloud flush's last save must not take it again.
    if (this.closing) return this.leader
    if (reason === 'manual' || reason === 'import') {
      this.leaderCheckedAt = now
      return this.setLeader(stampLock(this.tabId, now))
    }
    return this.refreshLeader(now)
  }

  /**
   * Replace the whole state (import / cloud load / hard reset). The owner stamp is dropped: a
   * pasted code or a fresh run is nobody's account run until it is uploaded, and leaving a stale
   * stamp on it would make the next sign-in treat it as another player's save.
   */
  replaceState(next: GameState): void {
    this.state = next
    this.dirtyAt = null
    this.setSaveOwner(null)
    this.recompute()
    this.save('import')
  }

  /** Record which account the local save belongs to, next to the save itself. */
  setSaveOwner(userId: string | null): void {
    if (this.saveOwner === userId) return
    this.saveOwner = userId
    if (typeof window === 'undefined') return
    if (userId) safeStorageSet(SAVE_OWNER_KEY, userId)
    else safeStorageRemove(SAVE_OWNER_KEY)
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

  /**
   * Run an action against a fresh context. `opts.save` marks the state unsaved so the next tick
   * writes it `SAVE_DEBOUNCE_MS` later; a burst of purchases therefore costs one write, not ten.
   * A validation failure changed nothing, so it never schedules one.
   */
  run(fn: ActionFn, opts: RunOptions = {}): ActionResult {
    const result = fn(this.context())
    if (result.events.length) this.emit(result.events)
    if (result.dirty) this.derived = computeDerived(this.state, this.catalog)
    if (opts.save && result.error === undefined) this.dirtyAt ??= Date.now()
    this.notify()
    return result
  }

  // `click` and `resolveEvent` are the two that fire many times a second, so they do not schedule
  // a write; the ten-second interval save covers them.
  click = (): ActionResult => this.run((ctx) => actions.click(ctx))
  resolveEvent = (defId: string): ActionResult => this.run((ctx) => actions.resolveEvent(ctx, defId))
  buyHardware = (id: string, n: BuyCount = 1): ActionResult => this.run((ctx) => actions.buyHardware(ctx, id, n), SAVE)
  buyUpgrade = (id: string): ActionResult => this.run((ctx) => actions.buyUpgrade(ctx, id), SAVE)
  unlockMapNode = (id: string): ActionResult => this.run((ctx) => actions.unlockMapNode(ctx, id), SAVE)
  quantize = (modelId: string, precision: 'fp8' | 'q4'): ActionResult => this.run((ctx) => actions.quantize(ctx, modelId, precision), SAVE)
  setupModel = (modelId: string): ActionResult => this.run((ctx) => actions.setupModel(ctx, modelId), SAVE)
  trainLora = (tagId: string): ActionResult => this.run((ctx) => actions.trainLora(ctx, tagId), SAVE)
  queueJob = (input: QueueJobInput): ActionResult => this.run((ctx) => actions.queueJob(ctx, input), SAVE)
  claimContract = (index: number): ActionResult => this.run((ctx) => actions.claimContract(ctx, index), SAVE)
  claimDaily = (): ActionResult => this.run((ctx) => actions.claimDaily(ctx), SAVE)
  rebrand = (): ActionResult => this.run((ctx) => actions.rebrand(ctx), SAVE)
  spin = (wager: number | 'free'): ActionResult => this.run((ctx) => actions.spin(ctx, wager), SAVE)
  flip = (wager: number): ActionResult => this.run((ctx) => actions.flip(ctx, wager), SAVE)
  upscalePost = (postId: string): ActionResult => this.run((ctx) => actions.upscalePost(ctx, postId), SAVE)
  toggleSetting = (key: keyof GameState['settings'], value?: boolean): ActionResult =>
    this.run((ctx) => actions.toggleSetting(ctx, key, value), SAVE)
  setFlag = (key: string): ActionResult => this.run((ctx) => actions.setFlag(ctx, key), SAVE)
  completeTutorial = (): ActionResult => this.run((ctx) => actions.completeTutorial(ctx), SAVE)
  grantGift = (kind: GiftKind): ActionResult => this.run((ctx) => actions.grantGift(ctx, kind), SAVE)
  declineGift = (kind: GiftKind): ActionResult => this.run((ctx) => actions.declineGift(ctx, kind), SAVE)
  // Server-driven actions (src/state/cloudActions.ts): the daily calendar on the server clock and ComfyHub bookkeeping.
  claimDailyFromServer = (claim: cloud.ServerDailyClaim): ActionResult => this.run((ctx) => cloud.claimDailyFromServer(ctx, claim), SAVE)
  markDailyClaimed = (claim: cloud.ServerDailyClaim): ActionResult => this.run((ctx) => cloud.markDailyClaimed(ctx, claim), SAVE)
  recordHubPublish = (workflow?: { id: string; name: string }): ActionResult =>
    this.run((ctx) => cloud.recordHubPublish(ctx, workflow), SAVE)
  applyHubRoyalties = (grant: cloud.HubRoyaltyGrant): ActionResult => this.run((ctx) => cloud.applyHubRoyalties(ctx, grant), SAVE)
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

/** True when the write landed. False means private mode or a full quota; the caller surfaces it. */
function safeStorageSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function safeStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* nothing to do: the key is unreachable, so nobody can read it either */
  }
}

let singleton: GameStore | null = null
/** Module singleton; created lazily so SSR never touches storage. */
export function getGameStore(): GameStore {
  if (!singleton) singleton = new GameStore()
  return singleton
}
