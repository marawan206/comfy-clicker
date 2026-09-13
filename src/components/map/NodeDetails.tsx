'use client'
/**
 * Right-hand details panel for the selected Graph node: branch and state, title, description,
 * what it does (one chip per effect), the price against your balance, why it is locked (missing
 * parents are chips that jump to them), what it leads to, and the Unlock button. Unlocking pops
 * the button, bursts credit diamonds from it and lets the canvas repaint the node electric.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimate } from 'motion/react'
import { ArrowRight, Check, Lock, Sparkles, X } from 'lucide-react'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { ComfyMark } from '@/components/brand/ComfyMark'
import { Art } from '@/components/common/Art'
import { ModalButton, SectionLabel } from '@/components/overlays/ModalBase'
import { runGuideAction } from '@/components/guidance/navigate'
import { stepsFor, type GuideStep } from '@/components/guidance/lockGuide'
import { summarizeEffects } from '@/components/store/storeHooks'
import { UpgradeIcon } from '@/components/store/UpgradeRow'
import { formatDuration, formatNum } from '@/game/format'
import { explainMapNode } from '@/game/guidance'
import { isMarker, mapNodeCost } from '@/game/map'
import type { MapNodeDef } from '@/game/types'
import { cn } from '@/lib/utils'
import { useGameStore } from '@/state/useGame'
import { useNodeStatus, useReducedMotionPref, useUnlockNode } from './mapHooks'
import { BRANCH_META, CURRENCY_LABEL, type MapSets, type NodeStatus, type StaticLayout, statusOf } from './mapLayout'

export interface NodeDetailsProps {
  def: MapNodeDef
  layout: StaticLayout
  /** Live id sets, for the state dots on parent/child chips. */
  sets: MapSets
  onClose: () => void
  /** Jump to another node (parents, children). */
  onSelect: (id: string) => void
  /** Unlock through the canvas, so the "unlocked" toast can offer to show the node. */
  onUnlock?: (def: MapNodeDef, point?: { x: number; y: number }) => boolean
}

const STATUS_WORD: Record<NodeStatus, string> = { owned: 'Unlocked', available: 'Available', locked: 'Locked' }
const STATUS_CLASS: Record<NodeStatus, string> = { owned: 'text-electric-400', available: 'text-electric-400', locked: 'text-smoke-800' }
const DOT_CLASS: Record<NodeStatus, string> = { owned: 'bg-electric-400', available: 'bg-electric-400/50 ring-2 ring-electric-400/30', locked: 'bg-charcoal-300' }

const SLIDE = { type: 'spring', stiffness: 380, damping: 32 } as const

export function NodeDetails({ def, layout, sets, onClose, onSelect, onUnlock }: NodeDetailsProps) {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const { status, affordable, reason, balance, missing } = useNodeStatus(def)
  const unlockNode = useUnlockNode()
  const [scope, animate] = useAnimate<HTMLSpanElement>()
  const [justUnlocked, setJustUnlocked] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const meta = BRANCH_META[def.branch]
  const cost = mapNodeCost(def)
  // The LoRA trainer's `tagLikes '*'` is a marker for the studio, not a stat line.
  const effects = summarizeEffects(def.effects.filter((e) => !(e.kind === 'tagLikes' && e.tag === '*')), store.catalog)
  const effectChips = effects ? effects.split(' · ') : []
  const missingIds = missing ? missing.split('|') : []
  const children = layout.children[def.id] ?? []
  const short = Math.max(0, cost - balance)
  // The same engine causes the guidance popover uses, rendered inline: on the Graph the player is
  // already where the answer is, so a popover would only cover the node they are looking at.
  const steps = useMemo(
    () => stepsFor(explainMapNode(def, store.state, store.derived, store.catalog), store, def.title).steps,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `balance` and `status` are the slice that moves; the store object is stable
    [def, store, balance, status, missing],
  )

  // Selecting another node scrolls the panel back to the top so the title is what you see.
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 })
  }, [def.id])

  const unlock = useCallback(() => {
    const el = scope.current
    const rect = el?.getBoundingClientRect()
    const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
    const ok = (onUnlock ?? unlockNode)(def, point)
    if (!ok) {
      if (el && !reduced) void animate(el, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.35 })
      return
    }
    setJustUnlocked(def.id)
    if (el && !reduced) void animate(el, { scale: [1, 1.14, 0.98, 1] }, { duration: 0.45, ease: 'easeOut' })
  }, [animate, def, onUnlock, reduced, scope, unlockNode])

  return (
    <motion.aside
      aria-label={`${def.title} details`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={reduced ? { duration: 0.1 } : SLIDE}
      className={cn(
        'cc-map__details absolute z-10 flex flex-col overflow-hidden rounded-2xl border-2 border-charcoal-400 border-l-4 bg-charcoal-600 shadow-[0_4px_0_#0e0e0f,0_24px_60px_rgba(0,0,0,0.45)]',
        'inset-x-3 bottom-3 max-h-[62%] md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:max-h-none md:w-[340px]',
      )}
      style={{ borderLeftColor: meta.color }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-charcoal-400/70 px-4 py-2">
        <p className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
          {meta.art ? <Art id={meta.art} size={16} radius="3px" alt="" /> : <ComfyMark size={13} className="text-electric-400" />}
          <span className="truncate" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span aria-hidden="true" className="text-charcoal-200">
            ·
          </span>
          <span className={STATUS_CLASS[status]}>{STATUS_WORD[status]}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close node details"
          className="grid size-7 shrink-0 place-items-center rounded-comfy text-smoke-800 transition-colors hover:bg-charcoal-500 hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div ref={panelRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={def.id}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduced ? 0 : 0.14, ease: 'easeOut' }}
            className="flex flex-col gap-4"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-comfy border-2 border-charcoal-400 bg-charcoal-700 shadow-[0_3px_0_#0e0e0f]"
                style={{ color: meta.color }}
              >
                <UpgradeIcon icon={def.icon} size={24} />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg leading-tight font-extrabold tracking-tight text-smoke-100">{def.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-smoke-600">{def.desc}</p>
              </div>
            </div>

            <section aria-label="Effects">
              <SectionLabel className="mb-1.5">Does</SectionLabel>
              {effectChips.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {effectChips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-comfy border border-charcoal-400 bg-charcoal-700 px-2 py-1 text-xs font-semibold tabular-nums text-smoke-100"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-smoke-600">
                  {isMarker(def.id)
                    ? 'No stat line. This node switches something on elsewhere. The description says where.'
                    : cost === 0
                      ? 'Nothing yet. It is the root; the rest of the graph hangs off it.'
                      : 'Story node. Bragging rights only.'}
                </p>
              )}
            </section>

            <section aria-label="Cost" className="grid grid-cols-2 gap-2">
              <div className="rounded-comfy border border-charcoal-400 bg-charcoal-700 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">Cost</p>
                <p className="mt-0.5 flex items-center gap-1 text-base font-extrabold tabular-nums">
                  {cost === 0 ? (
                    <span className="text-smoke-100">Free</span>
                  ) : def.currency === 'credits' ? (
                    <>
                      <CreditsIcon size={14} className="shrink-0 text-credits" />
                      <span className="text-credits">{formatNum(cost)}</span>
                    </>
                  ) : (
                    <span style={{ color: meta.color }}>
                      {formatNum(cost)} {CURRENCY_LABEL[def.currency]}
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-comfy border border-charcoal-400 bg-charcoal-700 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">You have</p>
                <p className={cn('mt-0.5 flex items-center gap-1 text-base font-extrabold tabular-nums', status !== 'owned' && short > 0 ? 'text-slot-vae/80' : 'text-smoke-100')}>
                  {def.currency === 'credits' ? <CreditsIcon size={14} className="shrink-0 text-credits" /> : null}
                  {formatNum(balance)}
                  {def.currency !== 'credits' ? <span className="text-xs text-smoke-600">{CURRENCY_LABEL[def.currency]}</span> : null}
                </p>
              </div>
            </section>

            {steps.length > 0 ? (
              <section aria-label="Requirements" className="rounded-xl border border-slot-vae/30 bg-slot-vae/5 p-3">
                <SectionLabel className="mb-1.5 flex items-center gap-1.5 text-slot-vae">
                  <Lock size={12} aria-hidden="true" />
                  {status === 'locked' ? 'Locked' : 'Short'}
                </SectionLabel>
                <ol className="flex flex-col gap-2">
                  {steps.map((step, i) => (
                    <RequirementRow key={`${step.label}-${i}`} step={step} index={i} onSelect={onSelect} />
                  ))}
                </ol>
              </section>
            ) : null}

            {children.length > 0 ? (
              <section aria-label="Leads to">
                <SectionLabel className="mb-1.5 flex items-center gap-1.5">
                  <ArrowRight size={12} aria-hidden="true" />
                  Leads to
                </SectionLabel>
                <ul className="flex flex-wrap gap-1.5">
                  {children
                    .filter((id) => {
                      const child = layout.byId[id]
                      return child !== undefined && (!child.hidden || sets.surfaced.has(id))
                    })
                    .map((id) => (
                      <li key={id}>
                        <NodeChip id={id} layout={layout} sets={sets} onSelect={onSelect} />
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-charcoal-400/70 px-4 py-3">
        {status === 'owned' ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-electric-400">
            <Check size={16} aria-hidden="true" />
            {justUnlocked === def.id ? 'Unlocked. The noodles are live.' : 'Unlocked'}
          </p>
        ) : status === 'available' ? (
          <p className="text-xs text-smoke-600">
            {affordable ? (
              'Every parent is owned. Pay and it is yours.'
            ) : (
              <>
                Short by{' '}
                <span className={cn('font-semibold tabular-nums', def.currency === 'credits' ? 'text-credits' : 'text-smoke-100')}>
                  {formatNum(short)} {CURRENCY_LABEL[def.currency]}
                </span>
                {def.currency === 'rp' ? '. Signups earn RP.' : def.currency === 'cp' ? '. Rebrand to earn CP.' : '.'}
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-smoke-600">{missingIds.length > 0 ? 'Walk the noodles back first.' : reason}</p>
        )}
        {status !== 'owned' ? (
          <span ref={scope} className="inline-flex shrink-0">
            <ModalButton
              tone="primary"
              size="md"
              onClick={unlock}
              disabled={status === 'locked'}
              aria-disabled={status === 'locked' || !affordable ? 'true' : undefined}
              title={status === 'locked' ? reason : affordable ? `Unlock ${def.title}` : `Not enough ${CURRENCY_LABEL[def.currency]}`}
              className={cn(status === 'available' && !affordable && 'opacity-60')}
            >
              <Sparkles size={14} aria-hidden="true" />
              Unlock
            </ModalButton>
          </span>
        ) : null}
      </footer>
    </motion.aside>
  )
}

/**
 * One requirement as a row: what is missing, where it lives, and a button. A `map` step stays on
 * this canvas (select the node) instead of pushing a route we are already on.
 */
function RequirementRow({ step, index, onSelect }: { step: GuideStep; index: number; onSelect: (id: string) => void }) {
  const action = step.action
  const go = useCallback(() => {
    if (!action) return
    if (action.type === 'map') onSelect(action.nodeId)
    else runGuideAction(action)
  }, [action, onSelect])

  return (
    <li className="flex gap-2">
      <span
        aria-hidden="true"
        className="mt-px grid size-[18px] shrink-0 place-items-center rounded-[0.354em] border border-charcoal-400 bg-charcoal-700 text-[10px] font-extrabold tabular-nums text-smoke-600"
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 text-xs font-semibold leading-snug text-smoke-100">{step.label}</span>
          {step.cost !== undefined ? (
            <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-credits">{formatNum(step.cost)}</span>
          ) : null}
        </div>
        {step.detail ? <p className="mt-0.5 text-[11px] leading-snug text-smoke-600">{step.detail}</p> : null}
        {step.etaSec !== undefined && Number.isFinite(step.etaSec) ? (
          <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-electric-400">{formatDuration(step.etaSec)} at your rate</p>
        ) : null}
        {action ? (
          <button
            type="button"
            onClick={go}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-electric-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
          >
            {action.type === 'map' ? 'Show me' : 'Take me there'}
            <ArrowRight size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  )
}

/** A small clickable node reference with a state dot, for the parents / children lists. */
function NodeChip({ id, layout, sets, onSelect }: { id: string; layout: StaticLayout; sets: MapSets; onSelect: (id: string) => void }) {
  const def = layout.byId[id]
  if (!def) return null
  const status = statusOf(id, sets)
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      title={`${def.title} · ${STATUS_WORD[status]}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-comfy border border-charcoal-400 bg-charcoal-700 px-2 py-1 text-xs font-semibold text-smoke-100 transition-colors hover:border-charcoal-200 hover:bg-charcoal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[status])} />
      <span className="truncate">{def.title}</span>
    </button>
  )
}
