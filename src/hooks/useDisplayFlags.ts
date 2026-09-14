'use client'
import { useEffect } from 'react'
import { useGame } from '@/state/useGame'

export interface DisplayFlags {
  projector: boolean
  reducedMotion: boolean
}

/**
 * Mirrors the two display settings onto `<html>`, which is the only element every route and every
 * portal shares: `html.projector` bumps the root font size so the rem grid scales (globals.css),
 * `html.reduced-motion` stops the project's CSS loops. Overlays and modals portal to `<body>`, so
 * a class on a route's own wrapper would never reach them.
 *
 * Every route that keeps the store alive calls this, otherwise the in-game toggles do nothing
 * there: the game shell, the Graph, ComfyHub, the board and the shared secondary-route chrome.
 * Returns both values so a caller that also wants them for a local class does not subscribe twice.
 */
export function useDisplayFlags(): DisplayFlags {
  const projector = useGame((s) => s.settings.projector)
  const reducedMotion = useGame((s) => s.settings.reducedMotion)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('projector', projector)
    return () => root.classList.remove('projector')
  }, [projector])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('reduced-motion', reducedMotion)
    return () => root.classList.remove('reduced-motion')
  }, [reducedMotion])

  return { projector, reducedMotion }
}
