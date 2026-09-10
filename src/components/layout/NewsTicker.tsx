'use client'
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Radio } from 'lucide-react'
import { useGame, useGameStore } from '@/state/useGame'
import { TICKER_LINES } from '@/data/flavor'
import type { FeedItem } from '@/server/feed/types'
import { useFeed } from '@/components/feed/FeedProvider'
import { useReducedMotionPref } from '@/components/feed/feedHooks'
import { cn } from '@/lib/utils'

const TICKER_FLAG = 'ticker-seven'
const PILL_CLICKS = 7
/** Real excerpts on the wire per cycle; the rest is in-game news. */
const REAL_PER_CYCLE = 14
const EXCERPT_CHARS = 110
/** Approximate glyph width at 12 px, used to scale the marquee duration with the track length. */
const PX_PER_CHAR = 6.4
const PX_PER_SEC = 80
/** Rotates the headline pool once per page load; served as 0 during hydration so markup matches. */
const SESSION_OFFSET = Math.floor(Math.random() * TICKER_LINES.length)
const noSubscribe = (): (() => void) => () => {}

type Line = { key: string; text: string; href?: string; author?: string }

function excerpt(item: FeedItem): string {
  const flat = item.text.replace(/\s+/g, ' ').trim()
  if (flat.length <= EXCERPT_CHARS) return flat
  const cut = flat.slice(0, EXCERPT_CHARS)
  const at = cut.lastIndexOf(' ')
  return `${cut.slice(0, at > 60 ? at : EXCERPT_CHARS).trimEnd()}…`
}

/** Real excerpts interleaved one-for-one with in-game headlines; `offset` rotates the headline pool per session. */
export function buildTickerLines(items: readonly FeedItem[], offset: number): Line[] {
  const real = items.slice(0, REAL_PER_CYCLE).map<Line>((i) => ({ key: `r:${i.id}`, text: excerpt(i), href: i.url, author: i.author }))
  const pool = TICKER_LINES.length
  const count = Math.max(real.length, Math.min(pool, REAL_PER_CYCLE))
  const news: Line[] = []
  for (let i = 0; i < count; i++) {
    const idx = (offset + i) % pool
    news.push({ key: `n:${idx}`, text: TICKER_LINES[idx] as string })
  }
  const out: Line[] = []
  for (let i = 0; i < count; i++) {
    const r = real[i]
    if (r) out.push(r)
    const n = news[i]
    if (n) out.push(n)
  }
  return out
}

/** 32 px wire strip: "COMFY WIRE" pill plus a marquee of real excerpts and in-game headlines. */
export function NewsTicker() {
  const store = useGameStore()
  const tapped = useGame((s) => s.flags[TICKER_FLAG] === true)
  const reduced = useReducedMotionPref()
  const { items } = useFeed()
  const offset = useSyncExternalStore(
    noSubscribe,
    () => SESSION_OFFSET,
    () => 0,
  )
  const lines = useMemo(() => buildTickerLines(items, offset), [items, offset])

  const clicks = useRef(0)
  const [justTapped, setJustTapped] = useState(false)
  useEffect(() => {
    if (!justTapped) return
    const t = setTimeout(() => setJustTapped(false), 3000)
    return () => clearTimeout(t)
  }, [justTapped])
  const onPill = (): void => {
    clicks.current += 1
    if (clicks.current >= PILL_CLICKS) {
      clicks.current = 0
      if (!tapped) store.setFlag(TICKER_FLAG)
      setJustTapped(true)
    }
  }

  const chars = lines.reduce((n, l) => n + l.text.length + (l.author?.length ?? 0) + 6, 0)
  const duration = Math.max(40, Math.round((chars * PX_PER_CHAR) / PX_PER_SEC))

  return (
    <div className="flex h-8 items-center gap-2 border-b-2 border-charcoal-400 bg-charcoal-700 px-3" role="region" aria-label="Comfy Wire">
      <button
        type="button"
        onClick={onPill}
        aria-label="Comfy Wire"
        title={tapped ? 'You found the wire tap.' : 'Live from the Comfy ecosystem'}
        className={cn(
          'inline-flex h-5 shrink-0 select-none items-center gap-1 rounded-full px-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[0_2px_0_#0e0e0f] transition-transform active:translate-y-px active:shadow-none',
          justTapped ? 'bg-electric-400 text-charcoal-800' : 'bg-sapphire-700',
        )}
      >
        <Radio size={11} aria-hidden="true" className={cn(!reduced && 'cc-breathe')} />
        {justTapped ? 'Wire tapped' : 'Comfy Wire'}
      </button>

      {reduced ? <RotatingLine lines={lines} /> : <Marquee lines={lines} duration={duration} />}
    </div>
  )
}

function LineText({ line }: { line: Line }) {
  if (line.href) {
    return (
      <a
        href={line.href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm text-smoke-100 hover:text-electric-400 hover:underline"
        title={`Open ${line.author ?? 'post'}`}
      >
        <span className="font-semibold text-sapphire-700 brightness-150">{line.author}:</span> {line.text}
      </a>
    )
  }
  return <span className="text-smoke-600">{line.text}</span>
}

function Track({ lines, hidden }: { lines: Line[]; hidden?: boolean }) {
  return (
    <span className="flex items-center whitespace-nowrap" aria-hidden={hidden || undefined}>
      {lines.map((l) => (
        <Fragment key={l.key}>
          <LineText line={l} />
          <span className="mx-4 text-sapphire-700" aria-hidden="true">
            ◆
          </span>
        </Fragment>
      ))}
    </span>
  )
}

function Marquee({ lines, duration }: { lines: Line[]; duration: number }) {
  return (
    <div className="cc-marquee-host relative min-w-0 flex-1 overflow-hidden text-xs leading-none" aria-live="off">
      <div className="cc-marquee" style={{ '--cc-marquee-duration': `${duration}s` } as React.CSSProperties}>
        <Track lines={lines} />
        <Track lines={lines} hidden />
      </div>
      <span className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-charcoal-700 to-transparent" aria-hidden="true" />
      <span className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-linear-to-l from-charcoal-700 to-transparent" aria-hidden="true" />
    </div>
  )
}

/** Reduced motion: one headline at a time, swapped every few seconds with a fade. */
function RotatingLine({ lines }: { lines: Line[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (lines.length <= 1) return
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 6000)
    return () => clearInterval(t)
  }, [lines.length])
  const line = lines[i % Math.max(1, lines.length)]
  if (!line) return null
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden text-xs leading-none" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={line.key} className="truncate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          <LineText line={line} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
