'use client'
/**
 * A noodle: the bezier link between a parent and a child node, in the child's branch colour.
 * Owned links are bright, the frontier (owned parent → available child) flows electric with a
 * soft glow, locked links sit dim in the background. Pure SVG, no interaction.
 */
import { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { MapFlowEdge } from './mapLayout'

function MapEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<MapFlowEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 })
  const state = data?.state ?? 'locked'
  const dimmed = data?.dimmed ?? false
  const color = data?.color ?? '#8a8a8a'
  return (
    <g data-edge={id} aria-hidden="true">
      {state === 'available' && !dimmed ? <path d={path} className="cc-map-edge cc-map-edge--glow" /> : null}
      <path
        d={path}
        className={cn('react-flow__edge-path cc-map-edge', `cc-map-edge--${state}`, dimmed && 'cc-map-edge--dimmed')}
        style={state === 'available' ? undefined : { stroke: color }}
      />
    </g>
  )
}

/** Custom edge type `noodle`. */
export const MapEdge = memo(MapEdgeImpl)
