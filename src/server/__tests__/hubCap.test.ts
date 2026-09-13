/**
 * The bound on what a ComfyHub run may claim to have cost. `saves.cps` is a column the runner
 * writes themselves under RLS, so on its own it lets the person being capped choose the cap;
 * `profiles.created_at` is the one scalar about a player the server writes.
 */
import { describe, expect, it } from 'vitest'

import {
  HUB_CPS_CEILING,
  HUB_CPS_SEED,
  HUB_RUNS_PER_WORKFLOW_HOUR,
  accountAgeSec,
  plausibleCps,
  royaltyFor,
  runCostCap,
} from '@/server/hub'

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)
/** `scripts/balance.ts`, `climb` at 3 clicks/s: the fastest honest income the sim produces. */
const SIM_CURVE: [seconds: number, cps: number][] = [
  [300, 71],
  [900, 489_860],
  [1800, 14_414_817],
  [3600, 43_873_350],
  [86_400, 169_434_884],
  [604_800, 260_878_414],
]

/** What `recordRun` uses: the runner's own number, allowed to tighten the ceiling but never raise it. */
const trusted = (clientCps: number, ageSec: number): number => Math.min(clientCps, plausibleCps(ageSec))

describe('plausibleCps', () => {
  it('starts at the seed, only grows, and stops at the ceiling', () => {
    expect(plausibleCps(0)).toBe(HUB_CPS_SEED)
    expect(plausibleCps(-1e9)).toBe(HUB_CPS_SEED)
    expect(plausibleCps(Number.NaN)).toBe(HUB_CPS_SEED)
    let last = 0
    for (const age of [0, 60, 600, 3600, 86_400, 604_800]) {
      const cps = plausibleCps(age)
      expect(cps).toBeGreaterThanOrEqual(last)
      last = cps
    }
    expect(plausibleCps(1e9)).toBe(HUB_CPS_CEILING)
  })

  it('never clips an honest run', () => {
    for (const [seconds, cps] of SIM_CURVE) {
      expect(trusted(cps, seconds), `${seconds}s`).toBe(cps)
    }
  })
})

describe('accountAgeSec', () => {
  it('reads a timestamp and refuses to be talked into a bigger number', () => {
    expect(accountAgeSec(new Date(T0 - 3600_000).toISOString(), T0)).toBe(3600)
    expect(accountAgeSec(null, T0)).toBe(0)
    expect(accountAgeSec(undefined, T0)).toBe(0)
    expect(accountAgeSec('not a date', T0)).toBe(0)
    // A row stamped in the future is an account with no history, not an ancient one.
    expect(accountAgeSec(new Date(T0 + 86_400_000).toISOString(), T0)).toBe(0)
  })
})

describe('runCostCap', () => {
  it('grows with income and is zero for a model that does not exist', () => {
    expect(runCostCap('sd15', 'native', 0)).toBeGreaterThan(0)
    expect(runCostCap('sd15', 'native', 1e6)).toBeGreaterThan(runCostCap('sd15', 'native', 0))
    expect(runCostCap('no-such-model', 'native', 1e6)).toBe(0)
  })

  it('a fabricated cps buys nothing past what the account age allows', () => {
    // The repro: user B PATCHes their own saves row to cps 1e12 and posts a run.
    const fabricated = 1e12
    const dayOld = 86_400
    expect(trusted(fabricated, dayOld)).toBe(HUB_CPS_CEILING)
    expect(runCostCap('sd15', 'native', trusted(fabricated, dayOld))).toBe(runCostCap('sd15', 'native', HUB_CPS_CEILING))

    // And a brand new account gets the seed, not a trillion.
    expect(trusted(fabricated, 0)).toBe(HUB_CPS_SEED)
    expect(runCostCap('sd15', 'native', trusted(fabricated, 0))).toBeLessThan(runCostCap('sd15', 'native', fabricated))
  })

  it('the royalty is a fixed share of what survives the cap', () => {
    const cap = runCostCap('sd15', 'native', trusted(1e12, 0))
    expect(royaltyFor(Math.min(1e30, cap), false)).toBe(Math.round(cap * 0.05))
    expect(royaltyFor(cap, true)).toBe(0)
  })
})

describe('per-workflow rate limit', () => {
  it('is tighter than the per-runner one, so one account cannot pump one workflow', () => {
    expect(HUB_RUNS_PER_WORKFLOW_HOUR).toBeGreaterThan(0)
    // 40 runs a minute is 2400 an hour; without this a single runner owns the trending sort.
    expect(HUB_RUNS_PER_WORKFLOW_HOUR).toBeLessThan(60)
  })
})
