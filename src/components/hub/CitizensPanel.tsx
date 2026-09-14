'use client'
/**
 * Who is running your workflows right now.
 *
 * Publishing puts a workflow on the citizens' board (`src/game/citizens.ts`); this is the board.
 * Each row is one of your drops with the runs it has collected, the royalties it has paid and how
 * much interest is left, and under them the last few runs with the handle that took them.
 *
 * The two selectors return **arrays of packed strings**, not the state's own arrays, and compare
 * them with `shallowEqual`. `runCitizens` mutates a drop in place, so a selector returning
 * `state.citizens.drops` would hand back the same array reference after every run and the panel
 * would sit there frozen while the numbers underneath it moved. Same idiom as `useQueueIds`.
 */
import { useMemo } from 'react'
import { Flame, Play, Snowflake, Users } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Panel } from '@/components/common/Panel'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { useMotionOK } from '@/components/studio/studioHooks'
import { CITIZEN_COLD_HEAT } from '@/game/constants'
import { formatNum } from '@/game/format'
import { useNow } from '@/hooks/useNow'
import { shallowEqual, useGame } from '@/state/useGame'

/** Runs listed under the board. Older ones stay in the save; the panel shows the recent handful. */
const FEED_SHOWN = 6
/** Field separator inside a packed row. Never occurs in a workflow name or a handle. */
const SEP = '\u0001'

interface DropRow {
  id: string
  name: string
  runs: number
  royalties: number
  cold: boolean
  /** Interest left as a whole percentage of the window between cold and brand new. */
  interest: number
}

interface VisitRow {
  id: string
  handle: string
  workflowName: string
  credits: number
  at: number
}

/** `just now`, `40s ago`, `6m ago`. */
function ago(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

/** Heat as a percentage of the window between cold and brand new. */
function heatPct(heat: number): number {
  const span = 1 - CITIZEN_COLD_HEAT
  return Math.max(0, Math.round(((Math.min(1, heat) - CITIZEN_COLD_HEAT) / span) * 100))
}

function useDropRows(): DropRow[] {
  const packed = useGame(
    (s) =>
      [...s.citizens.drops]
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .map((d) => [d.id, d.name, d.runs, Math.round(d.royalties), d.cold ? 1 : 0, heatPct(d.heat)].join(SEP)),
    shallowEqual,
  )
  return useMemo(
    () =>
      packed.map((row) => {
        const [id, name, runs, royalties, cold, interest] = row.split(SEP) as [string, string, string, string, string, string]
        return { id, name, runs: Number(runs), royalties: Number(royalties), cold: cold === '1', interest: Number(interest) }
      }),
    [packed],
  )
}

function useVisitRows(): VisitRow[] {
  const packed = useGame(
    (s) =>
      s.citizens.feed
        .slice(-FEED_SHOWN)
        .reverse()
        .map((v) => [v.id, v.handle, v.workflowName, Math.round(v.credits), v.at].join(SEP)),
    shallowEqual,
  )
  return useMemo(
    () =>
      packed.map((row) => {
        const [id, handle, workflowName, credits, at] = row.split(SEP) as [string, string, string, string, string]
        return { id, handle, workflowName, credits: Number(credits), at: Number(at) }
      }),
    [packed],
  )
}

export function CitizensPanel() {
  const motionOk = useMotionOK()
  const now = useNow(1000)
  const drops = useDropRows()
  const visits = useVisitRows()

  if (drops.length === 0) return null

  const live = drops.filter((d) => !d.cold).length
  const runs = drops.reduce((sum, d) => sum + d.runs, 0)
  const paid = drops.reduce((sum, d) => sum + d.royalties, 0)

  return (
    <Panel
      stripe="latent"
      title={
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} aria-hidden="true" />
          Who is running your workflows
        </span>
      }
      right={
        <span className="tabular-nums">
          {formatNum(runs)} run{runs === 1 ? '' : 's'} · {formatNum(paid)} paid
        </span>
      }
      className="w-full"
      bodyClassName="flex flex-col gap-3"
    >
      <ul className="flex flex-col gap-1.5" aria-label="Your published workflows">
        {drops.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-comfy border border-charcoal-400 bg-charcoal-700 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-smoke-100">{d.name}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-smoke-600 tabular-nums">
              <Play size={11} aria-hidden="true" />
              {formatNum(d.runs)}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-credits tabular-nums">
              <CreditsIcon size={11} aria-hidden="true" />
              {formatNum(d.royalties)}
            </span>
            {d.cold ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-smoke-800">
                <Snowflake size={11} aria-hidden="true" />
                cooled off
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slot-latent tabular-nums">
                <Flame size={11} aria-hidden="true" />
                {d.interest}% interest
              </span>
            )}
          </li>
        ))}
      </ul>

      {visits.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Recent runs" aria-live="polite">
          <AnimatePresence initial={false}>
            {visits.map((v) => (
              <motion.li
                key={v.id}
                layout={motionOk}
                initial={motionOk ? { opacity: 0, y: -4 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-baseline gap-2 text-[11px]"
              >
                <span className="font-mono font-semibold text-[#7f8dff]">@{v.handle}</span>
                <span className="min-w-0 flex-1 truncate text-smoke-600">
                  ran <span className="text-smoke-100">{v.workflowName}</span>
                </span>
                <span className="font-bold text-credits tabular-nums">+{formatNum(v.credits)}</span>
                <span className="w-16 text-right text-smoke-800 tabular-nums">{ago(v.at, now)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      <p className="text-[11px] text-smoke-800">
        {live > 0
          ? `${live} workflow${live === 1 ? '' : 's'} still trending. Every run pays you 5% of the job, and interest drops with each one.`
          : 'Nothing is trending. Publish another recipe and the hub will find it.'}
      </p>
    </Panel>
  )
}
