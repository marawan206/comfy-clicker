'use client'
/**
 * Next up: the two answers to "what do I do now", stacked.
 *
 * Row one is the current goal from `nextGoal` (claim a contract, set up a model, save for a card,
 * take a Graph node, push the level bar) with a bar, an ETA and a route to the thing itself.
 * Row two is the achievement the player is closest to, with its real numbers.
 *
 * Both selectors return strings (`goalKey` plus the whole-number percent, `id:pct`), so the 20 Hz
 * loop only re-renders this panel when a percent actually moves. The views themselves are derived
 * with `useMemo` keyed on those strings, the same pattern `QueueMini` and `FlagshipRig` use.
 *
 * Finishing a row is the point of the panel: when the goal is met or the achievement lands, the
 * row flips to a done state for 900 ms with a check, an electric border and a burst of credits at
 * its centre, and only then does the next candidate slide in.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ChevronRight, ClipboardCheck, Sparkles, TrendingUp, Trophy, Workflow } from 'lucide-react'
import { useGame, useGameStore } from '@/state/useGame'
import { hasAchievement } from '@/game/achievements'
import { formatDuration, formatInt, formatNum } from '@/game/format'
import { goalKey, isGoalDone, nextAchievements, nextGoal, type Goal, type NextAchievement } from '@/game/goals'
import type { Derived, GameState, HardwareFamily } from '@/game/types'
import type { Catalog } from '@/data'
import { Art } from '@/components/common/Art'
import { Panel } from '@/components/common/Panel'
import { Tooltip } from '@/components/common/Tooltip'
import { AchievementGlyph } from '@/components/overlays/AchievementToast'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import { CENTER_TAB_EVENT } from '@/components/layout/CenterTabs'
import { STORE_TAB_EVENT, type StoreTab } from '@/components/store/storeHooks'
import { fx } from '@/components/fx/fxBus'
import { playCue } from '@/audio/sfxEngine'
import { cn } from '@/lib/utils'

/** How long a finished row holds its done state before the next candidate slides in. */
const DONE_MS = 900
/** `mode="wait"` holds the next row until this one is gone, so the way out is quick on purpose. */
const EXIT = { duration: 0.15, ease: 'easeOut' } as const
/** At or above this percent the achievement bar goes electric and the kicker appears. */
const ALMOST_PCT = 90
/** Where the map focus is parked for `/map` to pick up (same key the lock guidance uses). */
const GOTO_KEY = 'comfy-clicker:goto'

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** `comfy:store-tab` payload, with the row to focus. Extra fields are ignored by older listeners. */
interface StoreTabDetail {
  tab: StoreTab
  family?: HardwareFamily
  focusId?: string
}

function openStore(detail: StoreTabDetail): void {
  window.dispatchEvent(new CustomEvent<StoreTabDetail>(STORE_TAB_EVENT, { detail }))
}

function openCenter(tab: 'studio' | 'feed' | 'contracts'): void {
  window.dispatchEvent(new CustomEvent<string>(CENTER_TAB_EVENT, { detail: tab }))
}

function openStats(): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_MODAL_EVENT, { detail: 'stats' }))
}

/** Park the node the map should open on, then let the caller push the route. */
function parkMapFocus(nodeId: string): void {
  try {
    window.sessionStorage.setItem(GOTO_KEY, JSON.stringify({ kind: 'map', nodeId }))
  } catch {
    /* private mode: the map still opens, just not scrolled to the node */
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

interface GoalView {
  /** Identity of the goal itself (no percent), so a moving bar is not a new row. */
  key: string
  icon: ReactNode
  label: string
  /** The model a purchase would unlock, or null. */
  sub: string | null
  /** Credits attached to the goal (a contract reward), rendered in amber. */
  reward: number | null
  pct: number
  /** Right-hand text when there is nothing to press yet; null means the row shows `Go`. */
  eta: string | null
  /** Where `Go` takes the player, for the tooltip. */
  where: string
  aria: string
}

function goalIcon(goal: Goal): ReactNode {
  switch (goal.kind) {
    case 'claim':
      return <Tile tint="text-slot-model"><ClipboardCheck size={16} aria-hidden="true" /></Tile>
    case 'setup':
      return <Art id={`model-${goal.modelId}`} size={28} alt="" />
    case 'buy':
      return <Art id={`hw-${goal.hardwareId}`} size={28} alt="" />
    case 'node':
      return <Tile tint="text-slot-latent"><Workflow size={16} aria-hidden="true" /></Tile>
    case 'level':
      return <Tile tint="text-electric-400"><TrendingUp size={16} aria-hidden="true" /></Tile>
  }
}

function Tile({ tint, children }: { tint: string; children: ReactNode }) {
  return (
    <span className={cn('grid size-7 shrink-0 place-items-center rounded-[0.354em] border border-white/5 bg-charcoal-700', tint)}>
      {children}
    </span>
  )
}

/** `500` for credits, `3 RP` for the other two: the Graph prints its currencies that way. */
function nodePrice(goal: Extract<Goal, { kind: 'node' }>): string {
  if (goal.cost <= 0) return 'free'
  if (goal.currency === 'credits') return formatNum(goal.cost)
  return `${formatInt(goal.cost)} ${goal.currency.toUpperCase()}`
}

function buildGoalView(goal: Goal): GoalView {
  const key = goalKey(goal)
  const icon = goalIcon(goal)
  switch (goal.kind) {
    case 'claim':
      return {
        key,
        icon,
        label: `Claim: ${goal.title}`,
        sub: null,
        reward: goal.reward,
        pct: 100,
        eta: null,
        where: 'Opens Contracts',
        aria: `Claim the contract ${goal.title} for ${formatNum(goal.reward)} credits`,
      }
    case 'setup':
      return {
        key,
        icon,
        label: `Set up ${goal.name} · ${goal.fee > 0 ? formatNum(goal.fee) : 'free'}`,
        sub: null,
        reward: null,
        pct: 100,
        eta: null,
        where: 'Opens the Models tab',
        aria: `Set up ${goal.name}${goal.fee > 0 ? ` for ${formatNum(goal.fee)} credits` : ', free'}`,
      }
    case 'buy': {
      const ready = goal.pct >= 100
      return {
        key,
        icon,
        label: ready ? `Buy ${goal.name}` : `Save for ${goal.name}`,
        sub: goal.unlocksModel ? `unlocks ${goal.unlocksModel} native` : null,
        reward: null,
        pct: goal.pct,
        eta: ready ? null : Number.isFinite(goal.etaSec) ? `in ${formatDuration(goal.etaSec)}` : 'click Generate',
        where: 'Opens Hardware',
        aria: ready
          ? `Buy the ${goal.name} for ${formatNum(goal.cost)} credits`
          : `Save for the ${goal.name}, ${goal.pct} percent of ${formatNum(goal.cost)} credits`,
      }
    }
    case 'node':
      return {
        key,
        icon,
        label: `Graph: ${goal.title} · ${nodePrice(goal)}`,
        sub: null,
        reward: null,
        pct: 100,
        eta: null,
        where: 'Opens the Graph',
        aria: `Unlock ${goal.title} on the Graph for ${nodePrice(goal)}`,
      }
    case 'level':
      return {
        key,
        icon,
        label: `Level ${goal.level} · ${formatInt(goal.xpToGo)} XP to go`,
        sub: null,
        reward: null,
        pct: goal.pct,
        eta: null,
        where: 'Opens Stats',
        aria: `Level ${goal.level} is ${goal.pct} percent done, ${formatInt(goal.xpToGo)} XP to go`,
      }
  }
}

// ---------------------------------------------------------------------------
// Selectors (strings only: the loop runs at 20 Hz)
// ---------------------------------------------------------------------------

function pctOf(fraction: number): number {
  if (!(fraction > 0)) return 0
  return Math.min(100, Math.floor(fraction * 100))
}

function useNextGoal(): Goal | null {
  const store = useGameStore()
  const key = useGame((s, d, st) => {
    const goal = nextGoal(s, d, st.catalog)
    if (!goal) return ''
    if (goal.kind === 'buy') return `${goalKey(goal)}|${goal.pct}|${goal.etaSec}`
    if (goal.kind === 'level') return `${goalKey(goal)}|${goal.pct}`
    return goalKey(goal)
  })
  // `key` encodes everything the view reads; the goal is rebuilt only when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => nextGoal(store.state, store.derived, store.catalog), [key, store])
}

/** The single nearest achievement, or null when every visible one is earned. */
function nearest(state: GameState, derived: Derived, catalog: Catalog): NextAchievement | null {
  const list = nextAchievements(state, derived, catalog, 1)
  return list.length > 0 ? list[0] : null
}

function useNextAchievement(): NextAchievement | null {
  const store = useGameStore()
  const key = useGame((s, d, st) => {
    const top = nearest(s, d, st.catalog)
    return top ? `${top.id}:${pctOf(top.fraction)}` : ''
  })
  // `key` is the id and the whole-number percent: everything the row draws.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => nearest(store.state, store.derived, store.catalog), [key, store])
}

// ---------------------------------------------------------------------------
// The done beat
// ---------------------------------------------------------------------------

/**
 * Holds the row that just finished for `DONE_MS` so the player sees it land before the next one
 * arrives. A row that changed for any other reason (a cheaper target appeared, a contract jumped
 * the queue) swaps straight away: only an actual completion earns the beat.
 */
function useDoneFlash<T>(
  current: T | null,
  keyOf: (value: T) => string,
  finished: (value: T) => boolean,
  celebrate: () => void,
): T | null {
  const [done, setDone] = useState<T | null>(null)
  const shown = useRef<T | null>(null)
  const timer = useRef(0)

  useEffect(() => {
    const before = shown.current
    shown.current = current
    if (!before) return
    if (current && keyOf(current) === keyOf(before)) return
    if (!finished(before)) return
    setDone(before)
    celebrate()
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDone(null), DONE_MS)
  }, [current, keyOf, finished, celebrate])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  return done
}

/** A burst of credits at the middle of the row that just finished, plus the two-tick stinger. */
function useRowBurst(ref: RefObject<HTMLDivElement | null>, reduced: boolean): () => void {
  return useCallback(() => {
    playCue({ name: 'tick', gain: 0.6, then: { name: 'tick', gain: 0.6, rate: 1.1, delayMs: 110 } })
    if (reduced) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    fx.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 7)
  }, [ref, reduced])
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function Bar({ pct, tone, reduced }: { pct: number; tone: 'electric' | 'mask'; reduced: boolean }) {
  return (
    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-charcoal-800" aria-hidden="true">
      <motion.span
        className={cn('block h-full rounded-full', tone === 'electric' ? 'bg-electric-400' : 'bg-slot-mask')}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 30 }}
      />
    </span>
  )
}

function DoneRow({ label, kicker, reduced }: { label: string; kicker: string; reduced: boolean }) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0, transition: EXIT } : { opacity: 0, y: -6, transition: EXIT }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className="flex items-center gap-2.5 rounded-comfy border-2 border-electric-400 bg-electric-400/10 px-2 py-1"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-[0.354em] bg-electric-400 text-charcoal-800">
        <Check size={16} strokeWidth={3} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-smoke-100">{label}</span>
      <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.08em] text-electric-400">{kicker}</span>
    </motion.div>
  )
}

function GoalRow({ view, onGo, reduced }: { view: GoalView; onGo: () => void; reduced: boolean }) {
  return (
    <Tooltip title={view.label} description={view.sub ?? undefined} meta={view.where} tone="electric" side="right">
      <motion.button
        type="button"
        onClick={onGo}
        aria-label={`${view.aria}. ${view.where}`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0, transition: EXIT } : { opacity: 0, y: -8, transition: EXIT }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-comfy border-2 border-transparent px-2 py-1 text-left outline-none hover:border-charcoal-400 hover:bg-charcoal-700/60 focus-visible:ring-2 focus-visible:ring-electric-400"
      >
        {view.icon}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-smoke-100">{view.label}</span>
            {view.reward !== null && (
              <span className="flex shrink-0 items-center gap-1 text-xs font-extrabold tabular-nums text-credits">
                <CreditsIcon size={11} aria-hidden="true" />+{formatNum(view.reward)}
              </span>
            )}
          </span>
          <Bar pct={view.pct} tone="electric" reduced={reduced} />
          {view.sub && <span className="mt-0.5 block truncate text-[11px] text-smoke-600">{view.sub}</span>}
        </span>
        {view.eta ? (
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-smoke-600">{view.eta}</span>
        ) : (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-electric-400 px-2 py-0.5 text-[11px] font-extrabold text-charcoal-800 shadow-[0_2px_0_#0e0e0f]">
            Go
            <ChevronRight size={12} strokeWidth={3} aria-hidden="true" />
          </span>
        )}
      </motion.button>
    </Tooltip>
  )
}

function AchievementRow({ view, reduced }: { view: NextAchievement; reduced: boolean }) {
  const pct = pctOf(view.fraction)
  const almost = pct >= ALMOST_PCT
  return (
    <Tooltip title={view.name} description={view.desc} meta={view.label} side="right">
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0, transition: EXIT } : { opacity: 0, y: -8, transition: EXIT }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        className="flex items-center gap-2.5 px-2"
      >
        <span
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-[0.354em] border',
            almost ? 'border-electric-400/60 bg-electric-400/10 text-electric-400' : 'border-charcoal-400 bg-charcoal-700 text-smoke-800',
          )}
        >
          <AchievementGlyph icon={view.icon} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="min-w-0 shrink-0 truncate text-xs font-semibold text-smoke-100">{view.name}</span>
            <span className="min-w-0 flex-1 truncate text-right text-[11px] font-semibold tabular-nums text-smoke-600">{view.label}</span>
          </span>
          <Bar pct={pct} tone={almost ? 'electric' : 'mask'} reduced={reduced} />
        </span>
        {almost && (
          <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.08em] text-electric-400">Almost</span>
        )}
      </motion.div>
    </Tooltip>
  )
}

function EmptyRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1 text-xs text-smoke-600">
      <span className="grid size-7 shrink-0 place-items-center rounded-[0.354em] border border-charcoal-400 bg-charcoal-700 text-smoke-800">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function NextUpPanel() {
  const store = useGameStore()
  const router = useRouter()
  const reducedSetting = useGame((s) => s.settings.reducedMotion)
  const reduced = Boolean(useReducedMotion()) || reducedSetting

  const goal = useNextGoal()
  const achievement = useNextAchievement()

  const goalRef = useRef<HTMLDivElement | null>(null)
  const achRef = useRef<HTMLDivElement | null>(null)
  const burstGoal = useRowBurst(goalRef, reduced)
  const burstAch = useRowBurst(achRef, reduced)

  const keyOfGoal = useCallback((g: Goal) => goalKey(g), [])
  const goalFinished = useCallback((g: Goal) => isGoalDone(g, store.state), [store])
  const keyOfAchievement = useCallback((a: NextAchievement) => a.id, [])
  const achievementFinished = useCallback((a: NextAchievement) => hasAchievement(store.state, a.id), [store])

  const goalDone = useDoneFlash(goal, keyOfGoal, goalFinished, burstGoal)
  const achDone = useDoneFlash(achievement, keyOfAchievement, achievementFinished, burstAch)

  const go = useCallback(() => {
    if (!goal) return
    switch (goal.kind) {
      case 'claim':
        openCenter('contracts')
        return
      case 'setup':
        openStore({ tab: 'models', focusId: goal.modelId })
        return
      case 'buy':
        openStore({ tab: 'hardware', family: goal.family, focusId: goal.hardwareId })
        return
      case 'node':
        parkMapFocus(goal.nodeId)
        router.push('/map')
        return
      case 'level':
        openStats()
    }
  }, [goal, router])

  const goalView = useMemo(() => (goal ? buildGoalView(goal) : null), [goal])
  const doneGoalLabel = useMemo(() => (goalDone ? buildGoalView(goalDone).label : ''), [goalDone])

  return (
    <Panel stripe="mask" title="Next up" bodyClassName="flex flex-col gap-1 p-2">
      <div ref={goalRef}>
        <AnimatePresence mode="wait" initial={false}>
          {goalDone ? (
            <DoneRow key={`done-${goalKey(goalDone)}`} label={doneGoalLabel} kicker="Done" reduced={reduced} />
          ) : goalView ? (
            <GoalRow key={goalView.key} view={goalView} onGo={go} reduced={reduced} />
          ) : (
            <EmptyRow key="no-goal" icon={<Sparkles size={15} aria-hidden="true" />} text="Board clear. Post something and see what the feed does." />
          )}
        </AnimatePresence>
      </div>

      <div ref={achRef} className="border-t border-charcoal-400/60 pt-1">
        <AnimatePresence mode="wait" initial={false}>
          {achDone ? (
            <DoneRow key={`done-${achDone.id}`} label={achDone.name} kicker="Earned" reduced={reduced} />
          ) : achievement ? (
            <AchievementRow key={achievement.id} view={achievement} reduced={reduced} />
          ) : (
            <EmptyRow key="no-ach" icon={<Trophy size={15} aria-hidden="true" />} text="Every visible achievement is yours. The hidden ones are not." />
          )}
        </AnimatePresence>
      </div>
    </Panel>
  )
}
