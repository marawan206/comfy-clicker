'use client'
import { motion } from 'motion/react'
import type { BuyCount } from '@/game/actions'
import { cn } from '@/lib/utils'
import { useReducedMotionPref } from './storeHooks'

export const BUY_AMOUNTS: readonly BuyCount[] = [1, 10, 100, 'max']

interface Props {
  value: BuyCount
  onChange: (next: BuyCount) => void
  className?: string
}

/** Segmented 1 / 10 / 100 / Max control; the electric pill slides between options. */
export function BuyAmount({ value, onChange, className }: Props) {
  const reduced = useReducedMotionPref()
  return (
    <div
      role="radiogroup"
      aria-label="Buy amount"
      className={cn('inline-flex items-center gap-0.5 rounded-lg border border-charcoal-400 bg-charcoal-700 p-0.5', className)}
    >
      {BUY_AMOUNTS.map((n) => {
        const active = n === value
        const label = n === 'max' ? 'Max' : `×${n}`
        return (
          <button
            key={String(n)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={n === 'max' ? 'Buy as many as you can afford' : `Buy ${n} at a time`}
            onClick={() => onChange(n)}
            className={cn(
              'relative isolate h-7 min-w-11 rounded-md px-2 text-[12px] font-bold tabular-nums tracking-tight transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
              active ? 'text-charcoal-800' : 'text-smoke-600 hover:text-smoke-100',
            )}
          >
            {active && (
              <motion.span
                layoutId="buy-amount-pill"
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-md bg-electric-400 shadow-[0_2px_0_#0e0e0f]"
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 34 }}
              />
            )}
            {label}
          </button>
        )
      })}
    </div>
  )
}
