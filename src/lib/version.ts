/**
 * Version arithmetic for the patch notes.
 *
 * It lives in `src/lib` rather than `src/game` because it reads `src/data/patchNotes.ts`, and the
 * engine may not import shipped data (see the module boundary test). Nothing in here touches the
 * save: "which notes has this player seen" is a browser-local watermark, so a new device shows the
 * notes again rather than a cloud save silently swallowing them.
 */
import { GAME_VERSION, PATCH_NOTES, type PatchNote } from '@/data/patchNotes'

/** localStorage key holding the newest version whose notes the player has opened. */
export const VERSION_SEEN_KEY = 'comfy-clicker:version-seen'

/** `1.2.3` → `[1, 2, 3]`. Anything unparseable reads as `0.0.0`, so it is older than everything. */
export function parseVersion(v: string): [number, number, number] {
  const parts = v.trim().split('.')
  const n = (i: number): number => {
    const parsed = Number.parseInt(parts[i] ?? '', 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }
  return [n(0), n(1), n(2)]
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const d = (va[i] as number) - (vb[i] as number)
    if (d !== 0) return d
  }
  return 0
}

/** Every note newer than `seen`, newest first. A null watermark means "this is a new player". */
export function notesSince(seen: string | null, notes: readonly PatchNote[] = PATCH_NOTES): PatchNote[] {
  if (!seen) return []
  return notes.filter((n) => compareVersions(n.version, seen) > 0)
}

/** Read the watermark. Storage can be off (private mode), which reads as "nothing seen". */
export function readVersionSeen(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(VERSION_SEEN_KEY)
  } catch {
    return null
  }
}

/** Stamp the current version as seen. Failing to write only costs one extra dot. */
export function writeVersionSeen(version: string = GAME_VERSION): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(VERSION_SEEN_KEY, version)
  } catch {
    /* private mode or a full quota; the dot comes back next load */
  }
}

/**
 * Whether the "new notes" dot should show. A player with no watermark at all is either brand new
 * or arriving from before this system existed: either way the dot is noise, so the current version
 * is stamped silently on first load (see `useUnseenPatchNotes`).
 */
export function hasUnseenNotes(seen: string | null, version: string = GAME_VERSION): boolean {
  if (!seen) return false
  return compareVersions(version, seen) > 0
}
