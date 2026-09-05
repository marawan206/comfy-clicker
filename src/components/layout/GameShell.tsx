'use client'
import { useGame, useGameStore } from '@/state/useGame'
import { formatCps, formatNum } from '@/game/format'
import { CreditsIcon } from '@/components/brand/CreditsIcon'

/** Placeholder shell — replaced by the real layout in the UI milestone. */
export function GameShell() {
  const store = useGameStore()
  const credits = useGame(s => Math.floor(s.credits))
  const cps = useGame((_, d) => d.cps)
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-2 text-4xl font-extrabold tabular-nums">
        <CreditsIcon size={32} className="text-credits" />
        {formatNum(credits)}
        <span className="text-base font-medium text-smoke-600">credits · {formatCps(cps)}</span>
      </div>
      <button
        type="button"
        onClick={() => store.click()}
        className="rounded-2xl bg-electric-400 px-8 py-4 text-xl font-bold text-charcoal-800 shadow-press active:translate-y-1 active:shadow-none"
      >
        Generate
      </button>
    </main>
  )
}
