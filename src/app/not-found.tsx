'use client'
import { Unplug } from 'lucide-react'
import { RoutePage } from '@/components/layout/RoutePage'
import { useGame } from '@/state/useGame'

export default function NotFound() {
  const credits = useGame((s) => s.credits)
  const clicks = useGame((s) => s.totalClicks)
  return (
    <RoutePage
      icon={Unplug}
      stripe="vae"
      eyebrow="404"
      title="Node not found"
      lede="This link points at a node that is not in the graph. The queue kept running anyway."
      stats={[
        { label: 'Credits', value: credits, credits: true },
        { label: 'Generates', value: clicks },
      ]}
    />
  )
}
