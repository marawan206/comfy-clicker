/**
 * The bet bar's two clamps and the one figure a landed bet prints, pure so they can be pinned
 * without a DOM.
 *
 * `wagerFor` is the read-time clamp: the figure the engine is asked to stake, whatever is in the
 * box. `draftAfterBet` is the write-back: once a bet lands, the box follows the bank down so it
 * never promises a stake the slider cannot cover. It only ever comes down, so a player who typed
 * 100 with 3,000 in the bank keeps their 100 after a win. `betNet` is what the result line, the
 * history chip and the floating number all print: the net, never the gross payout, because a NaN
 * hands a quarter back and a quarter in green would read as a win.
 */

/** The wager as it will be staked: the draft floored, then clamped to `[min, max(min, max)]`. */
export function wagerFor(draft: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(draft) || 0, min), Math.max(min, max))
}

/**
 * The draft after the bank moved to `bank`. Never raised: pulled down to the bank when the bank
 * is under it, and to `min` when the bank cannot cover the smallest bet (an all-in loss lands
 * here), so the dead "come back with 10 credits" state has a legal figure behind it once the bank
 * recovers.
 */
export function draftAfterBet(draft: number, bank: number, min: number): number {
  const ceiling = Number.isFinite(bank) ? Math.max(min, Math.floor(bank)) : min
  return Number.isFinite(draft) ? Math.min(draft, ceiling) : ceiling
}

/**
 * What a landed bet moved the bank by: the payout less the stake. A free spin is the house's
 * stake, so nothing left the bank and the whole payout is the gain. This is the figure the wheel's
 * result line, the history chip and the floating number all print, and it is signed the same way
 * `stats.spinNet` is kept.
 */
export function betNet(payout: number, wager: number, free = false): number {
  return payout - (free ? 0 : wager)
}
