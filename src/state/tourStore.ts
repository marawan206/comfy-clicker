'use client'
/**
 * Where the tour is, for anything that needs to know.
 *
 * Tiny external store rather than context: `DailyModal` only wants "is the tour up" and the
 * `Tutorial` overlay is the single writer, so a module singleton with `useSyncExternalStore` beats
 * a provider nobody else would use. "Has been taught" is not here: that is `flags['tutorial-done']`
 * on the game state, which the cloud save carries between devices. This holds the step cursor only,
 * so a reload mid-tour resumes where the player was.
 */
import { useSyncExternalStore } from 'react'

export const TOUR_STORAGE_KEY = 'comfy-clicker:tour'

export interface TourSnapshot {
  active: boolean
  /** Zero-based index into `TUTORIAL_STEPS`. */
  step: number
}

const IDLE: TourSnapshot = { active: false, step: 0 }

let snapshot: TourSnapshot = IDLE
const listeners = new Set<() => void>()

function publish(next: TourSnapshot): void {
  if (next.active === snapshot.active && next.step === snapshot.step) return
  snapshot = next
  for (const listener of listeners) listener()
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTourSnapshot(): TourSnapshot {
  return snapshot
}

/** The stored cursor, or null when there is none (or the browser refuses storage). */
export function readTourCursor(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TOUR_STORAGE_KEY)
    if (raw === null) return null
    const n = Number.parseInt(raw, 10)
    return Number.isInteger(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

function writeTourCursor(step: number): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, String(step))
  } catch {
    /* private mode or quota: the tour just does not resume after a reload */
  }
}

function clearTourCursor(): void {
  try {
    window.localStorage.removeItem(TOUR_STORAGE_KEY)
  } catch {
    /* nothing to clean up */
  }
}

/** Open the tour at `step` (0 for a replay from the top). */
export function startTour(step = 0): void {
  writeTourCursor(step)
  publish({ active: true, step })
}

/** Move the cursor. Ignored when the tour is not running. */
export function setTourStep(step: number): void {
  if (!snapshot.active) return
  writeTourCursor(step)
  publish({ active: true, step })
}

/** Close the tour and drop the cursor. Marking it taught is the caller's job. */
export function endTour(): void {
  clearTourCursor()
  publish(IDLE)
}

export function useTour(): TourSnapshot {
  return useSyncExternalStore(subscribeTour, getTourSnapshot, getTourSnapshot)
}

/** For anything that must stay out of the tour's way. */
export function useTourActive(): boolean {
  return useSyncExternalStore(
    subscribeTour,
    () => snapshot.active,
    () => false,
  )
}
