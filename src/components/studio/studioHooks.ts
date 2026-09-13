'use client'
/**
 * Studio hooks: the persisted model / precision / prompt / tag selection, a memoised model
 * roster shared by the Studio chips and the Models store tab, the cost / ETA / trend preview
 * behind the Generate button, and a few shared helpers.
 *
 * Every number comes from `src/game`; these hooks only decide what to subscribe to. Selectors
 * return primitives or small flat objects so components re-render on change, not on every tick.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import { useReducedMotion } from 'motion/react'
import type { Catalog } from '@/data'
import { PRECISION_ORDER } from '@/data/precisions'
import { LORA_MAP_NODE, loraCost } from '@/game/actions'
import { buildIndex } from '@/game/catalog'
import { API_COST_MULT, MAX_MATCHED_TRENDING, MAX_QUEUE, RATIO_LOSS_MULT, TRENDING_WEIGHTS } from '@/game/constants'
import { formatDuration } from '@/game/format'
import { bestRunnable, genTimeMs, lockReason } from '@/game/hardware'
import { currentTrending, matchTags, mismatchedTypeTags, msUntilRollover, trendMult } from '@/game/hashtags'
import { modelLevelLock, playerLevel } from '@/game/level'
import { QUANT_NODE_IDS, hasPrecision, quantFee, setupFee } from '@/game/quantize'
import { jobCost } from '@/game/studio'
import type { ContractGoal, Derived, GameState, HashtagDef, ModelDef, ModelKind, Precision } from '@/game/types'
import type { PromptChip } from '@/data/flavor'
import { describeUnlock, isUnlocked } from '@/game/unlock'
import { FLOP_ROLL, NORMAL_ROLL, VIRAL_ROLL, repostKey } from '@/game/virality'
import { useNow } from '@/hooks/useNow'
import { PICK_HASHTAG_EVENT } from '@/components/feed/feedHooks'
import { getGameStore, type GameStore } from '@/state/store'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'

// ---------------------------------------------------------------------------
// Constants & small helpers
// ---------------------------------------------------------------------------
export const STUDIO_STORAGE_KEY = 'comfy-clicker:studio'
/** The Studio caps prompts at a post-sized length (the engine allows a little more). */
export const MAX_PROMPT_UI_CHARS = 200
export const MAX_SELECTED_TAGS = 3
export const QUANT_TIERS = ['fp8', 'q4'] as const
export type QuantTier = (typeof QUANT_TIERS)[number]

/** Window CustomEvents other panels listen to. */
export const CENTER_TAB_EVENT = 'comfy:center-tab'
export type CenterTab = 'studio' | 'feed' | 'contracts'

/**
 * The store panel's own opener, re-exported so a Studio surface can hand a guidance step a
 * `{ tab, family, focusId }` target and have the row scrolled to and ringed. There used to be a
 * second, string-only copy here; one dispatcher means one payload shape.
 */
export { openStoreTab, STORE_TAB_EVENT, type StoreTab, type StoreTabEventDetail } from '@/components/store/storeHooks'

export const KIND_LABELS: Record<ModelKind, string> = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' }

/** Shared class fragments so every studio control looks like the same node. */
export const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600'
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-electric-400 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-600'

export function openCenterTab(tab: CenterTab): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<CenterTab>(CENTER_TAB_EVENT, { detail: tab }))
}

/** `12 s` below a minute, `formatDuration` above (`3:50`, `1h 02m`). */
export function formatShortSecs(sec: number): string {
  if (Number.isNaN(sec) || sec < 0) return '0 s'
  if (!Number.isFinite(sec)) return '∞'
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`
  return formatDuration(sec)
}

export function formatGb(gb: number): string {
  if (!Number.isFinite(gb)) return '∞ GB'
  return `${Math.round(gb * 10) / 10} GB`
}

export function isTypeTag(def: HashtagDef | undefined): boolean {
  return def?.kind !== undefined
}

/**
 * Marginal trend bonus for matching one more trending (non-type) tag when `matchedCount` are
 * already matched: `+1.0`, then `+0.4`, then the spam rule voids everything.
 */
export function nextTrendingBonus(matchedCount: number): number | 'spam' {
  if (matchedCount >= MAX_MATCHED_TRENDING) return 'spam'
  return TRENDING_WEIGHTS[matchedCount] ?? 0
}

// ---------------------------------------------------------------------------
// Expected value (the "≈ +42% expected" hint)
// ---------------------------------------------------------------------------
const mean = (band: readonly [number, number]): number => (band[0] + band[1]) / 2
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** E[M] of the post roll for the player's current viral / flop odds (≈ 1.23 at base). */
export function expectedRoll(d: Pick<Derived, 'viralChance' | 'flopChance'>): number {
  const v = clamp01(d.viralChance)
  const f = clamp01(d.flopChance)
  return v * mean(VIRAL_ROLL) + (1 - v) * (f * mean(FLOP_ROLL) + (1 - f) * mean(NORMAL_ROLL))
}

/**
 * Expected credits back per credit spent on a post at `precision`. Reach never moves the payout
 * (see virality.ts), so this is roll × payout × quality, minus the API surcharge for API models.
 */
export function expectedReturn(model: ModelDef, precision: Precision, d: Derived, catalog: Catalog): number {
  const quality = catalog.precisions[precision]?.qualityMult ?? 1
  const api = model.api ? 1 / API_COST_MULT : 1
  return (model.payoutRatio + d.payoutBonus) * expectedRoll(d) * quality * api
}

/**
 * Expected return on a ratioed post, as a fraction of the job cost: the whole job is sunk and the
 * dislikes take `RATIO_LOSS_MULT × roll` of it again, with the roll forced into the flop band. At
 * the shipped numbers that is a flat -145%, and nothing the player owns moves it.
 */
export function ratioedReturn(): number {
  return -(1 + RATIO_LOSS_MULT * mean(FLOP_ROLL))
}

// ---------------------------------------------------------------------------
// Persisted selection (module store + useSyncExternalStore, so every studio control shares it)
// ---------------------------------------------------------------------------
export interface StudioSelection {
  modelId: string
  precision: Precision
  prompt: string
  tags: string[]
}

const DEFAULT_SELECTION: StudioSelection = { modelId: 'sd15', precision: 'native', prompt: '', tags: [] }
const PRECISION_SET = new Set<string>(PRECISION_ORDER)

let selection: StudioSelection = DEFAULT_SELECTION
let hydrated = false
const listeners = new Set<() => void>()

function sanitize(raw: unknown): StudioSelection {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SELECTION
  const r = raw as Record<string, unknown>
  const modelId = typeof r.modelId === 'string' && r.modelId ? r.modelId : DEFAULT_SELECTION.modelId
  const precision =
    typeof r.precision === 'string' && PRECISION_SET.has(r.precision) ? (r.precision as Precision) : 'native'
  const prompt = typeof r.prompt === 'string' ? r.prompt.slice(0, MAX_PROMPT_UI_CHARS) : ''
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string').slice(0, MAX_SELECTED_TAGS)
    : []
  return { modelId, precision, prompt, tags }
}

function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  try {
    const raw = window.localStorage.getItem(STUDIO_STORAGE_KEY)
    if (raw) selection = sanitize(JSON.parse(raw))
  } catch {
    /* unreadable save of the studio form, start from defaults */
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(selection))
  } catch {
    /* storage unavailable, the form still works for this session */
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // First subscriber (an effect, so never during render or SSR) loads the saved form; React
  // re-checks the snapshot right after subscribing and picks the change up.
  hydrate()
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): StudioSelection => selection
const getServerSnapshot = (): StudioSelection => DEFAULT_SELECTION

/** Update part of the studio form (event handlers only). */
export function patchSelection(patch: Partial<StudioSelection>): void {
  selection = { ...selection, ...patch }
  persist()
  for (const l of listeners) l()
}

/**
 * Select a hashtag from outside the Studio form (the "Trending this week" chips).
 *
 * The three slots are a hard cap, so a pick on a full row rolls the oldest tag out instead of
 * doing nothing: the chip says "Use #x in the Studio", and a control that silently refuses is the
 * bug this replaced.
 */
export function selectHashtag(id: string): void {
  hydrate()
  const tags = selection.tags
  if (tags.includes(id)) return
  patchSelection({ tags: [...tags, id].slice(-MAX_SELECTED_TAGS) })
}

let pickBridged = false

/**
 * Arm the `comfy:pick-hashtag` listener. It lives on the module, not in a component: the chips sit
 * in the trending strip above the centre tabs and can be clicked while the Feed tab is up, where
 * the whole Studio is unmounted (`CenterTabs` keys the panel on the tab). So the tag is applied to
 * the shared form first and the Studio is brought forward second.
 *
 * Idempotent, and the listener is never removed: there is one form and one week's trio per page.
 */
export function ensurePickHashtagBridge(): void {
  if (pickBridged || typeof window === 'undefined') return
  pickBridged = true
  window.addEventListener(PICK_HASHTAG_EVENT, (e: Event) => {
    const id = (e as CustomEvent<unknown>).detail
    if (typeof id !== 'string' || id === '') return
    if (!buildIndex(getGameStore().catalog).hashtagById[id]) return
    selectHashtag(id)
    openCenterTab('studio')
  })
}

function firstSetupModel(state: GameState, catalog: Catalog): string {
  for (const model of catalog.models) if (state.models[model.id]?.setup) return model.id
  return ''
}

/** The saved model may have been rebranded away or its precision never unlocked: fall back. */
function resolveSelection(raw: StudioSelection, state: GameState, catalog: Catalog): { modelId: string; precision: Precision } {
  const modelId = state.models[raw.modelId]?.setup ? raw.modelId : firstSetupModel(state, catalog)
  const precisions = state.models[modelId]?.precisions
  const precision = precisions?.includes(raw.precision) ? raw.precision : 'native'
  return { modelId, precision }
}

export interface StudioSelectionApi extends StudioSelection {
  /** What the form saved, before falling back to a model that is actually set up. */
  savedModelId: string
  setModel: (modelId: string) => void
  setPrecision: (precision: Precision) => void
  setPrompt: (prompt: string) => void
  setTags: (tags: string[]) => void
  toggleTag: (tagId: string) => void
}

/** The shared studio form, persisted in localStorage and validated against the game state. */
export function useStudioSelection(): StudioSelectionApi {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const resolved = useGameShallow((s, _d, store) => resolveSelection(raw, s, store.catalog))

  const setModel = useCallback((modelId: string) => patchSelection({ modelId }), [])
  const setPrecision = useCallback((precision: Precision) => patchSelection({ precision }), [])
  const setPrompt = useCallback((prompt: string) => patchSelection({ prompt: prompt.slice(0, MAX_PROMPT_UI_CHARS) }), [])
  const setTags = useCallback((tags: string[]) => patchSelection({ tags: tags.slice(0, MAX_SELECTED_TAGS) }), [])
  const toggleTag = useCallback((tagId: string) => {
    const current = selection.tags
    if (current.includes(tagId)) patchSelection({ tags: current.filter((t) => t !== tagId) })
    else if (current.length < MAX_SELECTED_TAGS) patchSelection({ tags: [...current, tagId] })
  }, [])

  return {
    modelId: resolved.modelId,
    precision: resolved.precision,
    prompt: raw.prompt,
    tags: raw.tags,
    savedModelId: raw.modelId,
    setModel,
    setPrecision,
    setPrompt,
    setTags,
    toggleTag,
  }
}

// ---------------------------------------------------------------------------
// "More tags" disclosure (collapsed by default so the Generate button stays above the fold)
// ---------------------------------------------------------------------------
const MORE_TAGS_KEY = 'comfy-clicker:studio-more-tags'

let moreTags = false
let moreTagsHydrated = false
const moreTagsListeners = new Set<() => void>()

function hydrateMoreTags(): void {
  if (moreTagsHydrated || typeof window === 'undefined') return
  moreTagsHydrated = true
  try {
    moreTags = window.localStorage.getItem(MORE_TAGS_KEY) === '1'
  } catch {
    /* storage unavailable, the row stays collapsed for this session */
  }
}

function subscribeMoreTags(listener: () => void): () => void {
  moreTagsListeners.add(listener)
  // First subscriber runs in an effect, never during render or SSR, so this is the safe moment to
  // read storage; React re-checks the snapshot right after subscribing and picks the change up.
  hydrateMoreTags()
  return () => {
    moreTagsListeners.delete(listener)
  }
}

export interface Disclosure {
  open: boolean
  toggle: () => void
}

function toggleMoreTags(): void {
  moreTags = !moreTags
  try {
    window.localStorage.setItem(MORE_TAGS_KEY, moreTags ? '1' : '0')
  } catch {
    /* storage unavailable, the disclosure still works for this session */
  }
  for (const l of moreTagsListeners) l()
}

/**
 * Whether the full hashtag list is expanded, remembered across sessions. Same module-store shape as
 * the studio form above: the server and the first paint both render it closed, so the markup
 * matches, and the saved value arrives with the first subscription.
 */
export function useMoreTags(): Disclosure {
  const open = useSyncExternalStore(
    subscribeMoreTags,
    () => moreTags,
    () => false,
  )
  return { open, toggle: toggleMoreTags }
}

// ---------------------------------------------------------------------------
// Model roster (Studio chips + Models store tab)
// ---------------------------------------------------------------------------
export interface QuantInfo {
  fee: number
  owned: boolean
  /** Why the tier cannot be bought right now, credits aside (null = only money stands in the way). */
  blocker: string | null
}

export interface ModelRosterEntry {
  model: ModelDef
  /** Store unlock condition passes. */
  visible: boolean
  /** Has an entry in `state.models` (set up, or quantized ahead of setup). */
  owned: boolean
  setup: boolean
  precisions: Precision[]
  /** Something owned runs the model at that precision (whether or not the precision is unlocked). */
  runnable: Record<Precision, boolean>
  /** Name of the unit a job would run on, per precision. */
  hardwareName: Partial<Record<Precision, string>>
  /** Set up and runnable at some unlocked precision, selectable in the Studio. */
  ready: boolean
  /** The engine's level gate: `{ need, have }` while the player is under it, null once cleared. */
  levelLock: { need: number; have: number } | null
  lockReasons: Record<Precision, string | null>
  setupFee: number
  /** Why "Set up" is refused, credits aside. */
  setupBlocker: string | null
  quant: Record<QuantTier, QuantInfo>
}

/**
 * Everything the roster depends on, as one string, so the roster is rebuilt only when a model,
 * a unit, a Graph node or an unlock condition changes, never on credits ticking.
 */
function rosterSignature(s: GameState, d: Derived, store: GameStore): string {
  const { catalog } = store
  let sig = ''
  for (const id in s.models) {
    const m = s.models[id]
    if (m) sig += `${id}:${m.setup ? 1 : 0}:${m.precisions.join('/')};`
  }
  sig += '|'
  for (const id in s.hardware) if ((s.hardware[id] ?? 0) > 0) sig += `${id},`
  sig += `|z${d.zluda ? 1 : 0}a${d.apiNodes ? 1 : 0}v${d.bestVram}s${d.speedMult}f${d.unlockedFamilies.length}m${s.mapNodes.length}u${s.upgrades.length}l${playerLevel(s)}|`
  for (const model of catalog.models) sig += isUnlocked(model.unlock, s, d, catalog) ? '1' : '0'
  return sig
}

/** Mirrors quantize.ts `canQuantize` minus the credits check, so the reason stays stable while credits tick. */
function quantBlocker(model: ModelDef, tier: QuantTier, s: GameState, catalog: Catalog): string | null {
  if (model.api) return `${model.name} runs on someone else's GPU · nothing to quantize`
  if (model.quantizable === false) return `${model.name} can't be quantized`
  if (!(model.id in s.models)) return `Set up ${model.name} first`
  const gate = buildIndex(catalog).mapNodeById[QUANT_NODE_IDS[tier]]
  if (gate && !s.mapNodes.includes(gate.id)) return `Unlock ${gate.title} on the Graph`
  return null
}

/** Mirrors actions.ts `setupModel` minus the credits check. */
function setupBlocker(model: ModelDef, s: GameState, d: Derived, catalog: Catalog): string | null {
  if (s.models[model.id]?.setup) return `${model.name} is already set up`
  if (!isUnlocked(model.unlock, s, d, catalog)) return describeUnlock(model.unlock, catalog) || `${model.name} is locked`
  if (model.api && !d.apiNodes) return 'Unlock API Nodes on the Graph first'
  return null
}

function buildRoster(s: GameState, d: Derived, catalog: Catalog): ModelRosterEntry[] {
  return catalog.models.map((model) => {
    const entry = s.models[model.id]
    const owned = entry !== undefined
    const setup = entry?.setup === true
    const precisions = entry?.precisions ?? []
    const runnable: Record<Precision, boolean> = { native: false, fp8: false, q4: false }
    const lockReasons: Record<Precision, string | null> = { native: null, fp8: null, q4: null }
    const hardwareName: Partial<Record<Precision, string>> = {}
    for (const p of PRECISION_ORDER) {
      const hw = bestRunnable(model, p, s, d, catalog)
      runnable[p] = hw !== null
      if (hw) hardwareName[p] = hw.name
      lockReasons[p] = lockReason(model, p, s, d, catalog)
    }
    const quant = {} as Record<QuantTier, QuantInfo>
    for (const tier of QUANT_TIERS) {
      quant[tier] = {
        fee: quantFee(model, tier, catalog),
        owned: hasPrecision(s, model.id, tier),
        blocker: quantBlocker(model, tier, s, catalog),
      }
    }
    return {
      model,
      visible: isUnlocked(model.unlock, s, d, catalog),
      owned,
      setup,
      precisions,
      runnable,
      hardwareName,
      ready: setup && precisions.some((p) => runnable[p]),
      levelLock: modelLevelLock(model, s),
      lockReasons,
      setupFee: setupFee(model, d, catalog),
      setupBlocker: setupBlocker(model, s, d, catalog),
      quant,
    }
  })
}

/** Every catalog model with ownership, runnability, fees and lock reasons; rebuilt only when the signature changes. */
export function useModelRoster(): ModelRosterEntry[] {
  const store = useGameStore()
  const sig = useGame(rosterSignature)
  return useMemo(() => (sig.length > 0 ? buildRoster(store.state, store.derived, store.catalog) : []), [sig, store])
}

export function useRosterEntry(modelId: string): ModelRosterEntry | null {
  const roster = useModelRoster()
  return useMemo(() => roster.find((e) => e.model.id === modelId) ?? null, [roster, modelId])
}

// ---------------------------------------------------------------------------
// Trending & LoRA slices
// ---------------------------------------------------------------------------
export interface TrendingInfo {
  trending: string[]
  /** Milliseconds until the deterministic week rolls over. */
  msLeft: number
}

export function useTrending(): TrendingInfo {
  const now = useNow(1000)
  const { key, weekSpeed } = useGameShallow((s, d, store) => ({
    key: currentTrending(s, now, store.catalog, d.weekSpeed).join(','),
    weekSpeed: d.weekSpeed,
  }))
  return useMemo(() => ({ trending: key ? key.split(',') : [], msLeft: msUntilRollover(now, weekSpeed) }), [key, now, weekSpeed])
}

export interface LoraInfo {
  unlocked: boolean
  cost: number
  trained: string[]
}

export function useLoraInfo(): LoraInfo {
  const { unlocked, cost, trainedKey } = useGameShallow((s, d) => ({
    unlocked: s.mapNodes.includes(LORA_MAP_NODE),
    cost: loraCost(d),
    trainedKey: s.loras.join(','),
  }))
  return useMemo(() => ({ unlocked, cost, trained: trainedKey ? trainedKey.split(',') : [] }), [unlocked, cost, trainedKey])
}

// ---------------------------------------------------------------------------
// Cost preview for the Generate button
// ---------------------------------------------------------------------------
export interface CostPreview {
  modelId: string
  modelName: string
  kind: ModelKind
  api: boolean
  precision: Precision
  cost: number
  cps: number
  /** Seconds of passive income the job costs. */
  incomeSec: number
  affordable: boolean
  hardwareName: string | null
  genSec: number | null
  trending: string[]
  /** Hashtags the post would carry: keyword hits, literal #tags and the selected ids. */
  matched: string[]
  /** The subset the player chose on purpose: selected chips plus literal `#tag` tokens. */
  explicit: string[]
  /** Explicit type tags naming a kind this model is not. Non-empty means the post gets ratioed. */
  mismatched: string[]
  /** The mismatched ids that are literals in the prompt, so the Remove button cannot drop them. */
  mismatchedInPrompt: string[]
  keywordHits: number
  trend: number
  /** More trending tags matched than the algorithm tolerates: trend bonus voided. */
  spam: boolean
  /** Same model, tags and prompt as the last post: reach halved. */
  repost: boolean
  queueLen: number
  queueFull: boolean
  /** Why `queueJob` would refuse right now (null = it would go through). */
  blocker: string | null
  /** Expected return minus one at this precision (`0.35` → "+35%"), -145% on a ratio. */
  evPct: number
}

/** Mirrors studio.ts `createJob` validation order so the button can explain itself before the click. */
function jobBlocker(
  model: ModelDef | undefined,
  precision: Precision,
  s: GameState,
  d: Derived,
  catalog: Catalog,
  cost: number,
): string | null {
  if (!model) return 'Set up a model in the Store first'
  const owned = s.models[model.id]
  if (!owned) return `You don't have ${model.name} yet`
  if (!owned.setup) return `${model.name} is not set up yet`
  if (!owned.precisions.includes(precision)) return `${catalog.precisions[precision].label} not unlocked for ${model.name}`
  if (!bestRunnable(model, precision, s, d, catalog)) {
    return lockReason(model, precision, s, d, catalog) ?? 'Nothing you own can run this'
  }
  if (s.queue.length >= MAX_QUEUE) return `Queue full (${MAX_QUEUE})`
  if (s.credits < cost) return 'Not enough credits'
  return null
}

/**
 * Computes the preview. Call it ONCE (StudioPanel does) and publish the result through
 * `CostPreviewProvider`; every other Studio component reads it with `useCostPreview()` so the
 * selector below runs once per tick instead of once per consumer.
 */
export function useComputeCostPreview(): CostPreview {
  const { modelId, precision, prompt, tags } = useStudioSelection()
  const now = useNow(1000)
  const store = useGameStore()

  const base = useGameShallow((s, d, st) => {
    const { catalog } = st
    const model = buildIndex(catalog).modelById[modelId]
    const cost = model ? jobCost(model, precision, d, catalog) : 0
    const hw = model ? bestRunnable(model, precision, s, d, catalog) : null
    return {
      modelName: model?.name ?? '',
      kind: model?.kind ?? ('image' as ModelKind),
      api: model?.api === true,
      cost,
      cps: d.cps,
      affordable: s.credits >= cost,
      hardwareName: hw?.name ?? null,
      genMs: model && hw ? genTimeMs(model, precision, hw, d, catalog) : -1,
      trendingKey: currentTrending(s, now, catalog, d.weekSpeed).join(','),
      queueLen: s.queue.length,
      blocker: jobBlocker(model, precision, s, d, catalog, cost),
      evPct: model ? expectedReturn(model, precision, d, catalog) - 1 : 0,
      lastPostKey: s.stats.lastPostKey,
    }
  })

  const tagsKey = tags.join(',')
  return useMemo(() => {
    const { catalog } = store
    const trending = base.trendingKey ? base.trendingKey.split(',') : []
    const selected = tagsKey ? tagsKey.split(',') : []
    const { matched, keywordHits, explicit } = matchTags(prompt, selected, catalog)
    const { hashtagById } = buildIndex(catalog)
    const trendingSet = new Set(trending)
    const slots = matched.filter((id) => trendingSet.has(id) && !isTypeTag(hashtagById[id])).length
    // Only a tag the player put there on purpose can ratio a post; a keyword hit never does.
    const mismatched = mismatchedTypeTags(explicit, base.kind, catalog)
    const selectedSet = new Set(selected)
    const mismatchedInPrompt = mismatched.filter((id) => !selectedSet.has(id))
    return {
      modelId,
      modelName: base.modelName,
      kind: base.kind,
      api: base.api,
      precision,
      cost: base.cost,
      cps: base.cps,
      incomeSec: base.cps > 0 ? base.cost / base.cps : Infinity,
      affordable: base.affordable,
      hardwareName: base.hardwareName,
      genSec: base.genMs >= 0 ? base.genMs / 1000 : null,
      trending,
      matched,
      explicit,
      mismatched,
      mismatchedInPrompt,
      keywordHits,
      trend: mismatched.length > 0 ? 1 : trendMult(matched, trending, keywordHits, base.kind, catalog),
      spam: slots > MAX_MATCHED_TRENDING,
      repost: modelId !== '' && base.lastPostKey !== '' && base.lastPostKey === repostKey(modelId, matched, prompt),
      queueLen: base.queueLen,
      queueFull: base.queueLen >= MAX_QUEUE,
      blocker: base.blocker,
      evPct: mismatched.length > 0 ? ratioedReturn() : base.evPct,
    }
  }, [base, modelId, precision, prompt, tagsKey, store])
}

const CostPreviewContext = createContext<CostPreview | null>(null)
export const CostPreviewProvider = CostPreviewContext.Provider

/** The shared cost preview published by StudioPanel (see `useComputeCostPreview`). */
export function useCostPreview(): CostPreview {
  const preview = useContext(CostPreviewContext)
  if (preview === null) {
    throw new Error('useCostPreview() must be used inside StudioPanel (CostPreviewProvider)')
  }
  return preview
}

// ---------------------------------------------------------------------------
// Motion preference
// ---------------------------------------------------------------------------
/** False when the OS or the in-game setting asks for reduced motion. */
export function useMotionOK(): boolean {
  const system = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  return !(system || setting)
}

// ---------------------------------------------------------------------------
// Prompt chips
// ---------------------------------------------------------------------------
/**
 * Append a one-tap idea to the prompt (or replace it when the two would not fit) and adopt the
 * non-type hashtags its keywords hit, up to the tag cap.
 */
export function applyPromptChip(chip: PromptChip, catalog: Catalog): void {
  const current = selection.prompt.trim()
  const joined = current ? `${current}, ${chip.text}` : chip.text
  const prompt = (joined.length <= MAX_PROMPT_UI_CHARS ? joined : chip.text).slice(0, MAX_PROMPT_UI_CHARS)
  const { hashtagById } = buildIndex(catalog)
  const { matched } = matchTags(`${chip.text} ${chip.keywords.join(' ')}`, [], catalog)
  const tags = [...selection.tags]
  for (const id of matched) {
    if (tags.length >= MAX_SELECTED_TAGS) break
    if (!tags.includes(id) && hashtagById[id] && !isTypeTag(hashtagById[id])) tags.push(id)
  }
  patchSelection({ prompt, tags })
}

// ---------------------------------------------------------------------------
// Queue rows
// ---------------------------------------------------------------------------
function splitKey(key: string): string[] {
  return key ? key.split('|') : []
}

/** Job ids in queue order; the array identity changes only when a job is added, started or finished. */
export function useQueueIds(): string[] {
  const key = useGame((s) => s.queue.map((j) => `${j.id}${j.startedAt === null ? '' : '*'}`).join('|'))
  return useMemo(() => splitKey(key).map((id) => (id.endsWith('*') ? id.slice(0, -1) : id)), [key])
}

export interface JobRowState {
  modelId: string
  modelName: string
  kind: ModelKind
  vendorIcon: string
  precisionLabel: string
  prompt: string
  hardwareName: string
  cost: number
  durationMs: number
  startedAt: number | null
  clickBonusMs: number
}

const EMPTY_JOB: JobRowState = {
  modelId: '',
  modelName: '',
  kind: 'image',
  vendorIcon: 'ai-model',
  precisionLabel: '',
  prompt: '',
  hardwareName: '',
  cost: 0,
  durationMs: 0,
  startedAt: null,
  clickBonusMs: 0,
}

/** One queued job as a flat slice; progress is derived by the row from `useNow`, never selected. */
export function useJobRow(id: string): JobRowState {
  const selector = useCallback(
    (s: GameState, _d: Derived, store: GameStore): JobRowState => {
      const job = s.queue.find((j) => j.id === id)
      if (!job) return EMPTY_JOB
      const { modelById, hardwareById } = buildIndex(store.catalog)
      const model = modelById[job.modelId]
      return {
        modelId: job.modelId,
        modelName: model?.name ?? job.modelId,
        kind: model?.kind ?? 'image',
        vendorIcon: model?.vendorIcon ?? 'ai-model',
        precisionLabel: store.catalog.precisions[job.precision]?.label ?? job.precision,
        prompt: job.prompt,
        hardwareName: hardwareById[job.hardwareId]?.name ?? job.hardwareId,
        cost: job.cost,
        durationMs: job.durationMs,
        startedAt: job.startedAt,
        clickBonusMs: job.clickBonusMs,
      }
    },
    [id],
  )
  return useGameShallow(selector)
}

// ---------------------------------------------------------------------------
// Contract rows
// ---------------------------------------------------------------------------
export interface ContractRowState {
  index: number
  defId: string
  title: string
  client: string
  desc: string
  goal: string
  progress: number
  target: number
  rewardCredits: number
  rewardRp: number
  rewardCp: number
  done: boolean
  claimed: boolean
  acceptedAt: number
}

function goalLabel(goal: ContractGoal, catalog: Catalog): string {
  const { hardwareById, hashtagById } = buildIndex(catalog)
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  switch (goal.type) {
    case 'posts': {
      const what = goal.kind ? plural(goal.value, `${KIND_LABELS[goal.kind].toLowerCase()} post`) : plural(goal.value, 'post')
      return goal.tag ? `${what} tagged #${hashtagById[goal.tag]?.tag ?? goal.tag}` : what
    }
    case 'likes':
      return `${goal.value} likes`
    case 'followers':
      return `${goal.value} new followers`
    case 'ownHardware':
      return `Own ${goal.count}× ${hardwareById[goal.id]?.name ?? goal.id}`
    case 'clicks':
      return plural(goal.value, 'click')
    case 'quantize':
      return plural(goal.value, 'quantized model')
    case 'virals':
      return plural(goal.value, 'viral post')
    default: {
      const never: never = goal
      return never
    }
  }
}

/** Active contracts as flat rows, rebuilt only when a slot, its progress or its state changes. */
export function useContractRows(): ContractRowState[] {
  const store = useGameStore()
  const key = useGame((s) =>
    s.contracts.active
      .map((c) => `${c.defId}:${c.progress}:${c.target}:${c.done ? 1 : 0}:${c.claimed ? 1 : 0}:${c.rewardCredits}:${c.acceptedAt}`)
      .join('|'),
  )
  return useMemo(() => {
    const { contractById } = buildIndex(store.catalog)
    return store.state.contracts.active.map<ContractRowState>((c, index) => {
      const def = contractById[c.defId]
      return {
        index,
        defId: c.defId,
        title: def?.title ?? c.defId,
        client: def?.client ?? 'a client',
        desc: def?.desc ?? '',
        goal: def ? goalLabel(def.goal, store.catalog) : '',
        progress: c.progress,
        target: c.target,
        rewardCredits: c.rewardCredits,
        rewardRp: def?.rewardRp ?? 0,
        rewardCp: def?.rewardCp ?? 0,
        done: c.done,
        claimed: c.claimed,
        acceptedAt: c.acceptedAt,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` encodes every field read from the store
  }, [key, store])
}

// The trending chips are always on screen, the Studio is not: arm the bridge as soon as anything
// on the page imports the studio form.
ensurePickHashtagBridge()
