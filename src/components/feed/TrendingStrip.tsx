'use client'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Flame, Radio, TrendingUp } from 'lucide-react'
import { useGameEvents, useGameStore } from '@/state/useGame'
import { TRENDING_WEIGHTS } from '@/game/constants'
import { msUntilRollover, weekPeriodMs } from '@/game/hashtags'
import { formatDuration } from '@/game/format'
import { useNow } from '@/hooks/useNow'
import { pickHashtag, tagLabel, useReducedMotionPref, useTrendingBoard, useWeekPinned } from '@/components/feed/feedHooks'
import { cn } from '@/lib/utils'

const RING_R = 9
const RING_C = 2 * Math.PI * RING_R
const noSubscribe = (): (() => void) => () => {}

/** "Trending this week": the three tags, live/seeded marker and a countdown ring to the next rollover. */
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
  const weekMinutes = Math.max(1, Math.round(weekPeriodMs(board.weekSpeed) / 60_000))
  const weeksHint = `AI weeks are ${weekMinutes} minute${weekMinutes === 1 ? '' : 's'}`

  return (
    <div
      className="relative flex items-center gap-3 overflow-hidden rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-electric-400 bg-charcoal-600 px-3 py-2 shadow-[0_4px_0_#0e0e0f]"
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

      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
        <TrendingUp size={14} className="text-electric-400" aria-hidden="true" />
        <span className="hidden sm:inline">Trending this week</span>
        <span className="sm:hidden">Trending</span>
      </span>

      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-[0.354em] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em]',
          board.live ? 'bg-sapphire-700 text-white' : 'border border-charcoal-300 bg-charcoal-700 text-smoke-800',
        )}
        title={pinned ? 'Week pinned for the demo' : board.live ? 'From the real wire' : 'Seeded from the week index'}
      >
        {board.live ? <Radio size={10} aria-hidden="true" /> : null}
        {pinned ? 'pinned' : board.live ? 'live' : 'seeded'}
      </span>

      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label="Trending hashtags">
        <AnimatePresence initial={false} mode="popLayout">
          {chips.map((c, i) => (
            <motion.li
              key={c.id}
              initial={reduced ? false : { opacity: 0, scale: 0.7, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, scale: 0.7, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 460, damping: 22, delay: reduced ? 0 : i * 0.05 }}
            >
              <button
                type="button"
                onClick={() => pickHashtag(c.id)}
                title={i === 0 ? `Hottest tag. Match it in a prompt for ×${1 + TRENDING_WEIGHTS[0]} reach` : 'Match it in a prompt for extra reach'}
                aria-label={`Use ${c.label} in the Studio`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[0.354em] border px-2 py-0.5 text-[12px] font-bold tabular-nums transition-transform hover:-translate-y-px active:translate-y-px',
                  i === 0
                    ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#0e0e0f]'
                    : 'border-electric-400/60 bg-electric-400/10 text-electric-400',
                )}
              >
                {i === 0 ? <Flame size={12} aria-hidden="true" /> : null}
                {c.label}
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <Countdown weekSpeed={board.weekSpeed} hint={weeksHint} />
    </div>
  )
}

function Countdown({ weekSpeed, hint }: { weekSpeed: number; hint: string }) {
  const now = useNow(250)
  // The clock only exists on the client; the server render shows an empty ring so hydration matches.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false)
  const period = weekPeriodMs(weekSpeed)
  const left = mounted ? msUntilRollover(now, weekSpeed) : period
  const progress = 1 - left / period
  const offset = RING_C * (1 - Math.max(0, Math.min(1, progress)))
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tabular-nums text-smoke-600"
      title={`Next week in ${formatDuration(left / 1000)} (${hint})`}
      aria-label={`Next week in ${formatDuration(left / 1000)}. ${hint}.`}
    >
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" className="-rotate-90">
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
      <span className="hidden md:inline">next week</span>
      <span className="text-smoke-100">{mounted ? formatDuration(left / 1000) : '–:––'}</span>
    </span>
  )
}
