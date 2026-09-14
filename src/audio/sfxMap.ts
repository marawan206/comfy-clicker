/**
 * The sound map: pure data and pure functions, no Web Audio and no DOM. Everything here runs in
 * node so the event coverage, the click limiter and the synth fallbacks are testable without a
 * browser. `sfxEngine.ts` is the only module that touches an AudioContext.
 *
 * Two rules shape the numbers below:
 *  1. The click is the sound a player hears hundreds of times a minute, so it sits low in the mix
 *     (BASE_GAIN.click) and its pitch rises with the combo. A flat, repeated sample is the fastest
 *     way to make a clicker unbearable.
 *  2. Every name has a synth recipe, so an empty `public/sfx` still sounds like a game rather than
 *     silence. A file that 404s or fails to decode falls back to its recipe for the session.
 */
import type { GameEvent } from '@/game/types'
import type { ToastTone } from '@/components/overlays/useToasts'

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Exactly the files in `public/sfx`. A test asserts the folder and this list stay in step. */
export const SFX_NAMES = [
  'achievement',
  'breaker',
  'cash',
  'click',
  'contract',
  'daily',
  'egg',
  'error',
  'flop',
  'jackpot',
  'levelup',
  'lose',
  'purchase',
  'spin',
  'tick',
  'toast',
  'viral',
  'whoosh',
] as const

export type SfxName = (typeof SFX_NAMES)[number]

/** Folder the mp3s are served from. */
export const SFX_URL_BASE = '/sfx'

export const sfxUrl = (name: SfxName): string => `${SFX_URL_BASE}/${name}.mp3`

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

/**
 * One sound to play. `rate` multiplies playback speed (and the synth's pitch), `gain` multiplies
 * the name's base gain. `then` chains a follow-up after its own `delayMs`, which is how the
 * two-part cues (whoosh into cash, cash into achievement) are expressed without the engine
 * needing a scheduler.
 */
export interface Cue {
  name: SfxName
  rate?: number
  gain?: number
  /** Milliseconds to wait before sounding. Only meaningful on a chained cue. */
  delayMs?: number
  then?: Cue
}

/** Everything `cueForEvent` needs that the event itself does not carry. */
export interface CueContext {
  /** Current click combo, counted by `useSfx`. Drives the pitch ramp. */
  combo?: number
  /** True when the granted achievement is a hidden one (those get the easter-egg sting). */
  hiddenAchievement?: boolean
  /**
   * True under reduced motion. The Lounge then lands a bet in the same instant it is placed, so
   * the toss and the ticking reel have nothing to cover and the landing cue carries the whole bet.
   */
  reducedMotion?: boolean
}

/**
 * Per-name gain before the master volume. Big moments sit above the chatter. This is the mix
 * intent and it applies to the synth recipes as much as to the files; a file that was mastered
 * off the others is corrected in SAMPLE_TRIM, not here.
 */
export const BASE_GAIN: Record<SfxName, number> = {
  achievement: 0.8,
  breaker: 0.65,
  cash: 0.6,
  click: 0.25,
  contract: 0.7,
  daily: 0.7,
  egg: 0.7,
  error: 0.5,
  flop: 0.6,
  jackpot: 0.85,
  levelup: 0.8,
  lose: 0.6,
  purchase: 0.55,
  spin: 0.55,
  tick: 0.4,
  toast: 0.5,
  viral: 0.8,
  whoosh: 0.45,
}

/**
 * Gain applied on top of BASE_GAIN when the recorded file plays, and only then. The files were
 * not mastered to one level: measured integrated loudness (ffmpeg ebur128) puts most of the set
 * between -14 and -23 LUFS, `flop.mp3` at -9.2 and `lose.mp3` at -8.7, so at an equal gain a lost
 * coin flip landed about 13 dB louder than a won one (`cash.mp3` is -22.0). These two trims pull
 * the files down to the level their recipes already sit at, beside `error` and `egg` in the mix
 * rather than above the jackpot.
 */
export const SAMPLE_TRIM: Partial<Record<SfxName, number>> = { lose: 0.4, flop: 0.55 }

/** While one of these plays, the click drops to CLICK_DUCK so the payoff is audible over it. */
export const DUCKERS: readonly SfxName[] = ['achievement', 'viral', 'levelup', 'jackpot']

/** Click gain multiplier while a ducking sound is playing. */
export const CLICK_DUCK = 0.5
/** Clicks allowed per second (token bucket). */
export const CLICK_LIMIT_PER_SEC = 20
/** Clicks allowed to overlap; past this the oldest click voice is cut. */
export const CLICK_MAX_OVERLAP = 3
/** Random pitch spread applied to every click so a held-down combo does not turn into a buzzsaw. */
export const CLICK_DETUNE = 0.02
/** Hard cap on live sources. The oldest is stopped when a new one would exceed it. */
export const MAX_VOICES = 8

/**
 * Minimum gap between two plays of the same name. Only the alarm needs one: a blocked click can
 * fire on every press, and two per second is already plenty of "stop that".
 */
export const MIN_GAP_MS: Partial<Record<SfxName, number>> = { error: 500 }

// ---------------------------------------------------------------------------
// Combo pitch and the click limiter
// ---------------------------------------------------------------------------

/** Clicks counted into the pitch ramp before it flattens out. */
export const COMBO_RATE_CAP = 50
const COMBO_RATE_STEP = 0.006

/** Playback rate for a click at `combo`: 1.0 alone, rising to 1.3 at a 50 click streak. */
export function comboRate(combo: number): number {
  const n = Math.min(Math.max(combo, 0), COMBO_RATE_CAP)
  return 1 + n * COMBO_RATE_STEP
}

/**
 * Token bucket. A human tops out around 12 clicks a second; 20 leaves headroom for a good burst
 * and still refuses to schedule 200 sources when something goes wrong.
 */
export class ClickLimiter {
  private tokens: number
  private last = 0

  constructor(
    private readonly perSecond: number = CLICK_LIMIT_PER_SEC,
    private readonly burst: number = perSecond,
  ) {
    this.tokens = burst
  }

  /** True when this click may sound. `now` is epoch or performance ms; only deltas are used. */
  allow(now: number): boolean {
    const dt = Math.max(0, now - this.last) / 1000
    this.last = now
    this.tokens = Math.min(this.burst, this.tokens + dt * this.perSecond)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  reset(): void {
    this.tokens = this.burst
    this.last = 0
  }
}

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

const cue = (name: SfxName, rate?: number, gain?: number): Cue => {
  const c: Cue = { name }
  if (rate !== undefined) c.rate = rate
  if (gain !== undefined) c.gain = gain
  return c
}

/** Two ticks in a row: the "something changed in the world" stinger. */
const doubleTick = (): Cue => ({ name: 'tick', gain: 0.6, then: { name: 'tick', gain: 0.6, rate: 1.1, delayMs: 110 } })

function assertNever(value: never): null {
  void value
  return null
}

/**
 * The one place an engine event becomes a sound. The `never` default means a new `GameEvent`
 * member fails the build until someone decides what it sounds like (or that it is silent).
 */
export function cueForEvent(event: GameEvent, ctx: CueContext = {}): Cue | null {
  switch (event.type) {
    case 'click':
      return cue('click', comboRate(ctx.combo ?? 0))

    case 'clickBlocked':
      // Throttled to two per second by MIN_GAP_MS.error.
      return cue('error')

    case 'purchase':
      return event.count >= 10
        ? { name: 'purchase', then: { name: 'purchase', rate: 1.12, delayMs: 90 } }
        : cue('purchase')

    case 'upgrade':
      return cue('purchase', 1.12)

    case 'mapUnlock':
      return { name: 'whoosh', then: { name: 'cash', delayMs: 120 } }

    case 'jobStarted':
      return cue('tick', undefined, 0.5)

    case 'postCreated':
      return cue('whoosh', undefined, 0.6)

    case 'postResolved':
      if (event.viral) return cue('viral')
      if (event.ratioed) return cue('lose')
      if (event.flop) return cue('flop')
      return cue('cash', undefined, 0.5)

    case 'achievement':
      return cue(ctx.hiddenAchievement ? 'egg' : 'achievement')

    case 'levelUp':
      return cue('levelup')

    case 'offline':
      // Fires while the tab is still catching up, before any gesture has unlocked audio.
      return null

    case 'contractDone':
      return cue('contract')

    case 'eventStart':
      switch (event.kind) {
        case 'nodeBroke':
        case 'spotReclaim':
          return cue('error')
        case 'powerSurge':
          return cue('breaker')
        case 'trendingSpark':
          return cue('egg', 1.2)
        default:
          return doubleTick()
      }

    case 'eventEnd':
      return event.kind === 'nodeBroke' ? cue('cash') : null

    case 'daily':
      return cue('daily')

    case 'rebrand':
      return cue('levelup', 0.8)

    case 'powerThrottle':
      return event.on ? cue('breaker') : cue('cash', 0.8)

    case 'signup':
      return cue('cash', 1.2)

    case 'weekRollover':
      return doubleTick()

    case 'easterEgg':
      return cue('egg')

    case 'milestone':
      return cue('levelup', 0.9)

    // A bet sounds twice. The engine event is the moment the roll is decided, but the Lounge is
    // still scrambling the seed or turning the coin, so here it is only the sampler ticking or the
    // toss, the same for a win and a loss. The payoff is `cueForLanding`, played by the Lounge
    // when the animation lands, so the sound never says what the screen has not said yet. Under
    // reduced motion there is no animation to cover, so the landing is the whole sound.
    case 'spin':
      // Sped up so the ticking runs out roughly when the seed settles.
      return ctx.reducedMotion ? null : cue('spin', 1.5, 0.9)

    case 'flip':
      return ctx.reducedMotion ? null : cue('whoosh', 1.5, 0.6)

    // A citizen running your workflow is a background hum, not an event: the royalty lands in the
    // counter and the activity list says who it was. Silence on purpose.
    case 'citizenRun':
      return null

    case 'reward':
      return { name: 'cash', then: { name: 'achievement', delayMs: 150 } }

    default:
      return assertNever(event)
  }
}

/** A bet at the moment its result reaches the screen. */
export type BetLanding = { table: 'wheel'; mult: number } | { table: 'coin'; won: boolean }

/** Wheel multiplier from which the landing gets the jackpot fanfare. */
export const JACKPOT_MULT = 10

/**
 * The payoff half of a bet. `cueForEvent` covers the toss and the ticking reel; this is what the
 * Lounge plays when the coin or the seed actually lands. Under reduced motion it is the only
 * sound the bet makes. The wheel's `mult` is what was paid per credit staked, hot sampler
 * included, not the segment's printed figure.
 */
export function cueForLanding(landing: BetLanding): Cue {
  if (landing.table === 'coin') return landing.won ? cue('cash', 1.1) : cue('lose', undefined, 0.7)
  const { mult } = landing
  if (mult >= JACKPOT_MULT) return cue('jackpot')
  if (mult > 1) return cue('cash')
  // Same seed, same image: the stake comes back and nothing else happens.
  if (mult === 1) return cue('tick', undefined, 0.6)
  // Half back is a smaller, shorter sting than a NaN.
  return mult > 0 ? cue('lose', 1.15, 0.5) : cue('lose', undefined, 0.8)
}

/**
 * Toast sound by tone. `ToastHost` calls this when a card mounts unless the toast passed
 * `sound: false`, which is what every toast raised from an engine event does (the event already
 * sounded, and a double play is the fastest way to make the whole thing feel cheap).
 */
export function cueForToast(tone: ToastTone): Cue {
  switch (tone) {
    case 'danger':
      return cue('error')
    case 'credits':
      return cue('cash', undefined, 0.5)
    default:
      return cue('toast', undefined, 0.4)
  }
}

// ---------------------------------------------------------------------------
// Synth fallbacks
// ---------------------------------------------------------------------------

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle'
export type NoiseFilter = 'lowpass' | 'highpass' | 'bandpass'

interface LayerBase {
  /** Seconds from the start of the cue. */
  at?: number
  /** Seconds of fade in. Defaults to 4 ms, enough to kill the click at the start of a ramp. */
  attack?: number
  /** Seconds of fade out after the attack. */
  decay: number
  /** Peak gain of this layer, before the name's base gain and the master. */
  gain: number
}

export interface ToneLayer extends LayerBase {
  kind: 'tone'
  wave: Wave
  freq: number
  /** Glide target over the layer's life. Defaults to `freq`. */
  toFreq?: number
}

export interface NoiseLayer extends LayerBase {
  kind: 'noise'
  filter: NoiseFilter
  freq: number
  toFreq?: number
  q?: number
}

export type RecipeLayer = ToneLayer | NoiseLayer

export interface Recipe {
  /** Seconds the whole cue occupies. Also the window a ducking sound ducks the click for. */
  duration: number
  layers: RecipeLayer[]
}

const tone = (wave: Wave, freq: number, decay: number, gain: number, at = 0, toFreq?: number): ToneLayer => {
  const layer: ToneLayer = { kind: 'tone', wave, freq, decay, gain, at }
  if (toFreq !== undefined) layer.toFreq = toFreq
  return layer
}

const noise = (filter: NoiseFilter, freq: number, decay: number, gain: number, at = 0, toFreq?: number): NoiseLayer => {
  const layer: NoiseLayer = { kind: 'noise', filter, freq, decay, gain, at }
  if (toFreq !== undefined) layer.toFreq = toFreq
  return layer
}

/** An ascending run of sine partials: the shape every celebratory cue is built from. */
const arp = (freqs: number[], step: number, decay: number, gain: number, wave: Wave = 'sine'): ToneLayer[] =>
  freqs.map((f, i) => tone(wave, f, decay, gain, i * step))

/**
 * A synthesized stand-in for every name. These are deliberately plain: they exist so a missing or
 * undecodable file degrades to something with the right length and the right emotional sign, not
 * so they compete with the recorded set.
 */
export const RECIPES: Record<SfxName, Recipe> = {
  click: {
    duration: 0.1,
    layers: [tone('square', 900, 0.05, 0.5, 0, 460), noise('highpass', 3800, 0.02, 0.18)],
  },
  tick: {
    duration: 0.08,
    layers: [tone('square', 1240, 0.04, 0.32)],
  },
  toast: {
    duration: 0.3,
    layers: [tone('sine', 660, 0.16, 0.4), tone('sine', 988, 0.18, 0.32, 0.07)],
  },
  error: {
    duration: 0.26,
    layers: [tone('square', 220, 0.18, 0.42, 0, 150), tone('square', 110, 0.2, 0.3, 0.02)],
  },
  whoosh: {
    duration: 0.4,
    layers: [noise('bandpass', 420, 0.34, 0.42, 0, 3200)],
  },
  cash: {
    duration: 0.45,
    layers: [tone('sine', 1319, 0.24, 0.4), tone('sine', 1760, 0.26, 0.34, 0.06), tone('sine', 2637, 0.22, 0.2, 0.12)],
  },
  purchase: {
    duration: 0.45,
    layers: [
      noise('lowpass', 900, 0.07, 0.3),
      tone('triangle', 330, 0.12, 0.42, 0, 660),
      tone('triangle', 880, 0.24, 0.28, 0.1),
    ],
  },
  contract: {
    duration: 0.6,
    layers: [...arp([523, 659, 784], 0.08, 0.3, 0.34), tone('sine', 1047, 0.34, 0.24, 0.24)],
  },
  daily: {
    duration: 0.45,
    layers: [tone('triangle', 587, 0.24, 0.4), tone('triangle', 880, 0.28, 0.32, 0.09)],
  },
  egg: {
    duration: 0.55,
    layers: arp([440, 554, 659, 880], 0.06, 0.22, 0.3, 'square'),
  },
  flop: {
    duration: 0.65,
    layers: [tone('sawtooth', 300, 0.5, 0.34, 0, 80), noise('lowpass', 320, 0.4, 0.22, 0.04)],
  },
  lose: {
    duration: 0.65,
    layers: [tone('sawtooth', 392, 0.36, 0.32, 0, 196), tone('sawtooth', 262, 0.4, 0.3, 0.14, 131)],
  },
  spin: {
    duration: 1.05,
    layers: [0, 0.09, 0.19, 0.31, 0.46, 0.64, 0.86].map((at) => tone('square', 900, 0.04, 0.26, at)),
  },
  breaker: {
    duration: 0.85,
    layers: [
      tone('sine', 130, 0.5, 0.6, 0, 48),
      tone('square', 62, 0.55, 0.22, 0.02),
      noise('lowpass', 220, 0.3, 0.3),
    ],
  },
  achievement: {
    duration: 0.95,
    layers: [...arp([523, 659, 784, 1047], 0.08, 0.38, 0.34), tone('sine', 1568, 0.44, 0.26, 0.32)],
  },
  levelup: {
    duration: 1.15,
    layers: [
      ...arp([440, 554, 659, 880, 1109], 0.07, 0.44, 0.32),
      noise('bandpass', 600, 0.5, 0.16, 0, 4200),
      tone('sine', 1319, 0.5, 0.24, 0.36),
    ],
  },
  viral: {
    duration: 0.95,
    layers: [
      tone('sine', 660, 0.5, 0.36, 0, 1760),
      ...arp([880, 1109, 1319], 0.09, 0.34, 0.26),
      noise('bandpass', 900, 0.4, 0.14, 0.1, 5000),
    ],
  },
  jackpot: {
    duration: 1.25,
    layers: [
      ...arp([1047, 1319, 1568, 2093], 0.07, 0.4, 0.3),
      ...arp([1047, 1319, 1568, 2093], 0.07, 0.4, 0.26).map((l) => ({ ...l, at: (l.at ?? 0) + 0.34 })),
      noise('highpass', 5000, 0.5, 0.12, 0.3),
    ],
  },
}
