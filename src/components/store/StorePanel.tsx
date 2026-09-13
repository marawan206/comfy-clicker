'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIEvent } from 'react'
import { motion } from 'motion/react'
import { Panel, type Stripe } from '@/components/common/Panel'
import { ModelsTab } from '@/components/store/ModelsTab'
import { useGame } from '@/state/useGame'
import { cn } from '@/lib/utils'
import { HardwareTab, type HardwareFocus } from './HardwareTab'
import { PowerTab } from './PowerTab'
import { UpgradesTab } from './UpgradesTab'
import {
  STORE_TAB_EVENT,
  STORE_TABS,
  useAffordableCounts,
  useLocalState,
  useReducedMotionPref,
  type StoreTab,
  type StoreTabEventDetail,
} from './storeHooks'

const TAB_KEY = 'comfy-clicker:store-tab'
const TAB_META: Record<StoreTab, { label: string; stripe: Stripe; accent: string }> = {
  hardware: { label: 'Hardware', stripe: 'image', accent: 'text-slot-image' },
  upgrades: { label: 'Upgrades', stripe: 'cond', accent: 'text-slot-cond' },
  models: { label: 'Models', stripe: 'latent', accent: 'text-slot-latent' },
  power: { label: 'Power', stripe: 'vae', accent: 'text-slot-vae' },
}

/**
 * Fades the top 14 px of the list while it is scrolled, so rows slide under the tab row instead of
 * being chopped by a hard edge. Written straight to the DOM node: no state, no re-render per frame.
 */
function markScrolled(e: UIEvent<HTMLElement>): void {
  const el = e.currentTarget
  const next = el.scrollTop > 0 ? 'true' : 'false'
  if (el.dataset.scrolled !== next) el.dataset.scrolled = next
}

function isStoreTab(x: unknown): x is StoreTab {
  return typeof x === 'string' && (STORE_TABS as readonly string[]).includes(x)
}

/** The right-hand store: Hardware | Upgrades | Models | Power, with affordability badges on the tabs. */
export function StorePanel() {
  const reduced = useReducedMotionPref()
  const [tab, setTab] = useLocalState<StoreTab>(TAB_KEY, 'hardware', STORE_TABS)
  const counts = useAffordableCounts()
  const throttled = useGame((_s, d) => d.throttled)
  const tabRefs = useRef<Map<StoreTab, HTMLButtonElement>>(new Map())
  const [focus, setFocus] = useState<HardwareFocus | null>(null)

  useEffect(() => {
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<StoreTabEventDetail | string>).detail
      const next = typeof detail === 'string' ? detail : detail?.tab
      if (isStoreTab(next)) setTab(next)
      const family = typeof detail === 'object' && detail ? detail.family : undefined
      if (family) setFocus((prev) => ({ family, nonce: (prev?.nonce ?? 0) + 1 }))
    }
    window.addEventListener(STORE_TAB_EVENT, onTab)
    return () => window.removeEventListener(STORE_TAB_EVENT, onTab)
  }, [setTab])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, current: StoreTab) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      const i = STORE_TABS.indexOf(current)
      const next =
        e.key === 'Home' ? STORE_TABS[0] : e.key === 'End' ? STORE_TABS[STORE_TABS.length - 1] : STORE_TABS[(i + (e.key === 'ArrowRight' ? 1 : STORE_TABS.length - 1)) % STORE_TABS.length]
      if (!next) return
      setTab(next)
      tabRefs.current.get(next)?.focus()
    },
    [setTab],
  )

  const badge = (t: StoreTab): { n: number; warn: boolean } => {
    if (t === 'hardware') return { n: counts.hardware, warn: false }
    if (t === 'upgrades') return { n: counts.upgrades, warn: false }
    if (t === 'power') return { n: 0, warn: throttled }
    return { n: 0, warn: false }
  }

  return (
    <Panel title="Store" stripe={TAB_META[tab].stripe} className="h-full min-h-0" bodyClassName="flex min-h-0 flex-col p-0">
      <div role="tablist" aria-label="Store sections" className="relative flex shrink-0 items-stretch gap-0.5 overflow-hidden border-b border-charcoal-400/70 px-1.5 pt-1">
        {STORE_TABS.map((t) => {
          const active = t === tab
          const b = badge(t)
          return (
            <button
              key={t}
              ref={(el) => {
                if (el) tabRefs.current.set(t, el)
                else tabRefs.current.delete(t)
              }}
              type="button"
              role="tab"
              id={`store-tab-${t}`}
              aria-selected={active}
              aria-controls={`store-panel-${t}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={(e) => onKeyDown(e, t)}
              className={cn(
                'relative flex min-w-0 flex-auto items-center justify-center gap-1 rounded-t-lg px-1 py-2 text-[10px] font-bold uppercase tracking-[0.02em] transition-colors min-[1400px]:px-1.5 min-[1400px]:text-[11px] min-[1400px]:tracking-[0.04em]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400 focus-visible:ring-inset',
                active ? 'text-smoke-100' : 'text-smoke-600 hover:text-smoke-100',
              )}
            >
              <span className="truncate">{TAB_META[t].label}</span>
              {b.n > 0 && (
                <span
                  aria-label={`${b.n} affordable`}
                  className="grid h-3.5 min-w-3.5 place-items-center rounded-[0.354em] bg-credits px-0.5 text-[9px] font-extrabold tabular-nums leading-none text-charcoal-800 min-[1400px]:h-4 min-[1400px]:min-w-4 min-[1400px]:px-1 min-[1400px]:text-[10px]"
                >
                  {b.n > 99 ? '99+' : b.n}
                </span>
              )}
              {b.warn && (
                <span aria-label="Breaker tripped" className="size-2 rounded-full bg-slot-vae shadow-[0_0_0_3px_rgba(255,110,110,0.25)]" />
              )}
              {active && (
                <motion.span
                  layoutId="store-tab-underline"
                  aria-hidden="true"
                  className={cn('absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-current', TAB_META[t].accent)}
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 36 }}
                />
              )}
            </button>
          )
        })}
      </div>

      <div
        data-scrolled="false"
        onScroll={markScrolled}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:#3c3d42_transparent] [scrollbar-width:thin] data-[scrolled=true]:[mask-image:linear-gradient(to_bottom,transparent,black_14px)]"
      >
        {/* Swap synchronously and only fade in (like CenterTabs): no exit animation to wait on, so a
            hidden or rAF-throttled tab can never leave the old panel stuck under the new tab. */}
        <motion.div
          key={tab}
          role="tabpanel"
          id={`store-panel-${tab}`}
          aria-labelledby={`store-tab-${tab}`}
          initial={reduced ? false : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          className="flex h-full min-h-0 flex-col"
        >
          {tab === 'hardware' && <HardwareTab focus={focus} />}
          {tab === 'upgrades' && <UpgradesTab />}
          {tab === 'models' && <ModelsTab />}
          {tab === 'power' && <PowerTab />}
        </motion.div>
      </div>
    </Panel>
  )
}
