'use client'
import { memo, useCallback } from 'react'
import { motion } from 'motion/react'
import { Check, Shrink } from 'lucide-react'
import { useGameStore } from '@/state/useGame'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { formatNum } from '@/game/format'
import { cn } from '@/lib/utils'
import { useMotionOK } from '@/components/studio/studioHooks'

export interface QuantizeButtonProps {
  modelId: string
  modelName: string
  precision: 'fp8' | 'q4'
  label: string
  fee: number
  owned: boolean
  ok: boolean
  reason?: string
  /** Receives the action's error text (or null on success) so the card can show it inline. */
  onResult?: (error: string | null) => void
}

/** "Quantize FP8 · 450": pays the one-off fee and unlocks the precision on the model. */
export const QuantizeButton = memo(function QuantizeButton({
  modelId,
  modelName,
  precision,
  label,
  fee,
  owned,
  ok,
  reason,
  onResult,
}: QuantizeButtonProps) {
  const store = useGameStore()
  const reduced = !useMotionOK()
  const disabled = owned || !ok
  const quantize = useCallback(() => {
    if (disabled) {
      onResult?.(reason ?? null)
      return
    }
    const result = store.quantize(modelId, precision)
    onResult?.(result.error ?? null)
  }, [disabled, modelId, onResult, precision, reason, store])

  if (owned) {
    return (
      <span
        className="inline-flex h-8 items-center gap-1 rounded-[0.5rem] border-2 border-sapphire-700/60 bg-sapphire-700/20 px-2.5 text-xs font-bold text-smoke-100"
        title={`${modelName} is quantized to ${label}`}
      >
        <Check size={13} className="text-electric-400" aria-hidden="true" />
        {label}
      </span>
    )
  }

  return (
    <motion.button
      type="button"
      onClick={quantize}
      aria-disabled={disabled}
      aria-label={`Quantize ${modelName} to ${label} for ${formatNum(fee)} credits${ok ? '' : ` (${reason ?? 'unavailable'})`}`}
      title={ok ? `Quantize to ${label}` : reason}
      whileTap={reduced || disabled ? undefined : { scale: 0.96, y: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-[0.5rem] border-2 px-2.5 text-xs font-bold transition-colors',
        ok
          ? 'border-charcoal-200 bg-charcoal-500 text-smoke-100 shadow-[0_3px_0_#0e0e0f] hover:border-electric-400'
          : 'cursor-not-allowed border-charcoal-400 bg-charcoal-600 text-slot-vae/70',
      )}
    >
      <Shrink size={13} aria-hidden="true" />
      {label}
      <span className={cn('inline-flex items-center gap-0.5 tabular-nums', ok ? 'text-credits' : 'text-slot-vae/70')}>
        <CreditsIcon size={11} aria-hidden="true" />
        {formatNum(fee)}
      </span>
    </motion.button>
  )
})
