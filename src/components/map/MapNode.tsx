'use client'
/**
 * The two custom React Flow node types on The Graph:
 *
 *  - `mapNode`  — a ComfyUI-style box: title bar tinted by branch, a body with the node's icon and
 *    description, a footer with the price and the state control (Unlock / Owned / why-locked),
 *    slot dots on both flanks for the noodles. Owned boxes wear the electric border, available
 *    ones pulse, locked ones sit dim. Click (or Enter/Space) selects the node for the details
 *    panel; the Unlock button buys it straight from the canvas.
 *  - `laneGroup` — a litegraph "group" band behind each branch with the lane label, a dry blurb
 *    and, on the prestige lane, the Rebrand call to action.
 *
 * Neither subscribes to the store (the canvas pushes status in through `data`), except the small
 * Rebrand CTA, which reads the CP it would bank.
 */
import { memo, useCallback, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { motion } from 'motion/react'
import { Check, Lock, RefreshCw, Sparkles } from 'lucide-react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ComfyMark } from '@/components/brand/ComfyMark'
import { CreditsIcon } from '@/components/brand/CreditsIcon'
import { Art } from '@/components/common/Art'
import { openModal } from '@/components/overlays/Overlays'
import { UpgradeIcon } from '@/components/store/UpgradeRow'
import { formatNum } from '@/game/format'
import { mapNodeCost } from '@/game/map'
import { canRebrand, rebrandCp } from '@/game/prestige'
import type { MapBranch } from '@/game/types'
import { cn } from '@/lib/utils'
import { useGameShallow, useGameStore } from '@/state/useGame'
import { useMapInteraction } from './mapHooks'
import { BRANCH_META, CURRENCY_LABEL, type LaneGroupNode, type MapFlowNode } from './mapLayout'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function branchStyle(branch: MapBranch): CSSProperties {
  return { '--cc-branch': BRANCH_META[branch].color } as CSSProperties
}

/** The lane glyph: generated art per branch, the Comfy "C" for the core trunk. */
function BranchGlyph({ branch, size }: { branch: MapBranch; size: number }) {
  const art = BRANCH_META[branch].art
  if (!art) return <ComfyMark size={size - 2} className="shrink-0 text-electric-400" />
  return <Art id={art} size={size} radius="3px" className="shrink-0" alt="" />
}

const POP = {
  idle: { scale: 1 },
  owned: { scale: [1, 1.08, 1], transition: { duration: 0.45, ease: 'easeOut' as const } },
}

// ---------------------------------------------------------------------------
// mapNode
// ---------------------------------------------------------------------------

function MapNodeImpl({ data }: NodeProps<MapFlowNode>) {
  const { def, status, affordable, selected, dimmed, reason } = data
  const { select, unlock } = useMapInteraction()
  const cost = mapNodeCost(def)
  const meta = BRANCH_META[def.branch]

  const onSelect = useCallback(() => select(def.id), [select, def.id])
  const onKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        select(def.id)
      }
    },
    [select, def.id],
  )
  const onUnlock = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      select(def.id)
      unlock(def, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
    },
    [select, unlock, def],
  )

  const stateWord = status === 'owned' ? 'unlocked' : status === 'available' ? (affordable ? 'available' : 'available, not affordable yet') : 'locked'
  const label = `${def.title} — ${meta.label} node, ${cost === 0 ? 'free' : `${formatNum(cost)} ${CURRENCY_LABEL[def.currency]}`}, ${stateWord}${reason ? `. ${reason}` : ''}`

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      title={def.title}
      onClick={onSelect}
      onKeyDown={onKey}
      initial={false}
      animate={status === 'owned' ? 'owned' : 'idle'}
      variants={POP}
      style={branchStyle(def.branch)}
      className={cn(
        'cc-map-node nodrag',
        `cc-map-node--${status}`,
        selected && 'cc-map-node--selected',
        dimmed && 'cc-map-node--dimmed',
      )}
    >
      {def.parents.length > 0 ? <Handle type="target" position={Position.Left} className="cc-map-handle" isConnectable={false} /> : null}
      <Handle type="source" position={Position.Right} className="cc-map-handle" isConnectable={false} />

      <div className="cc-map-node__title">
        <BranchGlyph branch={def.branch} size={14} />
        <span className="min-w-0 flex-1 truncate text-smoke-100">{def.title}</span>
        {status === 'owned' ? (
          <Check size={13} aria-hidden="true" className="shrink-0 text-electric-400" />
        ) : status === 'locked' ? (
          <Lock size={11} aria-hidden="true" className="shrink-0 text-smoke-800" />
        ) : (
          <Sparkles size={12} aria-hidden="true" className="shrink-0 text-electric-400" />
        )}
      </div>

      <div className="cc-map-node__body">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-comfy border border-charcoal-400 bg-charcoal-700"
          style={{ color: meta.color }}
        >
          <UpgradeIcon icon={def.icon} size={15} />
        </span>
        <p className="cc-map-node__desc">{def.desc}</p>
      </div>

      <div className="cc-map-node__footer">
        <Price currency={def.currency} cost={cost} color={meta.color} />
        {status === 'owned' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-electric-400">
            <Check size={11} aria-hidden="true" />
            Owned
          </span>
        ) : status === 'available' ? (
          <button
            type="button"
            onClick={onUnlock}
            aria-disabled={!affordable}
            title={affordable ? `Unlock ${def.title}` : `Not enough ${CURRENCY_LABEL[def.currency]} yet`}
            className={cn(
              'nodrag inline-flex h-5 items-center gap-1 rounded-comfy border px-2 text-[10px] font-bold uppercase tracking-[0.06em] transition-[filter,transform,background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
              affordable
                ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#8a9a00] hover:brightness-105 active:translate-y-px active:shadow-none'
                : 'border-electric-400/40 bg-transparent text-electric-400/70 hover:border-electric-400/70',
            )}
          >
            Unlock
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-right text-[10px] font-medium text-smoke-800" title={reason}>
            {reason}
          </span>
        )}
      </div>
    </motion.div>
  )
}

function Price({ currency, cost, color }: { currency: MapFlowNode['data']['def']['currency']; cost: number; color: string }) {
  if (cost === 0) return <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-smoke-600">Free</span>
  if (currency === 'credits') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-extrabold tabular-nums text-credits">
        <CreditsIcon size={11} className="shrink-0" />
        {formatNum(cost)}
      </span>
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-comfy border px-1.5 py-px text-[10px] font-extrabold tabular-nums"
      style={{ color, borderColor: `${color}66`, background: `${color}14` }}
    >
      {formatNum(cost)} {CURRENCY_LABEL[currency]}
    </span>
  )
}

/** Custom node type `mapNode`. */
export const MapNode = memo(MapNodeImpl)

// ---------------------------------------------------------------------------
// laneGroup
// ---------------------------------------------------------------------------

function LaneGroupImpl({ data }: NodeProps<LaneGroupNode>) {
  const { branch, label, blurb, color, width, height, rebrandCta } = data
  return (
    <div
      aria-hidden={rebrandCta ? undefined : true}
      className="cc-map-lane"
      style={{ width, height, '--cc-branch': color } as CSSProperties}
    >
      <div className="cc-map-lane__header">
        <BranchGlyph branch={branch} size={16} />
        <span className="cc-map-lane__title">{label}</span>
        <span className="cc-map-lane__blurb">{blurb}</span>
        {rebrandCta ? <RebrandCta /> : null}
      </div>
    </div>
  )
}

/** "Rebrand · +N CP" in the prestige lane header; opens the Rebrand dialog through the overlays. */
function RebrandCta() {
  const store = useGameStore()
  const { cp, can, season } = useGameShallow((s) => ({
    cp: rebrandCp(s.seasonCredits),
    can: canRebrand(s, store.catalog),
    season: s.meta.season,
  }))
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        openModal('rebrand')
      }}
      title={can ? `Rebrand now to bank ${cp} CP and start season ${season + 1}` : 'Own a cloud node or a region before rebranding'}
      className={cn(
        'cc-map-lane__cta nodrag ml-2 inline-flex h-6 items-center gap-1.5 rounded-comfy border px-2 text-[10px] font-bold uppercase tracking-[0.08em] transition-[filter,transform,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
        can
          ? 'border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_2px_0_#8a9a00] hover:brightness-105 active:translate-y-px active:shadow-none'
          : 'border-charcoal-300 bg-charcoal-700 text-smoke-600 hover:border-charcoal-200 hover:text-smoke-100',
      )}
    >
      <RefreshCw size={11} aria-hidden="true" />
      Rebrand
      <span className={cn('tabular-nums', can ? 'text-charcoal-800/80' : 'text-smoke-800')}>+{cp} CP</span>
    </button>
  )
}

/** Custom node type `laneGroup`. */
export const LaneGroup = memo(LaneGroupImpl)
