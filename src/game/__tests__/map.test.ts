import { describe, expect, it, vi } from 'vitest'

import type { Catalog } from '@/data'
import { CONTRACTS } from '@/data/contracts'
import { EVENT_DEFS, EVENT_DURATION_S } from '@/data/events'
import { MAP_GRID_X, MAP_GRID_Y, MAP_NODES } from '@/data/mapNodes'
import {
  MAP_BRANCHES,
  ROOT_NODE_ID,
  canAffordNode,
  childrenOf,
  cpAvailable,
  isMarker,
  mapEdges,
  mapNodeAvailable,
  mapNodeCost,
  mapNodeVisible,
  nodesByBranch,
  rpAvailable,
  rpSpent,
  unlockNode,
} from '@/game/map'
import type {
  ContractGoal,
  Derived,
  EventKind,
  GameState,
  HardwareDef,
  MapNodeDef,
  UnlockCond,
} from '@/game/types'

/**
 * `@/game/unlock` is owned by another module. Use the real implementation when it exists,
 * otherwise fall back to a minimal evaluator covering the condition types this suite exercises.
 */
vi.mock('@/game/unlock', async (importOriginal) => {
  try {
    return await importOriginal<typeof import('@/game/unlock')>()
  } catch {
    const isUnlocked = (cond: UnlockCond | undefined, state: GameState, derived: Derived, catalog: Catalog): boolean => {
      if (!cond) return true
      switch (cond.type) {
        case 'always':
          return true
        case 'flag':
          return state.flags[cond.key] === true
        case 'mapNode':
          return state.mapNodes.includes(cond.id)
        case 'ownHardware':
          return (state.hardware[cond.id] ?? 0) >= (cond.count ?? 1)
        case 'ownFamily': {
          let n = 0
          for (const hw of catalog.hardware) if (hw.family === cond.family) n += state.hardware[hw.id] ?? 0
          return n >= (cond.count ?? 1)
        }
        case 'ownModel':
          return cond.id in state.models
        case 'all':
          return cond.conds.every((c) => isUnlocked(c, state, derived, catalog))
        case 'any':
          return cond.conds.some((c) => isUnlocked(c, state, derived, catalog))
        default:
          return false
      }
    }
    return { isUnlocked }
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const AMD_CARD: HardwareDef = {
  id: 'rx-7900-xtx',
  name: 'Radeon RX 7900 XTX',
  short: '7900',
  family: 'amd-consumer',
  vendor: 'amd',
  baseCost: 900,
  baseCps: 5,
  growth: 1.12,
  vram: 24,
  rocm: true,
  watts: 355,
  speedTier: 4,
  flavor: 'test',
  art: 'test',
}

const CLOUD_NODE: HardwareDef = {
  ...AMD_CARD,
  id: 'aws-p5',
  name: 'p5',
  short: 'p5',
  family: 'cloud-node',
  vendor: 'aws',
  rocm: undefined,
  speedTier: 10,
}

const catalog: Catalog = {
  hardware: [AMD_CARD, CLOUD_NODE],
  models: [],
  precisions: {
    native: { id: 'native', label: 'Native', vramMult: 1, qualityMult: 1, costMult: 1, timeMult: 1, feeFraction: 0 },
    fp8: { id: 'fp8', label: 'FP8', vramMult: 0.5, qualityMult: 0.9, costMult: 0.8, timeMult: 0.8, feeFraction: 0.3 },
    q4: { id: 'q4', label: 'Q4', vramMult: 0.25, qualityMult: 0.75, costMult: 0.6, timeMult: 0.7, feeFraction: 0.5 },
  },
  upgrades: [],
  mapNodes: MAP_NODES,
  achievements: [],
  hashtags: [],
  contracts: CONTRACTS,
  events: EVENT_DEFS,
  gamble: [],
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    v: 1,
    meta: { createdAt: 0, lastTickAt: 0, lastSavedAt: 0, playedSec: 0, guestId: 'g', season: 1 },
    credits: 0,
    lifetimeCredits: 0,
    seasonCredits: 0,
    totalClicks: 0,
    hardware: { 'pc-4c8t': 1 },
    hardwareTiers: {},
    upgrades: [],
    models: { sd15: { precisions: ['native'], setup: true } },
    loras: [],
    mapNodes: [],
    achievements: [],
    posts: [],
    queue: [],
    followers: 0,
    followersFrac: 0,
    lifetimeFollowers: 0,
    lifetimeLikes: 0,
    signups: 0,
    rp: 0,
    cp: 0,
    cpSpent: 0,
    hubRep: 0,
    contracts: { active: [], nextRotateAt: 0 },
    events: { active: [], nextAt: 0 },
    daily: { lastClaimDay: null, streak: 0, claimed: [] },
    stats: {
      posts: 0, videos: 0, flops: 0, virals: 0, quantizations: 0, offlineClaims: 0, rebrands: 0,
      contractsDone: 0, hubPublished: 0, hubRuns: 0, lorasTrained: 0, bestPostLikes: 0,
      lastPrompt: '', lastPostKey: '', bestCps: 0, clicksWindow: [],
      levelSeen: 1, ratioed: 0, dislikes: 0, spins: 0, spinNet: 0,
      clickLockUntil: 0, clickStrikes: 0, clickStrikeAt: 0,
      luckyClicks: 0, landedStreak: 0, bestLandedStreak: 0,
    },
    gamble: { nextSpinAt: 0, freeSpinDay: null, winStreak: 0, dryStreak: 0, pot: 0 },
    settings: { sfx: true, particles: true, reducedMotion: false, projector: false, autosave: true },
    flags: {},
    weekOverride: null,
    liveTrending: null,
    ...overrides,
  }
}

const derived: Derived = {
  cps: 1, rawCps: 1, clickValue: 1, bestVram: 0, bestTier: 1, bestHardwareId: 'pc-4c8t', hasGpu: false,
  powerDraw: 0, powerBudget: 650, throttled: false, concurrency: 1, speedMult: 1, likesMult: 1,
  payoutBonus: 0, followRate: 0.05, viralChance: 0.05, flopChance: 0.15, offlineCapHours: 12, offlineEfficiency: 0.5,
  globalMult: 1, cpMult: 1, familyMult: {}, rigMult: {}, familyGenTime: {}, coolingTier: {}, tagLikes: {},
  unlockedFamilies: ['cpu', 'apple', 'nvidia-consumer', 'workstation', 'datacenter', 'cloud-node', 'region'],
  zluda: false, apiNodes: false, hashtagResearch: false, streakGrace: false, reservedCapacity: false, weekSpeed: 1,
}

const byId = new Map(MAP_NODES.map((n) => [n.id, n]))
const node = (id: string): MapNodeDef => {
  const n = byId.get(id)
  if (!n) throw new Error(`missing node ${id}`)
  return n
}

/** Depth-first search for a condition of the given type anywhere in a (possibly nested) cond. */
function hasCondType(cond: UnlockCond | undefined, type: UnlockCond['type']): boolean {
  if (!cond) return false
  if (cond.type === type) return true
  if (cond.type === 'all' || cond.type === 'any') return cond.conds.some((c) => hasCondType(c, type))
  return false
}

// ---------------------------------------------------------------------------
// Graph structure
// ---------------------------------------------------------------------------
describe('MAP_NODES graph', () => {
  it('has roughly 120 nodes and a free credits root', () => {
    expect(MAP_NODES.length).toBeGreaterThanOrEqual(110)
    const root = node(ROOT_NODE_ID)
    expect(root.cost).toBe(0)
    expect(root.currency).toBe('credits')
    expect(root.parents).toEqual([])
    expect(root.branch).toBe('core')
  })

  it('has unique ids', () => {
    expect(new Set(MAP_NODES.map((n) => n.id)).size).toBe(MAP_NODES.length)
  })

  it('has unique grid-aligned positions', () => {
    const keys = MAP_NODES.map((n) => `${n.position.x},${n.position.y}`)
    expect(new Set(keys).size).toBe(MAP_NODES.length)
    for (const n of MAP_NODES) {
      expect(n.position.x % MAP_GRID_X).toBe(0)
      expect(n.position.y % MAP_GRID_Y).toBe(0)
      expect(n.position.x).toBeGreaterThanOrEqual(0)
      expect(n.position.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('references only existing parents, 1–2 per non-root node, never itself', () => {
    for (const n of MAP_NODES) {
      if (n.id === ROOT_NODE_ID) continue
      expect(n.parents.length, n.id).toBeGreaterThanOrEqual(1)
      expect(n.parents.length, n.id).toBeLessThanOrEqual(2)
      for (const p of n.parents) {
        expect(byId.has(p), `${n.id} → ${p}`).toBe(true)
        expect(p).not.toBe(n.id)
      }
    }
  })

  it('is a DAG (no cycles through parents)', () => {
    const state = new Map<string, 0 | 1 | 2>()
    const visit = (id: string): void => {
      const s = state.get(id) ?? 0
      if (s === 1) throw new Error(`cycle at ${id}`)
      if (s === 2) return
      state.set(id, 1)
      for (const p of node(id).parents) visit(p)
      state.set(id, 2)
    }
    expect(() => MAP_NODES.forEach((n) => visit(n.id))).not.toThrow()
  })

  it('reaches every node from core-root following child edges', () => {
    const seen = new Set<string>([ROOT_NODE_ID])
    const stack = [ROOT_NODE_ID]
    while (stack.length) {
      const id = stack.pop()!
      for (const child of childrenOf(id, catalog)) {
        if (!seen.has(child.id)) {
          seen.add(child.id)
          stack.push(child.id)
        }
      }
    }
    expect(seen.size).toBe(MAP_NODES.length)
  })

  it('uses only known currencies and branches', () => {
    for (const n of MAP_NODES) {
      expect(['credits', 'rp', 'cp']).toContain(n.currency)
      expect(MAP_BRANCHES).toContain(n.branch)
    }
    for (const b of MAP_BRANCHES) expect(nodesByBranch(catalog)[b].length, b).toBeGreaterThan(0)
  })

  it('has positive costs everywhere except the root', () => {
    for (const n of MAP_NODES) {
      if (n.id === ROOT_NODE_ID) continue
      expect(n.cost, n.id).toBeGreaterThan(0)
      expect(Number.isFinite(n.cost), n.id).toBe(true)
    }
  })

  it('escalates cost along every edge that stays in the same currency', () => {
    for (const n of MAP_NODES) {
      for (const p of n.parents) {
        const parent = node(p)
        if (parent.currency !== n.currency) continue
        expect(n.cost, `${p} (${parent.cost}) → ${n.id} (${n.cost})`).toBeGreaterThanOrEqual(parent.cost)
      }
    }
  })

  it('spans the intended cost ranges per currency', () => {
    const costs = (cur: string) => MAP_NODES.filter((n) => n.currency === cur && n.cost > 0).map((n) => n.cost)
    expect(Math.min(...costs('credits'))).toBeLessThanOrEqual(500)
    expect(Math.max(...costs('credits'))).toBe(1e10)
    expect(Math.min(...costs('rp'))).toBe(1)
    expect(Math.max(...costs('rp'))).toBe(60)
    expect(Math.min(...costs('cp'))).toBe(3)
    expect(Math.max(...costs('cp'))).toBe(200)
  })

  it('marks hidden nodes with the hidden branch and a flag condition, and vice versa', () => {
    for (const n of MAP_NODES) {
      if (n.hidden) {
        expect(n.branch, n.id).toBe('hidden')
        expect(hasCondType(n.unlock, 'flag'), n.id).toBe(true)
      } else {
        expect(n.branch, n.id).not.toBe('hidden')
      }
    }
  })

  it('has non-empty title, desc and icon on every node', () => {
    for (const n of MAP_NODES) {
      expect(n.title.trim().length, n.id).toBeGreaterThan(0)
      expect(n.desc.trim().length, n.id).toBeGreaterThan(0)
      expect(n.icon.trim().length, n.id).toBeGreaterThan(0)
    }
  })

  it('produces one edge per parent reference', () => {
    const edges = mapEdges(catalog)
    expect(edges.length).toBe(MAP_NODES.reduce((s, n) => s + n.parents.length, 0))
    expect(edges.every((e) => byId.has(e.from) && byId.has(e.to))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Required content
// ---------------------------------------------------------------------------
describe('MAP_NODES required nodes', () => {
  it('zluda', () => {
    const n = node('zluda')
    expect(n.branch).toBe('techniques')
    expect(n.cost).toBe(5000)
    expect(n.currency).toBe('credits')
    expect(n.parents).toEqual(['rocm-basics'])
    expect(n.effects).toContainEqual({ kind: 'zluda' })
    expect(node('rocm-basics').unlock).toEqual({ type: 'ownFamily', family: 'amd-consumer' })
  })

  it('api-nodes', () => {
    const n = node('api-nodes')
    expect(n.branch).toBe('api')
    expect(n.cost).toBe(5e6)
    expect(n.effects).toContainEqual({ kind: 'apiNodes' })
  })

  it('social lane: hashtag-research-plus and streak-grace', () => {
    const h = node('hashtag-research-plus')
    expect(h.branch).toBe('social')
    expect(h.effects).toContainEqual({ kind: 'hashtagResearch' })
    const s = node('streak-grace')
    expect(s.branch).toBe('social')
    expect(s.currency).toBe('rp')
    expect(s.cost).toBe(3)
    expect(s.effects).toContainEqual({ kind: 'streakGrace' })
  })

  it('regions lane: regions-unlock, orbital-unlock, dyson-unlock', () => {
    const r = node('regions-unlock')
    expect(r.branch).toBe('regions')
    expect(r.cost).toBe(2e7)
    expect(r.currency).toBe('credits')
    expect(r.parents).toContain('cluster-ops')
    const o = node('orbital-unlock')
    expect(o.branch).toBe('regions')
    expect(o.cost).toBe(25)
    expect(o.currency).toBe('cp')
    const d = node('dyson-unlock')
    expect(d.branch).toBe('regions')
    expect(d.cost).toBe(200)
    expect(d.currency).toBe('cp')
  })

  it('distill-<family> for every model family', () => {
    for (const fam of ['sd', 'flux', 'qwen', 'wan', 'ltx', 'hunyuan']) {
      const n = node(`distill-${fam}`)
      expect(n.branch).toBe('techniques')
      expect(n.effects).toEqual([{ kind: 'familyGenTime', family: fam, value: 0.7 }])
    }
  })

  it('lora-training marker', () => {
    const n = node('lora-training')
    expect(n.branch).toBe('techniques')
    expect(n.effects).toEqual([{ kind: 'tagLikes', tag: '*', value: 0 }])
    expect(isMarker('lora-training')).toBe(true)
  })

  it('quantization markers', () => {
    expect(node('quant-fp8').cost).toBe(1500)
    expect(node('quant-fp8').branch).toBe('techniques')
    expect(node('quant-q4').cost).toBe(15000)
    expect(node('quant-q4').parents).toEqual(['quant-fp8'])
    expect(isMarker('quant-fp8')).toBe(true)
    expect(isMarker('quant-q4')).toBe(true)
    expect(isMarker('core-manager')).toBe(false)
  })

  it('infra: big power nodes, reserved capacity, cooling', () => {
    expect(node('power-microgrid').effects).toContainEqual({ kind: 'powerBudget', value: 5e5 })
    expect(node('power-orbital-solar').effects).toContainEqual({ kind: 'powerBudget', value: 1e9 })
    expect(node('power-microgrid').branch).toBe('infra')
    expect(node('reserved-capacity').effects).toContainEqual({ kind: 'reservedCapacity' })
    expect(node('reserved-capacity').branch).toBe('infra')
    const cooling = MAP_NODES.filter((n) => n.id.startsWith('cooling-'))
    expect(cooling.length).toBeGreaterThanOrEqual(3)
    for (const c of cooling) {
      expect(c.branch).toBe('infra')
      expect(c.effects.some((e) => e.kind === 'coolingTier')).toBe(true)
    }
  })

  it('hardware lane: ×1.1/×1.25/×1.5 familyMult for every family', () => {
    const fams = ['cpu', 'apple', 'nvidia-consumer', 'amd-consumer', 'workstation', 'datacenter', 'cloud-node', 'region']
    for (const fam of fams) {
      const nodes = MAP_NODES.filter(
        (n) => n.branch === 'hardware' && n.effects.some((e) => e.kind === 'familyMult' && e.family === fam),
      )
      const values = nodes.flatMap((n) => n.effects).flatMap((e) => (e.kind === 'familyMult' ? [e.value] : []))
      expect(values.sort((a, b) => a - b), fam).toEqual([1.1, 1.25, 1.5])
    }
    expect(node('hardware-cpu-1').effects).toEqual([{ kind: 'familyMult', family: 'cpu', value: 1.1 }])
    expect(node('hardware-nvidia-1').effects).toEqual([{ kind: 'familyMult', family: 'nvidia-consumer', value: 1.1 }])
  })

  it('prestige lane (cp)', () => {
    const s = node('start-with-4090')
    expect(s.branch).toBe('prestige')
    expect(s.currency).toBe('cp')
    expect(s.cost).toBe(5)
    expect(s.effects).toEqual([{ kind: 'startHardware', hardwareId: 'rtx-4090', count: 1 }])
    const costs = [3, 6, 12, 25, 50]
    costs.forEach((cost, i) => {
      const n = node(`season-income-${i + 1}`)
      expect(n.currency).toBe('cp')
      expect(n.cost).toBe(cost)
      expect(n.effects).toEqual([{ kind: 'cpMult', value: 1.1 }])
    })
    const f = node('fast-weeks')
    expect(f.cost).toBe(10)
    expect(f.currency).toBe('cp')
    expect(f.effects).toEqual([{ kind: 'weekSpeed', value: 2 }])
    for (const n of MAP_NODES.filter((n) => n.branch === 'prestige')) expect(n.currency, n.id).toBe('cp')
  })

  it('hidden lane easter eggs', () => {
    const cases: Array<[string, string, object]> = [
      ['pythongosssss-node', 'ticker-seven', { kind: 'globalMult', value: 0.07 }],
      ['spaghetti-monster', 'konami', { kind: 'likesMult', value: 1.11 }],
      ['seed-42', 'seed42', { kind: 'viralChance', value: 0.01 }],
    ]
    for (const [id, flag, effect] of cases) {
      const n = node(id)
      expect(n.hidden).toBe(true)
      expect(n.unlock).toEqual({ type: 'flag', key: flag })
      expect(n.effects).toContainEqual(effect)
    }
    expect(node('rickroll').hidden).toBe(true)
    expect(node('rickroll').unlock).toEqual({ type: 'flag', key: 'rickroll' })
  })

  it('every social node costs rp and every hardware/models/infra/api node costs credits', () => {
    const groups = nodesByBranch(catalog)
    for (const n of groups.social) expect(n.currency, n.id).toBe('rp')
    for (const b of ['hardware', 'models', 'infra', 'api', 'techniques', 'core'] as const) {
      for (const n of groups[b]) expect(n.currency, n.id).toBe('credits')
    }
  })
})

// ---------------------------------------------------------------------------
// map.ts behaviour
// ---------------------------------------------------------------------------
describe('map.ts availability', () => {
  it('root is available on a fresh state, children are not', () => {
    const state = makeState()
    expect(mapNodeAvailable(node('core-root'), state, derived, catalog)).toBe(true)
    expect(mapNodeAvailable(node('core-manager'), state, derived, catalog)).toBe(false)
  })

  it('child becomes available once all parents are owned', () => {
    const state = makeState({ mapNodes: ['core-root'] })
    expect(mapNodeAvailable(node('core-manager'), state, derived, catalog)).toBe(true)
    // cluster-ops has two parents: needs both.
    const partial = makeState({ mapNodes: ['power-microgrid'] })
    expect(mapNodeAvailable(node('cluster-ops'), partial, derived, catalog)).toBe(false)
    const both = makeState({ mapNodes: ['power-microgrid', 'cooling-immersion'] })
    expect(mapNodeAvailable(node('cluster-ops'), both, derived, catalog)).toBe(true)
  })

  it('owned nodes are no longer available', () => {
    const state = makeState({ mapNodes: ['core-root'] })
    expect(mapNodeAvailable(node('core-root'), state, derived, catalog)).toBe(false)
  })

  it('respects unlock conditions (rocm-basics needs an AMD card)', () => {
    const noAmd = makeState({ mapNodes: ['core-root', 'core-manager', 'core-readme', 'tech-sage'] })
    expect(mapNodeAvailable(node('rocm-basics'), noAmd, derived, catalog)).toBe(false)
    const withAmd = makeState({
      mapNodes: ['core-root', 'core-manager', 'core-readme', 'tech-sage'],
      hardware: { 'pc-4c8t': 1, 'rx-7900-xtx': 1 },
    })
    expect(mapNodeAvailable(node('rocm-basics'), withAmd, derived, catalog)).toBe(true)
  })

  it('hidden nodes need their flag, and stay invisible until then', () => {
    const state = makeState({ mapNodes: ['core-root'] })
    expect(mapNodeAvailable(node('seed-42'), state, derived, catalog)).toBe(false)
    expect(mapNodeVisible(node('seed-42'), state, derived, catalog)).toBe(false)
    const flagged = makeState({ mapNodes: ['core-root'], flags: { seed42: true } })
    expect(mapNodeAvailable(node('seed-42'), flagged, derived, catalog)).toBe(true)
    expect(mapNodeVisible(node('seed-42'), flagged, derived, catalog)).toBe(true)
    const owned = makeState({ mapNodes: ['core-root', 'seed-42'] })
    expect(mapNodeVisible(node('seed-42'), owned, derived, catalog)).toBe(true)
    expect(mapNodeVisible(node('core-manager'), state, derived, catalog)).toBe(true)
  })
})

describe('map.ts currency handling', () => {
  it('mapNodeCost returns the def cost', () => {
    expect(mapNodeCost(node('core-manager'))).toBe(500)
    expect(mapNodeCost(node('core-root'))).toBe(0)
  })

  it('credits are deducted on unlock', () => {
    const state = makeState({ credits: 600, mapNodes: ['core-root'] })
    const n = node('core-manager')
    expect(canAffordNode(n, state, catalog)).toBe(true)
    expect(unlockNode(state, n, catalog)).toBe(true)
    expect(state.credits).toBe(100)
    expect(state.mapNodes).toContain('core-manager')
  })

  it('refuses unaffordable or already-owned nodes without touching state', () => {
    const state = makeState({ credits: 100, mapNodes: ['core-root'] })
    expect(canAffordNode(node('core-manager'), state, catalog)).toBe(false)
    expect(unlockNode(state, node('core-manager'), catalog)).toBe(false)
    expect(state.credits).toBe(100)
    expect(state.mapNodes).toEqual(['core-root'])
    const rich = makeState({ credits: 1e6, mapNodes: ['core-root', 'core-manager'] })
    expect(unlockNode(rich, node('core-manager'), catalog)).toBe(false)
    expect(rich.credits).toBe(1e6)
  })

  it('rp spending never lowers state.rp; availability comes from unlocked rp nodes', () => {
    const state = makeState({ rp: 3, mapNodes: ['core-root', 'core-manager', 'core-readme'] })
    const reddit = node('social-reddit') // 1 rp
    const research = node('hashtag-research-plus') // 2 rp
    const grace = node('streak-grace') // 3 rp
    expect(rpAvailable(state, catalog)).toBe(3)
    expect(unlockNode(state, reddit, catalog)).toBe(true)
    expect(state.rp).toBe(3)
    expect(rpSpent(state, catalog)).toBe(1)
    expect(rpAvailable(state, catalog)).toBe(2)
    expect(unlockNode(state, research, catalog)).toBe(true)
    expect(rpAvailable(state, catalog)).toBe(0)
    expect(canAffordNode(grace, state, catalog)).toBe(false)
    expect(unlockNode(state, grace, catalog)).toBe(false)
    state.rp += 3 // a signup later
    expect(rpAvailable(state, catalog)).toBe(3)
    expect(unlockNode(state, grace, catalog)).toBe(true)
    expect(state.rp).toBe(6)
    expect(rpAvailable(state, catalog)).toBe(0)
  })

  it('cp spending goes through cpSpent and leaves state.cp intact', () => {
    const state = makeState({ cp: 8, mapNodes: ['core-root'] })
    const s1 = node('season-income-1') // 3 cp
    const start = node('start-with-4090') // 5 cp
    expect(cpAvailable(state)).toBe(8)
    expect(unlockNode(state, s1, catalog)).toBe(true)
    expect(state.cp).toBe(8)
    expect(state.cpSpent).toBe(3)
    expect(cpAvailable(state)).toBe(5)
    expect(unlockNode(state, start, catalog)).toBe(true)
    expect(state.cpSpent).toBe(8)
    expect(cpAvailable(state)).toBe(0)
    expect(canAffordNode(node('season-income-2'), state, catalog)).toBe(false)
  })

  it('defaults to the shipped MAP_NODES when no catalog is passed', () => {
    const state = makeState({ rp: 5, mapNodes: ['social-reddit'] })
    expect(rpSpent(state)).toBe(1)
    expect(rpAvailable(state)).toBe(4)
    expect(canAffordNode(node('hashtag-research-plus'), state)).toBe(true)
  })

  it('nodesByBranch groups every node exactly once', () => {
    const groups = nodesByBranch(catalog)
    const total = MAP_BRANCHES.reduce((s, b) => s + groups[b].length, 0)
    expect(total).toBe(MAP_NODES.length)
    expect(groups.core[0].id).toBe(ROOT_NODE_ID)
    expect(groups.hidden.every((n) => n.hidden)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Contracts & events data
// ---------------------------------------------------------------------------
describe('CONTRACTS', () => {
  it('has unique ids and sane ranges', () => {
    expect(CONTRACTS.length).toBeGreaterThanOrEqual(25)
    expect(new Set(CONTRACTS.map((c) => c.id)).size).toBe(CONTRACTS.length)
    for (const c of CONTRACTS) {
      expect(c.minTier, c.id).toBeGreaterThanOrEqual(1)
      expect(c.minTier, c.id).toBeLessThanOrEqual(10)
      expect(c.rewardSecs, c.id).toBeGreaterThanOrEqual(300)
      expect(c.rewardSecs, c.id).toBeLessThanOrEqual(3600)
      expect(c.weight, c.id).toBeGreaterThan(0)
      expect(c.client.length, c.id).toBeGreaterThan(0)
      const target = c.goal.type === 'ownHardware' ? c.goal.count : c.goal.value
      expect(target, c.id).toBeGreaterThan(0)
    }
  })

  it('covers every ContractGoal type and both tiers 1 and 10', () => {
    const types: ContractGoal['type'][] = ['posts', 'likes', 'followers', 'ownHardware', 'clicks', 'quantize', 'virals']
    const seen = new Set(CONTRACTS.map((c) => c.goal.type))
    for (const t of types) expect(seen.has(t), t).toBe(true)
    const tiers = new Set(CONTRACTS.map((c) => c.minTier))
    expect(tiers.has(1)).toBe(true)
    expect(tiers.has(10)).toBe(true)
    expect(CONTRACTS.some((c) => (c.rewardRp ?? 0) > 0)).toBe(true)
    expect(CONTRACTS.some((c) => (c.rewardCp ?? 0) > 0)).toBe(true)
    expect(CONTRACTS.some((c) => c.goal.type === 'posts' && c.goal.kind !== undefined)).toBe(true)
    expect(CONTRACTS.some((c) => c.goal.type === 'posts' && c.goal.tag !== undefined)).toBe(true)
  })

  it('uses at least nine distinct clients', () => {
    expect(new Set(CONTRACTS.map((c) => c.client)).size).toBeGreaterThanOrEqual(9)
  })
})

describe('EVENT_DEFS', () => {
  it('covers every EventKind with the designed durations', () => {
    const kinds: EventKind[] = ['modelDrop', 'nodeBroke', 'founderRepost', 'spotReclaim', 'powerSurge', 'trendingSpark', 'cloudPromo']
    const seen = new Set(EVENT_DEFS.map((e) => e.kind))
    for (const k of kinds) expect(seen.has(k), k).toBe(true)
    expect(EVENT_DEFS.length).toBeGreaterThanOrEqual(8)
    expect(EVENT_DEFS.length).toBeLessThanOrEqual(10)
    expect(new Set(EVENT_DEFS.map((e) => e.id)).size).toBe(EVENT_DEFS.length)
    for (const e of EVENT_DEFS) {
      expect(e.durationSec, e.id).toBe(EVENT_DURATION_S[e.kind])
      expect(e.weight, e.id).toBeGreaterThan(0)
      expect(e.minTier, e.id).toBeGreaterThanOrEqual(1)
    }
    expect(EVENT_DURATION_S).toEqual({
      modelDrop: 300, nodeBroke: 120, founderRepost: 60, spotReclaim: 60, powerSurge: 90, trendingSpark: 8, cloudPromo: 77,
    })
  })
})
