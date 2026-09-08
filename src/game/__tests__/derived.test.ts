import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import type { Catalog } from '@/data'
import {
  ACHIEVEMENT_MULT,
  CP_MULT_PER_POINT,
  FLOP_CHANCE_BASE,
  FOLLOW_RATE_BASE,
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POWER_BUDGET_BASE,
  RP_MULT_PER_POINT,
  VIRAL_CHANCE_BASE,
} from '@/game/constants'
import { activeEffects, computeDerived, createEmptyDerived, FLOP_CHANCE_MIN, LORA_TAG_LIKES, tierUpgradeId } from '@/game/derived'
import { createInitialState } from '@/game/state'
import type { Effect, GameState, MapNodeDef } from '@/game/types'

// events.ts owns event semantics; derived.ts only folds whatever it returns.
const { eventEffectsMock } = vi.hoisted(() => ({
  eventEffectsMock: vi.fn<(state: GameState, catalog: Catalog) => Effect[]>(() => []),
}))
vi.mock('@/game/events', () => ({ eventEffects: eventEffectsMock }))

const hw = (id: string) => {
  const def = CATALOG.hardware.find((h) => h.id === id)
  if (!def) throw new Error(`missing hardware ${id}`)
  return def
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = createInitialState(0, 'guest')
  mutate?.(s)
  return s
}

const node = (id: string, effects: Effect[]): MapNodeDef => ({
  id,
  title: id,
  desc: '',
  branch: 'core',
  cost: 0,
  currency: 'credits',
  parents: [],
  effects,
  position: { x: 0, y: 0 },
  icon: 'zap',
})

beforeEach(() => {
  eventEffectsMock.mockReset()
  eventEffectsMock.mockReturnValue([])
})

describe('computeDerived on a fresh save', () => {
  const d = computeDerived(fresh(), CATALOG)

  it('earns from the starter PC alone', () => {
    expect(d.cps).toBeGreaterThan(0)
    expect(d.rawCps).toBeCloseTo(hw('pc-4c8t').baseCps, 9)
    expect(d.cps).toBeCloseTo(d.rawCps, 9)
  })

  it('has clickValue 1, no GPU, and the PC as its best unit', () => {
    expect(d.clickValue).toBe(1)
    expect(d.hasGpu).toBe(false)
    expect(d.bestHardwareId).toBe('pc-4c8t')
    expect(d.bestVram).toBe(hw('pc-4c8t').vram)
    expect(d.bestTier).toBe(hw('pc-4c8t').speedTier)
  })

  it('uses the base constants for every multiplier', () => {
    expect(d.globalMult).toBe(1)
    expect(d.cpMult).toBe(1)
    expect(d.concurrency).toBe(1)
    expect(d.speedMult).toBe(1)
    expect(d.likesMult).toBe(1)
    expect(d.payoutBonus).toBe(0)
    expect(d.followRate).toBe(FOLLOW_RATE_BASE)
    expect(d.viralChance).toBe(VIRAL_CHANCE_BASE)
    expect(d.flopChance).toBe(FLOP_CHANCE_BASE)
    expect(d.offlineCapHours).toBe(OFFLINE_CAP_HOURS_BASE)
    expect(d.weekSpeed).toBe(1)
    expect(d.familyMult).toEqual({})
    expect(d.rigMult).toEqual({})
    expect(d.tagLikes).toEqual({})
  })

  it('draws the PC wattage against the base budget without throttling', () => {
    expect(d.powerDraw).toBe(hw('pc-4c8t').watts)
    expect(d.powerBudget).toBe(POWER_BUDGET_BASE)
    expect(d.throttled).toBe(false)
  })

  it('locks the AMD family and every flag', () => {
    expect(d.unlockedFamilies).not.toContain('amd-consumer')
    for (const f of ['cpu', 'apple', 'nvidia-consumer', 'workstation', 'datacenter', 'cloud-node', 'region']) {
      expect(d.unlockedFamilies).toContain(f)
    }
    expect(d.zluda).toBe(false)
    expect(d.apiNodes).toBe(false)
    expect(d.hashtagResearch).toBe(false)
    expect(d.streakGrace).toBe(false)
    expect(d.reservedCapacity).toBe(false)
  })

  it('createEmptyDerived matches the no-hardware baseline', () => {
    const empty = createEmptyDerived()
    expect(empty.cps).toBe(0)
    expect(empty.bestHardwareId).toBeNull()
    expect(empty.powerBudget).toBe(POWER_BUDGET_BASE)
    expect(empty.unlockedFamilies).not.toContain('amd-consumer')
  })
})

describe('rawCps and hardware summary', () => {
  it('sums count × baseCps across owned units', () => {
    const d = computeDerived(fresh((s) => { s.hardware['rtx-3060'] = 3 }), CATALOG)
    expect(d.rawCps).toBeCloseTo(hw('pc-4c8t').baseCps + 3 * hw('rtx-3060').baseCps, 9)
    expect(d.hasGpu).toBe(true)
    expect(d.bestHardwareId).toBe('rtx-3060')
  })

  it('picks the fastest tier as best unit but the largest VRAM as bestVram', () => {
    const d = computeDerived(
      fresh((s) => { s.hardware['mac-studio-m4-max'] = 1; s.hardware['rtx-4090'] = 1 }),
      CATALOG,
    )
    expect(d.bestHardwareId).toBe('rtx-4090')
    expect(d.bestTier).toBe(hw('rtx-4090').speedTier)
    expect(d.bestVram).toBe(hw('mac-studio-m4-max').vram)
  })

  it('counts the ROCm and MPS gen-time taxes when naming the best unit', () => {
    // Same speed tier: the CUDA card renders faster than the Radeon (×1.25) and wins.
    const mixed = computeDerived(fresh((s) => { s.hardware['rtx-3060'] = 1; s.hardware['rx-7600-xt'] = 1 }), CATALOG)
    expect(mixed.bestHardwareId).toBe('rtx-3060')
    // A tier-2 Mac mini behind the MPS ×2 tax is slower than the tier-1 CPU box.
    const mac = computeDerived(fresh((s) => { s.hardware['pc-8c16t'] = 1; s.hardware['mac-mini-m4'] = 1 }), CATALOG)
    expect(mac.bestHardwareId).toBe('pc-8c16t')
    expect(mac.bestTier).toBe(hw('mac-mini-m4').speedTier)
  })

  it('treats Apple silicon as not-a-GPU and regions as infinite VRAM', () => {
    expect(computeDerived(fresh((s) => { s.hardware['mac-mini-m4'] = 1 }), CATALOG).hasGpu).toBe(false)
    const d = computeDerived(fresh((s) => { s.hardware['region-us-east'] = 1 }), CATALOG)
    expect(d.bestVram).toBe(Infinity)
    expect(d.bestTier).toBe(12)
  })

  it('ignores unknown or zero-count hardware ids', () => {
    const d = computeDerived(fresh((s) => { s.hardware['gtx-970'] = 5; s.hardware['rtx-4090'] = 0 }), CATALOG)
    expect(d.rawCps).toBeCloseTo(hw('pc-4c8t').baseCps, 9)
    expect(d.bestHardwareId).toBe('pc-4c8t')
  })
})

describe('power throttle', () => {
  const overBudget = (s: GameState) => { s.hardware['rtx-4090'] = 1; s.hardware['rtx-3060'] = 1 }

  it('scales cps by budget / draw when draw exceeds the base budget', () => {
    const d = computeDerived(fresh(overBudget), CATALOG)
    expect(d.powerDraw).toBe(hw('pc-4c8t').watts + hw('rtx-4090').watts + hw('rtx-3060').watts)
    expect(d.powerDraw).toBeGreaterThan(d.powerBudget)
    expect(d.throttled).toBe(true)
    expect(d.cps).toBeCloseTo((d.rawCps * d.globalMult * d.powerBudget) / d.powerDraw, 9)
  })

  it('is proportional: past the breaker a unit only pays if its cps per watt beats the rack average', () => {
    // Ten 3060s (1.7 kW on a 650 W circuit) run at 650/1765 of their output…
    const ten = computeDerived(fresh((s) => { s.hardware['rtx-3060'] = 10 }), CATALOG)
    expect(ten.cps).toBeCloseTo((ten.rawCps * POWER_BUDGET_BASE) / ten.powerDraw, 9)
    // …so an eleventh 3060 (the rack's own cps/W, give or take the office PC) adds next to nothing…
    const eleven = computeDerived(fresh((s) => { s.hardware['rtx-3060'] = 11 }), CATALOG)
    expect(eleven.cps / ten.cps).toBeGreaterThan(0.99)
    expect(eleven.cps / ten.cps).toBeLessThan(1.01)
    // …while a 72 W L4 (far better cps/W) still raises income on the same tripped breaker…
    const withL4 = computeDerived(fresh((s) => { s.hardware['rtx-3060'] = 10; s.hardware.l4 = 1 }), CATALOG)
    expect(withL4.cps).toBeGreaterThan(ten.cps * 1.05)
    // …and a 3060 added to a tripped rack of L4s lowers income: it drags the average down.
    const l4s = computeDerived(fresh((s) => { s.hardware.l4 = 10 }), CATALOG)
    expect(l4s.throttled).toBe(true)
    const l4sPlus = computeDerived(fresh((s) => { s.hardware.l4 = 10; s.hardware['rtx-3060'] = 1 }), CATALOG)
    expect(l4sPlus.cps).toBeLessThan(l4s.cps)
  })

  it('lifts the throttle once the 850 W PSU raises the budget', () => {
    const d = computeDerived(fresh((s) => { overBudget(s); s.upgrades.push('psu-850') }), CATALOG)
    expect(d.powerBudget).toBe(POWER_BUDGET_BASE + 300)
    expect(d.throttled).toBe(false)
    expect(d.cps).toBeCloseTo(d.rawCps * d.globalMult, 9)
  })

  it('counts map-node and event budget too', () => {
    const state = fresh((s) => { overBudget(s); s.mapNodes.push('infra-undervolt') })
    expect(computeDerived(state, CATALOG).powerBudget).toBe(POWER_BUDGET_BASE + 200)
    eventEffectsMock.mockReturnValue([{ kind: 'powerBudget', value: 1e6 }])
    expect(computeDerived(state, CATALOG).throttled).toBe(false)
  })
})

describe('tier upgrades and multipliers', () => {
  it('doubles a rig per reached tier via the generated tier upgrades', () => {
    const state = fresh((s) => { s.hardware['rtx-3060'] = 10; s.hardwareTiers['rtx-3060'] = 2 })
    const d = computeDerived(state, CATALOG)
    expect(CATALOG.upgrades.some((u) => u.id === tierUpgradeId('rtx-3060', 2))).toBe(true)
    expect(d.rigMult['rtx-3060']).toBe(4)
    expect(d.rawCps).toBeCloseTo(hw('pc-4c8t').baseCps + 10 * hw('rtx-3060').baseCps * 4, 9)
  })

  it('falls back to the contract effect when a fixture catalog has no tier upgrades', () => {
    const catalog = createCatalog({ hardware: [hw('pc-4c8t'), hw('rtx-3060')] })
    const state = fresh((s) => { s.hardware['rtx-3060'] = 1; s.hardwareTiers['rtx-3060'] = 3 })
    expect(computeDerived(state, catalog).rigMult['rtx-3060']).toBe(8)
  })

  it('multiplies rp, cp and achievements into globalMult', () => {
    const state = fresh((s) => { s.rp = 10; s.cp = 5; s.achievements.push('a', 'b', 'c') })
    const d = computeDerived(state, CATALOG)
    expect(d.cpMult).toBeCloseTo(1 + CP_MULT_PER_POINT * 5, 12)
    expect(d.globalMult).toBeCloseTo(
      (1 + RP_MULT_PER_POINT * 10) * (1 + ACHIEVEMENT_MULT * 3) * (1 + CP_MULT_PER_POINT * 5),
      12,
    )
    expect(d.cps).toBeCloseTo(d.rawCps * d.globalMult, 9)
  })

  it('applies cpMult effects to the per-point rate', () => {
    const catalog = createCatalog({ hardware: [hw('pc-4c8t')], mapNodes: [node('boost', [{ kind: 'cpMult', value: 1.5 }])] })
    const state = fresh((s) => { s.cp = 5; s.mapNodes.push('boost') })
    expect(computeDerived(state, catalog).cpMult).toBeCloseTo(1 + CP_MULT_PER_POINT * 5 * 1.5, 12)
  })

  it('folds globalMult additively per source, multiplicatively across sources', () => {
    const state = fresh((s) => { s.upgrades.push('comfyui-manager'); s.mapNodes.push('core-manager') })
    expect(computeDerived(state, CATALOG).globalMult).toBeCloseTo(1.1 * 1.05, 12)
  })

  it('applies familyMult from the hardware lane to that family only', () => {
    const state = fresh((s) => { s.hardware['rtx-3060'] = 2; s.mapNodes.push('hardware-nvidia-1') })
    const d = computeDerived(state, CATALOG)
    expect(d.familyMult['nvidia-consumer']).toBeCloseTo(1.1, 12)
    expect(d.rawCps).toBeCloseTo(hw('pc-4c8t').baseCps + 2 * hw('rtx-3060').baseCps * 1.1, 9)
  })
})

describe('click value', () => {
  it('is (1 + flat) × mult × globalMult + pct × cps', () => {
    const state = fresh((s) => {
      s.hardware['rtx-4090'] = 1
      s.upgrades.push('better-prompts', 'batch-size-2', 'comfy-desktop', 'comfyui-manager')
    })
    const d = computeDerived(state, CATALOG)
    expect(d.clickValue).toBeCloseTo((1 + 1) * 2 * d.globalMult + 0.01 * d.cps, 9)
    expect(d.offlineCapHours).toBe(OFFLINE_CAP_HOURS_BASE + 4)
  })
})

describe('offline rate', () => {
  it('pays OFFLINE_EFFICIENCY until Comfy Cloud: Always On raises it to the full rate', () => {
    expect(computeDerived(fresh(), CATALOG).offlineEfficiency).toBe(OFFLINE_EFFICIENCY)
    const d = computeDerived(fresh((s) => { s.upgrades.push('comfy-cloud-always-on') }), CATALOG)
    expect(d.offlineEfficiency).toBe(1)
    expect(d.offlineCapHours).toBe(OFFLINE_CAP_HOURS_BASE + 8)
  })

  it('never lets an effect lower the rate below the base', () => {
    const catalog = createCatalog({ hardware: [hw('pc-4c8t')], mapNodes: [node('slow', [{ kind: 'offlineEfficiency', value: 0.1 }])] })
    expect(computeDerived(fresh((s) => { s.mapNodes.push('slow') }), catalog).offlineEfficiency).toBe(OFFLINE_EFFICIENCY)
  })
})

describe('flags, families and per-family tables', () => {
  it('reads boolean flags from upgrades and map nodes', () => {
    const state = fresh((s) => {
      s.upgrades.push('rocm-setup', 'hashtag-research')
      s.mapNodes.push('zluda', 'api-nodes', 'streak-grace', 'reserved-capacity')
    })
    const d = computeDerived(state, CATALOG)
    expect(d.unlockedFamilies).toContain('amd-consumer')
    expect(d.zluda).toBe(true)
    expect(d.apiNodes).toBe(true)
    expect(d.hashtagResearch).toBe(true)
    expect(d.streakGrace).toBe(true)
    expect(d.reservedCapacity).toBe(true)
  })

  it('sums cooling tiers per family and multiplies familyGenTime', () => {
    const state = fresh((s) => { s.upgrades.push('aio-cooler'); s.mapNodes.push('cooling-aio', 'distill-flux') })
    const d = computeDerived(state, CATALOG)
    expect(d.coolingTier['nvidia-consumer']).toBe(2)
    expect(d.coolingTier.datacenter).toBeUndefined()
    expect(d.familyGenTime.flux).toBeCloseTo(0.7, 12)
  })

  it('adds studio and social effects with their conventions', () => {
    const state = fresh((s) => {
      s.upgrades.push('multi-gpu-queue', 'teacache', 'creator-fund', 'referral-link', 'cross-posting', 'trending-audio', 'negative-prompt')
      s.mapNodes.push('core-auto-queue')
    })
    const d = computeDerived(state, CATALOG)
    expect(d.concurrency).toBe(3)
    expect(d.speedMult).toBeCloseTo(0.75, 12)
    expect(d.payoutBonus).toBeCloseTo(0.1, 12)
    expect(d.followRate).toBeCloseTo(FOLLOW_RATE_BASE * 1.5, 12)
    expect(d.likesMult).toBeCloseTo(1.25, 12)
    expect(d.viralChance).toBeCloseTo(VIRAL_CHANCE_BASE + 0.02, 12)
    expect(d.flopChance).toBeCloseTo(FLOP_CHANCE_BASE - 0.05, 12)
  })

  it('floors flop chance and lets offline cap go infinite', () => {
    const catalog = createCatalog({
      hardware: [hw('pc-4c8t')],
      mapNodes: [node('n', [{ kind: 'flopChance', value: 0.5 }, { kind: 'offlineCapHours', value: Infinity }, { kind: 'weekSpeed', value: 2 }])],
    })
    const d = computeDerived(fresh((s) => { s.mapNodes.push('n') }), catalog)
    expect(d.flopChance).toBe(FLOP_CHANCE_MIN)
    expect(d.offlineCapHours).toBe(Infinity)
    expect(d.weekSpeed).toBe(2)
  })

  it('grants trained LoRAs a tag bonus and ignores the wildcard marker', () => {
    const state = fresh((s) => { s.loras.push('wan22'); s.mapNodes.push('lora-training') })
    const d = computeDerived(state, CATALOG)
    expect(d.tagLikes.wan22).toBeCloseTo(LORA_TAG_LIKES, 12)
    expect(d.tagLikes['*']).toBeUndefined()
  })
})

describe('active events', () => {
  it('folds event effects like any other source', () => {
    const state = fresh((s) => { s.hardware['rtx-4090'] = 1 })
    eventEffectsMock.mockReturnValue([{ kind: 'globalMult', value: 1 }])
    const doubled = computeDerived(state, CATALOG)
    expect(eventEffectsMock).toHaveBeenCalledWith(state, CATALOG)
    expect(doubled.globalMult).toBe(2)

    eventEffectsMock.mockReturnValue([{ kind: 'rigMult', hardwareId: 'rtx-4090', value: 0 }])
    const reclaimed = computeDerived(state, CATALOG)
    expect(reclaimed.rawCps).toBeCloseTo(hw('pc-4c8t').baseCps, 9)
  })
})

describe('activeEffects', () => {
  it('collects upgrade, tier, map-node and event effects in that order', () => {
    eventEffectsMock.mockReturnValue([{ kind: 'zluda' }])
    const state = fresh((s) => {
      s.upgrades.push('better-prompts', 'not-a-real-upgrade')
      s.hardwareTiers['rtx-3060'] = 1
      s.mapNodes.push('core-manager', 'not-a-real-node')
    })
    const effects = activeEffects(state, CATALOG)
    expect(effects).toEqual([
      { kind: 'clickFlat', value: 1 },
      { kind: 'rigMult', hardwareId: 'rtx-3060', value: 2 },
      { kind: 'globalMult', value: 0.05 },
      { kind: 'zluda' },
    ])
  })
})
