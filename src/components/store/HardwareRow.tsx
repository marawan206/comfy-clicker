'use client'
import { memo, useCallback, useEffect, useRef } from 'react'
import { motion, useAnimate } from 'motion/react'
import { Lock, Zap } from 'lucide-react'
import type { BuyCount } from '@/game/actions'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { formatDuration, formatNum, formatWatts } from '@/game/format'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { guideCauses } from '@/components/guidance/GuidanceHost'
import { explainBuy } from '@/game/guidance'
import { cn } from '@/lib/utils'
import { formatEach, useHardwareRow, useReducedMotionPref } from './storeHooks'

const SHAKE = { x: [0, -4, 4, -2, 2, 0] }
const POP = { scale: [1.45, 1] }

interface Props {
  id: string
  amount: BuyCount
  isNew: boolean
  onSeen: (id: string) => void
}

function HardwareRowImpl({ id, amount, isNew, onSeen }: Props) {
  const store = useGameStore()
  const def = buildIndex(store.catalog).hardwareById[id]
  const row = useHardwareRow(id, amount)
  const reduced = useReducedMotionPref()
  const [scope, animate] = useAnimate<HTMLButtonElement>()
  const mounted = useRef(false)

  // Pop the owned count when a purchase lands (not on mount, not on tab switches).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (reduced || !scope.current) return
    animate('[data-count]', POP, { type: 'spring', stiffness: 500, damping: 22 })
  }, [row.owned, reduced, animate, scope])

  const locked = row.lockReason !== null
  const disabled = locked || !row.affordable
  const buyLabel = row.count > 1 ? `${row.count}× ${def?.name ?? id}` : (def?.name ?? id)

  // A row you cannot buy explains itself instead of just refusing: the popover anchors to the row
  // and its primary button goes wherever the missing thing lives.
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onSeen(id)
      if (disabled) {
        if (def) {
          const n = row.count > 0 ? row.count : 1
          guideCauses(e.currentTarget, explainBuy(def, store.state, store.derived, store.catalog, n), store, def.name)
        }
        if (!reduced && scope.current) animate(scope.current, SHAKE, { duration: 0.28 })
        return
      }
      if (store.buyHardware(id, amount).error && !reduced && scope.current) {
        animate(scope.current, SHAKE, { duration: 0.28 })
      }
    },
    [store, id, amount, disabled, def, row.count, onSeen, reduced, animate, scope],
  )

  if (!def) return null

  const tooltip = [def.realWorld, def.flavor, row.lockReason].filter(Boolean).join('\n')
  const aria = locked
    ? `${def.name}: ${row.lockReason}`
    : `Buy ${buyLabel} for ${formatNum(row.cost)} credits${row.affordable ? '' : ' (not enough credits)'}`

  return (
    <motion.button
      ref={scope}
      type="button"
      data-id={id}
      data-tour={row.affordable ? 'store-buy' : undefined}
      onClick={onClick}
      onPointerEnter={() => isNew && onSeen(id)}
      aria-label={aria}
      aria-disabled={disabled || undefined}
      title={tooltip}
      whileTap={reduced || disabled ? undefined : { scale: 0.985 }}
      className={cn(
        'group relative mb-1.5 flex w-full items-center gap-3 rounded-xl border-2 border-charcoal-400 bg-charcoal-500 px-2.5 py-2 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
        row.affordable && 'shadow-[0_3px_0_#0e0e0f] hover:border-electric-400/70 active:translate-y-0.5 active:shadow-none',
        !row.affordable && !locked && 'opacity-60',
        locked && 'opacity-50',
      )}
    >
      <div className="relative shrink-0">
        <Art id={def.art} size={48} className={cn(locked && 'grayscale')} />
        {row.tier > 0 && (
          <span className="absolute -right-1 -bottom-1 rounded-[0.3em] border border-charcoal-800 bg-sapphire-700 px-1 text-[9px] font-extrabold text-smoke-100">
            T{row.tier}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5">
          <span className="min-w-0 text-[13px] font-semibold text-smoke-100">{def.name}</span>
          {def.cardsPerUnit && <span className="shrink-0 text-[10px] font-semibold text-smoke-700">{def.cardsPerUnit}× cards</span>}
          {isNew && (
            <motion.span
              className="shrink-0 rounded-[0.3em] bg-electric-400 px-1 text-[9px] font-extrabold tracking-wide text-charcoal-800 uppercase"
              animate={reduced ? undefined : { opacity: [1, 0.45, 1] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
            >
              new!
            </motion.span>
          )}
        </div>

        <div className={cn('mt-0.5 flex items-center gap-1 text-[14px] font-extrabold tabular-nums tracking-tight', row.affordable ? 'text-credits' : 'text-slot-vae')}>
          <CreditsIcon size={14} />
          <span>{formatNum(row.cost)}</span>
          {row.count > 1 && <span className="ml-0.5 text-[11px] font-bold text-smoke-600">for ×{row.count}</span>}
          {amount === 'max' && row.count === 0 && !locked && <span className="ml-0.5 text-[11px] font-bold text-smoke-600">next</span>}
        </div>

        {locked ? (
          <div className="mt-0.5 flex items-start gap-1 text-[11px] leading-snug text-slot-vae/90">
            <Lock size={11} className="mt-px shrink-0" aria-hidden="true" />
            <span className="min-w-0">{row.lockReason}</span>
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums text-smoke-600">
            <span className="text-smoke-100/90">{formatEach(row.cpsEach)} each</span>
            <span>payback {formatDuration(row.paybackSec)}</span>
            <span>{formatWatts(def.watts)}</span>
            {row.tripsBreaker && (
              <span className="flex items-center gap-0.5 text-slot-vae" title="This purchase pushes draw past the power budget">
                <Zap size={10} aria-hidden="true" /> trips breaker
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end pl-1">
        <span
          data-count
          className={cn('inline-block text-2xl font-extrabold tabular-nums tracking-tight', row.owned > 0 ? 'text-smoke-100' : 'text-smoke-800')}
        >
          {row.owned}
        </span>
        <span className="text-[10px] font-semibold tracking-[0.08em] text-smoke-700 uppercase">
          {Number.isFinite(row.room) ? `of ${row.owned + row.room}` : 'owned'}
        </span>
      </div>
    </motion.button>
  )
}

/** One store row for a hardware unit; re-renders only when its own slice changes. */
export const HardwareRow = memo(HardwareRowImpl)
