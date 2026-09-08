import { NextResponse } from 'next/server'
import { hasSupabase } from '@/server/supabase/env'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString(), supabase: hasSupabase() })
}
