import { NextResponse, type NextRequest } from 'next/server'
import { refreshHubRuns24h } from '@/server/supabase/admin'
import { isCronAuthorized } from '@/server/supabase/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Cron: recompute `hub_workflows.runs_24h` from the last 24 h of `hub_runs` so the Trending sort
 * decays. Vercel Cron (vercel.json) sends `Authorization: Bearer $CRON_SECRET`; nothing else counts.
 */
async function handle(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const changed = await refreshHubRuns24h()
    return NextResponse.json({ ok: true, changed, refreshedAt: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'refresh failed' }, { status: 503 })
  }
}

export const GET = handle
export const POST = handle
