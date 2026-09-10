'use client'
import { memo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Hourglass, Play } from 'lucide-react'
import { useGame } from '@/state/useGame'
import { useNow } from '@/hooks/useNow'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { formatNum } from '@/game/format'
import { MAX_QUEUE } from '@/game/constants'
import { cn } from '@/lib/utils'
import { KIND_LABELS, formatShortSecs, useJobRow, useQueueIds, useMotionOK } from './studioHooks'

const KIND_STRIPE: Record<string, string> = {
  image: 'var(--color-slot-image)',
  video: 'var(--color-slot-latent)',
  '3d': 'var(--color-slot-mask)',
  audio: 'var(--color-slot-cond)',
}

/** ComfyUI-style queue: running jobs with striped progress, pending jobs waiting for a slot. */
export function QueueList() {
  const ids = useQueueIds()
  const concurrency = useGame((_s, d) => Math.max(1, Math.floor(d.concurrency)))
  const now = useNow(250)
  const reduced = !useMotionOK()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-700">Queue</span>
        <span className="text-[11px] tabular-nums text-smoke-800">
          {ids.length}/{MAX_QUEUE} · {concurrency} slot{concurrency === 1 ? '' : 's'}
        </span>
      </div>
      {ids.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[0.5rem] border-2 border-dashed border-charcoal-400 px-3 py-3 text-xs text-smoke-800">
          <Hourglass size={16} className="shrink-0 text-smoke-800" aria-hidden="true" />
          Queue is empty. The GPU is idle and slightly offended.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Generation queue">
          <AnimatePresence initial={false}>
            {ids.map((id, i) => (
              <motion.li
                key={id}
                layout={!reduced && ids.length <= 20}
                initial={reduced ? false : { opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <JobRow id={id} position={i} now={now} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

const JobRow = memo(function JobRow({ id, position, now }: { id: string; position: number; now: number }) {
  const job = useJobRow(id)
  const running = job.startedAt !== null
  const elapsed = running ? now - (job.startedAt as number) + job.clickBonusMs : 0
  const progress = running && job.durationMs > 0 ? Math.max(0, Math.min(1, elapsed / job.durationMs)) : 0
  const leftMs = running ? Math.max(0, job.durationMs - elapsed) : job.durationMs
  const stripe = KIND_STRIPE[job.kind] ?? KIND_STRIPE.image
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[0.5rem] border-2 bg-charcoal-700 px-3 py-2',
        running ? 'border-charcoal-300' : 'border-charcoal-400/80',
      )}
      style={{ borderLeftColor: stripe, borderLeftWidth: 4 }}
      title={job.prompt}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[0.354em] bg-charcoal-500" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/brand/vendors/${job.vendorIcon}.svg`} alt="" width={16} height={16} draggable={false} className="opacity-90" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="truncate font-semibold text-smoke-100">{job.modelName}</span>
            <span className="rounded-[0.3rem] bg-charcoal-500 px-1 py-px text-[10px] font-bold uppercase text-smoke-700">
              {job.precisionLabel}
            </span>
            <span className="hidden text-[10px] uppercase text-smoke-800 sm:inline">{KIND_LABELS[job.kind]}</span>
          </div>
          <p className="truncate text-[11px] text-smoke-700">{job.prompt || 'untitled prompt'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] tabular-nums">
          {running ? (
            <span className="inline-flex items-center gap-1 font-bold text-electric-400">
              <Play size={10} className="fill-current" aria-hidden="true" />
              {formatShortSecs(leftMs / 1000)}
            </span>
          ) : (
            <span className="font-semibold text-smoke-700">#{position + 1} · waiting</span>
          )}
          <span className="inline-flex items-center gap-0.5 text-credits">
            <CreditsIcon size={10} aria-hidden="true" />
            {formatNum(job.cost)}
          </span>
        </div>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-charcoal-500"
        role="progressbar"
        aria-label={running ? `${job.modelName} rendering` : `${job.modelName} queued`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className={cn('h-full rounded-full', running ? 'cc-striped bg-electric-400' : 'bg-charcoal-300')}
          style={{
            width: running ? `${Math.max(2, progress * 100)}%` : '100%',
            transition: 'width 250ms linear',
            ['--cc-stripe' as string]: 'rgb(23 45 215 / 0.28)',
          }}
        />
      </div>
      {running ? (
        <span className="sr-only">
          {job.hardwareName}, {Math.round(progress * 100)} percent
        </span>
      ) : null}
    </div>
  )
})
