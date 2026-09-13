'use client'
/**
 * /leaderboard: the global board inside the game chrome. The store keeps ticking (root
 * GameProvider), so the header counter still climbs while you compare rigs. Data comes from
 * GET /api/leaderboard, refreshed every minute and on tab focus. The shared Header and Overlays
 * are mounted so the account menu, daily calendar and toasts behave exactly as on the game page.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { RefreshCw, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/useAuth'
import { Panel } from '@/components/common/Panel'
import { DotGrid } from '@/components/layout/DotGrid'
import { Header } from '@/components/layout/Header'
import { useMarkVisited } from '@/components/layout/navBadges'
import { LeaderboardTable, type YouRow } from '@/components/leaderboard/LeaderboardTable'
import { Overlays } from '@/components/overlays/Overlays'
import { formatNum } from '@/game/format'
import type { LeaderboardEntry, LeaderboardResult } from '@/server/leaderboard'
import { useGameShallow } from '@/state/useGame'

const REFRESH_MS = 60_000
const ENTER = { type: 'spring', stiffness: 260, damping: 26 } as const

interface BoardState {
  entries: LeaderboardEntry[]
  updatedAt: number | null
  available: boolean
  loading: boolean
  error: string | null
}

export default function LeaderboardPage() {
  const os = useReducedMotion()
  const reducedSetting = useGameShallow((s) => ({ v: s.settings.reducedMotion })).v
  const instant = Boolean(os) || reducedSetting
  const auth = useAuth()
  const [board, setBoard] = useState<BoardState>({ entries: [], updatedAt: null, available: true, loading: true, error: null })

  const load = useCallback(async () => {
    setBoard((b) => ({ ...b, loading: true }))
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' })
      const json: unknown = await res.json()
      if (!res.ok) {
        const message = typeof json === 'object' && json !== null && typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : 'The board is unreachable right now.'
        throw new Error(message)
      }
      const data = json as LeaderboardResult
      setBoard({ entries: data.entries, updatedAt: Date.parse(data.updatedAt) || Date.now(), available: data.available, loading: false, error: null })
    } catch (err) {
      setBoard((b) => ({ ...b, loading: false, error: err instanceof Error ? err.message : 'The board is unreachable right now.' }))
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const local = useGameShallow((s, d) => ({
    cps: d.cps,
    lifetimeCredits: Math.floor(s.lifetimeCredits),
    followers: Math.floor(s.followers),
    season: s.meta.season,
  }))
  const signedIn = auth.status === 'signed-in'
  const you: YouRow | null = signedIn ? { handle: auth.handle ?? 'you', ...local } : null
  const myRank = signedIn ? (board.entries.find((e) => e.userId === auth.user?.id)?.rank ?? null) : null
  // Marks the tile visited and caches the rank (1 h TTL) so the header can badge it without fetching.
  useMarkVisited('leaderboard', myRank)

  return (
    <>
      <DotGrid />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <Header />
        <main id="main" className="flex flex-1 justify-center px-4 py-6 lg:py-8">
          <motion.div
            className="w-full max-w-5xl"
            initial={instant ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={ENTER}
          >
            <Panel
              stripe="electric"
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Trophy size={13} aria-hidden="true" className="text-electric-400" />
                  Leaderboard
                </span>
              }
              right={
                <>
                  <span className="hidden tabular-nums sm:inline">{board.updatedAt ? `updated ${new Date(board.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={board.loading}
                    aria-label="Refresh the board"
                    title="Refresh"
                    className="grid size-7 place-items-center rounded-comfy text-smoke-600 transition-colors hover:bg-charcoal-500 hover:text-smoke-100 disabled:opacity-50"
                  >
                    <RefreshCw size={14} aria-hidden="true" className={cn(board.loading && !instant && 'animate-spin')} />
                  </button>
                </>
              }
              bodyClassName="p-4 sm:p-5"
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-extrabold tracking-tight text-smoke-100">Top 100 by lifetime credits</h1>
                  <p className="mt-1 text-sm text-smoke-600">
                    Every cloud save, ranked. Income is what the rack does right now; lifetime is everything it ever did. Followers are for bragging.
                  </p>
                </div>
                <div className="rounded-comfy border border-charcoal-400 bg-charcoal-700 px-3 py-2 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">{signedIn ? 'Your rank' : 'Your lifetime'}</p>
                  <p className="text-lg font-extrabold tabular-nums text-smoke-100">
                    {signedIn ? (myRank !== null ? `#${myRank}` : 'unranked') : formatNum(local.lifetimeCredits)}
                  </p>
                </div>
              </div>

              <LeaderboardTable
                entries={board.entries}
                loading={board.loading}
                error={board.error}
                available={board.available}
                currentUserId={signedIn ? (auth.user?.id ?? null) : null}
                guest={!signedIn}
                you={you}
              />
            </Panel>
          </motion.div>
        </main>
      </div>
      {/* Toasts, the daily calendar, settings and stats stay reachable from the shared header. */}
      <Overlays />
    </>
  )
}
