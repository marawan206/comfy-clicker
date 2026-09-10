'use client'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { FeedItem } from '@/server/feed/types'
import {
  getFeedServerSnapshot,
  getFeedSnapshot,
  startFeedPolling,
  subscribeFeed,
  type FeedOrigin,
} from '@/components/feed/feedClient'

export interface FeedValue {
  items: FeedItem[]
  trending: string[]
  loading: boolean
  origin: FeedOrigin
  error: string | null
}

const FeedContext = createContext<FeedValue | null>(null)

/** Reads the feed client's snapshot; works with or without a provider (the provider only adds polling). */
function useFeedSnapshot(): FeedValue {
  const snap = useSyncExternalStore(subscribeFeed, getFeedSnapshot, getFeedServerSnapshot)
  return useMemo<FeedValue>(
    () => ({ items: snap.items, trending: snap.trending, loading: snap.loading, origin: snap.origin, error: snap.error }),
    [snap.items, snap.trending, snap.loading, snap.origin, snap.error],
  )
}

/**
 * Starts polling `/api/feed` (every 10 minutes and on tab return) and exposes the result through
 * `useFeed()`. The client also pushes live trending tags into the game store.
 */
export function FeedProvider({ children }: { children: ReactNode }) {
  useEffect(() => startFeedPolling(), [])
  const value = useFeedSnapshot()
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>
}

/** Real posts, live trending ids and load state. */
export function useFeed(): FeedValue {
  const ctx = useContext(FeedContext)
  const fallback = useFeedSnapshot()
  return ctx ?? fallback
}
