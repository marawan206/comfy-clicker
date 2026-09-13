/**
 * Cloud saves. Sits beside the local autosave in `store.ts` and never replaces it: the local
 * blob is always written first, the cloud row is a copy of it, and nothing here ever blocks the
 * loop on the network.
 *
 * Only the tab holding the writer lock syncs. A follower tab owns neither the local save nor the
 * cloud row, and two tabs each holding their own `cloudSavedAt` refuse each other's conditional
 * updates roughly once a minute, which surfaces as the destructive merge question.
 *
 * The local blob is stamped with the account it belongs to (`GameStore.saveOwner`). A stamp naming
 * someone else is the previous player's run on a shared browser: it is already in that account's
 * row, so it is never offered to the new account as "this device".
 *
 * On sign-in:
 *   - no cloud row            → upload the local save (guest → account keeps the guest run)
 *   - cloud row this device wrote last (same `saved_at` as our receipt) → local is newer, upload
 *   - local save is fresh     → adopt the cloud save silently (new device)
 *   - both real and different → ask (`comfy:cloud-merge` event → CloudMergeModal), default to the
 *                                higher lifetime credits
 * Adopting a cloud save runs `applyOffline` from the cloud's `lastTickAt` before `replaceState`,
 * so the welcome-back card reports the time since the other device stopped ticking.
 *
 * Afterwards: upload every CLOUD_SYNC_MS while dirty, and when the tab hides / unloads. Nothing
 * uploads until the sign-in decision above is made, so a tab switch while the merge question is
 * open cannot answer it. Every upload is conditional on the row's `saved_at` still being the one
 * this session last read or wrote: when another device wrote in between, the write is refused,
 * the row is re-read and the merge question is asked instead of overwriting.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeDerived } from '@/game/derived'
import { SAVE_VERSION } from '@/game/constants'
import { applyOffline } from '@/game/offline'
import { loadSave, serialize } from '@/game/save'
import type { GameState } from '@/game/types'
import type { Database, Json, SaveRow } from '@/server/supabase/types'
import { getGameStore, type GameStore } from '@/state/store'
import { getSupabaseBrowserClient } from '@/server/supabase/client'

export type CloudSyncStatus = 'offline' | 'syncing' | 'synced' | 'error'
export type MergeChoice = 'cloud' | 'local'

export interface SaveSummary {
  source: MergeChoice
  lifetimeCredits: number
  cps: number
  followers: number
  season: number
  playedSec: number
  /** Epoch ms of the save's last write. */
  savedAt: number
}

export interface CloudMergeRequest {
  local: SaveSummary
  cloud: SaveSummary
  /** The side the modal should preselect (higher lifetime credits). */
  suggested: MergeChoice
  choose: (choice: MergeChoice) => void
}

/** `window` event carrying a `CloudMergeRequest` in `detail`. */
export const CLOUD_MERGE_EVENT = 'comfy:cloud-merge'
/**
 * `window` event fired with a boolean `detail` whenever the sign-in decision flips: true right
 * after the upload / adopt / merge question is settled, false when the session ends. Anything that
 * must not read the state until the cloud save has had its say (the welcome gift) waits for it.
 */
export const CLOUD_DECIDED_EVENT = 'comfy:cloud-decided'
/** Upload cadence while the save is dirty. */
export const CLOUD_SYNC_MS = 60_000
/** localStorage receipt of the last row this device wrote: `{ userId, savedAt }`. */
const RECEIPT_KEY = 'comfy-clicker:cloud'
/** Postgres unique_violation: an insert raced another device's first upload. */
const UNIQUE_VIOLATION = '23505'

type CloudClient = SupabaseClient<Database>
type Listener = () => void

// ---------------------------------------------------------------------------
// Status store (read by `useCloudSync` in components/auth/useAuth.ts)
// ---------------------------------------------------------------------------
let status: CloudSyncStatus = 'offline'
let pendingMerge: CloudMergeRequest | null = null
const listeners = new Set<Listener>()

function setStatus(next: CloudSyncStatus): void {
  if (status === next) return
  status = next
  for (const l of listeners) l()
}

export function getCloudSyncSnapshot(): CloudSyncStatus {
  return status
}

export function subscribeCloudSync(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A merge question nobody has answered yet (for a modal that mounts after the event fired). */
export function getPendingMerge(): CloudMergeRequest | null {
  return pendingMerge
}

let cloudDecided = false

/**
 * True once this sign-in has decided what happens to the local run (uploaded it, adopted the cloud
 * save or had the merge question answered). False while signed out or still deciding: the state a
 * component reads before that can be a throwaway run the cloud save is about to replace.
 */
export function getCloudDecided(): boolean {
  return cloudDecided
}

function setCloudDecided(next: boolean): void {
  if (cloudDecided === next) return
  cloudDecided = next
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<boolean>(CLOUD_DECIDED_EVENT, { detail: next }))
  }
}

// ---------------------------------------------------------------------------
// Sync session
// ---------------------------------------------------------------------------
interface SyncSession {
  userId: string
  /** The upload in progress, so callers coalesce instead of racing or dropping. */
  inFlight: Promise<boolean> | null
  /** One follow-up upload queued behind `inFlight` (the state changed meanwhile). */
  queued: Promise<boolean> | null
  lastFingerprint: string
  /** `saved_at` of the cloud row this session last read or wrote; null when no row exists yet. */
  cloudSavedAt: string | null
  /** The sign-in decision (upload / adopt / merge) is made; periodic and unload uploads may run. */
  decided: boolean
  /** A merge question is open; nothing uploads until it is answered. */
  merging: boolean
  timer: number | null
}

interface Ctx {
  store: GameStore
  supabase: CloudClient
  session: SyncSession | null
  stop: () => void
}

let active: Ctx | null = null

/**
 * Watches the auth session and keeps `saves` in step with the store. Returns a stop function.
 * Calling it twice replaces the earlier watcher.
 */
export function startCloudSync(store: GameStore, supabase: CloudClient): () => void {
  active?.stop()
  const ctx: Ctx = { store, supabase, session: null, stop: () => {} }
  active = ctx

  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user.id ?? null
    // Supabase asks that no client calls run inside the callback itself; defer one tick.
    window.setTimeout(() => {
      if (active !== ctx) return
      if (!uid) {
        endSession(ctx)
        return
      }
      if (ctx.session?.userId === uid) return
      endSession(ctx)
      void beginSession(ctx, uid)
    }, 0)
  })

  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flush(ctx)
  }
  const onPageHide = () => {
    void flush(ctx)
  }
  window.addEventListener('visibilitychange', onHidden)
  window.addEventListener('pagehide', onPageHide)

  ctx.stop = () => {
    sub.subscription.unsubscribe()
    window.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('pagehide', onPageHide)
    endSession(ctx)
    if (active === ctx) active = null
  }
  return ctx.stop
}

let ensured = false
let awaitingLock: (() => void) | null = null
/**
 * Starts cloud sync once per page for the singleton store and browser client (no-op without
 * Supabase). A follower tab starts nothing: the tab that owns the local save owns the cloud row
 * too. If this tab later takes the lock over (the other one closed), sync starts then.
 */
export function ensureCloudSync(): void {
  if (ensured || typeof window === 'undefined') return
  const store = getGameStore()
  if (!store.leader) {
    awaitingLock ??= store.onLeaderChange((leader) => {
      if (leader) ensureCloudSync()
    })
    return
  }
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return
  ensured = true
  awaitingLock?.()
  awaitingLock = null
  startCloudSync(store, supabase)
}

/**
 * Upload right now (the "Save to cloud now" menu item). Resolves false when signed out, before
 * the sign-in decision, or while a merge question is open.
 */
export async function saveToCloudNow(): Promise<boolean> {
  const ctx = active
  const session = ctx?.session
  if (!ctx || !session || !ready(ctx, session)) return false
  return upload(ctx, session)
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
/**
 * `ctx.store.leader` is in here because a tab that lost the writer lock is a mirror of another
 * tab's state: uploading from it would push a stale or duplicated run and then lose the
 * conditional update to the real writer, which is what raises the merge question every minute.
 */
function ready(ctx: Ctx, session: SyncSession): boolean {
  return ctx.session === session && session.decided && !session.merging && ctx.store.leader
}

function endSession(ctx: Ctx): void {
  const s = ctx.session
  if (!s) return
  if (s.timer !== null) window.clearInterval(s.timer)
  ctx.session = null
  setCloudDecided(false)
  if (pendingMerge) {
    pendingMerge = null
    for (const l of listeners) l()
  }
  setStatus('offline')
}

async function beginSession(ctx: Ctx, userId: string): Promise<void> {
  const session: SyncSession = {
    userId,
    inFlight: null,
    queued: null,
    lastFingerprint: '',
    cloudSavedAt: null,
    decided: false,
    merging: false,
    timer: null,
  }
  ctx.session = session
  setStatus('syncing')

  let row: SaveRow | null = null
  try {
    const { data, error } = await ctx.supabase.from('saves').select('*').eq('user_id', userId).maybeSingle()
    if (error) throw error
    row = data
  } catch {
    // Unreachable: keep playing locally and retry the whole decision on the next interval.
    if (ctx.session !== session) return
    setStatus('error')
    session.timer = window.setInterval(() => {
      if (ctx.session !== session) return
      window.clearInterval(session.timer ?? undefined)
      session.timer = null
      ctx.session = null
      void beginSession(ctx, userId)
    }, CLOUD_SYNC_MS)
    return
  }
  if (ctx.session !== session) return
  session.cloudSavedAt = row?.saved_at ?? null

  const receipt = readReceipt()
  const local = summarize(ctx.store.state, ctx.store.derived.cps, 'local')
  // The stamp is written only after a successful upload or adopt, so the run it names is already
  // in that account's row. Claiming it for this account would hand one player another's progress
  // and, with `suggested` picked on lifetime credits alone, let one Enter overwrite a real save.
  const foreign = ctx.store.saveOwner !== null && ctx.store.saveOwner !== userId

  if (foreign) {
    if (row) adoptCloud(ctx, session, row)
    else {
      // A brand new account on a browser the previous player left signed out: start it clean
      // rather than adopting their run.
      ctx.store.hardReset()
      await upload(ctx, session)
    }
  } else if (!row) {
    await upload(ctx, session)
  } else if (receipt && receipt.userId === userId && sameInstant(receipt.savedAt, row.saved_at)) {
    // The row is our own last upload; this device has only moved forward since.
    await upload(ctx, session)
  } else if (isFreshRun(ctx.store.state)) {
    adoptCloud(ctx, session, row)
  } else {
    const cloud = summarizeRow(row)
    if (sameSave(local, cloud)) {
      adoptCloud(ctx, session, row)
    } else {
      const choice = await askMerge(ctx, session, local, cloud)
      if (ctx.session !== session) return
      if (choice === 'cloud') adoptCloud(ctx, session, row)
      else await upload(ctx, session)
    }
  }
  if (ctx.session !== session) return
  session.decided = true
  setCloudDecided(true)
  schedule(ctx, session)
}

function schedule(ctx: Ctx, session: SyncSession): void {
  if (session.timer !== null) return
  session.timer = window.setInterval(() => {
    if (!ready(ctx, session)) return
    if (fingerprint(ctx.store.state) !== session.lastFingerprint) void upload(ctx, session)
  }, CLOUD_SYNC_MS)
}

async function flush(ctx: Ctx): Promise<void> {
  const session = ctx.session
  if (!session || !ready(ctx, session) || fingerprint(ctx.store.state) === session.lastFingerprint) return
  await upload(ctx, session)
}

// ---------------------------------------------------------------------------
// Upload / adopt
// ---------------------------------------------------------------------------
/** Coalescing entry point: one upload at a time, and at most one more queued behind it. */
function upload(ctx: Ctx, session: SyncSession): Promise<boolean> {
  if (session.inFlight) {
    session.queued ??= session.inFlight.then(
      () => {
        session.queued = null
        return ctx.session === session ? upload(ctx, session) : false
      },
      () => false,
    )
    return session.queued
  }
  const run = runUpload(ctx, session).finally(() => {
    session.inFlight = null
  })
  session.inFlight = run
  return run
}

async function runUpload(ctx: Ctx, session: SyncSession): Promise<boolean> {
  setStatus('syncing')
  const { store } = ctx
  store.save()
  const state = store.state
  const print = fingerprint(state)
  const payload = {
    version: SAVE_VERSION,
    state: JSON.parse(serialize(state)) as Json,
    cps: finite(store.derived.cps),
    lifetime_credits: finite(Math.floor(state.lifetimeCredits)),
    followers: finite(Math.floor(state.followers)),
    season: Math.max(1, Math.floor(state.meta.season)),
    saved_at: new Date().toISOString(),
  }
  try {
    let written: string | null = null
    if (session.cloudSavedAt === null) {
      const { data, error } = await ctx.supabase
        .from('saves')
        .insert({ user_id: session.userId, ...payload })
        .select('saved_at')
        .single()
      if (error && error.code !== UNIQUE_VIOLATION) throw error
      if (!error) written = data.saved_at
    } else {
      // Conditional on the row still being the one we last saw: another device's write refuses this one.
      const { data, error } = await ctx.supabase
        .from('saves')
        .update(payload)
        .eq('user_id', session.userId)
        .eq('saved_at', session.cloudSavedAt)
        .select('saved_at')
      if (error) throw error
      written = data?.[0]?.saved_at ?? null
    }
    if (written === null) return await resolveConflict(ctx, session)

    session.cloudSavedAt = written
    session.lastFingerprint = print
    store.setSaveOwner(session.userId)
    writeReceipt({ userId: session.userId, savedAt: written })
    if (ctx.session === session) setStatus('synced')
    return true
  } catch {
    if (ctx.session === session) setStatus('error')
    return false
  }
}

/**
 * The cloud row moved under us (another device is signed in). Re-read it; when it is the same
 * run a few seconds apart, take its `saved_at` and write again; otherwise ask, exactly as at
 * sign-in. Runs inside `runUpload`, so nothing else uploads while the question is open.
 */
async function resolveConflict(ctx: Ctx, session: SyncSession): Promise<boolean> {
  const { data: row, error } = await ctx.supabase.from('saves').select('*').eq('user_id', session.userId).maybeSingle()
  if (error) throw error
  if (ctx.session !== session) return false
  if (!row) {
    // The row vanished (deleted elsewhere): insert fresh.
    session.cloudSavedAt = null
    return runUpload(ctx, session)
  }
  const local = summarize(ctx.store.state, ctx.store.derived.cps, 'local')
  const cloud = summarizeRow(row)
  if (sameSave(local, cloud)) {
    session.cloudSavedAt = row.saved_at
    return runUpload(ctx, session)
  }
  session.merging = true
  setStatus('syncing')
  const choice = await askMerge(ctx, session, local, cloud)
  session.merging = false
  if (ctx.session !== session) return false
  if (choice === 'cloud') {
    adoptCloud(ctx, session, row)
    return true
  }
  session.cloudSavedAt = row.saved_at
  return runUpload(ctx, session)
}

function adoptCloud(ctx: Ctx, session: SyncSession, row: SaveRow): void {
  const { store } = ctx
  const now = Date.now()
  const raw = typeof row.state === 'string' ? row.state : JSON.stringify(row.state)
  const { state, corrupt } = loadSave(raw, now, store.state.meta.guestId, store.catalog)
  session.cloudSavedAt = row.saved_at
  if (corrupt) {
    // A blob we cannot read must not overwrite a run we can; keep local and overwrite the cloud.
    void upload(ctx, session)
    return
  }
  const derived = computeDerived(state, store.catalog)
  const report = applyOffline(state, derived, store.catalog, now)
  store.replaceState(state)
  store.setSaveOwner(session.userId)
  // Emit after `replaceState`, so a subscriber that looks the settled post up by id (the ComfyHub
  // royalty bridge) finds it. These events are the only report the gap produces: without them an
  // adopted save settles its posts without paying the workflow author, and every achievement,
  // level-up and milestone the gap crossed happens in silence.
  store.emitEvents(report.events)
  const offline = report.events.find((e) => e.type === 'offline')
  if (offline && offline.gain > 0) {
    store.offlineReport = { elapsedSec: offline.elapsedSec, gain: offline.gain }
  }
  store.recompute()
  session.lastFingerprint = fingerprint(store.state)
  writeReceipt({ userId: session.userId, savedAt: row.saved_at })
  setStatus('synced')
}

function askMerge(ctx: Ctx, session: SyncSession, local: SaveSummary, cloud: SaveSummary): Promise<MergeChoice> {
  return new Promise((resolve) => {
    let settled = false
    const request: CloudMergeRequest = {
      local,
      cloud,
      suggested: cloud.lifetimeCredits > local.lifetimeCredits ? 'cloud' : 'local',
      choose: (choice) => {
        if (settled) return
        settled = true
        if (pendingMerge === request) pendingMerge = null
        for (const l of listeners) l()
        resolve(ctx.session === session ? choice : 'local')
      },
    }
    pendingMerge = request
    for (const l of listeners) l()
    window.dispatchEvent(new CustomEvent<CloudMergeRequest>(CLOUD_MERGE_EVENT, { detail: request }))
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function finite(n: number): number {
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Cheap change detector: income, play time and purchase counts move on anything worth uploading.
 * The flag count is in there because raising a flag can be the only thing that changed (declining
 * the welcome gift, an easter egg), and without it that answer would never reach the cloud and the
 * next device would ask again.
 */
function fingerprint(s: GameState): string {
  return [
    Math.floor(s.lifetimeCredits),
    Math.floor(s.meta.playedSec),
    s.totalClicks,
    s.upgrades.length,
    s.mapNodes.length,
    s.achievements.length,
    s.posts.length,
    s.meta.season,
    s.daily.lastClaimDay ?? '',
    s.hubRep,
    s.stats.hubPublished,
    Object.keys(s.flags).length,
  ].join('|')
}

/** A run that has barely started; adopting the cloud save over it loses nothing worth asking about. */
function isFreshRun(s: GameState): boolean {
  return s.lifetimeCredits < 500 && s.meta.playedSec < 120 && s.totalClicks < 50 && s.meta.season === 1
}

function summarize(s: GameState, cps: number, source: MergeChoice): SaveSummary {
  return {
    source,
    lifetimeCredits: s.lifetimeCredits,
    cps,
    followers: s.followers,
    season: s.meta.season,
    playedSec: s.meta.playedSec,
    savedAt: s.meta.lastSavedAt,
  }
}

function summarizeRow(row: SaveRow): SaveSummary {
  const state = typeof row.state === 'object' && row.state !== null && !Array.isArray(row.state) ? row.state : {}
  const meta = typeof state.meta === 'object' && state.meta !== null && !Array.isArray(state.meta) ? state.meta : {}
  const playedSec = typeof meta.playedSec === 'number' ? meta.playedSec : 0
  const savedAt = Date.parse(row.saved_at)
  return {
    source: 'cloud',
    lifetimeCredits: Number(row.lifetime_credits) || 0,
    cps: Number(row.cps) || 0,
    followers: Number(row.followers) || 0,
    season: Number(row.season) || 1,
    playedSec,
    savedAt: Number.isFinite(savedAt) ? savedAt : 0,
  }
}

/** Same run, same progress (within a few seconds of income): no question worth asking. */
function sameSave(a: SaveSummary, b: SaveSummary): boolean {
  return a.season === b.season && Math.abs(a.playedSec - b.playedSec) < 5 && Math.abs(a.lifetimeCredits - b.lifetimeCredits) <= Math.max(1, a.cps * 5)
}

interface Receipt {
  userId: string
  savedAt: string
}

/** Postgres echoes timestamptz with microseconds and `+00:00`; compare instants, not strings. */
function sameInstant(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) < 1000
}

function readReceipt(): Receipt | null {
  try {
    const raw = window.localStorage.getItem(RECEIPT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { userId, savedAt } = parsed as Partial<Receipt>
    return typeof userId === 'string' && typeof savedAt === 'string' ? { userId, savedAt } : null
  } catch {
    return null
  }
}

function writeReceipt(r: Receipt): void {
  try {
    window.localStorage.setItem(RECEIPT_KEY, JSON.stringify(r))
  } catch {
    /* storage unavailable, the next login asks instead of assuming */
  }
}
