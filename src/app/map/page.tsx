'use client'
/**
 * /map: The Graph. A 64 px header (back to the studio, credits / RP / CP, nodes unlocked) over a
 * canvas that fills the rest of the viewport. The store is the same module singleton the game
 * runs on, so income keeps ticking here; the FX canvas and overlays are mounted so unlocks burst
 * and the prestige lane's Rebrand button opens the real dialog. The account menu rides along so
 * the auth sheet and the cloud-merge question are reachable on this route as well.
 */
import Image from 'next/image'
import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'
import { ArrowLeft, FlaskConical, Medal, Waypoints, type LucideProps } from 'lucide-react'
import { AccountMenu } from '@/components/auth/AccountMenu'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { NumberTicker } from '@/components/common/NumberTicker'
import { FxCanvas } from '@/components/fx/FxCanvas'
import { GraphMap } from '@/components/map/GraphMap'
import { useMarkVisited } from '@/components/layout/navBadges'
import { useMapBalances } from '@/components/map/mapHooks'
import { useDisplayFlags } from '@/hooks/useDisplayFlags'
import { Overlays } from '@/components/overlays/Overlays'
import { formatCps, formatNum } from '@/game/format'
import { cn } from '@/lib/utils'
import { useGame } from '@/state/useGame'

export default function MapPage() {
  // The header's "new" dot for the Graph stops once it has been opened.
  useMarkVisited('map')
  // Same <html> flags the game shell sets: projector scales the rem grid (map.css writes its type
  // in rem for exactly this), reduced-motion stops the noodle flow and the node pulse.
  const { projector } = useDisplayFlags()

  return (
    <div className={cn('relative z-10 flex h-dvh flex-col overflow-hidden bg-charcoal-800', projector && 'projector')}>
      <MapHeader />
      <main id="main" className="relative min-h-0 flex-1">
        <GraphMap />
      </main>
      <FxCanvas />
      <Overlays />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function MapHeader() {
  const { credits, rp, cp, unlocked, total, season } = useMapBalances()
  const cps = useGame((_, d) => d.cps)
  return (
    <header className="relative z-20 h-16 shrink-0 border-b-2 border-charcoal-400 bg-charcoal-700 shadow-[0_4px_0_#0e0e0f]">
      <div className="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            aria-label="Back to the studio"
            title="Back to the studio, your rack keeps rendering"
            className="inline-flex h-9 items-center gap-1.5 rounded-comfy border-2 border-charcoal-400 bg-charcoal-600 px-2.5 text-xs font-semibold text-smoke-600 shadow-[0_3px_0_#0e0e0f] transition-colors hover:border-charcoal-300 hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400 active:translate-y-px active:shadow-none"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Studio</span>
          </Link>
          <Link href="/" aria-label="Comfy Clicker, home" className="hidden shrink-0 rounded-comfy md:block">
            <Image src="/brand/comfy-logo.svg" alt="" width={32} height={32} priority draggable={false} className="size-8 select-none" />
          </Link>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
              <Waypoints size={12} aria-hidden="true" className="text-electric-400" />
              The Graph
            </p>
            <h1 className="truncate text-base leading-tight font-extrabold tracking-tight text-smoke-100">
              Season {season}
              <span className="hidden text-smoke-600 sm:inline"> · every noodle is a decision</span>
            </h1>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-2 lg:gap-3">
          <div className="flex items-baseline gap-2 whitespace-nowrap" aria-live="off">
            <span className="inline-flex items-center gap-1.5 text-lg font-extrabold tracking-tight tabular-nums text-smoke-100">
              <CreditsIcon size={16} className="shrink-0 text-credits" />
              <NumberTicker value={credits} />
            </span>
            <span className="hidden text-xs font-semibold tabular-nums text-smoke-600 md:inline" title="Credits per second from your rack">
              {cps > 0 ? '+' : ''}
              {formatCps(cps)}
            </span>
          </div>
          <Chip icon={FlaskConical} tone="#81c784" title={`${formatNum(rp)} Research Points to spend. Each signup your posts earn is one RP`}>
            <NumberTicker value={rp} />
            <span className="text-smoke-600">RP</span>
          </Chip>
          <Chip icon={Medal} tone="#7f8dff" title={`${formatNum(cp)} Comfy Points to spend, banked by rebranding`}>
            <NumberTicker value={cp} />
            <span className="text-smoke-600">CP</span>
          </Chip>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-comfy border border-charcoal-400 bg-charcoal-600 px-2 text-xs font-semibold tabular-nums text-smoke-600"
            title={`${unlocked} of ${total} nodes unlocked`}
          >
            <span className="text-smoke-100">{unlocked}</span>
            <span aria-hidden="true">/</span>
            <span>{total}</span>
            <span className="hidden xl:inline">nodes</span>
          </span>
          {/* Mounts the auth sheet and the cloud-merge question too, so a sign-in elsewhere is answered here. */}
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

function Chip({ icon: Icon, tone, title, children }: { icon: ComponentType<LucideProps>; tone: string; title: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-comfy border border-charcoal-400 bg-charcoal-600 px-2 text-xs font-semibold tabular-nums text-smoke-100"
    >
      <Icon size={14} aria-hidden="true" className="shrink-0" style={{ color: tone }} />
      {children}
    </span>
  )
}
