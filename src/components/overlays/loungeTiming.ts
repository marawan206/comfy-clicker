/**
 * How long the Lounge keeps a result off screen after the engine has decided it. The engine
 * settles a bet the instant it is placed; these are the reveal delays the modal animates through,
 * shared so that nothing else in the UI (the jackpot toast, for one) speaks before the reel does.
 */

/** The seed scrambles for this long before it settles and the result line appears. */
export const SCRAMBLE_MS = 1_600
/** The coin turns for this long before it shows a face. */
export const FLIP_MS = 900
