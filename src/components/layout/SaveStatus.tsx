'use client'
/**
 * The header's autosave chip: proof that the game is writing, which is the whole point of making
 * autosave visible. Left of the account menu, hidden below lg.
 *
 * - not mounted yet: `Autosave`, no timestamp, neutral colours
 * - normal: `Saved just now`, then `Saved 12s ago`, `Saved 3m ago`
 * - autosave off (amber): `Autosave off · saved 12s ago`
 * - the browser refused the write (slot-vae): `Not saving`, plus one danger toast, once
 *
 * The timestamp comes from the store's `savedAt`, falling back to `state.meta.lastSavedAt` until
 * the first write of the session lands. Nothing here toasts on a successful save.
 *
 * The placeholder state exists because all three inputs (the clock, the loaded save, the write
 * outcome) only exist in the browser while the header itself is server-rendered on /hub and
 * /leaderboard: without it the server's "Saved 30m ago" met the client's "Saved just now" and
 * React threw a hydration error on every load of those routes.
 */
import { useEffect, useRef } from 'react'
import { HardDriveDownload, TriangleAlert } from 'lucide-react'
import { motion, useAnimationControls } from 'motion/react'
import { Tooltip } from '@/components/common/Tooltip'
import { saveStatusTip } from '@/components/common/tooltipCopy'
import { toast } from '@/components/overlays/useToasts'
import { cn } from '@/lib/utils'
import { useMounted } from '@/hooks/useMounted'
import { useNow } from '@/hooks/useNow'
import { useGameShallow } from '@/state/useGame'

/** Anything younger than this reads as "just now" rather than "0s ago". */
const JUST_NOW_MS = 2000
/** How long the disk icon stays popped after a write. */
const POP_MS = 250
/** What the chip says before it knows anything: the feature's name, no timestamp. */
const PLACEHOLDER = 'Autosave'

/** `just now`, `12s ago`, `3m ago`, `2h ago`. */
export function savedAgo(savedAt: number, now: number): string {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return 'not yet'
  const ms = Math.max(0, now - savedAt)
  if (ms < JUST_NOW_MS) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

function openSettings(): void {
  window.dispatchEvent(new CustomEvent<string>('comfy:open-modal', { detail: 'settings' }))
}

export function SaveStatus({ motionOff = false }: { motionOff?: boolean }) {
  const mounted = useMounted()
  const now = useNow(1000)
  const { savedAt, autosave, failed } = useGameShallow((s, _d, store) => ({
    savedAt: store.savedAt > 0 ? store.savedAt : s.meta.lastSavedAt,
    autosave: s.settings.autosave,
    failed: store.saveError,
  }))

  // Pop the disk icon on every write, and warn once when the browser starts refusing them.
  const pop = useAnimationControls()
  const lastWrite = useRef(savedAt)
  const warned = useRef(false)

  useEffect(() => {
    if (savedAt === lastWrite.current) return
    lastWrite.current = savedAt
    if (motionOff) return
    void pop.start({ scale: [1, 1.3, 1] }, { duration: POP_MS / 1000 })
  }, [savedAt, motionOff, pop])

  useEffect(() => {
    if (!failed) {
      warned.current = false
      return
    }
    if (warned.current) return
    warned.current = true
    toast('The browser refused the write (storage full or private mode).', {
      title: 'Not saving',
      description: 'Export a code from Settings before you lose this.',
      tone: 'danger',
      key: 'save-failed',
      durationMs: 8000,
    })
  }, [failed])

  // Before mount the save, the clock and the write outcome are all unknown, so every branch below
  // (the label, the icon, the border colour) holds still rather than guessing.
  const ago = savedAgo(savedAt, now)
  const warn = mounted && failed
  const quiet = mounted && !failed && !autosave
  const full = !mounted ? PLACEHOLDER : failed ? 'Not saving' : autosave ? `Saved ${ago}` : `Autosave off · saved ${ago}`
  const short = !mounted ? PLACEHOLDER : failed ? 'No save' : ago
  const tip = saveStatusTip({ autosave, failed, status: mounted && !failed ? `Saved ${ago}` : undefined })

  return (
    <Tooltip {...tip} side="bottom">
      <motion.button
        type="button"
        onClick={openSettings}
        whileTap={motionOff ? undefined : { scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        aria-label={`${full}. Open settings.`}
        className={cn(
          'hidden h-9 shrink-0 items-center gap-1.5 rounded-comfy border border-charcoal-400 bg-charcoal-600 px-2 text-[11px] font-semibold whitespace-nowrap tabular-nums transition-colors hover:border-charcoal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400 lg:inline-flex',
          warn ? 'border-slot-vae/60 text-slot-vae' : quiet ? 'border-credits/60 text-credits' : 'text-smoke-600 hover:text-smoke-100',
        )}
      >
        <motion.span aria-hidden="true" animate={pop} className="inline-flex shrink-0">
          {warn ? <TriangleAlert size={14} /> : <HardDriveDownload size={14} className={quiet ? 'text-credits' : 'text-slot-mask'} />}
        </motion.span>
        <span className="hidden 2xl:inline">{full}</span>
        <span className="2xl:hidden">{short}</span>
      </motion.button>
    </Tooltip>
  )
}
