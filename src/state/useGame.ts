'use client'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Derived, GameEvent, GameState } from '@/game/types'
import { getGameStore, type GameStore } from './store'

type Selector<T> = (state: GameState, derived: Derived, store: GameStore) => T
type Equals<T> = (a: T, b: T) => boolean

const refEquals = <T,>(a: T, b: T): boolean => Object.is(a, b)

/** Shallow equality for small selector objects/arrays so components re-render only when their slice changes. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  return true
}

/**
 * Subscribe to a slice of game state. The selector runs on every store version bump
 * (≈20 Hz while the loop runs) but the component re-renders only when `equals` says the slice changed.
 *
 * The snapshot cache lives in refs that are read and written inside `getSnapshot`, which React
 * invokes during render: this is the same memoisation pattern as `use-sync-external-store/with-selector`
 * and is required so `getSnapshot` returns a referentially stable value while the slice is unchanged.
 */
export function useGame<T>(selector: Selector<T>, equals: Equals<T> = refEquals): T {
  const store = getGameStore()
  const cache = useRef<{ version: number; value: T } | null>(null)
  const selectorRef = useRef(selector)
  // eslint-disable-next-line react-hooks/refs -- keep the latest selector without re-subscribing
  selectorRef.current = selector
  const getSnapshot = useCallback((): T => {
    const version = store.version
    const cached = cache.current
    if (cached && cached.version === version) return cached.value
    const next = selectorRef.current(store.state, store.derived, store)
    if (cached && equals(cached.value, next)) {
      cached.version = version
      return cached.value
    }
    cache.current = { version, value: next }
    return next
  }, [store, equals])
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** Selector helper with shallow equality (use for objects with primitive fields). */
export function useGameShallow<T extends object>(selector: Selector<T>): T {
  return useGame(selector, shallowEqual)
}

export function useGameStore(): GameStore {
  return getGameStore()
}

/** Starts the loop on mount (client only). Place once near the root. */
export function useGameLifecycle(): void {
  useEffect(() => {
    const store = getGameStore()
    store.start()
    return () => store.stop()
  }, [])
}

/** Subscribe to engine events (for FX, toasts, sounds). */
export function useGameEvents(handler: (event: GameEvent) => void): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => getGameStore().onEvent(e => ref.current(e)), [])
}
