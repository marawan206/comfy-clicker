/**
 * The click guard, tested in both directions.
 *
 * The critical property is asymmetric: capping a burst is fine, punishing a human is a bug. So the
 * false-positive half runs real generated streams (mulberry32, several seeds) that look like a
 * hand on a mouse, and demands *zero* refusals from every one of them, including the 100 clicks in
 * under 10 seconds that the "Batch Size: Yes" achievement needs. There is no cadence detector any
 * more, so a metronome is judged on its rate alone, and the only thing a refusal ever writes is
 * the `clickGuard` flag behind "Rate Limited".
 */
import { describe, expect, it } from 'vitest'
import {
  CLICK_GUARD_FLAG,
  CLICK_RATE_WINDOW_MS,
  evaluateClick,
  resetClickGuard,
  type ClickVerdict,
} from '@/game/clickGuard'
import { CLICK_CAP_PER_SEC } from '@/game/constants'
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

/** A timer: perfectly regular. Only its rate matters now. */
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

/** The three legacy lockout fields, which nothing writes any more. */
function expectNoLockout(state: GameState): void {
  expect(state.stats.clickLockUntil).toBe(0)
  expect(state.stats.clickStrikes).toBe(0)
  expect(state.stats.clickStrikeAt).toBe(0)
}

// ---------------------------------------------------------------------------
// False positives: a real hand is never refused
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
    name: '150 clicks around 150 ms',
    build: (seed) => humanStream(T0, 150, 150, 32, seed),
  },
  {
    name: '25 clicks at a flat 100 ms, a metronome at half the cap',
    build: () => metronome(T0, 25, 100),
  },
  {
    name: '95 clicks at a flat 53 ms, a metronome one click under the cap',
    build: () => metronome(T0, 95, 53),
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
        expectNoLockout(state)
        expect(state.flags[CLICK_GUARD_FLAG]).toBeUndefined()
      }
    })
  }

  it('leaves the frenzy achievement reachable: 100 clicks paid inside its 10 second window', () => {
    for (const seed of SEEDS) {
      const state = fresh()
      const times = humanStream(T0, 100, 9800 / 99, 25, seed)
      const span = (times[times.length - 1] as number) - (times[0] as number)
      expect(span).toBeLessThan(10_000)
      expect(drive(state, times).every((v) => v.ok)).toBe(true)
    }
  })

  it('has no opinion on regularity: a flat 100 ms never trips, however long it runs', () => {
    const state = fresh()
    expect(refusals(drive(state, metronome(T0, 400, 100)))).toEqual([])
    expect(state.flags[CLICK_GUARD_FLAG]).toBeUndefined()
  })

  it('never touches the bank or the click counter, even past the cap', () => {
    const state = fresh()
    const credits = state.credits
    drive(state, metronome(T0, CLICK_CAP_PER_SEC + 5, 10))
    expect(state.credits).toBe(credits)
    expect(state.totalClicks).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The rate cap
// ---------------------------------------------------------------------------

describe('rate cap', () => {
  it('pays 20 clicks in a second and refuses the 21st with rate, moving nothing', () => {
    expect(CLICK_CAP_PER_SEC).toBe(20)
    const state = fresh()
    const times = metronome(T0, CLICK_CAP_PER_SEC + 1, 10)
    const verdicts = drive(state, times)

    expect(verdicts.slice(0, CLICK_CAP_PER_SEC).every((v) => v.ok)).toBe(true)
    const last = verdicts[CLICK_CAP_PER_SEC] as Refusal
    expect(last).toEqual({ ok: false, reason: 'rate', until: T0 + CLICK_RATE_WINDOW_MS })
    expectNoLockout(state)
    expect(state.totalClicks).toBe(0)
  })

  it('raises the clickGuard flag on the first refusal and not before', () => {
    const state = fresh()
    drive(state, metronome(T0, CLICK_CAP_PER_SEC, 10))
    expect(state.flags[CLICK_GUARD_FLAG]).toBeUndefined()

    expect(evaluateClick(state, T0 + 500).ok).toBe(false)
    expect(state.flags[CLICK_GUARD_FLAG]).toBe(true)
  })

  it('does not treat a refused click as a strike: no lockout, nothing escalates', () => {
    const state = fresh()
    const verdicts = drive(state, metronome(T0, CLICK_CAP_PER_SEC + 5, 10))
    const refused = refusals(verdicts)

    expect(refused).toHaveLength(5)
    for (const r of refused) expect(r).toEqual({ ok: false, reason: 'rate', until: T0 + CLICK_RATE_WINDOW_MS })
    expectNoLockout(state)
  })

  it('pays again the moment the oldest counted click leaves the window', () => {
    const state = fresh()
    drive(state, metronome(T0, CLICK_CAP_PER_SEC, 10))

    const blocked = evaluateClick(state, T0 + CLICK_RATE_WINDOW_MS - 1) as Refusal
    expect(blocked.reason).toBe('rate')
    expect(blocked.until).toBe(T0 + CLICK_RATE_WINDOW_MS)
    // `until` is not a lockout: it is exactly the first moment the next click counts.
    expect(evaluateClick(state, blocked.until)).toEqual({ ok: true })
  })

  it('pays a 25 a second metronome up to the cap and never locks it out', () => {
    const state = fresh()
    // Two seconds at 40 ms: 25 attempts a second, 20 of which can be paid.
    const verdicts = drive(state, metronome(T0, 50, 40))

    const firstSecond = verdicts.slice(0, 25)
    expect(firstSecond.filter((v) => v.ok)).toHaveLength(CLICK_CAP_PER_SEC)
    expect(firstSecond.slice(0, CLICK_CAP_PER_SEC).every((v) => v.ok)).toBe(true)
    // Refused clicks are not counted, so at T0 + 1000 the first counted click has left the
    // window and the button pays again.
    expect(verdicts[25]).toEqual({ ok: true })
    for (const r of refusals(verdicts)) expect(r.reason).toBe('rate')
    expectNoLockout(state)
    // Well after the burst, the button is exactly as it was.
    expect(evaluateClick(state, T0 + 5_000)).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

describe('resetClickGuard', () => {
  it('empties the window and zeroes the legacy fields', () => {
    const state = fresh()
    drive(state, metronome(T0, CLICK_CAP_PER_SEC, 10))
    expect(evaluateClick(state, T0 + 500).ok).toBe(false)
    // Junk an old save might still carry.
    state.stats.clickLockUntil = T0 + 9_000
    state.stats.clickStrikes = 2
    state.stats.clickStrikeAt = T0

    resetClickGuard(state)
    expectNoLockout(state)
    expect(evaluateClick(state, T0 + 501)).toEqual({ ok: true })
  })

  it('does not raise the guard flag or invent a refusal on a fresh state', () => {
    const state = fresh()
    resetClickGuard(state)
    expect(state.flags[CLICK_GUARD_FLAG]).toBeUndefined()
    expect(evaluateClick(state, T0)).toEqual({ ok: true })
  })
})

describe('robustness', () => {
  it('ignores a lockout carried by a save from before the cap', () => {
    const state = fresh()
    state.stats.clickLockUntil = T0 + 7_000
    state.stats.clickStrikes = 3
    expect(evaluateClick(state, T0 + 1)).toEqual({ ok: true })
  })

  it('starts the window over when the clock steps backwards', () => {
    const state = fresh()
    drive(state, metronome(T0, CLICK_CAP_PER_SEC, 10))
    expect(evaluateClick(state, T0 + 200).ok).toBe(false)
    // The clock jumps back an hour: the counted clicks must not sit in a window that never ends.
    const back = T0 - 3_600_000
    expect(evaluateClick(state, back)).toEqual({ ok: true })
    expect(refusals(drive(state, metronome(back + 10, CLICK_CAP_PER_SEC - 1, 10)))).toEqual([])
  })

  it('keeps each state guard to itself', () => {
    const a = fresh()
    const b = fresh()
    drive(a, metronome(T0, CLICK_CAP_PER_SEC, 10))
    expect(evaluateClick(a, T0 + 300).ok).toBe(false)
    expect(evaluateClick(b, T0 + 300)).toEqual({ ok: true })
    expect(b.flags[CLICK_GUARD_FLAG]).toBeUndefined()
  })
})
