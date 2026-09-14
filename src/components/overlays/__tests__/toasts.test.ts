import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearToasts, dismissToast, getToasts, toast, TOAST_DURATION_MS } from '@/components/overlays/useToasts'

/**
 * The bus, and specifically what a repeated `key` does. Spamming the save key used to queue a new
 * card per press: the old one animated out, a new one animated in, and the clock started over from
 * a card the player had not finished reading. A repeat now refreshes the card that is already
 * there, in place and in position.
 */
describe('toast bus', () => {
  beforeEach(() => {
    clearToasts()
    vi.useRealTimers()
  })

  it('queues one card per call when no key is given', () => {
    const a = toast('one')
    const b = toast('two')
    expect(a).not.toBe(b)
    expect(getToasts().map((t) => t.message)).toEqual(['one', 'two'])
  })

  it('refreshes a keyed toast in place instead of stacking a new one', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const first = toast('Saved', { key: 'saved' })
    const createdAt = getToasts()[0]!.createdAt

    vi.setSystemTime(2_500)
    const second = toast('Already saved · again in 7s', { key: 'saved' })

    expect(second).toBe(first)
    const all = getToasts()
    expect(all).toHaveLength(1)
    expect(all[0]!.message).toBe('Already saved · again in 7s')
    // The card is the same one: same id, same birthday, later refresh.
    expect(all[0]!.createdAt).toBe(createdAt)
    expect(all[0]!.refreshedAt).toBe(2_500)
  })

  it('keeps a refreshed toast in its place in the queue', () => {
    toast('first', { key: 'saved' })
    toast('second')
    toast('third')
    toast('refreshed', { key: 'saved' })
    expect(getToasts().map((t) => t.message)).toEqual(['refreshed', 'second', 'third'])
  })

  it('carries the new options across a refresh and defaults the rest', () => {
    toast('Saved', { key: 'saved', tone: 'electric', durationMs: 3_000, title: 'Save' })
    toast('Already saved', { key: 'saved' })
    const item = getToasts()[0]!
    expect(item.tone).toBe('default')
    expect(item.durationMs).toBe(TOAST_DURATION_MS)
    expect(item.title).toBeUndefined()
  })

  it('dismisses by id, refreshed or not', () => {
    const id = toast('Saved', { key: 'saved' })
    toast('Already saved', { key: 'saved' })
    dismissToast(id)
    expect(getToasts()).toHaveLength(0)
  })
})
