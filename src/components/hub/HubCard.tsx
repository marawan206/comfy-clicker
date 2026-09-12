'use client'
/**
 * One published workflow: author, name, model art with vendor mark, precision / LoRA / upscaler
 * chips, hashtags (trending ones glow), the run counters and rep, and a Run button that either
 * hands the recipe to the Studio or explains, in the game's own words, why the rig cannot.
 */
import { memo, useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight, Award, Flame, Lock, Play, Sparkles, WandSparkles } from 'lucide-react'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { VendorIcon } from '@/components/studio/ModelChips'
import { FOCUS_RING, KIND_LABELS, useMotionOK } from '@/components/studio/studioHooks'
import { buildIndex } from '@/game/catalog'
import { formatCompactDate, formatNum } from '@/game/format'
import type { Precision } from '@/game/types'
import { cn } from '@/lib/utils'
import { useGameStore } from '@/state/useGame'
import type { HubWorkflow, RunVerdict } from './useHub'

export interface HubCardProps {
  workflow: HubWorkflow
  /** Live trending hashtag ids (electric highlight). */
  trending: readonly string[]
  /** Signed-in user id, to mark the player's own workflows. */
  meId: string | null
  verdict: RunVerdict
  onRun: (workflow: HubWorkflow) => void
}

const PRECISION_CLASS: Record<Precision, string> = {
  native: 'border-smoke-500/50 bg-smoke-100/10 text-smoke-100',
  fp8: 'border-slot-cond/60 bg-slot-cond/10 text-slot-cond',
  q4: 'border-slot-latent/60 bg-slot-latent/10 text-slot-latent',
}

const PRESS = { type: 'spring', stiffness: 500, damping: 30 } as const

export const HubCard = memo(function HubCard({ workflow, trending, meId, verdict, onRun }: HubCardProps) {
  const store = useGameStore()
  const motionOk = useMotionOK()
  const { modelById, hashtagById } = buildIndex(store.catalog)
  const model = modelById[workflow.modelId]
  const precisionLabel = store.catalog.precisions[workflow.precision]?.label ?? workflow.precision
  const mine = meId !== null && meId === workflow.authorId
  const hot = useMemo(() => new Set(trending), [trending])
  const lora = workflow.loraTag ? hashtagById[workflow.loraTag]?.tag ?? workflow.loraTag : null
  const publishedAt = Date.parse(workflow.createdAt)

  const runTitle = verdict.ok
    ? `Load into the Studio · runs on ${verdict.hardwareName ?? 'your rig'} · 5% of the job goes to @${workflow.authorHandle}`
    : (verdict.reason ?? 'Nothing you own can run this')

  return (
    <motion.li
      layout="position"
      initial={motionOk ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={motionOk ? { opacity: 0, scale: 0.98 } : undefined}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className={cn(
        'relative flex flex-col gap-3 rounded-2xl border-2 border-charcoal-400 border-l-4 bg-charcoal-600 p-3 shadow-[0_4px_0_#0e0e0f]',
        mine ? 'border-l-sapphire-700' : workflow.trendingMatch > 0 ? 'border-l-electric-400' : 'border-l-slot-model',
      )}
      style={{ contentVisibility: 'auto' }}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Art id={`model-${workflow.modelId}`} size={56} alt={model?.name ?? workflow.modelId} />
          {model ? (
            <span
              className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-[0.354em] border border-charcoal-300 bg-charcoal-800 shadow-[0_2px_0_#0e0e0f]"
              title={model.name}
            >
              <VendorIcon icon={model.vendorIcon} size={14} className="opacity-90" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-extrabold tracking-tight text-smoke-100" title={workflow.name}>
              {workflow.name}
            </h3>
            {mine ? (
              <span className="shrink-0 rounded-[0.354em] border border-sapphire-700/60 bg-sapphire-700/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-[#7f8dff]">
                yours
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-smoke-600">
            by <span className="font-semibold text-smoke-100">@{workflow.authorHandle}</span>
            <span aria-hidden="true"> · </span>
            <span className="tabular-nums" title={new Date(publishedAt).toLocaleString()}>
              {Number.isNaN(publishedAt) ? 'just now' : formatCompactDate(publishedAt)}
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-6 items-center gap-1 rounded-[0.354em] border border-charcoal-300 bg-charcoal-700 px-1.5 text-[11px] font-semibold text-smoke-100">
              {model?.name ?? workflow.modelId}
              {model && model.kind !== 'image' ? (
                <span className="rounded-[0.354em] bg-charcoal-800/60 px-1 text-[10px] font-bold uppercase tracking-wide text-smoke-600">
                  {KIND_LABELS[model.kind]}
                </span>
              ) : null}
            </span>
            <span
              className={cn('inline-flex h-6 items-center rounded-[0.354em] border px-1.5 text-[10px] font-bold uppercase tracking-[0.08em]', PRECISION_CLASS[workflow.precision])}
              title={workflow.precision === 'native' ? 'Full-fat weights' : `Quantized to ${precisionLabel}`}
            >
              {precisionLabel}
            </span>
            {lora ? (
              <span
                className="inline-flex h-6 items-center gap-1 rounded-[0.354em] border border-slot-mask/50 bg-slot-mask/10 px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slot-mask"
                title={`Trained LoRA · trigger word #${lora}`}
              >
                <WandSparkles size={11} aria-hidden="true" />
                LoRA
              </span>
            ) : null}
            {workflow.upscaler ? (
              <span
                className="inline-flex h-6 items-center gap-1 rounded-[0.354em] border border-slot-image/50 bg-slot-image/10 px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slot-image"
                title="Ends with an upscale pass"
              >
                <ArrowUpRight size={11} aria-hidden="true" />
                Upscaler
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {workflow.hashtags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Hashtags">
          {workflow.hashtags.map((id) => {
            const isHot = hot.has(id)
            return (
              <li
                key={id}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold',
                  isHot ? 'border-electric-400/70 bg-electric-400/10 text-electric-400' : 'border-charcoal-300 bg-charcoal-500 text-smoke-600',
                )}
                title={isHot ? 'Trending on the live feed right now' : undefined}
              >
                {isHot ? <Flame size={11} aria-hidden="true" /> : null}#{hashtagById[id]?.tag ?? id}
              </li>
            )
          })}
        </ul>
      ) : null}

      <dl className="grid grid-cols-4 gap-1.5 text-center">
        <Stat label="24h" value={formatNum(workflow.runs24h)} hot={workflow.runs24h > 0} title="Runs in the last 24 hours" />
        <Stat label="runs" value={formatNum(workflow.runsTotal)} title="Runs all time" />
        <Stat label="rep" value={formatNum(workflow.rep)} icon={<Award size={11} aria-hidden="true" />} title="Reputation: +1 per run, more when the royalty is big" />
        <Stat
          label="royalties"
          value={formatNum(workflow.royalties)}
          icon={<CreditsIcon size={11} />}
          credits
          title="Credits other players' runs have paid the author (5% of each job)"
        />
      </dl>

      <div className="flex items-center justify-between gap-3">
        {verdict.ok ? (
          <p className="min-w-0 truncate text-xs text-smoke-600" title={runTitle}>
            Runs on <span className="font-semibold text-smoke-100">{verdict.hardwareName ?? 'your rig'}</span>
            {mine ? ' · your own, no royalty' : ' · 5% royalty to the author'}
          </p>
        ) : (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-slot-vae/80" title={runTitle}>
            <Lock size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{verdict.reason}</span>
          </p>
        )}
        <motion.button
          type="button"
          onClick={() => {
            if (verdict.ok) onRun(workflow)
          }}
          aria-disabled={!verdict.ok}
          aria-label={verdict.ok ? `Run ${workflow.name} in the Studio` : `Cannot run ${workflow.name}: ${verdict.reason}`}
          title={runTitle}
          whileTap={motionOk && verdict.ok ? { scale: 0.95, y: 2 } : undefined}
          transition={PRESS}
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border-2 px-3.5 text-sm font-extrabold tracking-tight',
            FOCUS_RING,
            verdict.ok
              ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_3px_0_#0e0e0f] hover:brightness-105'
              : 'cursor-not-allowed border-charcoal-300 bg-charcoal-500 text-smoke-800',
          )}
        >
          {verdict.ok ? <Play size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
          Run
        </motion.button>
      </div>
    </motion.li>
  )
})

function Stat({
  label,
  value,
  icon,
  hot,
  credits,
  title,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  hot?: boolean
  credits?: boolean
  title: string
}) {
  return (
    <div className="rounded-[0.354em] border border-charcoal-400 bg-charcoal-700 px-1.5 py-1" title={title}>
      <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-smoke-800">{label}</dt>
      <dd
        className={cn(
          'flex items-center justify-center gap-0.5 text-sm font-extrabold tabular-nums tracking-tight',
          credits ? 'text-credits' : hot ? 'text-electric-400' : 'text-smoke-100',
        )}
      >
        {icon}
        {value}
      </dd>
    </div>
  )
}
