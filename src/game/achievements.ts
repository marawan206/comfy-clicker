/**
 * Achievements: every def whose `cond` holds is granted once and never revoked. Each one is also
 * +ACHIEVEMENT_MULT income (derived.ts), so the engine checks about once a second and after
 * anything that could flip a condition.
 *
 * A def may also carry `reward`, a one-off credit payout handed over the moment the row is granted
 * (`achievement` carries it, so the toast can show `+1,000`). That is what lets an easter egg, its
 * achievement and its credits land on the same click rather than a second later.
 */
import type { Catalog } from '@/data'
import type { AchievementDef, Derived, GameEvent, GameState } from '@/game/types'
import { isUnlocked } from '@/game/unlock'

/** Upper bound on cascade passes (an achievement whose condition is "N achievements"). */
const MAX_PASSES = 4

export function hasAchievement(state: GameState, id: string): boolean {
  return state.achievements.includes(id)
}

/**
 * Pay an achievement's `reward`.
 *
 * This is `addCredits` from engine.ts spelled out: engine.ts imports this module, so importing it
 * back would close a cycle. Keep the three counters in step with `addCredits`.
 */
function payReward(state: GameState, def: AchievementDef): number {
  const credits = def.reward ?? 0
  if (!(credits > 0)) return 0
  state.credits += credits
  state.lifetimeCredits += credits
  state.seasonCredits += credits
  return credits
}

/**
 * Grants every newly satisfied achievement, emitting `achievement` per grant in catalog order.
 * Re-runs while a pass granted something so count-based achievements land in the same call (a
 * reward raises lifetime credits, which can itself satisfy the next row).
 */
export function checkAchievements(state: GameState, derived: Derived, catalog: Catalog): GameEvent[] {
  const out: GameEvent[] = []
  if (state.achievements.length >= catalog.achievements.length) return out
  const owned = new Set(state.achievements)
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let granted = 0
    for (const def of catalog.achievements) {
      if (owned.has(def.id)) continue
      if (!isUnlocked(def.cond, state, derived, catalog)) continue
      owned.add(def.id)
      state.achievements.push(def.id)
      out.push({ type: 'achievement', id: def.id, reward: payReward(state, def) })
      granted += 1
    }
    if (granted === 0) break
  }
  return out
}
