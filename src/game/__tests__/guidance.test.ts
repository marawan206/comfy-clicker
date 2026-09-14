import { describe, expect, it, vi } from 'vitest'

import { CATALOG } from '@/data'
import { MAX_LEVEL } from '@/game/constants'
import { createEmptyDerived } from '@/game/derived'
import {
  causeEta,
  describeCause,
  explainBuy,
  explainMapNode,
  explainQuantize,
  explainRun,
  explainSetup,
  explainUnlock,
  type LockCause,
} from '@/game/guidance'
import { canBuy, lockReason } from '@/game/hardware'
import { canQuantize } from '@/game/quantize'
import { createInitialState } from '@/game/state'
import type { Derived, GameState, HardwareDef, MapNodeDef, ModelDef, Precision } from '@/game/types'

vi.mock('@/game/events', () => ({ eventEffects: () => [] }))

/** The one character the house style forbids, spelled so this file does not contain it. */
const EM_DASH = String.fromCharCode(0x2014)

const PRECISIONS: readonly Precision[] = ['native', 'fp8', 'q4']

const hw = (id: string): HardwareDef => {
  const def = CATALOG.hardware.find((h) => h.id === id)
  if (!def) throw new Error(`missing hardware ${id}`)
  return def
}
const model = (id: string): ModelDef => {
  const def = CATALOG.models.find((m) => m.id === id)
  if (!def) throw new Error(`missing model ${id}`)
  return def
}
const node = (id: string): MapNodeDef => {
  const def = CATALOG.mapNodes.find((n) => n.id === id)
  if (!def) throw new Error(`missing node ${id}`)
  return def
}

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = createInitialState(0, 'guest')
  mutate?.(s)
  return s
}

const base = derivedWith()

/** Three lived-in states: the office PC, a mid-game 3060 rig, and a maxed-out veteran. */
const FIXTURES: ReadonlyArray<{ name: string; state: GameState; derived: Derived }> = [
  { name: 'fresh save', state: fresh(), derived: base },
  {
    name: 'mid game',
    state: fresh((s) => {
      s.stats.levelSeen = 6
      s.hardware['rtx-3060'] = 2
      s.hardware['mac-studio-m4-max'] = 1
      s.credits = 4_000
      s.mapNodes.push('quant-fp8')
    }),
    derived: derivedWith({ cps: 12, bestVram: 12, zluda: false }),
  },
  {
    name: 'veteran',
    state: fresh((s) => {
      s.stats.levelSeen = MAX_LEVEL
      s.hardware['radeon-pro-w7900'] = 1
      s.hardware['rtx-4090'] = 1
      s.credits = 5_000_000
    }),
    derived: derivedWith({ cps: 9_000, bestVram: 48, apiNodes: false, zluda: false }),
  },
]

describe('describeCause is the only wording', () => {
  it('matches lockReason for every model, every precision and three states', () => {
    let checked = 0
    for (const fixture of FIXTURES) {
      for (const def of CATALOG.models) {
        for (const precision of PRECISIONS) {
          const cause = explainRun(def, precision, fixture.state, fixture.derived, CATALOG)
          const reason = lockReason(def, precision, fixture.state, fixture.derived, CATALOG)
          const formatted = cause ? describeCause(cause, CATALOG) : null
          expect(formatted, `${fixture.name} / ${def.id} / ${precision}`).toBe(reason)
          checked += 1
        }
      }
    }
    expect(checked).toBe(FIXTURES.length * CATALOG.models.length * PRECISIONS.length)
  })

  it('never writes an em-dash or a double separator', () => {
    for (const fixture of FIXTURES) {
      for (const def of CATALOG.models) {
        for (const precision of PRECISIONS) {
          const reason = lockReason(def, precision, fixture.state, fixture.derived, CATALOG)
          if (reason === null) continue
          expect(reason).not.toContain(EM_DASH)
          expect(reason).not.toContain('· ·')
          expect(reason.trim()).toBe(reason)
        }
      }
    }
  })
})

describe('the exact strings the lock reasons have always printed', () => {
  const leveled = (mutate?: (s: GameState) => void): GameState =>
    fresh((s) => {
      s.stats.levelSeen = MAX_LEVEL
      mutate?.(s)
    })

  it('VRAM shortfall, with both ways out', () => {
    const state = leveled((s) => {
      s.hardware['rtx-3060'] = 1
    })
    const cause = explainRun(model('flux-dev'), 'native', state, base, CATALOG)
    expect(cause?.kind).toBe('vram')
    expect(describeCause(cause as LockCause, CATALOG)).toBe(
      'Needs 20 GB · your best card has 12 GB · quantize FP8 for 450 or buy an RTX 3090',
    )
  })

  it('the backend refusals', () => {
    expect(describeCause({ kind: 'backend', modelId: 'sdxl', reason: 'cpu', buy: null, zludaNodeId: null }, CATALOG)).toBe(
      "Needs a GPU · SDXL won't run on a CPU box",
    )
    expect(describeCause({ kind: 'backend', modelId: 'flux2', reason: 'zluda', buy: null, zludaNodeId: 'zluda' }, CATALOG)).toBe(
      'Needs ZLUDA to run on AMD cards · unlock it on the Graph',
    )
    expect(describeCause({ kind: 'backend', modelId: 'wan22-5b', reason: 'mps', buy: null, zludaNodeId: null }, CATALOG)).toBe(
      'Apple silicon runs images only · video models need a discrete GPU',
    )
    expect(describeCause({ kind: 'backend', modelId: 'flux-dev', reason: 'mps', buy: null, zludaNodeId: null }, CATALOG)).toBe(
      'FLUX.1 Dev is not supported on Apple silicon · needs a discrete GPU',
    )
    expect(describeCause({ kind: 'backend', modelId: 'sdxl', reason: 'none', buy: null, zludaNodeId: null }, CATALOG)).toBe(
      'No owned hardware can run SDXL',
    )
  })

  it('API Nodes, the level gate, money and the cap', () => {
    expect(describeCause({ kind: 'apiNodes', nodeId: 'api-nodes' }, CATALOG)).toBe('Needs API Nodes · unlock it on the Graph')
    expect(describeCause({ kind: 'level', need: 9, have: 4 }, CATALOG)).toBe('Needs level 9 · you are level 4')
    expect(describeCause({ kind: 'credits', need: 1200, have: 340 }, CATALOG)).toBe('Need 1.20K credits · have 340')
    expect(describeCause({ kind: 'currency', currency: 'rp', need: 3, have: 1 }, CATALOG)).toBe('Need 3 RP · have 1')
    expect(describeCause({ kind: 'currency', currency: 'cp', need: 2, have: 0 }, CATALOG)).toBe('Need 2 CP · have 0')
    expect(describeCause({ kind: 'max', max: 1 }, CATALOG)).toBe('Maxed out · 1 owned')
    expect(describeCause({ kind: 'flag' }, CATALOG)).toBe('Secret')
  })

  it('conditions read exactly like their tooltip', () => {
    expect(describeCause({ kind: 'ownHardware', id: 'rtx-3060', count: 5, owned: 1 }, CATALOG)).toBe('Own 5× Used RTX 3060 12GB')
    expect(describeCause({ kind: 'ownFamily', family: 'cloud-node', count: 1, owned: 0 }, CATALOG)).toBe('Own any cloud node unit')
    expect(describeCause({ kind: 'mapNode', id: 'quant-fp8' }, CATALOG)).toBe('Unlock FP8 Quantization')
    expect(describeCause({ kind: 'parent', id: 'quant-fp8' }, CATALOG)).toBe('Unlock FP8 Quantization on the Graph')
    expect(describeCause({ kind: 'upgrade', id: 'rocm-setup' }, CATALOG)).toBe('Buy ROCm Setup')
    expect(describeCause({ kind: 'stat', key: 'clicks', need: 1000, have: 412 }, CATALOG)).toBe('Reach 1,000 clicks')
    expect(describeCause({ kind: 'cps', need: 1000, have: 212 }, CATALOG)).toBe('Reach 1,000 credits/s')
  })

  it('the store line for a locked family', () => {
    const amd = CATALOG.hardware.find((h) => h.family === 'amd-consumer') as HardwareDef
    expect(canBuy(amd, fresh(), base, CATALOG).reason).toBe('Locked · install the ROCm Setup upgrade to buy AMD cards')
  })
})

describe('explainBuy', () => {
  it('lists blockers in canBuy order and canBuy prints the first', () => {
    const amd = CATALOG.hardware.find((h) => h.family === 'amd-consumer') as HardwareDef
    const causes = explainBuy(amd, fresh(), base, CATALOG)
    expect(causes[0]?.kind).toBe('family')
    expect(causes.some((c) => c.kind === 'credits')).toBe(true)
    expect(canBuy(amd, fresh(), base, CATALOG).ok).toBe(false)
  })

  it('is empty when the purchase would go through', () => {
    const state = fresh((s) => {
      s.credits = 1e9
    })
    expect(explainBuy(hw('pc-8c16t'), state, base, CATALOG)).toEqual([])
    expect(canBuy(hw('pc-8c16t'), state, base, CATALOG)).toEqual({ ok: true })
  })

  it('reports the cap and the money for a capped unit', () => {
    const region = CATALOG.hardware.find((h) => h.max === 1) as HardwareDef
    const state = fresh((s) => {
      s.hardware[region.id] = 1
      s.credits = 0
    })
    const causes = explainBuy(region, state, derivedWith({ unlockedFamilies: [region.family] }), CATALOG)
    expect(causes.map((c) => c.kind)).toContain('max')
  })

  it('shows the credits a row is short of, to the credit', () => {
    const state = fresh((s) => {
      s.credits = 120
    })
    const causes = explainBuy(hw('rtx-3060'), state, base, CATALOG)
    const credits = causes.find((c) => c.kind === 'credits')
    expect(credits).toBeDefined()
    if (credits?.kind === 'credits') {
      expect(credits.have).toBe(120)
      expect(credits.need).toBe(hw('rtx-3060').baseCost)
    }
  })

  it('puts the level after the unlock condition and before the cap and the money', () => {
    const region = hw('region-us-east')
    const state = fresh((s) => {
      s.hardware[region.id] = 1
      s.credits = 0
    })
    const causes = explainBuy(region, state, derivedWith({ unlockedFamilies: [region.family] }), CATALOG)
    expect(causes.map((c) => c.kind)).toEqual(['mapNode', 'level', 'max', 'power', 'credits'])
    expect(causes[1]).toEqual({ kind: 'level', need: region.minLevel, have: 1 })
  })

  it('puts the breaker after the cap and before the money, and names the step that fixes it', () => {
    const state = fresh((s) => {
      s.credits = 0
    })
    const near = derivedWith({ powerDraw: 600, powerBudget: 650 })
    const causes = explainBuy(hw('pc-8c16t'), state, near, CATALOG)
    expect(causes.map((c) => c.kind)).toEqual(['power', 'credits'])
    expect(causes[0]).toEqual({ kind: 'power', short: 70, upgradeId: 'psu-850', nodeId: null })
    expect(describeCause(causes[0] as LockCause, CATALOG)).toBe('Trips the breaker · 70 W over budget · install 850 W PSU first')
    expect(canBuy(hw('pc-8c16t'), state, near, CATALOG).reason).toBe('Trips the breaker · 70 W over budget · install 850 W PSU first')
    // A unit that fits has no power cause at all.
    expect(explainBuy(hw('pc-8c16t'), state, base, CATALOG).map((c) => c.kind)).toEqual(['credits'])
    // The Graph is named when it is the step on offer; a spent ladder still says how far over.
    expect(describeCause({ kind: 'power', short: 200, upgradeId: null, nodeId: 'infra-undervolt' }, CATALOG)).toBe(
      'Trips the breaker · 200 W over budget · unlock Undervolt on the Graph first',
    )
    expect(describeCause({ kind: 'power', short: 1500, upgradeId: null, nodeId: null }, CATALOG)).toBe(
      'Trips the breaker · 1.5 kW over budget',
    )
  })

  it('the level cause reads exactly like a checkpoint gate, through canBuy too', () => {
    const state = fresh((s) => {
      s.hardware['pc-8c16t'] = 1
      s.credits = 0
    })
    const causes = explainBuy(hw('rtx-3060'), state, base, CATALOG)
    expect(causes.map((c) => c.kind)).toEqual(['level', 'credits'])
    expect(describeCause(causes[0] as LockCause, CATALOG)).toBe('Needs level 2 · you are level 1')
    expect(canBuy(hw('rtx-3060'), state, base, CATALOG).reason).toBe('Needs level 2 · you are level 1')
    state.stats.levelSeen = 2
    expect(explainBuy(hw('rtx-3060'), state, base, CATALOG).map((c) => c.kind)).toEqual(['credits'])
  })
})

describe('explainUnlock', () => {
  it('concatenates an `all` and takes the shortest branch of an `any`', () => {
    const state = fresh()
    const all = explainUnlock(
      { type: 'all', conds: [{ type: 'ownHardware', id: 'rtx-3060' }, { type: 'cps', value: 100 }] },
      state,
      base,
      CATALOG,
    )
    expect(all.map((c) => c.kind)).toEqual(['ownHardware', 'cps'])

    const any = explainUnlock(
      {
        type: 'any',
        conds: [
          { type: 'all', conds: [{ type: 'ownHardware', id: 'rtx-3060' }, { type: 'cps', value: 100 }] },
          { type: 'mapNode', id: 'quant-fp8' },
        ],
      },
      state,
      base,
      CATALOG,
    )
    expect(any.map((c) => c.kind)).toEqual(['mapNode'])
  })

  it('is empty for a met or absent condition', () => {
    expect(explainUnlock(undefined, fresh(), base, CATALOG)).toEqual([])
    expect(explainUnlock({ type: 'ownHardware', id: 'pc-4c8t' }, fresh(), base, CATALOG)).toEqual([])
  })

  it('carries the numbers a progress bar needs', () => {
    const state = fresh((s) => {
      s.totalClicks = 412
    })
    const causes = explainUnlock({ type: 'stat', key: 'clicks', value: 1000 }, state, base, CATALOG)
    expect(causes[0]).toEqual({ kind: 'stat', key: 'clicks', need: 1000, have: 412 })
  })
})

describe('explainQuantize and canQuantize agree', () => {
  it('asks for the Graph node before the fee', () => {
    const state = fresh((s) => {
      s.models['sdxl'] = { precisions: ['native'], setup: true }
      s.credits = 1e9
    })
    const cause = explainQuantize(model('sdxl'), 'fp8', state, CATALOG)
    expect(cause?.kind).toBe('precision')
    expect(canQuantize(model('sdxl'), 'fp8', state, CATALOG).reason).toBe('Unlock FP8 Quantization on the Graph')
  })

  it('then asks for the fee, in the store words', () => {
    const state = fresh((s) => {
      s.models['sdxl'] = { precisions: ['native'], setup: true }
      s.mapNodes.push('quant-fp8')
      s.credits = 0
    })
    const cause = explainQuantize(model('sdxl'), 'fp8', state, CATALOG)
    expect(cause?.kind).toBe('credits')
    expect(canQuantize(model('sdxl'), 'fp8', state, CATALOG).reason).toMatch(/^Need .* credits · have 0$/)
  })

  it('asks for the install first', () => {
    const state = fresh()
    expect(explainQuantize(model('sdxl'), 'fp8', state, CATALOG)?.kind).toBe('setup')
    expect(canQuantize(model('sdxl'), 'fp8', state, CATALOG).reason).toBe('Set up SDXL first')
  })
})

describe('explainSetup', () => {
  it('names the level before the money', () => {
    const state = fresh((s) => {
      s.credits = 1e9
    })
    expect(explainSetup(model('flux-dev'), state, base, CATALOG)).toEqual({ kind: 'level', need: 4, have: 1 })
  })

  it('names the fee when the level is fine', () => {
    const state = fresh((s) => {
      s.stats.levelSeen = MAX_LEVEL
      s.credits = 0
    })
    const cause = explainSetup(model('sdxl'), state, base, CATALOG)
    expect(cause?.kind).toBe('credits')
  })

  it('is null once nothing is in the way', () => {
    const state = fresh((s) => {
      s.stats.levelSeen = MAX_LEVEL
      s.credits = 1e9
    })
    expect(explainSetup(model('sdxl'), state, derivedWith({ bestVram: 48 }), CATALOG)).toBeNull()
  })
})

describe('explainMapNode', () => {
  it('walks the noodles back before quoting a price', () => {
    const causes = explainMapNode(node('quant-q4'), fresh(), base, CATALOG)
    expect(causes[0]).toEqual({ kind: 'parent', id: 'quant-fp8' })
    expect(causes.some((c) => c.kind === 'credits')).toBe(true)
  })

  it('prices RP and CP nodes in their own currency', () => {
    const rpNode = CATALOG.mapNodes.find((n) => n.currency === 'rp') as MapNodeDef
    const causes = explainMapNode(rpNode, fresh(), base, CATALOG)
    const money = causes.find((c) => c.kind === 'currency')
    expect(money?.kind === 'currency' && money.currency).toBe('rp')
  })

  it('is empty for an owned node', () => {
    const state = fresh((s) => {
      s.mapNodes.push('quant-fp8')
    })
    expect(explainMapNode(node('quant-fp8'), state, base, CATALOG)).toEqual([])
  })
})

describe('causeEta', () => {
  it('counts the seconds to a price at the current rate', () => {
    expect(causeEta({ kind: 'credits', need: 1000, have: 400 }, derivedWith({ cps: 10 }))).toBe(60)
    expect(causeEta({ kind: 'credits', need: 1000, have: 400 }, derivedWith({ cps: 0 }))).toBe(Infinity)
    expect(causeEta({ kind: 'credits', need: 100, have: 400 }, derivedWith({ cps: 10 }))).toBe(0)
  })

  it('is Infinity for anything money cannot solve', () => {
    expect(causeEta({ kind: 'level', need: 4, have: 2 }, derivedWith({ cps: 1e9 }))).toBe(Infinity)
    expect(causeEta({ kind: 'flag' }, derivedWith({ cps: 1e9 }))).toBe(Infinity)
  })
})
