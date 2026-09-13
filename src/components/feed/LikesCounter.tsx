'use client'
import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Heart, ThumbsDown } from 'lucide-react'
import { likesAt } from '@/game/virality'
import { formatNum } from '@/game/format'
import type { Post } from '@/game/types'
import { NumberTicker } from '@/components/common/NumberTicker'
import { useFeedNow, useReducedMotionPref } from '@/components/feed/feedHooks'
import { cn } from '@/lib/utils'

interface Props {
  post: Post
  /** Likes as the store last settled them (used once the window has closed). */
  likes: number
  /** True while likes are still arriving; the counter then eases with `likesAt` at 4 Hz. */
  active: boolean
  viral?: boolean
  /** A ratioed post counts the same number the other way: thumbs down, no heartbeat, no joy. */
  dislike?: boolean
  className?: string
}

/** Heart + like count. The heart beats on every increment; the number rolls with a ticker. */
export const LikesCounter = memo(function LikesCounter({
  post,
  likes,
  active,
  viral = false,
  dislike = false,
  className,
}: Props) {
  return active ? (
    <LiveLikes post={post} viral={viral} dislike={dislike} className={className} />
  ) : (
    <LikesRow value={likes} viral={viral} dislike={dislike} className={className} />
  )
})

interface RowProps {
  viral: boolean
  dislike: boolean
  className?: string
}

function LiveLikes({ post, viral, dislike, className }: { post: Post } & RowProps) {
  const now = useFeedNow()
  const value = Math.max(post.likes, likesAt(post, now))
  return <LikesRow value={value} viral={viral} dislike={dislike} className={className} />
}

function LikesRow({ value, viral, dislike, className }: { value: number } & RowProps) {
  const reduced = useReducedMotionPref()
  const prev = useRef(value)
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    if (value > prev.current) setBeat((b) => b + 1)
    prev.current = value
  }, [value])

  if (dislike) {
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-slot-vae', className)}
        aria-label={`${formatNum(value)} dislikes`}
      >
        <ThumbsDown size={14} className="shrink-0 fill-slot-vae/30 text-slot-vae" aria-hidden="true" />
        <NumberTicker value={value} speed={0.35} />
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slot-vae/70">dislikes</span>
      </span>
    )
  }

  const heart = (
    <Heart
      size={14}
      className={cn('shrink-0', viral ? 'fill-slot-vae text-slot-vae' : value > 0 ? 'fill-slot-latent text-slot-latent' : 'text-smoke-800')}
      aria-hidden="true"
    />
  )
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-smoke-100', className)}
      aria-label={`${formatNum(value)} likes`}
    >
      {reduced ? (
        heart
      ) : (
        <motion.span
          key={beat}
          className="inline-flex"
          initial={{ scale: beat === 0 ? 1 : 1.45 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
        >
          {heart}
        </motion.span>
      )}
      <NumberTicker value={value} speed={0.35} />
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-smoke-800">likes</span>
    </span>
  )
}
