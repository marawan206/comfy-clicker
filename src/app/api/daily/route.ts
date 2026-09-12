/**
 * POST /api/daily: server-timed daily claim for signed-in players.
 *
 * The UTC day comes from the server clock, not the client's, and `daily_logins` (one row per
 * user and day) is the record: a second claim on the same day is refused with 409 (carrying the
 * day and streak already held, so the client can adopt them), so a clock rolled forward in the
 * browser earns nothing extra. The streak continues when yesterday was claimed, or the day
 * before, when the player's cloud save owns the Streak Grace node (read from `saves`, never
 * asserted by the client); otherwise it restarts at 1. Returns `{ day, streak, rewardMultiplier }`,
 * where `rewardMultiplier` is the position in the seven-day cycle the client pays out for.
 *
 * Writes use the service role (0003 removed the client insert policy); without it the cookie
 * client is tried and RLS decides. Guests never call this; they keep the local claim path.
 */
import { NextResponse } from 'next/server'
import { CATALOG } from '@/data'
import { cycleDay, dayKey, daysBetween } from '@/game/daily'
import { computeDerived } from '@/game/derived'
import { loadSave } from '@/game/save'
import { getSupabaseAdminClient } from '@/server/supabase/admin'
import { createSupabaseServerClient, type SupabaseServerClient } from '@/server/supabase/server'
import type { Json } from '@/server/supabase/types'

export const dynamic = 'force-dynamic'

interface ClaimResponse {
  day: string
  streak: number
  rewardMultiplier: number
}

/** Whether the player's cloud save owns a `streakGrace` effect (the Graph's Streak Grace node). */
async function hasStreakGrace(db: SupabaseServerClient, userId: string, now: number): Promise<boolean> {
  const { data } = await db.from('saves').select('state').eq('user_id', userId).maybeSingle()
  if (!data) return false
  const raw: Json = data.state
  const blob = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const { state, corrupt } = loadSave(blob, now, 'server', CATALOG)
  if (corrupt) return false
  return computeDerived(state, CATALOG).streakGrace
}

export async function POST(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: 'Cloud features are not configured on this build.' }, { status: 503 })

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in to claim on the server clock.' }, { status: 401 })

  const now = Date.now()
  const today = dayKey(now)

  const { data: last, error: readError } = await supabase
    .from('daily_logins')
    .select('day, streak')
    .eq('user_id', user.id)
    .order('day', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: 'Could not read your login history.' }, { status: 502 })

  if (last && last.day === today) {
    return NextResponse.json(
      { error: 'Already claimed today (UTC). The calendar does not do overtime.', day: today, streak: last.streak },
      { status: 409 },
    )
  }

  let streak = 1
  if (last && last.streak > 0) {
    const gap = daysBetween(last.day, today)
    if (gap === 1) streak = last.streak + 1
    else if (gap === 2 && (await hasStreakGrace(supabase, user.id, now))) streak = last.streak + 1
  }

  const writer = getSupabaseAdminClient() ?? supabase
  const { error: insertError } = await writer.from('daily_logins').insert({ user_id: user.id, day: today, streak })
  if (insertError) {
    // 23505 = unique_violation: a parallel claim beat us to the row.
    if (insertError.code === '23505') {
      const { data: held } = await supabase.from('daily_logins').select('streak').eq('user_id', user.id).eq('day', today).maybeSingle()
      return NextResponse.json({ error: 'Already claimed today (UTC).', day: today, streak: held?.streak ?? streak }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not record the claim.' }, { status: 502 })
  }

  const body: ClaimResponse = { day: today, streak, rewardMultiplier: cycleDay(streak) }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
