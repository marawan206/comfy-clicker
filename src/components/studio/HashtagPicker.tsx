'use client'
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Flame, TriangleAlert } from 'lucide-react'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { MAX_MATCHED_TRENDING } from '@/game/constants'
import type { HashtagDef, ModelKind } from '@/game/types'
import { cn } from '@/lib/utils'
import {
  FOCUS_RING,
  KIND_LABELS,
  LABEL_CLASS,
  MAX_SELECTED_TAGS,
  isTypeTag,
  nextTrendingBonus,
  useCostPreview,
  useMotionOK,
  useStudioSelection,
} from './studioHooks'

/** Boost label for a trending tag given the tags already matched: `+100%`, `+40%` or `spam`. */
function boostLabel(id: string, matchedTrending: string[]): string {
  const rank = matchedTrending.includes(id) ? matchedTrending.indexOf(id) : matchedTrending.length
  const bonus = nextTrendingBonus(rank)
  return bonus === 'spam' ? 'spam' : `+${Math.round(bonus * 100)}%`
}

/** Up to three explicit hashtags; trending ones glow electric with the boost they would add. */
export function HashtagPicker() {
  const store = useGameStore()
  const { tags: selected, toggleTag } = useStudioSelection()
  const { trending, matched, kind, spam } = useCostPreview()
  const motionOk = useMotionOK()

  const { hashtagById } = buildIndex(store.catalog)
  const ordered = useMemo(() => {
    const hot: HashtagDef[] = []
    for (const id of trending) {
      const def = hashtagById[id]
      if (def) hot.push(def)
    }
    const hotSet = new Set(trending)
    return { hot, rest: store.catalog.hashtags.filter((h) => !hotSet.has(h.id)) }
  }, [store, trending, hashtagById])
  const matchedTrending = useMemo(() => {
    const set = new Set(matched)
    return trending.filter((id) => set.has(id) && !isTypeTag(hashtagById[id]))
  }, [matched, trending, hashtagById])

  const full = selected.length >= MAX_SELECTED_TAGS

  const chip = (def: HashtagDef, hot: boolean) => {
    const on = selected.includes(def.id)
    const implied = !on && matched.includes(def.id)
    const disabled = !on && full
    let badge: string | null = null
    let badgeTitle = ''
    if (hot) {
      if (isTypeTag(def)) {
        const same = def.kind === kind
        badge = same ? '+20% free' : `${KIND_LABELS[def.kind as ModelKind].toLowerCase()} only`
        badgeTitle = same ? 'A trending type tag boosts every post of its kind without using a slot' : 'Only counts on posts of that kind'
      } else {
        badge = boostLabel(def.id, matchedTrending)
        badgeTitle = badge === 'spam' ? 'A third trending tag voids the whole boost' : 'Reach boost this tag adds right now'
      }
    }
    return (
      <motion.button
        key={def.id}
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-disabled={disabled}
        aria-label={`#${def.tag}${hot ? ' (trending)' : ''}`}
        title={
          disabled
            ? `Up to ${MAX_SELECTED_TAGS} hashtags per post`
            : implied
              ? `#${def.tag} · already picked up from the prompt`
              : `#${def.tag}${def.keywords.length ? ` · ${def.keywords.slice(0, 4).join(', ')}` : ''}`
        }
        onClick={() => {
          if (!disabled) toggleTag(def.id)
        }}
        whileTap={motionOk && !disabled ? { scale: 0.95 } : undefined}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors',
          FOCUS_RING,
          on
            ? hot
              ? 'border-electric-400 bg-electric-400 text-charcoal-800'
              : 'border-smoke-500 bg-smoke-100 text-charcoal-800'
            : hot
              ? 'border-electric-400/70 bg-electric-400/10 text-electric-400 hover:bg-electric-400/20'
              : implied
                ? 'border-charcoal-200 bg-charcoal-500 text-smoke-300'
                : 'border-charcoal-300 bg-charcoal-500 text-smoke-600 hover:border-charcoal-100 hover:text-smoke-100',
          disabled && 'cursor-not-allowed opacity-45 hover:border-charcoal-300 hover:text-smoke-600',
        )}
      >
        {hot ? <Flame size={11} aria-hidden="true" /> : null}
        <span>#{def.tag}</span>
        {badge ? (
          <span
            title={badgeTitle}
            className={cn(
              'ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums',
              on ? 'bg-charcoal-800/20 text-charcoal-800' : badge === 'spam' ? 'bg-slot-vae/20 text-slot-vae' : 'bg-electric-400/20 text-electric-400',
            )}
          >
            {badge}
          </span>
        ) : null}
      </motion.button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={LABEL_CLASS}>Hashtags</span>
        <span className={cn('text-[11px] tabular-nums', full ? 'text-electric-400' : 'text-smoke-800')}>
          {selected.length}/{MAX_SELECTED_TAGS}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ordered.hot.map((def) => chip(def, true))}
        {ordered.hot.length > 0 ? <span className="mx-1 h-7 w-px self-center bg-charcoal-300" aria-hidden="true" /> : null}
        {ordered.rest.map((def) => chip(def, false))}
      </div>
      <AnimatePresence initial={false}>
        {spam ? (
          <motion.p
            key="spam"
            role="status"
            initial={motionOk ? { opacity: 0, y: -4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={motionOk ? { opacity: 0, y: -4 } : undefined}
            className="flex items-center gap-1.5 rounded-lg border border-slot-vae/50 bg-slot-vae/10 px-2.5 py-1.5 text-xs font-semibold text-slot-vae"
          >
            <TriangleAlert size={14} aria-hidden="true" />{MAX_MATCHED_TRENDING + 1} trending = spam · the algorithm knows, boost voided
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
