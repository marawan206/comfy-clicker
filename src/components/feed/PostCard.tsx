'use client'
import { memo, useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowUpFromLine, Flame, Repeat2, ThumbsDown, TrendingDown } from 'lucide-react'
import { useGameStore } from '@/state/useGame'
import type { Post } from '@/game/types'
import { postProgress } from '@/game/virality'
import { formatNum } from '@/game/format'
import { FLOP_LINES, NEAR_VIRAL_LINES, RATIO_LINES, VIRAL_LINES } from '@/data/flavor'
import { Art } from '@/components/common/Art'
import { NumberTicker } from '@/components/common/NumberTicker'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { LikesCounter } from '@/components/feed/LikesCounter'
import {
  formatRate,
  modelInfo,
  pickBySeed,
  PRECISION_CHIP,
  tagLabel,
  thumbAssetFor,
  timeAgo,
  useFeedNow,
  useFeedSlowNow,
  usePostLive,
  usePostRef,
  useReducedMotionPref,
} from '@/components/feed/feedHooks'
import { cn } from '@/lib/utils'

interface Props {
  id: string
}

/** One player post: thumbnail, prompt, tags, live likes and payout, badges and the upscale offer. */
export const PostCard = memo(function PostCard({ id }: Props) {
  const post = usePostRef(id)
  const live = usePostLive(id)
  const store = useGameStore()
  const reduced = useReducedMotionPref()

  const info = useMemo(() => (post ? modelInfo(store.catalog, post.modelId) : null), [store, post])
  const thumb = useMemo(() => (post ? thumbAssetFor(post) : ''), [post])
  const chips = useMemo(() => {
    if (!post) return []
    const matched = new Set(post.matchedTrending)
    const ids: string[] = []
    for (const t of [...post.matchedTrending, ...post.tags]) if (!ids.includes(t)) ids.push(t)
    return ids.map((t) => ({ id: t, label: tagLabel(store.catalog, t), hot: matched.has(t) }))
  }, [store, post])

  if (!post) return null

  const active = !live.granted || live.likes < live.targetLikes
  const precisionChip = PRECISION_CHIP[post.precision]
  const ratioed = post.ratioed === true
  const nearViral = post.nearViral === true && !ratioed && !post.viral
  const quip = ratioed
    ? pickBySeed(RATIO_LINES, post.id)
    : nearViral
      ? pickBySeed(NEAR_VIRAL_LINES, post.id)
      : post.flop
        ? pickBySeed(FLOP_LINES, post.id)
        : post.viral
          ? pickBySeed(VIRAL_LINES, post.id)
          : null
  // "#videogen on SD 1.5": the tag that claimed a kind this model is not.
  const wrongTags = ratioed && post.mismatchedTags?.length ? post.mismatchedTags.map((t) => tagLabel(store.catalog, t)).join(' ') : ''

  return (
    <article
      className={cn(
        'relative flex gap-3 rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-slot-model bg-charcoal-600 p-3 shadow-[0_4px_0_#0e0e0f]',
        post.viral && 'border-electric-400/60 border-l-electric-400',
        post.flop && !ratioed && 'opacity-80',
        ratioed && 'border-slot-vae/60 border-l-slot-vae opacity-90',
      )}
      aria-label={`Post: ${post.prompt}${ratioed ? ' (ratioed)' : ''}`}
    >
      <div className="relative shrink-0">
        <Art id={thumb} size={96} alt={post.prompt} className="shadow-[0_2px_0_#0e0e0f]" />
        {info ? (
          <span
            className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-[0.354em] border border-charcoal-400 bg-charcoal-700"
            title={info.name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/brand/vendors/${info.vendorIcon}.svg`} alt="" width={14} height={14} draggable={false} />
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <header
          className={cn(
            'flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600',
            (post.viral || ratioed) && 'pr-20',
          )}
        >
          <span className="truncate">{info?.name ?? post.modelId}</span>
          {wrongTags ? (
            <span
              className="shrink-0 rounded-[0.354em] border border-slot-vae/60 bg-slot-vae/15 px-1.5 py-px text-[10px] normal-case tracking-normal text-slot-vae"
              title="A type tag naming a kind this model is not"
            >
              {wrongTags} on {info?.name ?? post.modelId}
            </span>
          ) : null}
          {precisionChip ? (
            <span className="rounded-[0.354em] border border-slot-latent/50 bg-slot-latent/10 px-1.5 py-px text-[10px] text-slot-latent">
              {precisionChip}
            </span>
          ) : null}
          {post.founderBoost ? (
            <span className="inline-flex items-center gap-1 rounded-[0.354em] bg-sapphire-700/30 px-1.5 py-px text-[10px] normal-case tracking-normal text-smoke-100">
              <Repeat2 size={11} aria-hidden="true" />
              Reposted by Yoland
            </span>
          ) : null}
          <TimeAgo ts={post.createdAt} className="ml-auto normal-case tracking-normal text-smoke-800" />
        </header>

        <p className="line-clamp-2 text-sm leading-snug text-smoke-100">{post.prompt}</p>

        {chips.length > 0 ? (
          <ul className="flex flex-wrap gap-1" aria-label="Hashtags">
            {chips.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'rounded-[0.354em] border px-1.5 py-px text-[11px] font-semibold',
                  c.hot ? 'border-electric-400/70 bg-electric-400/15 text-electric-400' : 'border-charcoal-300 bg-charcoal-700 text-smoke-600',
                )}
                title={c.hot ? 'Trending this week' : undefined}
              >
                {c.label}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <LikesCounter post={post} likes={live.likes} active={active} viral={post.viral} dislike={ratioed} />
          <PayoutRing post={post} credits={live.creditsPaid} active={active} ratioed={ratioed} />
          {live.upscaleCost !== null ? (
            <UpscaleButton
              cost={live.upscaleCost}
              affordable={live.upscaleAffordable}
              onClick={() => store.upscalePost(post.id)}
            />
          ) : live.upscaled ? (
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-800">Upscaled · second wave sent</span>
          ) : null}
        </div>

        <p className="text-[11px] tabular-nums text-smoke-800">
          <span className={ratioed ? 'text-slot-vae' : 'text-smoke-600'}>{formatNum(live.likes)}</span>{' '}
          {ratioed ? 'dislikes' : 'likes'} × {formatRate(post.creditsPerLike)} ={' '}
          <span className={ratioed ? 'text-slot-vae' : 'text-credits'}>
            {ratioed ? '-' : ''}
            {formatNum(live.creditsPaid)}
          </span>{' '}
          credits
        </p>

        {quip ? (
          <p
            className={cn(
              'flex items-start gap-1.5 text-[12px] italic leading-snug',
              ratioed ? 'text-slot-vae/90' : nearViral ? 'text-credits/80' : post.flop ? 'text-slot-vae/80' : 'text-smoke-600',
            )}
          >
            {nearViral ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.354em] bg-credits/20 px-1.5 py-px text-[10px] font-bold not-italic uppercase tracking-[0.08em] text-credits">
                <Flame size={11} aria-hidden="true" />
                Almost blew up
              </span>
            ) : post.flop && !ratioed ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[0.354em] bg-slot-vae/20 px-1.5 py-px text-[10px] font-bold not-italic uppercase tracking-[0.08em] text-slot-vae">
                <TrendingDown size={11} aria-hidden="true" />
                Flop
              </span>
            ) : null}
            <span className="line-clamp-2">{quip}</span>
          </p>
        ) : null}
      </div>

      {ratioed ? <RatioedRibbon reduced={reduced} /> : post.viral ? <BlewUpRibbon reduced={reduced} /> : null}
    </article>
  )
})

function TimeAgo({ ts, className }: { ts: number; className?: string }) {
  const now = useFeedSlowNow()
  return (
    <time className={className} dateTime={new Date(ts).toISOString()}>
      {timeAgo(now, ts)}
    </time>
  )
}

const RING_R = 12
const RING_C = 2 * Math.PI * RING_R

/** "+◆ N" with a ring that fills over the post's like window. A ratio strokes red and reads "-N". */
function PayoutRing({ post, credits, active, ratioed }: { post: Post; credits: number; active: boolean; ratioed: boolean }) {
  return active ? (
    <LiveRing post={post} credits={credits} ratioed={ratioed} />
  ) : (
    <RingRow progress={1} credits={credits} ratioed={ratioed} />
  )
}

function LiveRing({ post, credits, ratioed }: { post: Post; credits: number; ratioed: boolean }) {
  const now = useFeedNow()
  return <RingRow progress={postProgress(post, now)} credits={credits} ratioed={ratioed} />
}

function RingRow({ progress, credits, ratioed }: { progress: number; credits: number; ratioed: boolean }) {
  const offset = RING_C * (1 - Math.max(0, Math.min(1, progress)))
  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={ratioed ? `${formatNum(credits)} credits lost` : `${formatNum(credits)} credits earned`}
    >
      <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden="true" className="-rotate-90">
        <circle cx={15} cy={15} r={RING_R} fill="none" stroke="var(--color-charcoal-300)" strokeWidth={3} />
        <circle
          cx={15}
          cy={15}
          r={RING_R}
          fill="none"
          stroke={ratioed ? 'var(--color-slot-vae)' : 'var(--color-credits)'}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 260ms linear' }}
        />
      </svg>
      <span
        className={cn(
          'inline-flex items-center gap-0.5 text-sm font-extrabold tabular-nums tracking-tight',
          ratioed ? 'text-slot-vae' : 'text-credits',
        )}
      >
        {ratioed ? '-' : '+'}
        <CreditsIcon size={13} />
        <NumberTicker value={credits} speed={0.35} />
      </span>
    </span>
  )
}

function UpscaleButton({ cost, affordable, onClick }: { cost: number; affordable: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={affordable ? onClick : undefined}
      aria-disabled={!affordable}
      aria-label={`Upscale this post for ${formatNum(cost)} credits`}
      title={affordable ? 'Second wave: +40% likes at the same rate' : 'Not enough credits'}
      className={cn(
        'inline-flex items-center gap-1 rounded-[0.354em] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] transition-transform',
        affordable
          ? 'border-electric-400/70 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#0e0e0f] hover:-translate-y-px active:translate-y-px active:shadow-none'
          : 'cursor-not-allowed border-charcoal-300 bg-charcoal-700 text-slot-vae/70',
      )}
    >
      <ArrowUpFromLine size={12} aria-hidden="true" />
      Upscale
      <span className="inline-flex items-center gap-0.5 tabular-nums">
        <CreditsIcon size={11} />
        {formatNum(cost)}
      </span>
    </button>
  )
}

/** Mirrors `BlewUpRibbon`, in the other direction: red chrome, a thumb down and no shimmer. */
function RatioedRibbon({ reduced }: { reduced: boolean }) {
  return (
    <motion.span
      className="pointer-events-none absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-[0.354em] border border-slot-vae/70 bg-charcoal-800 px-2 py-0.5 shadow-[0_2px_0_#0e0e0f]"
      initial={reduced ? false : { scale: 0.6, rotate: 8, opacity: 0 }}
      animate={{ scale: 1, rotate: 3, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 16 }}
      aria-label="This post got ratioed"
    >
      <ThumbsDown size={12} className="text-slot-vae" aria-hidden="true" />
      <span className="text-[11px] font-extrabold tracking-[0.12em] text-slot-vae">RATIOED</span>
    </motion.span>
  )
}

function BlewUpRibbon({ reduced }: { reduced: boolean }) {
  return (
    <motion.span
      className="pointer-events-none absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-[0.354em] border border-electric-400/60 bg-charcoal-800 px-2 py-0.5 shadow-[0_2px_0_#0e0e0f]"
      initial={reduced ? false : { scale: 0.6, rotate: -8, opacity: 0 }}
      animate={{ scale: 1, rotate: -3, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 16 }}
      aria-label="This post blew up"
    >
      <Flame size={12} className="text-electric-400" aria-hidden="true" />
      <span className="cc-shimmer bg-linear-to-r from-electric-400 via-white to-electric-400 bg-clip-text text-[11px] font-extrabold tracking-[0.12em] text-transparent">
        BLEW UP
      </span>
    </motion.span>
  )
}
