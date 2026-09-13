'use client'
/**
 * Headless bridge from engine events to toasts: achievements (with a badge tile), level-ups,
 * income milestones, week rollovers, ratioed posts, ComfyHub signups, finished contracts, the
 * daily claim, rebrands, welcome gifts, the x42 seed and easter eggs. Renders nothing.
 * Also exports the badge heuristics the Stats grid uses so both surfaces agree.
 *
 * **Every toast in this file passes `sound: false`.** The event that raised it has already sounded
 * through `useSfx`, and a cue playing twice for one thing is the whole difference between juice and
 * noise. If you add a case here, add the `sound: false` with it.
 */
import { useMemo, type ReactNode } from 'react'
import { DynamicIcon, dynamicIconImports, type IconName } from 'lucide-react/dynamic'
import {
  CalendarCheck,
  ChevronsUp,
  Dices,
  Egg,
  FileCheck2,
  Gift,
  RefreshCw,
  ThumbsDown,
  TrendingUp,
  Trophy,
  UserPlus,
} from 'lucide-react'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { runGuideAction } from '@/components/guidance/navigate'
import { pickHashtag } from '@/components/feed/feedHooks'
import { toast } from '@/components/overlays/useToasts'
import { buildIndex } from '@/game/catalog'
import { ACHIEVEMENT_MULT, TRENDING_WEIGHTS, WEEK_MS } from '@/game/constants'
import { formatCps, formatNum, formatPct } from '@/game/format'
import { MILESTONE_LINES } from '@/data/flavor'
import { levelTitle } from '@/game/level'
import type { AchievementDef, GameEvent } from '@/game/types'
import { useGameEvents, useGameStore } from '@/state/useGame'
import { fx } from '@/components/fx/fxBus'

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

/** Dry one-liners for easter-egg flags (UI flags from setFlag plus the engine's prompt flags). */
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
  'title-25': 'Twenty-five clicks on the wordmark. It paid out of pity.',
  'grand-tour': 'Every panel in the header, opened. Nobody does this.',
  'night-shift': 'Three in the morning, local time. The queue does not care. We noticed.',
  'bad-hands': 'Bad hands, requested. The model obliged.',
  'ctrl-enter': 'Ctrl+Enter queued it. Old habits queue hard.',
  'sd15-forever': 'A region of compute, running SD 1.5. It is 2022 in here forever.',
  masterpiece: 'masterpiece, best quality. The model remains unimpressed.',
}

/** Highest trend multiplier a post can reach from this week's tags. */
const MAX_TREND = 1 + TRENDING_WEIGHTS.reduce((sum, w) => sum + w, 0)
const WEEK_MINUTES = Math.round(WEEK_MS / 60_000)
/** Income milestone that earns confetti rather than only a flash. */
const MILESTONE_CONFETTI = 1e6
/** The jackpot segment: the one spin result loud enough to leave the modal. */
const JACKPOT_MULT = 42

const credits = (n: number): ReactNode => (
  <span className="inline-flex items-center gap-0.5 font-bold text-credits tabular-nums">
    <CreditsIcon size={12} />
    {formatNum(n)}
  </span>
)

export function AchievementToast() {
  const store = useGameStore()
  const { achievementById, contractById, modelById, hashtagById } = useMemo(() => {
    const index = buildIndex(store.catalog)
    const achievementById: Record<string, AchievementDef> = {}
    for (const a of store.catalog.achievements) achievementById[a.id] = a
    return {
      achievementById,
      contractById: index.contractById,
      modelById: index.modelById,
      hashtagById: index.hashtagById,
    }
  }, [store])

  useGameEvents((e: GameEvent) => {
    switch (e.type) {
      case 'achievement': {
        const def = achievementById[e.id]
        if (!def) return
        // A hidden achievement is announced with its real name: found means revealed. Only the
        // unearned ones stay `???`, and only in the grid.
        toast(def.name, {
          title: def.hidden ? 'Hidden achievement' : 'Achievement unlocked',
          description: (
            <>
              <span>{def.desc}</span>
              <span className="font-semibold text-electric-400">{formatPct(ACHIEVEMENT_MULT)} cps</span>
              {e.reward > 0 ? <span className="font-semibold text-credits">+{formatNum(e.reward)}</span> : null}
            </>
          ),
          icon: <Art id={badgeFor(def)} size={40} radius="0" alt={`${def.name} badge`} />,
          tone: 'electric',
          durationMs: 6000,
          sound: false,
        })
        return
      }
      case 'levelUp': {
        // The banner says the same thing in the middle of the screen, but the banner is one card and
        // level-ups can land while the player is elsewhere; the toast is the copy that persists.
        const unlocked = e.unlocked.map((id) => modelById[id]?.name ?? id)
        toast(`Level ${e.level} · ${levelTitle(e.level)}`, {
          title: 'Level up',
          description: (
            <>
              {credits(e.credits)}
              {unlocked.length > 0 ? <span>· unlocks {unlocked.join(', ')}</span> : null}
            </>
          ),
          icon: <ChevronsUp className="text-electric-400" />,
          tone: 'electric',
          key: 'level-up',
          durationMs: 6000,
          sound: false,
        })
        return
      }
      case 'milestone': {
        const decade = Math.round(Math.log10(Math.max(1, e.cps)))
        toast(`${formatCps(e.cps)} income`, {
          title: 'Milestone',
          description: MILESTONE_LINES[decade] ?? 'The number went up. It keeps doing that.',
          icon: <CreditsIcon size={20} className="text-credits" />,
          tone: 'credits',
          key: 'milestone',
          sound: false,
        })
        if (e.cps >= MILESTONE_CONFETTI) fx.confetti()
        return
      }
      case 'weekRollover': {
        const tags = e.tags.map((id) => `#${hashtagById[id]?.tag ?? id}`)
        const hottest = e.tags[0]
        toast(`New week: ${tags.join(' ')}`, {
          title: 'Trending',
          description: `Tagged posts get up to ×${MAX_TREND} likes for ${WEEK_MINUTES} minutes`,
          icon: <TrendingUp className="text-electric-400" />,
          tone: 'electric',
          key: 'week-rollover',
          durationMs: 8000,
          sound: false,
          ...(hottest
            ? {
                action: {
                  label: 'Post now',
                  onClick: () => {
                    runGuideAction({ type: 'center', tab: 'studio' })
                    pickHashtag(hottest)
                  },
                },
              }
            : {}),
        })
        return
      }
      case 'postResolved': {
        if (!e.ratioed) return
        const post = store.state.posts.find((p) => p.id === e.postId)
        if (!post) return
        const model = modelById[post.modelId]?.name ?? post.modelId
        const tag = post.mismatchedTags?.[0]
        const lostFollowers = Math.max(0, -Math.round(post.followersGained))
        toast(tag ? `#${hashtagById[tag]?.tag ?? tag} on ${model}` : `Wrong tag on ${model}`, {
          title: 'Ratioed',
          description: (
            <>
              <span className="font-semibold text-slot-vae">-{formatNum(Math.round(post.creditsPaid))} credits</span>
              {lostFollowers > 0 ? <span>· -{formatNum(lostFollowers)} followers</span> : null}
              <span>· tag the kind you actually posted</span>
            </>
          ),
          icon: <ThumbsDown className="text-slot-vae" />,
          tone: 'danger',
          key: 'ratioed',
          durationMs: 7000,
          sound: false,
        })
        return
      }
      case 'reward': {
        // Welcome gifts. `FounderGiftModal` raises its own richer card under the same dedupe key, so
        // an accept shows one toast either way: this one is what is left when the modal is not there.
        toast(e.credits > 0 ? `+${formatNum(e.credits)} credits` : 'Delivered', {
          title: 'Reward',
          description: 'Somebody left it in the rack. Spend it like it is real.',
          icon: <Gift className="text-electric-400" />,
          tone: 'electric',
          key: 'gift',
          sound: false,
        })
        return
      }
      case 'spin': {
        // Only the x42 leaves the modal: everything else is already on the reel in front of you.
        if (e.mult < JACKPOT_MULT) return
        toast('Seed 42. It was always 42.', {
          title: 'Jackpot',
          description: <>{credits(e.payout)}<span>· write the seed down</span></>,
          icon: <Dices className="text-electric-400" />,
          tone: 'electric',
          key: 'jackpot',
          durationMs: 8000,
          sound: false,
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
          sound: false,
        })
        return
      case 'contractDone': {
        const def = contractById[e.defId]
        toast(def?.title ?? 'Contract complete', {
          title: 'Contract complete',
          description: def ? `${def.client} is happy · reward waiting in Contracts` : 'Reward waiting in Contracts',
          icon: <FileCheck2 className="text-slot-mask" />,
          tone: 'mask',
          sound: false,
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
          sound: false,
        })
        return
      case 'rebrand':
        toast(`Season ${store.state.meta.season} begins`, {
          title: 'Rebranded',
          description: `+${e.cp} CP banked · every CP is permanent income`,
          icon: <RefreshCw className="text-electric-400" />,
          tone: 'electric',
          durationMs: 7000,
          sound: false,
        })
        return
      case 'easterEgg':
        toast(EGG_LINES[e.id] ?? 'Something hidden was found. The console would have told you.', {
          title: 'Easter egg',
          icon: <Egg className="text-electric-400" />,
          tone: 'electric',
          durationMs: 6500,
          sound: false,
        })
        return
      default:
        return
    }
  })

  return null
}
