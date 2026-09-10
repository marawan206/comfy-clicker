'use client'
/**
 * Headless bridge from engine events to toasts: achievements (with a badge tile), ComfyHub
 * signups, finished contracts, the daily claim, rebrands and easter eggs. Renders nothing.
 * Also exports the badge heuristics the Stats grid uses so both surfaces agree.
 */
import { useMemo, type ReactNode } from 'react'
import { DynamicIcon, dynamicIconImports, type IconName } from 'lucide-react/dynamic'
import { CalendarCheck, Egg, FileCheck2, RefreshCw, Trophy, UserPlus } from 'lucide-react'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { toast } from '@/components/overlays/useToasts'
import { buildIndex } from '@/game/catalog'
import { ACHIEVEMENT_MULT } from '@/game/constants'
import { formatNum, formatPct } from '@/game/format'
import type { AchievementDef, GameEvent } from '@/game/types'
import { useGameEvents, useGameStore } from '@/state/useGame'

/** Badge asset id for an achievement, from its id family (hidden ones are always the secret badge). */
export function badgeFor(def: Pick<AchievementDef, 'id' | 'hidden'>): string {
  if (def.hidden) return 'badge-secret'
  const id = def.id
  if (id === 'first-click' || id.startsWith('clicks-')) return 'badge-click'
  if (id.startsWith('credits-') || id.startsWith('cps-')) return 'badge-money'
  if (id === 'own-cloud-node' || id === 'own-region' || id === 'own-orbital-dc' || id === 'own-dyson-swarm') return 'badge-cloud'
  if (id.startsWith('own-') || id.startsWith('hardware-') || id.startsWith('amd-') || id.startsWith('apple-') || id === 'rocm-installed') {
    return 'badge-hardware'
  }
  if (id.startsWith('power-')) return 'badge-power'
  if (id.startsWith('first-video') || id.startsWith('videos-') || id === 'q4-video') return 'badge-video'
  if (id.startsWith('flops-') || id === 'first-viral' || id.startsWith('virals-')) return 'badge-viral'
  if (id === 'first-post' || id.startsWith('posts-') || id.startsWith('likes-')) return 'badge-post'
  if (id.startsWith('quantize-') || id.startsWith('model-') || id.startsWith('lora')) return 'badge-quant'
  if (id.startsWith('followers-') || id.startsWith('signups-') || id.startsWith('hub-')) return 'badge-social'
  return 'badge-season'
}

const isLucideName = (name: string): name is IconName => name in dynamicIconImports

/** The achievement's own lucide glyph when the name resolves; a trophy for node-stem icons. */
export function AchievementGlyph({ icon, size = 18, className }: { icon: string; size?: number; className?: string }) {
  if (isLucideName(icon)) return <DynamicIcon name={icon} size={size} className={className} fallback={() => <Trophy size={size} className={className} />} />
  return <Trophy size={size} className={className} />
}

/** Dry one-liners for easter-egg flags (UI flags from setFlag plus the spaghetti prompt). */
const EGG_LINES: Record<string, string> = {
  konami: 'Legacy frontend detected. Nothing changed, but it felt right.',
  'comfy-wave': 'You typed comfy. The nodes waved back.',
  speedrun: 'Cloud node in under 25 minutes. The balance team has questions.',
  'click-frenzy': 'A hundred clicks in ten seconds. The mouse has filed a complaint.',
  spaghetti: 'Spaghetti Mode. Every workflow was already this.',
  'ticker-seven': 'Seven clicks on the ticker. The ticker noticed.',
  seed42: 'Seed 42. Reproducible, allegedly.',
  rickroll: 'Never gonna give you up. The queue, that is.',
  founderMention: 'A founder noticed. They did not comment. They liked it.',
  sparkCaught: 'Spark caught. Your next post rides the wave.',
  fixedNode: 'Fixed by clicking on it. Like a professional.',
  brokeAtZero: 'Exactly zero credits. Out of credits, not ideas.',
}

const credits = (n: number): ReactNode => (
  <span className="inline-flex items-center gap-0.5 font-bold text-credits tabular-nums">
    <CreditsIcon size={12} />
    {formatNum(n)}
  </span>
)

export function AchievementToast() {
  const store = useGameStore()
  const { achievementById, contractById } = useMemo(() => {
    const index = buildIndex(store.catalog)
    const achievementById: Record<string, AchievementDef> = {}
    for (const a of store.catalog.achievements) achievementById[a.id] = a
    return { achievementById, contractById: index.contractById }
  }, [store])

  useGameEvents((e: GameEvent) => {
    switch (e.type) {
      case 'achievement': {
        const def = achievementById[e.id]
        if (!def) return
        toast(def.name, {
          title: def.hidden ? 'Hidden achievement' : 'Achievement unlocked',
          description: (
            <>
              <span>{def.desc}</span>
              <span className="font-semibold text-electric-400">{formatPct(ACHIEVEMENT_MULT)} cps</span>
            </>
          ),
          icon: <Art id={badgeFor(def)} size={40} radius="0" alt={`${def.name} badge`} />,
          tone: 'electric',
          durationMs: 6000,
        })
        return
      }
      case 'signup':
        toast('Someone signed up to ComfyHub via your post', {
          title: 'New signup',
          description: `${formatNum(e.total)} ${e.total === 1 ? 'signup' : 'signups'} total · +1 RP`,
          icon: <UserPlus className="text-[#7f8dff]" />,
          tone: 'sapphire',
          key: 'signup',
        })
        return
      case 'contractDone': {
        const def = contractById[e.defId]
        toast(def?.title ?? 'Contract complete', {
          title: 'Contract complete',
          description: def ? `${def.client} is happy · reward waiting in Contracts` : 'Reward waiting in Contracts',
          icon: <FileCheck2 className="text-slot-mask" />,
          tone: 'mask',
        })
        return
      }
      case 'daily':
        toast(`Day ${e.day} reward claimed`, {
          title: 'Daily login',
          description: (
            <>
              {credits(e.credits)}
              {e.day === 3 ? <span>· +1 RP</span> : null}
              {e.day === 7 ? <span>· +1 CP</span> : null}
            </>
          ),
          icon: <CalendarCheck className="text-credits" />,
          tone: 'credits',
        })
        return
      case 'rebrand':
        toast(`Season ${store.state.meta.season} begins`, {
          title: 'Rebranded',
          description: `+${e.cp} CP banked · every CP is permanent income`,
          icon: <RefreshCw className="text-electric-400" />,
          tone: 'electric',
          durationMs: 7000,
        })
        return
      case 'easterEgg':
        toast(EGG_LINES[e.id] ?? 'Something hidden was found. The console would have told you.', {
          title: 'Easter egg',
          icon: <Egg className="text-electric-400" />,
          tone: 'electric',
          durationMs: 6500,
        })
        return
      default:
        return
    }
  })

  return null
}
