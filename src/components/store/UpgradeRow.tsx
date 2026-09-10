'use client'
import { memo, useCallback } from 'react'
import { motion, useAnimate } from 'motion/react'
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic'
import { useGameStore } from '@/state/useGame'
import { buildIndex } from '@/game/catalog'
import { formatNum } from '@/game/format'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { cn } from '@/lib/utils'
import { parseTierId, summarizeEffects, useReducedMotionPref, useUpgradeRow } from './storeHooks'

/** File stems under public/brand/nodes; upgrade `icon` strings that match render the brand glyph. */
const BRAND_NODE_ICONS = new Set([
  'canny',
  'depth-to-video',
  'extensions-blocks',
  'image-batch',
  'image-edit',
  'image-inpainting',
  'image-scale',
  'image-to-video',
  'load-3-d',
  'load-audio',
  'load-video',
  'lora-loader',
  'node',
  'pin',
  'play',
  'pose-to-video',
  'save-glb',
  'save-image',
  'save-video',
  'send',
  'subgraph-blueprint-canny-to-video-ltx-2-0',
  'subgraph-blueprint-pose-to-video-ltx-2-0',
  'template',
  'text-to-image',
  'text-to-video',
  'workflow',
])
const LUCIDE_NAMES = new Set<string>(iconNames)

/** Brand node SVG (masked so it takes the current text colour) or a lucide icon by kebab-case name. */
export function UpgradeIcon({ icon, size = 18, className }: { icon: string; size?: number; className?: string }) {
  if (BRAND_NODE_ICONS.has(icon)) {
    const url = `url(/brand/nodes/${icon}.svg)`
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block bg-current', className)}
        style={{
          width: size,
          height: size,
          WebkitMaskImage: url,
          maskImage: url,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    )
  }
  const name = (LUCIDE_NAMES.has(icon) ? icon : 'sparkles') as IconName
  return <DynamicIcon name={name} size={size} className={className} aria-hidden="true" />
}

const CURRENCY_LABEL = { rp: 'RP', cp: 'CP' } as const
const SHAKE = { x: [0, -4, 4, -2, 2, 0] }

interface Props {
  id: string
}

function UpgradeRowImpl({ id }: Props) {
  const store = useGameStore()
  const { upgradeById, hardwareById } = buildIndex(store.catalog)
  const def = upgradeById[id]
  const row = useUpgradeRow(id)
  const reduced = useReducedMotionPref()
  const [scope, animate] = useAnimate<HTMLButtonElement>()

  const onClick = useCallback(() => {
    const refused = !row.affordable || Boolean(store.buyUpgrade(id).error)
    if (refused && !reduced && scope.current) animate(scope.current, SHAKE, { duration: 0.28 })
  }, [store, id, row.affordable, reduced, animate, scope])

  if (!def) return null

  const tier = parseTierId(id)
  const hw = tier ? hardwareById[tier.hardwareId] : undefined
  const effects = summarizeEffects(def.effects, store.catalog)
  const price = formatNum(row.cost)
  const currencyText = row.currency === 'credits' ? `${price} credits` : `${price} ${CURRENCY_LABEL[row.currency]}`
  const tooltip = [def.flavor, effects].filter(Boolean).join('\n')

  return (
    <motion.button
      ref={scope}
      type="button"
      onClick={onClick}
      aria-label={`Buy ${def.name} for ${currencyText}${row.affordable ? '' : ' (not enough)'}`}
      aria-disabled={!row.affordable || undefined}
      title={tooltip}
      whileTap={reduced || !row.affordable ? undefined : { scale: 0.985 }}
      className={cn(
        'mb-1.5 flex w-full items-center gap-3 rounded-xl border-2 border-charcoal-400 bg-charcoal-500 px-2.5 py-2 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
        row.affordable ? 'shadow-[0_3px_0_#0e0e0f] hover:border-electric-400/70 active:translate-y-0.5 active:shadow-none' : 'opacity-60',
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.354em] border border-white/5',
          tier ? 'bg-charcoal-700 text-electric-400' : 'bg-sapphire-700 text-smoke-100',
        )}
      >
        <UpgradeIcon icon={def.icon} size={20} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-smoke-100">{def.name}</span>
          {hw && (
            <span className="shrink-0 rounded-[0.3em] bg-charcoal-700 px-1 text-[10px] font-bold text-smoke-600">
              {hw.short} · T{tier?.tier}
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-smoke-600">{def.desc}</p>
        {effects && <p className="truncate text-[11px] font-semibold text-electric-400/90">{effects}</p>}
      </div>

      <div className={cn('flex shrink-0 items-center gap-1 text-[14px] font-extrabold tabular-nums tracking-tight', row.affordable ? 'text-credits' : 'text-slot-vae')}>
        {row.currency === 'credits' ? (
          <CreditsIcon size={14} />
        ) : (
          <span className={cn('text-[10px] font-bold tracking-[0.08em] uppercase', row.currency === 'rp' ? 'text-electric-400' : 'text-slot-latent')}>
            {CURRENCY_LABEL[row.currency]}
          </span>
        )}
        <span>{price}</span>
      </div>
    </motion.button>
  )
}

/** One store row for an upgrade (named or generated hardware tier). */
export const UpgradeRow = memo(UpgradeRowImpl)
