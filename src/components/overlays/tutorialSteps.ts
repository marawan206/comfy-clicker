/**
 * The six coach-mark steps, their gates and the "should this player be taught" rules.
 *
 * Pure on purpose: no React, no DOM, no store. `Tutorial.tsx` owns the spotlight, the bubble and
 * the listeners; this module owns the copy and the arithmetic, which is what the tests pin.
 *
 * Gates are measured against a snapshot taken when the tour starts (`tourStart`), so a player who
 * wanders off and does a step early only shortens their tour: the step is already satisfied when
 * the tour reaches it and it completes on entry.
 */
import { TUTORIAL_FLAG } from '@/game/actions'
import type { GameState } from '@/game/types'

/** Clicks step one asks for. Ten, because a post costs exactly 10 credits. */
export const TUTORIAL_CLICKS = 10

/** Above any of these a save is not a first run, so the tour never opens itself. */
export const NEW_PLAYER_CLICKS = 50
export const NEW_PLAYER_CREDITS = 500

export type TourStepId = 'click' | 'studio' | 'feed' | 'store' | 'trending' | 'nav'

/** Counters frozen when the tour starts; every gate is relative to these. */
export interface TourStart {
  /** Epoch ms the tour began. */
  at: number
  clicks: number
  posts: number
  hardware: number
}

export interface TourStep {
  id: TourStepId
  /** `data-tour` value of the element the spotlight cuts out. */
  anchor: string
  /** Used when the anchor is not on screen (no affordable store row yet, for instance). */
  fallbackAnchor?: string
  title: string
  body: string
  /**
   * `action` steps advance when the player does the thing and show a hint instead of a button.
   * `info` steps carry the button in `cta`, and may still advance on their own.
   */
  kind: 'action' | 'info'
  /** Button label on an `info` step, hint line under an `action` step. */
  cta: string
  /** True once this step has been satisfied. Runs on entry too, hence "auto-complete". */
  isDone: (state: GameState, start: TourStart) => boolean
}

/** Every hardware unit owned, all families. */
export function ownedHardware(state: GameState): number {
  let n = 0
  for (const id of Object.keys(state.hardware)) n += state.hardware[id] ?? 0
  return n
}

/** Freeze the counters the gates compare against. Call once, when the tour opens. */
export function tourStart(state: GameState, now: number): TourStart {
  return { at: now, clicks: state.totalClicks, posts: state.stats.posts, hardware: ownedHardware(state) }
}

export const TUTORIAL_STEPS: readonly TourStep[] = [
  {
    id: 'click',
    // The wrapper holding both controls, so the spotlight does not cut the pill out of the
    // lesson and teach that the square is the only button.
    anchor: 'hero-controls',
    title: 'Both of these click.',
    body: 'The logo and the pill under it are one button. Every click is a credit. Ten of them and we move on. Space works too.',
    kind: 'action',
    cta: 'Press either one',
    isDone: (s, start) => s.totalClicks >= start.clicks + TUTORIAL_CLICKS,
  },
  {
    id: 'studio',
    anchor: 'studio-generate',
    title: 'Spend it in the Studio.',
    body: 'A post costs 10 credits and pays back in likes. SD 1.5 runs on the office PC in about 7 seconds.',
    kind: 'action',
    cta: 'Queue a post',
    isDone: (s, start) => s.queue.length > 0 || s.stats.posts > start.posts,
  },
  {
    id: 'feed',
    anchor: 'center-tab-feed',
    title: 'It is collecting likes.',
    body: 'Eight seconds, then the likes turn into credits. Trending tags move likes; credits follow the roll.',
    kind: 'info',
    cta: 'Next',
    isDone: (s, start) => s.posts.some((p) => p.granted && p.createdAt >= start.at),
  },
  {
    id: 'store',
    anchor: 'store-buy',
    fallbackAnchor: 'store',
    title: 'Now buy something.',
    body: 'Hardware earns while you are not clicking. Payback is how long until it paid for itself: shorter is better.',
    kind: 'action',
    cta: 'Buy a row',
    isDone: (s, start) => ownedHardware(s) > start.hardware,
  },
  {
    id: 'trending',
    anchor: 'trending',
    title: 'Trending this week.',
    body: 'Match one of these in a prompt for double the likes. Weeks last ten minutes here.',
    kind: 'info',
    cta: 'Next',
    // Picking a tag advances it from the Tutorial's own listener; there is no state to read.
    isDone: () => false,
  },
  {
    id: 'nav',
    anchor: 'nav',
    title: 'The rest is up there.',
    body: "Map spends credits and Research Points on the Graph. Hub runs other people's workflows. Board is the leaderboard. The ? replays this.",
    kind: 'info',
    cta: 'Done',
    isDone: () => false,
  },
]

/** A save nobody has played yet: the only kind the tour opens itself for. */
export function isNewPlayer(state: GameState): boolean {
  return state.totalClicks < NEW_PLAYER_CLICKS && state.stats.posts === 0 && state.lifetimeCredits < NEW_PLAYER_CREDITS
}

export interface AutoStartContext {
  /** The offline report is up: it owns the screen until it is dismissed. */
  offlinePending?: boolean
  /** Some other modal is up (daily, founder gift, settings). */
  modalOpen?: boolean
}

/** True when the tour should open itself on this boot. */
export function shouldAutoStart(state: GameState, ctx: AutoStartContext = {}): boolean {
  if (state.flags[TUTORIAL_FLAG]) return false
  if (ctx.offlinePending === true || ctx.modalOpen === true) return false
  return isNewPlayer(state)
}

/**
 * Index of the first step at or after `from` that is not already satisfied.
 * Returns `TUTORIAL_STEPS.length` when there is nothing left to teach.
 */
export function firstIncompleteStep(state: GameState, start: TourStart, from = 0): number {
  let i = Math.max(0, from)
  while (i < TUTORIAL_STEPS.length && TUTORIAL_STEPS[i].isDone(state, start)) i += 1
  return i
}
