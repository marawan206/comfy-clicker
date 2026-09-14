'use client'
/**
 * Mounts the sound system: one subscription to the engine event bus, one gesture listener, and the
 * click combo the pitch ramp runs on. Place it once, next to `useHotkeys` in `GameShell`.
 *
 * The combo counted here is the hook's own. `ComboMeter` counts the same thing for the pill, but
 * the pill can be absent, re-mounted or hidden and the sound must not depend on it, so both read
 * the same `COMBO_GAP_MS` and keep their own tally.
 */
import { useEffect, useRef } from 'react'
import { armSfx, playCue, setSfxEnabled, stopAllSfx } from '@/audio/sfxEngine'
import { cueForEvent } from '@/audio/sfxMap'
import { COMBO_GAP_MS } from '@/components/hero/ComboMeter'
import { useReducedMotionPref } from '@/components/overlays/ModalBase'
import { useGame, useGameEvents, useGameStore } from '@/state/useGame'

export function useSfx(): void {
  const store = useGameStore()
  const sfx = useGame((s) => s.settings.sfx)
  // The Lounge lands a bet instantly under reduced motion, so its anticipation cues are skipped.
  const reducedMotion = useReducedMotionPref()
  const combo = useRef(0)
  const lastClickAt = useRef(0)

  // Arm on mount whatever the setting says: the listener only records that a gesture happened, so
  // switching sound on mid-session starts working on the same click instead of the next one.
  useEffect(() => {
    armSfx()
    return () => stopAllSfx()
  }, [])

  useEffect(() => {
    setSfxEnabled(sfx)
  }, [sfx])

  useGameEvents((event) => {
    if (!store.state.settings.sfx) return

    if (event.type === 'click') {
      const now = performance.now()
      combo.current = now - lastClickAt.current <= COMBO_GAP_MS ? combo.current + 1 : 1
      lastClickAt.current = now
    }

    const hiddenAchievement =
      event.type === 'achievement' && store.catalog.achievements.some((a) => a.id === event.id && a.hidden === true)

    playCue(cueForEvent(event, { combo: combo.current, hiddenAchievement, reducedMotion }))
  })
}
