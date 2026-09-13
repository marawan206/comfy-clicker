'use client'
import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Flame, TriangleAlert } from 'lucide-react'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { MAX_MATCHED_TRENDING } from '@/game/constants'
import type { HashtagDef, ModelKind } from '@/game/types'
import { Tooltip } from '@/components/common/Tooltip'
import { hashtagChipTip } from '@/components/common/tooltipCopy'
import { cn } from '@/lib/utils'
import {
  FOCUS_RING,
  LABEL_CLASS,
  MAX_SELECTED_TAGS,
  ensurePickHashtagBridge,
  isTypeTag,
  nextTrendingBonus,
  useCostPreview,
  useMoreTags,
  useMotionOK,
  useStudioSelection,
} from './studioHooks'

const KIND_WORDS: Record<ModelKind, string> = { image: 'image', video: 'video', '3d': '3D', audio: 'audio' }
const KIND_ARTICLES: Record<ModelKind, string> = { image: 'an', video: 'a', '3d': 'a', audio: 'an' }

/** Boost label for a trending tag given the tags already matched: `+100%`, `+40%` or `spam`. */
function boostLabel(id: string, matchedTrending: string[]): string {
  const rank = matchedTrending.includes(id) ? matchedTrending.indexOf(id) : matchedTrending.length
  const bonus = nextTrendingBonus(rank)
  return bonus === 'spam' ? 'spam' : `+${Math.round(bonus * 100)}%`
}

/** Up to three explicit hashtags; trending ones glow electric, a type tag on the wrong kind burns. */
export function HashtagPicker() {
  const store = useGameStore()
  const { tags: selected, toggleTag, setTags } = useStudioSelection()
  const { trending, matched, mismatched, mismatchedInPrompt, kind, spam } = useCostPreview()
  const motionOk = useMotionOK()
  const more = useMoreTags()

  // The trending strip sits outside the centre tabs and can be clicked from the Feed, where the
  // Studio is unmounted, so the listener lives on the module. Arming it here as well is free.
  useEffect(ensurePickHashtagBridge, [])

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

  /** Explicitly picked type tags on the wrong kind: these are the ones that will ratio the post. */
  const wrong = useMemo(() => new Set(mismatched), [mismatched])
  /** Any type tag naming a kind this model is not, picked or not: the chip warns before the click. */
  const wrongKind = (def: HashtagDef): boolean => def.kind !== undefined && def.kind !== kind
  /** Collapsed, the row is this week's trio plus whatever the player already put on the post. */
  const rest = useMemo(
    () => (more.open ? ordered.rest : ordered.rest.filter((d) => selected.includes(d.id) || wrong.has(d.id))),
    [more.open, ordered.rest, selected, wrong],
  )
  const hiddenCount = ordered.rest.length - rest.length

  const full = selected.length >= MAX_SELECTED_TAGS
  const pickedWrong = mismatched.filter((id) => selected.includes(id))
  const tagList = (ids: string[]): string => ids.map((id) => `#${hashtagById[id]?.tag ?? id}`).join(' ')
  const dropWrong = (): void => setTags(selected.filter((id) => !wrong.has(id)))

  const chip = (def: HashtagDef, hot: boolean) => {
    const on = selected.includes(def.id)
    const implied = !on && matched.includes(def.id)
    const bad = wrongKind(def)
    const disabled = !on && full
    let badge: string | null = null
    if (isTypeTag(def)) {
      // A type tag always says what it claims the post is: that claim is what gets it ratioed.
      badge = bad ? 'wrong kind' : hot ? '+20% free' : KIND_WORDS[def.kind as ModelKind]
    } else if (hot) {
      badge = boostLabel(def.id, matchedTrending)
    }
    const alarm = badge === 'wrong kind' || badge === 'spam'
    return (
      <Tooltip key={def.id} {...hashtagChipTip(def, { trending: hot, postKind: kind })}>
        <motion.button
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-disabled={disabled}
          aria-label={`#${def.tag}${hot ? ' (trending)' : ''}${bad ? ' (wrong kind)' : ''}`}
          onClick={() => {
            if (!disabled) toggleTag(def.id)
          }}
          whileTap={motionOk && !disabled ? { scale: 0.95 } : undefined}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors',
            FOCUS_RING,
            bad
              ? on
                ? 'border-slot-vae bg-slot-vae text-charcoal-800'
                : 'border-slot-vae/70 bg-slot-vae/10 text-slot-vae hover:bg-slot-vae/20'
              : on
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
              className={cn(
                'ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums',
                on
                  ? 'bg-charcoal-800/20 text-charcoal-800'
                  : alarm
                    ? 'bg-slot-vae/20 text-slot-vae'
                    : hot
                      ? 'bg-electric-400/20 text-electric-400'
                      : 'bg-charcoal-800/60 text-smoke-600',
              )}
            >
              {badge}
            </span>
          ) : null}
        </motion.button>
      </Tooltip>
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
        {ordered.hot.length > 0 && rest.length > 0 ? (
          <span className="mx-1 h-7 w-px self-center bg-charcoal-300" aria-hidden="true" />
        ) : null}
        {rest.map((def) => chip(def, false))}
        {hiddenCount > 0 || more.open ? (
          <button
            type="button"
            onClick={more.toggle}
            aria-expanded={more.open}
            aria-label={more.open ? 'Show fewer hashtags' : `Show ${hiddenCount} more hashtags`}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-charcoal-300 px-2.5 text-xs font-semibold text-smoke-700 transition-colors hover:border-electric-400/70 hover:text-electric-400',
              FOCUS_RING,
            )}
          >
            {more.open ? 'Fewer tags' : `More tags`}
            {more.open ? null : <span className="tabular-nums text-smoke-800">{hiddenCount}</span>}
            <ChevronDown size={12} aria-hidden="true" className={more.open ? 'rotate-180' : undefined} />
          </button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {pickedWrong.length > 0 ? (
          <motion.p
            key="wrong-kind"
            role="status"
            initial={motionOk ? { opacity: 0, y: -4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={motionOk ? { opacity: 0, y: -4 } : undefined}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slot-vae/50 bg-slot-vae/10 px-2.5 py-1.5 text-xs font-semibold text-slot-vae"
          >
            <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {tagList(pickedWrong)} on {KIND_ARTICLES[kind]} {KIND_WORDS[kind]} model · this post gets ratioed:
              dislikes, and you pay for them
            </span>
            <button
              type="button"
              onClick={dropWrong}
              aria-label={`Remove ${tagList(pickedWrong)}`}
              className={cn(
                'ml-auto shrink-0 rounded-full border border-slot-vae/60 px-2 py-px text-[11px] font-bold text-slot-vae transition-colors hover:bg-slot-vae hover:text-charcoal-800',
                FOCUS_RING,
              )}
            >
              Remove
            </button>
          </motion.p>
        ) : null}
        {mismatchedInPrompt.length > 0 ? (
          <motion.p
            key="wrong-kind-prompt"
            role="status"
            initial={motionOk ? { opacity: 0, y: -4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={motionOk ? { opacity: 0, y: -4 } : undefined}
            className="flex items-center gap-1.5 rounded-lg border border-slot-vae/50 bg-slot-vae/10 px-2.5 py-1.5 text-xs font-semibold text-slot-vae"
          >
            <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {tagList(mismatchedInPrompt)} is in the prompt · delete it or pick{' '}
              {KIND_ARTICLES[hashtagById[mismatchedInPrompt[0] as string]?.kind ?? 'video']}{' '}
              {KIND_WORDS[hashtagById[mismatchedInPrompt[0] as string]?.kind ?? 'video']} model
            </span>
          </motion.p>
        ) : null}
        {spam ? (
          <motion.p
            key="spam"
            role="status"
            initial={motionOk ? { opacity: 0, y: -4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={motionOk ? { opacity: 0, y: -4 } : undefined}
            className="flex items-center gap-1.5 rounded-lg border border-slot-vae/50 bg-slot-vae/10 px-2.5 py-1.5 text-xs font-semibold text-slot-vae"
          >
            <TriangleAlert size={14} aria-hidden="true" />
            {MAX_MATCHED_TRENDING + 1} trending = spam · the algorithm knows, boost voided
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
