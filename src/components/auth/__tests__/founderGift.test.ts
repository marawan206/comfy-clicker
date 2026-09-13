/**
 * The welcome-gift offer rules, which are the part with money in them: who is owed a card, whose
 * username is allowed to count as evidence, and when the question stops being asked.
 *
 * `giftFor` itself is covered in the lib test; what is pinned here is the layer above it, where a
 * renamed handle stops being proof and an answered flag closes the offer for good.
 */
import { describe, expect, it } from 'vitest'
import { GIFTS } from '@/data/gifts'
import { GIFT_DECLINED_SUFFIX } from '@/game/actions'
import { answerBits, answerFlags, declinedFlag, matchableHandle, pendingGift } from '../FounderGiftModal'

const NONE: Record<string, boolean> = {}
/** An ISO timestamp: any non-null value means the player renamed themselves at some point. */
const RENAMED = '2026-09-01T12:00:00.000Z'

describe('matchableHandle', () => {
  it('trusts a handle nobody has changed', () => {
    expect(matchableHandle('nobody@example.com', 'yoland_vibes', null)).toBe('yoland_vibes')
  })

  it('stops trusting it after a rename', () => {
    expect(matchableHandle('nobody@example.com', 'yoland_vibes', RENAMED)).toBeNull()
  })

  it('keeps trusting a renamed handle on a comfy.org address', () => {
    expect(matchableHandle('someone@comfy.org', 'yaozhong', RENAMED)).toBe('yaozhong')
  })

  it('is not fooled by a domain that merely ends in the right letters', () => {
    expect(matchableHandle('someone@notcomfy.org', 'robin', RENAMED)).toBeNull()
    expect(matchableHandle('someone@comfy.org.evil.com', 'robin', RENAMED)).toBeNull()
  })

  it('has nothing to say without a handle', () => {
    expect(matchableHandle('yoland@comfy.org', null, null)).toBeNull()
  })
})

describe('pendingGift', () => {
  it('gives the founders their card by exact address', () => {
    for (const email of ['yoland@comfy.org', 'robin@comfy.org', 'comfy@comfy.org']) {
      expect(pendingGift(email, null, null, NONE)).toBe('founder')
    }
  })

  it('gives it on a marker in the email or in an unchanged handle', () => {
    expect(pendingGift('yoland.chen@gmail.com', 'someone', null, NONE)).toBe('founder')
    expect(pendingGift('nobody@example.com', 'robin-hood', null, NONE)).toBe('founder')
    expect(pendingGift('nobody@example.com', 'yaozhong', null, NONE)).toBe('founder')
    expect(pendingGift('YAOZHONG@Example.com', null, null, NONE)).toBe('founder')
  })

  it('gives Sonam the credits', () => {
    expect(pendingGift('sonam@example.com', null, null, NONE)).toBe('sonam')
    expect(pendingGift('nobody@example.com', 'sonam_x', null, NONE)).toBe('sonam')
  })

  it('hands the card over when both match', () => {
    expect(pendingGift('sonam@example.com', 'robin', null, NONE)).toBe('founder')
  })

  it('refuses to be farmed by renaming', () => {
    expect(pendingGift('nobody@example.com', 'robin_x', RENAMED, NONE)).toBeNull()
    expect(pendingGift('nobody@example.com', 'sonam_x', RENAMED, NONE)).toBeNull()
  })

  it('offers nothing to everybody else', () => {
    expect(pendingGift('player@example.com', 'player', null, NONE)).toBeNull()
    expect(pendingGift(null, null, null, NONE)).toBeNull()
    expect(pendingGift(undefined, undefined, undefined, NONE)).toBeNull()
  })

  it('asks exactly once, however it was answered', () => {
    expect(pendingGift('robin@comfy.org', null, null, { [GIFTS.founder.flag]: true })).toBeNull()
    expect(pendingGift('robin@comfy.org', null, null, { [declinedFlag('founder')]: true })).toBeNull()
    expect(pendingGift('sonam@example.com', null, null, { [GIFTS.sonam.flag]: true })).toBeNull()
    expect(pendingGift('sonam@example.com', null, null, { [declinedFlag('sonam')]: true })).toBeNull()
  })

  it('keeps the other offer alive when one is answered', () => {
    expect(pendingGift('sonam@example.com', null, null, { [GIFTS.founder.flag]: true })).toBe('sonam')
  })
})

describe('answer flags', () => {
  it('names the flag the decline action writes', () => {
    expect(declinedFlag('founder')).toBe(`${GIFTS.founder.flag}${GIFT_DECLINED_SUFFIX}`)
    expect(declinedFlag('sonam')).toBe(`${GIFTS.sonam.flag}${GIFT_DECLINED_SUFFIX}`)
  })

  it('round-trips the four bits the modal watches', () => {
    const flags = { [GIFTS.sonam.flag]: true, [declinedFlag('founder')]: true, 'egg:konami': true }
    const bits = answerBits(flags)
    expect(bits).toBe('0110')
    expect(answerFlags(bits)).toEqual({
      [GIFTS.founder.flag]: false,
      [declinedFlag('founder')]: true,
      [GIFTS.sonam.flag]: true,
      [declinedFlag('sonam')]: false,
    })
  })

  it('moves when an answer lands, which is what wakes the effect up', () => {
    expect(answerBits({})).toBe('0000')
    expect(answerBits({ [GIFTS.founder.flag]: true })).not.toBe(answerBits({}))
  })
})
