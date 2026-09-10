'use client'
import { Workflow } from 'lucide-react'
import { RoutePage } from '@/components/layout/RoutePage'
import { useGame } from '@/state/useGame'

export default function HubPage() {
  const rep = useGame((s) => s.hubRep)
  const posts = useGame((s) => s.stats.posts)
  const virals = useGame((s) => s.stats.virals)
  return (
    <RoutePage
      icon={Workflow}
      stripe="sapphire"
      eyebrow="ComfyHub"
      title="Workflows ship in the next build"
      lede="ComfyHub is where you publish a workflow, other players run it, and royalties trickle back as credits and reputation. Until it opens, keep posting — your reputation starts from what you have already made."
      stats={[
        { label: 'Hub reputation', value: rep },
        { label: 'Posts made', value: posts },
        { label: 'Went viral', value: virals },
      ]}
    />
  )
}
