import { NextResponse } from 'next/server'
import { fetchLeaderboard, type LeaderboardResult } from '@/server/leaderboard'

export const dynamic = 'force-dynamic'

/** Top 100 by lifetime credits from the public `leaderboard` view, plausibility-flagged. */
export async function GET(): Promise<NextResponse<LeaderboardResult | { error: string }>> {
  try {
    const result = await fetchLeaderboard()
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
    })
  } catch (err) {
    console.error('[leaderboard] read failed', err)
    return NextResponse.json({ error: 'The board is unreachable right now.' }, { status: 502 })
  }
}
