import { NextResponse } from 'next/server'
import { claimRoyalties } from '@/server/hub'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/hub/royalties`: collect the signed-in author's unclaimed royalties and rep. The
 * server marks the runs claimed, so the credits land in exactly one game on one device.
 */
export async function POST() {
  const result = await claimRoyalties()
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.value, { headers: { 'Cache-Control': 'no-store' } })
}
