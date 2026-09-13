import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatPct } from '@/game/format'
import { RATIO_LOSS_MULT } from '@/game/constants'
import { FLOP_ROLL } from '@/game/virality'
import { PICK_HASHTAG_EVENT } from '@/components/feed/feedHooks'
import {
  CENTER_TAB_EVENT,
  MAX_SELECTED_TAGS,
  ensurePickHashtagBridge,
  patchSelection,
  ratioedReturn,
  selectHashtag,
} from '@/components/studio/studioHooks'

/** The module store is a singleton, so every case starts from a known, empty selection. */
beforeEach(() => {
  window.localStorage.clear()
  patchSelection({ modelId: 'sd15', precision: 'native', prompt: '', tags: [] })
})

describe('ratioedReturn', () => {
  it('is the sunk job plus the flop-band loss on top', () => {
    const mean = (FLOP_ROLL[0] + FLOP_ROLL[1]) / 2
    expect(ratioedReturn()).toBeCloseTo(-(1 + RATIO_LOSS_MULT * mean), 10)
  })

  it('renders as the cost line prints it', () => {
    expect(formatPct(ratioedReturn())).toBe('-145%')
  })
})

describe('selectHashtag', () => {
  it('adds a tag to the shared form', () => {
    selectHashtag('cats')
    expect(window.localStorage.getItem('comfy-clicker:studio')).toContain('cats')
  })

  it('is a no-op for a tag that is already on the post', () => {
    patchSelection({ tags: ['cats', 'cozy'] })
    selectHashtag('cats')
    expect(JSON.parse(window.localStorage.getItem('comfy-clicker:studio') ?? '{}').tags).toEqual(['cats', 'cozy'])
  })

  it('rolls the oldest tag out at the cap instead of refusing the click', () => {
    patchSelection({ tags: ['cats', 'cozy', 'retro'] })
    selectHashtag('anime')
    const { tags } = JSON.parse(window.localStorage.getItem('comfy-clicker:studio') ?? '{}') as { tags: string[] }
    expect(tags).toEqual(['cozy', 'retro', 'anime'])
    expect(tags).toHaveLength(MAX_SELECTED_TAGS)
  })
})

describe('the comfy:pick-hashtag bridge', () => {
  it('selects the tag and brings the Studio forward', () => {
    ensurePickHashtagBridge()
    const onTab = vi.fn()
    window.addEventListener(CENTER_TAB_EVENT, onTab)
    window.dispatchEvent(new CustomEvent(PICK_HASHTAG_EVENT, { detail: 'cyberpunk' }))
    window.removeEventListener(CENTER_TAB_EVENT, onTab)

    expect(JSON.parse(window.localStorage.getItem('comfy-clicker:studio') ?? '{}').tags).toContain('cyberpunk')
    expect(onTab).toHaveBeenCalledTimes(1)
    expect((onTab.mock.calls[0]?.[0] as CustomEvent<string>).detail).toBe('studio')
  })

  it('ignores a detail that is not a hashtag id', () => {
    ensurePickHashtagBridge()
    const onTab = vi.fn()
    window.addEventListener(CENTER_TAB_EVENT, onTab)
    window.dispatchEvent(new CustomEvent(PICK_HASHTAG_EVENT, { detail: 'not-a-tag' }))
    window.dispatchEvent(new CustomEvent(PICK_HASHTAG_EVENT, { detail: 42 }))
    window.removeEventListener(CENTER_TAB_EVENT, onTab)

    expect(JSON.parse(window.localStorage.getItem('comfy-clicker:studio') ?? '{}').tags).toEqual([])
    expect(onTab).not.toHaveBeenCalled()
  })

  it('arms exactly one listener however often it is called', () => {
    ensurePickHashtagBridge()
    ensurePickHashtagBridge()
    const onTab = vi.fn()
    window.addEventListener(CENTER_TAB_EVENT, onTab)
    window.dispatchEvent(new CustomEvent(PICK_HASHTAG_EVENT, { detail: 'dragons' }))
    window.removeEventListener(CENTER_TAB_EVENT, onTab)
    expect(onTab).toHaveBeenCalledTimes(1)
  })
})
