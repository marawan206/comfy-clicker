'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, UIEvent } from 'react'
import { ClipboardList, Newspaper, Sparkles, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { FeedPanel } from '@/components/feed/FeedPanel'
import { TrendingStrip } from '@/components/feed/TrendingStrip'
import { ContractsPanel } from '@/components/studio/ContractsPanel'
import { StudioPanel } from '@/components/studio/StudioPanel'
import { formatNum } from '@/game/format'
import { cn } from '@/lib/utils'
import { useGame } from '@/state/useGame'

export type CenterTabId = 'studio' | 'feed' | 'contracts'

const STORAGE_KEY = 'comfy-clicker:center-tab'
/** `window.dispatchEvent(new CustomEvent('comfy:center-tab', { detail: 'feed' }))` switches the tab from anywhere. */
export const CENTER_TAB_EVENT = 'comfy:center-tab'

interface TabDef {
  id: CenterTabId
  label: string
  icon: LucideIcon
  hint: string
}

const TABS: readonly TabDef[] = [
  { id: 'studio', label: 'Studio', icon: Sparkles, hint: 'Pick a model, write a prompt, queue a post' },
  { id: 'feed', label: 'Feed', icon: Newspaper, hint: 'Your posts settling, plus what the real Comfy community is saying' },
  { id: 'contracts', label: 'Contracts', icon: ClipboardList, hint: 'Client briefs: finish the goal, claim the credits' },
]

const isTabId = (v: unknown): v is CenterTabId => v === 'studio' || v === 'feed' || v === 'contracts'

/**
 * Lazy initialiser. The shell only mounts this component client-side (after the splash), so the
 * stored choice can be read synchronously without a hydration mismatch or a first-frame flash.
 */
function readStoredTab(): CenterTabId {
  if (typeof window === 'undefined') return 'studio'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return isTabId(v) ? v : 'studio'
  } catch {
    return 'studio'
  }
}

function storeTab(id: CenterTabId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* private mode / quota, the choice just does not persist */
  }
}

/**
 * Fades the top 14 px of the panel while it is scrolled, so content slides under the trending
 * strip instead of hitting a hard edge. Written straight to the DOM node: no state, no re-render
 * on a scroll frame, and an unscrolled panel keeps its crisp border.
 */
function markScrolled(e: UIEvent<HTMLElement>): void {
  const el = e.currentTarget
  const next = el.scrollTop > 0 ? 'true' : 'false'
  if (el.dataset.scrolled !== next) el.dataset.scrolled = next
}

function useMotionOff(): boolean {
  const os = useReducedMotion()
  const setting = useGame((s) => s.settings.reducedMotion)
  return Boolean(os) || setting
}

// ---------------------------------------------------------------------------
// CenterTabs
// ---------------------------------------------------------------------------

/**
 * Studio | Feed | Contracts. The active tab persists in localStorage, arrow keys move between
 * tabs, and the TrendingStrip sits above Studio and Feed (contracts do not care what is trending).
 */
export function CenterTabs() {
  const [tab, setTab] = useState<CenterTabId>(readStoredTab)
  const off = useMotionOff()
  const tabRefs = useRef(new Map<CenterTabId, HTMLButtonElement>())

  const select = useCallback((id: CenterTabId) => {
    setTab(id)
    storeTab(id)
  }, [])

  useEffect(() => {
    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail
      if (isTabId(detail)) select(detail)
    }
    window.addEventListener(CENTER_TAB_EVENT, onExternal)
    return () => window.removeEventListener(CENTER_TAB_EVENT, onExternal)
  }, [select])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.findIndex((t) => t.id === tab)
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next === null) return
    e.preventDefault()
    const id = TABS[next].id
    select(id)
    tabRefs.current.get(id)?.focus()
  }

  const showTrending = tab !== 'contracts'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        role="tablist"
        aria-label="Workbench"
        onKeyDown={onKeyDown}
        className="flex shrink-0 items-center gap-1 rounded-2xl border-2 border-charcoal-400 bg-charcoal-600 p-1 shadow-[0_4px_0_#0e0e0f]"
      >
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            def={t}
            active={t.id === tab}
            off={off}
            onSelect={select}
            ref={(el) => {
              if (el) tabRefs.current.set(t.id, el)
              else tabRefs.current.delete(t.id)
            }}
          />
        ))}
      </div>

      {/* `@container` here, not on the viewport: the strip answers to the centre column's real
          width, so it stays one line whatever the window does. `pb-1` keeps its 4 px hard shadow
          off the panel border below it. */}
      <AnimatePresence initial={false}>
        {showTrending ? (
          <motion.div
            key="trending"
            className="@container shrink-0 pb-1"
            initial={off ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={off ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <TrendingStrip />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The panel swaps immediately and only fades in: no exit animation to wait on, so a
          throttled or hidden tab can never leave the old panel stuck under a new tab. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <motion.div
          key={tab}
          role="tabpanel"
          id={`center-panel-${tab}`}
          aria-labelledby={`center-tab-${tab}`}
          tabIndex={-1}
          data-scrolled="false"
          onScroll={markScrolled}
          initial={off ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5 pb-1 focus-visible:outline-none data-[scrolled=true]:[mask-image:linear-gradient(to_bottom,transparent,black_14px)]"
        >
          {tab === 'studio' ? <StudioPanel /> : tab === 'feed' ? <FeedPanel /> : <ContractsPanel />}
        </motion.div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab button with badge
// ---------------------------------------------------------------------------

interface TabButtonProps {
  def: TabDef
  active: boolean
  off: boolean
  onSelect: (id: CenterTabId) => void
  ref: (el: HTMLButtonElement | null) => void
}

function TabButton({ def, active, off, onSelect, ref }: TabButtonProps) {
  const Icon = def.icon
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`center-tab-${def.id}`}
      // The tour spotlights the Feed tab for step three; only that one needs the hook.
      data-tour={def.id === 'feed' ? 'center-tab-feed' : undefined}
      aria-selected={active}
      aria-controls={`center-panel-${def.id}`}
      tabIndex={active ? 0 : -1}
      title={def.hint}
      onClick={() => onSelect(def.id)}
      className={cn(
        'relative flex h-9 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
        active ? 'text-charcoal-800' : 'text-smoke-600 hover:bg-charcoal-500 hover:text-smoke-100',
      )}
    >
      {active ? (
        <motion.span
          layoutId="center-tab-pill"
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-electric-400 shadow-[0_2px_0_#8a9a00]"
          transition={off ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }}
        />
      ) : null}
      <span className="relative z-10 flex items-center gap-2">
        <Icon size={15} aria-hidden="true" />
        <span>{def.label}</span>
        <TabBadge id={def.id} active={active} off={off} />
      </span>
    </button>
  )
}

/** Small live counts: queued jobs, posts still settling, contracts ready to claim. */
function TabBadge({ id, active, off }: { id: CenterTabId; active: boolean; off: boolean }) {
  const queued = useGame((s) => (id === 'studio' ? s.queue.length : 0))
  const settling = useGame((s) => {
    if (id !== 'feed') return 0
    let n = 0
    for (const p of s.posts) if (!p.granted) n++
    return n
  })
  const claimable = useGame((s) => {
    if (id !== 'contracts') return 0
    let n = 0
    for (const c of s.contracts.active) if (c.done && !c.claimed) n++
    return n
  })

  if (id === 'studio' && queued > 0) {
    return (
      <span
        className={cn(
          'rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums leading-4',
          active ? 'bg-charcoal-800/20 text-charcoal-800' : 'bg-charcoal-400 text-smoke-100',
        )}
        aria-label={`${queued} in queue`}
      >
        {formatNum(queued)}
      </span>
    )
  }
  if (id === 'feed' && settling > 0) {
    return (
      <span aria-label={`${settling} ${settling === 1 ? 'post' : 'posts'} still collecting likes`} className="relative flex size-2">
        <span
          className={cn(
            'absolute inline-flex size-full rounded-full opacity-60',
            active ? 'bg-charcoal-800' : 'bg-slot-latent',
            off ? '' : 'animate-ping',
          )}
        />
        <span className={cn('relative inline-flex size-2 rounded-full', active ? 'bg-charcoal-800' : 'bg-slot-latent')} />
      </span>
    )
  }
  if (id === 'contracts' && claimable > 0) {
    return (
      <span
        className={cn(
          'rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums leading-4',
          active ? 'bg-charcoal-800 text-electric-400' : 'bg-electric-400 text-charcoal-800',
        )}
        aria-label={`${claimable} ${claimable === 1 ? 'contract' : 'contracts'} ready to claim`}
      >
        {formatNum(claimable)}
      </span>
    )
  }
  return null
}
