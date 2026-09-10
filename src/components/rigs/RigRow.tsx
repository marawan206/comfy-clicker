'use client'
import { memo } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight, Fan } from 'lucide-react'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { formatCps } from '@/game/format'
import { Art } from '@/components/common/Art'
import { cn } from '@/lib/utils'
import { openStoreTab, useReducedMotionPref, useRigRow } from '@/components/store/storeHooks'

/** Mini tiles shown on the shelf before it collapses into a '+N' count. */
const SHELF_MAX = 5

/** Seconds per fan revolution: one lonely card idles, a rack of fifty screams. */
function fanPeriod(count: number): number {
  return Math.min(3, Math.max(0.35, 3 / Math.log2(count + 1)))
}

function RigRowImpl({ id }: { id: string }) {
  const store = useGameStore()
  const def = buildIndex(store.catalog).hardwareById[id]
  const row = useRigRow(id)
  const reduced = useReducedMotionPref()
  if (!def || row.count <= 0) return null

  const shelf = Math.min(row.count, SHELF_MAX)
  const overflow = row.count - shelf
  const hasFan = !def.cpuOnly && def.family !== 'region'
  const reclaimed = row.rigMult === 0
  const tierMult = row.tier > 0 ? 2 ** row.tier : 1
  const progress = row.nextTierAt ? Math.min(1, row.count / row.nextTierAt) : 1

  return (
    <div
      className={cn('mb-1 flex items-center gap-2.5 rounded-lg border border-charcoal-400/70 bg-charcoal-500/60 px-2 py-1.5', reclaimed && 'opacity-60')}
      title={def.flavor}
    >
      <div className="relative shrink-0">
        <Art id={def.art} size={40} className={cn(reclaimed && 'grayscale')} />
        {hasFan && (
          <span className="absolute -right-1.5 -bottom-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-charcoal-800 bg-charcoal-700 text-smoke-500" aria-hidden="true">
            {reduced || reclaimed ? (
              <Fan size={11} />
            ) : (
              <motion.span className="inline-flex" animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: 'linear', duration: fanPeriod(row.count) }}>
                <Fan size={11} />
              </motion.span>
            )}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-smoke-100">{def.name}</span>
          <span className="shrink-0 text-[12px] font-extrabold tabular-nums text-smoke-100">×{row.count}</span>
          {row.tier > 0 && (
            <span className="shrink-0 rounded-[0.3em] bg-sapphire-700 px-1 text-[9px] font-extrabold text-smoke-100" title={`Tier ${row.tier}: ×${tierMult} per unit`}>
              T{row.tier}
            </span>
          )}
          {reclaimed && <span className="shrink-0 rounded-[0.3em] bg-slot-vae/20 px-1 text-[9px] font-extrabold text-slot-vae uppercase">spot reclaimed</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums text-smoke-600">
          <span>
            +{formatCps(row.cpsEach)} each{row.tier > 0 && <span className="text-electric-400"> · ×{tierMult}</span>}
          </span>
          <span className="text-smoke-800">·</span>
          <span className="text-smoke-100/80">{formatCps(row.cpsEach * row.count)} total</span>
        </div>
        <div className="mt-1 flex items-center gap-1" aria-hidden="true">
          {Array.from({ length: shelf }, (_, i) => (
            <Art
              key={i}
              id={def.art}
              size={20}
              radius="0.3em"
              className={cn('border border-charcoal-400 bg-charcoal-700 opacity-90', reclaimed && 'grayscale')}
              alt=""
            />
          ))}
          {overflow > 0 && <span className="ml-0.5 text-[11px] font-bold tabular-nums text-smoke-600">+{overflow}</span>}
        </div>
      </div>

      <div className="flex w-[104px] shrink-0 flex-col items-end gap-1.5">
        {row.nextTierAt === null ? (
          <span className="text-[10px] font-semibold tracking-[0.08em] text-smoke-700 uppercase">maxed</span>
        ) : row.nextTierReady ? (
          <button
            type="button"
            onClick={() => openStoreTab('upgrades')}
            aria-label={`Tier ${row.tier + 1} for ${def.name} is ready in Upgrades`}
            className="flex items-center gap-0.5 rounded-[0.3em] bg-electric-400 px-1.5 py-0.5 text-[10px] font-extrabold text-charcoal-800 shadow-[0_2px_0_#0e0e0f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400 active:translate-y-0.5 active:shadow-none"
          >
            T{row.tier + 1} ready <ArrowUpRight size={10} aria-hidden="true" />
          </button>
        ) : (
          <span className="text-[11px] tabular-nums text-smoke-600" title={`Tier ${row.tier + 1} unlocks in Upgrades at ${row.nextTierAt} owned`}>
            T{row.tier + 1} · <span className="font-semibold text-smoke-100">{row.count}</span>/{row.nextTierAt}
          </span>
        )}
        {row.nextTierAt !== null && (
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-charcoal-400" aria-hidden="true">
            <motion.div
              className={cn('h-full origin-left rounded-full', row.nextTierReady ? 'bg-electric-400' : 'bg-sapphire-700')}
              style={{ width: '100%' }}
              animate={{ scaleX: progress }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** One owned unit type in the rack. */
export const RigRow = memo(RigRowImpl)
