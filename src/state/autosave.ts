/**
 * When the save should be written.
 *
 * Pure and timer-free on purpose. The 20 Hz loop in `GameStore` is already the only clock the game
 * has; a second one (a `setTimeout` per purchase) would have to be cancelled on unmount, would
 * drift behind a throttled background tab, and would fire while the tab is hidden, which is exactly
 * when the state is least likely to be worth writing. So the tick asks this function on every step
 * and it answers with a reason or with nothing.
 *
 * Two cadences, and the more urgent one wins:
 * 1. **action** · something the player did changed the state, and it has been quiet for
 *    `SAVE_DEBOUNCE_MS` since. Ten purchases inside a second are one write, not ten.
 * 2. **interval** · `AUTOSAVE_MS` has passed since the last write, dirty or not.
 *
 * `'manual'`, `'hide'` and `'import'` are never returned: those writes are asked for directly
 * (the S key or the Save now button, the tab going away, a code being imported). The tab-hide
 * write in particular ignores `settings.autosave`: losing a session because a setting was off is
 * not a trade anybody wants.
 */
import { AUTOSAVE_MS, SAVE_DEBOUNCE_MS } from '@/game/constants'

/** Why a save happened. The UI prints it next to the timestamp. */
export type SaveReason = 'interval' | 'action' | 'manual' | 'hide' | 'import'

export { AUTOSAVE_MS, SAVE_DEBOUNCE_MS }

/**
 * The reason to save right now, or null.
 *
 * `dirtyAt` is the moment the state first became unsaved since the last write (null when nothing
 * is pending). `autosave` is `settings.autosave`: when it is off nothing is ever due, and the only
 * writes left are the explicit ones.
 */
export function autosaveDue(
  now: number,
  lastSaveAt: number,
  dirtyAt: number | null,
  autosave: boolean,
): SaveReason | null {
  if (!autosave) return null
  if (dirtyAt !== null && Number.isFinite(dirtyAt) && now - dirtyAt >= SAVE_DEBOUNCE_MS) return 'action'
  if (now - lastSaveAt >= AUTOSAVE_MS) return 'interval'
  return null
}
