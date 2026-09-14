'use client'
import { memo, useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import { motion } from 'motion/react'
import { Check, Cloud, Download, GraduationCap, Lock, TrendingUp, TriangleAlert } from 'lucide-react'
import { useGameShallow, useGameStore } from '@/state/useGame'
import type { GameStore } from '@/state/store'
import { buildIndex } from '@/game/catalog'
import { bestRunnable, lockReason } from '@/game/hardware'
import { explainQuantize, explainSetup } from '@/game/guidance'
import { modelLevelLock, playerLevel } from '@/game/level'
import { quantizeOptions, setupFee } from '@/game/quantize'
import { LORA_MAP_NODE } from '@/game/actions'
import { formatNum } from '@/game/format'
import type { Derived, GameState, ModelKind } from '@/game/types'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { guideCauses } from '@/components/guidance/GuidanceHost'
import { OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import { API_COST_MULT } from '@/game/constants'
import { cn } from '@/lib/utils'
import { KIND_LABELS, useMotionOK } from '@/components/studio/studioHooks'
import { QuantizeButton } from './QuantizeButton'

export interface ModelCardState {
  name: string
  kind: ModelKind
  flavor: string
  api: boolean
  quantizable: boolean
  vram: number
  bestVram: number
  apiNodes: boolean
  /** The engine's level gate on this model: 0 when there is none or it is already cleared. */
  levelNeed: number
  playerLevel: number
  owned: boolean
  setup: boolean
  setupFee: number
  canAffordSetup: boolean
  /** A set-up model that something owned can run at an unlocked precision. */
  runnable: boolean
  /** The precision the job would run at (fastest runnable), or null. */
  runsAs: string | null
  runsOn: string | null
  lockNative: string | null
  fp8Owned: boolean
  fp8Ok: boolean
  fp8Reason: string
  fp8Fee: number
  q4Owned: boolean
  q4Ok: boolean
  q4Reason: string
  q4Fee: number
  loraUnlocked: boolean
}

const EMPTY: ModelCardState = {
  name: '',
  kind: 'image',
  flavor: '',
  api: false,
  quantizable: false,
  vram: 0,
  bestVram: 0,
  apiNodes: false,
  levelNeed: 0,
  playerLevel: 1,
  owned: false,
  setup: false,
  setupFee: 0,
  canAffordSetup: false,
  runnable: false,
  runsAs: null,
  runsOn: null,
  lockNative: null,
  fp8Owned: false,
  fp8Ok: false,
  fp8Reason: '',
  fp8Fee: 0,
  q4Owned: false,
  q4Ok: false,
  q4Reason: '',
  q4Fee: 0,
  loraUnlocked: false,
}

function selectCard(id: string, s: GameState, d: Derived, store: GameStore): ModelCardState {
  const catalog = store.catalog
  const model = buildIndex(catalog).modelById[id]
  if (!model) return EMPTY
  const entry = s.models[id]
  const fee = setupFee(model, d, catalog)
  const level = modelLevelLock(model, s)
  const [fp8, q4] = quantizeOptions(model, s, catalog)
  let runsAs: string | null = null
  let runsOn: string | null = null
  if (entry?.setup) {
    for (const p of entry.precisions) {
      const hw = bestRunnable(model, p, s, d, catalog)
      if (hw) {
        runsAs = catalog.precisions[p]?.label ?? p
        runsOn = hw.name
        break
      }
    }
  }
  return {
    name: model.name,
    kind: model.kind,
    flavor: model.flavor,
    api: model.api === true,
    quantizable: model.quantizable !== false && !model.api,
    vram: model.vram,
    bestVram: d.bestVram,
    apiNodes: d.apiNodes,
    levelNeed: level?.need ?? 0,
    playerLevel: level?.have ?? playerLevel(s),
    owned: entry !== undefined,
    setup: entry?.setup === true,
    setupFee: fee,
    canAffordSetup: s.credits >= fee,
    runnable: runsOn !== null,
    runsAs,
    runsOn,
    lockNative: lockReason(model, 'native', s, d, catalog),
    fp8Owned: fp8?.owned ?? false,
    fp8Ok: fp8?.ok ?? false,
    fp8Reason: fp8?.reason ?? '',
    fp8Fee: fp8?.fee ?? 0,
    q4Owned: q4?.owned ?? false,
    q4Ok: q4?.ok ?? false,
    q4Reason: q4?.reason ?? '',
    q4Fee: q4?.fee ?? 0,
    loraUnlocked: s.mapNodes.includes(LORA_MAP_NODE),
  }
}

/** Everything a model card renders, as a flat object so it re-renders only when a field changes. */
export function useModelCard(id: string): ModelCardState {
  const selector = useCallback((s: GameState, d: Derived, store: GameStore) => selectCard(id, s, d, store), [id])
  return useGameShallow(selector)
}

const GB = (gb: number): string => (Number.isFinite(gb) ? `${Math.round(gb * 10) / 10} GB` : '∞')

type CardState = 'ready' | 'locked' | 'needs-setup' | 'api-locked' | 'level-locked'

/** Open the Level screen: the bar, every way to earn XP, and the roadmap of what each level opens. */
function openLevel(): void {
  window.dispatchEvent(new CustomEvent<'level'>(OPEN_MODAL_EVENT, { detail: 'level' }))
}

/** One model in the store: art, kind, VRAM against your best card, setup and quantization. */
export const ModelCard = memo(function ModelCard({ id }: { id: string }) {
  const store = useGameStore()
  const card = useModelCard(id)
  const reduced = !useMotionOK()
  const [error, setError] = useState<string | null>(null)
  const onResult = useCallback((err: string | null) => setError(err), [])
  const setup = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      const anchor = e.currentTarget
      const result = store.setupModel(id)
      setError(result.error ?? null)
      if (!result.error) return
      const model = buildIndex(store.catalog).modelById[id]
      const cause = model ? explainSetup(model, store.state, store.derived, store.catalog) : null
      if (cause) guideCauses(anchor, [cause], store, model?.name ?? id)
    },
    [id, store],
  )

  // The level gate wins: it is the only lock the player cannot buy their way past today, so
  // offering "Set up" or "Unlock on the Graph" underneath it would be a dead button.
  const state: CardState = card.levelNeed > 0
    ? 'level-locked'
    : card.api && !card.apiNodes
      ? 'api-locked'
      : !card.setup
        ? 'needs-setup'
        : card.runnable
          ? 'ready'
          : 'locked'
  const stripe =
    state === 'ready' ? 'border-l-sapphire-700' : state === 'needs-setup' ? 'border-l-slot-latent' : 'border-l-slot-vae/70'
  const dimArt = state === 'api-locked' || state === 'level-locked'

  /** A refused quantize explains itself where it was clicked rather than printing one grey line. */
  const guideQuantize = useCallback(
    (e: ReactMouseEvent<HTMLElement>, precision: 'fp8' | 'q4') => {
      const model = buildIndex(store.catalog).modelById[id]
      if (!model) return
      const anchor = (e.target as HTMLElement).closest('button')
      const cause = explainQuantize(model, precision, store.state, store.catalog)
      if (anchor && cause) guideCauses(anchor, [cause], store, `${model.name} · ${precision === 'fp8' ? 'FP8' : 'Q4 GGUF'}`)
    },
    [id, store],
  )

  return (
    <article
      className={cn(
        'flex flex-col gap-2.5 rounded-[0.75rem] border-2 border-l-4 border-charcoal-400 bg-charcoal-700 p-3',
        stripe,
        state === 'locked' || state === 'api-locked' || state === 'level-locked' ? 'opacity-90' : undefined,
      )}
      aria-label={`${card.name}, ${KIND_LABELS[card.kind]} model`}
    >
      <div className="flex items-start gap-3">
        <Art id={`model-${id}`} size={56} className={dimArt ? 'opacity-60 grayscale' : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <h3 className="min-w-0 text-sm font-bold text-smoke-100">{card.name}</h3>
            <KindBadge kind={card.kind} api={card.api} levelNeed={card.levelNeed} />
          </div>
          {/* Authored copy, 88 characters at the longest, so it wraps. Half a joke under an
              ellipsis is not a joke. */}
          <p className="mt-0.5 text-[11px] leading-snug text-smoke-700">{card.flavor}</p>
        </div>
      </div>

      <VramBar api={card.api} vram={card.vram} bestVram={card.bestVram} quantizable={card.quantizable} />

      <StatusLine state={state} card={card} />

      <div className="flex flex-wrap items-center gap-1.5">
        {state === 'level-locked' ? (
          <button
            type="button"
            onClick={openLevel}
            aria-label={`${card.name} needs level ${card.levelNeed}. How do I level up?`}
            title="XP comes from posting, contracts, the Graph, achievements and every new card"
            className="inline-flex h-8 items-center gap-1.5 rounded-[0.5rem] border-2 border-charcoal-200 bg-charcoal-500 px-2.5 text-xs font-bold text-smoke-100 shadow-[0_3px_0_#0e0e0f] hover:border-electric-400"
          >
            <TrendingUp size={13} aria-hidden="true" />
            How do I level up?
          </button>
        ) : null}
        {state === 'api-locked' ? (
          <Link
            href="/map"
            className="inline-flex h-8 items-center gap-1.5 rounded-[0.5rem] border-2 border-charcoal-200 bg-charcoal-500 px-2.5 text-xs font-bold text-smoke-100 shadow-[0_3px_0_#0e0e0f] hover:border-electric-400"
          >
            <Lock size={13} aria-hidden="true" />
            Unlock on the Graph
          </Link>
        ) : null}
        {state === 'needs-setup' ? (
          <motion.button
            type="button"
            onClick={setup}
            aria-disabled={!card.canAffordSetup}
            aria-label={`Set up ${card.name}${card.setupFee > 0 ? ` for ${formatNum(card.setupFee)} credits` : ' for free'}`}
            title={
              card.setupFee > 0
                ? card.canAffordSetup
                  ? 'Bigger than your best card: pay the --lowvram tax now, quantize later'
                  : `Need ${formatNum(card.setupFee)} credits for the --lowvram setup`
                : 'Fits your best card · free download'
            }
            whileTap={reduced || !card.canAffordSetup ? undefined : { scale: 0.96, y: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-[0.5rem] border-2 px-2.5 text-xs font-extrabold',
              card.canAffordSetup
                ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_3px_0_#0e0e0f]'
                : 'cursor-not-allowed border-charcoal-400 bg-charcoal-600 text-slot-vae/70',
            )}
          >
            <Download size={13} aria-hidden="true" />
            Set up
            {card.setupFee > 0 ? (
              <span className={cn('inline-flex items-center gap-0.5 tabular-nums', card.canAffordSetup ? 'text-charcoal-800/80' : 'text-slot-vae/70')}>
                <CreditsIcon size={11} aria-hidden="true" />
                {formatNum(card.setupFee)}
              </span>
            ) : (
              <span className={cn('text-[10px] uppercase', card.canAffordSetup ? 'text-charcoal-800/70' : 'text-smoke-800')}>free</span>
            )}
          </motion.button>
        ) : null}
        {card.quantizable && state !== 'level-locked' ? (
          <>
            <span className="contents" onClickCapture={(e) => (card.fp8Ok || card.fp8Owned ? undefined : guideQuantize(e, 'fp8'))}>
              <QuantizeButton
                modelId={id}
                modelName={card.name}
                precision="fp8"
                label="FP8"
                fee={card.fp8Fee}
                owned={card.fp8Owned}
                ok={card.fp8Ok}
                reason={card.fp8Reason}
                onResult={onResult}
              />
            </span>
            <span className="contents" onClickCapture={(e) => (card.q4Ok || card.q4Owned ? undefined : guideQuantize(e, 'q4'))}>
              <QuantizeButton
                modelId={id}
                modelName={card.name}
                precision="q4"
                label="Q4"
                fee={card.q4Fee}
                owned={card.q4Owned}
                ok={card.q4Ok}
                reason={card.q4Reason}
                onResult={onResult}
              />
            </span>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slot-vae" role="alert">
          <TriangleAlert size={12} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {!card.api && !card.loraUnlocked ? (
        <Link
          href="/map"
          className="inline-flex items-center gap-1 self-start text-[11px] text-smoke-800 hover:text-electric-400"
          title="LoRA Training on the Graph unlocks a permanent likes bonus per hashtag"
        >
          <GraduationCap size={12} aria-hidden="true" />
          Train LoRA · unlock on the Graph
        </Link>
      ) : null}
    </article>
  )
})

function StatusLine({ state, card }: { state: CardState; card: ModelCardState }) {
  if (state === 'level-locked') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slot-vae/90">
        <Lock size={12} aria-hidden="true" />
        Level {card.levelNeed} · you are level {card.playerLevel}
      </p>
    )
  }
  if (state === 'api-locked') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-slot-vae/80">
        <Cloud size={12} aria-hidden="true" />
        Needs API Nodes · someone else&apos;s cluster, your prompt
      </p>
    )
  }
  if (state === 'ready') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-smoke-500">
        <Check size={12} className="text-electric-400" aria-hidden="true" />
        Ready{card.runsAs && card.runsAs !== 'Native' ? ` (${card.runsAs})` : ''}
        {card.runsOn ? <span className="text-smoke-700">· on {card.runsOn}</span> : null}
      </p>
    )
  }
  if (state === 'needs-setup') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-smoke-600">
        <Download size={12} className="text-slot-latent" aria-hidden="true" />
        {card.api ? 'Not set up · no local VRAM needed' : card.setupFee > 0 ? 'Needs setup · too big for your best card' : 'Needs setup · fits your best card'}
      </p>
    )
  }
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-slot-vae/80" title={card.lockNative ?? undefined}>
      <Lock size={12} className="mt-px shrink-0" aria-hidden="true" />
      <span className="min-w-0">{card.lockNative ?? 'Nothing you own can run this'}</span>
    </p>
  )
}

function KindBadge({ kind, api, levelNeed }: { kind: ModelKind; api: boolean; levelNeed: number }) {
  const tone: Record<ModelKind, string> = {
    image: 'bg-slot-image/20 text-slot-image',
    video: 'bg-slot-latent/20 text-slot-latent',
    '3d': 'bg-slot-mask/20 text-slot-mask',
    audio: 'bg-slot-cond/20 text-slot-cond',
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className={cn('rounded-[0.3rem] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide', tone[kind])}>{KIND_LABELS[kind]}</span>
      {api ? <span className="rounded-[0.3rem] bg-charcoal-400 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-smoke-500">API</span> : null}
      {levelNeed > 0 ? (
        <span
          className="rounded-[0.3rem] border border-slot-vae/60 bg-slot-vae/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide tabular-nums text-slot-vae"
          title={`Unlocks at level ${levelNeed}`}
        >
          LV {levelNeed}
        </span>
      ) : null}
    </span>
  )
}

/** Your best card against the model's native weights, with FP8 and Q4 markers. */
function VramBar({ api, vram, bestVram, quantizable }: { api: boolean; vram: number; bestVram: number; quantizable: boolean }) {
  if (api) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-smoke-800">
        <Cloud size={12} aria-hidden="true" />
        No VRAM · runs on someone else&apos;s GPU · job cost ×{API_COST_MULT}
      </div>
    )
  }
  const ratio = vram > 0 ? bestVram / vram : 1
  const fill = Math.max(0, Math.min(1, ratio))
  const fits = ratio >= 1
  const fitsFp8 = ratio >= 0.5
  const fitsQ4 = ratio >= 0.3
  const tone = fits ? 'bg-slot-mask' : fitsFp8 || fitsQ4 ? 'bg-electric-400' : 'bg-slot-vae'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] tabular-nums">
        <span className="text-smoke-700">
          Needs <span className="font-semibold text-smoke-500">{GB(vram)}</span>
        </span>
        <span className={cn('font-semibold', fits ? 'text-slot-mask' : fitsQ4 ? 'text-electric-400' : 'text-slot-vae')}>
          best card {GB(bestVram)}
        </span>
      </div>
      <div
        className="relative h-2 rounded-full bg-charcoal-500"
        role="meter"
        aria-label="Best card VRAM against the model's native requirement"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${fill * 100}%` }} />
        {quantizable ? (
          <>
            <Marker at={0.3} label="Q4" reached={fitsQ4} />
            <Marker at={0.5} label="FP8" reached={fitsFp8} />
          </>
        ) : null}
        <Marker at={1} label="Native" reached={fits} />
      </div>
    </div>
  )
}

function Marker({ at, label, reached }: { at: number; label: string; reached: boolean }) {
  return (
    <span
      className={cn('absolute -top-0.5 h-3 w-0.5 rounded-full', reached ? 'bg-smoke-100' : 'bg-charcoal-100')}
      style={{ left: `calc(${at * 100}% - 1px)` }}
      title={`${label} weights fit at ${Math.round(at * 100)}% of the native VRAM`}
      aria-hidden="true"
    />
  )
}
