'use client'
import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Flame, Shuffle, X } from 'lucide-react'
import { PROMPT_CHIPS, type PromptChip } from '@/data/flavor'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { cn } from '@/lib/utils'
import {
  FOCUS_RING,
  LABEL_CLASS,
  MAX_PROMPT_UI_CHARS,
  applyPromptChip,
  useCostPreview,
  useMotionOK,
  useStudioSelection,
} from './studioHooks'

const CHIPS_SHOWN = 5
const MAX_KEYWORD_BONUS = 3

/** Prompt textarea with one-tap idea chips and a live preview of the hashtags the words already hit. */
export function PromptInput() {
  const store = useGameStore()
  const { prompt, setPrompt } = useStudioSelection()
  const { matched, keywordHits, trending } = useCostPreview()
  const motionOk = useMotionOK()
  const [offset, setOffset] = useState(0)
  const chips = useMemo(() => {
    const out: PromptChip[] = []
    for (let i = 0; i < CHIPS_SHOWN && i < PROMPT_CHIPS.length; i++) {
      out.push(PROMPT_CHIPS[(offset + i) % PROMPT_CHIPS.length] as PromptChip)
    }
    return out
  }, [offset])
  const shuffle = useCallback(() => setOffset((o) => (o + CHIPS_SHOWN) % PROMPT_CHIPS.length), [])
  const onChip = useCallback((chip: PromptChip) => applyPromptChip(chip, store.catalog), [store])

  const { hashtagById } = buildIndex(store.catalog)
  const trendingSet = useMemo(() => new Set(trending), [trending])
  const remaining = MAX_PROMPT_UI_CHARS - prompt.length
  const hits = Math.min(MAX_KEYWORD_BONUS, keywordHits)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor="studio-prompt" className={LABEL_CLASS}>
          Prompt
        </label>
        <span className={cn('text-[11px] tabular-nums', remaining <= 20 ? 'text-slot-cond' : 'text-smoke-800')}>
          {prompt.length}/{MAX_PROMPT_UI_CHARS}
        </span>
      </div>
      <div className="relative">
        <textarea
          id="studio-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={MAX_PROMPT_UI_CHARS}
          rows={3}
          spellCheck={false}
          placeholder="masterpiece, best quality, a cat that is also a chair…"
          aria-describedby="studio-prompt-hint"
          className="w-full resize-none rounded-lg border-2 border-charcoal-400 bg-charcoal-700 px-3 py-2 pr-9 font-inter text-sm leading-relaxed text-smoke-100 outline-none placeholder:text-smoke-800 focus:border-electric-400"
        />
        {prompt ? (
          <button
            type="button"
            onClick={() => setPrompt('')}
            aria-label="Clear prompt"
            className={cn(
              'absolute top-2 right-2 flex size-6 items-center justify-center rounded-[0.354em] text-smoke-700 hover:bg-charcoal-500 hover:text-smoke-100',
              FOCUS_RING,
            )}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.text}
            type="button"
            onClick={() => onChip(chip)}
            aria-label={`Use prompt idea: ${chip.text}`}
            className={cn(
              'max-w-full truncate rounded-full border border-charcoal-300 bg-charcoal-500 px-2.5 py-1 text-xs text-smoke-500 transition-colors hover:border-electric-400/70 hover:text-smoke-100',
              FOCUS_RING,
            )}
          >
            {chip.text}
          </button>
        ))}
        <button
          type="button"
          onClick={shuffle}
          aria-label="More prompt ideas"
          title="More ideas"
          className={cn(
            'flex size-7 items-center justify-center rounded-full border border-charcoal-300 text-smoke-700 transition-colors hover:border-electric-400/70 hover:text-electric-400',
            FOCUS_RING,
          )}
        >
          <Shuffle size={12} aria-hidden="true" />
        </button>
      </div>

      <div id="studio-prompt-hint" className="flex min-h-5 flex-wrap items-center gap-1.5 text-[11px] text-smoke-800" aria-live="off">
        {matched.length === 0 ? (
          <span>Keywords in the prompt pick up hashtags on their own.</span>
        ) : (
          <>
            <span className="text-smoke-700">Reads as</span>
            <AnimatePresence initial={false}>
              {matched.map((id) => {
                const hot = trendingSet.has(id)
                return (
                  <motion.span
                    key={id}
                    layout={motionOk}
                    initial={motionOk ? { opacity: 0, scale: 0.8 } : false}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={motionOk ? { opacity: 0, scale: 0.8 } : undefined}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold',
                      hot ? 'bg-electric-400/15 text-electric-400' : 'bg-charcoal-500 text-smoke-500',
                    )}
                  >
                    {hot ? <Flame size={10} aria-hidden="true" /> : null}#{hashtagById[id]?.tag ?? id}
                  </motion.span>
                )
              })}
            </AnimatePresence>
            {hits > 0 ? (
              <span className="tabular-nums text-smoke-700" title="Descriptive prompts get a small reach bonus per keyword (max 3)">
                · {hits} keyword{hits === 1 ? '' : 's'}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
