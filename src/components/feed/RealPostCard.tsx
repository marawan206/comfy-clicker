'use client'
import { memo, useState, type ReactNode } from 'react'
import { BadgeCheck, Briefcase, ExternalLink, GitBranch, Heart, MessagesSquare, Newspaper, Package, Play, TrendingUp } from 'lucide-react'
import type { FeedItem, FeedSource } from '@/server/feed/types'
import { formatCompactDate, formatNum } from '@/game/format'
import { gradientFor } from '@/components/common/Art'
import { initialsOf } from '@/components/feed/feedHooks'
import { cn } from '@/lib/utils'

interface Props {
  item: FeedItem
}

const PLATFORM: Record<Exclude<FeedSource, 'x'>, { label: string; icon: ReactNode }> = {
  linkedin: { label: 'LinkedIn', icon: <Briefcase size={11} aria-hidden="true" /> },
  reddit: { label: 'Reddit', icon: <MessagesSquare size={11} aria-hidden="true" /> },
  hn: { label: 'HN', icon: <TrendingUp size={11} aria-hidden="true" /> },
  blog: { label: 'Blog', icon: <Newspaper size={11} aria-hidden="true" /> },
  github: { label: 'GitHub', icon: <GitBranch size={11} aria-hidden="true" /> },
  registry: { label: 'Registry', icon: <Package size={11} aria-hidden="true" /> },
  youtube: { label: 'YouTube', icon: <Play size={11} aria-hidden="true" /> },
}

function XMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 1200 1227" width={size} height={size} className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"
      />
    </svg>
  )
}

/** A real post from the wire. Non-interactive except the link-out; sapphire stripe marks it as real. */
export const RealPostCard = memo(function RealPostCard({ item }: Props) {
  return item.source === 'x' ? <XCard item={item} /> : <CompactCard item={item} />
})

const CARD = 'relative rounded-2xl border-2 border-charcoal-400 border-l-4 border-l-sapphire-700 bg-charcoal-600 shadow-[0_4px_0_#0e0e0f]'

function XCard({ item }: Props) {
  return (
    <article className={cn(CARD, 'p-3')} aria-label={`Post by ${item.author} on X`}>
      <div className="flex gap-3">
        <Avatar item={item} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="inline-flex items-center gap-1 truncate text-sm font-semibold text-smoke-100">
                <span className="truncate">{item.author}</span>
                {item.verified ? <BadgeCheck size={14} className="shrink-0 text-sapphire-700 fill-sapphire-700/20" aria-label="Verified" /> : null}
              </span>
              <span className="truncate text-xs text-smoke-800">@{item.handle}</span>
            </div>
            <LinkOut href={item.url} label={`Open ${item.author}'s post on X`}>
              <XMark size={14} />
            </LinkOut>
          </div>
          <p className="mt-1.5 line-clamp-6 text-sm leading-snug whitespace-pre-line text-smoke-100">{item.text}</p>
          <Meta item={item} />
        </div>
      </div>
    </article>
  )
}

function CompactCard({ item }: Props) {
  const platform = PLATFORM[item.source as Exclude<FeedSource, 'x'>] ?? PLATFORM.blog
  return (
    <article className={cn(CARD, 'flex gap-3 p-3')} aria-label={`${platform.label} post by ${item.author}`}>
      <Avatar item={item} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-[0.354em] bg-sapphire-700 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-white">
            {platform.icon}
            {platform.label}
          </span>
          <span className="truncate text-sm font-semibold text-smoke-100">{item.author}</span>
          {item.verified ? <BadgeCheck size={13} className="shrink-0 text-sapphire-700" aria-label="Verified" /> : null}
          <LinkOut href={item.url} label={`Open on ${platform.label}`} className="ml-auto">
            <ExternalLink size={14} />
          </LinkOut>
        </div>
        <p className="mt-1 line-clamp-3 text-sm leading-snug text-smoke-100">{item.text}</p>
        <Meta item={item} />
      </div>
      {item.mediaUrl ? <Media url={item.mediaUrl} /> : null}
    </article>
  )
}

function Meta({ item }: Props) {
  const stars = item.stats?.stars
  const downloads = item.stats?.downloads
  const date = Number.isFinite(Date.parse(item.date)) ? formatCompactDate(Date.parse(item.date)) : null
  return (
    <p className="mt-1.5 flex items-center gap-3 text-xs tabular-nums text-smoke-800">
      {item.likes !== null ? (
        <span className="inline-flex items-center gap-1">
          <Heart size={12} className="text-slot-latent" aria-hidden="true" />
          {formatNum(item.likes)}
        </span>
      ) : stars !== undefined ? (
        <span>{formatNum(stars)} stars</span>
      ) : downloads !== undefined ? (
        <span>{formatNum(downloads)} downloads</span>
      ) : null}
      {date ? <time dateTime={item.date}>{date}</time> : null}
    </p>
  )
}

function LinkOut({ href, label, className, children }: { href: string; label: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-[0.354em] text-smoke-600 transition-colors hover:bg-charcoal-400 hover:text-smoke-100',
        className,
      )}
    >
      {children}
    </a>
  )
}

function Avatar({ item, size }: { item: FeedItem; size: number }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size, borderRadius: '0.354em' }
  if (item.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.avatarUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(true)}
        className="shrink-0 object-cover"
        style={style}
      />
    )
  }
  return (
    <span
      className="flex shrink-0 select-none items-center justify-center border border-white/5 font-extrabold text-white/90"
      style={{ ...style, background: gradientFor(item.handle || item.author), fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {initialsOf(item.author)}
    </span>
  )
}

function Media({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={64}
      height={64}
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="size-16 shrink-0 self-start rounded-[0.354em] border border-white/5 object-cover"
    />
  )
}
