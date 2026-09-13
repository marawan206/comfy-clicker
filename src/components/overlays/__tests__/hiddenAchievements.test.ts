/**
 * Hidden achievements must not be findable by reading the page.
 *
 * The grid renders `???` for every hidden row the player has not earned, and this asserts the
 * stronger property behind that: neither the name nor the description of an unearned hidden
 * achievement reaches the markup at all, in any attribute. A `title` or an `aria-label` leaking the
 * answer would defeat the whole point, and both are easy to add back by accident.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AchievementTiles, buildTiles } from '@/components/overlays/StatsModal'
import { CATALOG } from '@/data'
import { computeDerived } from '@/game/derived'
import { createInitialState } from '@/game/state'

/** The rendered text node, not the `title` (which is also `???`), so the count is one per tile. */
const HIDDEN_PLACEHOLDER = '>???<'

function markupFor(owned: ReadonlySet<string>): string {
  const state = createInitialState(0, 'test')
  for (const id of owned) state.achievements.push(id)
  const derived = computeDerived(state, CATALOG)
  const tiles = buildTiles(owned, state, derived, CATALOG)
  const html = renderToStaticMarkup(createElement(AchievementTiles, { tiles }))
  // Entity-decode the few escapes React writes, so a leaked apostrophe still counts as a leak.
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

const hidden = CATALOG.achievements.filter((a) => a.hidden === true)

describe('hidden achievements in the Stats grid', () => {
  it('has hidden achievements to hide', () => {
    expect(hidden.length).toBeGreaterThan(0)
  })

  it('renders one ??? per unearned hidden achievement', () => {
    const html = markupFor(new Set())
    expect(html.split(HIDDEN_PLACEHOLDER).length - 1).toBe(hidden.length)
  })

  it('never puts a hidden name or description in the markup', () => {
    const html = markupFor(new Set())
    for (const def of hidden) {
      expect(html, `leaked the name of ${def.id}`).not.toContain(def.name)
      expect(html, `leaked the description of ${def.id}`).not.toContain(def.desc)
    }
  })

  it('reveals the real name once the achievement is earned', () => {
    const def = hidden[0]
    expect(def).toBeDefined()
    const html = markupFor(new Set([(def as { id: string }).id]))
    expect(html).toContain((def as { name: string }).name)
    expect(html.split(HIDDEN_PLACEHOLDER).length - 1).toBe(hidden.length - 1)
  })
})
