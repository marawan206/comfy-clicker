'use client'
import { Trophy } from 'lucide-react'
import { RoutePage } from '@/components/layout/RoutePage'
import { useGame } from '@/state/useGame'

export default function LeaderboardPage() {
  const lifetime = useGame((s) => s.lifetimeCredits)
  const likes = useGame((s) => s.lifetimeLikes)
  const followers = useGame((s) => s.lifetimeFollowers)
  return (
    <RoutePage
      icon={Trophy}
      stripe="electric"
      eyebrow="Leaderboard"
      title="Your run, before anyone else sees it"
      lede="The global board ranks lifetime credits once cloud saves land. These are the numbers it will read from your save — so this is a good moment to make them bigger."
      stats={[
        { label: 'Lifetime credits', value: lifetime, credits: true },
        { label: 'Lifetime likes', value: likes },
        { label: 'Lifetime followers', value: followers },
      ]}
    />
  )
}
