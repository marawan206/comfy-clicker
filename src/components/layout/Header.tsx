'use client'
/**
 * The 64 px top bar. Three tracks: the brand, the live numbers, and the nav.
 *
 * The nav used to be a row of 14 px grey glyphs that said nothing about where they went, so a new
 * player had no reason to press any of them. It is now a row of tiles (`NavTile`): each one carries
 * its destination's colour, a label wherever there is room, a tooltip that says what is behind it,
 * a badge when something is waiting there, and a "new" dot the first time that destination becomes
 * worth the detour. The rules for all of that are pure functions in `navMeta.ts`; the live numbers
 * come from `navBadges.ts`, which is careful never to read the store at the loop's 20 Hz.
 *
 * Layout note: the grid is `auto | minmax(0,1fr) | auto`, so the brand and the nav take their
 * natural width and the centre track absorbs what is left. The centre therefore clips rather than
 * pushing, and its chips appear at md, lg and 2xl as the width allows.
 */
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Flame, Sparkles, UserPlus } from 'lucide-react'
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { useAuth } from '@/components/auth/useAuth'
import { Tooltip } from '@/components/common/Tooltip'
import { levelChipTip, signupsTip, streakTip } from '@/components/common/tooltipCopy'
import { fx } from '@/components/fx/fxBus'
import { CreditsCounter } from '@/components/hero/CreditsCounter'
import { PowerMeter } from '@/components/hero/PowerMeter'
import { NavTile } from '@/components/layout/NavTile'
import { SaveStatus } from '@/components/layout/SaveStatus'
import { msUntilDayEnd, markVisited, useNavBadges } from '@/components/layout/navBadges'
import { BOARD_PULSE_CREDITS, activeTileId, navTile, pulseTiles, type NavTileId } from '@/components/layout/navMeta'
import { canClaim, cycleDay, dailyReward, effectiveStreak } from '@/game/daily'
import { formatCps, formatNum } from '@/game/format'
import { levelProgress, levelTitle, nextUnlocks } from '@/game/level'
import { canRebrand, rebrandCp } from '@/game/prestige'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'
import { useGame, useGameEvents, useGameShallow, useGameStore } from '@/state/useGame'

/** Modal ids the header raises. `lounge`, `help` and `level` belong to the overlays and tutorial work. */
type ModalId = 'settings' | 'stats' | 'daily' | 'rebrand' | 'lounge' | 'help' | 'level'

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

/** Under this much of the UTC day left, an unclaimed streak is at risk and says so. */
const STREAK_RISK_MS = 6 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

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
// Left: logo + wordmark (and the wordmark easter egg)
// ---------------------------------------------------------------------------

/** Clicks this far apart or further start the count over. */
const TITLE_GAP_MS = 1500
/** Clicks needed for the payout. */
const TITLE_TARGET = 25
/** The word starts springing here. */
const TITLE_FEEL = 10
/** The electric glow starts here. */
const TITLE_GLOW = 20
export const TITLE_FLAG = 'title-25'

function Brand() {
  const season = useGame((s) => s.meta.season)
  const store = useGameStore()
  const off = useMotionOff()
  const controls = useAnimationControls()
  const [count, setCount] = useState(0)
  const lastAt = useRef(0)

  /**
   * Twenty-five clicks on the wordmark, at most 1.5 s apart. The escalation is the point: at ten
   * the word starts springing back, at twenty it picks up an electric glow, so a curious player
   * feels something building long before they know what it is.
   */
  const onWordmark = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      const now = Date.now()
      const next = now - lastAt.current <= TITLE_GAP_MS ? count + 1 : 1
      lastAt.current = now
      if (next >= TITLE_TARGET) {
        setCount(0)
        lastAt.current = 0
        store.setFlag(TITLE_FLAG)
        fx.floatText(event.clientX, event.clientY - 8, '+1,000')
        fx.confetti()
        return
      }
      setCount(next)
      if (next >= TITLE_FEEL && !off) {
        const reach = 1 + 0.04 * (1 + (next - TITLE_FEEL) / (TITLE_TARGET - TITLE_FEEL))
        void controls.start({ scale: [1, reach, 1] }, { duration: 0.24 })
      }
    },
    [count, off, store, controls],
  )

  const glow = count >= TITLE_GLOW ? (count - TITLE_GLOW + 1) / (TITLE_TARGET - TITLE_GLOW) : 0

  return (
    <Link
      href="/"
      aria-label="Comfy Clicker, home"
      className="flex min-w-0 items-center gap-2.5 rounded-comfy pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
    >
      <Image src="/brand/comfy-logo.svg" alt="" width={32} height={32} priority draggable={false} className="size-8 shrink-0 select-none" />
      <span className="hidden items-baseline gap-1.5 whitespace-nowrap text-lg font-extrabold tracking-tight select-none sm:flex">
        <span className="text-smoke-100">Comfy</span>
        <motion.span
          onClick={onWordmark}
          animate={controls}
          className="inline-block text-electric-400"
          style={glow > 0 ? { textShadow: `0 0 ${6 + 14 * glow}px rgba(240, 255, 65, ${0.35 + 0.5 * glow})` } : undefined}
        >
          Clicker
        </motion.span>
      </span>
      {season > 1 ? (
        <Tooltip
          title={`Season ${season}`}
          description={`You have rebranded ${season - 1} ${season === 2 ? 'time' : 'times'}. Comfy Points carry across seasons.`}
          side="bottom"
        >
          <span className="hidden rounded-comfy border border-slot-model/50 bg-slot-model/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-slot-model uppercase md:inline">
            S{season}
          </span>
        </Tooltip>
      ) : null}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Centre: counter, cps, level, signups, streak, rebrand teaser, power
// ---------------------------------------------------------------------------

function CenterStats() {
  return (
    <div className="flex min-w-0 items-center justify-center gap-3 overflow-hidden lg:gap-4">
      <div className="flex min-w-0 shrink-0 items-baseline gap-2">
        <CreditsCounter size="md" showCps={false} />
        <CpsLine />
      </div>
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <LevelChip />
        <SignupsChip />
        <StreakChip />
        <RebrandChip />
      </div>
      <div className="hidden min-w-0 2xl:block">
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
      className={cn('hidden text-xs font-semibold whitespace-nowrap tabular-nums md:inline', throttled ? 'text-slot-vae/70' : 'text-smoke-600')}
      aria-label={`${formatCps(cps)} credits per second${throttled ? ', throttled' : ''}`}
    >
      {cps > 0 ? '+' : ''}
      {formatCps(cps)}
    </span>
  )
}

const CHIP_BASE =
  'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-comfy border px-2 text-xs font-semibold whitespace-nowrap tabular-nums transition-colors'
const CHIP_IDLE = 'border-charcoal-400 bg-charcoal-600 text-smoke-600 hover:border-charcoal-300 hover:text-smoke-100'

/**
 * `LV 4` with a 3 px electric fill bar: the compact twin of the hero panel's `LevelBar`, and a
 * click on either opens the Level screen. The selector returns the level and the percent as a
 * whole number, so the chip re-renders at most a hundred times per level instead of twenty times
 * a second; the tooltip's XP figures are read off the store when that percent moves.
 */
function LevelChip() {
  const store = useGameStore()
  const off = useMotionOff()
  const controls = useAnimationControls()
  const { level, pct } = useGameShallow((s) => {
    const p = levelProgress(s)
    return { level: p.level, pct: Math.round(p.fraction * 100) }
  })

  useGameEvents((e) => {
    if (e.type !== 'levelUp' || off) return
    void controls.start({ scale: [1, 1.25, 1] }, { duration: 0.45 })
  })

  const tip = useMemo(() => {
    const p = levelProgress(store.state)
    const next = nextUnlocks(p.level, store.catalog)
    return levelChipTip({
      level: p.level,
      levelTitle: levelTitle(p.level),
      xp: p.xp,
      ceiling: p.ceiling > p.floor ? p.ceiling : null,
      unlocks: [...next.hardware.map((h) => h.name), ...next.models.map((m) => m.name)],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the bar moves, not every tick
  }, [store, level, pct])

  return (
    <Tooltip {...tip} side="bottom">
      <motion.button
        type="button"
        onClick={() => openModal('level')}
        animate={controls}
        whileTap={off ? undefined : { scale: 0.94 }}
        transition={TAP}
        aria-label={`Level ${level}, ${pct}% of the way to level ${level + 1}. Open your level.`}
        className={cn(CHIP_BASE, 'overflow-hidden border-electric-400/40 bg-electric-400/10 text-smoke-100 hover:border-electric-400/80')}
      >
        <span className="text-[10px] font-bold tracking-[0.08em] text-electric-400 uppercase">LV</span>
        <span className="font-extrabold">{level}</span>
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-charcoal-400">
          <span className="block h-full bg-electric-400 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </span>
      </motion.button>
    </Tooltip>
  )
}

function SignupsChip() {
  const { signups, rp } = useGameShallow((s) => ({ signups: s.signups, rp: s.rp }))
  return (
    <Tooltip {...signupsTip(signups, rp)} side="bottom">
      <Link
        href="/map"
        onClick={() => markVisited('map')}
        aria-label={`${formatNum(signups)} Comfy Cloud signups, ${formatNum(rp)} Research Points unspent. Open the Graph.`}
        className={cn(CHIP_BASE, CHIP_IDLE, 'focus-visible:ring-2 focus-visible:ring-electric-400 focus-visible:outline-none')}
      >
        <UserPlus size={14} aria-hidden="true" className={cn('shrink-0', signups > 0 ? 'text-slot-image' : 'text-smoke-800')} />
        <span className="text-smoke-100">{formatNum(signups)}</span>
        <span className="hidden text-smoke-600 2xl:inline">signups</span>
      </Link>
    </Tooltip>
  )
}

function StreakChip() {
  const now = useNow(30_000)
  const streak = useGame((s, d) => effectiveStreak(s, now, d.streakGrace))
  const claimable = useGame((s) => canClaim(s, now))
  const reward = useGame((s, d) => dailyReward(d.cps, cycleDay(effectiveStreak(s, now, d.streakGrace) + 1)))
  const off = useMotionOff()
  const nextDay = cycleDay(streak + 1)

  const msLeft = msUntilDayEnd(now)
  const hoursLeft = Math.max(1, Math.ceil(msLeft / 3_600_000))
  const atRisk = claimable && msLeft < STREAK_RISK_MS

  const label = atRisk
    ? `day ${nextDay} · ${hoursLeft}h left`
    : claimable
      ? streak > 0
        ? `Claim day ${nextDay}`
        : 'Claim daily'
      : streak > 0
        ? `day ${streak}`
        : 'no streak'

  const tip = streakTip({ streak, nextDay, claimable, reward })
  const riskTip = atRisk
    ? { title: 'Daily login', description: 'Claim before midnight UTC or the streak resets.', meta: `${hoursLeft}h left today`, tone: 'credits' as const }
    : tip

  return (
    <Tooltip {...riskTip} side="bottom">
      <motion.button
        type="button"
        onClick={() => openModal('daily')}
        whileTap={off ? undefined : { scale: 0.94 }}
        transition={TAP}
        aria-label={
          atRisk
            ? `Daily reward unclaimed, about ${hoursLeft} hours left in the UTC day. Open the daily calendar.`
            : claimable
              ? `Daily reward ready, day ${nextDay} of 7. Open the daily calendar.`
              : `Login streak: ${streak} ${streak === 1 ? 'day' : 'days'}. Open the daily calendar.`
        }
        className={cn(
          CHIP_BASE,
          atRisk
            ? 'border-credits/80 bg-credits/10 text-credits hover:bg-credits/20'
            : claimable
              ? 'border-electric-400/80 bg-electric-400/10 text-smoke-100 hover:bg-electric-400/20'
              : CHIP_IDLE,
        )}
      >
        <Flame
          size={14}
          aria-hidden="true"
          className={cn('shrink-0', atRisk ? 'text-credits' : streak > 0 || claimable ? 'text-slot-cond' : 'text-smoke-800')}
        />
        <span>{label}</span>
        {claimable ? (
          <span aria-hidden="true" className="relative ml-0.5 flex size-2">
            <span
              className={cn('absolute inline-flex size-full rounded-full opacity-60', atRisk ? 'bg-credits' : 'bg-electric-400', off ? '' : 'animate-ping')}
            />
            <span className={cn('relative inline-flex size-2 rounded-full', atRisk ? 'bg-credits' : 'bg-electric-400')} />
          </span>
        ) : null}
      </motion.button>
    </Tooltip>
  )
}

/** Only there when a rebrand would actually bank a point. Hidden the rest of the time. */
function RebrandChip() {
  const off = useMotionOff()
  const cp = useGameShallow((s, _d, store) => ({ v: canRebrand(s, store.catalog) ? rebrandCp(s.seasonCredits) : 0 })).v
  if (cp < 1) return null
  return (
    <Tooltip
      title="Rebrand"
      description="Reset the studio, keep the Comfy Points. The prestige lane of the Graph spends them."
      meta={`Banks ${formatNum(cp)} CP right now`}
      tone="electric"
      side="bottom"
    >
      <motion.button
        type="button"
        onClick={() => openModal('rebrand')}
        whileTap={off ? undefined : { scale: 0.94 }}
        transition={TAP}
        aria-label={`Rebrand for ${formatNum(cp)} Comfy Points. Open the rebrand dialog.`}
        className={cn(CHIP_BASE, 'hidden border-electric-400/80 bg-electric-400/10 text-electric-400 hover:bg-electric-400/20 lg:inline-flex')}
      >
        <Sparkles size={14} aria-hidden="true" className="shrink-0" />
        <span>Rebrand</span>
        <span aria-hidden="true" className="text-smoke-600">
          ·
        </span>
        <span className="font-extrabold">+{formatNum(cp)} CP</span>
      </motion.button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Right: the nav tiles, the save chip and the account menu
// ---------------------------------------------------------------------------

function Nav() {
  const off = useMotionOff()
  const pathname = usePathname()
  const active = activeTileId(pathname)
  const auth = useAuth()
  const badges = useNavBadges()
  const store = useGameStore()
  const projectorOn = useGame((s) => s.settings.projector)
  const signedIn = auth.status === 'signed-in'

  // The only state the pulse rules read. Selecting these two keeps the nav off the 20 Hz path;
  // `shouldPulse` then reads the live state off the store, which is the same object either way.
  const gates = useGameShallow((s) => ({ posts: s.stats.posts, worthBoarding: s.lifetimeCredits >= BOARD_PULSE_CREDITS }))

  const pulses = useMemo(
    () =>
      pulseTiles({
        state: store.state,
        derived: store.derived,
        visited: badges.visited,
        signedIn,
        affordable: badges.affordable,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `gates` is the change signal for `store.state`
    [store, gates, badges.visited, badges.affordable, signedIn],
  )

  const open = useCallback((id: NavTileId, modal: ModalId) => {
    markVisited(id)
    openModal(modal)
  }, [])

  return (
    <nav data-tour="nav" aria-label="Primary" className="flex items-center gap-1 overflow-visible">
      <NavTile
        meta={navTile('map')}
        active={active === 'map'}
        badge={badges.affordable}
        pulse={pulses.has('map')}
        motionOff={off}
        onClick={() => markVisited('map')}
      />
      <NavTile
        meta={navTile('hub')}
        active={active === 'hub'}
        badge={badges.hubUnseen}
        pulse={pulses.has('hub')}
        motionOff={off}
        onClick={() => markVisited('hub')}
      />
      <NavTile
        meta={navTile('leaderboard')}
        active={active === 'leaderboard'}
        badgeText={badges.rank === null ? null : `#${badges.rank}`}
        pulse={pulses.has('leaderboard')}
        motionOff={off}
        onClick={() => markVisited('leaderboard')}
      />
      {/* Seed Roulette joins the header at level 2, which is also where the engine unlocks it. */}
      {badges.loungeUnlocked ? <NavTile meta={navTile('lounge')} dot={badges.freeSpin} motionOff={off} onClick={() => open('lounge', 'lounge')} /> : null}

      <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-charcoal-400 sm:block" />

      <NavTile meta={navTile('help')} dot={badges.tourPending} motionOff={off} onClick={() => open('help', 'help')} />
      <NavTile
        meta={navTile('stats')}
        badge={badges.statsUnseen}
        pulse={pulses.has('stats')}
        motionOff={off}
        onClick={() => open('stats', 'stats')}
      />
      {/* The dot here is the patch notes, which live one click inside Settings. */}
      <NavTile meta={navTile('settings')} dot={badges.patchNotes} motionOff={off} onClick={() => open('settings', 'settings')} />
      <span className="hidden 2xl:contents">
        <NavTile
          meta={navTile('projector')}
          pressed={projectorOn}
          motionOff={off}
          onClick={() => {
            markVisited('projector')
            store.toggleSetting('projector')
          }}
        />
      </span>

      <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-charcoal-400 sm:block" />
      <SaveStatus motionOff={off} />
      <AccountMenu />
    </nav>
  )
}
