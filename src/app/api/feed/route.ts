import { NextResponse, after } from 'next/server'
import { readFeed, refreshFeed } from '@/server/feed/store'

export const dynamic = 'force-dynamic'

/** Latest feed snapshot. Kicks off a background refresh when stale so callers never wait on the network. */
export async function GET() {
  const snapshot = await readFeed()
  if (snapshot.stale) {
    after(async () => {
      try {
        await refreshFeed()
      } catch (err) {
        console.error('[feed] background refresh failed', err)
      }
    })
  }
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
