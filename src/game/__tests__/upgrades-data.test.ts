import { describe, expect, it } from 'vitest'
import type { Effect, HardwareDef, UnlockCond } from '@/game/types'
import { TIER_UPGRADE_COST_MULT, TIER_UPGRADE_EFFECT, TIER_UPGRADE_THRESHOLDS } from '@/game/constants'
import { ALL_UPGRADES, UPGRADES, generateTierUpgrades } from '@/data/upgrades'
import { ACHIEVEMENTS } from '@/data/achievements'
import {
  CLICK_LINES,
  FLOP_LINES,
  LOADING_LINES,
  OFFLINE_LINES,
  PROMPT_CHIPS,
  TICKER_LINES,
  VIRAL_LINES,
} from '@/data/flavor'

// ---------------------------------------------------------------------------
// Reference lists — hardware/model ids that exist in src/data/hardware.ts & models.ts.
// Kept inline so this test does not depend on those files being present.
// ---------------------------------------------------------------------------
const HARDWARE_IDS = new Set([
  'pc-4c8t', 'pc-8c16t', 'mac-mini-m4', 'rx-7600-xt', 'rtx-3060', 'rx-9070-xt', 'rtx-4070-ti-super',
  'rtx-3090', 'rx-7900-xtx', 'rtx-4090', 'rtx-5080', 'mac-studio-m4-max', 'rtx-5090', 'radeon-pro-w7900',
  'rtx-a6000', 'l4', 'rtx-6000-ada', 'a40', 'l40s', 'rtx-pro-6000', 'a100-80', 'mi300x', 'h100-80', 'mi325x',
  'h200', 'b200', 'b300', 'aws-p4d', 'azure-nd-mi300x', 'aws-p5', 'aws-p5e', 'aws-p6', 'runpod-8xb300',
  'region-us-east', 'region-eu-west', 'region-ap-southeast', 'orbital-dc', 'dyson-swarm',
])
const MODEL_IDS = new Set([
  'sd15', 'sdxl', 'flux-dev', 'wan22-5b', 'ltx2', 'wan22-14b', 'hunyuan-video-15', 'hunyuan3d-21', 'minimax-h3', 'hailuo',
])

/** Typed as a Record over Effect['kind'] so adding a kind to types.ts forces an update here. */
const EFFECT_KINDS: Record<Effect['kind'], true> = {
  clickFlat: true, clickMult: true, clickCpsPct: true, rigMult: true, familyMult: true, globalMult: true,
  likesMult: true, speedMult: true, concurrency: true, offlineCapHours: true, offlineEfficiency: true, powerBudget: true,
  payoutRatio: true, followRate: true, viralChance: true, flopChance: true, unlockFamily: true, zluda: true,
  apiNodes: true, hashtagResearch: true, streakGrace: true, reservedCapacity: true, coolingTier: true,
  tagLikes: true, familyGenTime: true, weekSpeed: true, startHardware: true, cpMult: true,
}

/** Minimal fixture covering every hardware family. */
const hw = (id: string, family: HardwareDef['family'], baseCost: number): HardwareDef => ({
  id, name: id.toUpperCase(), short: id, family, vendor: 'nvidia', baseCost, baseCps: 1, growth: 1.1,
  vram: 24, watts: 100, speedTier: 3, flavor: '', art: id,
})
const FIXTURE: HardwareDef[] = [
  hw('pc-4c8t', 'cpu', 15),
  hw('mac-mini-m4', 'apple', 600),
  hw('rtx-3060', 'nvidia-consumer', 300),
  hw('rtx-4090', 'nvidia-consumer', 1600),
  hw('rx-7900-xtx', 'amd-consumer', 900),
  hw('rtx-pro-6000', 'workstation', 8000),
  hw('h100-80', 'datacenter', 30000),
  hw('aws-p5', 'cloud-node', 250000),
  hw('region-us-east', 'region', 5e6),
]

/** Depth-first visit of an UnlockCond tree. */
function walk(cond: UnlockCond, fn: (c: UnlockCond) => void): void {
  fn(cond)
  if (cond.type === 'all' || cond.type === 'any') cond.conds.forEach((c) => walk(c, fn))
}

function ids<T extends { id: string }>(arr: T[]): string[] {
  return arr.map((x) => x.id)
}

// ---------------------------------------------------------------------------
describe('UPGRADES', () => {
  const all = ALL_UPGRADES(FIXTURE)
  const allIds = new Set(ids(all))

  it('has unique ids across named + generated upgrades', () => {
    expect(allIds.size).toBe(all.length)
  })

  it('ALL_UPGRADES = named + 4 tiers per hardware', () => {
    expect(all.length).toBe(UPGRADES.length + FIXTURE.length * TIER_UPGRADE_THRESHOLDS.length)
    expect(all.slice(0, UPGRADES.length)).toEqual(UPGRADES)
  })

  it('every effect kind is a valid Effect kind', () => {
    for (const u of all) {
      expect(u.effects.length, u.id).toBeGreaterThan(0)
      for (const e of u.effects) expect(EFFECT_KINDS[e.kind], `${u.id}: ${e.kind}`).toBe(true)
    }
  })

  it('every ownHardware unlock references a real hardware id', () => {
    for (const u of all) {
      walk(u.unlock, (c) => {
        if (c.type === 'ownHardware') expect(HARDWARE_IDS.has(c.id), `${u.id} -> ${c.id}`).toBe(true)
      })
    }
  })

  it('every upgrade referenced by another upgrade unlock exists', () => {
    for (const u of all) {
      walk(u.unlock, (c) => {
        if (c.type === 'upgrade') expect(allIds.has(c.id), `${u.id} -> ${c.id}`).toBe(true)
      })
    }
  })

  it('every upgrade has a name, desc, icon and a positive cost', () => {
    for (const u of all) {
      expect(u.name.trim(), u.id).not.toBe('')
      expect(u.desc.trim(), u.id).not.toBe('')
      expect(u.icon.trim(), u.id).not.toBe('')
      expect(u.cost, u.id).toBeGreaterThan(0)
    }
  })

  it('global upgrades unlock at half their cost in lifetime credits', () => {
    const globals = UPGRADES.filter((u) => u.category === 'global')
    expect(globals.length).toBeGreaterThanOrEqual(7)
    for (const u of globals) {
      expect(u.unlock).toEqual({ type: 'stat', key: 'lifetimeCredits', value: u.cost / 2 })
    }
  })

  it('power budget chain is strictly increasing and linked', () => {
    const chain = ['psu-850', 'psu-1600', 'three-phase', 'substation', 'solar-farm', 'fusion-reactor']
    const byId = new Map(UPGRADES.map((u) => [u.id, u]))
    let prevBudget = 0
    chain.forEach((id, i) => {
      const u = byId.get(id)
      expect(u, id).toBeDefined()
      const budget = u!.effects.find((e) => e.kind === 'powerBudget')
      expect(budget?.kind).toBe('powerBudget')
      const value = budget && budget.kind === 'powerBudget' ? budget.value : 0
      expect(value).toBeGreaterThan(prevBudget)
      prevBudget = value
      expect(u!.unlock).toEqual(i === 0 ? { type: 'always' } : { type: 'upgrade', id: chain[i - 1] })
    })
  })

  it('flopChance reductions are positive (they are subtracted from the base)', () => {
    for (const u of UPGRADES) {
      for (const e of u.effects) if (e.kind === 'flopChance') expect(e.value, u.id).toBeGreaterThan(0)
    }
  })

  it('rocm-setup unlocks amd-consumer with the canonical flavor', () => {
    const rocm = UPGRADES.find((u) => u.id === 'rocm-setup')
    expect(rocm?.effects).toEqual([{ kind: 'unlockFamily', family: 'amd-consumer' }])
    expect(rocm?.flavor).toBe('Compiles for forty minutes. Works on the third try.')
  })
})

describe('generateTierUpgrades', () => {
  const tiers = generateTierUpgrades(FIXTURE)

  it('produces tier:<hw>:<1..4> with thresholds, costs and effect from constants', () => {
    for (const h of FIXTURE) {
      TIER_UPGRADE_THRESHOLDS.forEach((threshold, i) => {
        const u = tiers.find((t) => t.id === `tier:${h.id}:${i + 1}`)
        expect(u, `${h.id} tier ${i + 1}`).toBeDefined()
        expect(u!.category).toBe('hardware')
        expect(u!.cost).toBe(Math.ceil(h.baseCost * TIER_UPGRADE_COST_MULT[i]))
        expect(u!.effects).toEqual([{ kind: 'rigMult', hardwareId: h.id, value: TIER_UPGRADE_EFFECT }])
        expect(u!.unlock).toEqual({ type: 'ownHardware', id: h.id, count: threshold })
      })
    }
  })

  it('names within one hardware are distinct and drawn from the family pool', () => {
    for (const h of FIXTURE) {
      const names = tiers.filter((t) => t.id.startsWith(`tier:${h.id}:`)).map((t) => t.name)
      expect(new Set(names).size).toBe(names.length)
      for (const n of names) expect(n.startsWith('Tier '), `${h.id}: ${n}`).toBe(false)
    }
  })

  it('is deterministic and rotates NVIDIA names between different cards', () => {
    expect(generateTierUpgrades(FIXTURE)).toEqual(tiers)
    const names3060 = tiers.filter((t) => t.id.startsWith('tier:rtx-3060:')).map((t) => t.name)
    const names4090 = tiers.filter((t) => t.id.startsWith('tier:rtx-4090:')).map((t) => t.name)
    expect(names3060).not.toEqual(names4090)
  })

  it('handles an empty hardware list', () => {
    expect(generateTierUpgrades([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('ACHIEVEMENTS', () => {
  const upgradeIds = new Set(ids(UPGRADES))

  it('has at least 50 achievements with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(50)
    expect(new Set(ids(ACHIEVEMENTS)).size).toBe(ACHIEVEMENTS.length)
  })

  it('references only real hardware, model and upgrade ids', () => {
    for (const a of ACHIEVEMENTS) {
      walk(a.cond, (c) => {
        if (c.type === 'ownHardware') expect(HARDWARE_IDS.has(c.id), `${a.id} -> ${c.id}`).toBe(true)
        if (c.type === 'ownModel') expect(MODEL_IDS.has(c.id), `${a.id} -> ${c.id}`).toBe(true)
        if (c.type === 'precision') expect(MODEL_IDS.has(c.modelId), `${a.id} -> ${c.modelId}`).toBe(true)
        if (c.type === 'upgrade') expect(upgradeIds.has(c.id), `${a.id} -> ${c.id}`).toBe(true)
      })
    }
  })

  it('hidden achievements are flag-driven easter eggs', () => {
    const hidden = ACHIEVEMENTS.filter((a) => a.hidden)
    expect(hidden.length).toBeGreaterThanOrEqual(3)
    for (const a of hidden) expect(a.cond.type, a.id).toBe('flag')
  })

  it('every achievement has a name, desc and icon', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.trim(), a.id).not.toBe('')
      expect(a.desc.trim(), a.id).not.toBe('')
      expect(a.icon.trim(), a.id).not.toBe('')
    }
  })

  it('includes the headline ones', () => {
    const names = new Set(ACHIEVEMENTS.map((a) => a.name))
    for (const n of ['It Works On My Machine', 'Ctrl+Enter Enjoyer', 'Melted Connector', 'Prosumer',
      'Cluster Headache', 'Posted, Not Ghosted', 'It Moves!', 'CUDA Out Of Memory', 'GGUF Enjoyer',
      'Potato Cinema', 'Micro-Influencer', 'Comfy Famous', 'Series B', 'Comfy Sleep Mode', 'Season 2',
      'Client Work', 'LoRA Tuesday', 'Daily Driver', 'Speedrun', 'Spaghetti Mode']) {
      expect(names.has(n), n).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
describe('flavor', () => {
  it('has the expected pool sizes and no empty/duplicate lines', () => {
    expect(TICKER_LINES.length).toBeGreaterThanOrEqual(40)
    expect(PROMPT_CHIPS.length).toBe(24)
    for (const pool of [TICKER_LINES, CLICK_LINES, FLOP_LINES, VIRAL_LINES, OFFLINE_LINES, LOADING_LINES]) {
      expect(pool.length).toBeGreaterThanOrEqual(10)
      expect(new Set(pool).size).toBe(pool.length)
      for (const line of pool) expect(line.trim()).not.toBe('')
    }
  })

  it('prompt chips carry lowercase keywords', () => {
    for (const chip of PROMPT_CHIPS) {
      expect(chip.text.trim()).not.toBe('')
      expect(chip.keywords.length).toBeGreaterThan(0)
      for (const k of chip.keywords) expect(k).toBe(k.toLowerCase())
    }
  })
})
