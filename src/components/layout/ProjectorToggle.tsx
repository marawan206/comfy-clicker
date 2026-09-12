'use client'
import { Projector } from 'lucide-react'
import { motion } from 'motion/react'
import { useGame, useGameStore } from '@/state/useGame'
import { cn } from '@/lib/utils'

interface ProjectorToggleProps {
  /** Show the text label next to the icon (the header hides it below xl). */
  showLabel?: boolean
  className?: string
}

/**
 * Flips `settings.projector`. The shell mirrors the flag as `html.projector`, which bumps the
 * root font size so every rem-based Tailwind size grows together, built for the back row.
 */
export function ProjectorToggle({ showLabel = true, className }: ProjectorToggleProps) {
  const store = useGameStore()
  const on = useGame((s) => s.settings.projector)
  const reduced = useGame((s) => s.settings.reducedMotion)
  return (
    <motion.button
      type="button"
      onClick={() => store.toggleSetting('projector')}
      aria-pressed={on}
      aria-label={on ? 'Projector mode on. Switch back to normal size' : 'Projector mode: bigger type for the back row'}
      title={on ? 'Projector mode: on' : 'Projector mode: bigger type for the back row'}
      whileTap={reduced ? undefined : { scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-comfy border px-2 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors',
        on
          ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#8a9a00]'
          : 'border-charcoal-400 bg-charcoal-600 text-smoke-600 hover:border-charcoal-300 hover:text-smoke-100',
        className,
      )}
    >
      <Projector size={14} aria-hidden="true" />
      {showLabel ? <span>Projector</span> : null}
    </motion.button>
  )
}
