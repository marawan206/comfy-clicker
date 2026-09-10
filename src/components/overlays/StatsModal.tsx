'use client'
/**
 * Lifetime numbers and the achievement grid. The selector returns pre-formatted strings so the
 * modal only re-renders when a displayed value actually changes, not on every tick.
 */
import { memo, type ReactNode } from 'react'
import { ChartColumn, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { AchievementGlyph, badgeFor } from '@/components/overlays/AchievementToast'
import { ModalBase, SectionLabel } from '@/components/overlays/ModalBase'
import { ACHIEVEMENT_MULT } from '@/game/constants'
import { formatCps, formatDuration, formatNum, formatPct } from '@/game/format'
import type { AchievementDef } from '@/game/types'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'

export interface StatsModalProps {
  open: boolean
  onClose: () => void
}

export function StatsModal({ open, onClose }: StatsModalProps) {
  return (
    <ModalBase open={open} onClose={onClose} title="Stats" icon={<ChartColumn size={16} />} stripe="mask" size="lg">
      <StatsBody />
    </ModalBase>
  )
}

interface Stat {
  label: string
  value: string
  credits?: boolean
  accent?: string
}

function StatsBody() {
  const s = useGameShallow((state, d) => ({
    lifetimeCredits: formatNum(state.lifetimeCredits),
    seasonCredits: formatNum(state.seasonCredits),
    clicks: formatNum(state.totalClicks),
    posts: formatNum(state.stats.posts),
    videos: formatNum(state.stats.videos),
    virals: formatNum(state.stats.virals),
    flops: formatNum(state.stats.flops),
    bestPostLikes: formatNum(state.stats.bestPostLikes),
    followers: formatNum(state.followers),
    lifetimeFollowers: formatNum(state.lifetimeFollowers),
    lifetimeLikes: formatNum(state.lifetimeLikes),
    signups: formatNum(state.signups),
    rp: formatNum(state.rp),
    cp: formatNum(state.cp),
    cpMult: `×${d.cpMult.toFixed(2)}`,
    season: String(state.meta.season),
    rebrands: String(state.stats.rebrands),
    playedSec: formatDuration(Math.floor(state.meta.playedSec)),
    bestCps: formatCps(state.stats.bestCps),
    cps: formatCps(d.cps),
    contractsDone: String(state.stats.contractsDone),
    quantizations: String(state.stats.quantizations),
    loras: String(state.stats.lorasTrained),
    mapNodes: String(state.mapNodes.length),
    hubPublished: String(state.stats.hubPublished),
  }))

  const groups: Array<{ title: string; stats: Stat[] }> = [
    {
      title: 'Credits',
      stats: [
        { label: 'Lifetime credits', value: s.lifetimeCredits, credits: true },
        { label: 'This season', value: s.seasonCredits, credits: true },
        { label: 'Income now', value: s.cps },
        { label: 'Best income', value: s.bestCps },
        { label: 'Generate clicks', value: s.clicks },
      ],
    },
    {
      title: 'Studio',
      stats: [
        { label: 'Posts', value: s.posts },
        { label: 'Videos', value: s.videos },
        { label: 'Went viral', value: s.virals, accent: 'text-electric-400' },
        { label: 'Flopped', value: s.flops, accent: 'text-slot-vae' },
        { label: 'Best post', value: `${s.bestPostLikes} likes` },
        { label: 'Quantizations', value: s.quantizations },
        { label: 'LoRAs trained', value: s.loras },
      ],
    },
    {
      title: 'Audience',
      stats: [
        { label: 'Followers', value: s.followers },
        { label: 'Lifetime followers', value: s.lifetimeFollowers },
        { label: 'Lifetime likes', value: s.lifetimeLikes },
        { label: 'ComfyHub signups', value: s.signups, accent: 'text-[#7f8dff]' },
        { label: 'Workflows published', value: s.hubPublished },
        { label: 'Contracts done', value: s.contractsDone },
      ],
    },
    {
      title: 'Meta',
      stats: [
        { label: 'Research Points', value: s.rp, accent: 'text-slot-mask' },
        { label: 'Comfy Points', value: s.cp, accent: 'text-electric-400' },
        { label: 'CP multiplier', value: s.cpMult },
        { label: 'Graph nodes', value: s.mapNodes },
        { label: 'Season', value: s.season },
        { label: 'Rebrands', value: s.rebrands },
        { label: 'Time played', value: s.playedSec },
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title} className="rounded-xl border border-charcoal-400 bg-charcoal-700/40 p-3">
            <SectionLabel className="mb-2">{g.title}</SectionLabel>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              {g.stats.map((st) => (
                <StatRow key={st.label} stat={st} />
              ))}
            </dl>
          </section>
        ))}
      </div>
      <AchievementGrid />
    </div>
  )
}

function StatRow({ stat }: { stat: Stat }) {
  return (
    <>
      <dt className="text-xs text-smoke-600">{stat.label}</dt>
      <dd className={cn('flex items-center justify-end gap-1 text-sm font-extrabold tracking-tight text-smoke-100 tabular-nums', stat.credits && 'text-credits', stat.accent)}>
        {stat.credits ? <CreditsIcon size={12} /> : null}
        {stat.value}
      </dd>
    </>
  )
}

function AchievementGrid() {
  const store = useGameStore()
  // Achievements are never revoked, so the count is a complete change key for the owned set.
  const count = useGame((s) => s.achievements.length)
  const owned = new Set(store.state.achievements)
  const all = store.catalog.achievements
  const total = all.length
  const bonus = formatPct(ACHIEVEMENT_MULT * count)

  return (
    <section aria-labelledby="stats-achievements">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>
          <span id="stats-achievements">Achievements</span>
        </SectionLabel>
        <p className="text-xs text-smoke-600 tabular-nums">
          <span className="font-extrabold text-smoke-100">{count}</span> / {total} · <span className="font-semibold text-electric-400">{bonus} cps</span>
        </p>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2" aria-label={`${count} of ${total} achievements earned`}>
        {all.map((def) => (
          <AchievementTile key={def.id} def={def} owned={owned.has(def.id)} />
        ))}
      </ul>
    </section>
  )
}

const AchievementTile = memo(function AchievementTile({ def, owned }: { def: AchievementDef; owned: boolean }) {
  const secret = def.hidden && !owned
  const title = secret ? 'Hidden achievement — find it.' : `${def.name} — ${def.desc}${owned ? '' : ' (locked)'}`
  let inner: ReactNode
  if (owned) inner = <Art id={badgeFor(def)} size={40} radius="0" alt="" />
  else if (secret) inner = <span className="text-xl font-extrabold text-smoke-800">?</span>
  else inner = <AchievementGlyph icon={def.icon} size={20} className="text-smoke-800" />
  return (
    <li
      title={title}
      aria-label={secret ? 'Hidden achievement' : `${def.name}${owned ? ', earned' : ', locked'}`}
      className={cn(
        'relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-comfy border-2',
        owned ? 'border-slot-mask/70 bg-slot-mask/10 shadow-[0_3px_0_#0e0e0f]' : 'border-charcoal-400 bg-charcoal-700/50',
      )}
    >
      <span className={cn('grid size-10 place-items-center overflow-hidden rounded-comfy', owned ? '' : 'opacity-70')}>{inner}</span>
      {!owned && !secret ? <Lock size={10} className="absolute top-1 right-1 text-smoke-800" aria-hidden="true" /> : null}
    </li>
  )
})
