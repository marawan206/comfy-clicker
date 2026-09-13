/**
 * Welcome gifts, offered once per account and always declinable.
 *
 * The 850 W PSU rides along with the card because 600 W plus the 65 W starter box is over the
 * 650 W base budget, and a gift that arrives throttled reads as a bug.
 */
import type { GiftGrant, GiftKind } from '@/game/types'

export const GIFTS: Record<GiftKind, GiftGrant> = {
  founder: { flag: 'gift:founder', hardware: { id: 'rtx-pro-6000', count: 1 }, upgrades: ['psu-850'] },
  sonam: { flag: 'gift:sonam', credits: 50_000 },
}
