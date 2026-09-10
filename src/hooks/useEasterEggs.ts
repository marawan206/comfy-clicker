'use client'
/**
 * Hidden inputs that raise discovery flags through `store.setFlag` (which emits `easterEgg`
 * once per key and refuses repeats):
 *   Konami code (↑↑↓↓←→←→BA) anywhere        → 'konami'
 *   typing "comfy" outside a text field        → 'comfy-wave'
 *   100 Generate clicks inside 10 seconds      → 'click-frenzy'
 */
import { useEffect, useRef } from 'react'
import { useGameEvents, useGameStore } from '@/state/useGame'
import { fx } from '@/components/fx/fxBus'
import { isEditableTarget } from '@/hooks/useHotkeys'

export const KONAMI_FLAG = 'konami'
export const COMFY_WAVE_FLAG = 'comfy-wave'
/** Not `speedrun`: that key belongs to the "cloud node in under 25 minutes" achievement in src/game. */
export const CLICK_FRENZY_FLAG = 'click-frenzy'

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'] as const
const WORD = 'comfy'
const FRENZY_CLICKS = 100
const FRENZY_WINDOW_MS = 10_000

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
