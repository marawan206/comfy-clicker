import { NextResponse, type NextRequest } from 'next/server'
import { recordRun } from '@/server/hub'

export const dynamic = 'force-dynamic'

/** `POST /api/hub/run` — the signed-in player ran a workflow; records the run and the author's royalty. */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  const result = await recordRun(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.value, { status: 201 })
}
