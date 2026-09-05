'use client'
import { useState } from 'react'
import { ASSETS, type AssetEntry } from '@/data/assetManifest'
import assetIndex from '@/data/assetIndex.json'
import { cn } from '@/lib/utils'
import { DynamicIcon, type IconName } from 'lucide-react/dynamic'

const AVAILABLE = new Set<string>(assetIndex as string[])
const SLOT_COLORS = ['#b39ddb', '#ffd500', '#ffa931', '#64b5f6', '#ff9cf9', '#ff6e6e', '#81c784', '#f0ff41', '#172dd7']

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function gradientFor(seed: string): string {
  const h = hashSeed(seed)
  const a = SLOT_COLORS[h % SLOT_COLORS.length]
  const b = SLOT_COLORS[(h >>> 8) % SLOT_COLORS.length]
  return `linear-gradient(${(h >>> 16) % 360}deg, ${a}66, ${b}66), #262729`
}

export interface ArtProps {
  id: string
  size?: number
  className?: string
  /** Rounded-square by default (logo corner ratio). */
  radius?: string
  alt?: string
  priority?: boolean
}

/**
 * Renders a generated asset if it exists, else a designed fallback tile of identical size,
 * so layout never shifts while art is still being generated.
 */
export function Art({ id, size = 48, className, radius = '0.354em', alt }: ArtProps) {
  const entry: AssetEntry | undefined = ASSETS[id]
  const [failed, setFailed] = useState(false)
  const exists = entry && AVAILABLE.has(entry.file) && !failed
  const style = { width: size, height: size, borderRadius: radius, fontSize: size }

  if (entry && exists) {
    if (entry.video) {
      return (
        <video
          className={cn('block object-cover', className)}
          style={style}
          src={`/art/${entry.file}`}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          aria-label={alt ?? entry.alt}
        />
      )
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={cn('block object-cover', className)}
        style={style}
        src={`/art/${entry.file}`}
        alt={alt ?? entry.alt}
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }
  return <Fallback entry={entry} id={id} size={size} className={className} radius={radius} />
}

function Fallback({ entry, id, size, className, radius }: { entry?: AssetEntry; id: string; size: number; className?: string; radius: string }) {
  const fb = entry?.fallback ?? { kind: 'glyph' as const, icon: 'image' }
  const base = cn('flex items-center justify-center overflow-hidden border border-white/5 select-none', className)
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius }
  const iconSize = Math.round(size * 0.52)
  if (fb.kind === 'vendor') {
    return (
      <div className={base} style={{ ...style, background: gradientFor(id) }} aria-label={entry?.alt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/brand/vendors/${fb.icon}.svg`} alt="" width={iconSize} height={iconSize} className="opacity-90" draggable={false} />
      </div>
    )
  }
  if (fb.kind === 'emoji') {
    return (
      <div className={base} style={{ ...style, background: '#172dd7', fontSize: iconSize }} aria-label={entry?.alt}>
        {fb.emoji}
      </div>
    )
  }
  if (fb.kind === 'gradient') {
    return (
      <div className={base} style={{ ...style, background: gradientFor(fb.seed) }} aria-label={entry?.alt}>
        {fb.glyph ? <DynamicIcon name={fb.glyph as IconName} size={iconSize} className="text-white/70" /> : null}
      </div>
    )
  }
  const tint = fb.tint === 'electric' ? 'text-electric-400' : 'text-smoke-100'
  return (
    <div className={cn(base, 'bg-sapphire-700')} style={style} aria-label={entry?.alt}>
      <DynamicIcon name={fb.icon as IconName} size={iconSize} className={tint} />
    </div>
  )
}
