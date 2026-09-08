import { NextResponse, type NextRequest } from 'next/server'
import { refreshFeed } from '@/server/feed/store'
import { isCronAuthorized } from '@/server/supabase/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  return isCronAuthorized(req.headers.get('authorization'))
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const result = await refreshFeed()
  return NextResponse.json({
    ok: true,
    items: result.items.length,
    trending: result.trending,
    errors: result.errors,
    fetchedAt: result.fetchedAt,
  })
}

export const GET = handle
export const POST = handle
