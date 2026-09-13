'use client'
/**
 * Hidden inputs that raise discovery flags through `store.setFlag` (which emits `easterEgg`
 * once per key, grants the achievement it unlocks and pays that achievement's credits in the same
 * call, then refuses repeats):
 *   Konami code (↑↑↓↓←→←→BA) anywhere           → 'konami'
 *   typing "comfy" outside a text field           → 'comfy-wave'
 *   100 Generate clicks inside 10 seconds         → 'click-frenzy'
 *   a Generate click between 03:00 and 03:59      → 'night-shift'
 *   Map, Hub, Board, Stats and Settings, one run  → 'grand-tour'
 *
 * The night shift reads the clock in the browser, not in the engine: the engine has no timezone
 * and must not grow one. The grand tour counts panels across routes, so it lives in its own hook
 * mounted by `Overlays` (every route carries those); everything else needs the workbench and rides
 * in `useEasterEggs`, mounted once by `GameShell`.
 */
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useGameEvents, useGameStore } from '@/state/useGame'
import { fx } from '@/components/fx/fxBus'
import { OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import { isEditableTarget } from '@/hooks/useHotkeys'

export const KONAMI_FLAG = 'konami'
export const COMFY_WAVE_FLAG = 'comfy-wave'
/** Not `speedrun`: that key belongs to the "cloud node in under 25 minutes" achievement in src/game. */
export const CLICK_FRENZY_FLAG = 'click-frenzy'
export const NIGHT_SHIFT_FLAG = 'night-shift'
export const GRAND_TOUR_FLAG = 'grand-tour'

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'] as const
const WORD = 'comfy'
const FRENZY_CLICKS = 100
const FRENZY_WINDOW_MS = 10_000
/** The hour the queue does not care about. Local time, 03:00 to 03:59. */
export const NIGHT_SHIFT_HOUR = 3

export function useEasterEggs(): void {
  const store = useGameStore()
  const konamiIndex = useRef(0)
  const typed = useRef('')
  const clicks = useRef<number[]>([])

  useEffect(() => {
    const raise = (key: string, celebrate: () => void) => {
      if (store.state.flags[key]) return
      const result = store.setFlag(key)
      if (!result.error) celebrate()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      // Konami listens everywhere (arrows never type anything useful).
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.code === KONAMI[konamiIndex.current]) {
          konamiIndex.current += 1
          if (konamiIndex.current === KONAMI.length) {
            konamiIndex.current = 0
            // FxCanvas already fires confetti on the engine's `easterEgg` event; only add the colour.
            raise(KONAMI_FLAG, () => fx.flash('#172dd7'))
          }
        } else {
          konamiIndex.current = e.code === KONAMI[0] ? 1 : 0
        }
      }

      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.length !== 1) return
      typed.current = (typed.current + e.key.toLowerCase()).slice(-WORD.length)
      if (typed.current === WORD) {
        typed.current = ''
        raise(COMFY_WAVE_FLAG, () => fx.flash('#f0ff41'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

  useGameEvents((event) => {
    if (event.type !== 'click') return

    // Night shift: the cheap check first, so 15 clicks a second cost one date read and nothing else.
    if (!store.state.flags[NIGHT_SHIFT_FLAG] && new Date().getHours() === NIGHT_SHIFT_HOUR) {
      const result = store.setFlag(NIGHT_SHIFT_FLAG)
      if (!result.error) fx.flash('#172dd7')
    }

    if (store.state.flags[CLICK_FRENZY_FLAG]) return
    const now = Date.now()
    const window_ = clicks.current
    window_.push(now)
    const cutoff = now - FRENZY_WINDOW_MS
    let drop = 0
    while (drop < window_.length && (window_[drop] as number) < cutoff) drop++
    if (drop > 0) window_.splice(0, drop)
    if (window_.length >= FRENZY_CLICKS) {
      window_.length = 0
      const result = store.setFlag(CLICK_FRENZY_FLAG)
      if (!result.error) {
        fx.flash('#fbbf24')
        fx.burst(window.innerWidth * 0.16, window.innerHeight * 0.45, 24)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Grand tour
// ---------------------------------------------------------------------------

/** Session log of the panels opened so far. Session, not local: the tour is one sitting. */
export const GRAND_TOUR_KEY = 'comfy-clicker:grand-tour'

/** Every panel the header can reach. All five, one session, and the egg pays. */
export const GRAND_TOUR_PANELS: readonly string[] = ['map', 'hub', 'leaderboard', 'stats', 'settings']

/** Route panels, keyed by the path that shows them. */
const ROUTE_PANEL: Record<string, string> = {
  '/map': 'map',
  '/hub': 'hub',
  '/leaderboard': 'leaderboard',
}

/** Modal panels the header announces through `comfy:open-modal`. */
const MODAL_PANEL: ReadonlySet<string> = new Set(['stats', 'settings'])

function readSeen(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(GRAND_TOUR_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    // Private mode or a corrupt entry: the tour restarts, which is the harmless failure.
    return new Set()
  }
}

function writeSeen(seen: ReadonlySet<string>): void {
  try {
    window.sessionStorage.setItem(GRAND_TOUR_KEY, JSON.stringify([...seen]))
  } catch {
    /* nothing to do: the set still lives in the ref for this page's lifetime */
  }
}

/** True once every panel in `GRAND_TOUR_PANELS` has been seen. */
export function tourComplete(seen: ReadonlySet<string>): boolean {
  return GRAND_TOUR_PANELS.every((p) => seen.has(p))
}

/**
 * "Read The Docs": open Map, Hub, Board, Stats and Settings in one session. Mounted by `Overlays`
 * rather than by `GameShell`, because three of the five are other routes and the shell is gone by
 * the time they render.
 */
export function useGrandTour(): void {
  const store = useGameStore()
  const pathname = usePathname()
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (seen.current === null) seen.current = readSeen()
    const set = seen.current

    const note = (panel: string | undefined) => {
      if (!panel || set.has(panel)) return
      set.add(panel)
      writeSeen(set)
      if (!tourComplete(set)) return
      if (store.state.flags[GRAND_TOUR_FLAG]) return
      const result = store.setFlag(GRAND_TOUR_FLAG)
      if (!result.error) fx.flash('#f0ff41')
    }

    note(ROUTE_PANEL[pathname ?? ''])

    const onModal = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail
      if (typeof id === 'string' && MODAL_PANEL.has(id)) note(id)
    }
    window.addEventListener(OPEN_MODAL_EVENT, onModal)
    return () => window.removeEventListener(OPEN_MODAL_EVENT, onModal)
  }, [store, pathname])
}
