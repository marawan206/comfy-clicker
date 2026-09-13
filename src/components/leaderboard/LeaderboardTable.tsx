'use client'
/**
 * The board: rank, handle, income, lifetime credits, followers, season. The signed-in player's
 * row is highlighted; when they are not in the top 100 their local numbers ride along at the
 * bottom as an unranked "you" row. Guests get the "Sign in to appear" call to action instead.
 * Flagged rows (see `src/server/leaderboard.ts`) keep their rank and gain an asterisk.
 */
import { memo } from 'react'
import { Crown, LogIn, TriangleAlert, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { openAuthSheet } from '@/components/auth/useAuth'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { ModalButton, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { formatCps, formatNum } from '@/game/format'
import type { LeaderboardEntry } from '@/server/leaderboard'

export interface YouRow {
  handle: string
  cps: number
  lifetimeCredits: number
  followers: number
  season: number
}

export interface LeaderboardTableProps {
  entries: LeaderboardEntry[]
  loading: boolean
  error: string | null
  /** False when the server has no Supabase configured. */
  available: boolean
  currentUserId: string | null
  /** True while playing without an account: shows the sign-in CTA. */
  guest: boolean
  /** Local numbers for a signed-in player who is not in the top 100. */
  you: YouRow | null
}

const CELL = 'px-3 py-2.5 whitespace-nowrap'
const HEAD = 'px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600'
const RANK_TONE: Record<number, string> = {
  1: 'text-electric-400',
  2: 'text-smoke-100',
  3: 'text-slot-cond',
}

export function LeaderboardTable({ entries, loading, error, available, currentUserId, guest, you }: LeaderboardTableProps) {
  const onBoard = currentUserId !== null && entries.some((e) => e.userId === currentUserId)
  // /leaderboard is not inside GameShell, so `html.reduced-motion` never lands here and the CSS
  // safety net only catches the OS setting. The in-game toggle has to be read in JS.
  const reduced = useReducedMotionPref()
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-charcoal-400 bg-charcoal-700/40">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="border-b border-charcoal-400/70">
            <tr>
              <th scope="col" className={cn(HEAD, 'w-14 text-right')}>
                #
              </th>
              <th scope="col" className={HEAD}>
                Handle
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                Income
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                Lifetime credits
              </th>
              <th scope="col" className={cn(HEAD, 'text-right')}>
                Followers
              </th>
              <th scope="col" className={cn(HEAD, 'w-20 text-right')}>
                Season
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-400/50">
            {loading && entries.length === 0 ? (
              Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} reduced={reduced} />)
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-smoke-600">
                  {error
                    ? error
                    : available
                      ? 'Nobody has uploaded a save yet. The top spot is one sign-in away.'
                      : 'The board is off on this build, no cloud configured. Your run still counts, just locally.'}
                </td>
              </tr>
            ) : (
              entries.map((e) => <Row key={e.userId} entry={e} me={e.userId === currentUserId} />)
            )}
            {you && !onBoard && !guest ? <YouTableRow you={you} /> : null}
          </tbody>
        </table>
      </div>

      {guest ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-charcoal-400 border-l-4 border-l-electric-400 bg-charcoal-700/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-smoke-100">Sign in to appear</p>
            <p className="text-xs text-smoke-600">The board reads cloud saves. Create an account and this run (clicks, rigs, followers) goes up with you.</p>
          </div>
          <ModalButton tone="primary" size="lg" onClick={() => openAuthSheet('sign-up')}>
            <LogIn size={16} />
            Sign in
          </ModalButton>
        </div>
      ) : null}

      {entries.some((e) => e.flagged) ? (
        <p className="flex items-center gap-1.5 text-[11px] text-smoke-600">
          <TriangleAlert size={12} className="text-slot-cond" aria-hidden="true" />
          Marked rows report more lifetime credits than their income could have produced since the account was created. Ranked anyway; judged silently.
        </p>
      ) : null}
    </div>
  )
}

const Row = memo(function Row({ entry, me }: { entry: LeaderboardEntry; me: boolean }) {
  const top = entry.rank <= 3
  return (
    <tr
      aria-current={me ? 'true' : undefined}
      className={cn('tabular-nums transition-colors', me ? 'bg-electric-400/10 shadow-[inset_4px_0_0_#f0ff41]' : 'hover:bg-charcoal-600/60')}
    >
      <td className={cn(CELL, 'text-right font-extrabold', RANK_TONE[entry.rank] ?? 'text-smoke-600')}>
        <span className="inline-flex items-center justify-end gap-1">
          {top ? <Crown size={12} aria-hidden="true" /> : null}
          {entry.rank}
        </span>
      </td>
      <td className={cn(CELL, 'font-semibold text-smoke-100')}>
        <span className="inline-flex items-center gap-2">
          <span className="truncate">{entry.handle}</span>
          {me ? <span className="rounded-comfy border border-electric-400/60 bg-electric-400/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-electric-400">You</span> : null}
          {entry.flagged ? (
            <TriangleAlert
              size={13}
              className="text-slot-cond"
              aria-label="Implausible numbers"
              role="img"
            />
          ) : null}
        </span>
      </td>
      <td className={cn(CELL, 'text-right text-smoke-600')}>{formatCps(entry.cps)}</td>
      <td className={cn(CELL, 'text-right font-bold text-credits')}>
        <span className="inline-flex items-center gap-1">
          <CreditsIcon size={12} />
          {formatNum(entry.lifetimeCredits)}
        </span>
      </td>
      <td className={cn(CELL, 'text-right text-smoke-100')}>
        <span className="inline-flex items-center gap-1">
          <Users size={12} className="text-smoke-800" aria-hidden="true" />
          {formatNum(entry.followers)}
        </span>
      </td>
      <td className={cn(CELL, 'text-right')}>
        <span className={cn('rounded-comfy px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em]', entry.season > 1 ? 'bg-slot-model/10 text-slot-model' : 'text-smoke-600')}>
          S{entry.season}
        </span>
      </td>
    </tr>
  )
})

function YouTableRow({ you }: { you: YouRow }) {
  return (
    <tr className="bg-electric-400/10 tabular-nums shadow-[inset_4px_0_0_#f0ff41]" aria-current="true">
      <td className={cn(CELL, 'text-right font-extrabold text-smoke-600')} title="Not in the top 100 yet">
        ·
      </td>
      <td className={cn(CELL, 'font-semibold text-smoke-100')}>
        <span className="inline-flex items-center gap-2">
          <span className="truncate">{you.handle}</span>
          <span className="rounded-comfy border border-electric-400/60 bg-electric-400/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-electric-400">You</span>
          <span className="text-[10px] text-smoke-600">local numbers · next sync</span>
        </span>
      </td>
      <td className={cn(CELL, 'text-right text-smoke-600')}>{formatCps(you.cps)}</td>
      <td className={cn(CELL, 'text-right font-bold text-credits')}>
        <span className="inline-flex items-center gap-1">
          <CreditsIcon size={12} />
          {formatNum(you.lifetimeCredits)}
        </span>
      </td>
      <td className={cn(CELL, 'text-right text-smoke-100')}>{formatNum(you.followers)}</td>
      <td className={cn(CELL, 'text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600')}>S{you.season}</td>
    </tr>
  )
}

function SkeletonRow({ reduced }: { reduced: boolean }) {
  return (
    <tr aria-hidden="true">
      {[10, 40, 16, 22, 16, 10].map((w, i) => (
        <td key={i} className={CELL}>
          <span className={cn('block h-3 rounded bg-charcoal-400/60', !reduced && 'animate-pulse')} style={{ width: `${w}%`, minWidth: 24, marginLeft: i === 0 || i >= 2 ? 'auto' : undefined }} />
        </td>
      ))}
    </tr>
  )
}
