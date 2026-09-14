'use client'
/**
 * Mounts the sound system: one subscription to the engine event bus and one gesture listener.
 * Place it once, next to `useHotkeys` in `GameShell`.
 *
 * The click pitch ramp runs on the streak the engine reports on the `click` event (`combo`, from
 * src/game/combo.ts), so the sound, the pill and the pay all agree on where the streak stands.
 */
import { useEffect } from 'react'
import { armSfx, playCue, setSfxEnabled, stopAllSfx } from '@/audio/sfxEngine'
import { cueForEvent } from '@/audio/sfxMap'
import { useReducedMotionPref } from '@/components/overlays/ModalBase'
import { useGame, useGameEvents, useGameStore } from '@/state/useGame'

export function useSfx(): void {
  const store = useGameStore()
  const sfx = useGame((s) => s.settings.sfx)
  // The Lounge lands a bet instantly under reduced motion, so its anticipation cues are skipped.
  const reducedMotion = useReducedMotionPref()

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

    const combo = event.type === 'click' ? event.combo : 0
    const hiddenAchievement =
      event.type === 'achievement' && store.catalog.achievements.some((a) => a.id === event.id && a.hidden === true)

    playCue(cueForEvent(event, { combo, hiddenAchievement, reducedMotion }))
  })
}
