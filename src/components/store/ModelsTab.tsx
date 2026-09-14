'use client'
import { useMemo, useRef } from 'react'
import { Box, Clapperboard, Cloud, Image as ImageIcon, Music } from 'lucide-react'
import { useGame } from '@/state/useGame'
import { isUnlocked } from '@/game/unlock'
import { API_COST_MULT } from '@/game/constants'
import type { ModelKind } from '@/game/types'
import { ModelCard } from './ModelCard'
import { useHighlight } from './storeHooks'

type Section = ModelKind | 'api'

const SECTIONS: ReadonlyArray<{ id: Section; label: string; icon: typeof ImageIcon; blurb: string }> = [
  { id: 'image', label: 'Image', icon: ImageIcon, blurb: 'Stills. Fast, cheap, the bread and butter of the feed.' },
  { id: 'video', label: 'Video', icon: Clapperboard, blurb: 'Bigger jobs, bigger reach. Three seconds of cat, perfected.' },
  { id: '3d', label: '3D', icon: Box, blurb: 'Meshes for people who own a printer and a grudge.' },
  { id: 'audio', label: 'Audio', icon: Music, blurb: 'Songs, stems and a jingle for the intro nobody skips.' },
  { id: 'api', label: 'API nodes', icon: Cloud, blurb: `No VRAM, +${Math.round((API_COST_MULT - 1) * 100)}% job cost. Someone else’s cluster, your prompt.` },
]

/** Ids of models the store shows, grouped: local models always, API models even before API Nodes (as locked cards). */
function useVisibleModels(): Record<Section, string[]> {
  const key = useGame((s, d, store) =>
    store.catalog.models
      .filter((m) => m.api || isUnlocked(m.unlock, s, d, store.catalog))
      .map((m) => `${m.api ? 'api' : m.kind}:${m.id}`)
      .join('|'),
  )
  return useMemo(() => {
    const out: Record<Section, string[]> = { image: [], video: [], '3d': [], audio: [], api: [] }
    if (!key) return out
    for (const entry of key.split('|')) {
      const sep = entry.indexOf(':')
      const section = entry.slice(0, sep) as Section
      out[section]?.push(entry.slice(sep + 1))
    }
    return out
  }, [key])
}

/** Store › Models: every model as a card with vendor art, VRAM fit, setup and quantization. */
export function ModelsTab() {
  const listRef = useRef<HTMLDivElement>(null)
  // A guidance step can hand this tab a `focusId`: scroll that card in and ring it electric.
  useHighlight(listRef)
  const groups = useVisibleModels()
  const setupCount = useGame((s) => Object.values(s.models).filter((m) => m.setup).length)
  const total = useGame((_s, _d, store) => store.catalog.models.length)
  return (
    <div ref={listRef} className="flex flex-col gap-4 px-3 pt-3 pb-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-[0.08em] text-smoke-700">Checkpoints</span>
        <span className="tabular-nums text-smoke-800">
          {setupCount}/{total} installed
        </span>
      </div>
      {SECTIONS.map(({ id, label, icon: Icon, blurb }) => {
        const ids = groups[id]
        if (ids.length === 0) return null
        return (
          <section key={id} className="flex flex-col gap-2" aria-label={`${label} models`}>
            <header className="flex min-w-0 items-baseline justify-between gap-2">
              <h3 className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-smoke-300">
                <Icon size={13} className="text-smoke-700" aria-hidden="true" />
                {label}
                <span className="text-[10px] font-semibold tabular-nums text-smoke-800">{ids.length}</span>
              </h3>
              <p className="hidden min-w-0 text-right text-[11px] leading-snug text-smoke-800 lg:block">{blurb}</p>
            </header>
            <ul className="flex flex-col gap-2">
              {ids.map((modelId) => (
                // `data-id` is what a guidance step scrolls to and rings (`useHighlight`).
                <li key={modelId} data-id={modelId} className="cv-auto">
                  <ModelCard id={modelId} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
