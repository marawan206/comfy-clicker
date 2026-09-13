'use client'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { toast } from '@/components/overlays/useToasts'
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
 *
 * The selector is part of the cache key, not just the store version. A selector that closes over a
 * prop (`useHardwareRow(id, amount)`, `useJobRow`, `useStudioSelection`) is a new function as soon
 * as that prop changes, and keying on the version alone would hand the render the value computed
 * from the previous props until the loop next bumped the version, which is a wrong render at 20 Hz
 * and a permanently wrong one whenever the loop is not running (hidden tab, no rAF).
 */
export function useGame<T>(selector: Selector<T>, equals: Equals<T> = refEquals): T {
  const store = getGameStore()
  const cache = useRef<{ version: number; selector: Selector<T>; value: T } | null>(null)
  const selectorRef = useRef(selector)
  // eslint-disable-next-line react-hooks/refs -- keep the latest selector without re-subscribing
  selectorRef.current = selector
  const getSnapshot = useCallback((): T => {
    const version = store.version
    const sel = selectorRef.current
    const cached = cache.current
    if (cached && cached.version === version && cached.selector === sel) return cached.value
    const next = sel(store.state, store.derived, store)
    if (cached && equals(cached.value, next)) {
      cached.version = version
      cached.selector = sel
      return cached.value
    }
    cache.current = { version, selector: sel, value: next }
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

/**
 * Starts the loop on mount (client only). Place once near the root.
 *
 * Also says out loud which tab owns the run. Only the tab holding the writer lock saves, so a
 * second tab is a live mirror: it plays, but its own progress is replaced by the writer's next
 * save. Telling the player beats letting them build an hour on a copy that is about to vanish.
 */
export function useGameLifecycle(): void {
  useEffect(() => {
    const store = getGameStore()
    store.start()
    const announce = (leader: boolean): void => {
      toast(
        leader
          ? 'This tab is saving again. The other one closed.'
          : 'Another tab has this run open and is doing the saving. Play here if you like, it mirrors that tab.',
        {
          title: leader ? 'Save handed over' : 'Second tab',
          tone: leader ? 'default' : 'credits',
          key: 'tab-leader',
          durationMs: 8000,
          sound: false,
        },
      )
    }
    if (!store.leader) announce(false)
    const off = store.onLeaderChange(announce)
    return () => {
      off()
      store.stop()
    }
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
