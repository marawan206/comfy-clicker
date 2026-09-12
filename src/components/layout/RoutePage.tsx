'use client'
import Image from 'next/image'
import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'
import { ArrowLeft, type LucideProps } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { NumberTicker } from '@/components/common/NumberTicker'
import { Panel, type Stripe } from '@/components/common/Panel'
import { DotGrid } from '@/components/layout/DotGrid'
import { formatCps, formatNum } from '@/game/format'
import { cn } from '@/lib/utils'
import { useGame } from '@/state/useGame'

export interface RouteStat {
  label: string
  value: number
  /** Show the credits glyph in front of the number. */
  credits?: boolean
  format?: (n: number) => string
}

export interface RoutePageProps {
  icon: ComponentType<LucideProps>
  stripe: Stripe
  eyebrow: string
  title: string
  /** One dry line under the title. */
  lede: string
  /** Two or three live numbers from the store that prove the game kept running. */
  stats: RouteStat[]
  children?: ReactNode
}

const ENTER = { type: 'spring', stiffness: 260, damping: 26 } as const

/**
 * A secondary route (Map, Hub, Board) rendered on the same litegraph canvas as the game. The
 * store is a module singleton started in the root layout, so credits keep accruing here and the
 * counter in the corner proves it; a hard-shadow panel carries the page's own content.
 */
export function RoutePage({ icon: Icon, stripe, eyebrow, title, lede, stats, children }: RoutePageProps) {
  const os = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  const instant = Boolean(os) || setting

  return (
    <>
      <DotGrid />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b-2 border-charcoal-400 bg-charcoal-700 px-4 shadow-[0_4px_0_#0e0e0f]">
          <Link
            href="/"
            aria-label="Comfy Clicker, back to the studio"
            className="flex min-w-0 items-center gap-2.5 rounded-comfy pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
          >
            <Image
              src="/brand/comfy-logo.svg"
              alt=""
              width={32}
              height={32}
              priority
              draggable={false}
              className="size-8 shrink-0 select-none"
            />
            <span className="flex items-baseline gap-1.5 whitespace-nowrap text-lg font-extrabold tracking-tight">
              <span className="text-smoke-100">Comfy</span>
              <span className="text-electric-400">Clicker</span>
            </span>
          </Link>
          <LiveCredits />
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-4 py-8">
          <motion.div
            className="w-full max-w-xl"
            initial={instant ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={ENTER}
          >
            <Panel stripe={stripe} bodyClassName="p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-14 shrink-0 items-center justify-center rounded-comfy border-2 border-charcoal-400 bg-charcoal-700 shadow-[0_3px_0_#0e0e0f]',
                    STRIPE_TEXT[stripe],
                  )}
                >
                  <Icon size={28} />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">{eyebrow}</p>
                  <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-smoke-100">{title}</h1>
                  <p className="mt-2 text-sm leading-relaxed text-smoke-600">{lede}</p>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-comfy border border-charcoal-400 bg-charcoal-700 px-3 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">{stat.label}</dt>
                    <dd
                      className={cn(
                        'mt-0.5 flex items-center gap-1 text-lg font-bold tabular-nums',
                        stat.credits ? 'text-credits' : 'text-smoke-100',
                      )}
                    >
                      {stat.credits ? <CreditsIcon size={16} className="shrink-0" /> : null}
                      <NumberTicker value={stat.value} format={stat.format ?? formatNum} />
                    </dd>
                  </div>
                ))}
              </dl>

              {children ? <div className="mt-5 text-sm text-smoke-600">{children}</div> : null}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  href="/"
                  className="inline-flex h-10 items-center gap-2 rounded-comfy border-2 border-electric-400 bg-electric-400 px-4 text-sm font-bold text-charcoal-800 shadow-[0_3px_0_#0e0e0f] transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-600 active:translate-y-px"
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back to the studio
                </Link>
                <span className="text-xs text-smoke-600">Your rack kept rendering while you were here.</span>
              </div>
            </Panel>
          </motion.div>
        </main>
      </div>
    </>
  )
}

const STRIPE_TEXT: Record<Stripe, string> = {
  model: 'text-slot-model',
  clip: 'text-slot-clip',
  cond: 'text-slot-cond',
  image: 'text-slot-image',
  latent: 'text-slot-latent',
  vae: 'text-slot-vae',
  mask: 'text-slot-mask',
  electric: 'text-electric-400',
  sapphire: 'text-sapphire-700',
  none: 'text-smoke-600',
}

/** Compact live counter for the corner of a secondary route. */
function LiveCredits() {
  const credits = useGame((s) => s.credits)
  const cps = useGame((_, d) => d.cps)
  return (
    <div className="flex items-baseline gap-2" aria-live="off">
      <span className="inline-flex items-center gap-1 text-lg font-extrabold tabular-nums text-credits">
        <CreditsIcon size={18} className="shrink-0" />
        <NumberTicker value={credits} />
      </span>
      <span className="hidden text-xs font-semibold tabular-nums text-smoke-600 sm:inline" title="Credits per second from your rack">
        {cps > 0 ? '+' : ''}
        {formatCps(cps)}
      </span>
    </div>
  )
}
