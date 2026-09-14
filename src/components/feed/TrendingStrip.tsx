'use client'
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Flame, Radio, TrendingUp } from 'lucide-react'
import { useGameEvents, useGameStore } from '@/state/useGame'
import { TRENDING_WEIGHTS } from '@/game/constants'
import { msUntilRollover, weekPeriodMs } from '@/game/hashtags'
import { formatDuration } from '@/game/format'
import { useMounted } from '@/hooks/useMounted'
import { useNow } from '@/hooks/useNow'
import {
  pickHashtag,
  tagLabel,
  trendingMarker,
  useReducedMotionPref,
  useTrendingBoard,
  useWeekPinned,
  weekLengthHint,
  type TrendingTone,
} from '@/components/feed/feedHooks'
import { cn } from '@/lib/utils'

const RING_R = 9
const RING_C = 2 * Math.PI * RING_R

const DOT: Record<TrendingTone, string> = {
  live: 'bg-sapphire-700',
  seeded: 'bg-charcoal-300',
  pinned: 'bg-electric-400',
}
const PILL: Record<TrendingTone, string> = {
  live: 'bg-sapphire-700 text-white',
  seeded: 'border border-charcoal-300 bg-charcoal-700 text-smoke-800',
  pinned: 'bg-electric-400 text-charcoal-800',
}

/**
 * "Trending this week": the three tags, a live/seeded marker and a countdown ring to the next
 * rollover. One fixed 44 px line at every width. The label, the marker and the chips answer to
 * container queries on the centre column, never to the viewport, so the strip can neither wrap
 * nor change height and the panel below it is never pushed under a hard edge.
 */
export function TrendingStrip() {
  const store = useGameStore()
  const board = useTrendingBoard()
  const pinned = useWeekPinned()
  const reduced = useReducedMotionPref()
  const [flash, setFlash] = useState(0)
  useGameEvents((e) => {
    if (e.type === 'weekRollover') setFlash((n) => n + 1)
  })

  const chips = useMemo(() => board.ids.map((id) => ({ id, label: tagLabel(store.catalog, id) })), [store, board.ids])
  const marker = trendingMarker(board.live, pinned)

  return (
    <div
      data-tour="trending"
      className="relative flex h-11 shrink-0 flex-nowrap items-center gap-2 overflow-hidden rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-electric-400 bg-charcoal-600 px-3 shadow-[0_4px_0_#0e0e0f] @[720px]:gap-3"
      aria-label="Trending this week"
    >
      <AnimatePresence>
        {flash > 0 && !reduced ? (
          <motion.span
            key={flash}
            className="pointer-events-none absolute inset-0 bg-electric-400"
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>

      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600" title="Trending this week">
        <TrendingUp size={14} className="text-electric-400" aria-hidden="true" />
        <span className="hidden whitespace-nowrap @[520px]:inline">
          Trending<span className="hidden @[720px]:inline"> this week</span>
        </span>
      </span>

      {/* A 6 px dot until there is room for the word; the sentence lives in the tooltip. */}
      <span className="inline-flex shrink-0 items-center" role="img" aria-label={`Trending source: ${marker.word}`} title={marker.title}>
        <span className={cn('block size-1.5 rounded-full @[840px]:hidden', DOT[marker.tone])} aria-hidden="true" />
        <span
          className={cn(
            'hidden items-center gap-1 rounded-[0.354em] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] @[840px]:inline-flex',
            PILL[marker.tone],
          )}
          aria-hidden="true"
        >
          {board.live ? <Radio size={10} /> : null}
          {marker.word}
        </span>
      </span>

      <ul
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden @[520px]:overflow-hidden @[520px]:[mask-image:none]"
        aria-label="Trending hashtags"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {chips.map((c, i) => (
            <motion.li
              key={c.id}
              className="min-w-0 shrink-0"
              initial={reduced ? false : { opacity: 0, scale: 0.7, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, scale: 0.7, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 460, damping: 22, delay: reduced ? 0 : i * 0.05 }}
            >
              <button
                type="button"
                onClick={() => pickHashtag(c.id)}
                title={i === 0 ? `${c.label} · hottest tag. Match it in a prompt for ×${1 + TRENDING_WEIGHTS[0]} reach` : `${c.label} · match it in a prompt for extra reach`}
                aria-label={`Use ${c.label} in the Studio`}
                className={cn(
                  'inline-flex max-w-[8.5rem] shrink-0 items-center gap-1 truncate rounded-[0.354em] border px-2 py-0.5 text-[12px] font-bold tabular-nums transition-transform hover:-translate-y-px active:translate-y-px',
                  i === 0
                    ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#0e0e0f]'
                    : 'border-electric-400/60 bg-electric-400/10 text-electric-400',
                )}
              >
                {i === 0 ? <Flame size={12} className="shrink-0" aria-hidden="true" /> : null}
                <span className="truncate">{c.label}</span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <Countdown weekSpeed={board.weekSpeed} />
    </div>
  )
}

function Countdown({ weekSpeed }: { weekSpeed: number }) {
  const now = useNow(250)
  // The clock only exists on the client; the server render shows an empty ring so hydration matches.
  const mounted = useMounted()
  const period = weekPeriodMs(weekSpeed)
  const left = mounted ? msUntilRollover(now, weekSpeed) : period
  const progress = 1 - left / period
  const offset = RING_C * (1 - Math.max(0, Math.min(1, progress)))
  const label = `Next week in ${formatDuration(left / 1000)} (${weekLengthHint(period)})`
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold tabular-nums text-smoke-600"
      title={label}
      aria-label={label}
    >
      <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true" className="-rotate-90">
        <circle cx={12} cy={12} r={RING_R} fill="none" stroke="var(--color-charcoal-300)" strokeWidth={3} />
        <circle
          cx={12}
          cy={12}
          r={RING_R}
          fill="none"
          stroke="var(--color-electric-400)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 260ms linear' }}
        />
      </svg>
      {/* Reserved width: 9:59 rolling over to 10:00 must not move anything to its left. */}
      <span className="w-14 text-right text-[12px] text-smoke-100">{mounted ? formatDuration(left / 1000) : '–:––'}</span>
    </span>
  )
}
