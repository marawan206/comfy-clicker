'use client'
/**
 * The first-run tour: a dimmed screen with a rounded spotlight cut around one live element and a
 * node-styled bubble beside it. Six steps, about ninety seconds, and the dim never blocks a click.
 *
 * Nothing here is modal. The whole overlay is `pointer-events: none` apart from its own two
 * buttons, so a player who ignores the bubble and goes exploring is never trapped: action steps
 * complete when the deed is done (ten clicks, a queued post, a purchase), and a step whose gate is
 * already satisfied completes the moment the tour reaches it. Wandering only shortens the tour.
 *
 * Mounted by `GameShell`, not by `Overlays`: the tour points at the workbench, and `Overlays` also
 * runs on /map, /hub and /leaderboard where none of these anchors exist.
 *
 * "Has been taught" is `flags['tutorial-done']` on the game state (cloud save carries it between
 * devices, a hard reset replays the tour). Only the step cursor is local, in `tourStore`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Compass } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { PICK_HASHTAG_EVENT } from '@/components/feed/feedHooks'
import { ModalButton, OPEN_MODAL_EVENT, useReducedMotionPref } from '@/components/overlays/ModalBase'
import { TUTORIAL_FLAG } from '@/game/actions'
import { cn } from '@/lib/utils'
import { endTour, readTourCursor, setTourStep, startTour, useTour } from '@/state/tourStore'
import { useGame, useGameStore } from '@/state/useGame'
import {
  TUTORIAL_CLICKS,
  TUTORIAL_STEPS,
  firstIncompleteStep,
  isNewPlayer,
  shouldAutoStart,
  tourStart,
  type TourStart,
  type TourStep,
} from './tutorialSteps'

/** How long after the shell is ready the tour opens itself. */
const AUTO_START_MS = 900
/** Re-measure cadence: the three columns scroll internally and rows move under the cursor. */
const MEASURE_MS = 500
/** How often the overlay looks for an open dialog to hide behind. */
const MODAL_POLL_MS = 250
/** An anchor gone this long is never coming back on this screen: skip its step. */
const MISSING_MS = 2000

/** Spotlight geometry. */
const PAD = 8
const RADIUS = 16
const MASK_ID = 'cc-tour-spotlight'

/** Bubble geometry. */
const BUBBLE_W = 300
const BUBBLE_FALLBACK_H = 190
const GAP = 14
const EDGE = 12

/** The bottom-right block the toast stack owns; the bubble never sits in it. */
const TOAST_W = 400
const TOAST_H = 300

/** Before the first `begin`; never read, because nothing renders until the tour is active. */
const COLD: TourStart = { at: 0, clicks: 0, posts: 0, hardware: 0 }

const SPRING = { type: 'spring', stiffness: 380, damping: 34 } as const
const FADE = { duration: 0.2, ease: 'easeOut' } as const
const INSTANT = { duration: 0 } as const

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Point {
  left: number
  top: number
}

// ---------------------------------------------------------------------------
// Geometry (pure)
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : v < lo ? lo : v > hi ? hi : v)

/** Rects only ever move by whole pixels as far as the spotlight cares. */
function sameBox(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5
}

function inflate(b: Box): Box {
  return { x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 }
}

function intersects(p: Point, bw: number, bh: number, b: Box): boolean {
  return p.left < b.x + b.w && p.left + bw > b.x && p.top < b.y + b.h && p.top + bh > b.y
}

function inToastZone(p: Point, bw: number, bh: number, vw: number, vh: number): boolean {
  return p.left + bw > vw - TOAST_W && p.top + bh > vh - TOAST_H
}

/**
 * Right of the cutout, then left, then below, then above; the first side with room wins, and a
 * placement that would cover the cutout or land in the toast corner is passed over.
 */
function placeBubble(cut: Box, bw: number, bh: number, vw: number, vh: number): Point {
  const cx = clamp(cut.x, EDGE, Math.max(EDGE, vw - bw - EDGE))
  const cy = clamp(cut.y, EDGE, Math.max(EDGE, vh - bh - EDGE))
  const options: Array<{ p: Point; fits: boolean }> = [
    { p: { left: cut.x + cut.w + GAP, top: cy }, fits: cut.x + cut.w + GAP + bw <= vw - EDGE },
    { p: { left: cut.x - bw - GAP, top: cy }, fits: cut.x - bw - GAP >= EDGE },
    { p: { left: cx, top: cut.y + cut.h + GAP }, fits: cut.y + cut.h + GAP + bh <= vh - EDGE },
    { p: { left: cx, top: cut.y - bh - GAP }, fits: cut.y - bh - GAP >= EDGE },
  ]
  const room = options.filter((o) => o.fits && !intersects(o.p, bw, bh, cut))
  const clean = room.find((o) => !inToastZone(o.p, bw, bh, vw, vh))
  if (clean) return clean.p
  if (room[0]) return room[0].p
  return { left: cx, top: cy }
}

// ---------------------------------------------------------------------------
// DOM probes
// ---------------------------------------------------------------------------

function onScreen(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** The step's anchor, or its fallback when the real one is not rendered (an unaffordable store). */
function findAnchor(step: TourStep): HTMLElement | null {
  const el = document.querySelector(`[data-tour="${step.anchor}"]`)
  if (onScreen(el)) return el
  if (!step.fallbackAnchor) return null
  const alt = document.querySelector(`[data-tour="${step.fallbackAnchor}"]`)
  return onScreen(alt) ? alt : null
}

function anyDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

function feedTabSelected(): boolean {
  return document.querySelector('[data-tour="center-tab-feed"]')?.getAttribute('aria-selected') === 'true'
}

const clampStep = (n: number): number => clamp(Math.trunc(n), 0, TUTORIAL_STEPS.length - 1)

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------

export function Tutorial() {
  const store = useGameStore()
  const reduced = useReducedMotionPref()
  const { active, step } = useTour()
  const def: TourStep | undefined = active ? TUTORIAL_STEPS[step] : undefined

  const [box, setBox] = useState<Box | null>(null)
  const [dialogUp, setDialogUp] = useState(false)
  const [size, setSize] = useState({ w: BUBBLE_W, h: BUBBLE_FALLBACK_H })
  const [view, setView] = useState({ w: 0, h: 0 })
  /** Counters frozen when the tour opened. State, not a ref: the bubble renders from it. */
  const [from, setFrom] = useState<TourStart>(COLD)

  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const advanceRef = useRef<() => void>(() => {})

  // A dialog that is up while the tour is not running is nobody's business.
  const hidden = active && dialogUp

  // -- lifecycle ------------------------------------------------------------

  const finish = useCallback(() => {
    if (!store.state.flags[TUTORIAL_FLAG]) store.completeTutorial()
    endTour()
  }, [store])

  /** Open the tour at the first step that is not already satisfied from `cursor` on. */
  const begin = useCallback(
    (cursor: number) => {
      const snapshot = tourStart(store.state, Date.now())
      const at = firstIncompleteStep(store.state, snapshot, clampStep(cursor))
      if (at >= TUTORIAL_STEPS.length) {
        finish()
        return
      }
      setFrom(snapshot)
      setBox(null)
      startTour(at)
    },
    [finish, store],
  )

  const advance = useCallback(() => {
    const next = firstIncompleteStep(store.state, from, step + 1)
    if (next >= TUTORIAL_STEPS.length) finish()
    else setTourStep(next)
  }, [finish, from, step, store])

  // Kept in a ref so the interval and the store subscription below never call a stale closure.
  useEffect(() => {
    advanceRef.current = advance
  })

  // Auto-start, once, on the boot this shell mounted for.
  useEffect(() => {
    if (store.state.flags[TUTORIAL_FLAG]) return
    if (!isNewPlayer(store.state)) {
      // Real progress and no flag: a save from before the tour existed. Mark it taught quietly so
      // the help dot clears and nothing ever opens itself on a veteran.
      store.completeTutorial()
      return
    }
    const t = window.setTimeout(() => {
      const ctx = { offlinePending: store.offlineReport !== null, modalOpen: anyDialogOpen() }
      if (!shouldAutoStart(store.state, ctx)) return
      begin(readTourCursor() ?? 0)
    }, AUTO_START_MS)
    return () => window.clearTimeout(t)
  }, [begin, store])

  // Replay: the header's `?` tile and the `?` hotkey both raise `comfy:open-modal` with 'help'.
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<unknown>).detail !== 'help') return
      begin(0)
    }
    window.addEventListener(OPEN_MODAL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_MODAL_EVENT, onOpen)
  }, [begin])

  // A cursor past the last step (an old build, a hand-edited value) must not leave a dead overlay.
  useEffect(() => {
    if (active && !def) finish()
  }, [active, def, finish])

  // -- hide behind dialogs --------------------------------------------------

  useEffect(() => {
    if (!active) return
    const poll = () => setDialogUp(anyDialogOpen())
    poll()
    const id = window.setInterval(poll, MODAL_POLL_MS)
    return () => window.clearInterval(id)
  }, [active])

  // -- measuring ------------------------------------------------------------

  useEffect(() => {
    if (!active) return
    const read = () => setView({ w: window.innerWidth, h: window.innerHeight })
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [active])

  useEffect(() => {
    if (!active || hidden || !def) return
    const el = findAnchor(def)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, hidden, def])

  useEffect(() => {
    if (!active || hidden || !def) return
    let missingSince = 0
    const run = () => {
      const el = findAnchor(def)
      if (!el) {
        if (missingSince === 0) missingSince = performance.now()
        else if (performance.now() - missingSince >= MISSING_MS) advanceRef.current()
        return
      }
      missingSince = 0
      const r = el.getBoundingClientRect()
      const next: Box = { x: r.left, y: r.top, w: r.width, h: r.height }
      setBox((prev) => (prev && sameBox(prev, next) ? prev : next))
      // The Feed tab is a DOM fact, not a state one, so it is read on the same tick.
      if (def.id === 'feed' && feedTabSelected()) advanceRef.current()
    }
    run()
    const id = window.setInterval(run, MEASURE_MS)
    window.addEventListener('resize', run)
    // Capture phase: the three columns scroll inside themselves and those events do not bubble.
    window.addEventListener('scroll', run, true)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', run)
      window.removeEventListener('scroll', run, true)
    }
  }, [active, hidden, def])

  // The bubble's height changes with its copy, and the placement needs the real number.
  useEffect(() => {
    const el = bubbleRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize((prev) => (Math.abs(prev.h - r.height) < 1 && Math.abs(prev.w - r.width) < 1 ? prev : { w: r.width, h: r.height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [active, hidden, def])

  // -- advancing ------------------------------------------------------------

  // One subscription per step. `check()` runs on entry too, which is what completes a step the
  // player already satisfied while wandering.
  useEffect(() => {
    if (!active || hidden || !def) return
    const check = () => {
      if (def.isDone(store.state, from)) advanceRef.current()
    }
    check()
    return store.subscribe(check)
  }, [active, hidden, def, from, store])

  useEffect(() => {
    if (!active || def?.id !== 'trending') return
    const onPick = () => advanceRef.current()
    window.addEventListener(PICK_HASHTAG_EVENT, onPick)
    return () => window.removeEventListener(PICK_HASHTAG_EVENT, onPick)
  }, [active, def])

  // -- render ---------------------------------------------------------------

  const showing = active && !hidden && def !== undefined && box !== null && view.w > 0
  const cut = box ? inflate(box) : null
  const pos = cut ? placeBubble(cut, size.w, size.h, view.w, view.h) : null
  const move = reduced ? INSTANT : SPRING
  const fade = reduced ? INSTANT : FADE

  return (
    <AnimatePresence>
      {showing && cut ? (
        <motion.svg
          key="tour-dim"
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[70] h-full w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
        >
          <defs>
            <mask id={MASK_ID}>
              <rect x={0} y={0} width="100%" height="100%" fill="#ffffff" />
              <motion.rect
                x={0}
                y={0}
                rx={RADIUS}
                ry={RADIUS}
                fill="#000000"
                initial={false}
                animate={{ x: cut.x, y: cut.y, width: cut.w, height: cut.h }}
                transition={move}
              />
            </mask>
          </defs>
          <rect x={0} y={0} width="100%" height="100%" className="fill-charcoal-800" fillOpacity={0.72} mask={`url(#${MASK_ID})`} />
          <motion.rect
            x={0}
            y={0}
            rx={RADIUS}
            ry={RADIUS}
            fill="none"
            strokeWidth={2}
            className="stroke-electric-400"
            initial={false}
            animate={{ x: cut.x, y: cut.y, width: cut.w, height: cut.h }}
            transition={move}
          />
        </motion.svg>
      ) : null}

      {showing && def && pos ? (
        <motion.div
          key="tour-bubble"
          ref={bubbleRef}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-0 left-0 z-[71] w-[300px]"
          initial={{ opacity: 0, scale: reduced ? 1 : 0.97, x: pos.left, y: pos.top }}
          animate={{ opacity: 1, scale: 1, x: pos.left, y: pos.top }}
          exit={{ opacity: 0, scale: reduced ? 1 : 0.98 }}
          transition={reduced ? INSTANT : { default: FADE, x: SPRING, y: SPRING }}
        >
          <Bubble def={def} step={step} start={from} onNext={advance} onSkip={finish} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// Bubble
// ---------------------------------------------------------------------------

interface BubbleProps {
  def: TourStep
  step: number
  start: TourStart
  onNext: () => void
  onSkip: () => void
}

function Bubble({ def, step, start, onNext, onSkip }: BubbleProps) {
  return (
    <Panel
      stripe="electric"
      className="shadow-[0_4px_0_#0e0e0f]"
      bodyClassName="flex flex-col gap-2.5 p-3.5"
      title={
        <span className="flex items-center gap-1.5">
          <Compass size={12} aria-hidden="true" className="text-electric-400" />
          Tutorial
          <span className="text-smoke-800" aria-hidden="true">
            ·
          </span>
          <span className="tabular-nums text-smoke-100">
            {step + 1} / {TUTORIAL_STEPS.length}
          </span>
        </span>
      }
      right={
        <button
          type="button"
          onClick={onSkip}
          className="pointer-events-auto rounded-comfy px-1.5 py-0.5 text-[11px] font-semibold text-smoke-800 transition-colors hover:bg-charcoal-500 hover:text-smoke-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
        >
          Skip tour
        </button>
      }
    >
      <h3 className="text-sm font-extrabold tracking-tight text-smoke-100">{def.title}</h3>
      <p className="text-xs leading-relaxed text-smoke-600">{def.body}</p>
      <div className="flex items-center justify-between gap-3 pt-0.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {TUTORIAL_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === step ? 'bg-electric-400' : i < step ? 'bg-smoke-800' : 'bg-charcoal-400',
              )}
            />
          ))}
        </div>
        {def.kind === 'info' ? (
          <ModalButton tone="primary" size="sm" className="pointer-events-auto" onClick={onNext}>
            {def.cta}
          </ModalButton>
        ) : (
          <Hint def={def} start={start} />
        )}
      </div>
    </Panel>
  )
}

/** The "do it to continue" line. Step one counts the clicks off as they land. */
function Hint({ def, start }: { def: TourStep; start: TourStart }) {
  const clicked = useGame((s) => (def.id === 'click' ? clamp(s.totalClicks - start.clicks, 0, TUTORIAL_CLICKS) : 0))
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-electric-400">
      <span className="cc-breathe size-1.5 rounded-full bg-electric-400" aria-hidden="true" />
      {def.cta}
      {def.id === 'click' ? (
        <span className="tabular-nums text-smoke-600">
          {clicked} / {TUTORIAL_CLICKS}
        </span>
      ) : null}
    </span>
  )
}
