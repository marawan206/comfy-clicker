/**
 * Actions that exist because a server said so. They follow the `src/game/actions.ts` contract
 * (`(ctx) => ActionResult`, validation failures leave the state untouched) and run through
 * `GameStore.run`, so events, derived recompute and the React notify happen exactly as for a
 * click. They live here rather than in the core because their inputs come from HTTP, not play.
 */
import type { ActionContext, ActionResult } from '@/game/actions'
import { DAILY_CLAIMED_KEEP, DAILY_CP_DAY, DAILY_RP_DAY, cycleDay, dailyReward, dayKey } from '@/game/daily'
import { addCredits } from '@/game/engine'
import type { GameEvent } from '@/game/types'

const ok = (events: GameEvent[], dirty: boolean): ActionResult => ({ events, dirty })
const fail = (error: string): ActionResult => ({ events: [], dirty: false, error })

/** What `/api/daily` answered: the UTC day it recorded and the streak it computed. */
export interface ServerDailyClaim {
  day: string
  streak: number
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function rememberDay(state: ActionContext['state'], key: string): void {
  if (!state.daily.claimed.includes(key)) state.daily.claimed.push(key)
  while (state.daily.claimed.length > DAILY_CLAIMED_KEEP) state.daily.claimed.shift()
}

/**
 * Pay out today's daily reward on the server's terms: its day key and its streak, not the
 * browser clock. The reward itself is the game's own formula for that streak position.
 */
export function claimDailyFromServer(ctx: ActionContext, claim: ServerDailyClaim): ActionResult {
  const { state, derived, now } = ctx
  if (!DAY_KEY.test(claim.day)) return fail('The server sent a day the calendar cannot read')
  if (state.daily.claimed.includes(claim.day) || state.daily.lastClaimDay === claim.day) return fail('Already claimed today')
  const streak = Math.max(1, Math.floor(claim.streak))
  const day = cycleDay(streak)
  const credits = dailyReward(derived.cps, day)
  const { rp, cp } = state

  addCredits(state, credits)
  if (day === DAILY_RP_DAY) state.rp += 1
  if (day === DAILY_CP_DAY) state.cp += 1
  state.daily.streak = streak
  state.daily.lastClaimDay = claim.day
  rememberDay(state, claim.day)
  // A browser clock on another day than the server: mark the local day too, so the header chip
  // stops asking for a claim the server has already refused.
  const local = dayKey(now)
  if (local !== claim.day) rememberDay(state, local)

  return ok([{ type: 'daily', day, credits }], state.rp !== rp || state.cp !== cp)
}

/**
 * The server already holds a claim for this day (409): adopt its record without paying again, so
 * the calendar and header agree with the server for the rest of the day.
 */
export function markDailyClaimed(ctx: ActionContext, claim: ServerDailyClaim): ActionResult {
  const { state, now } = ctx
  if (!DAY_KEY.test(claim.day)) return fail('The server sent a day the calendar cannot read')
  const local = dayKey(now)
  const already = state.daily.claimed.includes(claim.day) && (local === claim.day || state.daily.claimed.includes(local))
  if (already) return fail('Already claimed today')
  if (claim.streak >= 1) state.daily.streak = Math.floor(claim.streak)
  state.daily.lastClaimDay = claim.day
  rememberDay(state, claim.day)
  if (local !== claim.day) rememberDay(state, local)
  return ok([], false)
}

/** A workflow of yours went up on ComfyHub. */
export function recordHubPublish(ctx: ActionContext): ActionResult {
  ctx.state.stats.hubPublished += 1
  return ok([], false)
}

export interface HubRoyaltyGrant {
  runs: number
  royalty: number
  rep: number
}

/**
 * Other players ran your workflows: the server collected `runs` of them and owes `royalty`
 * credits and `rep`. Credits go through `addCredits` so lifetime and season totals move too.
 */
export function applyHubRoyalties(ctx: ActionContext, grant: HubRoyaltyGrant): ActionResult {
  const { state } = ctx
  const runs = Math.max(0, Math.floor(grant.runs))
  const royalty = Math.max(0, Math.round(grant.royalty))
  const rep = Math.max(0, Math.floor(grant.rep))
  if (runs === 0 && royalty === 0 && rep === 0) return fail('Nothing to collect')
  state.stats.hubRuns += runs
  state.hubRep += rep
  addCredits(state, royalty)
  return ok([], false)
}
