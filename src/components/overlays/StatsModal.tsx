'use client'
/**
 * Level, lifetime numbers, what to chase next, and the achievement grid. The stat selector returns
 * pre-formatted strings so the modal only re-renders when a displayed value actually changes, not
 * on every tick; the grid and the Next up list recompute once a second off a `useNow` clock,
 * because a bar for every locked row is a hundred unlock conditions and that has no business
 * running at 20 Hz.
 *
 * Hidden achievements are the one rule this file must never bend: an unearned hidden row renders
 * the literal `???` and neither its name nor its description reaches the DOM, not in text, not in
 * a `title`, not in an `aria-label`. `__tests__/hiddenAchievements.test.ts` pins it against the
 * real catalog.
 * Once earned it shows the secret badge and the real name, because found means revealed.
 */
import { memo, useMemo, type ReactNode } from 'react'
import { ChartColumn, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Art } from '@/components/common/Art'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { AchievementGlyph, badgeFor } from '@/components/overlays/AchievementToast'
import { ModalBase, SectionLabel } from '@/components/overlays/ModalBase'
import { ACHIEVEMENT_MULT, MAX_LEVEL } from '@/game/constants'
import { formatCps, formatDuration, formatInt, formatNum, formatPct } from '@/game/format'
import { condProgress, nextAchievements, type NextAchievement } from '@/game/goals'
import { levelProgress, levelTitle, modelsUnlockedAt, playerXp, xpBreakdown } from '@/game/level'
import type { AchievementDef, Catalog, Derived, GameState } from '@/game/types'
import { useNow } from '@/hooks/useNow'
import { useGame, useGameShallow, useGameStore } from '@/state/useGame'

export interface StatsModalProps {
  open: boolean
  onClose: () => void
}

/** How many near-miss achievements the Next up list carries. */
const NEXT_UP_COUNT = 6
/** How often the grid and the Next up list recompute their bars. */
const BAR_TICK_MS = 1000

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
    ratioed: formatNum(state.stats.ratioed),
    dislikes: formatNum(state.stats.dislikes),
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
    spins: formatNum(state.stats.spins),
    flips: formatNum(state.stats.flips),
    hubRuns: formatNum(state.stats.hubRuns),
    spinNet: `${state.stats.spinNet >= 0 ? '+' : ''}${formatNum(state.stats.spinNet)}`,
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
        { label: 'Ratioed', value: s.ratioed, accent: 'text-slot-vae' },
        { label: 'Dislikes', value: s.dislikes, accent: 'text-slot-vae' },
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
        { label: 'Workflow runs', value: s.hubRuns },
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
        { label: 'Wheel spins', value: s.spins, accent: 'text-slot-latent' },
        { label: 'Coin flips', value: s.flips, accent: 'text-slot-latent' },
        { label: 'Lounge net', value: s.spinNet },
        { label: 'Season', value: s.season },
        { label: 'Rebrands', value: s.rebrands },
        { label: 'Time played', value: s.playedSec },
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <LevelSection />
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

// ---------------------------------------------------------------------------
// Level
// ---------------------------------------------------------------------------

/** The level, the bar, where the XP came from and what the next level opens. */
function LevelSection() {
  const store = useGameStore()
  const p = useGameShallow((state) => {
    const prog = levelProgress(state)
    return {
      level: prog.level,
      xp: prog.xp,
      ceiling: prog.ceiling,
      pct: Math.floor(prog.fraction * 100),
      xpToGo: prog.xpToGo,
    }
  })
  // The breakdown is eight floors over the whole state; it only moves when the total moves.
  const xp = useGame(playerXp)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `xp` is the change signal for the live store
  const rows = useMemo(() => xpBreakdown(store.state), [store, xp])
  const next = useMemo(
    () => (p.level >= MAX_LEVEL ? [] : modelsUnlockedAt(p.level + 1, store.catalog)),
    [p.level, store],
  )
  const maxed = p.level >= MAX_LEVEL
  const earned = rows.filter((r) => r.xp > 0)

  return (
    <section
      aria-label="Level"
      className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-electric-400 bg-charcoal-700/40 p-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-3xl leading-none font-extrabold tracking-tight text-electric-400 tabular-nums">
          LV {p.level}
        </p>
        <p className="text-sm font-semibold text-smoke-100">{levelTitle(p.level)}</p>
        <p className="ml-auto text-xs text-smoke-600 tabular-nums">
          {maxed ? (
            <span className="font-semibold text-electric-400">{formatInt(p.xp)} XP · maxed</span>
          ) : (
            <>
              <span className="font-extrabold text-smoke-100">{formatInt(p.xp)}</span> / {formatInt(p.ceiling)} XP ·{' '}
              {formatInt(p.xpToGo)} to go
            </>
          )}
        </p>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-charcoal-700">
        <div
          className="h-full w-full origin-left bg-electric-400 transition-transform duration-500"
          style={{ transform: `scaleX(${maxed ? 1 : p.pct / 100})` }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 sm:grid-cols-[1fr_auto_1fr_auto]">
        {earned.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-xs text-smoke-600">{r.label}</dt>
            <dd className="text-right text-xs font-bold text-smoke-100 tabular-nums">{formatInt(r.xp)}</dd>
          </div>
        ))}
      </dl>

      {maxed ? (
        <p className="mt-3 text-xs text-smoke-600">Level {MAX_LEVEL}. There is nothing above this except more compute.</p>
      ) : next.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-smoke-600">Next: level {p.level + 1} unlocks</span>
          {next.map((m) => (
            <span key={m.id} className="flex items-center gap-1.5 rounded-comfy border border-charcoal-400 bg-charcoal-600 py-0.5 pr-2 pl-0.5">
              <Art id={`model-${m.id}`} size={24} alt="" />
              <span className="text-[11px] font-semibold text-smoke-100">{m.name}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-smoke-600">
          Next: level {p.level + 1}. No new model at that one, but the credits land all the same.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

/** Everything a tile needs, computed once a second so 103 unlock conditions stay off the 20 Hz path. */
export interface TileData {
  def: AchievementDef
  owned: boolean
  /** 0 to 100 for a locked, measurable row; `null` when there is no bar to draw. */
  pct: number | null
  /** `9,120 / 10,000 likes`. Empty when the condition has nothing to count. */
  label: string
}

/**
 * Build the grid's rows. Pure, and exported so the hidden-achievement test can render the real
 * catalog without a store. A hidden, unearned row carries no progress and no label: anything the
 * tile does not need is a hint it must not leak.
 */
export function buildTiles(
  owned: ReadonlySet<string>,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): TileData[] {
  return catalog.achievements.map((def) => {
    const has = owned.has(def.id)
    if (has || def.hidden) return { def, owned: has, pct: null, label: '' }
    const p = condProgress(def.cond, state, derived, catalog)
    return { def, owned: false, pct: Math.floor(p.fraction * 100), label: p.label }
  })
}

function AchievementGrid() {
  const store = useGameStore()
  // Achievements are never revoked, so the count is a complete change key for the owned set.
  const count = useGame((s) => s.achievements.length)
  const tick = useNow(BAR_TICK_MS)
  const all = store.catalog.achievements
  const total = all.length
  const bonus = formatPct(ACHIEVEMENT_MULT * count)

  const { tiles, next, hiddenTotal, hiddenFound } = useMemo(() => {
    const owned = new Set(store.state.achievements)
    let hiddenTotal = 0
    let hiddenFound = 0
    for (const def of all) {
      if (!def.hidden) continue
      hiddenTotal += 1
      if (owned.has(def.id)) hiddenFound += 1
    }
    return {
      tiles: buildTiles(owned, store.state, store.derived, store.catalog),
      next: nextAchievements(store.state, store.derived, store.catalog, NEXT_UP_COUNT),
      hiddenTotal,
      hiddenFound,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` and `count` are the change signal for the live store
  }, [store, all, tick, count])

  return (
    <section aria-labelledby="stats-achievements">
      {next.length > 0 ? <NextUp list={next} /> : null}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>
          <span id="stats-achievements">Achievements</span>
        </SectionLabel>
        <p className="text-xs text-smoke-600 tabular-nums">
          <span className="font-extrabold text-smoke-100">{count}</span> / {total} ·{' '}
          <span className="font-semibold text-electric-400">{bonus} cps</span>
          {hiddenTotal > 0 ? (
            <>
              {' · '}
              <span className="font-semibold text-slot-mask">
                {hiddenFound} of {hiddenTotal} hidden found
              </span>
            </>
          ) : null}
        </p>
      </div>
      <AchievementTiles tiles={tiles} label={`${count} of ${total} achievements earned`} />
    </section>
  )
}

/** The tile grid on its own, so the hidden-achievement test can render it without a store. */
export function AchievementTiles({ tiles, label }: { tiles: readonly TileData[]; label?: string }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2" aria-label={label}>
      {tiles.map((t) => (
        <AchievementTile key={t.def.id} data={t} />
      ))}
    </ul>
  )
}

/** The six achievements the player is closest to, with the number that is missing. */
function NextUp({ list }: { list: readonly NextAchievement[] }) {
  return (
    <div className="mb-4">
      <SectionLabel className="mb-2">Next up</SectionLabel>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {list.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 rounded-comfy border border-charcoal-400 bg-charcoal-700/50 px-2 py-1.5"
            title={`${a.name}: ${a.desc}`}
          >
            <AchievementGlyph icon={a.icon} size={16} className="shrink-0 text-smoke-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold leading-snug text-smoke-100">{a.name}</span>
              <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-charcoal-700">
                <span
                  className={cn('block h-full w-full origin-left', a.fraction >= 0.9 ? 'bg-electric-400' : 'bg-slot-mask')}
                  style={{ transform: `scaleX(${a.fraction})` }}
                />
              </span>
            </span>
            <span className="shrink-0 text-[10px] text-smoke-600 tabular-nums">{a.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const AchievementTile = memo(function AchievementTile({ data }: { data: TileData }) {
  const { def, owned, pct, label } = data
  const secret = def.hidden && !owned

  // Nothing about a hidden, unearned row may reach the DOM: no name, no description, no icon, no
  // lock glyph, and a title that is itself the placeholder.
  if (secret) {
    return (
      <li
        title="???"
        aria-label="Hidden achievement"
        className="relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-comfy border-2 border-charcoal-400 bg-charcoal-700/50"
      >
        <span className="text-sm font-extrabold tracking-[0.12em] text-smoke-800">???</span>
      </li>
    )
  }

  const title = `${def.name}: ${def.desc}${owned ? '' : ` (locked)${label ? ` · ${label}` : ''}`}`
  const inner: ReactNode = owned ? (
    <Art id={badgeFor(def)} size={40} radius="0" alt="" />
  ) : (
    <AchievementGlyph icon={def.icon} size={20} className="text-smoke-800" />
  )

  return (
    <li
      title={title}
      aria-label={`${def.name}${owned ? ', earned' : ', locked'}`}
      className={cn(
        'relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-comfy border-2',
        owned ? 'border-slot-mask/70 bg-slot-mask/10 shadow-[0_3px_0_#0e0e0f]' : 'border-charcoal-400 bg-charcoal-700/50',
      )}
    >
      <span className={cn('grid size-10 place-items-center overflow-hidden rounded-comfy', owned ? '' : 'opacity-70')}>{inner}</span>
      {owned ? null : <Lock size={10} className="absolute top-1 right-1 text-smoke-800" aria-hidden="true" />}
      {/* The 2 px bar is the only hint a locked row gives, and it gives it honestly. */}
      {!owned && pct !== null ? (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-charcoal-700">
          <span
            className={cn('block h-full w-full origin-left', pct >= 90 ? 'bg-electric-400' : 'bg-slot-mask')}
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </span>
      ) : null}
    </li>
  )
})
