'use client'
/**
 * The running jobs at a glance: one striped ComfyUI-style progress bar per job with the model's
 * vendor mark and the seconds left. Rows re-render from a 250 ms clock; the list itself only
 * re-renders when the set of running jobs changes.
 */
import { memo, useMemo } from 'react'
import { Clock3 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useGame, useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { formatDuration } from '@/game/format'
import { LOADING_LINES } from '@/data/flavor'
import { Panel } from '@/components/common/Panel'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'

interface RunningJob {
  id: string
  modelName: string
  vendorIcon: string
  precisionLabel: string
  startedAt: number
  endsAt: number
  durationMs: number
  clickBonusMs: number
}

function useRunningJobs(): RunningJob[] {
  const store = useGameStore()
  const key = useGame((s) => {
    let out = ''
    for (const j of s.queue) {
      if (j.startedAt === null) continue
      out += `${j.id}:${j.startedAt}:${j.endsAt ?? 0}:${j.clickBonusMs}|`
    }
    return out
  })
  return useMemo(() => {
    const { modelById } = buildIndex(store.catalog)
    const rows: RunningJob[] = []
    for (const j of store.state.queue) {
      if (j.startedAt === null) continue
      const model = modelById[j.modelId]
      rows.push({
        id: j.id,
        modelName: model?.name ?? j.modelId,
        vendorIcon: model?.vendorIcon ?? 'ai-model',
        precisionLabel: store.catalog.precisions[j.precision]?.label ?? j.precision,
        startedAt: j.startedAt,
        endsAt: j.endsAt ?? j.startedAt + j.durationMs,
        durationMs: j.durationMs,
        clickBonusMs: j.clickBonusMs,
      })
    }
    return rows
    // `key` encodes every field read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, store])
}

const JobRow = memo(function JobRow({ job, now, reduced }: { job: RunningJob; now: number; reduced: boolean }) {
  const elapsed = now - job.startedAt + job.clickBonusMs
  const progress = job.durationMs > 0 ? Math.min(1, Math.max(0, elapsed / job.durationMs)) : 1
  const leftSec = Math.max(0, (job.endsAt - job.clickBonusMs - now) / 1000)
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="flex items-center gap-2.5"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[0.354em] border border-white/5 bg-charcoal-700"
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/brand/vendors/${job.vendorIcon}.svg`} alt="" width={18} height={18} draggable={false} className="opacity-90" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-semibold text-smoke-100">
            {job.modelName}
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-800">{job.precisionLabel}</span>
          </span>
          <span className="shrink-0 tabular-nums text-smoke-600">{formatDuration(Math.ceil(leftSec))}</span>
        </div>
        <div
          role="progressbar"
          aria-label={`${job.modelName} rendering`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="mt-1 h-2 w-full overflow-hidden rounded-full border border-charcoal-400 bg-charcoal-800"
        >
          <div
            className={cn('h-full rounded-full bg-electric-400 transition-[width] duration-250 ease-linear', !reduced && 'cc-striped')}
            style={{ width: `${progress * 100}%`, '--cc-stripe': 'rgb(23 45 215 / 0.35)' } as React.CSSProperties}
          />
        </div>
      </div>
    </motion.li>
  )
})

function RunningList({ jobs, reduced }: { jobs: RunningJob[]; reduced: boolean }) {
  const now = useNow(250)
  return (
    <ul className="flex flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} now={now} reduced={reduced} />
        ))}
      </AnimatePresence>
    </ul>
  )
}

export function QueueMini() {
  const jobs = useRunningJobs()
  const pending = useGame((s) => {
    let n = 0
    for (const j of s.queue) if (j.startedAt === null) n++
    return n
  })
  const concurrency = useGame((_s, d) => d.concurrency)
  const idleSeed = useGame((s) => s.stats.posts)
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const reduced = Boolean(useReducedMotion()) || reducedSetting
  const idleLine = LOADING_LINES[idleSeed % LOADING_LINES.length] ?? LOADING_LINES[0]

  // Nothing running and nothing waiting: one line, not a whole panel of empty.
  if (jobs.length === 0 && pending === 0) {
    return (
      <div className="flex shrink-0 items-center gap-2 rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-slot-model bg-charcoal-600 px-3 py-1.5 shadow-[0_4px_0_#0e0e0f]">
        <Clock3 size={14} className="shrink-0 text-smoke-800" aria-hidden="true" />
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">Queue idle</span>
        <span className="min-w-0 flex-1 truncate text-[11px] italic text-smoke-700">{idleLine}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-smoke-600">0/{concurrency}</span>
      </div>
    )
  }

  return (
    <Panel
      stripe="model"
      title="Queue"
      right={
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="text-smoke-100">
            {jobs.length}/{concurrency}
          </span>
          running
          {pending > 0 && (
            <span className="rounded-full border border-charcoal-300 px-1.5 text-[10px] font-semibold text-smoke-600">+{pending} queued</span>
          )}
        </span>
      }
      bodyClassName="p-4"
    >
      {jobs.length > 0 ? (
        <RunningList jobs={jobs} reduced={reduced} />
      ) : (
        <div className="flex items-center gap-2.5 text-xs text-smoke-600">
          <Clock3 size={16} className="shrink-0 text-smoke-800" aria-hidden="true" />
          <p className="min-w-0">
            <span className="font-semibold text-smoke-100">Waiting for a slot.</span> <span className="italic">{idleLine}</span>
          </p>
        </div>
      )}
    </Panel>
  )
}
