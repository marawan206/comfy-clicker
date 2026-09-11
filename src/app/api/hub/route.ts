import { NextResponse, type NextRequest } from 'next/server'
import { listHub } from '@/server/hub'

export const dynamic = 'force-dynamic'

/** `GET /api/hub?sort=trending|new&tag=<hashtag id>&limit=<n>` — the public ComfyHub listing. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const result = await listHub({
    sort: params.get('sort') === 'new' ? 'new' : 'trending',
    tag: params.get('tag') || undefined,
    limit: params.get('limit') ?? undefined,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.value, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
