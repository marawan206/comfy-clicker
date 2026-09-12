'use client'
/**
 * Spaghetti Mode: the Konami reward. Twelve to twenty litegraph wires in ComfyUI slot colours
 * draw themselves across the viewport and keep wriggling (Motion animates the bezier control
 * points; the endpoints stay put under their slot dots), under a glitching "SPAGHETTI MODE"
 * banner. Pure SVG with `pointer-events: none`, so the game underneath stays clickable.
 *
 * `EasterEggs` owns the schedule: `variant: 'full'` is the 60 s discovery show with the banner,
 * `'burst'` a five-second reprise with fewer wires and no banner, `null` hides everything.
 */
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import GlitchText from '@/components/kokonutui/glitch-text'
import { chance, mulberry32, pick, uniform } from '@/game/rng'

export const SPAGHETTI_FULL_MS = 60_000
export const SPAGHETTI_BURST_MS = 5_000
/** The banner leaves before the wires do, so the noodles read as the room and not a modal. */
const BANNER_MS = 6_000

export type SpaghettiVariant = 'full' | 'burst'

export interface SpaghettiModeProps {
  /** `null` hides the overlay; each variant renders inside an `AnimatePresence`. */
  variant: SpaghettiVariant | null
  /** Seeds the wire layout; a new run gets new wires. */
  runId: number
}

/** ComfyUI slot colours: MODEL, CLIP, CONDITIONING, IMAGE, LATENT, VAE, MASK. */
const SLOT_COLOURS = ['#b39ddb', '#ffd500', '#ffa931', '#64b5f6', '#ff9cf9', '#ff6e6e', '#81c784'] as const
const WIRES_FULL = 18
const WIRES_BURST = 12
/** Square viewBox stretched to the viewport; strokes and dots are non-scaling so nothing squashes. */
const VIEW = 1000

interface Wire {
  id: number
  colour: string
  x0: number
  y0: number
  x1: number
  y1: number
  /** Three bezier keyframes sharing endpoints; only the control points move. */
  frames: [string, string, string]
  duration: number
  delay: number
  width: number
}

const r1 = (n: number): number => Math.round(n * 10) / 10

function bezier(x0: number, y0: number, c1x: number, c1y: number, c2x: number, c2y: number, x1: number, y1: number): string {
  return `M ${r1(x0)} ${r1(y0)} C ${r1(c1x)} ${r1(c1y)}, ${r1(c2x)} ${r1(c2y)}, ${r1(x1)} ${r1(y1)}`
}

/** Deterministic per run so React never re-lays the wires mid-show. */
function buildWires(seed: number, count: number): Wire[] {
  const rng = mulberry32(seed >>> 0)
  const wires: Wire[] = []
  for (let i = 0; i < count; i++) {
    const left = uniform(rng, -40, 180)
    const right = uniform(rng, 820, 1040)
    // Half the wires draw right-to-left so the room fills from both sides.
    const flip = chance(rng, 0.5)
    const x0 = flip ? right : left
    const x1 = flip ? left : right
    const y0 = uniform(rng, 30, 970)
    const y1 = uniform(rng, 30, 970)
    const dir = x1 > x0 ? 1 : -1
    const span = Math.abs(x1 - x0)
    const frames: string[] = []
    for (let k = 0; k < 3; k++) {
      // Litegraph wires leave a slot horizontally; the reach and the sag are what wriggle.
      const reach1 = span * uniform(rng, 0.25, 0.6)
      const reach2 = span * uniform(rng, 0.25, 0.6)
      const sag1 = uniform(rng, -240, 240)
      const sag2 = uniform(rng, -240, 240)
      frames.push(bezier(x0, y0, x0 + dir * reach1, y0 + sag1, x1 - dir * reach2, y1 + sag2, x1, y1))
    }
    wires.push({
      id: i,
      colour: pick(rng, SLOT_COLOURS),
      x0,
      y0,
      x1,
      y1,
      frames: frames as [string, string, string],
      duration: uniform(rng, 2.8, 5.4),
      delay: i * 0.07,
      width: uniform(rng, 3, 4.5),
    })
  }
  return wires
}

export function SpaghettiMode({ variant, runId }: SpaghettiModeProps) {
  const count = variant === 'full' ? WIRES_FULL : WIRES_BURST
  const wires = useMemo(() => buildWires(runId, count), [runId, count])
  const showBanner = useBannerWindow(variant === 'full' ? runId : null)

  return (
    <>
      <AnimatePresence>
        {variant !== null ? (
          <motion.svg
            key={`wires-${runId}`}
            aria-hidden="true"
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            preserveAspectRatio="none"
            className="pointer-events-none fixed inset-0 z-[65] h-full w-full select-none"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6, ease: 'easeOut' } }}
          >
            {wires.map((w) => (
              <WireGroup key={w.id} wire={w} />
            ))}
          </motion.svg>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showBanner ? (
          <motion.div
            key={`banner-${runId}`}
            role="status"
            className="pointer-events-none fixed inset-x-0 top-[18vh] z-[66] flex flex-col items-center gap-1 px-4"
            style={BANNER_STYLE}
            initial={{ opacity: 0, scale: 0.7, rotate: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: -2 }}
            exit={{ opacity: 0, scale: 1.08, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          >
            <GlitchText text="SPAGHETTI MODE" color="rainbow" glitchIntensity="heavy" size="md" fontWeight={900} letterSpacing={4} className="p-2" />
            <p className="rounded-comfy border border-charcoal-400 bg-charcoal-700/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600 shadow-[0_3px_0_#0e0e0f]">
              nothing is connected to anything · this is fine
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

/** Electric-yellow hue for the Kokonut rainbow scheme (oklch hue of #f0ff41). */
const BANNER_STYLE = { '--rainbow-hue': '112' } as CSSProperties

/** True for BANNER_MS after each full run starts. */
function useBannerWindow(runId: number | null): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (runId === null) return
    const show = window.setTimeout(() => setOpen(true), 0)
    const hide = window.setTimeout(() => setOpen(false), BANNER_MS)
    return () => {
      window.clearTimeout(show)
      window.clearTimeout(hide)
      setOpen(false)
    }
  }, [runId])
  return open
}

const WireGroup = memo(function WireGroup({ wire }: { wire: Wire }) {
  const { frames, colour, duration, delay, width } = wire
  return (
    <g>
      <motion.path
        d={frames[0]}
        fill="none"
        stroke={colour}
        strokeWidth={width}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.9, d: [frames[0], frames[1], frames[2], frames[0]] }}
        transition={{
          pathLength: { duration: 0.9, delay, ease: 'easeOut' },
          opacity: { duration: 0.25, delay },
          d: { duration, delay, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
      <SlotDot x={wire.x0} y={wire.y0} colour={colour} delay={delay} />
      <SlotDot x={wire.x1} y={wire.y1} colour={colour} delay={delay + 0.9} />
    </g>
  )
})

/**
 * A litegraph slot dot drawn as a zero-length round-capped stroke, so it stays a perfect circle
 * in screen pixels even though the viewBox is stretched to the viewport.
 */
function SlotDot({ x, y, colour, delay }: { x: number; y: number; colour: string; delay: number }) {
  const d = `M ${r1(x)} ${r1(y)} h 0.01`
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay }}>
      <path d={d} stroke="#171718" strokeWidth={16} strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />
      <path d={d} stroke={colour} strokeWidth={10} strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />
      <path d={d} stroke="#171718" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />
    </motion.g>
  )
}
