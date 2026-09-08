import { describe, expect, it } from 'vitest'
import {
  AMD_PAYBACK_MULT,
  DYSON_UNLOCK_NODE,
  FAMILY_GROWTH,
  HARDWARE,
  HARDWARE_FAMILIES,
  MPS_PAYBACK_MULT,
  ORBITAL_UNLOCK_NODE,
  PAYBACK_KNEE_RANK,
  PAYBACK_MAX_S,
  PAYBACK_MIN_S,
  PAYBACK_OVERRIDE_S,
  PAYBACK_PEAK_RANK,
  REGIONS_UNLOCK_NODE,
  TAIL_PAYBACK_S,
  paybackForRank,
  tailPayback,
  vendorPaybackMult,
} from '@/data/hardware'
import { FAMILY_LABELS } from '@/game/state'
import type { HardwareDef, HardwareFamily, UnlockCond } from '@/game/types'

const byId = new Map(HARDWARE.map((h) => [h.id, h]))
const rankOf = new Map(HARDWARE.map((h, i) => [h.id, i]))
const get = (id: string): HardwareDef => {
  const h = byId.get(id)
  if (!h) throw new Error(`missing hardware ${id}`)
  return h
}

/** Tail units grouped by family (trophy overrides excluded), in rank order. */
const TAIL_GROUPS = new Map<HardwareFamily, string[]>()
HARDWARE.forEach((h, rank) => {
  if (rank <= PAYBACK_PEAK_RANK || h.id in PAYBACK_OVERRIDE_S) return
  TAIL_GROUPS.set(h.family, [...(TAIL_GROUPS.get(h.family) ?? []), h.id])
})

/** Design payback for a unit before vendor multipliers, recomputed from the published rules. */
const baseDesign = (h: HardwareDef): number => {
  const override = PAYBACK_OVERRIDE_S[h.id]
  if (override !== undefined) return override
  const rank = rankOf.get(h.id)!
  if (rank <= PAYBACK_PEAK_RANK) return paybackForRank(rank)
  const group = TAIL_GROUPS.get(h.family)!
  return tailPayback(h.family, group.indexOf(h.id), group.length)
}

/** Design payback for a unit, including vendor multipliers. */
const designPayback = (h: HardwareDef): number => baseDesign(h) * vendorPaybackMult(h)

const actualPayback = (h: HardwareDef): number => h.baseCost / h.baseCps

/** The ladder minus Apple and the ROCm-gated consumer Radeons: what the store's "climb" compares. */
const MAIN_LADDER = HARDWARE.filter((h) => h.family !== 'apple' && h.family !== 'amd-consumer')

const EXPECTED_ORDER = [
  'pc-4c8t', 'pc-8c16t', 'mac-mini-m4', 'rx-7600-xt', 'rtx-3060', 'rx-9070-xt',
  'rtx-4070-ti-super', 'rtx-3090', 'rx-7900-xtx', 'rtx-4090', 'rtx-5080', 'mac-studio-m4-max',
  'rtx-5090', 'radeon-pro-w7900', 'rtx-a6000', 'l4', 'rtx-6000-ada', 'a40', 'l40s',
  'rtx-pro-6000', 'a100-80', 'mi300x', 'h100-80', 'mi325x', 'h200', 'b200', 'b300',
  'aws-p4d', 'azure-nd-mi300x', 'aws-p5', 'aws-p5e', 'aws-p6', 'runpod-8xb300',
  'region-us-east', 'region-eu-west', 'region-ap-southeast', 'orbital-dc', 'dyson-swarm',
]

const MAIN_CHAIN = [
  'pc-4c8t', 'pc-8c16t', 'rtx-3060', 'rtx-4070-ti-super', 'rtx-3090', 'rtx-4090', 'rtx-5090',
  'rtx-a6000', 'rtx-6000-ada', 'rtx-pro-6000', 'a100-80', 'h100-80', 'h200', 'b200', 'b300',
  'aws-p5', 'aws-p6', 'runpod-8xb300', 'region-us-east',
]

const SPEED_TIERS: Record<string, number> = {
  'pc-4c8t': 1, 'pc-8c16t': 1,
  'mac-mini-m4': 2, 'mac-studio-m4-max': 2,
  'rtx-3060': 3, 'rx-7600-xt': 3,
  'rtx-4070-ti-super': 4, 'rx-9070-xt': 4, 'rtx-3090': 4,
  'rtx-4090': 5, 'rx-7900-xtx': 5, 'rtx-5080': 5,
  'rtx-5090': 6, 'rtx-a6000': 6, 'radeon-pro-w7900': 6, 'rtx-6000-ada': 6, l4: 6,
  a40: 7, l40s: 7, 'rtx-pro-6000': 7,
  'a100-80': 8, mi300x: 8,
  'h100-80': 9, h200: 9, mi325x: 9,
  b200: 10, b300: 10,
  // cloud nodes: card tier + 1
  'aws-p4d': 9, 'azure-nd-mi300x': 9, 'aws-p5': 10, 'aws-p5e': 10, 'aws-p6': 11, 'runpod-8xb300': 11,
  'region-us-east': 12, 'region-eu-west': 12, 'region-ap-southeast': 12, 'orbital-dc': 12, 'dyson-swarm': 12,
}

const MAP_NODE_IDS = new Set([REGIONS_UNLOCK_NODE, ORBITAL_UNLOCK_NODE, DYSON_UNLOCK_NODE])

function collectRefs(cond: UnlockCond | undefined, out: { hardware: string[]; nodes: string[]; other: string[] }) {
  if (!cond) return
  switch (cond.type) {
    case 'always':
      return
    case 'ownHardware':
      out.hardware.push(cond.id)
      return
    case 'mapNode':
      out.nodes.push(cond.id)
      return
    case 'any':
    case 'all':
      for (const c of cond.conds) collectRefs(c, out)
      return
    default:
      out.other.push(cond.type)
  }
}

describe('hardware ladder — shape', () => {
  it('has unique kebab-case ids in the specified order', () => {
    const ids = HARDWARE.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(ids).toEqual(EXPECTED_ORDER)
  })

  it('is sorted by strictly increasing baseCost', () => {
    for (let i = 1; i < HARDWARE.length; i++) {
      expect(HARDWARE[i].baseCost).toBeGreaterThan(HARDWARE[i - 1].baseCost)
    }
  })

  it('starts the player on the office PC, always available', () => {
    expect(HARDWARE[0].id).toBe('pc-4c8t')
    expect(HARDWARE[0].unlock).toEqual({ type: 'always' })
    expect(HARDWARE[0].cpuOnly).toBe(true)
  })

  it('gives every unit a short label, flavor text and an hw-<id> art id', () => {
    for (const h of HARDWARE) {
      expect(h.short.length).toBeGreaterThan(0)
      expect(h.short.length).toBeLessThanOrEqual(14)
      expect(h.flavor.length).toBeGreaterThan(10)
      expect(h.art).toBe(`hw-${h.id}`)
      expect(h.name.length).toBeGreaterThan(0)
    }
  })
})

describe('hardware ladder — payback design', () => {
  it('paybackForRank: 125 − 4.5·rank to the knee, then a geometric stretch toward 40 s up to the peak', () => {
    expect(paybackForRank(0)).toBe(125)
    expect(paybackForRank(1)).toBe(120.5)
    expect(paybackForRank(10)).toBe(80)
    expect(PAYBACK_KNEE_RANK).toBe(14)
    expect(paybackForRank(PAYBACK_KNEE_RANK)).toBe(62)
    expect(paybackForRank(15)).toBeCloseTo(40 + 22 * 0.9, 9)
    expect(paybackForRank(PAYBACK_PEAK_RANK)).toBeCloseTo(40 + 22 * 0.9 ** 5, 9)
    expect(paybackForRank(-5)).toBe(PAYBACK_MAX_S)
    // Strictly decreasing through the climb, never touching the asymptote.
    let prev = Infinity
    for (let rank = 0; rank <= PAYBACK_PEAK_RANK; rank++) {
      const p = paybackForRank(rank)
      expect(p, `rank ${rank}`).toBeLessThan(prev)
      expect(p, `rank ${rank}`).toBeGreaterThan(PAYBACK_MIN_S)
      prev = p
    }
    expect(HARDWARE[PAYBACK_PEAK_RANK]!.id).toBe('rtx-pro-6000')
  })

  it('tailPayback interpolates each family band geometrically from first to last unit', () => {
    expect(tailPayback('datacenter', 0, 7)).toBe(TAIL_PAYBACK_S.datacenter![0])
    expect(tailPayback('datacenter', 6, 7)).toBeCloseTo(TAIL_PAYBACK_S.datacenter![1], 9)
    const [lo, hi] = TAIL_PAYBACK_S['cloud-node']!
    expect(tailPayback('cloud-node', 1, 3)).toBeCloseTo(Math.sqrt(lo * hi), 9)
    expect(tailPayback('region', 0, 1)).toBe(TAIL_PAYBACK_S.region![0])
    expect(() => tailPayback('cpu', 0, 1)).toThrow(/tail payback/)
    expect(Object.keys(TAIL_GROUPS.get('datacenter')!)).toHaveLength(7)
    expect(TAIL_GROUPS.get('cloud-node')).toHaveLength(6)
    expect(TAIL_GROUPS.get('region')).toEqual(['region-us-east', 'region-eu-west', 'region-ap-southeast'])
  })

  it('baseCps = round3(baseCost / payback) with consumer AMD ×0.92 and Apple ×1.3', () => {
    expect(AMD_PAYBACK_MULT).toBeLessThanOrEqual(0.95)
    for (const h of HARDWARE) {
      const expected = Math.round((h.baseCost / designPayback(h)) * 1000) / 1000
      expect(h.baseCps, h.id).toBe(expected)
      expect(h.baseCps).toBeGreaterThan(0)
      // The published numbers track the design within rounding noise.
      expect(Math.abs(actualPayback(h) - designPayback(h)) / designPayback(h), h.id).toBeLessThan(0.005)
    }
    expect(vendorPaybackMult(get('rx-7600-xt'))).toBe(AMD_PAYBACK_MULT)
    expect(vendorPaybackMult(get('mac-mini-m4'))).toBe(MPS_PAYBACK_MULT)
    expect(vendorPaybackMult(get('mi300x'))).toBe(1)
    expect(vendorPaybackMult(get('azure-nd-mi300x'))).toBe(1)
  })

  it('payback improves rung by rung up to the RTX PRO 6000, then worsens rung by rung to the Dyson swarm', () => {
    const peak = MAIN_LADDER.findIndex((h) => h.id === 'rtx-pro-6000')
    expect(peak).toBeGreaterThan(0)
    for (let i = 1; i < MAIN_LADDER.length; i++) {
      const prev = designPayback(MAIN_LADDER[i - 1]!)
      const cur = designPayback(MAIN_LADDER[i]!)
      const label = `${MAIN_LADDER[i - 1]!.id} → ${MAIN_LADDER[i]!.id}`
      if (i <= peak) {
        expect(cur, label).toBeLessThan(prev)
        // Each climbing rung is a visible improvement, not float dust.
        expect(prev - cur, label).toBeGreaterThan(0.25)
      } else {
        // Every tail rung is a bigger, less efficient purchase — by a clear margin.
        expect(cur / prev, label).toBeGreaterThan(1.1)
      }
    }
    expect(MAIN_CHAIN.map((id) => rankOf.get(id)!)).toEqual([...MAIN_CHAIN.map((id) => rankOf.get(id)!)].sort((a, b) => a - b))
    expect(rankOf.get('rtx-a6000')).toBe(PAYBACK_KNEE_RANK)
    expect(designPayback(get('rtx-a6000'))).toBe(62)
    expect(designPayback(get('l4'))).toBeLessThan(62)
    expect(designPayback(get('rtx-pro-6000'))).toBeCloseTo(paybackForRank(PAYBACK_PEAK_RANK), 9)
  })

  it('the tail lands on its design bands: minutes for datacenter, hours for cloud, days for the trophies', () => {
    expect(designPayback(get('a100-80'))).toBe(60)
    expect(designPayback(get('b300'))).toBeCloseTo(4 * 60, 6)
    expect(designPayback(get('aws-p4d'))).toBe(5 * 60)
    expect(designPayback(get('runpod-8xb300'))).toBeCloseTo(4 * 3600, 6)
    expect(designPayback(get('region-us-east'))).toBe(12 * 3600)
    expect(designPayback(get('region-ap-southeast'))).toBeCloseTo(48 * 3600, 6)
    expect(designPayback(get('orbital-dc'))).toBe(120 * 3600)
    expect(designPayback(get('dyson-swarm'))).toBe(240 * 3600)
  })

  it('consumer AMD is a little cheaper per cps than its NVIDIA neighbour; MI-series gets no discount; Apple is dearer', () => {
    expect(actualPayback(get('rx-7600-xt'))).toBeLessThan(actualPayback(get('rtx-3060')))
    expect(actualPayback(get('rx-9070-xt'))).toBeLessThan(actualPayback(get('rtx-4070-ti-super')))
    expect(actualPayback(get('rx-7900-xtx'))).toBeLessThan(actualPayback(get('rtx-4090')))
    expect(actualPayback(get('radeon-pro-w7900'))).toBeLessThan(actualPayback(get('rtx-a6000')))
    // The discount is a trade against the ROCm gen-time tax, not a free lunch: ≤ 8 %.
    expect(AMD_PAYBACK_MULT).toBeGreaterThanOrEqual(0.9)
    expect(actualPayback(get('rx-7600-xt')) / paybackForRank(rankOf.get('rx-7600-xt')!)).toBeCloseTo(AMD_PAYBACK_MULT, 2)
    // MI300X / MI325X sit on the rising tail like everyone else: dearer than the rung below them.
    expect(actualPayback(get('mi300x'))).toBeGreaterThan(actualPayback(get('a100-80')))
    expect(actualPayback(get('mi325x'))).toBeGreaterThan(actualPayback(get('h100-80')))
    expect(actualPayback(get('mac-mini-m4'))).toBeGreaterThan(actualPayback(get('rtx-3060')))
  })

  it('caps the regions and the space hardware at one unit each; everything else is unlimited', () => {
    for (const h of HARDWARE) {
      if (h.family === 'region') expect(h.max, h.id).toBe(1)
      else expect(h.max, h.id).toBeUndefined()
    }
  })

  it("is not Cookie Clicker's table", () => {
    const cookie: [number, number][] = [
      [15, 0.1],
      [100, 1],
      [1100, 8],
      [12000, 47],
      [130000, 260],
    ]
    for (const [cost, cps] of cookie) {
      expect(HARDWARE.some((h) => h.baseCost === cost && h.baseCps === cps), `${cost}/${cps}`).toBe(false)
    }
  })
})

describe('hardware ladder — unlocks, power, tiers', () => {
  it('every unlock references an existing hardware id or a known map node', () => {
    for (const h of HARDWARE) {
      const refs = { hardware: [], nodes: [], other: [] } as { hardware: string[]; nodes: string[]; other: string[] }
      collectRefs(h.unlock, refs)
      for (const id of refs.hardware) {
        expect(byId.has(id), `${h.id} unlock → ${id}`).toBe(true)
        // Prerequisites always sit lower on the ladder.
        expect(rankOf.get(id)!, `${h.id} unlock → ${id}`).toBeLessThan(rankOf.get(h.id)!)
      }
      for (const id of refs.nodes) expect(MAP_NODE_IDS.has(id), `${h.id} unlock → ${id}`).toBe(true)
      expect(refs.other, `${h.id} uses unexpected unlock kinds`).toEqual([])
    }
  })

  it('only the two CPUs are always available; regions gate on map nodes or the previous region', () => {
    const always = HARDWARE.filter((h) => h.unlock?.type === 'always').map((h) => h.id)
    expect(always).toEqual(['pc-4c8t', 'pc-8c16t'])
    expect(get('region-us-east').unlock).toEqual({ type: 'mapNode', id: 'regions-unlock' })
    expect(get('orbital-dc').unlock).toEqual({ type: 'mapNode', id: 'orbital-unlock' })
    expect(get('dyson-swarm').unlock).toEqual({ type: 'mapNode', id: 'dyson-unlock' })
    expect(get('rtx-4090').unlock).toEqual({
      type: 'any',
      conds: [
        { type: 'ownHardware', id: 'rtx-4070-ti-super' },
        { type: 'ownHardware', id: 'rtx-3090' },
      ],
    })
  })

  it('draws power everywhere except space', () => {
    for (const h of HARDWARE) {
      if (h.family === 'region') expect(h.watts, h.id).toBeGreaterThanOrEqual(0)
      else expect(h.watts, h.id).toBeGreaterThan(0)
    }
    expect(get('orbital-dc').watts).toBe(0)
    expect(get('dyson-swarm').watts).toBe(0)
    expect(get('region-us-east').watts).toBeGreaterThan(0)
  })

  it('uses the prescribed speed tiers (cloud node = card + 1, regions 12)', () => {
    for (const h of HARDWARE) {
      expect(h.speedTier, h.id).toBe(SPEED_TIERS[h.id])
      expect(h.speedTier).toBeGreaterThanOrEqual(1)
      expect(h.speedTier).toBeLessThanOrEqual(12)
    }
  })

  it('applies growth per family and vendor flags consistently', () => {
    for (const h of HARDWARE) {
      expect(h.growth, h.id).toBe(FAMILY_GROWTH[h.family])
      expect(h.cpuOnly === true, `${h.id} cpuOnly`).toBe(h.family === 'cpu')
      expect(h.mps === true, `${h.id} mps`).toBe(h.family === 'apple')
      if (h.vendor === 'amd') expect(h.rocm, `${h.id} rocm`).toBe(true)
      if (h.family === 'amd-consumer') expect(h.vendor).toBe('amd')
      if (h.family === 'nvidia-consumer' || h.family === 'workstation') expect(h.vendor).toBe('nvidia')
      if (h.family === 'cloud-node') expect(h.cardsPerUnit, h.id).toBe(8)
      else expect(h.cardsPerUnit, h.id).toBeUndefined()
      if (h.family === 'region') {
        expect(h.vram).toBe(Infinity)
        expect(h.vendor).toBe('comfy')
      } else {
        expect(Number.isFinite(h.vram), h.id).toBe(true)
        expect(h.vram).toBeGreaterThan(0)
      }
    }
    expect(get('azure-nd-mi300x').rocm).toBe(true)
    expect(get('aws-p5').rocm).toBeUndefined()
  })

  it('carries real-world VRAM for the well-known cards', () => {
    expect(get('rtx-3060').vram).toBe(12)
    expect(get('rtx-4090').vram).toBe(24)
    expect(get('rtx-5090').vram).toBe(32)
    expect(get('rtx-pro-6000').vram).toBe(96)
    expect(get('h200').vram).toBe(141)
    expect(get('mi300x').vram).toBe(192)
    expect(get('b300').vram).toBe(288)
    expect(get('mac-studio-m4-max').vram).toBe(128)
  })
})

describe('HARDWARE_FAMILIES', () => {
  it('lists each family exactly once with a label and blurb', () => {
    const families: HardwareFamily[] = [
      'cpu', 'apple', 'nvidia-consumer', 'amd-consumer', 'workstation', 'datacenter', 'cloud-node', 'region',
    ]
    expect(HARDWARE_FAMILIES.map((f) => f.id)).toEqual(families)
    expect(HARDWARE_FAMILIES.map((f) => f.label)).toEqual([
      'CPU', 'Apple', 'NVIDIA', 'AMD', 'Workstation', 'Datacenter', 'Cloud Nodes', 'Regions',
    ])
    for (const f of HARDWARE_FAMILIES) expect(f.blurb.length).toBeGreaterThan(10)
    // Every unit belongs to a tab.
    const tabbed = new Set(HARDWARE_FAMILIES.map((f) => f.id))
    for (const h of HARDWARE) expect(tabbed.has(h.family), h.id).toBe(true)
  })

  it('agrees with the game’s FAMILY_LABELS (lock reasons and store tabs use the same words)', () => {
    for (const f of HARDWARE_FAMILIES) {
      expect(f.label.toLowerCase().startsWith(FAMILY_LABELS[f.id].toLowerCase()), `${f.id}: ${f.label} vs ${FAMILY_LABELS[f.id]}`).toBe(true)
    }
  })
})
