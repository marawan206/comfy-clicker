'use client'
import { Clock, Cpu, Flame, Repeat } from 'lucide-react'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { REPOST_PENALTY } from '@/game/constants'
import { formatNum } from '@/game/format'
import { cn } from '@/lib/utils'
import { formatShortSecs, useCostPreview } from './studioHooks'

/** "1,240 credits · 12 s of income · ~8 s on RTX 4090 · ×1.8 trend" */
export function CostLine() {
  const { cost, incomeSec, genSec, hardwareName, affordable, trend, spam, repost } = useCostPreview()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-smoke-600" aria-live="off">
      <span className={cn('inline-flex items-center gap-1 font-bold tabular-nums', affordable ? 'text-credits' : 'text-slot-vae')}>
        <CreditsIcon size={13} aria-hidden="true" />
        {formatNum(cost)}
        <span className="font-medium text-smoke-700">credits</span>
      </span>
      <Sep />
      <span className="tabular-nums" title="What the job costs in income at your current rate">
        {Number.isFinite(incomeSec) ? `${formatShortSecs(incomeSec)} of income` : 'no income yet'}
      </span>
      <Sep />
      {hardwareName && genSec !== null ? (
        <span className="inline-flex items-center gap-1 tabular-nums" title={`Runs on ${hardwareName}`}>
          <Cpu size={12} aria-hidden="true" />~{formatShortSecs(genSec)} on {hardwareName}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-slot-vae/80">
          <Clock size={12} aria-hidden="true" />
          nothing to run it on
        </span>
      )}
      <Sep />
      <span
        className={cn(
          'inline-flex items-center gap-1 font-semibold tabular-nums',
          spam ? 'text-slot-vae' : trend > 1 ? 'text-electric-400' : 'text-smoke-700',
        )}
        title="Reach multiplier from trending hashtags and keywords (moves likes, not credits)"
      >
        {trend > 1 && !spam ? <Flame size={12} aria-hidden="true" /> : null}×{trend.toFixed(1)} trend
      </span>
      {repost ? (
        <>
          <Sep />
          <span className="inline-flex items-center gap-1 font-semibold text-slot-cond" title="Same model, tags and prompt as your last post: reach halved">
            <Repeat size={12} aria-hidden="true" />
            repost ×{REPOST_PENALTY}
          </span>
        </>
      ) : null}
    </div>
  )
}

function Sep() {
  return (
    <span className="text-charcoal-200" aria-hidden="true">
      ·
    </span>
  )
}
