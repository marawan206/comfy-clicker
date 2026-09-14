/**
 * The guidance copy is pure, so every line the popover can show is pinned here: the exact wording
 * per cause, the house rules (no em-dash, a step is either actionable or has no button at all) and
 * the promise that the whole catalog can be explained without a single "Locked." dead end.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG } from '@/data'
import { MAX_LEVEL } from '@/game/constants'
import { createEmptyDerived } from '@/game/derived'
import { formatInt, formatNum } from '@/game/format'
import { explainBuy, explainMapNode, explainRun, type LockCause } from '@/game/guidance'
import { levelProgress } from '@/game/level'
import { createInitialState } from '@/game/state'
import type { Derived, GameState, HardwareDef, ModelDef, Precision } from '@/game/types'
import { stepFor, stepsFor, whyLine, type GuideStore } from '../lockGuide'

/** The one character the house style forbids, spelled so this file does not contain it. */
const EM_DASH = String.fromCharCode(0x2014)

const PRECISIONS: readonly Precision[] = ['native', 'fp8', 'q4']

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

function makeStore(mutate?: (s: GameState) => void, derived: Partial<Derived> = {}): GuideStore {
  const state = createInitialState(0, 'guest')
  mutate?.(state)
  return { catalog: CATALOG, state, derived: derivedWith(derived) }
}

const model = (id: string): ModelDef => {
  const def = CATALOG.models.find((m) => m.id === id)
  if (!def) throw new Error(`missing model ${id}`)
  return def
}
const hardware = (id: string): HardwareDef => {
  const def = CATALOG.hardware.find((h) => h.id === id)
  if (!def) throw new Error(`missing hardware ${id}`)
  return def
}

const store = makeStore()

describe('one cause, one step', () => {
  it('credits point at the button that makes credits', () => {
    const rich = makeStore(undefined, { cps: 10 })
    const step = stepFor({ kind: 'credits', need: 1000, have: 400 }, rich)
    expect(step.label).toBe('Need 1.00K credits · have 400')
    expect(step.detail).toBe('1:00 at your rate, or click Generate.')
    expect(step.action).toEqual({ type: 'hero' })
    expect(step.etaSec).toBe(60)
  })

  it('credits with no income say so instead of quoting infinity', () => {
    const step = stepFor({ kind: 'credits', need: 1000, have: 0 }, store)
    expect(step.detail).toBe('No income yet. Click Generate.')
    expect(step.etaSec).toBeUndefined()
  })

  it('RP comes from signups, CP from a rebrand', () => {
    const rp = stepFor({ kind: 'currency', currency: 'rp', need: 3, have: 1 }, store)
    expect(rp.label).toBe('Need 3 RP · have 1')
    expect(rp.detail).toBe('Signups earn RP. Post, gain followers, cross a milestone.')
    expect(rp.action).toEqual({ type: 'center', tab: 'studio' })

    const cp = stepFor({ kind: 'currency', currency: 'cp', need: 2, have: 0 }, store)
    expect(cp.detail).toBe('Own a cloud node first')
    expect(cp.action).toEqual({ type: 'store', tab: 'hardware', family: 'cloud-node' })

    const prestiged = makeStore((s) => {
      const node = CATALOG.hardware.find((h) => h.family === 'cloud-node') as HardwareDef
      s.hardware[node.id] = 1
    })
    const cpNow = stepFor({ kind: 'currency', currency: 'cp', need: 2, have: 0 }, prestiged)
    expect(cpNow.action).toEqual({ type: 'modal', id: 'rebrand' })
  })

  it('a missing unit names its price, its shelf and its row', () => {
    const step = stepFor({ kind: 'ownHardware', id: 'rtx-3090', count: 1, owned: 0 }, store)
    expect(step.label).toBe(`Own an ${hardware('rtx-3090').name}`)
    expect(step.detail).toBe(`${formatNum(hardware('rtx-3090').baseCost)} credits in Hardware › NVIDIA`)
    expect(step.action).toEqual({ type: 'store', tab: 'hardware', family: 'nvidia-consumer', focusId: 'rtx-3090' })
    expect(step.cost).toBe(hardware('rtx-3090').baseCost)
  })

  it('a Graph node names its lane and its price', () => {
    const step = stepFor({ kind: 'mapNode', id: 'quant-fp8' }, store)
    expect(step.label).toBe('Unlock FP8 Quantization on the Graph')
    expect(step.detail).toBe('1.50K credits · techniques lane')
    expect(step.action).toEqual({ type: 'map', nodeId: 'quant-fp8' })

    const api = stepFor({ kind: 'apiNodes', nodeId: 'api-nodes' }, store)
    expect(api.label).toBe('Unlock API Nodes on the Graph')
    expect(api.detail).toBe('5.00M credits · API lane')
  })

  it('the level gate sends them to the level screen', () => {
    const step = stepFor({ kind: 'level', need: 4, have: 2 }, store)
    const toGo = formatInt(levelProgress(store.state).xpToGo)
    expect(step.label).toBe('Reach level 4')
    expect(step.detail).toBe(`You are level 2. ${toGo} XP to go: post, finish a contract, unlock a Graph node.`)
    expect(step.action).toEqual({ type: 'modal', id: 'level' })
  })

  it('a stat goes where that stat is made', () => {
    expect(stepFor({ kind: 'stat', key: 'clicks', need: 1000, have: 412 }, store)).toMatchObject({
      label: 'Reach 1,000 clicks',
      detail: 'You are at 412.',
      action: { type: 'hero' },
    })
    expect(stepFor({ kind: 'stat', key: 'posts', need: 50, have: 3 }, store).action).toEqual({ type: 'center', tab: 'studio' })
    expect(stepFor({ kind: 'stat', key: 'level', need: 4, have: 1 }, store).action).toEqual({ type: 'modal', id: 'level' })
  })

  it('income sends them shopping', () => {
    const step = stepFor({ kind: 'cps', need: 1000, have: 212 }, makeStore(undefined, { cps: 212 }))
    expect(step.label).toBe('Reach 1.00K/s')
    expect(step.detail).toBe('You make 212/s. Buy hardware.')
    expect(step.action).toEqual({ type: 'store', tab: 'hardware' })
  })

  it('ROCm is an upgrade, with its aisle', () => {
    const step = stepFor({ kind: 'family', family: 'amd-consumer', upgradeId: 'rocm-setup' }, store)
    expect(step.label).toBe('Install ROCm Setup')
    expect(step.detail).toBe('Upgrades › ROCm · 250')
    expect(step.cost).toBe(250)
    expect(step.action).toEqual({ type: 'store', tab: 'upgrades', focusId: 'rocm-setup' })
  })

  it('VRAM offers the quantize first and the bigger card as the alternative', () => {
    const rig = makeStore((s) => {
      s.stats.levelSeen = MAX_LEVEL
      s.hardware['rtx-3060'] = 1
    })
    const cause = explainRun(model('flux-dev'), 'native', rig.state, rig.derived, CATALOG)
    expect(cause?.kind).toBe('vram')
    const step = stepFor(cause as LockCause, rig)
    expect(step.label).toBe('Quantize FP8')
    expect(step.cost).toBe(450)
    expect(step.action).toEqual({ type: 'store', tab: 'models', focusId: 'flux-dev' })
    expect(step.alt?.label).toBe(`Buy an ${hardware('rtx-3090').name}`)
    expect(step.alt?.action).toEqual({ type: 'store', tab: 'hardware', family: 'nvidia-consumer', focusId: 'rtx-3090' })
  })

  it('a setup fee says whether it is free and why', () => {
    const poor = makeStore(undefined, { bestVram: 8 })
    expect(stepFor({ kind: 'setup', modelId: 'flux-dev', fee: 0 }, poor).detail).toBe(
      `${formatNum(model('flux-dev').baseCost)} credits, the --lowvram tax`,
    )
    const roomy = makeStore(undefined, { bestVram: 80 })
    expect(stepFor({ kind: 'setup', modelId: 'flux-dev', fee: 0 }, roomy).detail).toBe('Free, it fits your best card')
  })

  it('what cannot be done gets no button', () => {
    const maxed = stepFor({ kind: 'max', max: 1 }, store)
    expect(maxed).toEqual({ label: 'Maxed out', detail: '1 owned. That is all of them.' })
    const secret = stepFor({ kind: 'flag' }, store)
    expect(secret).toEqual({ label: 'Secret', detail: 'Found, not bought.' })
  })
})

describe('stepsFor', () => {
  it('leads with the why and caps the list at three', () => {
    const rig = makeStore((s) => {
      s.stats.levelSeen = MAX_LEVEL
      s.hardware['rtx-3060'] = 1
    })
    const cause = explainRun(model('flux-dev'), 'native', rig.state, rig.derived, CATALOG) as LockCause
    const spec = stepsFor([cause], rig, 'FLUX.1 Dev')
    expect(spec.subject).toBe('FLUX.1 Dev')
    expect(spec.why).toBe('Needs 20 GB. Your best card has 12 GB.')
    expect(spec.steps.length).toBeLessThanOrEqual(3)
  })

  it('explains a locked AMD row family first, money second', () => {
    const amd = CATALOG.hardware.find((h) => h.family === 'amd-consumer') as HardwareDef
    const spec = stepsFor(explainBuy(amd, store.state, store.derived, CATALOG), store, amd.name)
    expect(spec.why).toBe('AMD cards need a driver stack first.')
    expect(spec.steps[0]?.label).toBe('Install ROCm Setup')
    // The shelf also has a store unlock condition, so the second step is that, not the money.
    expect(spec.steps[1]?.action).toMatchObject({ type: 'store', tab: 'hardware' })
    expect(spec.steps.every((step) => step.action !== undefined)).toBe(true)
  })

  it('walks a deep Graph node back to its parent', () => {
    const spec = stepsFor(explainMapNode(CATALOG.mapNodes.find((n) => n.id === 'quant-q4')!, store.state, store.derived, CATALOG), store, 'GGUF Q4')
    expect(spec.steps[0]?.label).toBe('Unlock FP8 Quantization on the Graph')
    expect(spec.steps[0]?.action).toEqual({ type: 'map', nodeId: 'quant-fp8' })
  })

  it('is empty when nothing is wrong', () => {
    expect(stepsFor([], store, 'SD 1.5')).toEqual({ subject: 'SD 1.5', why: '', steps: [] })
  })
})

describe('house rules', () => {
  const fixtures: GuideStore[] = [
    makeStore(),
    makeStore((s) => {
      s.stats.levelSeen = 6
      s.hardware['rtx-3060'] = 2
      s.credits = 4000
    }, { cps: 12, bestVram: 12 }),
    makeStore((s) => {
      s.stats.levelSeen = MAX_LEVEL
      s.hardware['mac-studio-m4-max'] = 1
      s.credits = 1e7
    }, { cps: 5000, bestVram: 128 }),
  ]

  it('every model at every precision produces a why and at most three steps, never an em-dash', () => {
    for (const fixture of fixtures) {
      for (const def of CATALOG.models) {
        for (const precision of PRECISIONS) {
          const cause = explainRun(def, precision, fixture.state, fixture.derived, CATALOG)
          if (!cause) continue
          const spec = stepsFor([cause], fixture, def.name)
          expect(spec.why.length, `${def.id} ${precision}`).toBeGreaterThan(0)
          expect(spec.why.endsWith('.')).toBe(true)
          expect(spec.steps.length).toBeGreaterThan(0)
          expect(spec.steps.length).toBeLessThanOrEqual(3)
          for (const step of spec.steps) {
            expect(step.label).not.toContain(EM_DASH)
            expect(step.detail ?? '').not.toContain(EM_DASH)
            expect(step.label.length).toBeLessThanOrEqual(64)
          }
          expect(whyLine(cause, fixture)).not.toContain(EM_DASH)
        }
      }
    }
  })

  it('every hardware row the store can refuse gets a step with somewhere to go', () => {
    for (const fixture of fixtures) {
      for (const def of CATALOG.hardware) {
        const causes = explainBuy(def, fixture.state, fixture.derived, CATALOG)
        if (causes.length === 0) continue
        const spec = stepsFor(causes, fixture, def.name)
        const actionable = spec.steps.some((s) => s.action !== undefined)
        const unfixable = causes.every((c) => c.kind === 'max' || c.kind === 'flag')
        expect(actionable || unfixable, `${def.id}`).toBe(true)
      }
    }
  })

  it('every Graph node that is not ready explains itself', () => {
    for (const fixture of fixtures) {
      for (const node of CATALOG.mapNodes) {
        const causes = explainMapNode(node, fixture.state, fixture.derived, CATALOG)
        if (causes.length === 0) continue
        const spec = stepsFor(causes, fixture, node.title)
        expect(spec.steps.length, node.id).toBeGreaterThan(0)
        expect(spec.why.endsWith('.'), node.id).toBe(true)
      }
    }
  })
})
