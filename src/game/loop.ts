/**
 * Fixed-step game loop on requestAnimationFrame.
 *
 * Wall-clock time between frames goes into an accumulator that is drained in STEP_S slices, so
 * the simulation advances at the same rate on a 30 Hz and a 144 Hz screen. A gap longer than
 * MAX_CATCHUP_S (tab hidden, laptop lid closed) is not simulated step by step; the loop hands it
 * to `onLongGap` and the store decides (usually `applyOffline`). Rendering happens once per
 * frame after the steps, with `alpha` (0..1) telling interpolating renderers how far into the
 * next step the frame sits.
 *
 * Pure TypeScript apart from the rAF/clock globals, which are looked up lazily and can be
 * injected — outside a browser `startLoop` is a no-op that returns a no-op stop.
 */
import { STEP_S } from '@/game/constants'

/** Gaps above this many seconds are reported to `onLongGap` instead of being simulated. */
export const MAX_CATCHUP_S = 5
/** Float slack so an accumulator sitting at 0.049999999 still counts as a full step. */
const STEP_EPS = 1e-9

export interface LoopOptions {
  /** Advance the simulation by `dtSec` (always STEP_S) ending at wall-clock `now`. */
  tick: (dtSec: number, now: number) => void
  /** Draw a frame. `alpha` is the unsimulated fraction of a step (0..1). */
  render: (now: number, alpha: number) => void
  /** A gap longer than MAX_CATCHUP_S was skipped; `elapsedSec` is the whole gap. */
  onLongGap?: (elapsedSec: number, now: number) => void
  /** Injectable clock and frame scheduler (tests, headless). Default: Date.now / requestAnimationFrame. */
  now?: () => number
  requestFrame?: (cb: () => void) => number
  cancelFrame?: (handle: number) => void
}

type FrameScheduler = (cb: () => void) => number

function defaultScheduler(): { request: FrameScheduler; cancel: (h: number) => void } | null {
  if (typeof requestAnimationFrame !== 'function') return null
  // Wrapped rather than referenced: the bare DOM functions throw "Illegal invocation" when detached.
  return {
    request: (cb) => requestAnimationFrame(() => cb()),
    cancel: (h) => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h)
    },
  }
}

/**
 * Start the loop. Returns a stop function; stopping cancels the pending frame and guarantees
 * no further `tick`/`render` calls.
 */
export function startLoop(opts: LoopOptions): () => void {
  const scheduler =
    opts.requestFrame !== undefined
      ? { request: opts.requestFrame, cancel: opts.cancelFrame ?? (() => {}) }
      : defaultScheduler()
  if (!scheduler) return () => {}

  const clock = opts.now ?? (() => Date.now())
  let last = clock()
  let acc = 0
  let running = true
  let handle: number | null = null

  const frame = (): void => {
    if (!running) return
    const now = clock()
    let elapsed = (now - last) / 1000
    last = now
    if (elapsed < 0) elapsed = 0 // clock stepped backwards (NTP); skip rather than rewind

    // The next frame is requested in `finally`: a throw inside a tick, render or event listener
    // still surfaces in the console, but it must not silently stop income and autosave until reload.
    try {
      if (elapsed > MAX_CATCHUP_S) {
        acc = 0
        opts.onLongGap?.(elapsed, now)
      } else {
        acc += elapsed
        while (acc >= STEP_S - STEP_EPS) {
          acc = Math.max(0, acc - STEP_S)
          // Each step is stamped with the wall-clock time at which it ends.
          opts.tick(STEP_S, now - acc * 1000)
          if (!running) return
        }
      }
      opts.render(now, Math.min(1, acc / STEP_S))
    } finally {
      if (running) handle = scheduler.request(frame)
    }
  }

  handle = scheduler.request(frame)
  return () => {
    if (!running) return
    running = false
    if (handle !== null) scheduler.cancel(handle)
    handle = null
  }
}
