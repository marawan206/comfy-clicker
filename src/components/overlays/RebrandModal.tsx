'use client'
/**
 * Prestige dialog. Shows the CP the season would bank, what resets versus what survives, and a
 * hold-to-confirm that calls `store.rebrand()`.
 */
import { Check, Lock, RefreshCw, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { fx } from '@/components/fx/fxBus'
import { HoldToConfirm, ModalBase, SectionLabel } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { CP_MULT_PER_POINT } from '@/game/constants'
import { formatNum, formatPct } from '@/game/format'
import { canRebrand, creditsForCp, rebrandCp } from '@/game/prestige'
import { useGameShallow, useGameStore } from '@/state/useGame'

export interface RebrandModalProps {
  open: boolean
  onClose: () => void
}

export function RebrandModal({ open, onClose }: RebrandModalProps) {
  return (
    <ModalBase open={open} onClose={onClose} title="Rebrand" icon={<RefreshCw size={16} />} stripe="electric" size="lg">
      <RebrandBody onClose={onClose} />
    </ModalBase>
  )
}

const RESETS: string[] = [
  'Credits and season credits',
  'Rigs, tier upgrades and credit-bought upgrades',
  'Models (SD 1.5 stays preinstalled)',
  'Queue, feed, contracts and live events',
  'Followers — a new brand, a new audience',
]

const KEEPS: string[] = [
  'Achievements and their income bonus',
  'The Graph — every unlocked node',
  'Research Points and Comfy Points',
  'LoRAs, ComfyHub reputation, daily streak',
  'Lifetime stats, followers and likes',
]

function RebrandBody({ onClose }: { onClose: () => void }) {
  const store = useGameStore()
  const { can, cp, seasonCredits, season, ownedCp, cpMult, followers } = useGameShallow((s, d) => ({
    can: canRebrand(s, store.catalog),
    cp: rebrandCp(s.seasonCredits),
    seasonCredits: Math.floor(s.seasonCredits),
    season: s.meta.season,
    ownedCp: s.cp,
    cpMult: d.cpMult,
    followers: Math.floor(s.followers),
  }))

  const floor = creditsForCp(cp)
  const ceiling = creditsForCp(cp + 1)
  const progress = ceiling > floor ? Math.min(1, Math.max(0, (seasonCredits - floor) / (ceiling - floor))) : 0
  const nextMult = 1 + CP_MULT_PER_POINT * (ownedCp + cp)

  const confirm = () => {
    const r = store.rebrand()
    if (r.error) {
      toast(r.error, { tone: 'danger', title: 'Rebrand' })
      return
    }
    fx.confetti()
    onClose()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
            Season {season} → Season {season + 1}
          </p>
          <p className="mt-1 text-4xl font-extrabold tracking-tight text-electric-400 tabular-nums">
            +{cp} <span className="text-2xl">CP</span>
          </p>
          <p className="text-sm text-smoke-600">
            Every Comfy Point is {formatPct(CP_MULT_PER_POINT)} income, forever. Rebranding now puts you at ×{nextMult.toFixed(2)}
            {ownedCp > 0 ? ` (from ×${cpMult.toFixed(2)})` : ''}.
          </p>
        </div>
        <div className="rounded-xl border border-charcoal-400 bg-charcoal-700/60 px-4 py-3 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">Season credits</p>
          <p className="flex items-center justify-end gap-1 text-lg font-extrabold text-credits tabular-nums">
            <CreditsIcon size={16} />
            {formatNum(seasonCredits)}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-smoke-600 tabular-nums">
          <span>{cp} CP</span>
          <span className="flex items-center gap-1">
            Next CP at <CreditsIcon size={11} className="text-credits" />
            <span className="font-semibold text-credits">{formatNum(ceiling)}</span>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-charcoal-700">
          <div className="h-full w-full origin-left bg-electric-400 transition-transform duration-500" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-slot-vae bg-charcoal-700/40 p-3">
          <SectionLabel className="mb-2 text-slot-vae">Resets</SectionLabel>
          <ul className="space-y-1.5 text-sm text-smoke-100">
            {RESETS.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <RotateCcw size={14} className="mt-0.5 shrink-0 text-slot-vae" />
                <span>
                  {line}
                  {line.startsWith('Followers') && followers > 0 ? (
                    <span className="text-smoke-600"> ({formatNum(followers)} today)</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-sapphire-700 bg-charcoal-700/40 p-3">
          <SectionLabel className="mb-2 text-[#7f8dff]">Keeps</SectionLabel>
          <ul className="space-y-1.5 text-sm text-smoke-100">
            {KEEPS.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-[#7f8dff]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3', can ? 'border-charcoal-400 bg-charcoal-700/60' : 'border-slot-vae/40 bg-slot-vae/5')}>
        <p className="flex items-center gap-2 text-sm text-smoke-600">
          {can ? (
            cp === 0 ? (
              <span>
                You would bank <span className="font-semibold text-smoke-100">0 CP</span>. Reach{' '}
                <span className="font-semibold text-credits">{formatNum(creditsForCp(1))}</span> season credits first — or do it for the story.
              </span>
            ) : (
              <span>Hold to start Season {season + 1}. The rack goes back to one CPU and a lot of optimism.</span>
            )
          ) : (
            <>
              <Lock size={14} className="shrink-0 text-slot-vae" />
              <span>Own a cloud node or a region before rebranding.</span>
            </>
          )}
        </p>
        <HoldToConfirm
          label={`Hold to rebrand · +${cp} CP`}
          holdingLabel="Rebranding…"
          onConfirm={confirm}
          disabled={!can}
          holdMs={1600}
          icon={<RefreshCw size={16} />}
          aria-label={`Hold to rebrand and bank ${cp} Comfy Points`}
        />
      </div>
    </div>
  )
}
