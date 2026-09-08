'use client'
import { useEffect, useState } from 'react'

/** A clock that re-renders at most every `intervalMs` (for countdowns and progress bars). */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
