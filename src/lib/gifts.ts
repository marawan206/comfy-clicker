/**
 * Who gets a welcome gift. Pure, so both the sign-in modal and its tests can use it.
 *
 * The table itself lives in `src/data/gifts.ts` (which may import only game types and constants,
 * hence the split). Founder wins when an account matches both.
 */
import type { GiftKind } from '@/game/types'

export type { GiftKind }

/** Exact addresses that always get the founder gift. */
export const FOUNDER_EMAILS: readonly string[] = ['yoland@comfy.org', 'robin@comfy.org', 'comfy@comfy.org']
/** Substrings in an email or handle that get the founder gift. */
export const FOUNDER_MARKERS: readonly string[] = ['yoland', 'robin', 'yaozhong']
/** Substring that gets the credits gift. */
export const SONAM_MARKER = 'sonam'

function clean(value?: string | null): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** The gift this account is owed, or null. Case and whitespace do not matter. */
export function giftFor(email?: string | null, handle?: string | null): GiftKind | null {
  const mail = clean(email)
  const name = clean(handle)
  if (!mail && !name) return null
  if (FOUNDER_EMAILS.includes(mail)) return 'founder'
  if (FOUNDER_MARKERS.some((m) => mail.includes(m) || name.includes(m))) return 'founder'
  if (mail.includes(SONAM_MARKER) || name.includes(SONAM_MARKER)) return 'sonam'
  return null
}
