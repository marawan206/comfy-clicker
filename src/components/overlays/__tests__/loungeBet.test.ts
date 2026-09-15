import { describe, expect, it } from 'vitest'

import { betNet, draftAfterBet, wagerFor } from '@/components/overlays/loungeBet'
import { BET_MIN } from '@/game/constants'

/**
 * The bet bar's draft after a bet. The wager was always clamped on read, but the figure in the
 * box stayed where the player left it: bet 100, lose, and the box still said 100 over a bank of
 * 40. These pin the write-back that pulls it down, and only down.
 */
describe('draftAfterBet', () => {
  it('pulls a draft the bank can no longer cover down to the bank', () => {
    expect(draftAfterBet(100, 40, BET_MIN)).toBe(40)
    expect(draftAfterBet(1_000, 999, BET_MIN)).toBe(999)
  })

  it('never raises a draft', () => {
    expect(draftAfterBet(100, 3_000, BET_MIN)).toBe(100)
    expect(draftAfterBet(BET_MIN, 3_000, BET_MIN)).toBe(BET_MIN)
    expect(draftAfterBet(40, 40, BET_MIN)).toBe(40)
  })

  it('floors a fractional bank, the way betBounds does', () => {
    expect(draftAfterBet(100, 99.9, BET_MIN)).toBe(99)
  })

  it('lands on the minimum bet after an all-in loss', () => {
    expect(draftAfterBet(100, 0, BET_MIN)).toBe(BET_MIN)
    expect(draftAfterBet(100, 3, BET_MIN)).toBe(BET_MIN)
    // A draft already under the floor is left alone: it comes down, never up.
    expect(draftAfterBet(5, 0, BET_MIN)).toBe(5)
  })

  it('treats a broken bank as empty and a broken draft as the bank', () => {
    expect(draftAfterBet(100, Number.NaN, BET_MIN)).toBe(BET_MIN)
    expect(draftAfterBet(Number.NaN, 500, BET_MIN)).toBe(500)
  })
})

describe('wagerFor', () => {
  it('clamps the draft to the table', () => {
    expect(wagerFor(100, BET_MIN, 3_000)).toBe(100)
    expect(wagerFor(5_000, BET_MIN, 3_000)).toBe(3_000)
    expect(wagerFor(3, BET_MIN, 3_000)).toBe(BET_MIN)
    expect(wagerFor(99.9, BET_MIN, 3_000)).toBe(99)
    expect(wagerFor(Number.NaN, BET_MIN, 3_000)).toBe(BET_MIN)
  })

  it('sits on the floor when the bank is under it', () => {
    expect(wagerFor(100, BET_MIN, 0)).toBe(BET_MIN)
  })
})

describe('betNet', () => {
  it('is the payout less the stake, so a NaN prints as the loss it is', () => {
    // Bet 1,000, land NaN: the engine pays 250 back. The line must read -750, not +250.
    expect(betNet(250, 1_000)).toBe(-750)
    expect(betNet(500, 1_000)).toBe(-500)
    expect(betNet(1_000, 1_000)).toBe(0)
    expect(betNet(2_000, 1_000)).toBe(1_000)
  })

  it('counts the whole payout on a free spin, where nothing left the bank', () => {
    expect(betNet(50, 200, true)).toBe(50)
    expect(betNet(400, 200, true)).toBe(400)
  })

  it('reads a lost flip as the stake gone and a won one as the stake again', () => {
    expect(betNet(0, 100)).toBe(-100)
    expect(betNet(200, 100)).toBe(100)
  })
})

describe('after a full loss', () => {
  it('the box, the slider and All in say the same number', () => {
    // Bet 1,000 of 1,250 and lose the lot: the bank is 250. The slider shows `wagerFor`, the box
    // shows the draft, and All in stakes the bank. All three must agree.
    const bank = 250
    const draft = draftAfterBet(1_000, bank, BET_MIN)
    expect(draft).toBe(bank)
    expect(wagerFor(draft, BET_MIN, bank)).toBe(bank)
    expect(wagerFor(bank, BET_MIN, bank)).toBe(draft)
  })

  it('the box shows the minimum when the bank cannot cover it', () => {
    const draft = draftAfterBet(1_000, 0, BET_MIN)
    expect(draft).toBe(BET_MIN)
    expect(wagerFor(draft, BET_MIN, 0)).toBe(BET_MIN)
  })
})
