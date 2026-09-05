'use client'
import type { ReactNode } from 'react'
import { useGameLifecycle } from '@/state/useGame'

/** Starts the game loop once for the whole app (the store is a module singleton). */
export function GameProvider({ children }: { children: ReactNode }) {
  useGameLifecycle()
  return <>{children}</>
}
