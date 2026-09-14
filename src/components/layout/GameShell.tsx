'use client'
import Image from 'next/image'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { FeedProvider } from '@/components/feed/FeedProvider'
import { FxCanvas } from '@/components/fx/FxCanvas'
import { FlagshipRig } from '@/components/hero/FlagshipRig'
import { HeroPanel } from '@/components/hero/HeroPanel'
import { NextUpPanel } from '@/components/hero/NextUpPanel'
import { PowerMeter } from '@/components/hero/PowerMeter'
import { QueueMini } from '@/components/hero/QueueMini'
import { CenterTabs } from '@/components/layout/CenterTabs'
import { DotGrid } from '@/components/layout/DotGrid'
import { Header } from '@/components/layout/Header'
import { NewsTicker } from '@/components/layout/NewsTicker'
import { Overlays } from '@/components/overlays/Overlays'
import { Tutorial } from '@/components/overlays/Tutorial'
import { RackPanel } from '@/components/rigs/RackPanel'
import { StorePanel } from '@/components/store/StorePanel'
import { LOADING_LINES } from '@/data/flavor'
import { useDisplayFlags } from '@/hooks/useDisplayFlags'
import { useEasterEggs } from '@/hooks/useEasterEggs'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useSfx } from '@/hooks/useSfx'
import { cn } from '@/lib/utils'
import { useGame } from '@/state/useGame'

/** The splash stays up at least this long so it reads as a boot screen, not a flicker… */
const SPLASH_MIN_MS = 350
/** …and never longer than this, whatever the store is doing. */
const SPLASH_MAX_MS = 600
/** Boot-log line cadence on the splash. */
const SPLASH_LINE_MS = 180

// ---------------------------------------------------------------------------
// GameShell
// ---------------------------------------------------------------------------

/**
 * The whole game page: dot-grid canvas, header, ticker, the three-column workbench, the FX
 * canvas and every overlay, all inside the live-feed provider. Global hotkeys and easter eggs are
 * registered here exactly once. Before the store has loaded the save a short splash covers the
 * page; the shell itself only mounts client-side once the state is real, so nothing pops.
 */
export function GameShell() {
  useHotkeys()
  useSfx()
  useEasterEggs()

  const started = useGame((_s, _d, store) => store.started)
  // Mirrors `projector` / `reducedMotion` onto <html> for every route that keeps the store alive.
  const { projector, reducedMotion: reducedSetting } = useDisplayFlags()
  const osReduced = useReducedMotion()
  const reduced = Boolean(osReduced) || reducedSetting
  const ready = useBootReady(started)
  // A hidden tab never ticks requestAnimationFrame, so a boot that happens in the background
  // (opened behind another tab, screen locked) would leave the splash's exit and the workbench's
  // fade stuck until the tab is shown. Skip both animations while hidden.
  const visible = useDocumentVisible()
  const instant = reduced || !visible

  return (
    <FeedProvider>
      <DotGrid />
      <div className={cn('relative z-10 flex min-h-dvh flex-col', projector && 'projector', reduced && 'reduced-motion')}>
        {ready ? (
          <motion.div
            className="flex min-h-dvh flex-col"
            initial={instant ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <Header />
            {/* 32 px slot; the ticker paints its own chrome (pill, border, fades). */}
            <div className="relative z-10 h-8 shrink-0 overflow-hidden">
              <NewsTicker />
            </div>
            <Workbench />
            <FxCanvas />
            <Overlays />
            <Tutorial />
          </motion.div>
        ) : null}
      </div>
      <AnimatePresence>{ready ? null : <Splash key="splash" instant={instant} />}</AnimatePresence>
    </FeedProvider>
  )
}

// ---------------------------------------------------------------------------
// Three-column workbench
// ---------------------------------------------------------------------------

function Workbench() {
  return (
    <main
      id="main"
      className={cn(
        'grid grid-cols-1 gap-4 p-4',
        // Desktop: one row that exactly fills the viewport under the header (4rem) and ticker (2rem);
        // minmax(0,1fr) lets the row shrink below its content so the columns scroll internally.
        'lg:h-[calc(100dvh-6rem)] lg:min-h-0 lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)_minmax(300px,1fr)] lg:grid-rows-[minmax(0,1fr)]',
      )}
    >
      {/* Scrolling columns keep 4 px of bottom padding so the last panel's hard shadow is not clipped. */}
      <aside aria-label="Your rig" className="relative flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pr-0.5 lg:pb-1 [&>*]:shrink-0">
        <HeroPanel />
        <NextUpPanel />
        <FlagshipRig />
        <PowerMeter />
        <QueueMini />
      </aside>

      <section aria-label="Workbench" className="relative flex min-h-0 flex-col gap-4">
        {/* The rack collapses and caps itself at 40vh; shrink-0 keeps the tabs from squashing it. */}
        <div className="flex shrink-0 flex-col">
          <RackPanel />
        </div>
        <CenterTabs />
      </section>

      <aside aria-label="Store" className="relative flex min-h-0 flex-col overflow-x-hidden lg:overflow-y-auto lg:pr-0.5 lg:pb-1">
        <StorePanel />
      </aside>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Splash
// ---------------------------------------------------------------------------

/** True once the store has loaded and the minimum hold has passed, or the hard cap is reached. */
function useBootReady(started: boolean): boolean {
  const [minDone, setMinDone] = useState(false)
  const [maxDone, setMaxDone] = useState(false)
  useEffect(() => {
    const a = window.setTimeout(() => setMinDone(true), SPLASH_MIN_MS)
    const b = window.setTimeout(() => setMaxDone(true), SPLASH_MAX_MS)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [])
  return maxDone || (started && minDone)
}

const subscribeVisibility = (cb: () => void): (() => void) => {
  document.addEventListener('visibilitychange', cb)
  return () => document.removeEventListener('visibilitychange', cb)
}
const getVisible = (): boolean => document.visibilityState === 'visible'
const getVisibleServer = (): boolean => true

/** True while the document is visible; true on the server and the first client frame. */
function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, getVisible, getVisibleServer)
}

function Splash({ instant }: { instant: boolean }) {
  // Line 0 renders on the server and on the first client frame (deterministic, no hydration
  // mismatch); after mount the boot log steps on from a random line so repeat loads differ.
  const [line, setLine] = useState(0)
  useEffect(() => {
    let i = Math.floor(Math.random() * LOADING_LINES.length)
    const id = window.setInterval(() => {
      i = (i + 1) % LOADING_LINES.length
      setLine(i)
    }, SPLASH_LINE_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="cc-dot-grid fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 text-smoke-100"
      initial={false}
      exit={instant ? undefined : { opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <div className="cc-vignette pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative">
        <div
          aria-hidden="true"
          className="cc-breathe absolute -inset-6 rounded-full bg-electric-400/20 blur-2xl"
        />
        <Image
          src="/brand/comfy-logo.svg"
          alt="Comfy"
          width={96}
          height={96}
          priority
          draggable={false}
          className="relative size-24 select-none drop-shadow-[0_8px_0_#0e0e0f]"
        />
      </div>
      <div className="relative flex items-baseline gap-2 text-2xl font-extrabold tracking-tight">
        <span>Comfy</span>
        <span className="text-electric-400">Clicker</span>
      </div>
      <div className="relative h-1 w-56 overflow-hidden rounded-full bg-charcoal-500" aria-hidden="true">
        <motion.div
          className="h-full w-full bg-electric-400"
          style={{ originX: 0 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: SPLASH_MAX_MS / 1000, ease: 'easeInOut' }}
        />
      </div>
      <p className="relative min-h-4 text-xs font-medium tabular-nums text-smoke-600">{LOADING_LINES[line]}</p>
    </motion.div>
  )
}
