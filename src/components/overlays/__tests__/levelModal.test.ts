/**
 * The Level screen's earn table is built by a pure function, so every row it can print is pinned
 * here: the order, the live figures (all of them out of the engine, none typed in), where each row
 * routes, and the house style (no em-dash, no exclamation mark).
 */
import { describe, expect, it } from 'vitest'
import { CATALOG } from '@/data'
import { LORA_MAP_NODE } from '@/game/actions'
import {
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_CREDITS,
  XP_HARDWARE_FIRST,
  XP_LORA,
  XP_MAP_NODE,
  XP_MILESTONE,
  XP_QUANTIZE,
  XP_REBRAND,
  XP_SETUP,
  XP_TIER,
  XP_UPGRADE,
} from '@/game/constants'
import { DAILY_CYCLE_DAYS } from '@/game/daily'
import { createEmptyDerived } from '@/game/derived'
import { creditsXp, dailyXp } from '@/game/level'
import { ROOT_NODE_ID, mapNodeAvailable, mapNodeCost } from '@/game/map'
import { STARTER_MODEL_ID, createInitialState } from '@/game/state'
import type { Derived, GameState } from '@/game/types'
import { bestSetupModel, cheapestOpenNode, earnRows } from '../LevelModal'

/** The one character the house style forbids, spelled so this file does not contain it. */
const EM_DASH = String.fromCharCode(0x2014)

const DERIVED: Derived = createEmptyDerived()

function fresh(mutate?: (s: GameState) => void): GameState {
  const state = createInitialState(0, 'guest')
  mutate?.(state)
  return state
}

const row = (state: GameState, key: string) => {
  const found = earnRows(state, DERIVED, CATALOG).find((r) => r.key === key)
  if (!found) throw new Error(`no row ${key}`)
  return found
}

describe('bestSetupModel', () => {
  it('is the starter on a fresh save', () => {
    expect(bestSetupModel(fresh(), CATALOG)?.id).toBe(STARTER_MODEL_ID)
  })

  it('is the highest-level checkpoint that is set up, not merely owned', () => {
    const state = fresh((s) => {
      s.models['flux-dev'] = { precisions: ['native'], setup: true }
      s.models['flux-kontext'] = { precisions: ['native'], setup: false }
    })
    expect(bestSetupModel(state, CATALOG)?.id).toBe('flux-dev')
  })

  it('is null when nothing is set up', () => {
    expect(bestSetupModel(fresh((s) => (s.models = {})), CATALOG)).toBeNull()
  })
})

describe('cheapestOpenNode', () => {
  it('is the root on a fresh save', () => {
    expect(cheapestOpenNode(fresh(), DERIVED, CATALOG)).toBe(ROOT_NODE_ID)
  })

  it('is the cheapest node the Graph would sell once the root is taken', () => {
    const state = fresh((s) => s.mapNodes.push(ROOT_NODE_ID))
    const id = cheapestOpenNode(state, DERIVED, CATALOG)
    expect(id).not.toBe(ROOT_NODE_ID)
    const open = CATALOG.mapNodes.filter((n) => mapNodeAvailable(n, state, DERIVED, CATALOG))
    expect(open.map((n) => n.id)).toContain(id)
    const cost = mapNodeCost(CATALOG.mapNodes.find((n) => n.id === id)!)
    for (const n of open) expect(mapNodeCost(n)).toBeGreaterThanOrEqual(cost)
  })

  it('falls back to the root when the whole Graph is owned', () => {
    const state = fresh((s) => (s.mapNodes = CATALOG.mapNodes.map((n) => n.id)))
    expect(cheapestOpenNode(state, DERIVED, CATALOG)).toBe(ROOT_NODE_ID)
  })
})

describe('earnRows', () => {
  it('lists every source in the order the screen shows them', () => {
    expect(earnRows(fresh(), DERIVED, CATALOG).map((r) => r.key)).toEqual([
      'post',
      'contract',
      'mapNode',
      'achievement',
      'hardware',
      'upgrade',
      'setup',
      'quantize',
      'lora',
      'daily',
      'milestone',
      'rebrand',
      'credits',
    ])
  })

  it('prices a post on the best set-up checkpoint, viral doubled', () => {
    const starter = row(fresh(), 'post')
    expect(starter.label).toBe('Post with Stable Diffusion 1.5')
    expect(starter.value).toBe('+7')
    expect(starter.note).toBe('+14 when it goes viral')
    expect(starter.action).toEqual({ type: 'center', tab: 'studio' })

    const flux = row(
      fresh((s) => (s.models['flux-dev'] = { precisions: ['native'], setup: true })),
      'post',
    )
    expect(flux.label).toBe('Post with FLUX.1 Dev')
    expect(flux.value).toBe('+16')
    expect(flux.note).toBe('+32 when it goes viral')
  })

  it('quotes the engine constants, never a typed-in number', () => {
    const state = fresh()
    expect(row(state, 'contract').value).toBe(`+${XP_CONTRACT}`)
    expect(row(state, 'mapNode').value).toBe(`+${XP_MAP_NODE}`)
    expect(row(state, 'achievement').value).toBe(`+${XP_ACHIEVEMENT}`)
    expect(row(state, 'hardware').value).toBe(`+${XP_HARDWARE_FIRST}`)
    expect(row(state, 'upgrade').value).toBe(`+${XP_UPGRADE} · tiers +${XP_TIER}`)
    expect(row(state, 'setup').value).toBe(`+${XP_SETUP}`)
    expect(row(state, 'quantize').value).toBe(`+${XP_QUANTIZE}`)
    expect(row(state, 'lora').value).toBe(`+${XP_LORA}`)
    expect(row(state, 'daily').value).toBe(`+${dailyXp(1)} to +${dailyXp(DAILY_CYCLE_DAYS)}`)
    expect(row(state, 'daily').value).toBe('+40 to +280')
    expect(row(state, 'milestone').value).toBe(`+${XP_MILESTONE}`)
    expect(row(state, 'rebrand').value).toBe(`+${XP_REBRAND}`)
    expect(row(state, 'credits').value).toBe(`${XP_CREDITS} per decade`)
  })

  it('reads the credits term off the save', () => {
    expect(row(fresh(), 'credits').note).toBe('you are at 0')
    const rich = fresh((s) => (s.lifetimeCredits = 1_000_000))
    expect(creditsXp(rich)).toBe(900)
    expect(row(rich, 'credits').note).toBe('you are at 900')
    expect(row(rich, 'credits').action).toEqual({ type: 'hero' })
  })

  it('sends the Graph row to the cheapest open node', () => {
    expect(row(fresh(), 'mapNode').action).toEqual({ type: 'map', nodeId: ROOT_NODE_ID })
    const state = fresh((s) => s.mapNodes.push(ROOT_NODE_ID))
    expect(row(state, 'mapNode').action).toEqual({ type: 'map', nodeId: cheapestOpenNode(state, DERIVED, CATALOG) })
  })

  it('sends the LoRA row to the Graph until the trainer node is owned', () => {
    const before = row(fresh(), 'lora')
    expect(before.action).toEqual({ type: 'map', nodeId: LORA_MAP_NODE })
    expect(before.note).toBe('LoRA Training is a Graph node first')
    const after = row(
      fresh((s) => s.mapNodes.push(LORA_MAP_NODE)),
      'lora',
    )
    expect(after.action).toEqual({ type: 'store', tab: 'models' })
    expect(after.note).toBeUndefined()
  })

  it('routes every other row where the XP is made', () => {
    const state = fresh()
    expect(row(state, 'contract').action).toEqual({ type: 'center', tab: 'contracts' })
    expect(row(state, 'achievement').action).toEqual({ type: 'modal', id: 'stats' })
    expect(row(state, 'hardware').action).toEqual({ type: 'store', tab: 'hardware' })
    expect(row(state, 'upgrade').action).toEqual({ type: 'store', tab: 'upgrades' })
    expect(row(state, 'setup').action).toEqual({ type: 'store', tab: 'models' })
    expect(row(state, 'quantize').action).toEqual({ type: 'store', tab: 'models' })
    expect(row(state, 'daily').action).toEqual({ type: 'modal', id: 'daily' })
    expect(row(state, 'milestone').action).toEqual({ type: 'hero' })
    expect(row(state, 'rebrand').action).toEqual({ type: 'modal', id: 'rebrand' })
  })

  it('keeps the house style on every line', () => {
    for (const r of earnRows(fresh(), DERIVED, CATALOG)) {
      for (const text of [r.label, r.value, r.note ?? '']) {
        expect(text).not.toContain(EM_DASH)
        expect(text).not.toContain('!')
      }
      expect(r.label.length).toBeLessThanOrEqual(40)
    }
  })
})
