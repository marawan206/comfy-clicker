'use client'
import { useSyncExternalStore } from 'react'

/** Nothing to subscribe to: the value flips once, when React hydrates, and never again. */
const noSubscribe = (): (() => void) => () => {}
const onClient = (): boolean => true
const onServer = (): boolean => false

/**
 * False during SSR and on the first client render, true afterwards.
 *
 * For anything whose value only exists in the browser (a clock, the loaded save): render a stable
 * placeholder while this is false, then the real thing. `useSyncExternalStore` is the hook that
 * gives React a separate server snapshot, so the first client render matches the HTML and React
 * swaps in the real value on the commit instead of screaming about a mismatch.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, onClient, onServer)
}
