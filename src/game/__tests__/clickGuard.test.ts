/**
 * The anti auto-clicker engine, tested in both directions.
 *
 * The critical property is asymmetric: catching a tool is nice, punishing a human is a bug. So the
 * false-positive half runs real generated streams (mulberry32, several seeds) that look like a
 * hand on a mouse, and demands *zero* refusals from every one of them, including the 100 clicks in
 * under 10 seconds that the "Batch Size: Yes" achievement needs.
 */
import { describe, expect, it } from 'vitest'
import {
  CLICK_GUARD_FLAG,
  CLICK_RATE_WINDOW_MS,
  CLICK_RING,
  cadence,
  evaluateClick,
  resetClickGuard,
  type ClickVerdict,
} from '@/game/clickGuard'
import {
  CADENCE_INTERVALS,
  CADENCE_MAX_CV,
  CADENCE_MAX_MEAN_MS,
  CLICK_CAP_PER_SEC,
  CLICK_LOCKOUT_MAX_MS,
  CLICK_LOCKOUT_MS,
  CLICK_STRIKE_DECAY_MS,
} from '@/game/constants'
import { mulberry32, uniform } from '@/game/rng'
import { createInitialState } from '@/game/state'
import type { GameState } from '@/game/types'

const T0 = 1_700_000_000_000
const GUEST = 'guest-test'
const SEEDS = [1, 7, 42, 1337, 90210] as const

type Refusal = Extract<ClickVerdict, { ok: false }>

const fresh = (): GameState => createInitialState(T0, GUEST)

/** One verdict per attempted timestamp, in order. */
function drive(state: GameState, times: readonly number[]): ClickVerdict[] {
  return times.map((t) => evaluateClick(state, t))
}

function refusals(verdicts: readonly ClickVerdict[]): Refusal[] {
  return verdicts.filter((v): v is Refusal => !v.ok)
}

function intervalsOf(times: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < times.length; i++) out.push((times[i] as number) - (times[i - 1] as number))
  return out
}

/** Lowest CV any full ring inside the stream shows: the closest the stream ever comes to tripping. */
function tightestWindowCv(times: readonly number[]): number {
  const iv = intervalsOf(times)
  let lowest = Infinity
  for (let i = CADENCE_INTERVALS; i <= iv.length; i++) {
    lowest = Math.min(lowest, cadence(iv.slice(i - CADENCE_INTERVALS, i)).cv)
  }
  return lowest
}

/** A timer: perfectly regular, the thing the guard exists to catch. */
function metronome(start: number, count: number, stepMs: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i * stepMs)
}

/**
 * A hand on a mouse: each click lands near its slot and never exactly on it. Jittering the slot
 * rather than the interval is the honest model, since a human aiming at a rhythm does not let the
 * error accumulate.
 */
function humanStream(start: number, count: number, stepMs: number, jitterMs: number, seed: number): number[] {
  const rng = mulberry32(seed)
  return Array.from({ length: count }, (_, i) => Math.round(start + i * stepMs + uniform(rng, -jitterMs, jitterMs)))
}

/** A sloppier hand: every interval drawn straight from a band, so the rhythm drifts. */
function driftStream(start: number, count: number, lo: number, hi: number, seed: number): number[] {
  const rng = mulberry32(seed)
  const out = [start]
  for (let i = 1; i < count; i++) out.push(Math.round((out[i - 1] as number) + uniform(rng, lo, hi)))
  return out
}

/** Drive a 25-click metronome at 100 ms and return the strike it lands. */
function tripCadence(state: GameState, start: number): { at: number; lockoutMs: number } {
  const times = metronome(start, CLICK_RING, 100)
  const verdicts = drive(state, times)
  const last = verdicts[verdicts.length - 1] as Refusal
  expect(last.ok).toBe(false)
  expect(last.reason).toBe('cadence')
  const at = times[times.length - 1] as number
  return { at, lockoutMs: state.stats.clickLockUntil - at }
}

// ---------------------------------------------------------------------------
// cadence()
// ---------------------------------------------------------------------------

describe('cadence', () => {
  it('returns zeros for fewer than two timestamps', () => {
    expect(cadence([])).toEqual({ mean: 0, cv: 0 })
  })

  it('has no spread with a single interval', () => {
    expect(cadence([137])).toEqual({ mean: 137, cv: 0 })
  })

  it('reads a metronome as mean with zero variation', () => {
    expect(cadence([100, 100, 100, 100])).toEqual({ mean: 100, cv: 0 })
  })

  it('divides the population standard deviation by the mean', () => {
    // Mean 100, deviations ±10, so sd = 10 and cv = 0.1.
    const { mean, cv } = cadence([90, 110, 90, 110])
    expect(mean).toBe(100)
    expect(cv).toBeCloseTo(0.1, 12)
  })

  it('treats a burst of identical timestamps as maximally regular', () => {
    expect(cadence([0, 0, 0, 0])).toEqual({ mean: 0, cv: 0 })
  })
})

// ---------------------------------------------------------------------------
// False positives: a real hand is never punished
// ---------------------------------------------------------------------------

const HUMAN_STREAMS: { name: string; build: (seed: number) => number[] }[] = [
  {
    name: '14 clicks a second with 25 ms of jitter, for 3 seconds',
    build: (seed) => humanStream(T0, 42, 1000 / 14, 25, seed),
  },
  {
    name: '100 clicks inside 9.8 seconds, the frenzy achievement',
    build: (seed) => humanStream(T0, 100, 9800 / 99, 25, seed),
  },
  {
    name: '300 clicks with intervals uniform in 60 to 140 ms',
    build: (seed) => driftStream(T0, 300, 60, 140, seed),
  },
  {
    name: '150 clicks around 150 ms, fast enough that only the CV gate saves them',
    build: (seed) => humanStream(T0, 150, 150, 32, seed),
  },
  {
    name: '100 clicks at a flat 333 ms, a slow metronome',
    build: () => metronome(T0, 100, 333),
  },
]

describe('evaluateClick does not punish a human', () => {
  for (const stream of HUMAN_STREAMS) {
    it(`accepts every click: ${stream.name}`, () => {
      for (const seed of SEEDS) {
        const state = fresh()
        const times = stream.build(seed)
        const verdicts = drive(state, times)

        expect(refusals(verdicts)).toEqual([])
        expect(verdicts).toHaveLength(times.length)
        expect(state.stats.clickStrikes).toBe(0)
        expect(state.stats.clickLockUntil).toBe(0)
        expect(state.stats.clickStrikeAt).toBe(0)
        expect(state.flags[CLICK_GUARD_FLAG]).toBeUndefined()
      }
    })
  }

  it('keeps the jittered streams inside the human CV band, well clear of the threshold', () => {
    // Human inter-click CV runs about 0.15 to 0.35; the guard trips under 0.05.
    for (const stream of HUMAN_STREAMS.slice(0, 4)) {
      for (const seed of SEEDS) {
        const times = stream.build(seed)
        const whole = cadence(intervalsOf(times)).cv
        expect(whole).toBeGreaterThan(0.12)
        expect(whole).toBeLessThan(0.35)
        // Not one 24-interval window anywhere in the stream comes close to the threshold.
        expect(tightestWindowCv(times)).toBeGreaterThan(CADENCE_MAX_CV * 1.5)
      }
    }
  })

  it('leaves the frenzy achievement reachable: 100 clicks paid inside its 10 second window', () => {
    for (const seed of SEEDS) {
      const state = fresh()
      const times = humanStream(T0, 100, 9800 / 99, 25, seed)
      const span = (times[times.length - 1] as number) - (times[0] as number)
      expect(span).toBeLessThan(10_000)
      expect(drive(state, times).every((v) => v.ok)).toBe(true)
    }
  })

  it('allows slow regularity: a flat 333 ms never trips even over hundreds of clicks', () => {
    const state = fresh()
    const times = metronome(T0, 400, 333)
    expect(refusals(drive(state, times))).toEqual([])
    expect(cadence(intervalsOf(times))).toEqual({ mean: 333, cv: 0 })
    expect(333).toBeGreaterThanOrEqual(CADENCE_MAX_MEAN_MS)
  })

  it('never touches the bank or the click counter', () => {
    const state = fresh()
    const credits = state.credits
    drive(state, metronome(T0, CLICK_RING, 100))
    expect(state.credits).toBe(credits)
    expect(state.totalClicks).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The hard rate cap
// ---------------------------------------------------------------------------

describe('rate cap', () => {
  it('pays 15 clicks in a second and refuses the 16th', () => {
    const state = fresh()
    const times = metronome(T0, CLICK_CAP_PER_SEC + 1, 10)
    const verdicts = drive(state, times)

    expect(verdicts.slice(0, CLICK_CAP_PER_SEC).every((v) => v.ok)).toBe(true)
    const last = verdicts[CLICK_CAP_PER_SEC] as Refusal
    expect(last.ok).toBe(false)
    expect(last.reason).toBe('rate')
    expect(last.until).toBe(T0 + CLICK_RATE_WINDOW_MS)
  })

  it('does not treat a refused click as a strike', () => {
    const state = fresh()
    drive(state, metronome(T0, CLICK_CAP_PER_SEC + 5, 10))
    expect(state.stats.clickStrikes).toBe(0)
    expect(state.stats.clickLockUntil).toBe(0)
    expect(state.flags[CLICK_GUARD_FLAG]).toBeUndefined()
  })

  it('accepts again as soon as the oldest counted click leaves the window', () => {
    const state = fresh()
    drive(state, metronome(T0, CLICK_CAP_PER_SEC, 10))

    const blocked = evaluateClick(state, T0 + CLICK_RATE_WINDOW_MS - 1) as Refusal
    expect(blocked.reason).toBe('rate')
    expect(blocked.until).toBe(T0 + CLICK_RATE_WINDOW_MS)
    expect(evaluateClick(state, T0 + CLICK_RATE_WINDOW_MS + 1)).toEqual({ ok: true })
  })

  it('starts refusing at 25 a second once 15 are on the clock, then calls the cadence', () => {
    const state = fresh()
    const verdicts = drive(state, metronome(T0, CLICK_RING, 40))

    expect(verdicts.slice(0, CLICK_CAP_PER_SEC).every((v) => v.ok)).toBe(true)
    for (let i = CLICK_CAP_PER_SEC; i < CLICK_RING - 1; i++) {
      expect(verdicts[i]).toEqual({ ok: false, reason: 'rate', until: T0 + CLICK_RATE_WINDOW_MS })
    }
    // The refused clicks still counted as attempts, so the tool cannot hide behind the cap.
    const last = verdicts[CLICK_RING - 1] as Refusal
    expect(last.reason).toBe('cadence')
    expect(state.stats.clickStrikes).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// True positives: machine cadence
// ---------------------------------------------------------------------------

describe('cadence strike', () => {
  it('trips on the 25th click of a 100 ms metronome, not before', () => {
    const state = fresh()
    const times = metronome(T0, CLICK_RING, 100)
    const verdicts = drive(state, times)

    expect(verdicts.slice(0, CLICK_RING - 1).every((v) => v.ok)).toBe(true)
    const strike = verdicts[CLICK_RING - 1] as Refusal
    const at = T0 + 100 * (CLICK_RING - 1)

    expect(strike).toEqual({ ok: false, reason: 'cadence', until: at + 10_000 })
    expect(state.stats.clickLockUntil).toBe(at + 10_000)
    expect(state.stats.clickStrikes).toBe(1)
    expect(state.stats.clickStrikeAt).toBe(at)
    expect(state.flags[CLICK_GUARD_FLAG]).toBe(true)
  })

  it('needs a full ring: 24 clicks at 100 ms trip nothing', () => {
    const state = fresh()
    expect(refusals(drive(state, metronome(T0, CADENCE_INTERVALS, 100)))).toEqual([])
    expect(state.stats.clickStrikes).toBe(0)
  })

  it('refuses every click inside the lock with the same deadline', () => {
    const state = fresh()
    const { at } = tripCadence(state, T0)
    const until = at + 10_000

    for (const t of [at + 1, at + 2_500, until - 1]) {
      expect(evaluateClick(state, t)).toEqual({ ok: false, reason: 'locked', until })
    }
    // Locked clicks are not recorded, so they cannot stack a second strike either.
    expect(state.stats.clickStrikes).toBe(1)
  })

  it('accepts a click one millisecond after the lock expires', () => {
    const state = fresh()
    const { at } = tripCadence(state, T0)
    expect(evaluateClick(state, at + 10_000 + 1)).toEqual({ ok: true })
  })

  it('lets a human carry on immediately after serving a lock', () => {
    const state = fresh()
    const { at } = tripCadence(state, T0)
    // One slot after the lock lifts, so even the earliest jitter lands clear of it.
    const resume = at + 10_000 + 100
    expect(refusals(drive(state, humanStream(resume, 300, 100, 32, 7)))).toEqual([])
    expect(state.stats.clickStrikes).toBe(1)
  })

  it('escalates 10, 30 then 60 seconds and holds at 60', () => {
    const state = fresh()
    const lengths: number[] = []
    let start = T0

    for (let i = 0; i < 4; i++) {
      const { at, lockoutMs } = tripCadence(state, start)
      lengths.push(lockoutMs)
      start = at + lockoutMs
    }

    expect(lengths).toEqual([...CLICK_LOCKOUT_MS, CLICK_LOCKOUT_MAX_MS])
    expect(state.stats.clickStrikes).toBe(4)
  })

  it('decays the strikes after five quiet minutes and starts again at 10 seconds', () => {
    const state = fresh()
    const first = tripCadence(state, T0)
    const second = tripCadence(state, first.at + first.lockoutMs)
    expect(second.lockoutMs).toBe(CLICK_LOCKOUT_MS[1])
    expect(state.stats.clickStrikes).toBe(2)

    // Quiet for the full decay window, measured to the moment of the next strike.
    const quietStart = second.at + CLICK_STRIKE_DECAY_MS - 100 * (CLICK_RING - 1)
    const third = tripCadence(state, quietStart)

    expect(third.at - second.at).toBe(CLICK_STRIKE_DECAY_MS)
    expect(third.lockoutMs).toBe(CLICK_LOCKOUT_MS[0])
    expect(state.stats.clickStrikes).toBe(1)
  })

  it('keeps escalating one millisecond short of the decay window', () => {
    const state = fresh()
    const first = tripCadence(state, T0)
    const quietStart = first.at + CLICK_STRIKE_DECAY_MS - 1 - 100 * (CLICK_RING - 1)
    const second = tripCadence(state, quietStart)

    expect(second.at - first.at).toBe(CLICK_STRIKE_DECAY_MS - 1)
    expect(second.lockoutMs).toBe(CLICK_LOCKOUT_MS[1])
    expect(state.stats.clickStrikes).toBe(2)
  })

  it('starts the next stretch from an empty ring', () => {
    const state = fresh()
    const { at } = tripCadence(state, T0)
    const resume = at + 10_000

    // 24 more metronome clicks are one short of a fresh ring, so nothing trips yet.
    expect(refusals(drive(state, metronome(resume, CADENCE_INTERVALS, 100)))).toEqual([])
    expect(state.stats.clickStrikes).toBe(1)
    const next = evaluateClick(state, resume + 100 * CADENCE_INTERVALS) as Refusal
    expect(next.reason).toBe('cadence')
  })

  it('catches a timer that hides two thirds of its clicks behind the cap', () => {
    const state = fresh()
    // 50 a second: only 15 of them can ever be paid, but all 25 are attempts.
    const verdicts = drive(state, metronome(T0, CLICK_RING, 20))
    expect((verdicts[CLICK_RING - 1] as Refusal).reason).toBe('cadence')
    expect(state.flags[CLICK_GUARD_FLAG]).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

describe('resetClickGuard', () => {
  it('clears the lockout, the strikes and the ring', () => {
    const state = fresh()
    const { at } = tripCadence(state, T0)

    resetClickGuard(state)
    expect(state.stats.clickLockUntil).toBe(0)
    expect(state.stats.clickStrikes).toBe(0)
    expect(state.stats.clickStrikeAt).toBe(0)

    // A click during what would have been the lock is accepted, and the ring starts over.
    expect(evaluateClick(state, at + 1)).toEqual({ ok: true })
    expect(refusals(drive(state, metronome(at + 101, CADENCE_INTERVALS - 1, 100)))).toEqual([])
  })

  it('does not raise the guard flag or invent a lock on a fresh state', () => {
    const state = fresh()
    resetClickGuard(state)
    expect(state.flags[CLICK_GUARD_FLAG]).toBeUndefined()
    expect(evaluateClick(state, T0)).toEqual({ ok: true })
  })
})

describe('robustness', () => {
  it('holds a lock loaded from a save, without ever having seen a click', () => {
    const state = fresh()
    state.stats.clickLockUntil = T0 + 7_000
    expect(evaluateClick(state, T0 + 1)).toEqual({ ok: false, reason: 'locked', until: T0 + 7_000 })
    expect(evaluateClick(state, T0 + 7_000)).toEqual({ ok: true })
  })

  it('starts the ring over when the clock steps backwards', () => {
    const state = fresh()
    drive(state, metronome(T0, CADENCE_INTERVALS, 100))
    // The clock jumps back an hour: the stale timestamps must not become negative intervals.
    expect(evaluateClick(state, T0 - 3_600_000)).toEqual({ ok: true })
    expect(state.stats.clickStrikes).toBe(0)
  })

  it('keeps each state guard to itself', () => {
    const a = fresh()
    const b = fresh()
    tripCadence(a, T0)
    expect(b.stats.clickStrikes).toBe(0)
    expect(evaluateClick(b, T0 + 100 * (CLICK_RING - 1) + 1)).toEqual({ ok: true })
  })
})
