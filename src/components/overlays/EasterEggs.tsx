'use client'
/**
 * Hidden-flag theatre. Listens for the engine's `easterEgg` event (raised once per flag by
 * `setFlag`) and stages the reward for the flags that earn a visual:
 *   konami      → Spaghetti Mode: sixty seconds of litegraph noodles and a glitching banner,
 *                 plus a "your workflow is now art" toast. Afterwards every Generate click has a
 *                 10% chance of a five-second reprise, with a breather between shows.
 *   comfy-wave  → the Comfy wordmark surfs across the header for four seconds.
 *   rickroll    → a Matrix-style reveal toast (span-only, so it can live inside the toast's
 *                 description paragraph). The queue is never giving you up.
 * The generic "Easter egg" discovery toast comes from `AchievementToast`; this file only owns
 * the shows. Reduced motion (OS or setting) keeps the toasts and drops the wires; the wave
 * degrades to a still wordmark fading in over the header.
 *
 * Both toasts here pass `sound: false`: the `easterEgg` event that raised them has already played
 * the egg sting through `useSfx`, and the same cue twice is noise, not juice.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Music, Utensils } from 'lucide-react'
import { ComfyWave, COMFY_WAVE_MS } from '@/components/overlays/ComfyWave'
import { useReducedMotionPref } from '@/components/overlays/ModalBase'
import { SPAGHETTI_BURST_MS, SPAGHETTI_FULL_MS, SpaghettiMode, type SpaghettiVariant } from '@/components/overlays/SpaghettiMode'
import { toast } from '@/components/overlays/useToasts'
import { COMFY_WAVE_FLAG, KONAMI_FLAG } from '@/hooks/useEasterEggs'
import { cn } from '@/lib/utils'
import { useGame, useGameEvents } from '@/state/useGame'

export const RICKROLL_FLAG = 'rickroll'
/** Chance that a Generate click restarts the noodles once Spaghetti Mode has been discovered. */
export const SPAGHETTI_BURST_CHANCE = 0.1
/** Quiet time after any show before a click can start a reprise; at 3 clicks/s the room would never clear. */
export const SPAGHETTI_COOLDOWN_MS = 20_000
/** The wave's exit fade runs after the sweep; keep the element mounted until it is done. */
const WAVE_EXIT_MS = 250

interface SpaghettiRun {
  variant: SpaghettiVariant
  runId: number
}

interface WaveRun {
  runId: number
  viewportWidth: number
}

const RICKROLL_LINE = 'never gonna quantize you up'

export function EasterEggs() {
  const reduced = useReducedMotionPref()
  const konamiFound = useGame((s) => s.flags[KONAMI_FLAG] === true)
  const [spaghetti, setSpaghetti] = useState<SpaghettiRun | null>(null)
  const [wave, setWave] = useState<WaveRun | null>(null)
  const spaghettiTimer = useRef<number | null>(null)
  const waveTimer = useRef<number | null>(null)
  /** Mirrors `spaghetti !== null` for the click handler, which must not wait for a render. */
  const noodling = useRef(false)
  /** Earliest time a click may start a reprise. */
  const quietUntil = useRef(0)

  const stopSpaghetti = useCallback(() => {
    if (spaghettiTimer.current !== null) window.clearTimeout(spaghettiTimer.current)
    spaghettiTimer.current = null
    noodling.current = false
    quietUntil.current = Date.now() + SPAGHETTI_COOLDOWN_MS
    setSpaghetti(null)
  }, [])

  const startSpaghetti = useCallback(
    (variant: SpaghettiVariant) => {
      if (spaghettiTimer.current !== null) window.clearTimeout(spaghettiTimer.current)
      noodling.current = true
      setSpaghetti({ variant, runId: Date.now() })
      spaghettiTimer.current = window.setTimeout(stopSpaghetti, variant === 'full' ? SPAGHETTI_FULL_MS : SPAGHETTI_BURST_MS)
    },
    [stopSpaghetti],
  )

  const startWave = useCallback(() => {
    if (waveTimer.current !== null) window.clearTimeout(waveTimer.current)
    setWave({ runId: Date.now(), viewportWidth: window.innerWidth })
    waveTimer.current = window.setTimeout(() => {
      waveTimer.current = null
      setWave(null)
    }, COMFY_WAVE_MS + WAVE_EXIT_MS)
  }, [])

  // Flipping reduced motion mid-show clears the wires immediately; the timers die with the component.
  useEffect(() => {
    if (reduced && noodling.current) stopSpaghetti()
  }, [reduced, stopSpaghetti])
  useEffect(
    () => () => {
      if (spaghettiTimer.current !== null) window.clearTimeout(spaghettiTimer.current)
      if (waveTimer.current !== null) window.clearTimeout(waveTimer.current)
    },
    [],
  )

  useGameEvents((e) => {
    if (e.type === 'easterEgg') {
      switch (e.id) {
        case KONAMI_FLAG:
          toast('Your workflow is now art', {
            title: 'Spaghetti Mode',
            description: reduced
              ? 'Sixty seconds of noodles, skipped for reduced motion. The bonus still counts.'
              : 'Sixty seconds of noodles. Nothing is connected. Nothing needs to be.',
            icon: <Utensils className="text-slot-latent" />,
            tone: 'electric',
            key: 'spaghetti-mode',
            durationMs: 7_000,
            sound: false,
          })
          if (!reduced) startSpaghetti('full')
          return
        case COMFY_WAVE_FLAG:
          startWave()
          return
        case RICKROLL_FLAG:
          toast('Hidden node found', {
            title: 'Rickroll',
            description: <MatrixReveal text={RICKROLL_LINE} instant={reduced} />,
            icon: <Music className="text-slot-mask" />,
            tone: 'mask',
            key: 'rickroll',
            durationMs: 9_000,
            sound: false,
          })
          return
        default:
          return
      }
    }
    if (e.type !== 'click' || !konamiFound || reduced) return
    if (noodling.current || document.hidden || Date.now() < quietUntil.current) return
    if (Math.random() < SPAGHETTI_BURST_CHANCE) startSpaghetti('burst')
  })

  return (
    <>
      <SpaghettiMode variant={spaghetti?.variant ?? null} runId={spaghetti?.runId ?? 0} />
      <ComfyWave runId={wave?.runId ?? null} viewportWidth={wave?.viewportWidth ?? 0} reduced={reduced} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Matrix reveal
// ---------------------------------------------------------------------------
const REVEAL_DELAY_MS = 350
const REVEAL_LETTER_MS = 45
const REVEAL_FLICKER_MS = 320
const REVEAL_TICK_MS = 60

type GlyphState = 'pending' | 'matrix' | 'done'
interface Glyph {
  char: string
  state: GlyphState
}

const settle = (text: string): Glyph[] => text.split('').map((char) => ({ char: char === ' ' ? '\u00a0' : char, state: 'done' }))

/**
 * Letters flicker through binary in Matrix green, left to right, before settling on the line,
 * Kokonut's MatrixText effect rebuilt on inline spans so it can sit inside a toast paragraph.
 * One interval for the whole line; it stops once every letter has landed.
 */
function MatrixReveal({ text, instant }: { text: string; instant: boolean }) {
  const [glyphs, setGlyphs] = useState<Glyph[]>(() =>
    instant ? settle(text) : text.split('').map((char) => ({ char, state: char === ' ' ? 'done' : 'pending' })),
  )

  useEffect(() => {
    if (instant) return
    const start = performance.now()
    const total = REVEAL_DELAY_MS + (text.length - 1) * REVEAL_LETTER_MS + REVEAL_FLICKER_MS
    const id = window.setInterval(() => {
      const t = performance.now() - start
      setGlyphs(
        text.split('').map((char, i) => {
          if (char === ' ') return { char: '\u00a0', state: 'done' }
          const begin = REVEAL_DELAY_MS + i * REVEAL_LETTER_MS
          if (t < begin) return { char, state: 'pending' }
          if (t < begin + REVEAL_FLICKER_MS) return { char: Math.random() < 0.5 ? '0' : '1', state: 'matrix' }
          return { char, state: 'done' }
        }),
      )
      if (t >= total) window.clearInterval(id)
    }, REVEAL_TICK_MS)
    return () => window.clearInterval(id)
  }, [text, instant])

  return (
    <span aria-label={text} className="inline-flex flex-wrap font-mono text-[13px] leading-5">
      {glyphs.map((g, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            'inline-block w-[1ch] text-center transition-colors duration-100',
            g.state === 'pending' && 'opacity-0',
            g.state === 'matrix' && 'text-[#00ff00] [text-shadow:0_2px_4px_rgba(0,255,0,0.5)]',
            g.state === 'done' && 'text-smoke-100',
          )}
        >
          {g.char}
        </span>
      ))}
    </span>
  )
}
