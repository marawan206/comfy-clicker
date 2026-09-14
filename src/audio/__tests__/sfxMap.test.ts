import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BASE_GAIN,
  CLICK_LIMIT_PER_SEC,
  ClickLimiter,
  DUCKERS,
  MIN_GAP_MS,
  RECIPES,
  SAMPLE_TRIM,
  SFX_NAMES,
  comboRate,
  JACKPOT_MULT,
  cueForEvent,
  cueForLanding,
  cueForToast,
  sfxUrl,
  type BetLanding,
  type Cue,
  type SfxName,
} from '../sfxMap'
import type { GameEvent } from '@/game/types'

const SFX_DIR = fileURLToPath(new URL('../../../public/sfx/', import.meta.url))

/**
 * Every `GameEvent['type']`, written out. The map itself is an exhaustive switch, so a new event
 * type already fails `tsc`; this list plus the `Record<GameEvent['type'], ...>` below is what makes
 * it fail the test run too, instead of quietly shipping a silent event.
 */
const EVENT_TYPES = [
  'click',
  'purchase',
  'upgrade',
  'mapUnlock',
  'jobStarted',
  'postCreated',
  'postResolved',
  'achievement',
  'offline',
  'contractDone',
  'eventStart',
  'eventEnd',
  'daily',
  'rebrand',
  'powerThrottle',
  'signup',
  'weekRollover',
  'easterEgg',
  'milestone',
  'levelUp',
  'clickBlocked',
  'spin',
  'flip',
  'citizenRun',
  'reward',
] as const

/** One or more representative events per type. A missing key is a compile error. */
const SAMPLES: Record<GameEvent['type'], GameEvent[]> = {
  click: [{ type: 'click', value: 12 }, { type: 'click', value: 40, lucky: true }],
  purchase: [
    { type: 'purchase', hardwareId: 'rtx4090', count: 1 },
    { type: 'purchase', hardwareId: 'rtx4090', count: 10 },
  ],
  upgrade: [{ type: 'upgrade', id: 'better-mouse' }],
  mapUnlock: [{ type: 'mapUnlock', id: 'api-nodes' }],
  jobStarted: [{ type: 'jobStarted', jobId: 'j1' }],
  postCreated: [{ type: 'postCreated', postId: 'p1' }],
  postResolved: [
    { type: 'postResolved', postId: 'p1', viral: true, flop: false, ratioed: false },
    { type: 'postResolved', postId: 'p2', viral: false, flop: false, ratioed: true },
    { type: 'postResolved', postId: 'p3', viral: false, flop: true, ratioed: false },
    { type: 'postResolved', postId: 'p4', viral: false, flop: false, ratioed: false },
  ],
  achievement: [{ type: 'achievement', id: 'first-click', reward: 0 }],
  offline: [{ type: 'offline', gain: 1200, elapsedSec: 600 }],
  contractDone: [{ type: 'contractDone', defId: 'c1' }],
  eventStart: [
    { type: 'eventStart', defId: 'e1', kind: 'nodeBroke' },
    { type: 'eventStart', defId: 'e2', kind: 'spotReclaim' },
    { type: 'eventStart', defId: 'e3', kind: 'powerSurge' },
    { type: 'eventStart', defId: 'e4', kind: 'trendingSpark' },
    { type: 'eventStart', defId: 'e5', kind: 'modelDrop' },
    { type: 'eventStart', defId: 'e6', kind: 'founderRepost' },
    { type: 'eventStart', defId: 'e7', kind: 'cloudPromo' },
  ],
  eventEnd: [
    { type: 'eventEnd', defId: 'e1', kind: 'nodeBroke' },
    { type: 'eventEnd', defId: 'e5', kind: 'modelDrop' },
  ],
  daily: [{ type: 'daily', day: 3, credits: 500 }],
  rebrand: [{ type: 'rebrand', cp: 4 }],
  powerThrottle: [
    { type: 'powerThrottle', on: true },
    { type: 'powerThrottle', on: false },
  ],
  signup: [{ type: 'signup', total: 12 }],
  weekRollover: [{ type: 'weekRollover', tags: ['wan'] }],
  easterEgg: [{ type: 'easterEgg', id: 'konami' }],
  milestone: [{ type: 'milestone', cps: 1000 }],
  levelUp: [{ type: 'levelUp', level: 4, credits: 1000, unlocked: ['flux'] }],
  clickBlocked: [{ type: 'clickBlocked', reason: 'rate', until: 0 }],
  spin: [
    { type: 'spin', outcome: 'seed42', mult: 42, wager: 100, payout: 4200, free: false, hot: true },
    { type: 'spin', outcome: 'dud', mult: 0, wager: 100, payout: 0, free: false, hot: false },
    { type: 'spin', outcome: 'small', mult: 2, wager: 100, payout: 200, free: true, hot: false },
  ],
  flip: [
    { type: 'flip', side: 'you', wager: 100, payout: 200, streak: 2 },
    { type: 'flip', side: 'comfy', wager: 100, payout: 0, streak: 0 },
  ],
  citizenRun: [{ type: 'citizenRun', handle: 'latent_goblin', workflowName: 'Hands, fixed', credits: 42 }],
  reward: [{ type: 'reward', id: 'title-click', credits: 1000 }],
}

const names = new Set<string>(SFX_NAMES)

function walk(cue: Cue, out: Cue[] = []): Cue[] {
  out.push(cue)
  if (cue.then) walk(cue.then, out)
  return out
}

describe('sfxMap: event coverage', () => {
  it('lists every GameEvent type exactly once', () => {
    expect([...EVENT_TYPES].sort()).toEqual(Object.keys(SAMPLES).sort())
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length)
  })

  it('samples are filed under their own type', () => {
    for (const [type, list] of Object.entries(SAMPLES)) {
      expect(list.length).toBeGreaterThan(0)
      for (const event of list) expect(event.type).toBe(type)
    }
  })

  it('returns a cue or null for every event type, and never an unknown name', () => {
    for (const type of EVENT_TYPES) {
      for (const event of SAMPLES[type]) {
        const cue = cueForEvent(event)
        expect(cue === null || typeof cue === 'object').toBe(true)
        if (!cue) continue
        for (const part of walk(cue)) {
          expect(names.has(part.name)).toBe(true)
          if (part.rate !== undefined) expect(part.rate).toBeGreaterThan(0)
          if (part.gain !== undefined) expect(part.gain).toBeGreaterThan(0)
        }
      }
    }
  })

  it('maps the payoff events the way the spec describes', () => {
    const solo = cueForEvent(SAMPLES.click[0] as GameEvent)
    expect(solo?.name).toBe('click')
    expect(solo?.rate).toBe(1)
    // Floating point: 50 * 0.006 is not exactly 0.3, and the ear does not care.
    expect(cueForEvent(SAMPLES.click[0] as GameEvent, { combo: 50 })?.rate).toBeCloseTo(1.3, 10)
    expect(cueForEvent({ type: 'clickBlocked', reason: 'rate', until: 0 })?.name).toBe('error')
    expect(cueForEvent({ type: 'postResolved', postId: 'p', viral: true, flop: false, ratioed: false })?.name).toBe('viral')
    expect(cueForEvent({ type: 'postResolved', postId: 'p', viral: false, flop: false, ratioed: true })?.name).toBe('lose')
    expect(cueForEvent({ type: 'postResolved', postId: 'p', viral: false, flop: true, ratioed: false })?.name).toBe('flop')
    // A citizen run is background noise, not an event.
    expect(cueForEvent({ type: 'citizenRun', handle: 'a_b', workflowName: 'w', credits: 1 })).toBeNull()
    expect(cueForEvent({ type: 'offline', gain: 1, elapsedSec: 1 })).toBeNull()
    expect(cueForEvent({ type: 'eventEnd', defId: 'e', kind: 'powerSurge' })).toBeNull()
  })

  it('sounds a bet the same whichever way it went, until it lands', () => {
    // The engine event fires while the coin is still in the air and the seed is still scrambling.
    // A win and a loss must be indistinguishable here, or the speakers spoil the screen.
    const spins = SAMPLES.spin.map((e) => JSON.stringify(cueForEvent(e)))
    expect(new Set(spins).size).toBe(1)
    expect(cueForEvent(SAMPLES.spin[0] as GameEvent)?.name).toBe('spin')
    const flips = SAMPLES.flip.map((e) => JSON.stringify(cueForEvent(e)))
    expect(new Set(flips).size).toBe(1)
    expect(cueForEvent(SAMPLES.flip[0] as GameEvent)?.name).toBe('whoosh')
    for (const event of [...SAMPLES.spin, ...SAMPLES.flip]) {
      for (const part of walk(cueForEvent(event) as Cue)) expect(['cash', 'lose', 'jackpot']).not.toContain(part.name)
      // Under reduced motion the Lounge lands the bet at once, so the landing cue is the only one.
      expect(cueForEvent(event, { reducedMotion: true })).toBeNull()
    }
  })

  it('pays off at the landing', () => {
    const landings: BetLanding[] = [
      { table: 'wheel', mult: 42 },
      { table: 'wheel', mult: JACKPOT_MULT },
      { table: 'wheel', mult: 4 },
      { table: 'wheel', mult: 2 },
      { table: 'wheel', mult: 1 },
      { table: 'wheel', mult: 0.5 },
      { table: 'wheel', mult: 0.25 },
      { table: 'wheel', mult: 0 },
      { table: 'coin', won: true },
      { table: 'coin', won: false },
    ]
    for (const landing of landings) {
      for (const part of walk(cueForLanding(landing))) {
        expect(names.has(part.name)).toBe(true)
        if (part.rate !== undefined) expect(part.rate).toBeGreaterThan(0)
        if (part.gain !== undefined) expect(part.gain).toBeGreaterThan(0)
      }
    }
    expect(cueForLanding({ table: 'wheel', mult: 42 }).name).toBe('jackpot')
    expect(cueForLanding({ table: 'wheel', mult: JACKPOT_MULT }).name).toBe('jackpot')
    expect(cueForLanding({ table: 'wheel', mult: 4 }).name).toBe('cash')
    expect(cueForLanding({ table: 'wheel', mult: 2 }).name).toBe('cash')
    expect(cueForLanding({ table: 'wheel', mult: 1 }).name).toBe('tick')
    expect(cueForLanding({ table: 'wheel', mult: 0.25 }).name).toBe('lose')
    // Half back is the smaller sting: quieter and shorter than a NaN, which hands a quarter back
    // and still gets the heavy one. A table paying nothing at all sounds the same as the NaN.
    const half = cueForLanding({ table: 'wheel', mult: 0.5 })
    const nan = cueForLanding({ table: 'wheel', mult: 0.25 })
    expect(cueForLanding({ table: 'wheel', mult: 0 })).toEqual(nan)
    expect(cueForLanding({ table: 'wheel', mult: 0.25 * 1.5 })).toEqual(nan)
    expect(half.name).toBe('lose')
    expect(half.gain ?? 1).toBeLessThan(nan.gain ?? 1)
    expect(half.rate ?? 1).toBeGreaterThan(nan.rate ?? 1)
    expect(cueForLanding({ table: 'coin', won: true }).name).toBe('cash')
    expect(cueForLanding({ table: 'coin', won: false }).name).toBe('lose')
    // A lost flip is the common case on a fast table, so it sits under the wheel's NaN.
    expect(cueForLanding({ table: 'coin', won: false }).gain ?? 1).toBeLessThan(nan.gain ?? 1)
  })

  it('gives the hidden achievement the easter egg sting', () => {
    const event: GameEvent = { type: 'achievement', id: 'ghost', reward: 0 }
    expect(cueForEvent(event)?.name).toBe('achievement')
    expect(cueForEvent(event, { hiddenAchievement: true })?.name).toBe('egg')
  })

  it('chains the two part cues', () => {
    const unlock = cueForEvent({ type: 'mapUnlock', id: 'n' })
    expect(unlock).toEqual({ name: 'whoosh', then: { name: 'cash', delayMs: 120 } })
    const reward = cueForEvent({ type: 'reward', id: 'r', credits: 10 })
    expect(reward).toEqual({ name: 'cash', then: { name: 'achievement', delayMs: 150 } })
    const bulk = cueForEvent({ type: 'purchase', hardwareId: 'h', count: 10 })
    expect(bulk?.then?.delayMs).toBe(90)
    expect(cueForEvent({ type: 'purchase', hardwareId: 'h', count: 9 })?.then).toBeUndefined()
  })
})

describe('sfxMap: toasts', () => {
  it('danger is the error cue', () => {
    expect(cueForToast('danger')).toEqual({ name: 'error' })
  })

  it('credits pays in cash and everything else is the soft toast', () => {
    expect(cueForToast('credits')).toEqual({ name: 'cash', gain: 0.5 })
    for (const tone of ['default', 'electric', 'sapphire', 'mask'] as const) {
      expect(cueForToast(tone)).toEqual({ name: 'toast', gain: 0.4 })
    }
  })
})

describe('comboRate', () => {
  it('starts at 1 and caps at 1.3', () => {
    expect(comboRate(0)).toBe(1)
    expect(comboRate(50)).toBeCloseTo(1.3, 10)
    expect(comboRate(500)).toBeCloseTo(1.3, 10)
    expect(comboRate(-5)).toBe(1)
  })

  it('is monotone', () => {
    let prev = comboRate(0)
    for (let n = 1; n <= 120; n++) {
      const next = comboRate(n)
      expect(next).toBeGreaterThanOrEqual(prev)
      expect(next).toBeLessThanOrEqual(1.3 + 1e-9)
      prev = next
    }
  })
})

describe('ClickLimiter', () => {
  it('allows exactly 20 at one instant', () => {
    const limiter = new ClickLimiter()
    let allowed = 0
    for (let i = 0; i < 100; i++) if (limiter.allow(1000)) allowed++
    expect(allowed).toBe(CLICK_LIMIT_PER_SEC)
    expect(CLICK_LIMIT_PER_SEC).toBe(20)
  })

  it('refills at the configured rate and never past the burst', () => {
    const limiter = new ClickLimiter()
    for (let i = 0; i < 20; i++) limiter.allow(0)
    expect(limiter.allow(0)).toBe(false)
    // 50 ms buys exactly one token back.
    expect(limiter.allow(50)).toBe(true)
    expect(limiter.allow(50)).toBe(false)
    // A long pause refills the bucket but does not overfill it.
    let allowed = 0
    for (let i = 0; i < 100; i++) if (limiter.allow(10_000)) allowed++
    expect(allowed).toBe(CLICK_LIMIT_PER_SEC)
  })

  it('honours a custom rate', () => {
    const limiter = new ClickLimiter(4)
    let allowed = 0
    for (let i = 0; i < 10; i++) if (limiter.allow(0)) allowed++
    expect(allowed).toBe(4)
  })
})

describe('sfxMap: recipes and the shipped files', () => {
  it('gives every name a synth recipe', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...SFX_NAMES].sort())
    for (const name of SFX_NAMES) {
      const recipe = RECIPES[name]
      expect(recipe.duration).toBeGreaterThan(0)
      expect(recipe.layers.length).toBeGreaterThan(0)
      for (const layer of recipe.layers) {
        expect(layer.gain).toBeGreaterThan(0)
        expect(layer.decay).toBeGreaterThan(0)
        expect(layer.freq).toBeGreaterThan(0)
        // The stated duration has to cover the longest layer, or the engine retires the voice
        // while it is still audible.
        const end = (layer.at ?? 0) + (layer.attack ?? 0.004) + layer.decay
        expect(recipe.duration).toBeGreaterThanOrEqual(end)
      }
    }
  })

  it('matches public/sfx file for file', () => {
    const files = readdirSync(SFX_DIR)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => f.replace(/\.mp3$/, ''))
      .sort()
    expect(files).toEqual(Object.keys(RECIPES).sort())
    expect(sfxUrl('click' as SfxName)).toBe('/sfx/click.mp3')
  })

  it('keeps the click quiet and the payoffs ducking over it', () => {
    expect(BASE_GAIN.click).toBeLessThanOrEqual(0.25)
    for (const name of SFX_NAMES) expect(BASE_GAIN[name]).toBeGreaterThan(0)
    // lose.mp3 and flop.mp3 are mastered around 13 dB hotter than the rest of the set (see the
    // note on SAMPLE_TRIM). The trim is what keeps a lost bet under the jackpot when the file
    // plays, and it must not touch the recipes, which are already level.
    expect(SAMPLE_TRIM.lose).toBeLessThanOrEqual(0.45)
    expect(SAMPLE_TRIM.flop).toBeLessThanOrEqual(0.6)
    for (const [name, trim] of Object.entries(SAMPLE_TRIM)) {
      expect(names.has(name)).toBe(true)
      expect(trim).toBeGreaterThan(0)
      expect(trim).toBeLessThan(1)
    }
    expect(BASE_GAIN.lose).toBeLessThanOrEqual(BASE_GAIN.cash)
    expect([...DUCKERS].sort()).toEqual(['achievement', 'jackpot', 'levelup', 'viral'])
    expect(MIN_GAP_MS.error).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Engine: the autoplay contract. A minimal AudioContext stub is enough to prove that nothing is
// built before a gesture and nothing at all while sound is off.
// ---------------------------------------------------------------------------

let contextsCreated = 0

class FakeParam {
  value = 0
  setValueAtTime(): this {
    return this
  }
  exponentialRampToValueAtTime(): this {
    return this
  }
  linearRampToValueAtTime(): this {
    return this
  }
}

class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  Q = new FakeParam()
  playbackRate = new FakeParam()
  detune = new FakeParam()
  type = ''
  loop = false
  buffer: unknown = null
  onended: (() => void) | null = null
  connect(): this {
    return this
  }
  disconnect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeAudioContext {
  state = 'running'
  currentTime = 0
  sampleRate = 8000
  destination = new FakeNode()
  constructor() {
    contextsCreated++
  }
  createGain(): FakeNode {
    return new FakeNode()
  }
  createOscillator(): FakeNode {
    return new FakeNode()
  }
  createBufferSource(): FakeNode {
    return new FakeNode()
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode()
  }
  createBuffer(_c: number, frames: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(frames)
    return { getChannelData: () => data }
  }
  decodeAudioData(): Promise<never> {
    return Promise.reject(new Error('no decoder in the stub'))
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

type Handler = (event: { isTrusted: boolean }) => void
const listeners = new Map<string, { fn: Handler; once: boolean }[]>()

function addListener(type: string, fn: Handler, opts?: boolean | { once?: boolean }): void {
  const list = listeners.get(type) ?? []
  if (list.some((l) => l.fn === fn)) return
  list.push({ fn, once: typeof opts === 'object' && opts.once === true })
  listeners.set(type, list)
}

function removeListener(type: string, fn: Handler): void {
  const list = listeners.get(type)
  if (!list) return
  listeners.set(
    type,
    list.filter((l) => l.fn !== fn),
  )
}

function fire(type: string, isTrusted: boolean): void {
  const list = [...(listeners.get(type) ?? [])]
  for (const entry of list) {
    if (entry.once) removeListener(type, entry.fn)
    entry.fn({ isTrusted })
  }
}

async function loadEngine() {
  return import('../sfxEngine')
}

describe('sfxEngine: autoplay policy', () => {
  beforeEach(async () => {
    contextsCreated = 0
    listeners.clear()
    const store = new Map<string, string>()
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('window', { addEventListener: addListener, removeEventListener: removeListener })
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: addListener,
      removeEventListener: removeListener,
    })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    const engine = await loadEngine()
    engine.resetSfx()
  })

  afterEach(async () => {
    const engine = await loadEngine()
    engine.resetSfx()
    vi.unstubAllGlobals()
  })

  it('never builds a context at import time or before a gesture', async () => {
    const engine = await loadEngine()
    expect(contextsCreated).toBe(0)
    engine.armSfx()
    expect(contextsCreated).toBe(0)
    engine.playCue({ name: 'cash' })
    expect(contextsCreated).toBe(0)
    expect(engine.sfxDebugState().hasContext).toBe(false)
  })

  it('ignores a synthetic gesture and unlocks on a trusted one', async () => {
    const engine = await loadEngine()
    engine.armSfx()
    fire('pointerdown', false)
    expect(contextsCreated).toBe(0)
    expect(engine.sfxDebugState().gestureSeen).toBe(false)
    fire('pointerdown', true)
    expect(contextsCreated).toBe(1)
    expect(engine.sfxDebugState().gestureSeen).toBe(true)
  })

  it('builds no context at all while sound is off', async () => {
    const engine = await loadEngine()
    engine.setSfxEnabled(false)
    engine.armSfx()
    fire('pointerdown', true)
    engine.playCue({ name: 'achievement' })
    engine.playCue({ name: 'click' })
    expect(contextsCreated).toBe(0)
    expect(engine.sfxDebugState().hasContext).toBe(false)
    expect(engine.sfxDebugState().voices).toBe(0)
  })

  it('plays through the synth fallback and keeps the click from stacking up', async () => {
    const engine = await loadEngine()
    engine.armSfx()
    fire('keydown', true)
    for (let i = 0; i < 40; i++) engine.playCue({ name: 'click', rate: 1.1 })
    const live = engine.sfxDebugState().voices
    expect(live).toBeGreaterThan(0)
    expect(live).toBeLessThanOrEqual(3)
    engine.stopAllSfx()
    expect(engine.sfxDebugState().voices).toBe(0)
  })

  it('stays silent while the tab is hidden', async () => {
    const engine = await loadEngine()
    engine.armSfx()
    fire('pointerdown', true)
    vi.stubGlobal('document', {
      hidden: true,
      addEventListener: addListener,
      removeEventListener: removeListener,
    })
    engine.playCue({ name: 'cash' })
    expect(engine.sfxDebugState().voices).toBe(0)
  })

  it('reads the volume from localStorage and writes it back', async () => {
    const engine = await loadEngine()
    expect(engine.getSfxVolume()).toBe(engine.SFX_DEFAULT_VOLUME)
    engine.setSfxVolume(0.25)
    expect(engine.getSfxVolume()).toBe(0.25)
    expect(localStorage.getItem(engine.SFX_VOLUME_KEY)).toBe('0.25')
    engine.setSfxVolume(9)
    expect(engine.getSfxVolume()).toBe(1)
    expect(contextsCreated).toBe(0)
  })
})
