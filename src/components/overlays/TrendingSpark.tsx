'use client'
/**
 * The catch-me badge for a `trendingSpark` event: an electric "#" that appears at a deterministic
 * spot over the centre column for the event's 8 s window. Clicking it resolves the event, which
 * arms ×3 likes on the next post.
 */
import type { MouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { fx } from '@/components/fx/fxBus'
import { useReducedMotionPref } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { useNow } from '@/hooks/useNow'
import { hashString } from '@/game/rng'
import { useGame, useGameStore } from '@/state/useGame'

const SEP = '|'
const RING_R = 34
const RING_C = 2 * Math.PI * RING_R

/** Position (viewport %) inside the centre band, stable for the life of one spark. */
function placeSpark(seed: string): { left: number; top: number } {
  const h = hashString(seed)
  return {
    left: 32 + ((h % 1000) / 1000) * 36,
    top: 22 + (((h >>> 10) % 1000) / 1000) * 48,
  }
}

export function TrendingSpark() {
  const key = useGame((s) => {
    const e = s.events.active.find((ev) => ev.kind === 'trendingSpark' && !ev.resolved)
    return e ? `${e.defId}${SEP}${e.startedAt}${SEP}${e.endsAt}` : ''
  })
  const [defId, startedAtRaw, endsAtRaw] = key.split(SEP)
  const startedAt = Number(startedAtRaw)
  const endsAt = Number(endsAtRaw)

  return (
    <AnimatePresence>
      {defId ? <SparkBadge key={key} defId={defId} startedAt={startedAt} endsAt={endsAt} seed={key} /> : null}
    </AnimatePresence>
  )
}

function SparkBadge({ defId, startedAt, endsAt, seed }: { defId: string; startedAt: number; endsAt: number; seed: string }) {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const now = useNow(250)
  const pos = placeSpark(seed)
  const total = Math.max(1, endsAt - startedAt)
  const remaining = Math.max(0, Math.min(1, (endsAt - now) / total))

  const onCatch = (e: MouseEvent<HTMLButtonElement>) => {
    const r = store.resolveEvent(defId)
    if (r.error) {
      toast(r.error, { tone: 'danger', title: 'Missed it' })
      return
    }
    fx.burst(e.clientX, e.clientY, 28)
    toast('Caught the spark', {
      title: 'Trending',
      description: 'Your next post rides it · ×3 likes',
      icon: <Sparkles className="text-electric-400" />,
      tone: 'electric',
    })
  }

  return (
    <motion.button
      type="button"
      onClick={onCatch}
      aria-label="Catch the trending spark for triple likes on your next post"
      className="group fixed z-[60] grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none"
      style={{ left: `${pos.left}vw`, top: `${pos.top}vh` }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.6 }}
      transition={reduced ? { duration: 0.12 } : { type: 'spring', stiffness: 420, damping: 22 }}
      whileHover={reduced ? undefined : { scale: 1.08 }}
      whileTap={reduced ? undefined : { scale: 0.92 }}
    >
      {!reduced ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 rounded-full bg-electric-400/25"
          animate={{ scale: [1, 1.55], opacity: [0.6, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
        />
      ) : null}
      <svg viewBox="0 0 80 80" className="pointer-events-none absolute inset-2 size-20 -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={RING_R} fill="none" stroke="#313235" strokeWidth="4" />
        <circle
          cx="40"
          cy="40"
          r={RING_R}
          fill="none"
          stroke="#f0ff41"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - remaining)}
          className="transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      <span className="relative grid size-14 place-items-center rounded-comfy border-2 border-electric-400 bg-charcoal-600 text-3xl leading-none font-extrabold text-electric-400 shadow-[0_4px_0_#0e0e0f,0_0_28px_rgba(240,255,65,0.45)] group-focus-visible:ring-2 group-focus-visible:ring-electric-400 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-charcoal-800">
        #
      </span>
      <span className="pointer-events-none absolute -bottom-1 rounded-comfy bg-charcoal-800/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-electric-400">
        catch it
      </span>
    </motion.button>
  )
}
