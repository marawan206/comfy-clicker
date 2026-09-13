'use client'
/**
 * The Web Audio side of the sound system. Nothing here runs at import time: browsers refuse an
 * AudioContext that was not asked for by a gesture, and creating one on module load also costs a
 * hardware audio thread on a page the player may never interact with.
 *
 * Lifecycle
 *   `armSfx()` (from `useSfx`, once) installs a capture-phase pointerdown/keydown listener.
 *   The first *trusted* one of those creates the context; a synthetic event does not spend the
 *   unlock (the game refuses scripted clicks, and the audio layer agrees with it).
 *   `playCue()` then mixes through one master gain whose level is a device preference in
 *   localStorage, not save data: headphones on a laptop and a phone in a pocket want different
 *   volumes from the same account.
 *
 * Safety rails, in the order they fire: sfx disabled short-circuits before a single node exists,
 * a hidden tab is silent, the same name cannot retrigger faster than MIN_GAP_MS, clicks pass a
 * 20 per second token bucket and never stack more than CLICK_MAX_OVERLAP deep, and the whole
 * engine holds at most MAX_VOICES live sources.
 */
import {
  BASE_GAIN,
  CLICK_DETUNE,
  CLICK_DUCK,
  CLICK_MAX_OVERLAP,
  ClickLimiter,
  DUCKERS,
  MAX_VOICES,
  MIN_GAP_MS,
  RECIPES,
  sfxUrl,
  type Cue,
  type Recipe,
  type SfxName,
} from './sfxMap'

/** Device preference, deliberately outside the save: the same account plays on several machines. */
export const SFX_VOLUME_KEY = 'comfy-clicker:sfx-volume'
export const SFX_DEFAULT_VOLUME = 0.6

type AudioContextCtor = new () => AudioContext

interface Voice {
  name: SfxName
  gain: GainNode
  sources: AudioScheduledSourceNode[]
  endsAt: number
  stopped: boolean
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
/** Mirrors `settings.sfx`. False short-circuits everything before a node is created. */
let enabled = true
/** True once a trusted pointerdown or keydown has happened, which is what unlocks audio. */
let gestureSeen = false
let armed = false
let volume: number | null = null
let duckUntil = 0

const voices: Voice[] = []
const buffers = new Map<SfxName, AudioBuffer>()
const loading = new Set<SfxName>()
/** Names whose file 404s or will not decode: the synth recipe covers them for the session. */
const missing = new Set<SfxName>()
const lastPlayedAt = new Map<SfxName, number>()
const limiter = new ClickLimiter()
const DUCK_SET = new Set<SfxName>(DUCKERS)

// ---------------------------------------------------------------------------
// Environment helpers (every one of them tolerates node and SSR)
// ---------------------------------------------------------------------------

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return g.AudioContext ?? g.webkitAudioContext ?? null
}

function readStoredVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return SFX_DEFAULT_VOLUME
    const raw = localStorage.getItem(SFX_VOLUME_KEY)
    if (raw === null) return SFX_DEFAULT_VOLUME
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return SFX_DEFAULT_VOLUME
    return Math.min(1, Math.max(0, parsed))
  } catch {
    return SFX_DEFAULT_VOLUME
  }
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/** Master volume 0..1. Reads localStorage once, then keeps it in memory. */
export function getSfxVolume(): number {
  if (volume === null) volume = readStoredVolume()
  return volume
}

/** Set and persist the master volume. Never creates a context, so the slider works while muted. */
export function setSfxVolume(next: number): void {
  const v = Math.min(1, Math.max(0, Number.isFinite(next) ? next : SFX_DEFAULT_VOLUME))
  volume = v
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SFX_VOLUME_KEY, String(v))
  } catch {
    // A private window with storage blocked still gets sound, just not a remembered level.
  }
  if (master) master.gain.value = v
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

function onVisibility(): void {
  if (isHidden()) {
    stopAllSfx()
    return
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume()
}

function onGesture(event: Event): void {
  // A synthetic event must not unlock audio: it is exactly what an auto-clicker would dispatch.
  if (!event.isTrusted) {
    armSfx(true)
    return
  }
  removeGestureListeners()
  gestureSeen = true
  ensureContext()
}

function removeGestureListeners(): void {
  if (typeof window === 'undefined') return
  window.removeEventListener('pointerdown', onGesture, true)
  window.removeEventListener('keydown', onGesture, true)
}

/**
 * Install the gesture listeners. Idempotent, and safe to call while sfx is off: the handler only
 * records that a gesture happened, so switching sound on later starts working immediately instead
 * of waiting for the next press.
 */
export function armSfx(force = false): void {
  if (typeof window === 'undefined') return
  if (armed && !force) return
  if (gestureSeen) {
    armed = true
    return
  }
  armed = true
  window.addEventListener('pointerdown', onGesture, { once: true, capture: true })
  window.addEventListener('keydown', onGesture, { once: true, capture: true })
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility)
    document.addEventListener('visibilitychange', onVisibility)
  }
}

function ensureContext(): AudioContext | null {
  if (!enabled) return null
  if (!gestureSeen) return null
  if (ctx) return ctx
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  try {
    const next = new Ctor()
    const gain = next.createGain()
    gain.gain.value = getSfxVolume()
    gain.connect(next.destination)
    ctx = next
    master = gain
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
      document.addEventListener('visibilitychange', onVisibility)
    }
    return ctx
  } catch {
    return null
  }
}

/** Mirror `settings.sfx`. Turning sound off stops whatever is already sounding. */
export function setSfxEnabled(on: boolean): void {
  if (enabled === on) return
  enabled = on
  if (!on) stopAllSfx()
}

export function isSfxEnabled(): boolean {
  return enabled
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

function stopVoice(voice: Voice): void {
  // Drop it from the list first and unconditionally: the MAX_VOICES loop below stops `voices[0]`
  // until the list is short enough, so a voice that stayed in the array would spin forever.
  const i = voices.indexOf(voice)
  if (i >= 0) voices.splice(i, 1)
  if (voice.stopped) return
  voice.stopped = true
  for (const source of voice.sources) {
    try {
      source.stop()
    } catch {
      // Already ended: stop() on a finished source throws in some engines.
    }
  }
  try {
    voice.gain.disconnect()
  } catch {
    // Already detached.
  }
}

function prune(at: number): void {
  for (let i = voices.length - 1; i >= 0; i--) {
    const voice = voices[i] as Voice
    if (voice.stopped || voice.endsAt <= at) voices.splice(i, 1)
  }
}

/** Stop everything that is sounding. Used when sound is switched off and when the tab hides. */
export function stopAllSfx(): void {
  for (const voice of [...voices]) stopVoice(voice)
  voices.length = 0
  duckUntil = 0
}

// ---------------------------------------------------------------------------
// Sample loading
// ---------------------------------------------------------------------------

/**
 * Cached buffer for `name`, or null while it is still loading (or permanently, once the file has
 * proved missing). A null answer is not silence: the caller falls back to the synth recipe, so the
 * first play of a name sounds synthesized and every later one uses the file.
 */
function sampleFor(ac: AudioContext, name: SfxName): AudioBuffer | null {
  const hit = buffers.get(name)
  if (hit) return hit
  if (missing.has(name) || loading.has(name)) return null
  if (typeof fetch === 'undefined') {
    missing.add(name)
    return null
  }
  loading.add(name)
  void (async () => {
    try {
      const res = await fetch(sfxUrl(name))
      if (!res.ok) throw new Error(`sfx ${name}: ${res.status}`)
      const bytes = await res.arrayBuffer()
      const decoded = await ac.decodeAudioData(bytes)
      buffers.set(name, decoded)
    } catch {
      missing.add(name)
    } finally {
      loading.delete(name)
    }
  })()
  return null
}

function whiteNoise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  const frames = Math.floor(ac.sampleRate)
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buffer
  return buffer
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

const MIN_LEVEL = 0.0002
const ATTACK_DEFAULT = 0.004

function envelope(ac: AudioContext, out: GainNode, peak: number, at: number, attack: number, decay: number): GainNode {
  const gain = ac.createGain()
  const level = Math.max(peak, MIN_LEVEL)
  gain.gain.setValueAtTime(MIN_LEVEL, at)
  gain.gain.exponentialRampToValueAtTime(level, at + attack)
  gain.gain.exponentialRampToValueAtTime(MIN_LEVEL, at + attack + decay)
  gain.connect(out)
  return gain
}

/**
 * Build the synth stand-in for a name. Raising `rate` lifts the pitch and shortens it, like a
 * sample. `last` is the layer that finishes last: the voice is only done when that one is, and
 * hanging the cleanup off any earlier layer would cut the tail off every arpeggio.
 */
function playRecipe(
  ac: AudioContext,
  out: GainNode,
  recipe: Recipe,
  rate: number,
  at: number,
): { sources: AudioScheduledSourceNode[]; last: AudioScheduledSourceNode | null } {
  const sources: AudioScheduledSourceNode[] = []
  let last: AudioScheduledSourceNode | null = null
  let lastEnd = -1
  const k = 1 / rate
  for (const layer of recipe.layers) {
    const start = at + (layer.at ?? 0) * k
    const attack = (layer.attack ?? ATTACK_DEFAULT) * k
    const decay = layer.decay * k
    const end = start + attack + decay
    const gain = envelope(ac, out, layer.gain, start, attack, decay)
    if (layer.kind === 'tone') {
      const osc = ac.createOscillator()
      osc.type = layer.wave
      osc.frequency.setValueAtTime(layer.freq * rate, start)
      if (layer.toFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(layer.toFreq * rate, 1), end)
      osc.connect(gain)
      osc.start(start)
      osc.stop(end + 0.02)
      sources.push(osc)
      if (end > lastEnd) {
        lastEnd = end
        last = osc
      }
    } else {
      const src = ac.createBufferSource()
      src.buffer = whiteNoise(ac)
      src.loop = true
      const filter = ac.createBiquadFilter()
      filter.type = layer.filter
      filter.Q.value = layer.q ?? 1
      filter.frequency.setValueAtTime(layer.freq * rate, start)
      if (layer.toFreq !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(layer.toFreq * rate, 1), end)
      src.connect(filter)
      filter.connect(gain)
      src.start(start)
      src.stop(end + 0.02)
      sources.push(src)
      if (end > lastEnd) {
        lastEnd = end
        last = src
      }
    }
  }
  return { sources, last }
}

function playName(ac: AudioContext, bus: GainNode, name: SfxName, rate: number, gain: number): void {
  const at = ac.currentTime
  const voiceGain = ac.createGain()
  voiceGain.gain.value = gain
  voiceGain.connect(bus)

  const sample = sampleFor(ac, name)
  let sources: AudioScheduledSourceNode[]
  let last: AudioScheduledSourceNode | null
  let length: number
  if (sample) {
    const src = ac.createBufferSource()
    src.buffer = sample
    src.playbackRate.value = rate
    src.connect(voiceGain)
    src.start(at)
    sources = [src]
    last = src
    length = sample.duration / rate
  } else {
    const recipe = RECIPES[name]
    const built = playRecipe(ac, voiceGain, recipe, rate, at)
    sources = built.sources
    last = built.last
    length = recipe.duration / rate
  }

  const voice: Voice = { name, gain: voiceGain, sources, endsAt: at + length + 0.05, stopped: false }
  voices.push(voice)
  if (last) last.onended = () => stopVoice(voice)
  if (DUCK_SET.has(name)) duckUntil = Math.max(duckUntil, at + length)
}

/**
 * Play a cue (and its `then` chain). Accepts `false` so `ToastHost` can hand over
 * `ToastOptions.sound` untouched.
 */
export function playCue(cue: Cue | false | null | undefined): void {
  if (!cue) return
  if (!enabled) return
  if (isHidden()) return
  const ac = ensureContext()
  if (!ac || !master) return
  if (ac.state === 'suspended') void ac.resume()

  const clock = nowMs()
  const gap = MIN_GAP_MS[cue.name]
  if (gap !== undefined) {
    const last = lastPlayedAt.get(cue.name)
    if (last !== undefined && clock - last < gap) return
  }

  let rate = cue.rate ?? 1
  let gain = BASE_GAIN[cue.name] * (cue.gain ?? 1)

  prune(ac.currentTime)
  if (cue.name === 'click') {
    if (!limiter.allow(clock)) return
    // The same sample fifteen times a second is what makes a clicker exhausting. The combo ramp
    // supplies the rate; this adds a small random spread on top so no two clicks are identical.
    rate *= 1 + (Math.random() * 2 - 1) * CLICK_DETUNE
    if (duckUntil > ac.currentTime) gain *= CLICK_DUCK
    const live = voices.filter((v) => v.name === 'click')
    for (let i = 0; i <= live.length - CLICK_MAX_OVERLAP; i++) stopVoice(live[i] as Voice)
  }
  while (voices.length >= MAX_VOICES) stopVoice(voices[0] as Voice)

  lastPlayedAt.set(cue.name, clock)
  try {
    playName(ac, master, cue.name, rate, gain)
  } catch {
    // Sound must never take the game down with it.
  }

  if (cue.then) {
    const next = cue.then
    setTimeout(() => playCue(next), Math.max(0, next.delayMs ?? 0))
  }
}

/** Full teardown. Used by tests and by the dev-server hot reload; a mounted game never needs it. */
export function resetSfx(): void {
  stopAllSfx()
  removeGestureListeners()
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  if (ctx) {
    try {
      void ctx.close()
    } catch {
      // Nothing to do: the context is going away either way.
    }
  }
  ctx = null
  master = null
  noiseBuffer = null
  enabled = true
  gestureSeen = false
  armed = false
  volume = null
  duckUntil = 0
  buffers.clear()
  loading.clear()
  missing.clear()
  lastPlayedAt.clear()
  limiter.reset()
}

/** Test and debug view of the engine's internals. Not used by the game. */
export function sfxDebugState(): {
  hasContext: boolean
  gestureSeen: boolean
  enabled: boolean
  voices: number
  missing: SfxName[]
} {
  return {
    hasContext: ctx !== null,
    gestureSeen,
    enabled,
    voices: voices.length,
    missing: [...missing],
  }
}
