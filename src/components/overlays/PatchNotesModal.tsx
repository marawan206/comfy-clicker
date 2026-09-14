'use client'
/**
 * Patch notes, in the game, read straight off `src/data/patchNotes.ts`.
 *
 * The newest version is open; older ones are collapsed rows a player can expand. Opening the modal
 * stamps the current version as seen, which is what clears the dot on the Settings tile, so a
 * player who has read the notes is never nagged about them again.
 *
 * `CHANGELOG.md` is generated from the same file, so the repo and the game can never disagree
 * about what shipped.
 */
import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { ModalBase, SectionLabel } from '@/components/overlays/ModalBase'
import { CHANGE_LABELS, CHANGE_ORDER, GAME_VERSION, PATCH_NOTES, type ChangeKind, type PatchNote } from '@/data/patchNotes'
import { cn } from '@/lib/utils'
import { writeVersionSeen } from '@/lib/version'

export interface PatchNotesModalProps {
  open: boolean
  onClose: () => void
}

/** Bucket tints. Balance is amber because it is the one players argue about. */
const KIND_TINT: Record<ChangeKind, string> = {
  added: 'text-electric-400',
  changed: 'text-[#7f8dff]',
  balance: 'text-credits',
  fixed: 'text-smoke-600',
}

/** `2026-09-14` → `14 Sep 2026`, with no timezone in sight. */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10))
  if (!y || !m || !d) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1] ?? ''} ${y}`
}

export function PatchNotesModal({ open, onClose }: PatchNotesModalProps) {
  // Opening the notes is the only thing that clears the dot: a player who never opens them keeps
  // being told there is something new, which is the honest behaviour.
  useEffect(() => {
    if (open) writeVersionSeen(GAME_VERSION)
  }, [open])

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="Patch notes"
      icon={<ScrollText size={16} />}
      stripe="clip"
      size="lg"
      footer={
        <p className="mr-auto text-left text-[11px] text-smoke-600">
          Running v{GAME_VERSION} · {PATCH_NOTES.length} {PATCH_NOTES.length === 1 ? 'entry' : 'entries'} · saves carry across versions
        </p>
      }
    >
      <div className="flex flex-col gap-3">
        {PATCH_NOTES.map((note, i) => (
          <NoteCard key={note.version} note={note} defaultOpen={i === 0} />
        ))}
      </div>
    </ModalBase>
  )
}

function NoteCard({ note, defaultOpen }: { note: PatchNote; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const hotfix = note.kind === 'hotfix'

  return (
    <section
      className={cn(
        'rounded-xl border-2 border-charcoal-400 border-l-4 bg-charcoal-700/50',
        hotfix ? 'border-l-slot-vae' : 'border-l-electric-400',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
      >
        <span className="font-mono text-sm font-extrabold tabular-nums text-smoke-100">v{note.version}</span>
        <span
          className={cn(
            'rounded-[0.354em] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]',
            hotfix ? 'bg-slot-vae text-charcoal-800' : 'bg-electric-400 text-charcoal-800',
          )}
        >
          {hotfix ? 'Hotfix' : 'Release'}
        </span>
        <span className="text-sm font-bold text-smoke-100">{note.title}</span>
        <span className="ml-auto text-[11px] text-smoke-600 tabular-nums">{prettyDate(note.date)}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {note.summary ? <p className="text-xs text-smoke-600">{note.summary}</p> : null}
          {CHANGE_ORDER.map((kind) => {
            const rows = note.changes.filter((c) => c.kind === kind)
            if (rows.length === 0) return null
            return (
              <div key={kind}>
                <SectionLabel className={cn('mb-1', KIND_TINT[kind])}>{CHANGE_LABELS[kind]}</SectionLabel>
                <ul className="flex flex-col gap-1">
                  {rows.map((c) => (
                    <li key={c.text} className="flex gap-2 text-xs text-smoke-100">
                      <span aria-hidden="true" className={cn('select-none', KIND_TINT[kind])}>
                        ·
                      </span>
                      <span className="min-w-0 flex-1">{c.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
