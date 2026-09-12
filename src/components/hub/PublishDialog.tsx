'use client'
/**
 * "Publish to ComfyHub": name a recipe (model, precision, up to three hashtags, an optional
 * trained LoRA and an upscale pass) and put it on the hub for other players to run. Opens on
 * `comfy:open-modal` with detail `'hub-publish'` (or `{ id: 'hub-publish', ...prefill }`),
 * prefilled from the event or the current Studio form. Guests are bounced to the auth sheet and
 * the dialog opens by itself once they are signed in.
 *
 * Only the first mounted instance answers the event, so the Studio and the hub page can both
 * mount one without two dialogs opening.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight, Check, Flame, Loader2, Lock, LogIn, TriangleAlert, Upload, WandSparkles, Workflow } from 'lucide-react'
import { openAuthSheet, useAuth } from '@/components/auth/useAuth'
import { Art } from '@/components/common/Art'
import { ModalBase, ModalButton, OPEN_MODAL_EVENT, SectionLabel } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { VendorIcon } from '@/components/studio/ModelChips'
import { FOCUS_RING, KIND_LABELS, isTypeTag, useModelRoster, useMotionOK, useStudioSelection, useTrending, type ModelRosterEntry } from '@/components/studio/studioHooks'
import { PRECISION_ORDER } from '@/data/precisions'
import { buildIndex } from '@/game/catalog'
import type { HashtagDef, Precision } from '@/game/types'
import { cn } from '@/lib/utils'
import { useGame, useGameStore } from '@/state/useGame'
import { HUB_MAX_HASHTAGS, HUB_NAME_MAX, HUB_ROYALTY_RATE, HubClientError, publishHubWorkflow, readHubPublishDetail, type HubPublishPrefill } from './useHub'

/** The instance that answers open events; the first to mount wins. */
let owner: symbol | null = null

interface Draft {
  name: string
  modelId: string
  precision: Precision
  hashtags: string[]
  loraTag: string | null
  upscaler: boolean
}

const PRESS = { type: 'spring', stiffness: 500, damping: 30 } as const

const INPUT =
  'w-full rounded-lg border-2 border-charcoal-400 bg-charcoal-700 px-3 py-2 font-inter text-sm text-smoke-100 outline-none placeholder:text-smoke-800 focus:border-electric-400'

/** "Flux Dev FP8 · #wan22 #fluxkontext", trimmed to the name cap. */
function suggestName(modelName: string, precisionLabel: string, tags: readonly string[], tagOf: (id: string) => string): string {
  const base = precisionLabel === 'Native' ? modelName : `${modelName} ${precisionLabel}`
  const withTags = tags.length ? `${base} · ${tags.map((t) => `#${tagOf(t)}`).join(' ')}` : base
  return withTags.slice(0, HUB_NAME_MAX)
}

export function PublishDialog() {
  const store = useGameStore()
  const auth = useAuth()
  const motionOk = useMotionOK()
  const studio = useStudioSelection()
  const roster = useModelRoster()
  const { trending } = useTrending()
  const loras = useGame((s) => s.loras.join(','))
  const trainedLoras = useMemo(() => (loras ? loras.split(',') : []), [loras])

  const [me] = useState(() => Symbol('publish-dialog'))

  const [open, setOpen] = useState(false)
  const [prefill, setPrefill] = useState<HubPublishPrefill | null>(null)
  /** A guest asked to publish: open as soon as they are signed in. */
  const [armed, setArmed] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { modelById, hashtagById } = buildIndex(store.catalog)
  const tagOf = useCallback((id: string) => hashtagById[id]?.tag ?? id, [hashtagById])
  const publishable = useMemo(() => roster.filter((e) => e.setup && e.precisions.some((p) => e.runnable[p])), [roster])

  // Claim the event on mount; release on unmount.
  useEffect(() => {
    if (owner === null) owner = me
    return () => {
      if (owner === me) owner = null
    }
  }, [me])

  /** Seed a draft from a prefill (the event's) or the Studio form; the prefill wins field by field. */
  const buildDraft = useCallback(
    (pre: HubPublishPrefill | null): Draft => {
      const wantModel = pre?.modelId ?? studio.modelId
      const entry = publishable.find((e) => e.model.id === wantModel) ?? publishable[0] ?? null
      const modelId = entry?.model.id ?? ''
      const wantPrecision = pre?.precision ?? studio.precision
      const precision: Precision =
        entry && entry.precisions.includes(wantPrecision) && entry.runnable[wantPrecision]
          ? wantPrecision
          : (entry?.precisions.find((p) => entry.runnable[p]) ?? 'native')
      const rawTags = pre?.hashtags ?? studio.tags
      const hashtags = Array.from(new Set(rawTags.filter((id) => hashtagById[id] !== undefined))).slice(0, HUB_MAX_HASHTAGS)
      const wantLora = pre?.loraTag !== undefined ? pre.loraTag : (hashtags.find((id) => trainedLoras.includes(id)) ?? null)
      const precisionLabel = store.catalog.precisions[precision]?.label ?? precision
      const name = pre?.name?.slice(0, HUB_NAME_MAX) || (entry ? suggestName(entry.model.name, precisionLabel, hashtags, tagOf) : '')
      return { name, modelId, precision, hashtags, loraTag: wantLora && trainedLoras.includes(wantLora) ? wantLora : null, upscaler: pre?.upscaler ?? false }
    },
    [studio.modelId, studio.precision, studio.tags, publishable, hashtagById, trainedLoras, store, tagOf],
  )

  // The open handler is registered once; it reads the latest auth status and draft builder through refs.
  const latest = useRef({ status: auth.status, buildDraft })
  useEffect(() => {
    latest.current = { status: auth.status, buildDraft }
  })

  useEffect(() => {
    const onOpen = (e: Event) => {
      if (owner !== me) return
      const next = readHubPublishDetail((e as CustomEvent<unknown>).detail)
      if (!next) return
      const status = latest.current.status
      if (status === 'unavailable') {
        toast('ComfyHub needs an account', {
          title: 'ComfyHub',
          description: 'Cloud accounts are switched off on this build. Guest saves still live in this browser.',
          tone: 'danger',
          key: 'hub-publish-auth',
        })
        return
      }
      setPrefill(next)
      if (status === 'guest') {
        setArmed(true)
        toast('Sign in to publish', {
          title: 'ComfyHub',
          description: 'A workflow needs a handle on the card. Sign in and the dialog opens by itself.',
          icon: <LogIn className="text-[#7f8dff]" />,
          tone: 'sapphire',
          key: 'hub-publish-auth',
        })
        openAuthSheet('sign-in')
        return
      }
      setDraft(latest.current.buildDraft(next))
      setError(null)
      setOpen(true)
    }
    window.addEventListener(OPEN_MODAL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_MODAL_EVENT, onOpen)
  }, [me])

  // A guest who was bounced to the auth sheet comes back here once signed in (after the sheet has closed).
  useEffect(() => {
    if (!armed || auth.status !== 'signed-in') return
    const t = window.setTimeout(() => {
      setArmed(false)
      setDraft(latest.current.buildDraft(prefill))
      setError(null)
      setOpen(true)
    }, 250)
    return () => window.clearTimeout(t)
  }, [armed, auth.status, prefill])

  const close = useCallback(() => {
    setOpen(false)
    setBusy(false)
  }, [])

  const patch = useCallback((p: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d))
    setError(null)
  }, [])

  const entry = draft ? (publishable.find((e) => e.model.id === draft.modelId) ?? null) : null
  const model = draft ? modelById[draft.modelId] : undefined
  const nameTrimmed = draft?.name.trim() ?? ''
  const blocker =
    !draft || !entry
      ? 'Set up a model you can run before publishing'
      : !nameTrimmed
        ? 'Give the workflow a name'
        : nameTrimmed.length > HUB_NAME_MAX
          ? `Names cap at ${HUB_NAME_MAX} characters`
          : !entry.precisions.includes(draft.precision)
            ? `Quantize ${entry.model.name} to ${store.catalog.precisions[draft.precision].label} first`
            : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft || blocker || busy) return
    if (auth.status !== 'signed-in') {
      setArmed(true)
      openAuthSheet('sign-in')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const workflow = await publishHubWorkflow({
        name: nameTrimmed,
        modelId: draft.modelId,
        precision: draft.precision,
        hashtags: draft.hashtags,
        loraTag: draft.loraTag,
        upscaler: draft.upscaler,
      })
      toast(`Published “${workflow.name}”`, {
        title: 'ComfyHub',
        description: `Every run pays you ${Math.round(HUB_ROYALTY_RATE * 100)}% of the job and bumps your rep. Nobody has to credit you. The hub does it for them.`,
        icon: <Workflow className="text-electric-400" />,
        tone: 'electric',
        key: 'hub-published',
        durationMs: 4500,
      })
      close()
    } catch (err) {
      setBusy(false)
      if (err instanceof HubClientError && err.status === 401) {
        setArmed(true)
        openAuthSheet('sign-in')
        return
      }
      setError(err instanceof Error ? err.message : 'ComfyHub did not answer')
    }
  }

  const handle = auth.handle ?? (auth.user?.email ? auth.user.email.split('@')[0] : 'you')
  const hot = useMemo(() => new Set(trending), [trending])

  return (
    <ModalBase
      open={open}
      onClose={close}
      title="Publish to ComfyHub"
      icon={<Upload size={16} />}
      stripe="sapphire"
      size="lg"
      right={auth.status === 'signed-in' ? <span className="font-semibold text-smoke-100">@{handle}</span> : null}
      footer={
        <>
          <ModalButton tone="ghost" onClick={close} disabled={busy}>
            Cancel
          </ModalButton>
          <ModalButton
            tone="primary"
            size="lg"
            type="submit"
            form="hub-publish-form"
            disabled={busy || blocker !== null}
            aria-disabled={busy || blocker !== null}
            title={blocker ?? 'Put it on the hub'}
          >
            {busy ? <Loader2 size={16} className={motionOk ? 'animate-spin' : undefined} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
            {busy ? 'Publishing' : 'Publish'}
          </ModalButton>
        </>
      }
    >
      {auth.status === 'guest' ? (
        <SignInPrompt />
      ) : !draft ? (
        <p className="py-6 text-center text-sm text-smoke-600">Reading the Studio…</p>
      ) : publishable.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-charcoal-400 bg-charcoal-700/40 px-4 py-8 text-center">
          <Lock size={20} className="text-slot-vae/70" aria-hidden="true" />
          <p className="text-sm font-bold text-smoke-100">Nothing to publish yet</p>
          <p className="max-w-sm text-xs text-smoke-600">A workflow is a model you can actually run. Set one up in the Store, generate once so you know it works, then come back.</p>
        </div>
      ) : (
        <form id="hub-publish-form" onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="hub-publish-name" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
                Workflow name
              </label>
              <span className={cn('text-[11px] tabular-nums', nameTrimmed.length > HUB_NAME_MAX - 8 ? 'text-electric-400' : 'text-smoke-800')}>
                {draft.name.length}/{HUB_NAME_MAX}
              </span>
            </div>
            <input
              id="hub-publish-name"
              data-autofocus
              value={draft.name}
              maxLength={HUB_NAME_MAX}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Kontext portrait pass, no negative, trust me"
              autoComplete="off"
              spellCheck={false}
              className={INPUT}
            />
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Model · what you can run</SectionLabel>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model">
              {publishable.map((e) => (
                <ModelChip
                  key={e.model.id}
                  entry={e}
                  selected={e.model.id === draft.modelId}
                  motionOk={motionOk}
                  onSelect={() => {
                    const p = e.precisions.includes(draft.precision) && e.runnable[draft.precision] ? draft.precision : (e.precisions.find((q) => e.runnable[q]) ?? 'native')
                    patch({ modelId: e.model.id, precision: p })
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Precision</SectionLabel>
            <div className="inline-flex w-fit items-center gap-1 rounded-xl border-2 border-charcoal-400 bg-charcoal-700 p-1" role="radiogroup" aria-label="Precision">
              {PRECISION_ORDER.map((p) => {
                const def = store.catalog.precisions[p]
                const owned = entry?.precisions.includes(p) ?? false
                const runnable = entry?.runnable[p] ?? false
                const enabled = owned && runnable
                const on = draft.precision === p
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-disabled={!enabled}
                    title={!owned ? `Quantize ${entry?.model.name ?? 'the model'} to ${def.label} first` : !runnable ? (entry?.lockReasons[p] ?? 'Nothing you own can run this') : def.label}
                    onClick={() => {
                      if (enabled) patch({ precision: p })
                    }}
                    className={cn(
                      'relative inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-bold uppercase tracking-[0.08em] transition-colors',
                      FOCUS_RING,
                      on ? 'text-charcoal-800' : enabled ? 'text-smoke-600 hover:bg-charcoal-500 hover:text-smoke-100' : 'cursor-not-allowed text-smoke-800',
                    )}
                  >
                    {on ? (
                      <motion.span
                        layoutId="hub-publish-precision"
                        aria-hidden="true"
                        className="absolute inset-0 rounded-lg bg-electric-400 shadow-[0_2px_0_#8a9a00]"
                        transition={motionOk ? { type: 'spring', stiffness: 520, damping: 38 } : { duration: 0 }}
                      />
                    ) : null}
                    <span className="relative z-10 inline-flex items-center gap-1">
                      {!enabled ? <Lock size={11} aria-hidden="true" /> : null}
                      {def.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <SectionLabel>Hashtags</SectionLabel>
              <span className={cn('text-[11px] tabular-nums', draft.hashtags.length >= HUB_MAX_HASHTAGS ? 'text-electric-400' : 'text-smoke-800')}>
                {draft.hashtags.length}/{HUB_MAX_HASHTAGS}
              </span>
            </div>
            <TagPicker
              hashtags={store.catalog.hashtags}
              selected={draft.hashtags}
              hot={hot}
              motionOk={motionOk}
              onToggle={(id) => {
                if (draft.hashtags.includes(id)) patch({ hashtags: draft.hashtags.filter((t) => t !== id), loraTag: draft.loraTag === id ? null : draft.loraTag })
                else if (draft.hashtags.length < HUB_MAX_HASHTAGS) patch({ hashtags: [...draft.hashtags, id] })
              }}
            />
            <p className="text-[11px] text-smoke-800">Trending tags rank the card higher on the hub, and stay honest: three trending tags on a post reads as spam to the algorithm.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-xl border border-charcoal-400 bg-charcoal-700/60 p-3">
              <label htmlFor="hub-publish-lora" className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
                <WandSparkles size={12} className="text-slot-mask" aria-hidden="true" />
                LoRA
              </label>
              {trainedLoras.length > 0 ? (
                <select
                  id="hub-publish-lora"
                  value={draft.loraTag ?? ''}
                  onChange={(e) => patch({ loraTag: e.target.value || null })}
                  className={cn('h-9 rounded-lg border-2 border-charcoal-400 bg-charcoal-700 px-2 text-sm font-semibold text-smoke-100', FOCUS_RING)}
                >
                  <option value="">No LoRA</option>
                  {trainedLoras.map((id) => (
                    <option key={id} value={id}>
                      #{tagOf(id)} LoRA
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-smoke-800">
                  <span id="hub-publish-lora" className="sr-only">No LoRA</span>
                  Train a LoRA on the Graph to ship one with the workflow.
                </p>
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-charcoal-400 bg-charcoal-700/60 p-3">
              <input
                type="checkbox"
                checked={draft.upscaler}
                onChange={(e) => patch({ upscaler: e.target.checked })}
                className="mt-0.5 size-4 shrink-0 accent-electric-400"
              />
              <span className="min-w-0">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
                  <ArrowUpRight size={12} className="text-slot-image" aria-hidden="true" />
                  Upscale pass
                </span>
                <span className="block text-xs text-smoke-800">Ends with an upscale. Runners pay for it separately; the card says so.</span>
              </span>
            </label>
          </div>

          {model && entry ? (
            <div className="flex items-center gap-3 rounded-xl border-2 border-charcoal-400 border-l-4 border-l-sapphire-700 bg-charcoal-600 p-3">
              <div className="relative shrink-0">
                <Art id={`model-${model.id}`} size={44} alt={model.name} />
                <span className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-[0.354em] border border-charcoal-300 bg-charcoal-800">
                  <VendorIcon icon={model.vendorIcon} size={12} className="opacity-90" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold tracking-tight text-smoke-100">{nameTrimmed || 'Untitled workflow'}</p>
                <p className="truncate text-xs text-smoke-600">
                  by <span className="font-semibold text-smoke-100">@{handle}</span> · {model.name}
                  {model.kind !== 'image' ? ` (${KIND_LABELS[model.kind]})` : ''} · {store.catalog.precisions[draft.precision].label}
                  {draft.hashtags.length ? ` · ${draft.hashtags.map((t) => `#${tagOf(t)}`).join(' ')}` : ''}
                </p>
                <p className="text-[11px] text-smoke-800">
                  Runs on {entry.hardwareName[draft.precision] ?? 'your rig'} · {Math.round(HUB_ROYALTY_RATE * 100)}% of every run comes back as royalty
                </p>
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="flex items-center gap-1.5 rounded-lg border border-slot-vae/50 bg-slot-vae/10 px-2.5 py-1.5 text-xs font-semibold text-slot-vae">
              <TriangleAlert size={14} aria-hidden="true" />
              {error}
            </p>
          ) : blocker ? (
            <p className="flex items-center gap-1.5 text-xs text-smoke-700" role="status">
              <TriangleAlert size={14} className="text-slot-vae/70" aria-hidden="true" />
              {blocker}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-smoke-800" role="status">
              <Check size={14} className="text-electric-400" aria-hidden="true" />
              Ready. Publishing is free; the only thing you spend is your reputation.
            </p>
          )}
        </form>
      )}
    </ModalBase>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SignInPrompt() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-charcoal-400 bg-charcoal-700/40 px-4 py-8 text-center">
      <span className="grid size-12 place-items-center rounded-[0.354em] border-2 border-charcoal-400 bg-charcoal-700 text-[#7f8dff] shadow-[0_3px_0_#0e0e0f]">
        <LogIn size={22} aria-hidden="true" />
      </span>
      <p className="text-sm font-bold text-smoke-100">Sign in to publish</p>
      <p className="max-w-sm text-xs text-smoke-600">Workflows carry a handle so the royalties know where to go. Your guest save stays exactly where it is.</p>
      <ModalButton tone="sapphire" onClick={() => openAuthSheet('sign-in')} data-autofocus>
        <LogIn size={14} aria-hidden="true" />
        Sign in
      </ModalButton>
    </div>
  )
}

function ModelChip({ entry, selected, motionOk, onSelect }: { entry: ModelRosterEntry; selected: boolean; motionOk: boolean; onSelect: () => void }) {
  const { model } = entry
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      whileTap={motionOk ? { scale: 0.96 } : undefined}
      transition={PRESS}
      title={`${model.name}${model.kind !== 'image' ? ` · ${KIND_LABELS[model.kind]}` : ''}`}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-xl border-2 pr-3 pl-1 text-sm font-semibold transition-colors',
        FOCUS_RING,
        selected ? 'border-electric-400 bg-electric-400/10 text-smoke-100' : 'border-charcoal-400 bg-charcoal-700 text-smoke-600 hover:border-charcoal-300 hover:text-smoke-100',
      )}
    >
      <Art id={`model-${model.id}`} size={26} alt="" />
      <span className="truncate">{model.name}</span>
      {model.kind !== 'image' ? <span className="rounded-[0.354em] bg-charcoal-800/60 px-1 text-[10px] font-bold uppercase tracking-wide text-smoke-600">{KIND_LABELS[model.kind]}</span> : null}
    </motion.button>
  )
}

function TagPicker({
  hashtags,
  selected,
  hot,
  motionOk,
  onToggle,
}: {
  hashtags: readonly HashtagDef[]
  selected: readonly string[]
  hot: ReadonlySet<string>
  motionOk: boolean
  onToggle: (id: string) => void
}) {
  const full = selected.length >= HUB_MAX_HASHTAGS
  const ordered = useMemo(() => {
    const first: HashtagDef[] = []
    const rest: HashtagDef[] = []
    for (const h of hashtags) (hot.has(h.id) ? first : rest).push(h)
    return [...first, ...rest]
  }, [hashtags, hot])
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((def) => {
        const on = selected.includes(def.id)
        const isHot = hot.has(def.id)
        const disabled = !on && full
        return (
          <motion.button
            key={def.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-disabled={disabled}
            aria-label={`#${def.tag}${isHot ? ' (trending)' : ''}`}
            title={disabled ? `Up to ${HUB_MAX_HASHTAGS} hashtags` : isTypeTag(def) ? `#${def.tag} · type tag` : `#${def.tag}`}
            onClick={() => {
              if (!disabled) onToggle(def.id)
            }}
            whileTap={motionOk && !disabled ? { scale: 0.95 } : undefined}
            transition={PRESS}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors',
              FOCUS_RING,
              on
                ? isHot
                  ? 'border-electric-400 bg-electric-400 text-charcoal-800'
                  : 'border-smoke-500 bg-smoke-100 text-charcoal-800'
                : isHot
                  ? 'border-electric-400/70 bg-electric-400/10 text-electric-400 hover:bg-electric-400/20'
                  : 'border-charcoal-300 bg-charcoal-500 text-smoke-600 hover:border-charcoal-100 hover:text-smoke-100',
              disabled && 'cursor-not-allowed opacity-45 hover:border-charcoal-300 hover:text-smoke-600',
            )}
          >
            {isHot ? <Flame size={11} aria-hidden="true" /> : null}#{def.tag}
          </motion.button>
        )
      })}
    </div>
  )
}
