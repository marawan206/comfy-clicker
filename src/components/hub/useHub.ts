'use client'
/**
 * ComfyHub client: the `/api/hub` listing hook, publish / run helpers, the signed-in user, the
 * Studio hand-off (a hub card loads its recipe into the Studio form and navigates home) and the
 * royalty bridge that reports a finished hub job back to `/api/hub/run`.
 *
 * Every number the cards show comes from the server payload; runnability comes from `src/game`.
 * This module is browser-only: `@/server/hub` is imported for its types alone.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAuthState, subscribeAuth, useAuth } from '@/components/auth/useAuth'
import { OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { patchSelection } from '@/components/studio/studioHooks'
import { buildIndex } from '@/game/catalog'
import { bestRunnable, lockReason, runnableHardware } from '@/game/hardware'
import type { Derived, GameState, Precision } from '@/game/types'
import type { HubList, HubPublishInput, HubRoyaltyGrant, HubRunReceipt, HubSort, HubWorkflow } from '@/server/hub'
import { getSupabaseBrowserClient } from '@/server/supabase/client'
import { getGameStore, type GameStore } from '@/state/store'
import { useGame, useGameStore } from '@/state/useGame'

export type { HubList, HubPublishInput, HubRoyaltyGrant, HubRunReceipt, HubSort, HubWorkflow } from '@/server/hub'

// ---------------------------------------------------------------------------
// Constants (mirror `src/server/hub.ts`, which cannot be imported by the browser bundle)
// ---------------------------------------------------------------------------
/** Share of a run's job cost the author receives as royalty. */
export const HUB_ROYALTY_RATE = 0.05
export const HUB_MAX_HASHTAGS = 3
export const HUB_NAME_MAX = 80

// ---------------------------------------------------------------------------
// Events & keys
// ---------------------------------------------------------------------------
/** `comfy:open-modal` detail that opens the publish dialog (string, or an object with `id` and a prefill). */
export const HUB_PUBLISH_MODAL = 'hub-publish'
/** Window event the Studio listens to: load a hub recipe into the form and tag the next job. */
export const STUDIO_LOAD_EVENT = 'comfy:studio-load'
/** Fired after a publish so any mounted listing refetches. */
export const HUB_CHANGED_EVENT = 'comfy:hub-changed'
/** Fired after a run is recorded (receipt in `detail`). */
export const HUB_RUN_RECORDED_EVENT = 'comfy:hub-run-recorded'
/** Fired after the author's royalties were collected into the game (`HubRoyaltyGrant` in `detail`). */
export const HUB_ROYALTIES_EVENT = 'comfy:hub-royalties'
/** How often a signed-in author asks the server for royalties earned meanwhile. */
export const HUB_ROYALTY_POLL_MS = 120_000
/** The hand-off survives the route change from /hub to / in sessionStorage. */
const PENDING_LOAD_KEY = 'comfy-clicker:hub-load'
/** CenterTabs' persisted choice; written so the Studio tab is up when the player lands on /. */
const CENTER_TAB_KEY = 'comfy-clicker:center-tab'
const HUB_URL = '/api/hub'

export interface StudioLoadDetail {
  modelId: string
  precision: Precision
  tags: string[]
  prompt?: string
  hubWorkflowId: string
  /** Display extras for the Studio's "running from ComfyHub" chip. */
  name?: string
  authorHandle?: string
}

export interface HubPublishPrefill {
  name?: string
  modelId?: string
  precision?: Precision
  hashtags?: string[]
  loraTag?: string | null
  upscaler?: boolean
}

export type HubPublishModalDetail = typeof HUB_PUBLISH_MODAL | ({ id: typeof HUB_PUBLISH_MODAL } & HubPublishPrefill)

/** Open the publish dialog, optionally with a prefill (otherwise it reads the Studio form). */
export function openHubPublish(prefill?: HubPublishPrefill): void {
  if (typeof window === 'undefined') return
  const detail: HubPublishModalDetail = prefill ? { id: HUB_PUBLISH_MODAL, ...prefill } : HUB_PUBLISH_MODAL
  window.dispatchEvent(new CustomEvent<HubPublishModalDetail>(OPEN_MODAL_EVENT, { detail }))
}

/** Reads a `comfy:open-modal` detail; returns the prefill when it targets the publish dialog, else null. */
export function readHubPublishDetail(detail: unknown): HubPublishPrefill | null {
  if (detail === HUB_PUBLISH_MODAL) return {}
  if (!detail || typeof detail !== 'object') return null
  const o = detail as Record<string, unknown>
  if (o.id !== HUB_PUBLISH_MODAL) return null
  const prefill: HubPublishPrefill = {}
  if (typeof o.name === 'string') prefill.name = o.name
  if (typeof o.modelId === 'string') prefill.modelId = o.modelId
  if (typeof o.precision === 'string' && PRECISIONS.has(o.precision)) prefill.precision = o.precision as Precision
  if (Array.isArray(o.hashtags)) prefill.hashtags = o.hashtags.filter((t): t is string => typeof t === 'string')
  if (typeof o.loraTag === 'string' || o.loraTag === null) prefill.loraTag = o.loraTag
  if (typeof o.upscaler === 'boolean') prefill.upscaler = o.upscaler
  return prefill
}

const PRECISIONS = new Set<string>(['native', 'fp8', 'q4'])

export function isStudioLoadDetail(x: unknown): x is StudioLoadDetail {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.modelId === 'string' &&
    typeof o.precision === 'string' &&
    PRECISIONS.has(o.precision) &&
    Array.isArray(o.tags) &&
    typeof o.hubWorkflowId === 'string'
  )
}

/**
 * Load a hub recipe into the Studio: the form is patched directly (it persists in localStorage),
 * the hub id is parked in sessionStorage for the Studio to pick up on mount, and a live event
 * covers the case where the Studio is already on screen. The caller navigates to `/` afterwards.
 */
export function requestStudioLoad(detail: StudioLoadDetail): void {
  if (typeof window === 'undefined') return
  patchSelection({
    modelId: detail.modelId,
    precision: detail.precision,
    tags: detail.tags.slice(0, HUB_MAX_HASHTAGS),
    ...(detail.prompt !== undefined ? { prompt: detail.prompt } : {}),
  })
  try {
    window.sessionStorage.setItem(PENDING_LOAD_KEY, JSON.stringify(detail))
    window.localStorage.setItem(CENTER_TAB_KEY, 'studio')
  } catch {
    /* storage unavailable, the live event still reaches a mounted Studio */
  }
  window.dispatchEvent(new CustomEvent<StudioLoadDetail>(STUDIO_LOAD_EVENT, { detail }))
}

/** The parked hand-off, if any, without clearing it (safe in a state initialiser). */
export function peekPendingStudioLoad(): StudioLoadDetail | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PENDING_LOAD_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isStudioLoadDetail(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Forget the parked hand-off (the Studio calls this once it has adopted it). */
export function clearPendingStudioLoad(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(PENDING_LOAD_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** Peek and clear in one go, for callers that are not inside a render. */
export function consumePendingStudioLoad(): StudioLoadDetail | null {
  const detail = peekPendingStudioLoad()
  if (detail) clearPendingStudioLoad()
  return detail
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
export class HubClientError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HubClientError'
    this.status = status
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: unknown }
    if (typeof json.error === 'string') return json.error
  } catch {
    /* not JSON */
  }
  return res.status === 503 ? 'ComfyHub is offline' : `ComfyHub replied ${res.status}`
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new HubClientError(res.status, await readError(res))
  return (await res.json()) as T
}

/**
 * Publish a workflow. Throws `HubClientError` (401 when signed out, 400 on validation). On
 * success the game's `stats.hubPublished` moves (the "Shipped To ComfyHub" achievement).
 */
export async function publishHubWorkflow(input: HubPublishInput): Promise<HubWorkflow> {
  const workflow = await post<HubWorkflow>(`${HUB_URL}/publish`, input)
  getGameStore().recordHubPublish({ id: workflow.id, name: workflow.name })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HUB_CHANGED_EVENT))
  return workflow
}

/** Ask the server for royalties and rep earned since the last claim. Throws `HubClientError`. */
export async function claimHubRoyalties(): Promise<HubRoyaltyGrant> {
  return post<HubRoyaltyGrant>(`${HUB_URL}/royalties`, {})
}

/** Record a run of someone's workflow. Throws `HubClientError`. */
export async function recordHubRun(workflowId: string, creditsPaid: number): Promise<HubRunReceipt> {
  const receipt = await post<HubRunReceipt>(`${HUB_URL}/run`, { workflowId, creditsPaid })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HUB_RUN_RECORDED_EVENT, { detail: receipt }))
  return receipt
}

function isHubList(x: unknown): x is HubList {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return Array.isArray(o.workflows) && Array.isArray(o.trending)
}

export async function fetchHubList(sort: HubSort, tag: string | null, signal?: AbortSignal): Promise<HubList> {
  const params = new URLSearchParams({ sort })
  if (tag) params.set('tag', tag)
  const res = await fetch(`${HUB_URL}?${params.toString()}`, { headers: { accept: 'application/json' }, signal })
  if (!res.ok) throw new HubClientError(res.status, await readError(res))
  const json: unknown = await res.json()
  if (!isHubList(json)) throw new HubClientError(500, 'ComfyHub returned something that is not a list')
  return json
}

// ---------------------------------------------------------------------------
// Auth (a view over the shared session store in `components/auth/useAuth`)
// ---------------------------------------------------------------------------
export interface HubUser {
  id: string
  email: string | null
}

export interface HubAuth {
  /** False when the public Supabase env is missing (guest-only build). */
  configured: boolean
  /** True once the session has been read (even when nobody is signed in). */
  ready: boolean
  user: HubUser | null
  /** `profiles.handle`, once loaded. */
  handle: string | null
}

/** Signed-in user from the cookie-backed browser session; updates on sign-in / sign-out. */
export function useHubAuth(): HubAuth {
  const auth = useAuth()
  return useMemo<HubAuth>(
    () => ({
      configured: auth.status !== 'unavailable',
      ready: auth.status !== 'loading',
      user: auth.user ? { id: auth.user.id, email: auth.user.email ?? null } : null,
      handle: auth.handle,
    }),
    [auth],
  )
}

/** Ask the auth sheet to open (mounted by the account menu in the header). */
export function openAuthModal(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_MODAL_EVENT, { detail: 'auth' }))
}

// ---------------------------------------------------------------------------
// Listing hook
// ---------------------------------------------------------------------------
export type HubStatus = 'loading' | 'ok' | 'offline' | 'error'

export interface HubApi {
  workflows: HubWorkflow[]
  /** Live trending hashtag ids the server scored against. */
  trending: string[]
  status: HubStatus
  error: string | null
  sort: HubSort
  tag: string | null
  setSort: (sort: HubSort) => void
  setTag: (tag: string | null) => void
  refresh: () => void
  auth: HubAuth
}

interface Fetched {
  /** Which (sort, tag, refresh) request this result answers. */
  key: string
  list: HubList | null
  error: HubClientError | null
}

const NOTHING_FETCHED: Fetched = { key: '', list: null, error: null }

/** The hub listing with sort / tag state; refetches on `comfy:hub-changed`, after a run and on tab return. */
export function useHub(initialSort: HubSort = 'trending'): HubApi {
  const [sort, setSort] = useState<HubSort>(initialSort)
  const [tag, setTag] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [fetched, setFetched] = useState<Fetched>(NOTHING_FETCHED)
  const auth = useHubAuth()
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  const key = `${sort}|${tag ?? ''}|${tick}`

  useEffect(() => {
    const controller = new AbortController()
    fetchHubList(sort, tag, controller.signal)
      .then((list) => setFetched({ key, list, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const e = err instanceof HubClientError ? err : new HubClientError(0, err instanceof Error ? err.message : 'ComfyHub unreachable')
        // Keep the last good list on screen behind the error state.
        setFetched((prev) => ({ key, list: prev.list, error: e }))
      })
    return () => controller.abort()
  }, [key, sort, tag])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener(HUB_CHANGED_EVENT, refresh)
    window.addEventListener(HUB_RUN_RECORDED_EVENT, refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(HUB_CHANGED_EVENT, refresh)
      window.removeEventListener(HUB_RUN_RECORDED_EVENT, refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const loading = fetched.key !== key
  const status: HubStatus = loading ? 'loading' : fetched.error ? (fetched.error.status === 503 ? 'offline' : 'error') : 'ok'
  const error = loading ? null : (fetched.error?.message ?? null)

  return useMemo<HubApi>(
    () => ({
      workflows: fetched.list?.workflows ?? [],
      trending: fetched.list?.trending ?? [],
      status,
      error,
      sort,
      tag,
      setSort,
      setTag,
      refresh,
      auth,
    }),
    [fetched.list, status, error, sort, tag, refresh, auth],
  )
}

// ---------------------------------------------------------------------------
// Runnability (the Run button's verdict per card)
// ---------------------------------------------------------------------------
export interface RunVerdict {
  ok: boolean
  /** Why not, in the game's own words (null when ok). */
  reason: string | null
  /** Name of the unit the job would run on. */
  hardwareName: string | null
}

export const UNKNOWN_VERDICT: RunVerdict = { ok: false, reason: 'Checking your rig', hardwareName: null }

/** Everything a verdict depends on, as one string, so cards re-check only when the rig changes. */
function rigSignature(s: GameState, d: Derived): string {
  let sig = ''
  for (const id in s.models) {
    const m = s.models[id]
    if (m) sig += `${id}:${m.setup ? 1 : 0}:${m.precisions.join('/')};`
  }
  sig += '|'
  for (const id in s.hardware) if ((s.hardware[id] ?? 0) > 0) sig += `${id},`
  return `${sig}|z${d.zluda ? 1 : 0}a${d.apiNodes ? 1 : 0}v${d.bestVram}c${d.coolingTier}s${d.speedMult}`
}

/** Changes only when the owned models, units or the Graph nodes that gate them change. */
export function useRigSignature(): string {
  return useGame(rigSignature)
}

/** Can the player queue `modelId` at `precision` right now, and on what? Pure; reads the store snapshot. */
export function computeRunVerdict(store: GameStore, modelId: string, precision: Precision): RunVerdict {
  const { state, derived, catalog } = store
  const model = buildIndex(catalog).modelById[modelId]
  if (!model) return { ok: false, reason: 'That model is not in this build', hardwareName: null }
  const owned = state.models[model.id]
  const precisionLabel = catalog.precisions[precision]?.label ?? precision
  if (!owned?.setup) return { ok: false, reason: `Set up ${model.name} in the Store first`, hardwareName: null }
  if (!owned.precisions.includes(precision)) return { ok: false, reason: `Quantize ${model.name} to ${precisionLabel} first`, hardwareName: null }
  if (runnableHardware(model, precision, state, derived, catalog).length === 0) {
    return { ok: false, reason: lockReason(model, precision, state, derived, catalog) ?? 'Nothing you own can run this', hardwareName: null }
  }
  return { ok: true, reason: null, hardwareName: bestRunnable(model, precision, state, derived, catalog)?.name ?? null }
}

/** Verdict per workflow id, computed once per (model, precision) pair and only when the rig changes. */
export function useRunVerdicts(workflows: readonly HubWorkflow[]): ReadonlyMap<string, RunVerdict> {
  const store = useGameStore()
  const sig = useRigSignature()
  return useMemo(() => {
    // `sig` is the dependency that invalidates this map; the body reads the store directly.
    void sig
    const byPair = new Map<string, RunVerdict>()
    const out = new Map<string, RunVerdict>()
    for (const w of workflows) {
      const pair = `${w.modelId}@${w.precision}`
      let verdict = byPair.get(pair)
      if (!verdict) {
        verdict = computeRunVerdict(store, w.modelId, w.precision)
        byPair.set(pair, verdict)
      }
      out.set(w.id, verdict)
    }
    return out
  }, [workflows, sig, store])
}

// ---------------------------------------------------------------------------
// Royalty bridge
// ---------------------------------------------------------------------------
let bridgeStarted = false
const reported = new Set<string>()

/**
 * Report a finished hub job: when a post with `hubWorkflowId` resolves, POST the job's cost to
 * `/api/hub/run` so the author's counters and royalty move. Guests are skipped quietly (the
 * insert needs a runner id). Also starts the royalty collector for the signed-in author (see
 * `startRoyaltyCollector`). Idempotent; safe to call from any mounted panel. The Studio and the
 * hub page both call it.
 */
export function ensureHubRoyaltyBridge(): void {
  if (bridgeStarted || typeof window === 'undefined') return
  bridgeStarted = true
  startRoyaltyCollector()
  const store = getGameStore()
  store.onEvent((event) => {
    if (event.type !== 'postResolved') return
    const post = store.state.posts.find((p) => p.id === event.postId)
    if (!post?.hubWorkflowId || reported.has(post.id)) return
    reported.add(post.id)
    const workflowId = post.hubWorkflowId
    const creditsPaid = post.cost
    void (async () => {
      const client = getSupabaseBrowserClient()
      if (!client) return
      const { data } = await client.auth.getSession()
      if (!data.session) return
      try {
        const receipt = await recordHubRun(workflowId, creditsPaid)
        if (receipt.selfRun) return
        toast('Run recorded on ComfyHub', {
          title: 'ComfyHub',
          description: receipt.royalty > 0 ? `${receipt.royalty} credits of royalty to the author · +${receipt.rep} rep` : 'The author gets the rep',
          tone: 'sapphire',
          key: `hub-run:${post.id}`,
          durationMs: 3500,
        })
      } catch (err) {
        if (err instanceof HubClientError && err.status === 401) return
        reported.delete(post.id)
        toast('ComfyHub did not record the run', {
          title: 'ComfyHub',
          description: err instanceof Error ? err.message : 'Network hiccup',
          tone: 'danger',
          key: `hub-run:${post.id}`,
        })
      }
    })()
  })
}

// ---------------------------------------------------------------------------
// Royalty collector (the author's side)
// ---------------------------------------------------------------------------
let collecting = false
let lastCollectedFor: string | null = null

/**
 * Pull the signed-in author's unclaimed royalties into the game: on sign-in, every
 * HUB_ROYALTY_POLL_MS while the tab is visible, and when the tab comes back. The server marks
 * each run claimed, so a second device asking gets nothing twice. Quiet on every failure. The
 * next poll tries again.
 */
function startRoyaltyCollector(): void {
  const collect = async (force = false) => {
    if (collecting || document.visibilityState === 'hidden') return
    const auth = getAuthState()
    if (auth.status !== 'signed-in' || !auth.user) return
    if (!force && lastCollectedFor !== auth.user.id) force = true
    collecting = true
    try {
      const grant = await claimHubRoyalties()
      lastCollectedFor = auth.user.id
      if (grant.runs <= 0 && grant.royalty <= 0 && grant.rep <= 0) return
      const result = getGameStore().applyHubRoyalties(grant)
      if (result.error) return
      window.dispatchEvent(new CustomEvent<HubRoyaltyGrant>(HUB_ROYALTIES_EVENT, { detail: grant }))
      const runs = `${grant.runs} ${grant.runs === 1 ? 'run' : 'runs'}`
      toast(`Royalties collected: ${runs} of your workflows`, {
        title: 'ComfyHub',
        description: grant.royalty > 0 ? `+${grant.royalty} credits · +${grant.rep} rep. Nobody credited you, the hub did.` : `+${grant.rep} rep. The runs were free jobs; the rep is not.`,
        tone: 'sapphire',
        key: 'hub-royalties',
        durationMs: 5000,
      })
    } catch {
      /* offline, signed out mid-flight, or the server said no. Try again on the next poll */
    } finally {
      collecting = false
    }
  }
  subscribeAuth(() => {
    const auth = getAuthState()
    if (auth.status === 'signed-in' && auth.user && auth.user.id !== lastCollectedFor) void collect(true)
    if (auth.status === 'guest') lastCollectedFor = null
  })
  window.setInterval(() => void collect(), HUB_ROYALTY_POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void collect()
  })
  void collect()
}
