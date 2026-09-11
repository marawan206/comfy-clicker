import { NextResponse, type NextRequest } from 'next/server'
import { publishWorkflow } from '@/server/hub'

export const dynamic = 'force-dynamic'

/** `POST /api/hub/publish` — publish a workflow as the signed-in player. */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  const result = await publishWorkflow(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.value, { status: 201 })
}
