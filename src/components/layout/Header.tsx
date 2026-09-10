'use client'
import Image from 'next/image'
import Link from 'next/link'
import type { ComponentType } from 'react'
import { ChartColumn, Flame, Settings, Trophy, UserPlus, Waypoints, Workflow, type LucideProps } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { CreditsCounter } from '@/components/hero/CreditsCounter'
import { PowerMeter } from '@/components/hero/PowerMeter'
import { ProjectorToggle } from '@/components/layout/ProjectorToggle'
import { canClaim, cycleDay, effectiveStreak } from '@/game/daily'
import { formatCps, formatNum } from '@/game/format'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'
import { useGame } from '@/state/useGame'

type ModalId = 'settings' | 'stats' | 'daily' | 'rebrand'

function openModal(id: ModalId): void {
  window.dispatchEvent(new CustomEvent<ModalId>('comfy:open-modal', { detail: id }))
}

/** Both reduced-motion sources, read unconditionally so hook order never changes. */
function useMotionOff(): boolean {
  const os = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  return Boolean(os) || setting
}

const TAP = { type: 'spring', stiffness: 500, damping: 30 } as const

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * 64 px top bar: brand on the left, the live counter with its cps line, signups, streak and the
 * compact power meter in the middle, routes and modal buttons on the right.
 */
export function Header() {
  return (
    <header className="relative z-20 h-16 shrink-0 border-b-2 border-charcoal-400 bg-charcoal-700 shadow-[0_4px_0_#0e0e0f]">
      <div className="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4">
        <Brand />
        <CenterStats />
        <Nav />
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Left: logo + wordmark
// ---------------------------------------------------------------------------

function Brand() {
  const season = useGame((s) => s.meta.season)
  return (
    <Link
      href="/"
      aria-label="Comfy Clicker — home"
      className="flex min-w-0 items-center gap-2.5 rounded-comfy pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
    >
      <Image src="/brand/comfy-logo.svg" alt="" width={32} height={32} priority draggable={false} className="size-8 shrink-0 select-none" />
      <span className="hidden items-baseline gap-1.5 whitespace-nowrap text-lg font-extrabold tracking-tight sm:flex">
        <span className="text-smoke-100">Comfy</span>
        <span className="text-electric-400">Clicker</span>
      </span>
      {season > 1 ? (
        <span
          className="hidden rounded-comfy border border-slot-model/50 bg-slot-model/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slot-model md:inline"
          title={`Season ${season} — you have rebranded ${season - 1} ${season === 2 ? 'time' : 'times'}`}
        >
          S{season}
        </span>
      ) : null}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Centre: counter, cps, chips, power
// ---------------------------------------------------------------------------

function CenterStats() {
  return (
    <div className="flex min-w-0 items-center justify-center gap-3 lg:gap-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <CreditsCounter size="md" showCps={false} />
        <CpsLine />
      </div>
      <div className="hidden items-center gap-2 md:flex">
        <SignupsChip />
        <StreakChip />
      </div>
      <div className="hidden min-w-0 xl:block">
        <PowerMeter compact />
      </div>
    </div>
  )
}

function CpsLine() {
  const cps = useGame((_, d) => d.cps)
  const throttled = useGame((_, d) => d.throttled)
  return (
    <span
      className={cn(
        'hidden whitespace-nowrap text-xs font-semibold tabular-nums md:inline',
        throttled ? 'text-slot-vae/70' : 'text-smoke-600',
      )}
      title={throttled ? 'Income throttled — the breaker tripped. Buy a PSU or shed a card.' : 'Credits per second from your rack'}
      aria-label={`${formatCps(cps)} credits per second${throttled ? ', throttled' : ''}`}
    >
      {cps > 0 ? '+' : ''}
      {formatCps(cps)}
    </span>
  )
}

function Chip({
  icon: Icon,
  iconClass,
  children,
  title,
  className,
}: {
  icon: ComponentType<LucideProps>
  iconClass?: string
  children: React.ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-comfy border border-charcoal-400 bg-charcoal-600 px-2 text-xs font-semibold tabular-nums text-smoke-600',
        className,
      )}
    >
      <Icon size={14} aria-hidden="true" className={cn('shrink-0', iconClass)} />
      {children}
    </span>
  )
}

function SignupsChip() {
  const signups = useGame((s) => s.signups)
  const rp = useGame((s) => s.rp)
  return (
    <Chip
      icon={UserPlus}
      iconClass={signups > 0 ? 'text-slot-image' : 'text-smoke-800'}
      title={`${formatNum(signups)} people signed up for Comfy because of your posts · each signup is a Research Point (${formatNum(rp)} RP unspent)`}
    >
      <span className="text-smoke-100">{formatNum(signups)}</span>
      <span className="hidden text-smoke-600 2xl:inline">signups</span>
    </Chip>
  )
}

function StreakChip() {
  const now = useNow(30_000)
  const streak = useGame((s, d) => effectiveStreak(s, now, d.streakGrace))
  const claimable = useGame((s) => canClaim(s, now))
  const off = useMotionOff()
  const nextDay = cycleDay(streak + 1)
  const label = claimable ? (streak > 0 ? `Claim day ${nextDay}` : 'Claim daily') : streak > 0 ? `day ${streak}` : 'no streak'
  return (
    <motion.button
      type="button"
      onClick={() => openModal('daily')}
      whileTap={off ? undefined : { scale: 0.94 }}
      transition={TAP}
      aria-label={
        claimable
          ? `Daily reward ready — day ${nextDay} of 7. Open the daily calendar.`
          : `Login streak: ${streak} ${streak === 1 ? 'day' : 'days'}. Open the daily calendar.`
      }
      title={claimable ? 'Your daily reward is waiting' : 'Daily streak — come back tomorrow to keep it'}
      className={cn(
        'relative inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-comfy border px-2 text-xs font-semibold tabular-nums transition-colors',
        claimable
          ? 'border-electric-400/80 bg-electric-400/10 text-smoke-100 hover:bg-electric-400/20'
          : 'border-charcoal-400 bg-charcoal-600 text-smoke-600 hover:border-charcoal-300 hover:text-smoke-100',
      )}
    >
      <Flame size={14} aria-hidden="true" className={cn('shrink-0', streak > 0 || claimable ? 'text-slot-cond' : 'text-smoke-800')} />
      <span>{label}</span>
      {claimable ? (
        <span aria-hidden="true" className="relative ml-0.5 flex size-2">
          <span className={cn('absolute inline-flex size-full rounded-full bg-electric-400 opacity-60', off ? '' : 'animate-ping')} />
          <span className="relative inline-flex size-2 rounded-full bg-electric-400" />
        </span>
      ) : null}
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Right: routes + modal buttons
// ---------------------------------------------------------------------------

const NAV_LINK =
  'inline-flex h-8 items-center gap-1.5 rounded-comfy px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600 transition-colors hover:bg-charcoal-500 hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400'

function Nav() {
  const off = useMotionOff()
  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      <Link href="/map" className={NAV_LINK} title="The Graph — spend Research Points on the skill tree">
        <Waypoints size={14} aria-hidden="true" />
        <span className="hidden xl:inline">Map</span>
        <span className="sr-only xl:hidden">Map</span>
      </Link>
      <Link href="/hub" className={NAV_LINK} title="ComfyHub — publish and run each other's workflows">
        <Workflow size={14} aria-hidden="true" />
        <span className="hidden xl:inline">Hub</span>
        <span className="sr-only xl:hidden">Hub</span>
      </Link>
      <Link href="/leaderboard" className={NAV_LINK} title="Leaderboard">
        <Trophy size={14} aria-hidden="true" />
        <span className="hidden xl:inline">Board</span>
        <span className="sr-only xl:hidden">Board</span>
      </Link>
      <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-charcoal-400 sm:block" />
      <motion.button
        type="button"
        onClick={() => openModal('stats')}
        whileTap={off ? undefined : { scale: 0.92 }}
        transition={TAP}
        aria-label="Stats"
        title="Stats"
        className={cn(NAV_LINK, 'w-8 justify-center px-0')}
      >
        <ChartColumn size={16} aria-hidden="true" />
      </motion.button>
      <motion.button
        type="button"
        onClick={() => openModal('settings')}
        whileTap={off ? undefined : { scale: 0.92, rotate: 20 }}
        transition={TAP}
        aria-label="Settings"
        title="Settings — save, export, sound, particles, motion"
        className={cn(NAV_LINK, 'w-8 justify-center px-0')}
      >
        <Settings size={16} aria-hidden="true" />
      </motion.button>
      <ProjectorToggle showLabel={false} className="hidden md:inline-flex" />
    </nav>
  )
}
