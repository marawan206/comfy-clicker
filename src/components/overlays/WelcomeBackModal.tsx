'use client'
/**
 * Offline earnings report. `store.offlineReport` is set by `start()` / long gaps once the credits
 * are already banked, so "Claim" only dismisses it, but a number that big deserves a moment.
 */
import { useState } from 'react'
import { motion } from 'motion/react'
import { Moon } from 'lucide-react'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { ModalBase, ModalButton, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { OFFLINE_LINES } from '@/data/flavor'
import { formatDuration, formatNum } from '@/game/format'
import { hashString } from '@/game/rng'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'
import type { OfflineReport } from '@/state/store'

export function WelcomeBackModal() {
  const store = useGameStore()
  const report = useGame((_, __, s) => s.offlineReport)
  // Keep the last report around so the panel still has content during its exit animation
  // (derived-state-during-render: React re-runs the render with the new value immediately).
  const [shown, setShown] = useState<OfflineReport | null>(report)
  if (report && report !== shown) setShown(report)

  const dismiss = () => store.dismissOffline()

  return (
    <ModalBase open={report !== null} onClose={dismiss} title="Comfy Sleep Mode" icon={<Moon size={16} />} stripe="sapphire" size="sm">
      {shown ? <OfflineBody report={shown} onClaim={dismiss} /> : null}
    </ModalBase>
  )
}

function OfflineBody({ report, onClaim }: { report: OfflineReport; onClaim: () => void }) {
  const reduced = useReducedMotionPref()
  const { capHours, efficiency } = useGameShallow((_, d) => ({ capHours: d.offlineCapHours, efficiency: d.offlineEfficiency }))
  const quip = OFFLINE_LINES[hashString(`${report.elapsedSec}:${report.gain}`) % OFFLINE_LINES.length] ?? OFFLINE_LINES[0]
  const capped = Number.isFinite(capHours) && report.elapsedSec > capHours * 3600
  const capText = Number.isFinite(capHours) ? `${capHours} h` : 'unlimited'

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-smoke-600">{quip}</p>
      <motion.div
        className="flex items-center gap-2 text-5xl font-extrabold tracking-tight text-credits tabular-nums"
        initial={reduced ? false : { scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0.1 } : { type: 'spring', stiffness: 320, damping: 18, delay: 0.08 }}
      >
        <CreditsIcon size={40} />
        <span>+{formatNum(report.gain)}</span>
      </motion.div>
      <dl className="grid w-full grid-cols-2 gap-2 text-left">
        <div className="rounded-xl border border-charcoal-400 bg-charcoal-700/60 px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">Away for</dt>
          <dd className="text-base font-bold text-smoke-100 tabular-nums">
            {formatDuration(report.elapsedSec)}
            {capped ? <span className="ml-1 text-xs font-semibold text-slot-cond">capped</span> : null}
          </dd>
        </div>
        <div className="rounded-xl border border-charcoal-400 bg-charcoal-700/60 px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">Idle rate</dt>
          <dd className="text-base font-bold text-smoke-100 tabular-nums">
            {Math.round(efficiency * 100)}% <span className="text-xs font-semibold text-smoke-600">up to {capText}</span>
          </dd>
        </div>
      </dl>
      {capped ? (
        <p className="text-xs text-smoke-600">The rack idles past the cap. Comfy Cloud: Always On on the Graph raises it.</p>
      ) : null}
      <ModalButton tone="primary" size="lg" onClick={onClaim} className="w-full" data-autofocus>
        Claim
      </ModalButton>
    </div>
  )
}
