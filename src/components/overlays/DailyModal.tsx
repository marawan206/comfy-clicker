'use client'
/**
 * Daily login calendar: seven tiles for the current cycle, today's reward preview computed with the
 * daily module, Claim → `store.claimDaily()` for guests. Signed-in players ask POST /api/daily,
 * which times the day on the server clock, decides the streak and refuses a second claim; the
 * payout then runs `store.claimDailyFromServer` with the server's day and streak, and a 409
 * adopts the server's record locally so the header stops asking. Opens itself once per session
 * when a claim is available (after the offline report is gone) and on `comfy:open-modal` → 'daily'.
 */
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { motion } from 'motion/react'
import { CalendarDays, Check, Flame, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/useAuth'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { fx } from '@/components/fx/fxBus'
import { ModalBase, ModalButton, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { useNow } from '@/hooks/useNow'
import { DAILY_BASE_SECS } from '@/game/constants'
import { DAILY_CP_DAY, DAILY_CYCLE_DAYS, DAILY_RP_DAY, canClaim, cycleDay, dailyReward, dayKey, effectiveStreak } from '@/game/daily'
import { formatDuration, formatNum } from '@/game/format'
import type { ServerDailyClaim } from '@/state/cloudActions'
import { useGameShallow, useGameStore } from '@/state/useGame'

const DAY_MS = 86_400_000
/** Delay before the auto-open so it never lands on top of the first click. */
const AUTO_OPEN_DELAY_MS = 1400

/** Module-level so a remount (tab switch, route change) does not re-open it in the same session. */
let autoOpenedThisSession = false

export interface DailyModalProps {
  open: boolean
  onClose: () => void
  /** Called when the modal wants to open itself (a claim is available). */
  onOpen: () => void
}

export function DailyModal({ open, onClose, onOpen }: DailyModalProps) {
  const now = useNow(1000)
  const { can, started, offlinePending } = useGameShallow((s, _, store) => ({
    can: canClaim(s, now),
    started: store.started,
    offlinePending: store.offlineReport !== null,
  }))

  useEffect(() => {
    if (!started || !can || offlinePending || open || autoOpenedThisSession) return
    const t = setTimeout(() => {
      autoOpenedThisSession = true
      onOpen()
    }, AUTO_OPEN_DELAY_MS)
    return () => clearTimeout(t)
  }, [started, can, offlinePending, open, onOpen])

  return (
    <ModalBase open={open} onClose={onClose} title="Daily login" icon={<CalendarDays size={16} />} stripe="clip" size="lg">
      <DailyBody onClose={onClose} />
    </ModalBase>
  )
}

/** Outcome of asking the server before a signed-in claim. */
type ServerVerdict =
  | { kind: 'accepted'; claim: ServerDailyClaim }
  | { kind: 'refused'; message: string; claim: ServerDailyClaim | null }
  | { kind: 'unreachable' }

function readClaim(json: unknown): ServerDailyClaim | null {
  if (typeof json !== 'object' || json === null) return null
  const { day, streak } = json as { day?: unknown; streak?: unknown }
  return typeof day === 'string' && typeof streak === 'number' && Number.isFinite(streak) ? { day, streak } : null
}

/**
 * Asks /api/daily to record today's claim on the server clock. Success carries the server's day
 * and streak; a 4xx is a refusal (already claimed, with the day it holds, or signed out); a
 * network failure or 5xx is "unreachable" and the caller decides.
 */
async function claimOnServer(): Promise<ServerVerdict> {
  try {
    const res = await fetch('/api/daily', { method: 'POST', cache: 'no-store' })
    if (res.status >= 500) return { kind: 'unreachable' }
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      /* non-JSON body, treated below */
    }
    const claim = readClaim(json)
    if (res.ok) return claim ? { kind: 'accepted', claim } : { kind: 'unreachable' }
    const error = typeof json === 'object' && json !== null ? (json as { error?: unknown }).error : undefined
    return { kind: 'refused', message: typeof error === 'string' ? error : 'The server declined this claim.', claim }
  } catch {
    return { kind: 'unreachable' }
  }
}

function DailyBody({ onClose }: { onClose: () => void }) {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const now = useNow(1000)
  const auth = useAuth()
  const [justClaimed, setJustClaimed] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const closeTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  const { can, streakNow, storedStreak, cps, grace } = useGameShallow((s, d) => ({
    can: canClaim(s, now),
    streakNow: effectiveStreak(s, now, d.streakGrace),
    storedStreak: s.daily.streak,
    cps: d.cps,
    grace: d.streakGrace,
  }))

  // Which tile is "today", and how many tiles before it are already claimed in this cycle.
  const todayDay = can ? cycleDay(streakNow + 1) : cycleDay(Math.max(1, storedStreak))
  const claimedThrough = can ? todayDay - 1 : todayDay
  const nextDay = can ? todayDay : cycleDay(storedStreak + 1)
  const reward = dailyReward(cps, todayDay)
  const lapsed = can && storedStreak > 0 && streakNow === 0
  const todayKey = dayKey(now)
  const resetInSec = Math.max(0, (Date.parse(`${todayKey}T00:00:00Z`) + DAY_MS - now) / 1000)
  const displayStreak = can ? streakNow : storedStreak

  const finishClaim = (x: number, y: number, claim: ServerDailyClaim | null) => {
    const r = claim ? store.claimDailyFromServer(claim) : store.claimDaily()
    if (r.error) {
      toast(r.error, { tone: 'danger', title: 'Daily' })
      return
    }
    fx.burst(x, y, 22)
    setJustClaimed(true)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(onClose, 1100)
  }

  const claim = async (e: MouseEvent<HTMLButtonElement>) => {
    if (claiming) return
    const { clientX, clientY } = e
    if (auth.status !== 'signed-in') {
      finishClaim(clientX, clientY, null)
      return
    }
    // Signed in: the server clock decides the day and the streak. Local state only changes once
    // it has answered, with a yes, or with the claim it already holds for today.
    setClaiming(true)
    const verdict = await claimOnServer()
    setClaiming(false)
    if (verdict.kind === 'refused') {
      if (verdict.claim) store.markDailyClaimed(verdict.claim)
      toast(verdict.message, { tone: 'danger', title: 'Daily', key: 'daily' })
      if (verdict.claim) onClose()
      return
    }
    if (verdict.kind === 'unreachable') {
      // Never block the game on the network: record it locally and say so.
      toast('Server unreachable, claimed locally', {
        title: 'Daily',
        description: 'The cloud calendar did not answer. The streak is kept in this browser for now.',
        tone: 'electric',
        key: 'daily',
      })
      finishClaim(clientX, clientY, null)
      return
    }
    finishClaim(clientX, clientY, verdict.claim)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-2xl font-extrabold tracking-tight text-smoke-100 tabular-nums">
            <Flame size={22} className={displayStreak > 0 ? 'text-electric-400' : 'text-smoke-800'} />
            {displayStreak > 0 ? `${displayStreak}-day streak` : 'No streak yet'}
          </p>
          <p className="text-xs text-smoke-600">
            {lapsed
              ? 'Streak lapsed. Back to day 1. The GPUs forgive, the calendar does not.'
              : grace
                ? 'Streak grace active: one missed day is forgiven.'
                : `Claim every UTC day to keep it going. Day ${DAILY_RP_DAY} adds RP, day ${DAILY_CP_DAY} adds CP.`}
          </p>
        </div>
        <p className="text-xs text-smoke-600 tabular-nums">Resets in {formatDuration(resetInSec)} UTC</p>
      </div>

      <ol className="grid grid-cols-4 gap-2 sm:grid-cols-7" aria-label="Seven-day reward cycle">
        {Array.from({ length: DAILY_CYCLE_DAYS }, (_, i) => i + 1).map((day) => {
          const claimed = day <= claimedThrough || (justClaimed && day === todayDay)
          const isToday = can && day === todayDay && !justClaimed
          const amount = dailyReward(cps, day)
          return (
            <li
              key={day}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-xl border-2 px-1.5 py-2.5 text-center',
                claimed && 'border-sapphire-700/70 bg-sapphire-700/15',
                isToday && 'border-electric-400 bg-electric-400/10 shadow-[0_0_0_3px_rgba(240,255,65,0.15)]',
                !claimed && !isToday && 'border-charcoal-400 bg-charcoal-700/50',
              )}
            >
              {isToday && !reduced ? (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-xl border-2 border-electric-400"
                  animate={{ opacity: [0.9, 0.2, 0.9], scale: [1, 1.04, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                />
              ) : null}
              <span className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', isToday ? 'text-electric-400' : 'text-smoke-600')}>
                Day {day}
              </span>
              <span className="grid size-8 place-items-center rounded-comfy bg-charcoal-800/70">
                {claimed ? (
                  <Check size={16} className="text-[#7f8dff]" aria-label="Claimed" />
                ) : isToday ? (
                  <CreditsIcon size={18} className="text-credits" />
                ) : (
                  <Lock size={14} className="text-smoke-800" aria-label="Not yet" />
                )}
              </span>
              <span className={cn('flex items-center gap-0.5 text-xs font-bold tabular-nums', claimed ? 'text-smoke-600' : 'text-credits')}>
                <CreditsIcon size={10} />
                {formatNum(amount)}
              </span>
              {day === DAILY_RP_DAY ? <span className="text-[10px] font-semibold text-slot-mask">+1 RP</span> : null}
              {day === DAILY_CP_DAY ? <span className="text-[10px] font-semibold text-electric-400">+1 CP</span> : null}
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-400 bg-charcoal-700/60 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
            {can ? `Today · day ${todayDay}` : `Next · day ${nextDay} tomorrow`}
          </p>
          <p className="flex items-center gap-1.5 text-xl font-extrabold text-credits tabular-nums">
            <CreditsIcon size={18} />
            {formatNum(can ? reward : dailyReward(cps, nextDay))}
            <span className="text-xs font-semibold text-smoke-600">
              = {Math.round((DAILY_BASE_SECS * (can ? todayDay : nextDay)) / 60)} min of income
            </span>
          </p>
        </div>
        {justClaimed ? (
          <span className="inline-flex h-11 items-center gap-2 rounded-xl bg-sapphire-700 px-5 text-sm font-bold text-smoke-100">
            <Check size={16} /> Claimed
          </span>
        ) : can ? (
          <ModalButton
            tone="primary"
            size="lg"
            onClick={(e) => void claim(e)}
            disabled={claiming}
            aria-disabled={claiming ? 'true' : undefined}
            aria-busy={claiming}
            data-autofocus
            aria-label={`Claim day ${todayDay} reward`}
          >
            <CreditsIcon size={16} />
            {claiming ? 'Checking the clock…' : `Claim day ${todayDay}`}
          </ModalButton>
        ) : (
          <ModalButton tone="secondary" size="lg" disabled aria-disabled="true">
            Claimed today
          </ModalButton>
        )}
      </div>
    </div>
  )
}
