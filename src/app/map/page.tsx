'use client'
import { Waypoints } from 'lucide-react'
import { RoutePage } from '@/components/layout/RoutePage'
import { rpAvailable } from '@/game/map'
import { useGame } from '@/state/useGame'

export default function MapPage() {
  const rp = useGame((s) => rpAvailable(s))
  const signups = useGame((s) => s.signups)
  const nodes = useGame((s) => s.mapNodes.length)
  return (
    <RoutePage
      icon={Waypoints}
      stripe="model"
      eyebrow="The Graph"
      title="The skill tree is still compiling"
      lede="Every signup your posts earn is a Research Point. The Graph spends them on nodes — API Nodes, ROCm, Fast Weeks and the rest. Bank RP now; the canvas opens in the next build."
      stats={[
        { label: 'Research Points', value: rp },
        { label: 'Signups', value: signups },
        { label: 'Nodes unlocked', value: nodes },
      ]}
    />
  )
}
