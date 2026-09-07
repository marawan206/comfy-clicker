/**
 * Achievements: every def whose `cond` holds is granted once and never revoked. Each one is also
 * +ACHIEVEMENT_MULT income (derived.ts), so the engine checks about once a second and after
 * anything that could flip a condition.
 */
import type { Catalog } from '@/data'
import type { Derived, GameEvent, GameState } from '@/game/types'
import { isUnlocked } from '@/game/unlock'

/** Upper bound on cascade passes (an achievement whose condition is "N achievements"). */
const MAX_PASSES = 4

export function hasAchievement(state: GameState, id: string): boolean {
  return state.achievements.includes(id)
}

/**
 * Grants every newly satisfied achievement, emitting `achievement` per grant in catalog order.
 * Re-runs while a pass granted something so count-based achievements land in the same call.
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
      out.push({ type: 'achievement', id: def.id })
      granted += 1
    }
    if (granted === 0) break
  }
  return out
}
