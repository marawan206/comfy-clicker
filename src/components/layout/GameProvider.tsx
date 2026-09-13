'use client'
import type { ReactNode } from 'react'
import { TooltipProviderRoot } from '@/components/common/Tooltip'
import { useGameLifecycle } from '@/state/useGame'

/**
 * Starts the game loop once for the whole app (the store is a module singleton) and hosts the
 * shared tooltip delay group, so every route gets the same 350 ms open delay and instant
 * tooltip-to-tooltip hops.
 */
export function GameProvider({ children }: { children: ReactNode }) {
  useGameLifecycle()
  return <TooltipProviderRoot>{children}</TooltipProviderRoot>
}
