import { NextResponse } from 'next/server'
import { readFeed } from '@/server/feed/store'

export const dynamic = 'force-dynamic'

/** The three hashtag ids currently trending on the real-content feed (empty when unknown). */
export async function GET() {
  const snapshot = await readFeed()
  return NextResponse.json(
    { tags: snapshot.trending, updatedAt: snapshot.updatedAt, origin: snapshot.origin },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  )
}
