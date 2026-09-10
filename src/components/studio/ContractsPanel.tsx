'use client'
import { memo, useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Clock, Gift, Trophy } from 'lucide-react'
import { useGame, useGameStore } from '@/state/useGame'
import { useNow } from '@/hooks/useNow'
import { Panel } from '@/components/common/Panel'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { CONTRACT_ROTATE_MS } from '@/game/constants'
import { formatDuration, formatNum } from '@/game/format'
import { cn } from '@/lib/utils'
import { useContractRows, useMotionOK, type ContractRowState } from './studioHooks'

/** Client gigs: progress toward each goal, the reward, and a Claim button once it is done. */
export function ContractsPanel() {
  const rows = useContractRows()
  const nextRotateAt = useGame((s) => s.contracts.nextRotateAt)
  const completed = useGame((s) => s.stats.contractsDone)
  const now = useNow(1000)
  const reduced = !useMotionOK()
  const rotateIn = Math.max(0, nextRotateAt - now)
  const claimable = rows.filter((r) => r.done && !r.claimed).length

  return (
    <Panel
      stripe="mask"
      title="Contracts"
      right={
        <>
          <span className="inline-flex items-center gap-1 tabular-nums" title="Contracts delivered">
            <Trophy size={12} aria-hidden="true" />
            {completed} done
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums" title="Unfinished contracts rotate out; done ones wait for you">
            <Clock size={12} aria-hidden="true" />
            {rotateIn > 0 ? `rotates in ${formatDuration(rotateIn / 1000)}` : 'rotating…'}
          </span>
        </>
      }
      className="min-h-0"
      bodyClassName="flex flex-col gap-3 overflow-y-auto"
    >
      {claimable > 0 ? (
        <p className="text-xs font-semibold text-electric-400" role="status">
          {claimable} contract{claimable === 1 ? '' : 's'} ready to claim.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[0.5rem] border-2 border-dashed border-charcoal-400 px-3 py-4 text-xs text-smoke-800">
          <Gift size={16} className="shrink-0" aria-hidden="true" />
          No clients yet. Your cousin is drafting an email.
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Active contracts">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.li
                key={`${row.defId}:${row.acceptedAt}`}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <ContractCard row={row} now={now} reduced={reduced} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <p className="text-[11px] text-smoke-800">
        Rewards are priced at your income when the gig lands. RP and CP feed the global multiplier.
      </p>
    </Panel>
  )
}

const ContractCard = memo(function ContractCard({ row, now, reduced }: { row: ContractRowState; now: number; reduced: boolean }) {
  const store = useGameStore()
  const [error, setError] = useState<string | null>(null)
  const pct = row.target > 0 ? Math.max(0, Math.min(100, (row.progress / row.target) * 100)) : 0
  const expiresIn = Math.max(0, row.acceptedAt + CONTRACT_ROTATE_MS - now)
  const claim = useCallback(() => {
    const result = store.claimContract(row.index)
    setError(result.error ?? null)
  }, [row.index, store])
  const ready = row.done && !row.claimed

  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-[0.75rem] border-2 bg-charcoal-700 p-3',
        ready ? 'border-electric-400/80 shadow-[0_0_0_1px_rgb(240_255_65/0.25)]' : 'border-charcoal-400',
      )}
      aria-label={`${row.title} for ${row.client}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-700">{row.client}</p>
          <h3 className="truncate text-sm font-bold text-smoke-100">{row.title}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="inline-flex items-center gap-1 text-sm font-extrabold tabular-nums text-credits">
            <CreditsIcon size={13} aria-hidden="true" />
            {formatNum(row.rewardCredits)}
          </span>
          {row.rewardRp > 0 || row.rewardCp > 0 ? (
            <span className="flex gap-1">
              {row.rewardRp > 0 ? <Badge tone="sapphire">+{row.rewardRp} RP</Badge> : null}
              {row.rewardCp > 0 ? <Badge tone="latent">+{row.rewardCp} CP</Badge> : null}
            </span>
          ) : null}
        </div>
      </div>
      <p className="text-xs leading-snug text-smoke-600">{row.desc}</p>
      <div className="flex items-center gap-2 text-[11px] tabular-nums text-smoke-700">
        <span className="truncate">{row.goal}</span>
        <span className="ml-auto shrink-0 font-semibold text-smoke-500">
          {formatNum(row.progress)} / {formatNum(row.target)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-charcoal-500"
        role="progressbar"
        aria-label={`${row.title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <motion.div
          className={cn('h-full rounded-full', ready ? 'bg-electric-400' : 'bg-slot-mask')}
          initial={false}
          animate={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%` }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 200, damping: 30 }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {ready ? (
          <motion.button
            type="button"
            onClick={claim}
            aria-label={`Claim ${formatNum(row.rewardCredits)} credits for ${row.title}`}
            whileTap={reduced ? undefined : { scale: 0.96, y: 2 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="inline-flex h-8 items-center gap-1.5 rounded-[0.5rem] border-2 border-electric-400 bg-electric-400 px-3 text-xs font-extrabold text-charcoal-800 shadow-[0_3px_0_#0e0e0f]"
          >
            <Check size={14} aria-hidden="true" />
            Claim
          </motion.button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-smoke-800" title="Unfinished contracts rotate out when the timer ends">
            <Clock size={11} aria-hidden="true" />
            {formatDuration(expiresIn / 1000)} left
          </span>
        )}
        {error ? (
          <span className="text-[11px] font-semibold text-slot-vae" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </article>
  )
})

function Badge({ tone, children }: { tone: 'sapphire' | 'latent'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-[0.3rem] px-1.5 py-px text-[10px] font-bold tabular-nums',
        tone === 'sapphire' ? 'bg-sapphire-700/40 text-smoke-100' : 'bg-slot-latent/20 text-slot-latent',
      )}
    >
      {children}
    </span>
  )
}
