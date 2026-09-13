'use client'
/**
 * One header destination, drawn as a tile instead of a grey glyph.
 *
 * The owner's complaint was that the old icons were invisible and unexplained, so every tile now
 * carries its destination's colour, a label wherever there is room for one, a rich tooltip saying
 * what is behind it, and a badge when there is something waiting. The active route gets a washed
 * background and a sliding underline so the header always says where you are.
 */
import Link from 'next/link'
import type { ComponentType, ReactElement } from 'react'
import type { LucideProps } from 'lucide-react'
import { motion } from 'motion/react'
import { Tooltip } from '@/components/common/Tooltip'
import { navTileTip } from '@/components/common/tooltipCopy'
import { cn } from '@/lib/utils'
import { formatBadge, type NavTileMeta } from './navMeta'

/** Next's `Link` with Motion's gesture props, created once so the identity stays stable. */
const MotionLink = motion.create(Link)

/** The shared underline identity; only one tile is active, so the bar springs between tiles. */
const ACTIVE_BAR_ID = 'comfy-nav-active'
const BAR_SPRING = { type: 'spring', stiffness: 420, damping: 34 } as const
const TAP = { type: 'spring', stiffness: 500, damping: 30 } as const

export interface NavTileProps {
  meta: NavTileMeta
  /** This tile's route is the one being shown. */
  active?: boolean
  /** A count to show in the corner. 0 or negative renders nothing. */
  badge?: number
  /** Literal badge text (the Board tile shows a rank, e.g. `#12`), used instead of `badge`. */
  badgeText?: string | null
  /** A bare dot instead of a count (free spin ready, tour not run yet). */
  dot?: boolean
  /** The "new" pulse: an unvisited destination that is finally worth a look. */
  pulse?: boolean
  /** Toggle tiles (Projector) render as pressed. */
  pressed?: boolean
  /** Reduced motion, from both the OS and the in-game setting. */
  motionOff?: boolean
  onClick?: () => void
}

/**
 * Label visibility. Route tiles keep their word from xl (1280) up, utility tiles from 2xl, and
 * everything collapses to a 36 px square below that with its tooltip doing the explaining.
 */
function labelClass(labelled: boolean): string {
  return labelled ? 'hidden xl:inline' : 'hidden 2xl:inline'
}

function shapeClass(labelled: boolean): string {
  return labelled
    ? 'w-9 justify-center px-0 xl:w-auto xl:justify-start xl:px-2.5'
    : 'w-9 justify-center px-0 2xl:w-auto 2xl:justify-start 2xl:px-2.5'
}

function Icon({ icon: Glyph, className }: { icon: ComponentType<LucideProps>; className: string }) {
  return <Glyph size={16} aria-hidden="true" className={cn('shrink-0', className)} />
}

export function NavTile({
  meta,
  active = false,
  badge = 0,
  badgeText = null,
  dot = false,
  pulse = false,
  pressed = false,
  motionOff = false,
  onClick,
}: NavTileProps) {
  const count = badgeText ?? formatBadge(badge)
  const tip = navTileTip(meta.id)
  const label = meta.label.toUpperCase()

  const inner = (
    <>
      <Icon icon={meta.icon} className={cn(meta.tint.icon, pressed && 'text-charcoal-800')} />
      <span className={cn(labelClass(meta.labelled), 'text-[11px] font-bold uppercase tracking-[0.08em]', pressed ? 'text-charcoal-800' : 'text-smoke-100')}>
        {label}
      </span>
      {count ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-[0.354em] px-1 text-[10px] font-extrabold leading-none tabular-nums shadow-[0_1px_0_#0e0e0f]',
            meta.tint.badge,
          )}
        >
          {count}
        </span>
      ) : dot ? (
        <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 flex size-2.5">
          <span className={cn('absolute inline-flex size-full rounded-full opacity-60', meta.tint.dot, motionOff ? '' : 'animate-ping')} />
          <span className={cn('relative inline-flex size-2.5 rounded-full border border-charcoal-700', meta.tint.dot)} />
        </span>
      ) : pulse ? (
        <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 flex size-2">
          <span className={cn('absolute inline-flex size-full rounded-full opacity-60', meta.tint.dot, motionOff ? '' : 'animate-ping')} />
          <span className={cn('relative inline-flex size-2 rounded-full', meta.tint.dot)} />
        </span>
      ) : null}
      {active ? (
        motionOff ? (
          <span aria-hidden="true" className={cn('absolute inset-x-1.5 -bottom-px h-0.5 rounded-full', meta.tint.bar)} />
        ) : (
          <motion.span
            aria-hidden="true"
            layoutId={ACTIVE_BAR_ID}
            transition={BAR_SPRING}
            className={cn('absolute inset-x-1.5 -bottom-px h-0.5 rounded-full', meta.tint.bar)}
          />
        )
      ) : null}
    </>
  )

  const base = cn(
    'relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-comfy border transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
    shapeClass(meta.labelled),
    pressed
      ? 'border-electric-400 bg-electric-400 shadow-[0_2px_0_#8a9a00]'
      : cn('border-charcoal-400 hover:bg-charcoal-500', meta.tint.hoverBorder, active ? meta.tint.activeBg : 'bg-charcoal-600'),
  )

  // Icon-only tiles say where they go; labelled ones add the pitch so the label is not the whole story.
  const ariaLabel = `${meta.label}: ${meta.pitch}`
  const tap = motionOff ? undefined : { scale: 0.94 }

  const element: ReactElement = meta.href ? (
    <MotionLink
      href={meta.href}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      whileTap={tap}
      transition={TAP}
      className={base}
    >
      {inner}
    </MotionLink>
  ) : (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed ? true : undefined}
      onClick={onClick}
      whileTap={tap}
      transition={TAP}
      className={base}
    >
      {inner}
    </motion.button>
  )

  return <Tooltip {...tip}>{element}</Tooltip>
}
